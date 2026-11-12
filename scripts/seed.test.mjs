import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NORRHEM_INPUT, buildPlan } from "./plan.mjs";
import { formatDryRun, plusAddress, runSeed, seedCalls, tokenName } from "./seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "demos/manual-gates.json"), "utf8"));
const plan = buildPlan(NORRHEM_INPUT, catalog);
const calls = seedCalls(plan);
const allowed = new Set([
  "admin.teams.create",
  "admin.conversations.create",
  "canvases.create",
  "chat.postMessage",
  "bookmarks.add",
]);

assert.deepEqual(calls.map((call) => call.method).filter((method, index, all) => all.indexOf(method) === index), [
  "admin.teams.create",
  "admin.conversations.create",
  "canvases.create",
  "chat.postMessage",
]);
for (const call of calls) assert.ok(allowed.has(call.method));
assert.equal(calls.some((call) => call.method === "bookmarks.add"), false);
assert.equal(calls.find((call) => call.id === "canvas").token, "sam");
assert.equal(plusAddress("owner@example.com", "sam"), "owner+sam@example.com");
assert.equal(plusAddress("owner+old@example.com", "alex"), "owner+alex@example.com");
assert.equal(
  calls.some((call) => call.method === "chat.postMessage" && String(call.body.text).includes("Fridge 4 is at 3°C")),
  false,
);
assert.equal(calls.find((call) => call.id === "gavle-ack").body.thread_ts, "{{ts:gavle-price}}");
assert.equal(tokenName("admin"), "SLACK_ADMIN_TOKEN");
assert.equal(tokenName("alex"), "SLACK_TOKEN_ALEX");

const dry = await runSeed({ plan, env: {}, apply: false, fetch: () => { throw new Error("dry-run called Slack"); } });
assert.equal(dry.mode, "dry-run");
assert.match(formatDryRun(plan, dry), /Norrhem Livs \(norrhem-livs\)/);
const sheet = formatDryRun(plan, dry);
assert.match(sheet, /Live lines, not seeded:/);
assert.match(sheet, /Acknowledged\. New labels are up\./);
assert.match(sheet, /08:45 · Weekend prices/);
assert.match(formatDryRun(plan, dry), /Moved\. Fridge 4 is at 3°C/);

const blocked = await runSeed({
  plan,
  env: {},
  apply: true,
  fetch: () => { throw new Error("blocked seed called Slack"); },
});
assert.equal(blocked.mode, "blocked");
assert.equal(blocked.gateId, "slack-token");

function fakeFetch(sent) {
  return async (url, options) => {
    const method = url.split("/api/")[1];
    const body = JSON.parse(options.body);
    sent.push({ method, body, authorization: options.headers.Authorization });
    if (method === "admin.teams.create") return { json: async () => ({ ok: true, team: "T1" }) };
    if (method === "admin.conversations.create") {
      return { json: async () => ({ ok: true, channel_id: `C_${body.name}` }) };
    }
    if (method === "canvases.create") return { json: async () => ({ ok: true, canvas_id: "F1" }) };
    if (method === "chat.postMessage") {
      return { json: async () => ({ ok: true, ts: `${sent.length}.000100` }) };
    }
    return { json: async () => ({ ok: false, error: "unexpected_method" }) };
  };
}

const adminOnly = [];
const adminEnv = { SLACK_ADMIN_TOKEN: "xoxp-admin" };
const writes = [];
const partial = await runSeed({
  plan,
  env: adminEnv,
  apply: true,
  fetch: fakeFetch(adminOnly),
  writeLinks: (state) => writes.push(structuredClone(state)),
});
assert.equal(partial.mode, "applied");
assert.deepEqual(adminOnly.map((call) => call.method), ["admin.teams.create", ...plan.channels.map(() => "admin.conversations.create")]);
assert.equal(partial.links.teamId, "T1");
assert.equal(partial.links.channels["store-uppsala"], "C_store-uppsala");
assert.equal(partial.links.canvasId, null);
assert.ok(partial.pending.some((item) => item.id === "canvas" && item.token === "SLACK_TOKEN_SAM"));
assert.equal(JSON.stringify(partial.links).includes("xoxp-admin"), false);
assert.equal(writes.at(-1).teamId, "T1");

const people = ["sam", "jordan", "riley", "casey", "jamie", "alex"];
const fullEnv = { SLACK_ADMIN_TOKEN: "xoxp-admin" };
for (const person of people) fullEnv[tokenName(person)] = `xoxp-${person}`;
const sent = [];
const applied = await runSeed({
  plan,
  env: fullEnv,
  apply: true,
  fetch: fakeFetch(sent),
  writeLinks: () => {},
});
assert.equal(applied.pending.length, 0);
assert.equal(applied.links.canvasId, "F1");
const canvasCall = sent.find((call) => call.method === "canvases.create");
assert.equal(canvasCall.authorization, "Bearer xoxp-sam");
assert.equal(canvasCall.body.channel_id, "C_onboarding");
assert.equal(canvasCall.body.document_content.type, "markdown");
const gavlePrice = sent.find((call) => call.method === "chat.postMessage" && call.body.text.startsWith("08:45") && call.body.channel === "C_store-gavle");
const gavleAck = sent.find((call) => call.method === "chat.postMessage" && call.body.text === "Acknowledged. New labels are up.");
assert.equal(gavleAck.authorization, "Bearer xoxp-riley");
assert.equal(gavleAck.body.thread_ts, gavlePrice.ts || applied.links.messages["gavle-price"]);
assert.equal(gavleAck.body.thread_ts, applied.links.messages["gavle-price"]);
assert.equal(sent.some((call) => JSON.stringify(call.body).includes("xoxp-")), false);

const again = [];
const rerun = await runSeed({
  plan,
  env: fullEnv,
  apply: true,
  links: applied.links,
  fetch: fakeFetch(again),
  writeLinks: () => {},
});
assert.equal(again.length, 0);
assert.equal(rerun.links.teamId, "T1");

const broken = [];
await assert.rejects(
  () => runSeed({
    plan,
    env: adminEnv,
    apply: true,
    links: { teamId: "T9", channels: {}, messages: {}, posted: [], bookmarks: {} },
    fetch: async () => ({ json: async () => ({ ok: false, error: "missing_scope" }) }),
    writeLinks: (state) => broken.push(state.teamId),
  }),
  /admin\.conversations\.create failed: missing_scope/,
);
assert.equal(broken.at(-1), "T9");
assert.equal(JSON.stringify(broken).includes("xoxp"), false);

const invited = [];
const withPlus = await runSeed({
  plan,
  env: { SLACK_ADMIN_TOKEN: "xoxp-admin", SLACK_PLUS_EMAIL: "owner@example.com" },
  apply: true,
  links: {
    teamId: "T1",
    channels: Object.fromEntries(plan.channels.map((channel) => [channel.name, `C_${channel.name}`])),
    messages: {},
    posted: [],
    bookmarks: {},
    invites: {},
  },
  fetch: async (url, options) => {
    const method = url.split("/api/")[1];
    const body = JSON.parse(options.body);
    invited.push({ method, body });
    if (method === "admin.users.invite" && body.email === "owner+jamie@example.com") {
      return { json: async () => ({ ok: false, error: "already_in_team" }) };
    }
    if (method === "admin.users.invite") return { json: async () => ({ ok: true, user: { id: "U1" } }) };
    return { json: async () => ({ ok: false, error: "should-not-run" }) };
  },
  writeLinks: () => {},
});
assert.equal(invited.length, 6);
assert.equal(invited.every((call) => call.method === "admin.users.invite"), true);
assert.equal(invited.find((call) => call.body.email === "owner+alex@example.com").body.channel_ids.split(",").length, 5);
assert.equal(invited.find((call) => call.body.email === "owner+jordan@example.com").body.channel_ids.split(",").length, 9);
assert.equal(invited.find((call) => call.body.real_name === "Sam").body.email, "owner+sam@example.com");
assert.equal(withPlus.links.invites.sam.ok, true);
assert.equal(withPlus.links.invites.jamie.ok, true);
assert.equal(withPlus.pending.some((item) => item.id === "invite:jamie"), false);
assert.equal(JSON.stringify(withPlus.links).includes("xoxp"), false);
assert.match(formatDryRun(plan, { calls: invited.map((call) => ({ ...call, token: "admin", body: call.body })), pending: [] }), /owner\+alex@example.com/);

console.log("seed.test.mjs ok");
