import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAST_POOL } from "./cast.mjs";
import { FRONTLINE_CHANNEL_CAP, NORTHPEAK_INPUT, buildPlan } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "demos/manual-gates.json"), "utf8"));
const plan = buildPlan(NORTHPEAK_INPUT, catalog);

assert.equal(plan.id, "northpeak-outdoor");
assert.equal(plan.slack.mode, "workspace");
assert.equal(plan.slack.workspaceName, "Northpeak Outdoor");
assert.equal(plan.slack.workspaceDomain, "northpeak-outdoor");
assert.ok(plan.slack.workspaceDomain.length <= 21);
assert.deepEqual(plan.frontlineChannels, ["onboarding-alex", "store-stockholm", "announcements"]);
assert.ok(plan.frontlineChannels.length <= FRONTLINE_CHANNEL_CAP);
assert.equal(plan.frontlineChannels.includes("nordics-stock-requests"), false);
assert.equal(plan.cast.find((person) => person.id === "alex").account, "Frontline Member");
assert.equal(plan.cast.find((person) => person.id === "alex").device, "Phone");
assert.equal(plan.storyScale.storesInTheChain, 60);

assert.deepEqual(
  plan.manualSteps.map((step) => step.id),
  ["install-slack-app", "slack-token", "frontline-accounts", "workflows", "stage-personas", "fallback-recording"],
);
assert.deepEqual(
  [...new Set(plan.workflows.filter((item) => item.bookmark).map((item) => item.title))],
  ["I've read the guide", "Report low stock"],
);
assert.equal(plan.bookmarks.filter((item) => item.title === "Report low stock").length, 5);

const promoChannels = ["store-stockholm", "store-gothenburg", "store-oslo", "store-copenhagen", "store-helsinki"];
for (const name of promoChannels) {
  const promos = plan.stagedMessages.filter((message) => message.channel === name && message.kind === "promo");
  assert.equal(promos.length, 1);
  assert.match(promos[0].text, /30% off/);
  assert.equal(promos[0].author, "jordan");
}
assert.equal(plan.stagedMessages.filter((message) => message.channel === "onboarding-alex").length, 1);
assert.match(plan.stagedMessages.find((message) => message.id === "welcome").text, /Welcome to Northpeak, Alex/);
assert.equal(plan.stagedMessages.filter((message) => message.kind === "report" && message.postAs === "Northpeak Reports").length, 6);
assert.match(plan.stagedMessages.find((message) => message.id === "report-stock").text, /Stockholm: 0 \/ 2/);
assert.equal(plan.stagedMessages.some((message) => /\bkr\b/i.test(message.text)), false);
assert.match(plan.readyReplies.find((reply) => reply.id === "jordan-transfer").text, /transferring from Copenhagen/);

const shows = plan.talkTrack.map((step) => step.show);
assert.deepEqual(shows, [
  "Home",
  "Onboarding",
  "Promo",
  "Low stock",
  "Sam on desktop",
  "Manager",
  "Store performance",
  "Jordan on desktop",
  "HQ",
  "Transfer",
  "Spoken close",
]);
assert.match(plan.talkTrack[0].say, /started this week/);
assert.match(plan.talkTrack[3].say, /backroom is empty/);
assert.match(plan.talkTrack[4].say, /store manager/);
assert.match(plan.talkTrack[5].say, /who to chase/);
assert.match(plan.talkTrack[7].say, /60 stores/);
assert.match(plan.talkTrack[9].say, /empty rail/);
assert.equal(plan.slackbot.prompts.length, 2);
assert.match(plan.slackbot.prompts[0].prompt, /How did Stockholm perform/);
assert.match(plan.slackbot.prompts[1].prompt, /surplus/);
assert.deepEqual(plan.notInLiveDemo, ["A live huddle", "An admin invite"]);
assert.equal(plan.canvas.owner, "sam");
assert.match(plan.canvas.markdown, /Black Friday playbook/);
assert.equal(plan.list.rows.length, 6);
assert.equal(plan.list.rows[0][2], "");
assert.equal(plan.agentSteps.some((step) => step.id === "handoff"), true);
assert.match(plan.agentSteps.find((step) => step.id === "slack-surface").detail, /existing workspace/);

const saved = JSON.parse(readFileSync(path.join(root, "demos/northpeak-outdoor.json"), "utf8"));
assert.deepEqual(saved, plan);

const renamed = structuredClone(NORTHPEAK_INPUT);
renamed.id = "other-chain";
renamed.company = "Other Chain";
assert.equal(buildPlan(renamed, catalog).slack.workspaceName, "Other Chain");
assert.equal(buildPlan(renamed, catalog).slack.workspaceDomain, "other-chain");

const unnamed = structuredClone(NORTHPEAK_INPUT);
unnamed.company = "";
unnamed.id = "outdoor-sample";
assert.equal(buildPlan(unnamed, catalog).company, "Sports and outdoor retail sample workspace");

assert.throws(() => buildPlan({ industry: "", useCase: "x", beats: ["a", "b"], cast: [{}] }, catalog), /Industry is required/);
assert.throws(() => buildPlan({ ...NORTHPEAK_INPUT, cast: [] }, catalog), /Cast is required/);

const tooMany = structuredClone(NORTHPEAK_INPUT);
tooMany.cast = structuredClone(tooMany.cast);
tooMany.cast[0] = { ...tooMany.cast[0], channels: Array.from({ length: 11 }, (_, index) => `extra-${index}`) };
tooMany.channels = tooMany.cast[0].channels.map((name) => ({ name, purpose: "Extra", frontline: true }));
tooMany.history = [];
assert.throws(() => buildPlan(tooMany, catalog), /at most 10/);

const haystack = JSON.stringify(plan).toLowerCase();
assert.equal(haystack.includes("salesforce"), false);
assert.equal(haystack.includes("apex"), false);
assert.equal(haystack.includes("named credential"), false);
assert.equal(haystack.includes("admin.teams.create"), false);
assert.match(haystack, /existing workspace/);
assert.match(haystack, /do not run an admin invite/);
assert.equal(haystack.includes("morgan"), false);
assert.equal(haystack.includes("harry"), false);
const speakers = [...plan.cast, ...plan.people];
assert.deepEqual(speakers.map((person) => person.id), CAST_POOL.map((person) => person.id));
for (const person of speakers) {
  assert.equal(person.name, CAST_POOL.find((seat) => seat.id === person.id).name);
  assert.equal(person.account === "Frontline Member" || person.account === "Full Member", true);
  assert.ok(person.channels.length > 0);
}

console.log("plan.test.mjs ok");
