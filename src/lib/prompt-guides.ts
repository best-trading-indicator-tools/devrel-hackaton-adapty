import { readFile } from "node:fs/promises";
import path from "node:path";

const ADAPTY_CHANGELOG_JSON_FEED = "https://changelog.adapty.io/jsonfeed.json";
const CHANGELOG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let changelogCache: { text: string; fetchedAt: number } | null = null;

type PromptGuideKey =
  | "writing"
  | "sauce"
  | "sois"
  | "soisPrelaunch"
  | "soisPrelaunchInspiration"
  | "aso"
  | "paywall"
  | "factCheck";

export type PromptGuides = Record<PromptGuideKey, string>;

const GUIDE_PATHS: Record<PromptGuideKey, string> = {
  writing: path.join(process.cwd(), "prompts", "linkedin", "WRITING.md"),
  sauce: path.join(process.cwd(), "prompts", "linkedin", "SAUCE.md"),
  sois: path.join(process.cwd(), "prompts", "linkedin", "SOIS.md"),
  soisPrelaunch: path.join(process.cwd(), "prompts", "linkedin", "SOIS_PRELAUNCH.md"),
  soisPrelaunchInspiration: path.join(process.cwd(), "sois-pre-launch.md"),
  aso: path.join(process.cwd(), "prompts", "linkedin", "ASO.md"),
  paywall: path.join(process.cwd(), "prompts", "linkedin", "PAYWALL.md"),
  factCheck: path.join(process.cwd(), "prompts", "linkedin", "FACT_CHECK.md"),
};

const DEFAULT_GUIDES: PromptGuides = {
  writing: [
    "Write like a cohesive mini-article, one thought flowing into the next.",
    'Use Adapty company voice: "we", "our", and "us". Never use first-person singular pronouns ("I", "me", "my").',
    "Use this default flow: observation, why it matters, mechanism/example, practical next move.",
    "Address reader directly at least once with you or your team when natural.",
    "Include one operator action sentence using verbs like test, measure, compare, or fix.",
    "Use paragraphs of 2-4 sentences. Add blank lines only between paragraphs, not between sentences. Do not put each sentence on its own line.",
    "Use fuller paragraphs with 2-4 sentences. Keep one-line paragraphs occasional.",
    "Include concrete proof units and caveats.",
    "Use the words app makers use in real conversations.",
    "Use hyphens, commas, and periods.",
  ].join("\n"),
  sauce: [
    "For State of in-app subscriptions report posts, combine practical breakdown and data insight.",
    "Lead with a hard question, explain mechanism, add concrete evidence, give actions, include caveats.",
    "Keep concrete density high and include at least one lived observation line in company voice (we saw, we tested).",
  ].join("\n"),
  sois: [
    "State of in-app subscriptions report context can be used for directional patterns, filters, and hypothesis generation.",
    "For strict numeric claims in state of in-app subscriptions report posts, keep only values present in report evidence context for the current run.",
    "Prefer category/region/plan-specific benchmarks over global generic statements.",
  ].join("\n"),
  soisPrelaunch: [
    "Use this guide for SOIS Pre-launch posts that tease next week's report launch.",
    "Frame progress and anticipation: report in final polishing stage, early screenshots, and one concrete insight.",
    "Use a playful prediction or poll prompt and promise later fact-checking with the full report data.",
    'Never use the acronym "SOIS" in public copy; write "State of in-app subscriptions report".',
  ].join("\n"),
  soisPrelaunchInspiration: "No SOIS pre-launch inspiration feed provided.",
  aso: [
    "For ASO topics, focus on intent fit, conversion levers, and practical diagnostics before tool chatter.",
    "Use concrete metrics and caveats by geo, app category, and traffic source.",
  ].join("\n"),
  paywall: [
    "For paywall topics, prioritize sequence, offer clarity, and traffic quality before micro-copy tweaks.",
    "Use concrete diagnostics and one practical experiment the team can run quickly.",
  ].join("\n"),
  factCheck: [
    "For factual claims, prefer web-verified evidence.",
    "When evidence is missing, rewrite as opinion or observation.",
    "Use only numbers and facts that appear in the provided evidence.",
  ].join("\n"),
};

const MAX_GUIDE_CHARS = 6_000;
let guideCache: PromptGuides | null = null;

function normalizeGuideText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_GUIDE_CHARS);
}

async function loadGuide(key: PromptGuideKey): Promise<string> {
  try {
    const raw = await readFile(GUIDE_PATHS[key], "utf8");
    const normalized = normalizeGuideText(raw);
    return normalized || DEFAULT_GUIDES[key];
  } catch {
    return DEFAULT_GUIDES[key];
  }
}

const SAUCE_DATASET_PATH =
  process.env.SAUCE_DATASET_PATH?.trim() || path.join(process.cwd(), "data", "sauce-dataset.md");
const SAUCE_DATASET_MAX_CHARS = 50_000;
const SOIS_INSIGHTS_DATASET_PATH =
  process.env.SOIS_INSIGHTS_DATASET_PATH?.trim() || path.join(process.cwd(), "data", "sois-insights.md");
const SOIS_INSIGHTS_DATASET_MAX_CHARS = 120_000;

let sauceDatasetCache: string | null = null;
let soisInsightsDatasetCache: string | null = null;

export async function getSauceDataset(): Promise<string> {
  if (sauceDatasetCache !== null) {
    return sauceDatasetCache;
  }
  try {
    const raw = await readFile(SAUCE_DATASET_PATH, "utf8");
    const text = raw.replace(/\r\n?/g, "\n").trim().slice(0, SAUCE_DATASET_MAX_CHARS);
    sauceDatasetCache = text;
    return text;
  } catch {
    sauceDatasetCache = "";
    return "";
  }
}

export async function getSoisInsightsDataset(): Promise<string> {
  if (soisInsightsDatasetCache !== null) {
    return soisInsightsDatasetCache;
  }

  try {
    const raw = await readFile(SOIS_INSIGHTS_DATASET_PATH, "utf8");
    const text = raw.replace(/\r\n?/g, "\n").trim().slice(0, SOIS_INSIGHTS_DATASET_MAX_CHARS);
    soisInsightsDatasetCache = text;
    return text;
  } catch {
    soisInsightsDatasetCache = "";
    return "";
  }
}

export async function getPromptGuides(): Promise<PromptGuides> {
  if (guideCache) {
    return guideCache;
  }

  const [writing, sauce, sois, soisPrelaunch, soisPrelaunchInspiration, aso, paywall, factCheck] = await Promise.all([
    loadGuide("writing"),
    loadGuide("sauce"),
    loadGuide("sois"),
    loadGuide("soisPrelaunch"),
    loadGuide("soisPrelaunchInspiration"),
    loadGuide("aso"),
    loadGuide("paywall"),
    loadGuide("factCheck"),
  ]);

  guideCache = {
    writing,
    sauce,
    sois,
    soisPrelaunch,
    soisPrelaunchInspiration,
    aso,
    paywall,
    factCheck,
  };

  return guideCache;
}

const PRODUCT_UPDATE_TONE_MAX_CHARS = 15_000;
const CHANGELOG_MAX_ITEMS = 12;

type JsonFeedItem = { title?: string; summary?: string; content_html?: string; date_modified?: string };

async function fetchChangelogFromJsonFeed(): Promise<string> {
  if (changelogCache && Date.now() - changelogCache.fetchedAt < CHANGELOG_CACHE_TTL_MS) {
    return changelogCache.text;
  }

  try {
    const res = await fetch(ADAPTY_CHANGELOG_JSON_FEED, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { items?: JsonFeedItem[] };
    const items = data.items?.slice(0, CHANGELOG_MAX_ITEMS) ?? [];

    const lines: string[] = [
      "Adapty product updates (live from changelog.adapty.io — use for rhythm, structure, and voice):",
      "",
    ];

    for (const item of items) {
      const title = item.title?.trim();
      const summary = item.summary?.trim() ?? item.content_html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
      const date = item.date_modified ? new Date(item.date_modified).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
      if (title) {
        lines.push(`**${title}**${date ? ` (${date})` : ""}`);
        if (summary) lines.push(summary);
        lines.push("");
      }
    }

    lines.push("Tone: Lead with feature name. One sentence per feature. Be direct, practical, no hype.");

    const text = lines.join("\n").slice(0, PRODUCT_UPDATE_TONE_MAX_CHARS);
    changelogCache = { text, fetchedAt: Date.now() };
    return text;
  } catch {
    changelogCache = null;
    return "";
  }
}

export async function getProductUpdateToneContext(): Promise<string> {
  return fetchChangelogFromJsonFeed();
}
