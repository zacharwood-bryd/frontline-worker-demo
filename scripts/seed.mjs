/**
 * Dry-run or apply the Slack calls for a frontline plan.
 * Tokens stay in the environment. Workspace ids go in the gitignored links file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPlan, NORRHEM_INPUT } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function tokenName(personId) {
  if (personId === "admin") return "SLACK_ADMIN_TOKEN";
  return `SLACK_TOKEN_${String(personId).toUpperCase()}`;
}

export function seedCalls(plan) {
  const calls = [
    {
      id: "workspace",
      method: "admin.teams.create",
      token: "admin",
      body: {
        team_name: plan.slack.workspaceName,
        team_domain: plan.slack.workspaceDomain,
        team_description: `${plan.company} frontline demo.`,
        team_discoverability: "invite_only",
      },
    },
  ];

  for (const channel of plan.channels) {
    calls.push({
      id: `channel:${channel.name}`,
      method: "admin.conversations.create",
      token: "admin",
      body: {
        name: channel.name,
        is_private: false,
        description: channel.purpose,
        team_id: "{{team}}",
      },
    });
  }

  calls.push({
    id: "canvas",
    method: "canvases.create",
    token: plan.canvas.owner,
    body: {
      title: plan.canvas.title,
      document_content: { type: "markdown", markdown: plan.canvas.markdown },
      channel_id: `{{channel:${plan.canvas.channel}}}`,
    },
  });

  for (const message of plan.stagedMessages) {
    const body = {
      channel: `{{channel:${message.channel}}}`,
      text: message.text,
    };
    if (message.blocks) body.blocks = message.blocks;
    if (message.thread) body.thread_ts = `{{ts:${message.thread}}}`;
    calls.push({
      id: message.id,
      method: "chat.postMessage",
      token: message.author,
      kind: message.kind,
      body,
    });
  }

  for (const bookmark of plan.bookmarks) {
    if (!bookmark.link) continue;
    calls.push({
      id: `bookmark:${bookmark.title}`,
      method: "bookmarks.add",
      token: "admin",
      body: {
        channel_id: `{{channel:${bookmark.channel}}}`,
        title: bookmark.title,
        type: "link",
        link: bookmark.link,
        emoji: bookmark.emoji,
      },
    });
  }

  return calls;
}

function blankState(plan, links) {
  return {
    teamId: links?.teamId || null,
    teamDomain: plan.slack.workspaceDomain,
    channels: { ...(links?.channels || {}) },
    canvasId: links?.canvasId || null,
    bookmarks: { ...(links?.bookmarks || {}) },
    messages: { ...(links?.messages || {}) },
    posted: [...(links?.posted || [])],
  };
}

function resolvePlaceholders(body, state) {
  const raw = JSON.stringify(body);
  if (raw.includes("{{ts:")) {
    const missing = [...raw.matchAll(/\{\{ts:([^}]+)\}\}/g)].find((match) => !state.messages[match[1]]);
    if (missing) return { pending: `parent-not-posted:${missing[1]}` };
  }
  if (raw.includes("{{channel:")) {
    const missing = [...raw.matchAll(/\{\{channel:([^}]+)\}\}/g)].find((match) => !state.channels[match[1]]);
    if (missing) return { pending: `channel-not-created:${missing[1]}` };
  }
  const resolved = raw
    .replaceAll("{{team}}", state.teamId || "")
    .replace(/\{\{channel:([^}]+)\}\}/g, (_, name) => state.channels[name])
    .replace(/\{\{ts:([^}]+)\}\}/g, (_, id) => state.messages[id]);
  return { body: JSON.parse(resolved) };
}

function alreadyDone(call, state) {
  if (call.id === "workspace") return Boolean(state.teamId);
  if (call.id.startsWith("channel:")) return Boolean(state.channels[call.body.name]);
  if (call.id === "canvas") return Boolean(state.canvasId);
  if (call.method === "bookmarks.add") return Boolean(state.bookmarks[call.body.title]);
  if (call.method === "chat.postMessage") return state.posted.includes(call.id);
  return false;
}

async function slackCall(fetchImpl, method, token, body) {
  const response = await fetchImpl(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.error || "unknown_error"}`);
  }
  return data;
}

export async function runSeed({ plan, env = {}, apply = false, fetch: fetchImpl = fetch, links = null, writeLinks = () => {} }) {
  const calls = seedCalls(plan);
  const state = blankState(plan, links);
  const pending = [];

  if (!apply) {
    for (const call of calls) {
      if (!env[tokenName(call.token)]) pending.push({ id: call.id, token: tokenName(call.token) });
    }
    return { mode: "dry-run", calls, pending, links: state };
  }

  if (!env.SLACK_ADMIN_TOKEN) {
    return { mode: "blocked", gateId: "slack-token", calls, pending, links: state };
  }

  for (const call of calls) {
    if (alreadyDone(call, state)) continue;
    const secret = env[tokenName(call.token)];
    if (!secret) {
      pending.push({ id: call.id, token: tokenName(call.token) });
      continue;
    }
    const resolved = resolvePlaceholders(call.body, state);
    if (resolved.pending) {
      pending.push({ id: call.id, token: tokenName(call.token), reason: resolved.pending });
      continue;
    }
    let data;
    try {
      data = await slackCall(fetchImpl, call.method, secret, resolved.body);
    } catch (error) {
      await writeLinks(state);
      throw error;
    }
    if (call.id === "workspace") state.teamId = data.team;
    if (call.id.startsWith("channel:")) state.channels[resolved.body.name] = data.channel_id;
    if (call.id === "canvas") state.canvasId = data.canvas_id;
    if (call.method === "bookmarks.add") state.bookmarks[resolved.body.title] = data.bookmark?.id || true;
    if (call.method === "chat.postMessage") {
      state.posted.push(call.id);
      if (data.ts) state.messages[call.id] = data.ts;
    }
    await writeLinks(state);
  }

  return { mode: "applied", calls, pending, links: state };
}

export function formatDryRun(plan, result) {
  const lines = [
    `${plan.slack.workspaceName} (${plan.slack.workspaceDomain})`,
    plan.useCase,
    "",
    "Linnea's channels:",
    ...plan.linneaChannels.map((name) => `- #${name}`),
    "",
    "Slack calls:",
  ];
  for (const call of result.calls) {
    const where = call.body.team_name || call.body.name || call.body.title || call.body.channel || call.id;
    lines.push(`- ${call.method} ${where} as ${call.token}`);
  }
  lines.push("", "Staged lines:");
  const byAuthor = new Map();
  for (const message of plan.stagedMessages) {
    if (!byAuthor.has(message.author)) byAuthor.set(message.author, []);
    byAuthor.get(message.author).push(message);
  }
  for (const [author, messages] of byAuthor) {
    lines.push(`# ${author}`);
    for (const message of messages) {
      const thread = message.thread ? ` (thread on ${message.thread})` : "";
      lines.push(`- #${message.channel}${thread}`);
      lines.push(message.text);
    }
  }
  lines.push("", "Talk track:");
  for (const step of plan.talkTrack) {
    lines.push(`- ${step.label} · ${step.show}: ${step.say}`);
  }
  lines.push("", "Live lines, not seeded:");
  for (const reply of plan.readyReplies) {
    lines.push(`- ${reply.author} in #${reply.channel}: ${reply.text}`);
  }
  if (plan.slackbot) {
    lines.push("", `Slackbot, typed by ${plan.slackbot.who}: ${plan.slackbot.prompt}`);
  }
  lines.push("", "Still manual:");
  for (const step of plan.manualSteps) {
    lines.push(`- ${step.title}`);
  }
  return lines.join("\n");
}

async function main() {
  const catalog = JSON.parse(readFileSync(path.join(root, "demos/manual-gates.json"), "utf8"));
  const plan = buildPlan(NORRHEM_INPUT, catalog);
  const apply = process.argv.includes("--apply");
  const linksPath = path.join(root, "demos", `${plan.id}.links.json`);
  let links = null;
  if (!process.argv.includes("--fresh")) {
    try {
      links = JSON.parse(readFileSync(linksPath, "utf8"));
    } catch {
      links = null;
    }
  }
  const result = await runSeed({
    plan,
    env: process.env,
    apply,
    links,
    writeLinks: (state) => writeFileSync(linksPath, `${JSON.stringify(state, null, 2)}\n`),
  });
  console.log(formatDryRun(plan, result));
  if (result.mode === "blocked") {
    const gate = plan.manualSteps.find((step) => step.id === result.gateId);
    console.error(`\n${gate.title}\n${gate.detail}`);
    process.exitCode = 1;
    return;
  }
  if (result.pending.length) {
    console.log("\nNot sent, token missing:");
    for (const item of result.pending) {
      console.log(`- ${item.id} needs ${item.token}${item.reason ? ` (${item.reason})` : ""}`);
    }
  }
  console.log(`\n${result.mode}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
