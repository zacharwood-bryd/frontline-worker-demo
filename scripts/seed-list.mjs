/**
 * Create the New starters list with the bot token, share it into
 * #stockholm-leads, bookmark it, and make Sam the owner.
 * Requires lists:write on SLACK_BOT_TOKEN. Safe to run again.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NORTHPEAK_INPUT } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linksPath = path.join(root, "demos", "northpeak-outdoor.links.json");
const samId = "U0CH51SDF97";

function slack(token, method, body) {
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  }).then((response) => response.json());
}

function richText(value) {
  return [
    {
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: value }] }],
    },
  ];
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_ADMIN_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN or SLACK_ADMIN_TOKEN is missing.");
  console.log("token", process.env.SLACK_BOT_TOKEN ? "bot" : "admin");
  const links = JSON.parse(readFileSync(linksPath, "utf8"));
  const list = NORTHPEAK_INPUT.list;
  const keys = ["name", "start", "guide", "till", "buddy", "status"];

  let listId = links.listId || null;
  if (!listId) {
    const created = await slack(token, "slackLists.create", {
      name: list.title,
      schema: list.columns.map((name, index) => ({
        key: keys[index],
        name,
        type: "text",
        is_primary_column: index === 0,
      })),
    });
    if (!created.ok) {
      const scopes = [created.needed, created.provided].filter(Boolean).join(" | provided ");
      throw new Error(`slackLists.create failed: ${created.error}${scopes ? ` | needed ${scopes}` : ""}`);
    }
    listId = created.list_id;
    const columns = Object.fromEntries((created.list_metadata?.schema || []).map((column) => [column.key, column.id]));
    for (const row of list.rows) {
      const initial = row.flatMap((value, index) => {
        if (!value) return [];
        const columnId = columns[keys[index]];
        if (!columnId) return [];
        return [{ column_id: columnId, rich_text: richText(value) }];
      });
      const item = await slack(token, "slackLists.items.create", { list_id: listId, initial_fields: initial });
      if (!item.ok) throw new Error(`slackLists.items.create failed: ${item.error}`);
    }
    links.listId = listId;
    writeFileSync(linksPath, `${JSON.stringify(links, null, 2)}\n`);
    console.log("created", listId);
  } else {
    console.log("exists", listId);
  }

  const channelId = links.channels[list.channel];
  const needsChannel = !links.bookmarks?.[list.title];
  let shared = await slack(token, "slackLists.access.set", {
    list_id: listId,
    access_level: "write",
    channel_ids: [channelId],
  });
  if ((!shared.ok && shared.error === "channel_not_found") || needsChannel) {
    if (process.env.SLACK_ADMIN_TOKEN && process.env.SLACK_BOT_TOKEN) {
      const me = await slack(token, "auth.test", {});
      const invited = await slack(process.env.SLACK_ADMIN_TOKEN, "admin.conversations.invite", {
        channel_id: channelId,
        user_ids: me.user_id,
      });
      console.log("invite bot", invited.ok, invited.error || "");
      if (!shared.ok) {
        shared = await slack(token, "slackLists.access.set", {
          list_id: listId,
          access_level: "write",
          channel_ids: [channelId],
        });
      }
      if (needsChannel) {
        const bookmark = await slack(token, "bookmarks.add", {
          channel_id: channelId,
          title: list.title,
          type: "link",
          link: `https://zac-bryd-sandbox.enterprise.slack.com/lists/${links.teamId}/${listId}`,
          emoji: ":ledger:",
        });
        console.log("bookmark", bookmark.ok, bookmark.error || "");
        if (bookmark.ok) {
          links.bookmarks = { ...(links.bookmarks || {}), [list.title]: bookmark.bookmark?.id || true };
          writeFileSync(linksPath, `${JSON.stringify(links, null, 2)}\n`);
        }
      }
      const history = await slack(token, "conversations.history", { channel: channelId, limit: 20 });
      const notices = (history.messages || []).filter((message) => message.subtype === "bot_message");
      if (notices.length) {
        const adminUser = await slack(process.env.SLACK_ADMIN_TOKEN, "auth.test", {});
        await slack(process.env.SLACK_ADMIN_TOKEN, "admin.conversations.invite", {
          channel_id: channelId,
          user_ids: adminUser.user_id,
        });
        for (const message of notices) {
          await slack(process.env.SLACK_ADMIN_TOKEN, "chat.delete", { channel: channelId, ts: message.ts });
        }
        await slack(process.env.SLACK_ADMIN_TOKEN, "conversations.leave", { channel: channelId });
      }
      await slack(token, "conversations.leave", { channel: channelId });
    }
  }
  console.log("share", shared.ok, shared.error || list.channel);

  const owned = await slack(token, "slackLists.access.set", {
    list_id: listId,
    access_level: "owner",
    user_ids: [samId],
  });
  console.log("owner", owned.ok, owned.error || "sam");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
