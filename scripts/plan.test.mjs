import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAST_POOL } from "./cast.mjs";
import { FRONTLINE_CHANNEL_CAP, NORRHEM_INPUT, buildPlan } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "demos/manual-gates.json"), "utf8"));
const plan = buildPlan(NORRHEM_INPUT, catalog);

assert.equal(plan.id, "norrhem-livs");
assert.equal(plan.slack.mode, "workspace");
assert.equal(plan.slack.workspaceName, "Norrhem Livs");
assert.equal(plan.slack.workspaceDomain, "norrhem-livs");
assert.ok(plan.slack.workspaceDomain.length <= 21);
assert.deepEqual(plan.frontlineChannels, [
  "store-uppsala",
  "region-mitt",
  "food-safety",
  "announcements",
  "onboarding",
]);
assert.ok(plan.frontlineChannels.length <= FRONTLINE_CHANNEL_CAP);
assert.equal(plan.frontlineChannels.includes("store-gavle"), false);
assert.equal(plan.cast.find((person) => person.id === "alex").account, "Frontline Member");
assert.equal(plan.cast.find((person) => person.id === "alex").device, "Phone");

assert.deepEqual(
  plan.manualSteps.map((step) => step.id),
  ["install-slack-app", "slack-token", "frontline-accounts", "workflows", "stage-personas", "fallback-recording"],
);
assert.deepEqual(
  plan.workflows.filter((item) => item.bookmark).map((item) => item.title),
  ["Complete my induction", "Report an issue", "End-of-shift handover"],
);
assert.equal(plan.workflows.find((item) => item.id === "acknowledge").button, true);
assert.equal(plan.workflows.find((item) => item.id === "acknowledge").bookmark, false);

const priceChannels = ["store-uppsala", "store-gavle", "store-vasteras", "store-sundsvall", "store-orebro"];
for (const name of priceChannels) {
  const prices = plan.stagedMessages.filter((message) => message.channel === name && message.kind === "price-change");
  assert.equal(prices.length, 1);
  assert.match(prices[0].text, /08:45/);
  assert.equal(prices[0].author, "jordan");
  assert.equal(prices[0].blocks, undefined);
}
assert.equal(
  plan.stagedMessages.some((message) => message.channel === "store-uppsala" && message.kind === "acknowledgement"),
  false,
);
assert.equal(
  plan.stagedMessages.some((message) => message.channel === "store-sundsvall" && message.kind === "acknowledgement"),
  false,
);
assert.ok(plan.stagedMessages.some((message) => message.id === "gavle-ack" && message.thread === "gavle-price"));
assert.equal(
  plan.stagedMessages.some((message) => message.text.includes("Fridge 4 is at 3°C")),
  false,
);
assert.match(plan.readyReplies.find((reply) => reply.id === "alex-stock-moved").text, /Fridge 4 is at 3°C/);

const shows = plan.talkTrack.map((step) => step.show);
assert.deepEqual(shows, [
  "Home",
  "Canvas and workflow",
  "Acknowledge",
  "Report an issue",
  "Handover",
  "Sam on desktop",
  "Manager",
  "Jordan on desktop",
  "HQ",
  "Spoken close",
]);
assert.match(plan.talkTrack[0].say, /No company email/);
assert.match(plan.talkTrack[2].say, /08:45/);
assert.match(plan.talkTrack[5].say, /store manager/);
assert.match(plan.talkTrack[6].say, /WhatsApp/);
assert.match(plan.talkTrack[6].say, /Nothing gets lost between shifts/);
assert.match(plan.talkTrack[7].say, /40 stores/);
assert.match(plan.talkTrack[8].say, /AI-level visibility/);
assert.match(plan.slackbot.prompt, /food-safety issues and shift handovers/);
assert.deepEqual(plan.notInLiveDemo, ["A live huddle", "An admin invite"]);
assert.equal(plan.canvas.owner, "sam");
assert.match(plan.canvas.markdown, /Cold chain/);
assert.equal(plan.agentSteps.some((step) => step.id === "handoff"), true);
assert.match(plan.agentSteps.find((step) => step.id === "slack-surface").detail, /admin\.teams\.create/);

const saved = JSON.parse(readFileSync(path.join(root, "demos/norrhem-livs.json"), "utf8"));
assert.deepEqual(saved, plan);

const withButton = structuredClone(NORRHEM_INPUT);
withButton.workflows.find((item) => item.id === "acknowledge").link = "https://slack.com/shortcuts/ack";
const buttonPlan = buildPlan(withButton, catalog);
const uppsalaPrice = buttonPlan.stagedMessages.find((message) => message.id === "uppsala-price");
assert.equal(uppsalaPrice.blocks[0].elements[0].text.text, "Acknowledge");
assert.equal(uppsalaPrice.blocks[0].elements[0].url, "https://slack.com/shortcuts/ack");
assert.equal(buttonPlan.bookmarks.find((item) => item.title === "Complete my induction").link, null);

const renamed = structuredClone(NORRHEM_INPUT);
renamed.id = "other-chain";
renamed.company = "Other Chain";
assert.equal(buildPlan(renamed, catalog).slack.workspaceName, "Other Chain");
assert.equal(buildPlan(renamed, catalog).slack.workspaceDomain, "other-chain");

const unnamed = structuredClone(NORRHEM_INPUT);
unnamed.company = "";
unnamed.id = "grocery-sample";
assert.equal(buildPlan(unnamed, catalog).company, "Grocery retail sample workspace");

assert.throws(() => buildPlan({ industry: "", useCase: "x", beats: ["a", "b"], cast: [{}] }, catalog), /Industry is required/);
assert.throws(() => buildPlan({ ...NORRHEM_INPUT, cast: [] }, catalog), /Cast is required/);

const tooMany = structuredClone(NORRHEM_INPUT);
tooMany.cast = structuredClone(tooMany.cast);
tooMany.cast[0] = { ...tooMany.cast[0], channels: Array.from({ length: 11 }, (_, index) => `extra-${index}`) };
tooMany.channels = tooMany.cast[0].channels.map((name) => ({ name, purpose: "Extra", frontline: true }));
tooMany.history = [];
assert.throws(() => buildPlan(tooMany, catalog), /at most 10/);

const haystack = JSON.stringify(plan).toLowerCase();
assert.equal(haystack.includes("salesforce"), false);
assert.equal(haystack.includes("apex"), false);
assert.equal(haystack.includes("named credential"), false);
assert.match(haystack, /admin\.teams\.create/);
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
