import { type ContentGoal } from "@/lib/constants";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_QUERY_LIMIT = 4;
const DEFAULT_DETAILS_URL_LIMIT = 3;
const DEFAULT_DETAILS_URL_TIMEOUT_MS = 8000;
const DEFAULT_DETAILS_URL_CURL_MAX_BUFFER_BYTES = 4_000_000;
const CURL_META_MARKER = "__OPENCLAW_CURL_META__";
const DETAILS_URL_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5";
const DETAILS_URL_USER_AGENT = "openclaw-adapty-bot/1.0 (+https://appstate2.vercel.app/)";
const execFileAsync = promisify(execFile);

export type WebFactCheckRequest = {
  style: string;
  goal: ContentGoal;
  inputType: string;
  details: string;
  time: string;
  place: string;
  ctaLink: string;
};

export type WebFactCheckSource = {
  query: string;
  title: string;
  url: string;
  snippet: string;
};

export type WebFactCheckResult = {
  enabled: boolean;
  provider: "brave" | "none";
  queries: string[];
  sources: WebFactCheckSource[];
  evidenceLines: string[];
  warning?: string;
};

type BraveSearchResultItem = {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResultItem[];
  };
};

type DetailsUrlFetchResult = {
  body: string;
  contentType: string;
  effectiveUrl: string;
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

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHost(urlValue: string): string {
  const trimmed = urlValue.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.replace(/^www\./i, "").trim();
  } catch {
    return "";
  }
}

function parsePositiveInt(value: string | undefined, fallback: number, max = 20): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, parsed);
}

function normalizeExtractedUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/[),.;!?]+$/g, "");
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractDetailUrls(details: string, limit: number): string[] {
  const matches = details.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  return dedupeStrings(matches.map((url) => normalizeExtractedUrl(url)).filter(Boolean)).slice(0, limit);
}

function readMetaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      const content = match?.[1] ? stripHtmlTags(match[1]) : "";
      if (content) {
        return content;
      }
    }
  }

  return "";
}

function extractHtmlEvidence(html: string): { title: string; snippet: string } {
  const safeHtml = html.slice(0, 240_000);
  const title =
    stripHtmlTags(safeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    readMetaContent(safeHtml, ["og:title", "twitter:title"]);

  const metaDescription =
    readMetaContent(safeHtml, ["description", "og:description", "twitter:description"]) || "";

  const paragraphMatches = Array.from(safeHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripHtmlTags(match[1] ?? ""))
    .filter(Boolean);

  const paragraphSnippet = truncate(paragraphMatches.slice(0, 2).join(" "), 280);
  const snippet = truncate(metaDescription || paragraphSnippet || "No summary available from linked page.", 240);

  return {
    title: truncate(title || "Linked source", 120),
    snippet,
  };
}

async function fetchDetailsUrlSourceViaNode(
  url: string,
  timeoutMs: number,
): Promise<DetailsUrlFetchResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": DETAILS_URL_USER_AGENT,
        Accept: DETAILS_URL_ACCEPT_HEADER,
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const body = await response.text();
    if (!body.trim()) {
      return null;
    }

    const effectiveUrl = normalizeExtractedUrl(response.url) || url;
    return {
      body,
      contentType,
      effectiveUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDetailsUrlSourceViaCurl(
  url: string,
  timeoutMs: number,
): Promise<DetailsUrlFetchResult | null> {
  const maxTimeSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const markerWithBreak = `\n${CURL_META_MARKER}`;

  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-L",
        "--silent",
        "--show-error",
        "--fail",
        "--compressed",
        "--max-time",
        String(maxTimeSeconds),
        "-A",
        DETAILS_URL_USER_AGENT,
        "-H",
        `Accept: ${DETAILS_URL_ACCEPT_HEADER}`,
        "-w",
        `${markerWithBreak}%{content_type}|%{url_effective}`,
        url,
      ],
      {
        maxBuffer: DEFAULT_DETAILS_URL_CURL_MAX_BUFFER_BYTES,
        windowsHide: true,
      },
    );

    if (!stdout.trim()) {
      return null;
    }

    const markerIndex = stdout.lastIndexOf(markerWithBreak);
    const body = (markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout).trim();
    if (!body) {
      return null;
    }

    if (markerIndex < 0) {
      return {
        body,
        contentType: "",
        effectiveUrl: url,
      };
    }

    const metadata = stdout.slice(markerIndex + markerWithBreak.length).trim();
    const [rawContentType = "", rawEffectiveUrl = ""] = metadata.split("|");
    return {
      body,
      contentType: rawContentType.trim().toLowerCase(),
      effectiveUrl: normalizeExtractedUrl(rawEffectiveUrl.trim()) || url,
    };
  } catch {
    return null;
  }
}

async function fetchDetailsUrlSource(
  url: string,
  timeoutMs: number,
): Promise<WebFactCheckSource | null> {
  const fetchResult =
    (await fetchDetailsUrlSourceViaNode(url, timeoutMs)) ??
    (await fetchDetailsUrlSourceViaCurl(url, timeoutMs));
  if (!fetchResult) {
    return null;
  }

  const contentType = fetchResult.contentType.toLowerCase();
  const body = fetchResult.body;
  let title = "Linked source";
  let snippet = "";

  if (contentType.includes("text/html") || /<html[\s>]/i.test(body)) {
    const extracted = extractHtmlEvidence(body);
    title = extracted.title;
    snippet = extracted.snippet;
  } else {
    snippet = truncate(compactWhitespace(body), 240);
    if (contentType.includes("application/json")) {
      title = "Linked JSON source";
    } else if (contentType.includes("text/plain")) {
      title = "Linked text source";
    }
  }

  if (!snippet) {
    return null;
  }

  return {
    query: "details_url",
    title,
    url: fetchResult.effectiveUrl || url,
    snippet,
  };
}

async function fetchDetailsUrlSources(details: string): Promise<WebFactCheckSource[]> {
  const limit = parsePositiveInt(process.env.DETAILS_URL_FETCH_LIMIT, DEFAULT_DETAILS_URL_LIMIT, 10);
  const timeoutMs = parsePositiveInt(
    process.env.DETAILS_URL_FETCH_TIMEOUT_MS,
    DEFAULT_DETAILS_URL_TIMEOUT_MS,
    30000,
  );
  const urls = extractDetailUrls(details, limit);
  if (!urls.length) {
    return [];
  }

  const sources = await Promise.all(urls.map((url) => fetchDetailsUrlSource(url, timeoutMs)));
  return sources.filter((source): source is WebFactCheckSource => Boolean(source));
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function buildFactCheckQueries(input: WebFactCheckRequest): string[] {
  const cleanType = truncate(compactWhitespace(input.inputType), 80);
  const cleanDetails = truncate(compactWhitespace(input.details), 180);
  const cleanTime = truncate(compactWhitespace(input.time), 80);
  const cleanPlace = truncate(compactWhitespace(input.place), 80);
  const cleanStyle = truncate(compactWhitespace(input.style), 80);
  const ctaHost = extractHost(input.ctaLink);

  const candidateQueries = [
    cleanDetails ? `${cleanType} ${cleanDetails}` : "",
    cleanTime || cleanPlace ? `Adapty ${cleanType} ${cleanPlace} ${cleanTime}`.trim() : "",
    ctaHost ? `${cleanType} ${ctaHost}` : "",
    `Adapty mobile app monetization ${input.goal}`,
    cleanStyle ? `${cleanStyle} B2C mobile app growth` : "",
  ];

  return dedupeStrings(candidateQueries).slice(0, DEFAULT_QUERY_LIMIT);
}

function normalizeSnippet(item: BraveSearchResultItem): string {
  const raw = [item.description ?? "", ...(item.extra_snippets ?? [])]
    .map((value) => compactWhitespace(value))
    .filter(Boolean)
    .join(" ");

  return truncate(raw, 240);
}

async function searchBrave(
  query: string,
  apiKey: string,
  maxPerQuery: number,
): Promise<WebFactCheckSource[]> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxPerQuery));
  url.searchParams.set("country", "us");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("text_decorations", "0");
  url.searchParams.set("spellcheck", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave search failed (${response.status}): ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as BraveSearchResponse;
  const items = payload.web?.results ?? [];

  return items
    .map((item) => {
      const title = compactWhitespace(item.title ?? "");
      const urlValue = compactWhitespace(item.url ?? "");
      const snippet = normalizeSnippet(item);

      if (!title || !urlValue || !snippet) {
        return null;
      }

      return {
        query,
        title: truncate(title, 120),
        url: urlValue,
        snippet,
      };
    })
    .filter((item): item is WebFactCheckSource => Boolean(item));
}

function dedupeSources(sources: WebFactCheckSource[]): WebFactCheckSource[] {
  const seen = new Set<string>();
  const deduped: WebFactCheckSource[] = [];

  for (const source of sources) {
    const key = source.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function toEvidenceLine(source: WebFactCheckSource, index: number): string {
  let domain = "";

  try {
    domain = new URL(source.url).hostname.replace(/^www\./i, "");
  } catch {
    domain = "";
  }

  const domainPart = domain ? ` (${domain})` : "";
  return `${index + 1}. ${source.title}${domainPart} - ${source.snippet} [${source.url}]`;
}

export async function runWebFactCheck(input: WebFactCheckRequest): Promise<WebFactCheckResult> {
  const braveApiKey =
    process.env.BRAVE_SEARCH_API_KEY?.trim() ??
    process.env.WEB_FACT_CHECK_BRAVE_API_KEY?.trim() ??
    "";
  const maxResultsRaw = Number.parseInt(process.env.WEB_FACT_CHECK_MAX_RESULTS ?? "", 10);
  const maxResults =
    Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
      ? Math.min(20, maxResultsRaw)
      : DEFAULT_MAX_RESULTS;
  const enabled = parseBooleanEnv(process.env.ENABLE_WEB_FACT_CHECK, Boolean(braveApiKey));
  const detailsUrlSources = await fetchDetailsUrlSources(input.details);
  const hasLinkedPromptEvidence = detailsUrlSources.length > 0;

  if (!enabled) {
    return {
      enabled: hasLinkedPromptEvidence,
      provider: "none",
      queries: [],
      sources: detailsUrlSources,
      evidenceLines: detailsUrlSources.map((source, index) => toEvidenceLine(source, index)),
      warning: hasLinkedPromptEvidence
        ? "Web search disabled; using linked URL evidence from prompt."
        : "Web fact-check is disabled.",
    };
  }

  if (!braveApiKey) {
    if (hasLinkedPromptEvidence) {
      return {
        enabled: true,
        provider: "none",
        queries: [],
        sources: detailsUrlSources,
        evidenceLines: detailsUrlSources.map((source, index) => toEvidenceLine(source, index)),
        warning: "Brave key missing; using linked URL evidence from prompt.",
      };
    }

    return {
      enabled: false,
      provider: "none",
      queries: [],
      sources: [],
      evidenceLines: [],
      warning: "Web fact-check key is missing. Set BRAVE_SEARCH_API_KEY.",
    };
  }

  const queries = buildFactCheckQueries(input);
  if (!queries.length) {
    return {
      enabled: true,
      provider: "brave",
      queries: [],
      sources: detailsUrlSources,
      evidenceLines: detailsUrlSources.map((source, index) => toEvidenceLine(source, index)),
      warning: "No fact-check queries could be built from this request.",
    };
  }

  try {
    const perQuery = Math.max(2, Math.ceil(maxResults / queries.length));
    const resultsByQuery = await Promise.all(queries.map((query) => searchBrave(query, braveApiKey, perQuery)));
    const sources = dedupeSources([...detailsUrlSources, ...resultsByQuery.flat()]).slice(0, maxResults);

    return {
      enabled: true,
      provider: "brave",
      queries,
      sources,
      evidenceLines: sources.map((source, index) => toEvidenceLine(source, index)),
      warning: sources.length === 0 ? "No web evidence found for current query set." : undefined,
    };
  } catch (error) {
    const fallbackSources = dedupeSources(detailsUrlSources).slice(0, maxResults);
    return {
      enabled: fallbackSources.length > 0,
      provider: "brave",
      queries,
      sources: fallbackSources,
      evidenceLines: fallbackSources.map((source, index) => toEvidenceLine(source, index)),
      warning:
        [
          error instanceof Error ? error.message : "Web fact-check failed.",
          fallbackSources.length > 0 ? "Using linked URL evidence from prompt." : "",
        ]
          .filter(Boolean)
          .join(" "),
    };
  }
}
