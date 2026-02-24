const DEFAULT_GIPHY_BASE_URL = "https://api.giphy.com/v1";
const DEFAULT_GIPHY_TIMEOUT_MS = 5000;

type GiphySearchImage = {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
};

type GiphyItem = {
  id?: string;
  title?: string;
  rating?: string;
  url?: string;
  images?: {
    original?: GiphySearchImage;
    fixed_width?: GiphySearchImage;
    fixed_width_downsampled?: GiphySearchImage;
    downsized_medium?: GiphySearchImage;
  };
};

type GiphyResponse = {
  data?: GiphyItem[] | GiphyItem;
};

export type GiphyVariant = {
  rank: number;
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  sourceQuery: string;
  rating?: string;
};

function normalizeNoEmDashText(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function getGiphyBaseUrl(): string {
  const custom = process.env.GIPHY_BASE_URL?.trim();
  if (!custom) {
    return DEFAULT_GIPHY_BASE_URL;
  }
  const trimmed = custom.replace(/\/+$/g, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function buildSafeQuery(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItem(item: GiphyItem, rank: number, sourceQuery: string): GiphyVariant | null {
  const id = item.id?.trim();
  if (!id) {
    return null;
  }

  const originalUrl = item.images?.original?.url?.trim();
  const fixedWidthWebp = item.images?.fixed_width?.webp?.trim();
  const fixedWidthUrl = item.images?.fixed_width?.url?.trim();
  const downsampledWebp = item.images?.fixed_width_downsampled?.webp?.trim();
  const downsizedUrl = item.images?.downsized_medium?.url?.trim();

  const previewUrl = fixedWidthWebp || fixedWidthUrl || downsampledWebp || downsizedUrl || originalUrl || item.url?.trim();
  const openUrl = originalUrl || item.url?.trim() || previewUrl;

  if (!previewUrl || !openUrl) {
    return null;
  }

  const title = normalizeNoEmDashText(item.title?.trim() || `GIF ${id}`);
  const rating = item.rating?.trim();

  return {
    rank,
    id,
    title,
    url: openUrl,
    previewUrl,
    sourceQuery,
    rating: rating || undefined,
  };
}

async function fetchJson(url: string): Promise<GiphyResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_GIPHY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`GIPHY request failed (${response.status})`);
    }

    return (await response.json()) as GiphyResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildGiphyQuery(params: {
  hook: string;
  body: string;
  memeBrief?: string;
  giphyQuery?: string;
}): string {
  const firstBodyLine =
    params.body
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => line.length > 10) || "";

  const composed = [
    params.hook.trim(),
    firstBodyLine,
    params.memeBrief?.trim(),
    params.giphyQuery?.trim(),
  ]
    .filter(Boolean)
    .join(" ");

  const safe = buildSafeQuery(composed);
  if (!safe) {
    return "app growth meme";
  }

  return safe.length > 60 ? safe.slice(0, 60).replace(/\s+\S*$/, "").trim() : safe;
}

export async function fetchGiphyVariants(params: {
  apiKey: string;
  query: string;
  limit: number;
}): Promise<GiphyVariant[]> {
  const safeQuery = buildSafeQuery(params.query);
  if (!safeQuery) {
    return [];
  }

  const limit = Math.max(1, Math.min(10, Math.trunc(params.limit)));
  const baseUrl = getGiphyBaseUrl();
  const searchUrl = `${baseUrl}/gifs/search?api_key=${encodeURIComponent(params.apiKey)}&q=${encodeURIComponent(
    safeQuery,
  )}&limit=${limit}&rating=pg-13&lang=en`;
  const searchPayload = await fetchJson(searchUrl);
  const searchData = Array.isArray(searchPayload.data) ? searchPayload.data : [];
  const searchVariants = searchData
    .map((item, index) => normalizeItem(item, index + 1, safeQuery))
    .filter((item): item is GiphyVariant => Boolean(item))
    .slice(0, limit);

  if (searchVariants.length > 0) {
    return searchVariants;
  }

  const translateUrl = `${baseUrl}/gifs/translate?api_key=${encodeURIComponent(params.apiKey)}&s=${encodeURIComponent(
    safeQuery,
  )}&rating=pg-13`;
  const translatePayload = await fetchJson(translateUrl);
  const translateItem = !Array.isArray(translatePayload.data)
    ? (translatePayload.data as GiphyItem | undefined)
    : translatePayload.data[0];
  const normalized = translateItem ? normalizeItem(translateItem, 1, safeQuery) : null;

  return normalized ? [normalized] : [];
}

export function ensureDistinctGiphyVariants(
  variants: GiphyVariant[],
  limit: number,
): GiphyVariant[] {
  const seenIds = new Set<string>();
  const deduped: GiphyVariant[] = [];

  for (const variant of variants) {
    if (seenIds.has(variant.id)) {
      continue;
    }
    seenIds.add(variant.id);
    deduped.push({
      ...variant,
      rank: deduped.length + 1,
    });
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}
