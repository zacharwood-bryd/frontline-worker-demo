# Frontline demo

You are the coding agent. The story is fixed: Norrhem Livs, a fictional Nordic grocery chain, in a new Slack Enterprise Grid workspace. Zac presents it. Linnea is the store associate, Morgan is the store manager, and Harry is regional ops.

This demo is Slack only. You do not create Salesforce records, and you do not connect Slack to Salesforce.

Do not build a website. Do not build a Slack bot that replies to people. Do not reuse an existing workspace. The app in `slack/manifest.json` creates the workspace and stages it. People do not message that app.

The human instructions are in `README.md`. Gate text is in `demos/manual-gates.json`. The brief is `NORRHEM_INPUT` in `scripts/norrhem.mjs`. Build the plan with `scripts/plan.mjs`:

```bash
node --input-type=module -e "
import { buildPlan, NORRHEM_INPUT } from './scripts/plan.mjs';
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('demos/manual-gates.json','utf8'));
console.log(JSON.stringify(buildPlan(NORRHEM_INPUT, catalog), null, 2));
"
```

Check the planner and the seeder:

```bash
node scripts/plan.test.mjs
node scripts/seed.test.mjs
```

See the run of show without calling Slack:

```bash
node scripts/seed.mjs
```

## Before any write

1. Confirm the workspace app is installed on the Enterprise Grid org and granted to future workspaces. If it is not, print the `install-slack-app` gate and stop.
2. You need `SLACK_ADMIN_TOKEN` in the environment, an org-admin user token that can call `admin.teams.create`. If it is missing, print the `slack-token` gate and stop.
3. Persona lines post as that person. `SLACK_TOKEN_MORGAN` creates the canvas. `SLACK_TOKEN_HARRY`, `SLACK_TOKEN_ERIK`, and the other names in the gate post their own lines. If a persona token is missing, leave that line in the pending list and print the `stage-personas` gate. Do not post those lines as someone else.

## New workspace

The plan names the workspace Norrhem Livs and sets `team_domain` to `norrhem-livs`.

1. `admin.teams.create` with `team_name` and `team_domain` from the plan. Save the returned team id.
2. `admin.conversations.create` for every channel, with that team id. Linnea's five channels are `#store-uppsala`, `#region-mitt`, `#food-safety`, `#announcements`, and `#onboarding`.
3. `canvases.create` as Morgan, tabbed into `#onboarding`.
4. `chat.postMessage` for each staged message, as the author on that message. Thread Gävle and Västerås acknowledgements under Harry's price-change message in that store channel.
5. Leave the ready replies unsent. Linnea's "Moved. Fridge 4 is at 3°C." waits until Morgan has replied in the fridge thread.
6. Bookmark the three workflows when their links are in the brief. Acknowledge is a button on the price-change message, not a bookmark.

If a call returns `not_in_channel`, `channel_not_found`, or `no_local_user_on_team`, the person is not in that new workspace yet. Add them to the workspace and the channel, then run the seed again. The links file keeps the workspace id.

Apply that sequence with:

```bash
node scripts/seed.mjs --apply
```

The command writes `demos/norrhem-livs.links.json`. That file is gitignored. A second apply reuses the saved workspace.

## What stays manual

Frontline membership, the five-channel assignment, the `@facilities` group, Workflow Builder, phone mirroring, and the Beat 1 fallback recording are gates. Print any gate that is still open. The live demo starts with Linnea already in Slack.

## Save

`demos/norrhem-livs.json` is the plan from `buildPlan`. Regenerate it when the brief changes, and keep it equal to the planner output. Record ids belong in the links file only.

## Never

- Create a Salesforce record, object, flow, named credential, or connector.
- Add a slash command, an app home conversation, or a bot people talk to.
- Build a web app for the brief.
- Put the demo in a workspace that already existed.
- Call the Slack API as a bot that replies to something a person just said. The seed posts the staged script once.
- Start a huddle, or run an admin invite, during the demo.
- Show or claim QR sign-in, native shift scheduling, or off-shift blocking.
- Put a token, a workspace id, or a message timestamp into a committed file.
- Give Linnea more than 10 channels, or put her in the other store channels.
- Let Linnea use Slackbot. The summary is Harry's.
