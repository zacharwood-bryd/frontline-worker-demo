/**
 * Turns a frontline brief into the manual steps and the Slack workspace the agent seeds.
 * Gate ids match demos/manual-gates.json. There is no Salesforce step.
 */

import { NORRHEM_INPUT } from "./norrhem.mjs";

export { NORRHEM_INPUT };

export const FRONTLINE_CHANNEL_CAP = 10;
const REQUIRED_WORKFLOWS = ["induction", "issue", "handover", "acknowledge"];
const MANUAL_IDS = [
  "install-slack-app",
  "slack-token",
  "frontline-accounts",
  "workflows",
  "stage-personas",
  "fallback-recording",
];

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function beatsFrom(value) {
  if (Array.isArray(value)) {
    return value
      .map((beat) => {
        if (beat && typeof beat === "object") {
          return {
            surface: String(beat.surface || "Slack").trim(),
            text: String(beat.text || "").trim(),
            say: String(beat.say || beat.text || "").trim(),
          };
        }
        const text = String(beat).trim();
        return { surface: "Slack", text, say: text };
      })
      .filter((beat) => beat.text);
  }
  return String(value || "")
    .split(/\n+/)
    .map((beat) => beat.replace(/^\s*(?:\d+[\).\]]\s*|[-*]\s*)/, "").trim())
    .filter(Boolean)
    .map((text) => ({ surface: "Slack", text, say: text }));
}

function gate(catalog, id) {
  const gates = catalog?.gates || catalog || [];
  const found = gates.find((item) => item.id === id);
  if (!found) throw new Error(`Missing manual gate: ${id}`);
  return { id: found.id, title: found.title, detail: found.detail };
}

function sentence(value) {
  const text = String(value).trim();
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function peopleById(input) {
  const people = [...(input.cast || []), ...(input.people || [])];
  return new Map(people.map((person) => [person.id, person]));
}

function acknowledgeBlocks(link) {
  return [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Acknowledge" },
          url: link,
          action_id: "acknowledge_price_change",
        },
      ],
    },
  ];
}

export function buildPlan(input, catalog) {
  const industry = String(input.industry || "").trim();
  const useCase = String(input.useCase || "").trim();
  const company = String(input.company || "").trim() || `${industry} sample workspace`;
  const beats = beatsFrom(input.beats);
  const cast = input.cast || [];
  const channels = input.channels || [];
  const workflows = input.workflows || [];
  if (!industry) throw new Error("Industry is required.");
  if (!useCase) throw new Error("Use case is required.");
  if (beats.length < 2) throw new Error("Add at least two beats, one per line.");
  if (cast.length < 1) throw new Error("Cast is required.");

  const id = slugify(input.id || `${industry} ${company}`);
  if (!id) throw new Error("Could not make an id from this brief.");
  const workspaceDomain = id.slice(0, 21).replace(/-+$/g, "");
  if (!workspaceDomain || workspaceDomain.length > 21) {
    throw new Error("Workspace domain must be 1 to 21 characters.");
  }

  const names = new Set();
  for (const channel of channels) {
    if (!/^[a-z0-9-]{1,80}$/.test(channel.name)) {
      throw new Error(`Channel name is not Slack-safe: ${channel.name}`);
    }
    if (names.has(channel.name)) throw new Error(`Duplicate channel: ${channel.name}`);
    names.add(channel.name);
  }

  const linnea = cast.find((person) => person.id === "linnea") || cast[0];
  const linneaChannels = channels.filter((channel) => channel.linnea).map((channel) => channel.name);
  if (linnea.channels) {
    const expected = linnea.channels.join(",");
    if (linneaChannels.join(",") !== expected) {
      throw new Error("Linnea's channel list does not match the channels marked for her.");
    }
  }
  if (linneaChannels.length > FRONTLINE_CHANNEL_CAP) {
    throw new Error(`A Frontline Member can have at most ${FRONTLINE_CHANNEL_CAP} channels.`);
  }

  const workflowIds = new Set(workflows.map((item) => item.id));
  for (const required of REQUIRED_WORKFLOWS) {
    if (!workflowIds.has(required)) throw new Error(`Missing workflow: ${required}`);
  }

  const knownPeople = peopleById(input);
  const acknowledge = workflows.find((item) => item.id === "acknowledge");
  const stagedMessages = (input.history || []).map((message) => {
    if (!names.has(message.channel)) throw new Error(`Unknown channel on ${message.id}: ${message.channel}`);
    if (!knownPeople.has(message.author)) throw new Error(`Unknown author on ${message.id}: ${message.author}`);
    const copy = {
      id: message.id,
      author: message.author,
      channel: message.channel,
      kind: message.kind || "history",
      text: message.text,
    };
    if (message.thread) copy.thread = message.thread;
    if (copy.kind === "price-change" && acknowledge?.link) {
      copy.blocks = acknowledgeBlocks(acknowledge.link);
    }
    return copy;
  });

  const bookmarks = workflows
    .filter((item) => item.bookmark)
    .map((item) => ({
      title: item.title,
      channel: item.channel,
      emoji: item.emoji || ":bookmark:",
      link: item.link || null,
    }));

  const tag = `frontline-demo:${id}`;
  const gates = MANUAL_IDS.map((item) => gate(catalog, item));
  const canvas = {
    owner: input.canvas.owner,
    channel: input.canvas.channel,
    title: input.canvas.title,
    markdown: input.canvas.markdown,
  };

  const agentSteps = [
    {
      id: "confirm-grid",
      title: "Confirm the Enterprise Grid org",
      detail:
        "Use the Slack Enterprise+ org with the Frontline add-on. Create a new workspace on that org. This demo is Slack only.",
    },
    {
      id: "slack-surface",
      title: `Workspace ${company}`,
      detail: `Create a workspace named ${company} with admin.teams.create. Use team_domain ${workspaceDomain}. The app is already installed on the Enterprise Grid org and granted to new workspaces. Pass the new workspace id as team_id on later calls.`,
    },
    {
      id: "channels",
      title: "Create the channels",
      detail: `Create ${channels.length} channels with admin.conversations.create in the new workspace. Linnea's home is ${linneaChannels.join(", ")}. She is not a member of the other store channels.`,
    },
    {
      id: "canvas",
      title: "Add Morgan's onboarding canvas",
      detail: `Create the canvas "${canvas.title}" with canvases.create as Morgan, tabbed into #${canvas.channel}. Frontline Members can open a canvas a Full Member shares. They do not create one.`,
    },
    {
      id: "stage-history",
      title: "Post the staged history",
      detail:
        "Post each staged message with that person's user token. Thread the store acknowledgements under Harry's price-change message. Leave Linnea's moved reply unsent.",
    },
    {
      id: "bookmarks",
      title: "Bookmark the three workflows",
      detail:
        "When the Workflow Builder links exist, bookmarks.add Complete my induction in #onboarding, Report an issue in #food-safety, and End-of-shift handover in #store-uppsala. Acknowledge stays a button on the price-change message.",
    },
    {
      id: "save-spec",
      title: "Save the spec",
      detail: `Write this plan to demos/${id}.json. Put the Slack workspace id, channel ids, and message timestamps only in demos/${id}.links.json.`,
    },
    {
      id: "handoff",
      title: "Hand off the live demo",
      detail: `Stop here. ${company} opens with Linnea already in Slack. Do not run an admin invite on stage, and do not start a huddle.`,
    },
  ];

  const steps = beats.map((beat, index) => ({
    label: `Beat ${index + 1}`,
    show: beat.surface,
    say: sentence(beat.say),
  }));
  const managerAt = steps.findIndex((item) => item.show === "Manager");
  const hqAt = steps.findIndex((item) => item.show === "HQ");
  if (managerAt < 0 || hqAt < 0 || hqAt < managerAt) {
    throw new Error("Talk track is missing the manager or HQ beat.");
  }
  const talkTrack = [
    ...steps.slice(0, managerAt),
    {
      label: "Switch",
      show: "Morgan on desktop",
      say: "Now let's see what that looks like for her store manager.",
    },
    steps[managerAt],
    ...steps.slice(managerAt + 1, hqAt),
    {
      label: "Switch",
      show: "Harry on desktop",
      say: "And at HQ, with 40 stores, Harry needs the bigger picture.",
    },
    ...steps.slice(hqAt),
    {
      label: "Close",
      show: "Spoken close",
      say: "One Enterprise+ security layer covers the whole workforce, with up to 10 channels per worker, accounts that expire for seasonal staff, and SCIM provisioning. The Bryd fixed-scope Frontline launch includes the Enterprise+ migration where it is needed, with a December start.",
    },
  ];

  return {
    id,
    title: company,
    industry,
    company,
    useCase,
    beats: beats.map((beat) => beat.text),
    cast,
    people: input.people || [],
    channels,
    linneaChannels,
    storyScale: input.storyScale || null,
    slack: {
      mode: "workspace",
      workspaceName: company,
      workspaceDomain,
      story: [company, sentence(useCase), ...beats.map((beat, index) => `${index + 1}. ${sentence(beat.text)}`)].join("\n"),
    },
    canvas,
    workflows,
    bookmarks,
    stagedMessages,
    readyReplies: input.readyReplies || [],
    slackbot: input.slackbot || null,
    notInLiveDemo: ["A live huddle", "An admin invite"],
    limits: [
      "Frontline Members cannot use Slackbot, create canvases or lists, or start huddles.",
      "Frontline Members can run workflows and open content a Full Member shares in their channels.",
      "Slackbot stays on Harry's side.",
      "Do not show or claim QR sign-in, native shift scheduling, or off-shift blocking.",
    ],
    checks: [
      "The Frontline add-on is on, and Linnea is a Frontline Member.",
      "Acknowledge and the three bookmarked workflows work as Linnea on a phone.",
      "Linnea can open the onboarding canvas on a phone.",
      "Beat 1 is pre-recorded as a fallback.",
      "Morgan and Harry use separate Chrome profiles, and phone mirroring has been tested.",
    ],
    manualSteps: gates,
    agentSteps,
    talkTrack,
    tag,
  };
}
