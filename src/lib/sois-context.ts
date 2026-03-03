import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

const SOIS_BASE_URL = "https://dags.adpinfra.dev/webhook/sois-data";
const SOIS_LANCEDB_PATH = process.env.VERCEL ? path.join("/tmp", ".lancedb") : path.join(process.cwd(), ".lancedb");
const SOIS_LANCEDB_META_PATH = path.join(SOIS_LANCEDB_PATH, "sois_context_meta.json");
const SOIS_LANCEDB_TABLE_NAME = "sois_context_evidence";
const SOIS_CACHE_DIR = path.join(SOIS_LANCEDB_PATH, "sois-cache");
const SOIS_SITE_CONTEXT_PATH =
  process.env.SOIS_SITE_CONTEXT_PATH?.trim() || path.join(process.cwd(), "data", "sois-site", "context.json");
const SOIS_ALL_DATASETS_PATH =
  process.env.SOIS_ALL_DATASETS_PATH?.trim() ||
  path.join(process.cwd(), "data", "sois-site", "all-datasets.json");
const SOIS_FETCH_TIMEOUT_MS = 15_000;
const SOIS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOIS_MAX_METRICS_PER_SECTION = 5;
const SOIS_REPORT_NAME = "State of In-App Subscriptions";
const SOIS_SITE_ORIGIN_FALLBACK = "https://appstate2.vercel.app";

const ANALYSIS_POST_TYPE_PATTERN =
  /\b(sauce|sois|state of in[-\s]?app subscriptions|sois\s*pre[-\s]?launch|curated roundup|controversial hot take|industry news reaction|case study|social proof|product feature launch|milestone|company update)\b/i;

type LanceDbConnection = import("@lancedb/lancedb").Connection;

type SoisCategory =
  | "ltv"
  | "conversions"
  | "pricing"
  | "market"
  | "retention"
  | "refunds"
  | "stores"
  | "ai"
  | "paywalls"
  | "webpaywalls";

type SoisCategoryDefinition = {
  label: string;
  subcategories: Array<{
    id: number;
    label: string;
    enabledByDefault?: boolean;
  }>;
};

const SOIS_CATEGORY_DEFINITIONS: Record<SoisCategory, SoisCategoryDefinition> = {
  ltv: {
    label: "LTV",
    subcategories: [
      { id: 1, label: "LTV Dashboard", enabledByDefault: false },
      { id: 2, label: "LTV by Country" },
      { id: 3, label: '"Install to Paid" LTV' },
      { id: 4, label: '"Install to Trial" LTV' },
    ],
  },
  conversions: {
    label: "Conversions",
    subcategories: [
      { id: 1, label: "Conversions (Trials)" },
      { id: 2, label: "Conversions (Direct)" },
    ],
  },
  pricing: {
    label: "Pricing",
    subcategories: [
      { id: 1, label: "Pricing Dashboard", enabledByDefault: false },
      { id: 2, label: "Price Index by Country" },
      { id: 3, label: "LTV by Price Buckets" },
      { id: 4, label: "Conversions by Price Buckets" },
    ],
  },
  market: {
    label: "Market Trends",
    subcategories: [
      { id: 1, label: "Revenue by Regions" },
      { id: 2, label: "Top Countries by Revenue" },
      { id: 3, label: "Fastest Growing Markets (YoY)" },
      { id: 4, label: "Revenue Concentration" },
      { id: 5, label: "Revenue by Product Type" },
      { id: 6, label: "Install to Trial Time" },
      { id: 7, label: "Install to Paid Time" },
      { id: 8, label: "Trial Usage" },
      { id: 9, label: "Discount Usage" },
      { id: 10, label: "2025 Revenue by App Launch Year" },
      { id: 11, label: "New Apps Revenue" },
      { id: 12, label: "Competition" },
    ],
  },
  retention: {
    label: "Retention",
    subcategories: [
      { id: 1, label: "Retention Dashboard" },
      { id: 2, label: "Renewal Rate by Price Bucket" },
    ],
  },
  refunds: {
    label: "Refunds",
    subcategories: [
      { id: 1, label: "Refunds Overview" },
      { id: 2, label: "Refund Time" },
    ],
  },
  stores: {
    label: "iOS vs Android",
    subcategories: [
      { id: 1, label: "LTV12" },
      { id: 2, label: "Install to Paid" },
      { id: 3, label: "% Revenue" },
    ],
  },
  ai: {
    label: "AI Apps",
    subcategories: [
      { id: 1, label: "Install to Trial CR" },
      { id: 2, label: "Install to Direct CR" },
      { id: 3, label: "LTV" },
      { id: 4, label: "Install LTV" },
      { id: 5, label: "Retention Rate" },
    ],
  },
  paywalls: {
    label: "Paywalls and Experiments",
    subcategories: [
      { id: 1, label: "Paywalls Overview" },
      { id: 2, label: "Experiment Impact" },
      { id: 3, label: "Experiment Adoption" },
      { id: 4, label: "Experiments and Revenue Correlation" },
      { id: 5, label: "LTV by Placement Type" },
      { id: 6, label: "View to Purchase CR by Placement Type" },
      { id: 7, label: "LTV by Gate Type" },
      { id: 8, label: "View to Purchase CR by Gate Type" },
    ],
  },
  webpaywalls: {
    label: "Web Paywalls",
    subcategories: [
      { id: 1, label: "Revenue" },
      { id: 2, label: "Install to Paid CR Comparison" },
      { id: 3, label: "Retention Rate" },
      { id: 4, label: "LTV" },
      { id: 5, label: "Install LTV" },
    ],
  },
};

const SOIS_POST_TYPE_CATEGORY_RULES: Array<{ pattern: RegExp; categories: SoisCategory[] }> = [
  {
    pattern: /sois\s*pre[-\s]?launch|state of in[-\s]?app subscriptions\s*pre[-\s]?launch/i,
    categories: ["market", "pricing", "conversions", "ltv"],
  },
  {
    pattern: /sauce|sois|state of in[-\s]?app subscriptions/i,
    categories: ["conversions", "pricing", "retention", "paywalls", "ltv", "market"],
  },
  {
    pattern: /curated roundup/i,
    categories: ["market", "stores", "ai", "refunds", "pricing"],
  },
  {
    pattern: /controversial hot take/i,
    categories: ["paywalls", "pricing", "conversions", "retention", "stores"],
  },
  {
    pattern: /industry news reaction/i,
    categories: ["market", "stores", "ai", "refunds"],
  },
  {
    pattern: /case study|social proof/i,
    categories: ["ltv", "conversions", "retention", "paywalls"],
  },
  {
    pattern: /product feature launch/i,
    categories: ["conversions", "retention", "market", "paywalls"],
  },
];

const DEFAULT_ANALYSIS_CATEGORIES: SoisCategory[] = ["conversions", "pricing", "retention", "paywalls", "ltv"];

type SoisSectionTarget = {
  category: SoisCategory;
  categoryLabel: string;
  subcategory: number;
  subcategoryLabel: string;
  key: string;
};

export type SoisContextItem = {
  id: string;
  category: SoisCategory;
  categoryLabel: string;
  subcategory: number;
  subcategoryLabel: string;
  sourceUrl: string;
  rows: number;
  text: string;
};

type SoisEvidenceData = {
  items: SoisContextItem[];
  hash: string;
  fetchedSections: number;
  availableSections: number;
  warning?: string;
};

type SoisSiteSnapshotMetric = {
  key?: unknown;
  count?: unknown;
  min?: unknown;
  p50?: unknown;
  p90?: unknown;
  max?: unknown;
};

type SoisSiteSnapshotDataset = {
  id?: unknown;
  title?: unknown;
  categoryHint?: unknown;
  sourceUrl?: unknown;
  rowCount?: unknown;
  columns?: unknown;
  summaryLines?: unknown;
  numericMetrics?: unknown;
  dimensionSamples?: unknown;
};

type SoisAllDatasetMetadata = {
  title: string;
  category: SoisCategory;
  subcategory?: number;
  subcategoryLabel?: string;
  apiTargetKey?: string;
};

const SOIS_ALL_DATASET_METADATA: Record<string, SoisAllDatasetMetadata> = {
  "conversions-trial": {
    title: "Conversions (Trials) Dataset",
    category: "conversions",
    subcategory: 1,
    subcategoryLabel: "Conversions (Trials)",
    apiTargetKey: "conversions-1",
  },
  "conversions-direct": {
    title: "Conversions (Direct) Dataset",
    category: "conversions",
    subcategory: 2,
    subcategoryLabel: "Conversions (Direct)",
    apiTargetKey: "conversions-2",
  },
  "pricing-data": {
    title: "Pricing Dataset",
    category: "pricing",
    subcategory: 2,
    subcategoryLabel: "Price Index by Country",
    apiTargetKey: "pricing-2",
  },
  "pricing-ltv": {
    title: "LTV by Price Bucket Dataset",
    category: "pricing",
    subcategory: 3,
    subcategoryLabel: "LTV by Price Buckets",
    apiTargetKey: "pricing-3",
  },
  "pricing-conversion": {
    title: "Conversions by Price Bucket Dataset",
    category: "pricing",
    subcategory: 4,
    subcategoryLabel: "Conversions by Price Buckets",
    apiTargetKey: "pricing-4",
  },
  "ltv-analytics": {
    title: "LTV Analytics Dataset",
    category: "ltv",
    subcategory: 1,
    subcategoryLabel: "LTV Dashboard",
    apiTargetKey: "ltv-1",
  },
  "ltv-by-region": {
    title: "LTV by Region Dataset",
    category: "ltv",
    subcategory: 2,
    subcategoryLabel: "LTV by Country",
    apiTargetKey: "ltv-2",
  },
  "install-ltv": {
    title: "Install to Paid LTV Dataset",
    category: "ltv",
    subcategory: 3,
    subcategoryLabel: '"Install to Paid" LTV',
    apiTargetKey: "ltv-3",
  },
  retention: {
    title: "Retention Dataset",
    category: "retention",
    subcategory: 1,
    subcategoryLabel: "Retention Dashboard",
    apiTargetKey: "retention-1",
  },
  "renewal-by-price": {
    title: "Renewal by Price Dataset",
    category: "retention",
    subcategory: 2,
    subcategoryLabel: "Renewal Rate by Price Bucket",
    apiTargetKey: "retention-2",
  },
  "refund-share": {
    title: "Refund Share Dataset",
    category: "refunds",
    subcategory: 1,
    subcategoryLabel: "Refunds Overview",
    apiTargetKey: "refunds-1",
  },
  "revenue-by-region": {
    title: "Revenue by Region Dataset",
    category: "market",
    subcategory: 1,
    subcategoryLabel: "Revenue by Regions",
    apiTargetKey: "market-1",
  },
  "fastest-growing-countries": {
    title: "Fastest Growing Countries Dataset",
    category: "market",
    subcategory: 3,
    subcategoryLabel: "Fastest Growing Markets (YoY)",
    apiTargetKey: "market-3",
  },
  "revenue-concentration": {
    title: "Revenue Concentration Dataset",
    category: "market",
    subcategory: 4,
    subcategoryLabel: "Revenue Concentration",
    apiTargetKey: "market-4",
  },
  "revenue-by-product-type": {
    title: "Revenue by Product Type Dataset",
    category: "market",
    subcategory: 5,
    subcategoryLabel: "Revenue by Product Type",
    apiTargetKey: "market-5",
  },
  "install-to-trial-time": {
    title: "Install to Trial Time Dataset",
    category: "market",
    subcategory: 6,
    subcategoryLabel: "Install to Trial Time",
    apiTargetKey: "market-6",
  },
  "install-to-paid-time": {
    title: "Install to Paid Time Dataset",
    category: "market",
    subcategory: 7,
    subcategoryLabel: "Install to Paid Time",
    apiTargetKey: "market-7",
  },
  "trial-usage": {
    title: "Trial Usage Dataset",
    category: "market",
    subcategory: 8,
    subcategoryLabel: "Trial Usage",
    apiTargetKey: "market-8",
  },
  "discount-usage": {
    title: "Discount Usage Dataset",
    category: "market",
    subcategory: 9,
    subcategoryLabel: "Discount Usage",
    apiTargetKey: "market-9",
  },
};

let soisAllDatasetsCache:
  | {
      path: string;
      mtimeMs: number;
      maxMetrics: number;
      sourceOrigin: string;
      items: SoisContextItem[];
    }
  | null = null;

function toHash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBooleanFlag(value: string | undefined, fallbackValue: boolean): boolean {
  if (typeof value !== "string" || !value.trim()) {
    return fallbackValue;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallbackValue: number, maxValue = 200): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(maxValue, parsed);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 2);
}

const SOIS_QUERY_NOISE_TOKENS = new Set<string>([
  "adapty",
  "balanced",
  "awareness",
  "virality",
  "engagement",
  "traffic",
  "sauce",
  "sois",
  "state",
  "subscriptions",
  "prelaunch",
  "launch",
  "style",
  "goal",
  "post",
  "posts",
  "input",
  "type",
  "chart",
  "meme",
  "giphy",
  "templates",
  "details",
  "link",
  "request",
]);

const SOIS_SPECIFIC_SIGNAL_PATTERN =
  /\b(ltv|retention|renewal|churn|trial|conversion|pricing|price|paywall|placement|onboarding|country|region|category|utilities|health|fitness|productivity|entertainment|gaming|education|finance|travel|ios|android|annual|monthly|weekly|direct)\b/i;

function extractFocusTokens(query: string, details: string): string[] {
  const tokenSet = new Set<string>();

  for (const token of tokenize(`${details} ${query}`)) {
    if (SOIS_QUERY_NOISE_TOKENS.has(token)) {
      continue;
    }
    tokenSet.add(token);
  }

  return [...tokenSet];
}

function hasSpecificSoisIntent(query: string, details: string): boolean {
  const combined = `${details}\n${query}`.trim();
  if (!combined) {
    return false;
  }

  const focusTokens = extractFocusTokens(query, details);
  return SOIS_SPECIFIC_SIGNAL_PATTERN.test(combined) && focusTokens.length >= 2;
}

function sectionKeyFromItemId(itemId: string): string {
  const overviewSuffix = "-overview";
  const metricMarker = "-metric-";

  if (itemId.endsWith(overviewSuffix)) {
    return itemId.slice(0, -overviewSuffix.length);
  }

  const markerIndex = itemId.indexOf(metricMarker);
  if (markerIndex > 0) {
    return itemId.slice(0, markerIndex);
  }

  return itemId;
}

function broadCoverageSearch(items: SoisContextItem[], limit: number): SoisContextItem[] {
  if (!items.length || limit <= 0) {
    return [];
  }

  const bySection = new Map<string, SoisContextItem[]>();
  for (const item of items) {
    const sectionKey = sectionKeyFromItemId(item.id);
    const existing = bySection.get(sectionKey);
    if (existing) {
      existing.push(item);
    } else {
      bySection.set(sectionKey, [item]);
    }
  }

  const selected: SoisContextItem[] = [];
  const seen = new Set<string>();
  const pushItem = (item: SoisContextItem | undefined) => {
    if (!item || seen.has(item.id) || selected.length >= limit) {
      return;
    }
    seen.add(item.id);
    selected.push(item);
  };

  for (const sectionItems of bySection.values()) {
    pushItem(sectionItems.find((item) => item.id.endsWith("-overview")));
  }

  for (const sectionItems of bySection.values()) {
    pushItem(sectionItems.find((item) => !item.id.endsWith("-overview")));
  }

  for (const sectionItems of bySection.values()) {
    for (const item of sectionItems) {
      pushItem(item);
      if (selected.length >= limit) {
        break;
      }
    }
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function keywordSearch(items: SoisContextItem[], query: string, details: string, limit: number): SoisContextItem[] {
  if (!items.length || limit <= 0) {
    return [];
  }

  const focusTokens = extractFocusTokens(query, details);
  if (!focusTokens.length) {
    return [];
  }

  const scored = items
    .map((item) => {
      const normalizedText = item.text.toLowerCase();
      const textTokens = new Set(tokenize(item.text));
      let overlap = 0;
      let phraseHits = 0;

      for (const token of focusTokens) {
        if (textTokens.has(token)) {
          overlap += 1;
        }
        if (normalizedText.includes(token)) {
          phraseHits += 1;
        }
      }

      if (overlap === 0 && phraseHits === 0) {
        return null;
      }

      const score = overlap * 3 + phraseHits + (item.id.endsWith("-overview") ? 0.2 : 0);
      return { item, score };
    })
    .filter((entry): entry is { item: SoisContextItem; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.item);
}

function countNumericAnchors(value: string): number {
  return value.match(/\b\d+(?:[.,]\d+)?%?\b/g)?.length ?? 0;
}

function rankItemsForQueryIntent(items: SoisContextItem[], query: string, details: string): SoisContextItem[] {
  if (!items.length) {
    return [];
  }

  const focusTokens = extractFocusTokens(query, details);
  const combined = `${details} ${query}`.toLowerCase();
  const wantsPaywall = /\b(paywall|placement|gate|onboarding)\b/.test(combined);
  const wantsHealthFitness = /\bhealth\b.*\bfitness\b|\bfitness\b.*\bhealth\b/.test(combined);
  const wantsTrialOrConversion = /\b(trial|conversion|install to paid|paid)\b/.test(combined);
  const wantsRetention = /\b(retention|renewal|churn)\b/.test(combined);
  const wantsLtvOrPricing = /\b(ltv|price|pricing|revenue|arppu)\b/.test(combined);

  const scored = items.map((item, index) => {
    const text = item.text.toLowerCase();
    const textTokens = new Set(tokenize(item.text));
    let tokenHits = 0;
    let phraseHits = 0;

    for (const token of focusTokens) {
      if (textTokens.has(token)) {
        tokenHits += 1;
      }
      if (text.includes(token)) {
        phraseHits += 1;
      }
    }

    const numericAnchors = countNumericAnchors(item.text);
    let score = tokenHits * 3 + phraseHits * 1.5;

    if (item.id.includes("-metric-")) {
      score += 2.5;
    }
    if (item.id.endsWith("-overview")) {
      score -= 0.4;
    }

    score += Math.min(2.8, numericAnchors * 0.35);

    if (wantsPaywall && (item.category === "paywalls" || /paywall|placement|gate|onboarding/.test(text))) {
      score += 4;
    }
    if (wantsHealthFitness && /health and fitness|health|fitness/.test(text)) {
      score += 4;
    }
    if (wantsTrialOrConversion && /trial|conversion|install to paid|paid/.test(text)) {
      score += 2;
    }
    if (wantsRetention && /retention|renewal|churn/.test(text)) {
      score += 2;
    }
    if (wantsLtvOrPricing && /ltv|price|pricing|revenue|arppu/.test(text)) {
      score += 2;
    }

    return { item, score, index };
  });

  return scored
    .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score))
    .map((entry) => entry.item);
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }

  if (Math.abs(value) >= 10) {
    return value.toFixed(2);
  }

  return value.toFixed(2).replace(/0+$/g, "").replace(/\.$/, "");
}

function asPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function looksLikeRateKey(key: string): boolean {
  return /(rate|share|ratio|retention|refund|conversion|cr|churn|renewal)/i.test(key);
}

function formatMetricValue(key: string, value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  if (looksLikeRateKey(key) && value >= 0 && value <= 1) {
    return asPercent(value);
  }

  return compactNumber(value);
}

function quantile(values: number[], q: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[index] ?? 0;
}

const ORDINALS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eighth",
  9: "ninth",
  10: "tenth",
};

function normalizeLabel(value: string): string {
  const base = value
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base.replace(/\b([a-z]+)\s*(\d{1,2})\b/gi, (_, word, num) => {
    const n = Number.parseInt(num, 10);
    const ordinal = ORDINALS[n];
    return ordinal ? `${ordinal} ${word}` : `${word} ${num}`;
  });
}

function isScalar(value: unknown): value is string | number | boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}

const OPAQUE_IDENTIFIER_KEY_PATTERN = /(app[_\s-]?id|obfuscated|hash|token|uuid|user[_\s-]?id|device[_\s-]?id)/i;
const NON_METRIC_NUMERIC_KEY_PATTERN = /(timestamp|date|year|month|day)/i;
const MAX_REASONABLE_SOIS_METRIC_ABS = 1e15;

function isOpaqueIdentifierKey(key: string): boolean {
  return OPAQUE_IDENTIFIER_KEY_PATTERN.test(key);
}

function isNonMetricNumericKey(key: string): boolean {
  return NON_METRIC_NUMERIC_KEY_PATTERN.test(key);
}

function isLikelyOpaqueIdentifierValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 20) {
    return false;
  }

  if (/^[a-f0-9_-]{20,}$/i.test(trimmed) && /\d/.test(trimmed) && /[a-f]/i.test(trimmed)) {
    return true;
  }

  return false;
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(/,/g, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
      return null;
    }
    const n = Number.parseFloat(normalized);
    if (!Number.isFinite(n)) {
      return null;
    }
    if (Math.abs(n) > MAX_REASONABLE_SOIS_METRIC_ABS) {
      return null;
    }
    return n;
  }
  return null;
}

function collectNumericKeys(rows: Array<Record<string, unknown>>): string[] {
  const totals = new Map<string, { total: number; numeric: number }>();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const stat = totals.get(key) ?? { total: 0, numeric: 0 };
      stat.total += 1;
      if (toNumeric(value) !== null) {
        stat.numeric += 1;
      }
      totals.set(key, stat);
    }
  }

  return Array.from(totals.entries())
    .filter(([, stat]) => stat.numeric >= Math.max(4, Math.floor(stat.total * 0.35)))
    .sort((a, b) => b[1].numeric - a[1].numeric)
    .map(([key]) => key)
    .filter((key) => key !== "subcategory")
    .filter((key) => !isOpaqueIdentifierKey(key))
    .filter((key) => !isNonMetricNumericKey(key));
}

function collectDimensionKeys(rows: Array<Record<string, unknown>>): string[] {
  const stringKeyCounts = new Map<string, number>();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (
        typeof value === "string" &&
        value.trim() &&
        value.length <= 80 &&
        !isOpaqueIdentifierKey(key) &&
        !isLikelyOpaqueIdentifierValue(value)
      ) {
        stringKeyCounts.set(key, (stringKeyCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(stringKeyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 5);
}

function describeRow(row: Record<string, unknown>, dimensionKeys: string[]): string {
  const pairs: string[] = [];

  for (const key of dimensionKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      pairs.push(`${normalizeLabel(key)}=${value}`);
    }
    if (pairs.length >= 4) {
      break;
    }
  }

  if (!pairs.length) {
    for (const [key, value] of Object.entries(row)) {
      if (isOpaqueIdentifierKey(key)) {
        continue;
      }
      if (typeof value === "string" && isLikelyOpaqueIdentifierValue(value)) {
        continue;
      }
      if (isScalar(value)) {
        pairs.push(`${normalizeLabel(key)}=${String(value)}`);
      }
      if (pairs.length >= 3) {
        break;
      }
    }
  }

  return pairs.join(", ") || "aggregate row";
}

function extractRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    const rows: Array<Record<string, unknown>> = [];
    for (const item of payload) {
      if (isRecord(item) && Array.isArray(item.result)) {
        rows.push(...(item.result as unknown[]).filter(isRecord));
      } else if (isRecord(item) && !("result" in item && Array.isArray(item.result))) {
        rows.push(item);
      }
    }
    if (rows.length) return rows;
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const arrayCandidateKeys = ["data", "rows", "items", "result"];
  for (const key of arrayCandidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function buildEvidenceChunks(params: {
  target: SoisSectionTarget;
  rows: Array<Record<string, unknown>>;
  sourceUrl: string;
  maxMetrics: number;
}): SoisContextItem[] {
  const rows = params.rows;
  if (!rows.length) {
    return [];
  }

  const numericKeys = collectNumericKeys(rows).slice(0, params.maxMetrics);
  const dimensionKeys = collectDimensionKeys(rows);
  const items: SoisContextItem[] = [];

  const overviewColumns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  )
    .filter((key) => !isOpaqueIdentifierKey(key))
    .slice(0, 16);

  const globalRow = rows.find((row) => {
    const values = Object.values(row)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());

    return values.includes("global") || values.includes("all");
  });

  const overviewLines = [
    `${SOIS_REPORT_NAME} ${params.target.categoryLabel} ${params.target.subcategory}: ${params.target.subcategoryLabel}`,
    `Rows analyzed: ${rows.length.toLocaleString("en-US")}`,
    `Columns: ${overviewColumns.map((column) => normalizeLabel(column)).join(", ")}`,
  ];

  if (globalRow) {
    overviewLines.push(`Global row snapshot: ${describeRow(globalRow, dimensionKeys)}`);
    const benchmarkParts: string[] = [];
    for (const key of numericKeys) {
      const val = toNumeric(globalRow[key]);
      if (val !== null) {
        benchmarkParts.push(`${normalizeLabel(key)}: ${formatMetricValue(key, val)}`);
      }
    }
    if (benchmarkParts.length) {
      overviewLines.push(`Benchmarks: ${benchmarkParts.join(" | ")}`);
    }
  }

  items.push({
    id: `${params.target.key}-overview`,
    category: params.target.category,
    categoryLabel: params.target.categoryLabel,
    subcategory: params.target.subcategory,
    subcategoryLabel: params.target.subcategoryLabel,
    sourceUrl: params.sourceUrl,
    rows: rows.length,
    text: overviewLines.join("\n"),
  });

  for (const metricKey of numericKeys) {
    const metricRows = rows
      .map((row) => ({ row, value: toNumeric(row[metricKey]) }))
      .filter((item): item is { row: Record<string, unknown>; value: number } =>
        item.value !== null,
      );

    if (!metricRows.length) {
      continue;
    }

    const sorted = [...metricRows].sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const low = sorted[sorted.length - 1];
    const values = sorted.map((item) => item.value);
    const median = quantile(values, 0.5);
    const p90 = quantile(values, 0.9);

    const unitHint =
      /^(log_|price_|avg_ltv|median_ltv|ltv_)/i.test(metricKey) && !looksLikeRateKey(metricKey)
        ? " (USD or log scale — not a conversion rate)"
        : looksLikeRateKey(metricKey)
          ? " (rate: use as % only)"
          : "";
    const metricLines = [
      `${params.target.categoryLabel} ${params.target.subcategoryLabel} - ${normalizeLabel(metricKey)}${unitHint}`,
      `Median: ${formatMetricValue(metricKey, median)} | P90: ${formatMetricValue(metricKey, p90)} | Sample size: ${values.length}`,
      `Top: ${formatMetricValue(metricKey, top.value)} (${describeRow(top.row, dimensionKeys)})`,
      `Low: ${formatMetricValue(metricKey, low.value)} (${describeRow(low.row, dimensionKeys)})`,
    ];

    items.push({
      id: `${params.target.key}-metric-${metricKey}`,
      category: params.target.category,
      categoryLabel: params.target.categoryLabel,
      subcategory: params.target.subcategory,
      subcategoryLabel: params.target.subcategoryLabel,
      sourceUrl: params.sourceUrl,
      rows: rows.length,
      text: metricLines.join("\n"),
    });
  }

  return items;
}

function normalizeCategoryHint(value: unknown): SoisCategory | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  const allowedCategories: SoisCategory[] = [
    "ltv",
    "conversions",
    "pricing",
    "market",
    "retention",
    "refunds",
    "stores",
    "ai",
    "paywalls",
    "webpaywalls",
  ];

  return allowedCategories.includes(normalized as SoisCategory) ? (normalized as SoisCategory) : null;
}

function toStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function formatSnapshotMetricLine(metric: SoisSiteSnapshotMetric): string | null {
  if (typeof metric.key !== "string") {
    return null;
  }
  const min = toNumeric(metric.min);
  const p50 = toNumeric(metric.p50);
  const p90 = toNumeric(metric.p90);
  const max = toNumeric(metric.max);
  if (min === null || p50 === null || p90 === null || max === null) {
    return null;
  }

  const metricKey = metric.key.trim();
  if (!metricKey) {
    return null;
  }

  return `${normalizeLabel(metricKey)}: median ${formatMetricValue(metricKey, p50)} | p90 ${formatMetricValue(metricKey, p90)} | max ${formatMetricValue(metricKey, max)} (min ${formatMetricValue(metricKey, min)})`;
}

function summarizeDimensionSamples(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries = Object.entries(value)
    .map(([key, sampleValue]) => {
      const samples = toStringArray(sampleValue, 5);
      if (!samples.length || isOpaqueIdentifierKey(key)) {
        return null;
      }
      return `${normalizeLabel(key)}=${samples.join(" | ")}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 4);

  return entries.length ? entries.join("; ") : null;
}

async function readSoisSiteSnapshotItems(
  inputType: string,
): Promise<{ items: SoisContextItem[]; datasetCount: number; warning?: string }> {
  const enabled = parseBooleanFlag(process.env.ENABLE_SOIS_SITE_CONTEXT, true);
  if (!enabled) {
    return { items: [], datasetCount: 0 };
  }

  const allowedCategories = new Set(defaultCategorySelectionForPostType(inputType));
  if (!allowedCategories.size) {
    return { items: [], datasetCount: 0 };
  }

  let raw: string;
  try {
    raw = await fs.readFile(SOIS_SITE_CONTEXT_PATH, "utf8");
  } catch (error) {
    if (isRecord(error) && "code" in error && error.code === "ENOENT") {
      return { items: [], datasetCount: 0 };
    }
    return {
      items: [],
      datasetCount: 0,
      warning: `SOIS site snapshot read failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      items: [],
      datasetCount: 0,
      warning: `SOIS site snapshot JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.datasets)) {
    return {
      items: [],
      datasetCount: 0,
      warning: "SOIS site snapshot has invalid structure (missing datasets array).",
    };
  }

  const items: SoisContextItem[] = [];
  let datasetCount = 0;

  for (const [index, datasetValue] of parsed.datasets.entries()) {
    const dataset = isRecord(datasetValue) ? (datasetValue as SoisSiteSnapshotDataset) : null;
    if (!dataset) {
      continue;
    }

    const datasetCategory = normalizeCategoryHint(dataset.categoryHint) ?? "market";
    if (!allowedCategories.has(datasetCategory)) {
      continue;
    }

    const datasetId = typeof dataset.id === "string" && dataset.id.trim() ? dataset.id.trim() : `dataset-${index + 1}`;
    const datasetTitle =
      typeof dataset.title === "string" && dataset.title.trim() ? dataset.title.trim() : normalizeLabel(datasetId);
    const sourceUrl =
      typeof dataset.sourceUrl === "string" && dataset.sourceUrl.trim()
        ? dataset.sourceUrl.trim()
        : `${SOIS_SITE_CONTEXT_PATH}#${datasetId}`;
    const rowCountValue = toNumeric(dataset.rowCount);
    const rowCount = rowCountValue !== null ? Math.max(0, Math.round(rowCountValue)) : 0;
    const columns = toStringArray(dataset.columns, 16);
    const summaryLines = toStringArray(dataset.summaryLines, 5);
    const metricLines = Array.isArray(dataset.numericMetrics)
      ? dataset.numericMetrics
          .map((metric) => (isRecord(metric) ? formatSnapshotMetricLine(metric as SoisSiteSnapshotMetric) : null))
          .filter((line): line is string => Boolean(line))
          .slice(0, 4)
      : [];
    const dimensionsLine = summarizeDimensionSamples(dataset.dimensionSamples);

    const definition = SOIS_CATEGORY_DEFINITIONS[datasetCategory];
    const subcategory = 9000 + index + 1;
    const subcategoryLabel = datasetTitle;
    const categoryLabel = definition?.label ?? normalizeLabel(datasetCategory);

    const overviewParts = [
      `SOIS website dataset: ${datasetTitle}`,
      `Rows analyzed: ${rowCount.toLocaleString("en-US")}`,
      columns.length ? `Columns: ${columns.map((col) => normalizeLabel(col)).join(", ")}` : "",
      dimensionsLine ? `Filters: ${dimensionsLine}` : "",
      summaryLines.length ? `Highlights: ${summaryLines.join(" | ")}` : "",
    ].filter(Boolean);

    items.push({
      id: `site-${datasetId}-overview`,
      category: datasetCategory,
      categoryLabel,
      subcategory,
      subcategoryLabel,
      sourceUrl,
      rows: rowCount,
      text: overviewParts.join("\n"),
    });

    for (const [metricIndex, metricLine] of metricLines.entries()) {
      items.push({
        id: `site-${datasetId}-metric-${metricIndex + 1}`,
        category: datasetCategory,
        categoryLabel,
        subcategory,
        subcategoryLabel,
        sourceUrl,
        rows: rowCount,
        text: `${categoryLabel} ${subcategoryLabel} - snapshot metric\n${metricLine}`,
      });
    }

    datasetCount += 1;
  }

  return { items, datasetCount };
}

function inferCategoryFromAllDatasetId(datasetId: string): SoisCategory {
  const normalized = datasetId.toLowerCase();

  if (normalized.startsWith("pricing-")) {
    return "pricing";
  }
  if (normalized.startsWith("refund-")) {
    return "refunds";
  }
  if (normalized.startsWith("retention") || normalized.startsWith("renewal-")) {
    return "retention";
  }
  if (normalized.startsWith("ltv-") || normalized === "install-ltv") {
    return "ltv";
  }
  if (normalized.startsWith("conversion-") || normalized.startsWith("conversions-")) {
    return "conversions";
  }
  if (normalized.includes("paywall")) {
    return "paywalls";
  }

  return "market";
}

function resolveAllDatasetMetadata(datasetId: string): SoisAllDatasetMetadata {
  const known = SOIS_ALL_DATASET_METADATA[datasetId];
  if (known) {
    return known;
  }

  const category = inferCategoryFromAllDatasetId(datasetId);
  return {
    title: normalizeLabel(datasetId),
    category,
    subcategoryLabel: normalizeLabel(datasetId),
  };
}

function allDatasetIdFromItemId(itemId: string): string | null {
  if (!itemId.startsWith("all-")) {
    return null;
  }

  const withoutPrefix = itemId.slice("all-".length);
  const metricMarker = "-metric-";
  const metricMarkerIndex = withoutPrefix.indexOf(metricMarker);
  if (metricMarkerIndex > 0) {
    return withoutPrefix.slice(0, metricMarkerIndex);
  }

  const overviewSuffix = "-overview";
  if (withoutPrefix.endsWith(overviewSuffix) && withoutPrefix.length > overviewSuffix.length) {
    return withoutPrefix.slice(0, -overviewSuffix.length);
  }

  return null;
}

function countDistinctAllDatasetIds(items: SoisContextItem[]): number {
  const datasetIds = new Set<string>();
  for (const item of items) {
    const datasetId = allDatasetIdFromItemId(item.id);
    if (datasetId) {
      datasetIds.add(datasetId);
    }
  }
  return datasetIds.size;
}

function filterAllDatasetItemsAlreadyCoveredByApi(
  items: SoisContextItem[],
  fetchedApiTargetKeys: Set<string>,
): SoisContextItem[] {
  if (!items.length || !fetchedApiTargetKeys.size) {
    return items;
  }

  return items.filter((item) => {
    const datasetId = allDatasetIdFromItemId(item.id);
    if (!datasetId) {
      return true;
    }

    const mappedApiTarget = SOIS_ALL_DATASET_METADATA[datasetId]?.apiTargetKey;
    if (!mappedApiTarget) {
      return true;
    }

    return !fetchedApiTargetKeys.has(mappedApiTarget);
  });
}

function dedupeEvidenceItems(items: SoisContextItem[]): SoisContextItem[] {
  const unique: SoisContextItem[] = [];
  const seenIds = new Set<string>();
  const seenTextKeys = new Set<string>();

  for (const item of items) {
    if (!item.id || seenIds.has(item.id)) {
      continue;
    }

    const normalizedText = item.text.replace(/\s+/g, " ").trim().toLowerCase();
    const textKey = `${item.category}|${normalizedText}`;
    if (normalizedText && seenTextKeys.has(textKey)) {
      continue;
    }

    seenIds.add(item.id);
    if (normalizedText) {
      seenTextKeys.add(textKey);
    }
    unique.push(item);
  }

  return unique;
}

async function readSoisAllDatasetItems(
  inputType: string,
): Promise<{ items: SoisContextItem[]; datasetCount: number; warning?: string }> {
  const enabled = parseBooleanFlag(process.env.ENABLE_SOIS_ALL_DATASETS_CONTEXT, true);
  if (!enabled) {
    return { items: [], datasetCount: 0 };
  }

  const allowedCategories = new Set(defaultCategorySelectionForPostType(inputType));
  if (!allowedCategories.size) {
    return { items: [], datasetCount: 0 };
  }

  const maxMetrics = parsePositiveInt(process.env.SOIS_ALL_DATASETS_MAX_METRICS_PER_SECTION, 3, 8);

  let stat: { mtimeMs: number };
  try {
    stat = await fs.stat(SOIS_ALL_DATASETS_PATH);
  } catch (error) {
    if (isRecord(error) && "code" in error && error.code === "ENOENT") {
      return { items: [], datasetCount: 0 };
    }
    return {
      items: [],
      datasetCount: 0,
      warning: `SOIS all-datasets read failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (
    !soisAllDatasetsCache ||
    soisAllDatasetsCache.path !== SOIS_ALL_DATASETS_PATH ||
    soisAllDatasetsCache.mtimeMs !== stat.mtimeMs ||
    soisAllDatasetsCache.maxMetrics !== maxMetrics
  ) {
    let raw: string;
    try {
      raw = await fs.readFile(SOIS_ALL_DATASETS_PATH, "utf8");
    } catch (error) {
      return {
        items: [],
        datasetCount: 0,
        warning: `SOIS all-datasets read failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        items: [],
        datasetCount: 0,
        warning: `SOIS all-datasets JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!isRecord(parsed) || !isRecord(parsed.datasets)) {
      return {
        items: [],
        datasetCount: 0,
        warning: "SOIS all-datasets has invalid structure (missing datasets object).",
      };
    }

    const sourceOrigin =
      typeof parsed.sourceOrigin === "string" && parsed.sourceOrigin.trim()
        ? parsed.sourceOrigin.trim().replace(/\/+$/, "")
        : SOIS_SITE_ORIGIN_FALLBACK;

    const builtItems: SoisContextItem[] = [];
    let datasetIndex = 0;
    for (const [datasetId, payload] of Object.entries(parsed.datasets)) {
      if (!datasetId.trim()) {
        continue;
      }

      const rows = extractRows(payload);
      if (!rows.length) {
        continue;
      }

      const metadata = resolveAllDatasetMetadata(datasetId);
      const categoryDefinition = SOIS_CATEGORY_DEFINITIONS[metadata.category];
      const subcategory = metadata.subcategory ?? 9500 + datasetIndex + 1;
      const subcategoryLabel = metadata.subcategoryLabel ?? metadata.title;
      const target: SoisSectionTarget = {
        category: metadata.category,
        categoryLabel: categoryDefinition?.label ?? normalizeLabel(metadata.category),
        subcategory,
        subcategoryLabel,
        key: `all-${datasetId}`,
      };
      const sourceUrl = `${sourceOrigin}/data/${datasetId}.json`;
      const evidenceChunks = buildEvidenceChunks({
        target,
        rows,
        sourceUrl,
        maxMetrics,
      });

      builtItems.push(...evidenceChunks);
      datasetIndex += 1;
    }

    soisAllDatasetsCache = {
      path: SOIS_ALL_DATASETS_PATH,
      mtimeMs: stat.mtimeMs,
      maxMetrics,
      sourceOrigin,
      items: builtItems,
    };
  }

  const filteredItems = soisAllDatasetsCache.items.filter((item) => allowedCategories.has(item.category));
  return {
    items: filteredItems,
    datasetCount: countDistinctAllDatasetIds(filteredItems),
  };
}

function defaultCategorySelectionForPostType(inputType: string): SoisCategory[] {
  for (const rule of SOIS_POST_TYPE_CATEGORY_RULES) {
    if (rule.pattern.test(inputType)) {
      return rule.categories;
    }
  }

  if (ANALYSIS_POST_TYPE_PATTERN.test(inputType)) {
    return DEFAULT_ANALYSIS_CATEGORIES;
  }

  return [];
}

function resolveTargets(inputType: string): SoisSectionTarget[] {
  const categories = defaultCategorySelectionForPostType(inputType);

  const targets: SoisSectionTarget[] = [];

  for (const category of categories) {
    const definition = SOIS_CATEGORY_DEFINITIONS[category];
    if (!definition) {
      continue;
    }

    const selectedSubcategories = definition.subcategories.filter((entry) => entry.enabledByDefault !== false);

    for (const subcategory of selectedSubcategories) {
      targets.push({
        category,
        categoryLabel: definition.label,
        subcategory: subcategory.id,
        subcategoryLabel: subcategory.label,
        key: `${category}-${subcategory.id}`,
      });
    }
  }

  return targets;
}

function resolveCredentials(): { username: string; password: string } | null {
  const username =
    process.env.SOIS_DATA_USERNAME?.trim() ||
    process.env.SOIS_DATA_LOGIN?.trim() ||
    process.env.SOIS_BASIC_AUTH_USER?.trim() ||
    "";
  const password =
    process.env.SOIS_DATA_PASSWORD?.trim() ||
    process.env.SOIS_DATA_PASS?.trim() ||
    process.env.SOIS_BASIC_AUTH_PASSWORD?.trim() ||
    "";

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

function resolveBaseUrl(): string {
  return process.env.SOIS_DATA_URL?.trim() || SOIS_BASE_URL;
}

function makeSectionUrl(category: SoisCategory, subcategory: number): string {
  const url = new URL(resolveBaseUrl());
  url.searchParams.set("category", category);
  url.searchParams.set("subcategory", String(subcategory));
  return url.toString();
}

async function readSectionCache(target: SoisSectionTarget, ttlMs: number): Promise<unknown | null> {
  const cachePath = path.join(SOIS_CACHE_DIR, `${target.key}.json`);

  try {
    const stat = await fs.stat(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > ttlMs) {
      return null;
    }

    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

async function writeSectionCache(target: SoisSectionTarget, payload: unknown): Promise<void> {
  await fs.mkdir(SOIS_CACHE_DIR, { recursive: true });
  const cachePath = path.join(SOIS_CACHE_DIR, `${target.key}.json`);
  await fs.writeFile(
    cachePath,
    JSON.stringify(
      {
        category: target.category,
        subcategory: target.subcategory,
        fetchedAt: new Date().toISOString(),
        payload,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function fetchSection(target: SoisSectionTarget, credentials: { username: string; password: string }): Promise<unknown> {
  const url = makeSectionUrl(target.category, target.subcategory);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOIS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`SOIS endpoint failed for ${target.key}: ${response.status} ${response.statusText}`);
    }

    const body = await response.text();
    if (!body.trim()) {
      return [];
    }

    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

async function buildEvidenceData(inputType: string): Promise<SoisEvidenceData> {
  const enabled = parseBooleanFlag(process.env.ENABLE_SOIS_CONTEXT, true);
  if (!enabled) {
    return {
      items: [],
      hash: "",
      fetchedSections: 0,
      availableSections: 0,
      warning: "SOIS context disabled by ENABLE_SOIS_CONTEXT.",
    };
  }

  const targets = resolveTargets(inputType);
  if (!targets.length) {
    return {
      items: [],
      hash: "",
      fetchedSections: 0,
      availableSections: 0,
      warning: "SOIS context skipped because this post type does not require analysis-heavy benchmarks.",
    };
  }

  const [siteSnapshot, allDatasetSnapshot] = await Promise.all([
    readSoisSiteSnapshotItems(inputType),
    readSoisAllDatasetItems(inputType),
  ]);
  const snapshotWarnings = [siteSnapshot.warning, allDatasetSnapshot.warning].filter(
    (warning): warning is string => Boolean(warning),
  );
  const snapshotItems = dedupeEvidenceItems([...siteSnapshot.items, ...allDatasetSnapshot.items]);
  const snapshotSectionCount = siteSnapshot.datasetCount + allDatasetSnapshot.datasetCount;
  const availableSections = targets.length + snapshotSectionCount;

  const credentials = resolveCredentials();
  if (!credentials) {
    const combinedWarnings = [
      "SOIS credentials missing. Set SOIS_DATA_USERNAME and SOIS_DATA_PASSWORD.",
      ...snapshotWarnings,
    ]
      .filter(Boolean)
      .join(" | ");

    if (snapshotItems.length > 0) {
      const hash = toHash(snapshotItems.map((item) => `${item.id}|${item.text}`).join("\n---\n"));
      return {
        items: snapshotItems,
        hash,
        fetchedSections: snapshotSectionCount,
        availableSections,
        warning: combinedWarnings,
      };
    }

    return {
      items: [],
      hash: "",
      fetchedSections: 0,
      availableSections,
      warning: combinedWarnings,
    };
  }

  const apiItems: SoisContextItem[] = [];
  const fetchedApiTargetKeys = new Set<string>();
  let fetchedApiSections = 0;
  const warnings: string[] = [...snapshotWarnings];

  for (const target of targets) {
    try {
      const sourceUrl = makeSectionUrl(target.category, target.subcategory);
      let payload = await readSectionCache(target, SOIS_CACHE_TTL_MS);

      if (!payload) {
        payload = await fetchSection(target, credentials);
        await writeSectionCache(target, payload);
      }

      const rows = extractRows(payload);
      if (!rows.length) {
        continue;
      }

      fetchedApiSections += 1;
      fetchedApiTargetKeys.add(target.key);
      const evidenceChunks = buildEvidenceChunks({
        target,
        rows,
        sourceUrl,
        maxMetrics: SOIS_MAX_METRICS_PER_SECTION,
      });

      apiItems.push(...evidenceChunks);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const retainedAllDatasetItems = filterAllDatasetItemsAlreadyCoveredByApi(
    allDatasetSnapshot.items,
    fetchedApiTargetKeys,
  );
  const retainedAllDatasetCount = countDistinctAllDatasetIds(retainedAllDatasetItems);
  const droppedAllDatasetSections = Math.max(0, allDatasetSnapshot.datasetCount - retainedAllDatasetCount);
  if (droppedAllDatasetSections > 0) {
    warnings.push(
      `Suppressed ${droppedAllDatasetSections} all-datasets section(s) because overlapping SOIS API sections were available.`,
    );
  }

  const items = dedupeEvidenceItems([...siteSnapshot.items, ...retainedAllDatasetItems, ...apiItems]);
  const hash = toHash(items.map((item) => `${item.id}|${item.text}`).join("\n---\n"));

  return {
    items,
    hash,
    fetchedSections: siteSnapshot.datasetCount + retainedAllDatasetCount + fetchedApiSections,
    availableSections,
    warning: warnings.length ? warnings.slice(0, 5).join(" | ") : undefined,
  };
}

async function connectLanceDb(): Promise<LanceDbConnection> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(SOIS_LANCEDB_PATH);
}

async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const embeddings: number[][] = [];
  const batchSize = 40;

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize).map((text) => text.slice(0, 3500));
    const response = await client.embeddings.create({
      model,
      input: batch,
    });

    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

async function readLanceMeta(): Promise<{ hash: string; embeddingModel: string } | null> {
  try {
    const raw = await fs.readFile(SOIS_LANCEDB_META_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (typeof parsed?.hash === "string" && typeof parsed?.embeddingModel === "string") {
      return {
        hash: parsed.hash,
        embeddingModel: parsed.embeddingModel,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function writeLanceMeta(hash: string, embeddingModel: string): Promise<void> {
  await fs.mkdir(SOIS_LANCEDB_PATH, { recursive: true });
  await fs.writeFile(
    SOIS_LANCEDB_META_PATH,
    JSON.stringify(
      {
        hash,
        embeddingModel,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function ensureLanceTable(client: OpenAI, data: SoisEvidenceData): Promise<void> {
  if (!data.items.length) {
    return;
  }

  await fs.mkdir(SOIS_LANCEDB_PATH, { recursive: true });
  const db = await connectLanceDb();
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  try {
    const [meta, tableNames] = await Promise.all([readLanceMeta(), db.tableNames()]);
    const tableExists = tableNames.includes(SOIS_LANCEDB_TABLE_NAME);

    if (tableExists && meta?.hash === data.hash && meta.embeddingModel === embeddingModel) {
      return;
    }

    const vectors = await embedTexts(
      client,
      data.items.map((item) => item.text),
    );

    const rows = data.items.map((item, index) => ({
      itemId: item.id,
      text: item.text,
      category: item.category,
      subcategory: item.subcategory,
      vector: vectors[index],
    }));

    if (!rows.length) {
      return;
    }

    await db.createTable(SOIS_LANCEDB_TABLE_NAME, rows, {
      mode: tableExists ? "overwrite" : "create",
    });

    await writeLanceMeta(data.hash, embeddingModel);
  } finally {
    db.close();
  }
}

function lexicalSearch(items: SoisContextItem[], query: string, limit: number): SoisContextItem[] {
  if (!items.length) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return items.slice(0, limit);
  }

  return items
    .map((item) => {
      const textTokens = new Set(tokenize(item.text));
      const overlap = queryTokens.reduce((score, token) => score + Number(textTokens.has(token)), 0);
      const score = overlap / Math.max(4, Math.sqrt(textTokens.size));
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

async function lanceSearch(client: OpenAI, data: SoisEvidenceData, query: string, limit: number): Promise<SoisContextItem[]> {
  await ensureLanceTable(client, data);
  const db = await connectLanceDb();

  try {
    const table = await db.openTable(SOIS_LANCEDB_TABLE_NAME);
    const [queryVector] = await embedTexts(client, [query]);
    const rows = await table.vectorSearch(queryVector).limit(limit * 2).toArray();
    const byId = new Map(data.items.map((item) => [item.id, item]));
    const resolved: SoisContextItem[] = [];

    for (const row of rows as Array<Record<string, unknown>>) {
      const itemId = typeof row.itemId === "string" ? row.itemId : "";
      const found = byId.get(itemId);
      if (found && !resolved.some((item) => item.id === found.id)) {
        resolved.push(found);
      }
      if (resolved.length >= limit) {
        break;
      }
    }

    return resolved;
  } finally {
    db.close();
  }
}

export function shouldUseSoisContextForPostType(inputType: string): boolean {
  return ANALYSIS_POST_TYPE_PATTERN.test(inputType);
}

export async function retrieveSoisContext(params: {
  client?: OpenAI;
  query: string;
  details?: string;
  preferBroadCoverage?: boolean;
  inputType: string;
  limit: number;
}): Promise<{
  enabled: boolean;
  method: "none" | "lexical" | "lancedb" | "keyword" | "broad";
  items: SoisContextItem[];
  warning?: string;
  fetchedSections: number;
  availableSections: number;
}> {
  const evidenceData = await buildEvidenceData(params.inputType);

  if (!evidenceData.items.length) {
    return {
      enabled: false,
      method: "none",
      items: [],
      warning: evidenceData.warning,
      fetchedSections: evidenceData.fetchedSections,
      availableSections: evidenceData.availableSections,
    };
  }

  const details = params.details?.trim() ?? "";
  const focusQuery = [details, params.query].filter(Boolean).join(" | ").trim();
  const hasDetailDrivenIntent = hasSpecificSoisIntent(focusQuery, details);
  const useBroadCoverage = params.preferBroadCoverage || !details;
  const configuredBroadLimit = parsePositiveInt(process.env.SOIS_BROAD_CONTEXT_MAX_ITEMS, 60, 240);
  const broadLimit = Math.max(params.limit, configuredBroadLimit);

  if (useBroadCoverage) {
    return {
      enabled: true,
      method: "broad",
      items: broadCoverageSearch(evidenceData.items, broadLimit),
      warning: evidenceData.warning,
      fetchedSections: evidenceData.fetchedSections,
      availableSections: evidenceData.availableSections,
    };
  }

  if (hasDetailDrivenIntent) {
    const items = keywordSearch(evidenceData.items, focusQuery, details, params.limit);
    if (items.length) {
      return {
        enabled: true,
        method: "keyword",
        items: rankItemsForQueryIntent(items, focusQuery, details).slice(0, params.limit),
        warning: evidenceData.warning,
        fetchedSections: evidenceData.fetchedSections,
        availableSections: evidenceData.availableSections,
      };
    }
  }

  const useLanceDb = parseBooleanFlag(process.env.ENABLE_LANCEDB, false);

  if (useLanceDb && params.client) {
    try {
      const items = await lanceSearch(params.client, evidenceData, focusQuery || params.query, params.limit);
      if (items.length) {
        return {
          enabled: true,
          method: "lancedb",
          items: rankItemsForQueryIntent(items, focusQuery, details).slice(0, params.limit),
          warning: evidenceData.warning,
          fetchedSections: evidenceData.fetchedSections,
          availableSections: evidenceData.availableSections,
        };
      }
    } catch (error) {
      return {
        enabled: true,
        method: "lexical",
        items: rankItemsForQueryIntent(
          lexicalSearch(evidenceData.items, focusQuery || params.query, params.limit),
          focusQuery || params.query,
          details,
        ).slice(0, params.limit),
        warning:
          [
            evidenceData.warning,
            "SOIS LanceDB retrieval failed and fell back to lexical retrieval.",
            error instanceof Error ? error.message : String(error),
          ]
            .filter(Boolean)
            .join(" | "),
        fetchedSections: evidenceData.fetchedSections,
        availableSections: evidenceData.availableSections,
      };
    }
  }

  return {
    enabled: true,
    method: "lexical",
    items: rankItemsForQueryIntent(
      lexicalSearch(evidenceData.items, focusQuery || params.query, params.limit),
      focusQuery || params.query,
      details,
    ).slice(0, params.limit),
    warning: evidenceData.warning,
    fetchedSections: evidenceData.fetchedSections,
    availableSections: evidenceData.availableSections,
  };
}
