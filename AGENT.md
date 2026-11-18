# Frontline demo

You are the coding agent. The story for this demo is Northpeak Outdoor, a fictional sports retailer, in the existing Slack Enterprise Grid workspace. Zac presents it. The Slack users are the shared pool in `scripts/cast.mjs`: Alex, Sam, Jordan, Riley, Casey, and Jamie. In this demo Alex is the seasonal associate in Stockholm, Sam is the store manager, and Jordan is regional ops. Riley, Casey, and Jamie are the Gothenburg, Oslo, and Copenhagen managers. A later demo reuses these six accounts and assigns them different roles. Do not create another Slack user.

This demo is Slack only. You do not create Salesforce records, and you do not connect Slack to Salesforce.

Do not build a website. Do not build a Slack bot that replies to people. The app in `slack/manifest.json` stages the workspace. People do not message that app. This story updates the existing workspace. Do not create a second one while the sandbox is at its user cap.

The human instructions are in `README.md`. Gate text is in `demos/manual-gates.json`. The brief is `NORTHPEAK_INPUT` in `scripts/northpeak.mjs`. Build the plan with `scripts/plan.mjs`:

```bash
node --input-type=module -e "
import { buildPlan, NORTHPEAK_INPUT } from './scripts/plan.mjs';
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('demos/manual-gates.json','utf8'));
console.log(JSON.stringify(buildPlan(NORTHPEAK_INPUT, catalog), null, 2));
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
2. You need `SLACK_ADMIN_TOKEN` in the environment, the org-admin user token from the manifest install. That token creates the workspace, invites users, and stages the channels. If it is missing, print the `slack-token` gate and stop. Reinstall the app when `slack/manifest.json` gains scopes, then store the new token.
3. The sandbox is at its user cap. Invite only the six people in `scripts/cast.mjs`, and only if those accounts do not already exist. They are Full Members, not guests. Alex is later switched to a Frontline Member by hand.
4. Persona lines post as that person. `SLACK_TOKEN_SAM` creates the canvas. `SLACK_TOKEN_JORDAN`, `SLACK_TOKEN_RILEY`, and the other names in the gate post their own lines. If a persona token is missing, leave that line in the pending list and print the `stage-personas` gate. Do not post those lines as someone else. The weekly reports and the stock position post as Jordan. A user token cannot change the sender name. When `SLACK_BOT_TOKEN` is set, those six lines post as Northpeak Reports instead.

## New workspace

The plan names the workspace Northpeak Outdoor. The existing workspace keeps its domain. Do not create a second workspace.

1. Reuse the saved team id. Rename `#store-uppsala` to `#store-stockholm`, archive the grocery channels, and create the channels that are missing.
2. Alex's three channels are `#onboarding-alex`, `#store-stockholm`, and `#announcements`. Alex is not a member of `#nordics-stock-requests`.
3. `canvases.create` as Sam, tabbed into `#onboarding-alex`.
4. `chat.postMessage` for each staged message, as the author on that message. Weekly reports use Jordan's token unless `SLACK_BOT_TOKEN` is set, in which case they use the Northpeak Reports name.
5. Leave Jordan's transfer reply unsent until Alex has raised the low stock.
6. Bookmark I've read the guide in `#onboarding-alex`, and Report low stock in each store channel, when those workflow links exist.

If a call returns `not_in_channel`, `channel_not_found`, or `no_local_user_on_team`, the person is not in that workspace yet. Add them to the workspace and the channel, then run the seed again. The links file keeps the workspace id.

Apply that sequence with:

```bash
node scripts/seed.mjs --apply
```

The command writes `demos/northpeak-outdoor.links.json`. That file is gitignored. A second apply reuses the saved workspace.

## What stays manual

Frontline membership, the three-channel home, the New starters List, Workflow Builder, phone mirroring, and the Beat 1 fallback recording are gates. Print any gate that is still open. The live demo starts with Alex already in Slack.

## Save

`demos/northpeak-outdoor.json` is the plan from `buildPlan`. Regenerate it when the brief changes, and keep it equal to the planner output. Record ids belong in the links file only.

## Never

- Create a Salesforce record, object, flow, named credential, or connector.
- Add a slash command, an app home conversation, or a bot people talk to.
- Build a web app for the brief.
- Put the demo in a workspace that already existed.
- Call the Slack API as a bot that replies to something a person just said. The seed posts the staged script once.
- Start a huddle, or run an admin invite, during the demo.
- Show or claim QR sign-in, native shift scheduling, or off-shift blocking.
- Put a token, a workspace id, or a message timestamp into a committed file.
- Give Alex more than 10 channels, or put them in the other store channels or `#nordics-stock-requests`.
- Let Alex use Slackbot. The summary is Jordan's.
- Invent a speaker with a custom username. Every line comes from that person's user account.
- Create a Slack user who is not in `scripts/cast.mjs`.
