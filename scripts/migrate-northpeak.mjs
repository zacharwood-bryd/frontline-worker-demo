/**
 * Move the existing Norrhem Livs workspace onto the Northpeak Outdoor story.
 * Reuses the workspace. Does not create Slack users.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NORTHPEAK_INPUT, buildPlan } from "./plan.mjs";
import { runSeed } from "./seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const teamId = "T0CGQ9Z3PAR";
const oldLinksPath = path.join(root, "demos", "norrhem-livs.links.json");
const linksPath = path.join(root, "demos", "northpeak-outdoor.links.json");

const PEOPLE = {
  alex: "U0CH51S109F",
  sam: "U0CH51SDF97",
  jordan: "U0CGN551SF9",
  riley: "U0CGN6SJ895",
  casey: "U0CHXUWHFEC",
  jamie: "U0CHXUWHEJC",
};

const ARCHIVE = ["region-mitt", "food-safety", "onboarding", "store-gavle", "store-vasteras", "store-sundsvall", "store-orebro"];
const RENAME = { from: "store-uppsala", to: "store-stockholm" };
const OLD_WORKFLOWS = ["Wf0CH3PQ3B26", "Wf0CH7U06MPW", "Wf0CGZ6VDP9B"];

function slackJson(token, method, body) {
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  }).then((response) => response.json());
}

function slack(token, method, body) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, value && typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  }).then((response) => response.json());
}

function tokenFor(env, personId) {
  return env[`SLACK_TOKEN_${personId.toUpperCase()}`];
}

async function listChannels(admin) {
  const found = new Map();
  let cursor;
  do {
    const data = await slack(admin, "conversations.list", {
      team_id: teamId,
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: false,
      cursor,
    });
    if (!data.ok) throw new Error(`conversations.list failed: ${data.error}`);
    for (const channel of data.channels || []) found.set(channel.name, channel);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return found;
}

async function clearPeople(admin, env, channelId) {
  let cursor;
  do {
    const data = await slack(admin, "conversations.history", { channel: channelId, limit: 200, cursor });
    if (!data.ok) {
      console.log("history", channelId, data.error);
      return;
    }
    for (const message of data.messages || []) {
      if (message.subtype || !message.user || !message.ts) continue;
      const personId = Object.entries(PEOPLE).find(([, id]) => id === message.user)?.[0];
      if (!personId) continue;
      const deleted = await slack(tokenFor(env, personId), "chat.delete", { channel: channelId, ts: message.ts });
      if (!deleted.ok && deleted.error !== "message_not_found") {
        console.log("delete", personId, deleted.error);
      }
    }
    cursor = data.has_more ? data.response_metadata?.next_cursor : undefined;
  } while (cursor);
}

async function main() {
  const env = process.env;
  const admin = env.SLACK_ADMIN_TOKEN;
  if (!admin) throw new Error("SLACK_ADMIN_TOKEN is missing.");
  const catalog = JSON.parse(readFileSync(path.join(root, "demos/manual-gates.json"), "utf8"));
  const plan = buildPlan(NORTHPEAK_INPUT, catalog);
  let oldLinks = {};
  try {
    oldLinks = JSON.parse(readFileSync(oldLinksPath, "utf8"));
  } catch {
    oldLinks = {};
  }
  let existingLinks = {};
  try {
    existingLinks = JSON.parse(readFileSync(linksPath, "utf8"));
  } catch {
    existingLinks = {};
  }
  const alreadySeeded = (existingLinks.posted || []).includes("welcome");
  const previous = new Map(Object.entries(oldLinks.channels || {}));
  const channels = await listChannels(admin);

  const renamed = channels.get(RENAME.to) || channels.get(RENAME.from);
  if (!alreadySeeded && renamed && renamed.name !== RENAME.to) {
    const result = await slack(admin, "conversations.rename", { channel: renamed.id, name: RENAME.to });
    console.log("rename", result.ok, result.error || RENAME.to);
    if (result.ok) renamed.name = RENAME.to;
  }

  if (!alreadySeeded) {
    for (const name of ARCHIVE) {
      const channel = channels.get(name) || (previous.get(name) ? { id: previous.get(name), name } : null);
      if (!channel) continue;
      await clearPeople(admin, env, channel.id);
      const result = await slack(admin, "conversations.archive", { channel: channel.id });
      console.log("archive", name, result.ok, result.error || "");
    }

    if (renamed) await clearPeople(admin, env, renamed.id);
    const announcements = channels.get("announcements");
    if (announcements) await clearPeople(admin, env, announcements.id);
  }

  const fresh = await listChannels(admin);
  const ids = { ...(existingLinks.channels || {}) };
  if (fresh.get("store-stockholm")) ids["store-stockholm"] = fresh.get("store-stockholm").id;
  if (fresh.get("announcements")) ids.announcements = fresh.get("announcements").id;

  for (const channel of plan.channels) {
    if (ids[channel.name]) continue;
    const existing = fresh.get(channel.name);
    if (existing) {
      if (existing.is_archived) {
        const restored = await slack(admin, "conversations.unarchive", { channel: existing.id });
        console.log("unarchive", channel.name, restored.ok, restored.error || "");
      }
      ids[channel.name] = existing.id;
      continue;
    }
    const created = await slack(admin, "admin.conversations.create", {
      team_id: teamId,
      name: channel.name,
      is_private: Boolean(channel.isPrivate),
      description: channel.purpose,
    });
    console.log("create", channel.name, created.ok, created.error || created.channel_id);
    if (!created.ok) {
      const search = await slack(admin, "admin.conversations.search", {
        query: channel.name,
        team_ids: teamId,
        limit: 20,
      });
      const match = (search.conversations || []).find((item) => item.name === channel.name);
      if (!match) throw new Error(`Could not create #${channel.name}: ${created.error}`);
      ids[channel.name] = match.id;
      continue;
    }
    ids[channel.name] = created.channel_id;
  }

  const byId = Object.fromEntries(Object.entries(PEOPLE).map(([id, user]) => [user, id]));
  for (const channel of plan.channels) {
    const wanted = new Set(
      [...plan.cast, ...plan.people].filter((person) => person.channels.includes(channel.name)).map((person) => PEOPLE[person.id]),
    );
    const members = await slack(admin, "conversations.members", { channel: ids[channel.name], limit: 200 });
    if (!members.ok) {
      const invited = await slack(admin, "admin.conversations.invite", {
        channel_id: ids[channel.name],
        user_ids: [...wanted].join(","),
      });
      console.log("admin invite", channel.name, invited.ok, invited.error || "");
      continue;
    }
    const current = new Set(members.members || []);
    for (const userId of wanted) {
      if (current.has(userId)) continue;
      const invited = await slack(admin, "conversations.invite", { channel: ids[channel.name], users: userId });
      console.log("invite", byId[userId], channel.name, invited.ok, invited.error || "");
    }
    for (const userId of current) {
      if (!byId[userId] || wanted.has(userId)) continue;
      const kicked = await slack(admin, "conversations.kick", { channel: ids[channel.name], user: userId });
      console.log("kick", byId[userId], channel.name, kicked.ok, kicked.error || "");
    }
  }

  for (const person of [...plan.cast, ...plan.people]) {
    if (!person.title) continue;
    const result = await slack(admin, "users.profile.set", {
      user: PEOPLE[person.id],
      profile: { title: person.title },
    });
    console.log("title", person.name, result.ok, result.error || person.title);
  }

  const renamedWorkspace = await slack(admin, "admin.teams.settings.setName", {
    team_id: teamId,
    name: "Northpeak Outdoor",
  });
  console.log("workspace name", renamedWorkspace.ok, renamedWorkspace.error || "Northpeak Outdoor");

  const unpublished = await slackJson(admin, "admin.workflows.unpublish", { workflow_ids: OLD_WORKFLOWS });
  console.log("unpublish", unpublished.ok, unpublished.error || "");

  const links = alreadySeeded
    ? {
        ...existingLinks,
        teamId,
        channels: { ...(existingLinks.channels || {}), ...ids },
        invites: existingLinks.invites || oldLinks.invites || {},
      }
    : {
        teamId,
        teamDomain: "norrhem-livs",
        channels: ids,
        canvasId: null,
        bookmarks: {},
        messages: {},
        posted: [],
        invites: oldLinks.invites || {},
      };
  writeFileSync(linksPath, `${JSON.stringify(links, null, 2)}\n`);

  const seeded = await runSeed({
    plan,
    env,
    apply: true,
    links,
    writeLinks: (state) => writeFileSync(linksPath, `${JSON.stringify(state, null, 2)}\n`),
  });
  console.log("seed", seeded.mode, "pending", seeded.pending.length);
  for (const item of seeded.pending) console.log(" pending", item.id, item.reason || item.token);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
