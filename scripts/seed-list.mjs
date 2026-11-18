/**
 * Create the New starters list as the org admin, then make Sam the owner.
 * Requires lists:write on SLACK_ADMIN_TOKEN. Safe to run again.
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
  const token = process.env.SLACK_ADMIN_TOKEN;
  if (!token) throw new Error("SLACK_ADMIN_TOKEN is missing.");
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
    if (!created.ok) throw new Error(`slackLists.create failed: ${created.error}`);
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
  const shared = await slack(token, "slackLists.access.set", {
    list_id: listId,
    access_level: "write",
    channel_ids: [channelId],
  });
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
