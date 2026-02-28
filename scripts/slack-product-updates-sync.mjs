#!/usr/bin/env node
/**
 * Sync product updates from #product-release via Slack Web API.
 * Requires SLACK_BOT_TOKEN in environment; .env is optional for local development.
 * Bot token needs channels:history (and user token for thread replies).
 *
 * Filter: posts with thread replies (≥80 chars) from @Kir, @Mykola Martynovets, @Maxim Borisik
 *         OR mentions of @sales-team, @cs-team
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional in CI
  }
}

async function slackApi(method, params = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set in environment.");
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function slackApiPost(method, body) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set in environment.");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API: ${data.error || JSON.stringify(data)}`);
  return data;
}

const PRODUCT_USER_IDS = ["U9HDNS9S4", "U03J8UXUDPF", "U08EVBTE69E"];
const PRODUCT_NAMES = ["Kir", "Kirill", "Mykola Martynovets", "Maxim Borisik"];
const TEAM_MENTIONS = ["sales-team", "cs-team"];
const MIN_REPLY_LENGTH = 50;

function extractText(msg) {
  if (typeof msg.text === "string") return msg.text;
  return "";
}

function extractImageUrls(msg) {
  const urls = [];
  const files = msg.files || [];
  for (const f of files) {
    if (f.mimetype?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(f.filetype)) {
      if (f.url_private) urls.push(f.url_private);
      else if (f.permalink_public) urls.push(f.permalink_public);
    }
  }
  return urls;
}

function hasTeamMention(text) {
  const lower = text.toLowerCase();
  return TEAM_MENTIONS.some((t) => lower.includes(`@${t}`) || lower.includes(`<!subteam^`));
}

function getUserDisplayName(users, userId) {
  const u = users[userId];
  if (u) return u.real_name || u.name || userId;
  return userId;
}

async function main() {
  loadEnv();

  console.log("Fetching channels...");
  const channelId = process.env.SLACK_PRODUCT_RELEASE_CHANNEL || "C04SY70QZ0T";
  const channelInfo = await slackApiPost("conversations.info", { channel: channelId });
  const productRelease = channelInfo.channel;
  if (!productRelease) {
    throw new Error("Channel not found. Is the bot in the channel?");
  }
  console.log("Found #" + (productRelease.name || "product-release") + ":", channelId);

  if (productRelease.is_member !== true) {
    throw new Error(
      "Bot is not in #product-release. In Slack, go to #product-release and run: /invite @YourBotName"
    );
  }

  console.log("Fetching channel history...");
  const historyRes = await slackApiPost("conversations.history", {
    channel: channelId,
    limit: 100,
  });
  const messages = historyRes.messages || [];
  const withReplies = messages.filter(
    (m) => (m.reply_count ?? 0) > 0 && (!m.thread_ts || m.thread_ts === m.ts)
  );
  console.log(`Messages with threads: ${withReplies.length}`);

  const users = {};
  const userIds = new Set();
  for (const m of messages) {
    if (m.user) userIds.add(m.user);
  }
  for (const m of withReplies) {
    if (m.user) userIds.add(m.user);
  }
  if (userIds.size > 0) {
    let cursor = "";
    do {
      const body = { limit: 500 };
      if (cursor) body.cursor = cursor;
      const ul = await slackApiPost("users.list", body);
      for (const u of ul.members || []) {
        users[u.id] = { real_name: u.profile?.real_name, name: u.name };
      }
      cursor = ul.response_metadata?.next_cursor || "";
    } while (cursor);
  }

  const entries = [];
  for (const parent of withReplies) {
    let replies = [];
    try {
      const repliesRes = await slackApiPost("conversations.replies", {
        channel: channelId,
        ts: parent.ts,
      });
      replies = repliesRes.messages || [];
    } catch (err) {
      console.warn(`Thread ${parent.ts}: ${err.message}`);
      continue;
    }
    const threadReplies = replies.filter((r) => r.ts !== parent.ts);
    const matchingReplies = [];
    let hasTeamMentionVal = false;
    for (const r of threadReplies) {
      const text = extractText(r);
      const userName = getUserDisplayName(users, r.user);
      const isProductPerson =
        PRODUCT_USER_IDS.includes(r.user) ||
        PRODUCT_NAMES.some(
          (n) => userName.includes(n) || n.toLowerCase().includes(userName.toLowerCase())
        );
      if (isProductPerson && text.length >= MIN_REPLY_LENGTH) {
        matchingReplies.push({
          userId: r.user,
          userName,
          text,
          date: r.ts ? new Date(parseFloat(r.ts) * 1000).toISOString() : "",
          images: extractImageUrls(r),
        });
      }
      if (hasTeamMention(text)) hasTeamMentionVal = true;
    }
    for (const r of threadReplies) {
      if (hasTeamMention(extractText(r))) hasTeamMentionVal = true;
    }
    if (matchingReplies.length === 0 && !hasTeamMentionVal) continue;

    const workspace = process.env.SLACK_WORKSPACE || "adapty-team";
    const slackUrl = `https://${workspace}.slack.com/archives/${channelId}/p${parent.ts.replace(".", "")}`;
    const parentText = extractText(parent);
    const parentDate = parent.ts ? new Date(parseFloat(parent.ts) * 1000).toISOString() : "";
    const parentMsg = {
      userId: parent.user,
      userName: getUserDisplayName(users, parent.user),
      text: parentText,
      date: parentDate,
      images: extractImageUrls(parent),
    };
    const fullThread = [
      parentMsg,
      ...threadReplies.map((r) => ({
        userId: r.user,
        userName: getUserDisplayName(users, r.user),
        text: extractText(r),
        date: r.ts ? new Date(parseFloat(r.ts) * 1000).toISOString() : "",
        images: extractImageUrls(r),
      })),
    ];
    const content = fullThread
      .map((m) => `[${m.userName}]: ${m.text}`)
      .join("\n\n");
    const firstLine = parentText.split("\n")[0] || parentText;
    const nameMatch = firstLine.match(/\|([^>]+)>/);
    const name = (nameMatch ? nameMatch[1] : firstLine.replace(/<[^>]+>/g, "").replace(/^Feature:\s*/i, "")).trim().slice(0, 120);
    const allImages = fullThread.flatMap((m) => m.images);
    const postDate = parentDate ? parentDate.slice(0, 10) : "";
    entries.push({
      id: parent.ts,
      slackUrl,
      name: name.slice(0, 120),
      message: parentText,
      releaseDate: postDate,
      thread: fullThread,
      content,
      matchingReplies,
      hasTeamMention: hasTeamMentionVal,
      images: allImages,
    });
  }

  const MAX_ENTRIES = 20;
  const data = {
    syncedAt: new Date().toISOString(),
    channel: "#product-release",
    entries: entries.slice(0, MAX_ENTRIES),
  };
  const outPath = join(ROOT, "data", "slack-product-updates.json");
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Wrote ${data.entries.length} entries to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
