import { type ContentGoal } from "@/lib/constants";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_QUERY_LIMIT = 4;

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

  if (!enabled) {
    return {
      enabled: false,
      provider: "none",
      queries: [],
      sources: [],
      evidenceLines: [],
      warning: "Web fact-check is disabled.",
    };
  }

  if (!braveApiKey) {
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
      sources: [],
      evidenceLines: [],
      warning: "No fact-check queries could be built from this request.",
    };
  }

  try {
    const perQuery = Math.max(2, Math.ceil(maxResults / queries.length));
    const resultsByQuery = await Promise.all(queries.map((query) => searchBrave(query, braveApiKey, perQuery)));
    const sources = dedupeSources(resultsByQuery.flat()).slice(0, maxResults);

    return {
      enabled: true,
      provider: "brave",
      queries,
      sources,
      evidenceLines: sources.map((source, index) => toEvidenceLine(source, index)),
      warning: sources.length === 0 ? "No web evidence found for current query set." : undefined,
    };
  } catch (error) {
    return {
      enabled: true,
      provider: "brave",
      queries,
      sources: [],
      evidenceLines: [],
      warning: error instanceof Error ? error.message : "Web fact-check failed.",
    };
  }
}
