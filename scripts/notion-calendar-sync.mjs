#!/usr/bin/env node
/**
 * Sync SMM PLANNING database from Notion to data/notion-calendar.json.
 * Uses Notion REST API (NOTION_API_KEY). For tagging incomplete entries, use Cursor + Notion MCP.
 *
 * Prerequisite: Create integration at notion.so/my-integrations, share SMM PLANNING database with it.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SMM_PLANNING_DATA_SOURCE_ID = "2851ca43-55c3-81d0-a585-000bd290877f";

const AHMET_ID = "1f8d872b-594c-8141-9a7f-00023792fa71";
const JULIA_ID = "5ac0c36e-9df9-4fc6-a067-f42a71e42cca";
const DAVID_ID = "2f4d872b-594c-814d-8b4d-00023eb7a155";

const ARTICLE_PROMO_PATTERN = /article|article promo/i;
const WEBINAR_EVENT_TYPES = [
  "Webinar",
  "Conference",
  "Meetup",
  "Our side event",
  "Dinner/Breakfast",
  "Sponsorship",
  "Client speaking",
  "Our conference",
];
const PRODUCT_UPDATE_PATTERN = /product update|product/i;
const VISUAL_PATTERN = /image|photo|visual|picture|screenshot/i;
const URL_PATTERN =
  /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/i;

function loadEnv() {
  const envPath = join(ROOT, ".env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env optional in CI
  }
}

function extractTitle(prop) {
  if (!prop?.title) return "";
  return prop.title.map((t) => t.plain_text ?? "").join("");
}

function extractDate(prop) {
  if (!prop?.date?.start) return "";
  return prop.date.start.slice(0, 10);
}

function extractRelation(prop) {
  if (!prop?.relation) return [];
  return prop.relation.map((r) => r.id);
}

function extractMultiSelect(prop) {
  if (!prop?.multi_select) return [];
  return prop.multi_select.map((o) => o.name);
}

function extractRichText(prop) {
  if (!prop?.rich_text) return "";
  return prop.rich_text.map((t) => t.plain_text ?? "").join("");
}

function extractUrlProp(prop) {
  if (prop?.url) return prop.url;
  const rt = prop?.rich_text;
  if (Array.isArray(rt) && rt[0]?.href) return rt[0].href;
  return "";
}

function extractUrl(rt) {
  if (rt?.href && /^https?:\/\//.test(rt.href)) return rt.href;
  if (rt?.text?.link?.url) return rt.text.link.url;
  return null;
}

async function blocksToContent(notion, blocks) {
  const parts = [];
  for (const block of blocks || []) {
    const type = block.type;
    const data = block[type];
    if (!data) continue;
    const richText = data.rich_text ?? data.text ?? data.caption ?? [];
    for (const rt of richText) {
      const text = rt.plain_text ?? "";
      const url = extractUrl(rt);
      if (url) parts.push(url);
      if (text) parts.push(text);
    }
    if (block.has_children) {
      try {
        const children = await fetchBlockChildren(notion, block.id);
        parts.push(await blocksToContent(notion, children));
      } catch {
        // skip nested content on error
      }
    }
  }
  return parts.flat().filter(Boolean).join(" ");
}

async function fetchBlockChildren(notion, blockId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });
    blocks.push(...(res.results || []));
    cursor = res.next_cursor;
  } while (cursor);
  return blocks;
}

async function main() {
  loadEnv();
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error(
      "NOTION_API_KEY not set. Create an integration at notion.so/my-integrations, share SMM PLANNING with it, and add the token to .env or GitHub Secrets."
    );
  }

  const { Client } = await import("@notionhq/client");
  const notion = new Client({ auth: token });

  console.log("Querying SMM PLANNING database...");
  const pages = [];
  let cursor;
  do {
    const res = await notion.dataSources.query({
      data_source_id: SMM_PLANNING_DATA_SOURCE_ID,
      page_size: 100,
      sorts: [{ property: "Date", direction: "ascending" }],
      ...(cursor && { start_cursor: cursor }),
    });
    pages.push(...(res.results || []));
    cursor = res.next_cursor;
  } while (cursor);

  console.log(`Found ${pages.length} planning pages`);

  const eventCache = new Map();
  const entries = [];

  for (const page of pages) {
    const props = page.properties || {};
    const name = extractTitle(props.Name ?? props.title ?? { title: [] });
    const date = extractDate(props.Date ?? props["date:Date:start"] ?? {});
    const eventIds = extractRelation(props.Event);
    const tags = extractMultiSelect(props.Tags);

    let content = "";
    try {
      const blocks = await fetchBlockChildren(notion, page.id);
      content = await blocksToContent(notion, blocks);
    } catch (e) {
      console.warn(`Could not fetch content for ${page.id}:`, e.message);
    }

    const hasUrl = URL_PATTERN.test(content) || (content && content.trim().length > 0);
    const eventPage = eventIds[0];
    let eventData = null;

    if (eventPage) {
      if (!eventCache.has(eventPage)) {
        try {
          const ep = await notion.pages.retrieve({ page_id: eventPage });
          const epProps = ep.properties || {};
          const epName = extractTitle(epProps.Name ?? epProps.title ?? { title: [] });
          const epDate = extractDate(epProps.Date ?? epProps["Event date"] ?? {});
          const epPage =
            extractUrlProp(epProps["Event page"] ?? epProps.URL ?? {}) ||
            extractRichText(epProps["Event page"] ?? epProps.URL ?? {}) ||
            "";
          const region = extractRichText(epProps.Region ?? {});
          const time = extractRichText(epProps.Time ?? {});
          const eventType = extractMultiSelect(epProps["Event Type"] ?? epProps["Event type"] ?? {});
          const owners = epProps.Owner?.people ?? [];
          const ownerIds = (owners || []).map((p) => (p.id ?? "").replace(/-/g, "")).filter(Boolean);
          eventCache.set(eventPage, {
            id: ep.id.replace(/-/g, ""),
            name: epName,
            eventName: epName,
            eventType,
            eventDate: epDate,
            eventPage: epPage || (URL_PATTERN.test(epPage) ? epPage : null),
            region,
            time,
            ownerIds,
          });
        } catch (e) {
          console.warn(`Could not fetch event ${eventPage}:`, e.message);
        }
      }
      eventData = eventCache.get(eventPage) ?? null;
    }

    const hasEventUrl = eventData?.eventPage && URL_PATTERN.test(eventData.eventPage);
    const hasContentUrl = URL_PATTERN.test(content);
    const hasLink = hasEventUrl || hasContentUrl;
    const hasVisualSignal = VISUAL_PATTERN.test(content);
    const nameLower = name.toLowerCase();
    const tagText = tags.join(" ").toLowerCase();

    const isArticlePromo = ARTICLE_PROMO_PATTERN.test(name) || ARTICLE_PROMO_PATTERN.test(tagText);
    const eventTypes = eventData?.eventType ?? [];
    const isWebinarOrOffline = eventTypes.some((t) =>
      WEBINAR_EVENT_TYPES.some((w) => t.toLowerCase().includes(w.toLowerCase()))
    );
    const isProductUpdate =
      PRODUCT_UPDATE_PATTERN.test(name) ||
      eventTypes.some((t) => /product|launch/i.test(t));

    let needsAuthorInput = false;
    let needsEventDetails = false;
    const authorIdsToTag = [];

    if (!content.trim() && !hasLink) needsAuthorInput = true;
    if (eventData && (!eventData.region?.trim() || !eventData.time?.trim()))
      needsEventDetails = true;

    if (isArticlePromo && !hasLink) authorIdsToTag.push(AHMET_ID);
    if ((isWebinarOrOffline || eventTypes.length) && !hasVisualSignal)
      authorIdsToTag.push(JULIA_ID);
    if (isProductUpdate && !hasVisualSignal) {
      if (!authorIdsToTag.includes(AHMET_ID)) authorIdsToTag.push(AHMET_ID);
      authorIdsToTag.push(DAVID_ID);
    }
    const uniqueAuthorIds = [...new Set(authorIdsToTag)];

    const pageId = page.id.replace(/-/g, "");
    const notionUrl = page.url || `https://www.notion.so/${pageId}`;

    entries.push({
      id: pageId,
      notionUrl,
      name: name.trim() || "Untitled",
      date: date || "",
      content: content.trim(),
      event: eventData,
      tags,
      needsAuthorInput,
      needsEventDetails,
      authorIdsToTag: uniqueAuthorIds,
    });
  }

  const data = {
    syncedAt: new Date().toISOString(),
    entries: entries.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")),
  };

  const outPath = join(ROOT, "data", "notion-calendar.json");
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Wrote ${data.entries.length} entries to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
