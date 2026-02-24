import { RSS_FEEDS, type RssFeed } from "@/config/rss-feeds";
import { type ContentGoal } from "@/lib/constants";

const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_TOP_ITEMS = 4;
const DEFAULT_FEED_TIMEOUT_MS = 4500;
const DEFAULT_ITEMS_PER_FEED = 12;
const MAX_XML_LENGTH = 1_800_000;
const INDUSTRY_NEWS_PATTERN = /\bindustry news reaction\b/i;
const TOPIC_SIMILARITY_THRESHOLD = 0.52;

type RawNewsItem = {
  sourceId: string;
  sourceName: string;
  category: RssFeed["category"];
  priority: RssFeed["priority"];
  title: string;
  url: string;
  summary: string;
  publishedAtMs: number;
};

export type RankedIndustryNewsItem = {
  sourceId: string;
  sourceName: string;
  category: RssFeed["category"];
  priority: RssFeed["priority"];
  title: string;
  url: string;
  summary: string;
  publishedAtIso: string;
  ageDays: number;
  score: number;
  matchedKeywords: string[];
};

export type IndustryNewsContext = {
  enabled: boolean;
  items: RankedIndustryNewsItem[];
  warning?: string;
  feedsAttempted: number;
  feedsSucceeded: number;
};

export type IndustryNewsInput = {
  style: string;
  goal: ContentGoal;
  inputType: string;
  details: string;
};

type CachedFeedSnapshot = {
  expiresAt: number;
  items: RawNewsItem[];
  feedsAttempted: number;
  feedsSucceeded: number;
  warning?: string;
};

type RankedCandidate = {
  item: RawNewsItem;
  score: number;
  matchedKeywords: string[];
  ageDays: number;
};

const feedCache: CachedFeedSnapshot = {
  expiresAt: 0,
  items: [],
  feedsAttempted: 0,
  feedsSucceeded: 0,
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.min(max, parsed);
}

function shouldUseIndustryNewsContext(inputType: string): boolean {
  return INDUSTRY_NEWS_PATTERN.test(inputType);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value: string): string {
  return compactWhitespace(decodeEntities(stripHtml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
}

function tokenizeTopicText(value: string): Set<string> {
  const stopwords = new Set([
    "about",
    "after",
    "again",
    "also",
    "amid",
    "among",
    "apps",
    "app",
    "are",
    "beta",
    "change",
    "changes",
    "for",
    "from",
    "here",
    "into",
    "just",
    "latest",
    "more",
    "most",
    "news",
    "new",
    "now",
    "over",
    "patch",
    "post",
    "release",
    "rollout",
    "says",
    "that",
    "the",
    "their",
    "this",
    "today",
    "update",
    "version",
    "week",
    "with",
    "you",
    "your",
  ]);

  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !stopwords.has(token))
    .filter((token) => !/^\d+(\.\d+)*$/.test(token));

  return new Set(normalized.slice(0, 48));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  if (!union) {
    return 0;
  }

  return intersection / union;
}

function isNearDuplicateTopic(a: RawNewsItem, b: RawNewsItem): boolean {
  const aTokens = tokenizeTopicText(`${a.title} ${a.summary}`);
  const bTokens = tokenizeTopicText(`${b.title} ${b.summary}`);

  return jaccardSimilarity(aTokens, bTokens) >= TOPIC_SIMILARITY_THRESHOLD;
}

function selectDiversifiedRankedItems(ranked: RankedCandidate[], target: number): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  const selectedUrls = new Set<string>();

  for (const candidate of ranked) {
    const candidateUrl = candidate.item.url.toLowerCase().trim();
    if (selectedUrls.has(candidateUrl)) {
      continue;
    }

    const tooSimilar = selected.some((existing) => isNearDuplicateTopic(candidate.item, existing.item));
    if (tooSimilar) {
      continue;
    }

    selected.push(candidate);
    selectedUrls.add(candidateUrl);

    if (selected.length >= target) {
      return selected;
    }
  }

  for (const candidate of ranked) {
    const candidateUrl = candidate.item.url.toLowerCase().trim();
    if (selectedUrls.has(candidateUrl)) {
      continue;
    }

    selected.push(candidate);
    selectedUrls.add(candidateUrl);

    if (selected.length >= target) {
      break;
    }
  }

  return selected;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTagValue(block: string, tagName: string): string {
  const pattern = new RegExp(`<${escapeRegex(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(tagName)}>`, "i");
  const match = block.match(pattern);
  return match ? normalizeText(match[1]) : "";
}

function extractAtomLink(entryBlock: string): string {
  const linkTags = Array.from(entryBlock.matchAll(/<link\b([^>]*)>/gi)).map((match) => match[1] ?? "");
  if (!linkTags.length) {
    return "";
  }

  const parseAttrs = (attrsRaw: string) => {
    const relMatch = attrsRaw.match(/\brel=["']([^"']+)["']/i);
    const hrefMatch = attrsRaw.match(/\bhref=["']([^"']+)["']/i);
    return {
      rel: (relMatch?.[1] ?? "").toLowerCase(),
      href: (hrefMatch?.[1] ?? "").trim(),
    };
  };

  const parsed = linkTags.map(parseAttrs).filter((tag) => Boolean(tag.href));
  const preferred = parsed.find((tag) => !tag.rel || tag.rel === "alternate");
  return preferred?.href ?? parsed[0]?.href ?? "";
}

function parseDateToMs(value: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRssItems(xml: string, feed: RssFeed): RawNewsItem[] {
  const itemBlocks = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]);
  const entryBlocks = Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((match) => match[0]);

  const rssItems = itemBlocks.map((block) => {
    const title = extractTagValue(block, "title");
    const url = extractTagValue(block, "link") || extractTagValue(block, "guid");
    const summary =
      extractTagValue(block, "description") ||
      extractTagValue(block, "content:encoded") ||
      extractTagValue(block, "content");
    const publishedAtMs =
      parseDateToMs(extractTagValue(block, "pubDate")) ||
      parseDateToMs(extractTagValue(block, "dc:date")) ||
      parseDateToMs(extractTagValue(block, "published"));

    return {
      sourceId: feed.id,
      sourceName: feed.name,
      category: feed.category,
      priority: feed.priority,
      title,
      url,
      summary: truncate(summary, 320),
      publishedAtMs,
    };
  });

  const atomItems = entryBlocks.map((block) => {
    const title = extractTagValue(block, "title");
    const url = extractAtomLink(block);
    const summary = extractTagValue(block, "summary") || extractTagValue(block, "content");
    const publishedAtMs =
      parseDateToMs(extractTagValue(block, "updated")) || parseDateToMs(extractTagValue(block, "published"));

    return {
      sourceId: feed.id,
      sourceName: feed.name,
      category: feed.category,
      priority: feed.priority,
      title,
      url,
      summary: truncate(summary, 320),
      publishedAtMs,
    };
  });

  return [...rssItems, ...atomItems]
    .filter((item) => Boolean(item.title) && Boolean(item.url) && item.publishedAtMs > 0)
    .slice(0, DEFAULT_ITEMS_PER_FEED);
}

async function fetchFeedXml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        "User-Agent": "OpenClaw-Adapty-NewsBot/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`feed fetch failed (${response.status})`);
    }
    const xml = await response.text();
    return xml.slice(0, MAX_XML_LENGTH);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadRecentFeedItems(maxAgeDays: number): Promise<CachedFeedSnapshot> {
  const now = Date.now();
  if (feedCache.expiresAt > now) {
    return feedCache;
  }

  const enabledFeeds = RSS_FEEDS.filter((feed) => feed.enabled);
  const feedTimeoutMs = parsePositiveInt(process.env.RSS_NEWS_FEED_TIMEOUT_MS, DEFAULT_FEED_TIMEOUT_MS, 1000, 12000);
  const oldestAllowedMs = now - maxAgeDays * 24 * 60 * 60 * 1000;

  const settled = await Promise.allSettled(
    enabledFeeds.map(async (feed) => {
      const xml = await fetchFeedXml(feed.url, feedTimeoutMs);
      return parseRssItems(xml, feed);
    }),
  );

  const items: RawNewsItem[] = [];
  let feedsSucceeded = 0;

  for (const result of settled) {
    if (result.status !== "fulfilled") {
      continue;
    }
    feedsSucceeded += 1;
    for (const item of result.value) {
      if (item.publishedAtMs >= oldestAllowedMs) {
        items.push(item);
      }
    }
  }

  const dedupedByUrl = new Map<string, RawNewsItem>();
  for (const item of items) {
    const key = item.url.toLowerCase().trim();
    const existing = dedupedByUrl.get(key);
    if (!existing || item.publishedAtMs > existing.publishedAtMs) {
      dedupedByUrl.set(key, item);
    }
  }

  const dedupedItems = Array.from(dedupedByUrl.values()).sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  const warning = feedsSucceeded === 0 ? "RSS fetch failed for all configured feeds." : undefined;
  const cacheTtlMs = parsePositiveInt(process.env.RSS_NEWS_CACHE_TTL_SECONDS, 600, 30, 3600) * 1000;

  feedCache.expiresAt = Date.now() + cacheTtlMs;
  feedCache.items = dedupedItems;
  feedCache.feedsAttempted = enabledFeeds.length;
  feedCache.feedsSucceeded = feedsSucceeded;
  feedCache.warning = warning;

  return feedCache;
}

function buildKeywordSet(input: IndustryNewsInput): string[] {
  const stopwords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "from",
    "have",
    "just",
    "more",
    "most",
    "that",
    "this",
    "with",
    "your",
    "what",
    "when",
    "where",
    "which",
    "will",
    "into",
    "over",
    "under",
  ]);

  const baseTerms = [
    "ios",
    "android",
    "subscriptions",
    "paywall",
    "retention",
    "trial",
    "pricing",
    "store",
    "policy",
    "privacy",
    "attribution",
    "acquisition",
    "monetization",
    "growth",
  ];

  const dynamicText = `${input.details} ${input.style} ${input.goal}`.toLowerCase();
  const dynamicTerms = dynamicText
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));

  const uniqueTerms = Array.from(new Set([...baseTerms, ...dynamicTerms]));
  return uniqueTerms.slice(0, 30);
}

function rankItem(item: RawNewsItem, keywords: string[]): { score: number; matchedKeywords: string[]; ageDays: number } {
  const now = Date.now();
  const ageDays = Math.max(0, (now - item.publishedAtMs) / (24 * 60 * 60 * 1000));
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => text.includes(keyword));

  const priorityScore = (4 - item.priority) * 10;
  const keywordScore = Math.min(28, matchedKeywords.length * 4);
  const freshnessScore = ageDays <= 1 ? 18 : ageDays <= 2 ? 14 : ageDays <= 4 ? 10 : ageDays <= 7 ? 6 : 0;
  const score = priorityScore + keywordScore + freshnessScore;

  return {
    score,
    matchedKeywords: Array.from(new Set(matchedKeywords)).slice(0, 8),
    ageDays,
  };
}

export async function runIndustryNewsContext(input: IndustryNewsInput): Promise<IndustryNewsContext> {
  const enabledByEnv = parseBooleanEnv(process.env.ENABLE_RSS_INDUSTRY_NEWS, true);
  if (!enabledByEnv || !shouldUseIndustryNewsContext(input.inputType)) {
    return {
      enabled: false,
      items: [],
      feedsAttempted: 0,
      feedsSucceeded: 0,
    };
  }

  const maxAgeDays = parsePositiveInt(process.env.RSS_NEWS_MAX_AGE_DAYS, DEFAULT_MAX_AGE_DAYS, 1, 14);
  const topItemsTarget = parsePositiveInt(process.env.RSS_NEWS_TOP_ITEMS, DEFAULT_TOP_ITEMS, 3, 5);
  const snapshot = await loadRecentFeedItems(maxAgeDays);
  const keywords = buildKeywordSet(input);

  const rankedAll = snapshot.items
    .map((item) => {
      const scoreData = rankItem(item, keywords);
      return {
        item,
        ...scoreData,
      };
    })
    .sort((a, b) => b.score - a.score || b.item.publishedAtMs - a.item.publishedAtMs);

  const ranked = selectDiversifiedRankedItems(rankedAll, topItemsTarget);

  const items: RankedIndustryNewsItem[] = ranked.map((entry) => ({
    sourceId: entry.item.sourceId,
    sourceName: entry.item.sourceName,
    category: entry.item.category,
    priority: entry.item.priority,
    title: entry.item.title,
    url: entry.item.url,
    summary: entry.item.summary,
    publishedAtIso: new Date(entry.item.publishedAtMs).toISOString(),
    ageDays: Number(entry.ageDays.toFixed(2)),
    score: entry.score,
    matchedKeywords: entry.matchedKeywords,
  }));

  return {
    enabled: true,
    items,
    warning: snapshot.warning,
    feedsAttempted: snapshot.feedsAttempted,
    feedsSucceeded: snapshot.feedsSucceeded,
  };
}
