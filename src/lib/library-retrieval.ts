import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";
import { GOAL_LABELS, type ContentGoal } from "@/lib/constants";

const ADAPTY_LIBRARY_PATH = path.join(process.cwd(), "content", "linkedin-adapty-library.txt");
const OTHERS_LIBRARY_PATH = path.join(process.cwd(), "content", "linkedin-others-library.txt");
const LIBRARY_SOURCES = [
  { source: "adapty", filePath: ADAPTY_LIBRARY_PATH },
  { source: "others", filePath: OTHERS_LIBRARY_PATH },
] as const;
const LANCEDB_PATH = process.env.VERCEL ? path.join("/tmp", ".lancedb") : path.join(process.cwd(), ".lancedb");
const LANCEDB_META_PATH = path.join(LANCEDB_PATH, "linkedin_library_meta.json");
const LANCEDB_TABLE_NAME = "linkedin_library_examples";

type RetrievalMethod = "lexical" | "lancedb";
type LibrarySource = (typeof LIBRARY_SOURCES)[number]["source"];

type LanceDbConnection = import("@lancedb/lancedb").Connection;

type MetricWeights = {
  impressionsLog: number;
  likes: number;
  comments: number;
  reposts: number;
  clicks: number;
  engagementRate: number;
  ctr: number;
};

const GOAL_METRIC_WEIGHTS: Record<ContentGoal, MetricWeights> = {
  virality: {
    impressionsLog: 32,
    likes: 1.2,
    comments: 3.2,
    reposts: 6.2,
    clicks: 0.8,
    engagementRate: 220,
    ctr: 45,
  },
  engagement: {
    impressionsLog: 14,
    likes: 1.8,
    comments: 6.5,
    reposts: 3.4,
    clicks: 0.9,
    engagementRate: 300,
    ctr: 45,
  },
  traffic: {
    impressionsLog: 10,
    likes: 1,
    comments: 2.4,
    reposts: 2.1,
    clicks: 3.8,
    engagementRate: 110,
    ctr: 320,
  },
  awareness: {
    impressionsLog: 52,
    likes: 1.1,
    comments: 2.2,
    reposts: 3.8,
    clicks: 0.6,
    engagementRate: 130,
    ctr: 35,
  },
  balanced: {
    impressionsLog: 22,
    likes: 1.5,
    comments: 3.5,
    reposts: 3.8,
    clicks: 2,
    engagementRate: 180,
    ctr: 140,
  },
};

type RawPerformanceMetrics = {
  impressions?: number;
  likes?: number;
  comments?: number;
  reposts?: number;
  clicks?: number;
  ctr?: number;
};

export type LibraryPerformance = RawPerformanceMetrics & {
  interactions: number;
  engagementRate?: number;
  weightedScore: number;
};

export type LibraryEntry = {
  id: string;
  source: LibrarySource;
  text: string;
  performance?: LibraryPerformance;
};

export type LibraryPerformanceInsights = {
  analyzedPosts: number;
  summaryLines: string[];
};

type LibraryData = {
  entries: LibraryEntry[];
  libraryHash: string;
};

let libraryCache: { signature: string; data: LibraryData } | null = null;

function toHash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 2);
}

function parseMetricValue(rawValue: string): number | undefined {
  const cleaned = rawValue.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([km])?$/i);

  if (!match) {
    return undefined;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return undefined;
  }

  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") {
    return Math.round(base * 1_000);
  }
  if (suffix === "m") {
    return Math.round(base * 1_000_000);
  }

  return Math.round(base);
}

function parsePercentageValue(rawValue: string): number | undefined {
  const cleaned = rawValue
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/%$/, "");

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (value < 0) {
    return undefined;
  }

  return value > 1 ? value / 100 : value;
}

function getGoalMetricWeights(goal: ContentGoal): MetricWeights {
  return GOAL_METRIC_WEIGHTS[goal];
}

function computeWeightedScoreFromMetrics(params: {
  impressions: number;
  likes: number;
  comments: number;
  reposts: number;
  clicks: number;
  engagementRate?: number;
  ctr?: number;
  weights: MetricWeights;
}): number {
  return (
    params.likes * params.weights.likes +
    params.comments * params.weights.comments +
    params.reposts * params.weights.reposts +
    params.clicks * params.weights.clicks +
    (params.impressions > 0 ? Math.log10(params.impressions + 1) * params.weights.impressionsLog : 0) +
    (typeof params.engagementRate === "number" ? params.engagementRate * params.weights.engagementRate : 0) +
    (typeof params.ctr === "number" ? params.ctr * params.weights.ctr : 0)
  );
}

function normalizeMetricKey(rawKey: string): keyof RawPerformanceMetrics | null {
  const normalized = rawKey.toLowerCase().replace(/[\s_-]/g, "");

  if (normalized === "impressions" || normalized === "impression") {
    return "impressions";
  }
  if (normalized === "likes" || normalized === "like") {
    return "likes";
  }
  if (normalized === "comments" || normalized === "comment") {
    return "comments";
  }
  if (normalized === "repost" || normalized === "reposts" || normalized === "share" || normalized === "shares") {
    return "reposts";
  }
  if (normalized === "click" || normalized === "clicks") {
    return "clicks";
  }
  if (normalized === "ctr") {
    return "ctr";
  }

  return null;
}

function computePerformance(metrics: RawPerformanceMetrics): LibraryPerformance | undefined {
  const hasAnyMetrics =
    typeof metrics.impressions === "number" ||
    typeof metrics.likes === "number" ||
    typeof metrics.comments === "number" ||
    typeof metrics.reposts === "number" ||
    typeof metrics.clicks === "number" ||
    typeof metrics.ctr === "number";

  if (!hasAnyMetrics) {
    return undefined;
  }

  const likes = metrics.likes ?? 0;
  const comments = metrics.comments ?? 0;
  const reposts = metrics.reposts ?? 0;
  const clicks = metrics.clicks ?? 0;
  const impressions = metrics.impressions ?? 0;
  const interactions = likes + comments + reposts + clicks;
  const engagementRate = impressions > 0 ? (likes + comments + reposts) / impressions : undefined;
  const ctr = typeof metrics.ctr === "number" ? metrics.ctr : impressions > 0 ? clicks / impressions : undefined;
  const baselineWeights = getGoalMetricWeights("virality");

  const weightedScore = computeWeightedScoreFromMetrics({
    impressions,
    likes,
    comments,
    reposts,
    clicks,
    engagementRate,
    ctr,
    weights: baselineWeights,
  });

  return {
    ...metrics,
    ctr,
    interactions,
    engagementRate,
    weightedScore,
  };
}

function extractHook(text: string): string {
  const hook = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return hook ? hook.slice(0, 110) : "(no hook)";
}

function getPerformanceScore(entry: LibraryEntry, goal: ContentGoal): number {
  const performance = entry.performance;
  if (!performance) {
    return 0;
  }

  const weights = getGoalMetricWeights(goal);

  return computeWeightedScoreFromMetrics({
    impressions: performance.impressions ?? 0,
    likes: performance.likes ?? 0,
    comments: performance.comments ?? 0,
    reposts: performance.reposts ?? 0,
    clicks: performance.clicks ?? 0,
    engagementRate: performance.engagementRate,
    ctr: performance.ctr,
    weights,
  });
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function parseEntryBlock(block: string, index: number, source: LibrarySource): LibraryEntry | null {
  const lines = block.split(/\r?\n/);
  const bodyLines: string[] = [];
  const metrics: RawPerformanceMetrics = {};
  let inBody = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!inBody) {
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith("#")) {
        continue;
      }

      const metricMatch = trimmed.match(/^([^:]+):\s*(.+)$/);
      if (metricMatch) {
        const key = normalizeMetricKey(metricMatch[1]);
        if (key) {
          const parsedValue =
            key === "ctr" ? parsePercentageValue(metricMatch[2]) : parseMetricValue(metricMatch[2]);
          if (typeof parsedValue === "number") {
            metrics[key] = parsedValue;
            continue;
          }
        }
      }

      inBody = true;
      bodyLines.push(rawLine);
      continue;
    }

    bodyLines.push(rawLine);
  }

  const text = bodyLines.join("\n").trim();

  if (!text) {
    return null;
  }

  return {
    id: `${source}-entry-${index + 1}`,
    source,
    text,
    performance: computePerformance(metrics),
  };
}

function buildPerformanceInsights(entries: LibraryEntry[], goal: ContentGoal): LibraryPerformanceInsights | undefined {
  const withMetrics = entries.filter((entry) => entry.performance);

  if (!withMetrics.length) {
    return undefined;
  }

  const byScore = [...withMetrics].sort((a, b) => getPerformanceScore(b, goal) - getPerformanceScore(a, goal));
  const winners = byScore.slice(0, Math.min(8, byScore.length));

  const byLikes = [...withMetrics]
    .filter((entry) => typeof entry.performance?.likes === "number")
    .sort((a, b) => (b.performance?.likes ?? 0) - (a.performance?.likes ?? 0));

  const byComments = [...withMetrics]
    .filter((entry) => typeof entry.performance?.comments === "number")
    .sort((a, b) => (b.performance?.comments ?? 0) - (a.performance?.comments ?? 0));

  const byReposts = [...withMetrics]
    .filter((entry) => typeof entry.performance?.reposts === "number")
    .sort((a, b) => (b.performance?.reposts ?? 0) - (a.performance?.reposts ?? 0));

  const byClicks = [...withMetrics]
    .filter((entry) => typeof entry.performance?.clicks === "number")
    .sort((a, b) => (b.performance?.clicks ?? 0) - (a.performance?.clicks ?? 0));

  const byImpressions = [...withMetrics]
    .filter((entry) => typeof entry.performance?.impressions === "number")
    .sort((a, b) => (b.performance?.impressions ?? 0) - (a.performance?.impressions ?? 0));

  const byEngagementRate = [...withMetrics]
    .filter((entry) => typeof entry.performance?.engagementRate === "number")
    .sort((a, b) => (b.performance?.engagementRate ?? 0) - (a.performance?.engagementRate ?? 0));

  const byCtr = [...withMetrics]
    .filter((entry) => typeof entry.performance?.ctr === "number")
    .sort((a, b) => (b.performance?.ctr ?? 0) - (a.performance?.ctr ?? 0));

  const summaryLines: string[] = [];
  const weights = getGoalMetricWeights(goal);

  summaryLines.push(
    `Goal profile "${GOAL_LABELS[goal]}": reposts x${weights.reposts}, comments x${weights.comments}, likes x${weights.likes}, clicks x${weights.clicks}, impressions log x${weights.impressionsLog}.`,
  );

  if (byLikes[0]?.performance?.likes) {
    summaryLines.push(
      `Top likes: ${formatCompactNumber(byLikes[0].performance.likes)} on "${extractHook(byLikes[0].text)}".`,
    );
  }

  if (byComments[0]?.performance?.comments) {
    summaryLines.push(
      `Top comments: ${formatCompactNumber(byComments[0].performance.comments)} on "${extractHook(byComments[0].text)}".`,
    );
  }

  if (byReposts[0]?.performance?.reposts) {
    summaryLines.push(
      `Top reposts: ${formatCompactNumber(byReposts[0].performance.reposts)} on "${extractHook(byReposts[0].text)}".`,
    );
  }

  if (byClicks[0]?.performance?.clicks) {
    summaryLines.push(
      `Top clicks: ${formatCompactNumber(byClicks[0].performance.clicks)} on "${extractHook(byClicks[0].text)}".`,
    );
  }

  if (byImpressions[0]?.performance?.impressions) {
    summaryLines.push(
      `Top impressions: ${formatCompactNumber(byImpressions[0].performance.impressions)} on "${extractHook(byImpressions[0].text)}".`,
    );
  }

  if (typeof byEngagementRate[0]?.performance?.engagementRate === "number") {
    summaryLines.push(
      `Best engagement rate: ${(byEngagementRate[0].performance.engagementRate * 100).toFixed(2)}% on "${extractHook(byEngagementRate[0].text)}".`,
    );
  }

  if (typeof byCtr[0]?.performance?.ctr === "number") {
    summaryLines.push(`Best CTR: ${(byCtr[0].performance.ctr * 100).toFixed(2)}% on "${extractHook(byCtr[0].text)}".`);
  }

  const patterns = [
    {
      label: "Short, punchy first-line hooks",
      count: winners.filter((entry) => extractHook(entry.text).length <= 90).length,
    },
    {
      label: "Hooks that use specific numbers",
      count: winners.filter((entry) => /\d/.test(extractHook(entry.text))).length,
    },
    {
      label: "Hooks phrased as a question or challenge",
      count: winners.filter((entry) => /[?]/.test(extractHook(entry.text))).length,
    },
    {
      label: "Body copy structured with bullets/lists",
      count: winners.filter((entry) => /^\s*([-*]|\d+[.)])\s+/m.test(entry.text)).length,
    },
    {
      label: "Direct second-person language (you/your)",
      count: winners.filter((entry) => /\b(you|your)\b/i.test(entry.text)).length,
    },
    {
      label: "Clear CTA line with link or explicit action",
      count: winners.filter((entry) => /(https?:\/\/|\[CTA LINK\]|\b(comment|save|join|read)\b)/i.test(entry.text)).length,
    },
  ]
    .map((pattern) => ({
      ...pattern,
      ratio: winners.length ? pattern.count / winners.length : 0,
    }))
    .filter((pattern) => pattern.ratio >= 0.4)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);

  for (const pattern of patterns) {
    summaryLines.push(`${Math.round(pattern.ratio * 100)}% of top posts use: ${pattern.label}.`);
  }

  if (!summaryLines.length) {
    return undefined;
  }

  return {
    analyzedPosts: withMetrics.length,
    summaryLines,
  };
}

async function connectLanceDb(): Promise<LanceDbConnection> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(LANCEDB_PATH);
}

async function readLibrary(): Promise<LibraryData> {
  try {
    const filePayloads: Array<{ source: LibrarySource; raw: string }> = [];
    const signatureParts: string[] = [];

    for (const librarySource of LIBRARY_SOURCES) {
      try {
        const stat = await fs.stat(librarySource.filePath);
        const raw = await fs.readFile(librarySource.filePath, "utf8");

        signatureParts.push(`${librarySource.source}:${stat.mtimeMs}:${stat.size}`);
        filePayloads.push({
          source: librarySource.source,
          raw,
        });
      } catch {
        signatureParts.push(`${librarySource.source}:missing`);
      }
    }

    const signature = signatureParts.join("|");

    if (libraryCache && libraryCache.signature === signature) {
      return libraryCache.data;
    }

    const entries = filePayloads.flatMap((filePayload) => {
      const blocks = filePayload.raw
        .split(/\n-{3,}\n/g)
        .map((block) => block.trim())
        .filter(Boolean);

      return blocks
        .map((block, index) => parseEntryBlock(block, index, filePayload.source))
        .filter((entry): entry is LibraryEntry => Boolean(entry));
    });

    const libraryHash = toHash(
      entries
        .map((entry) =>
          JSON.stringify({
            source: entry.source,
            text: entry.text,
            performance: entry.performance ?? null,
          }),
        )
        .join("\n---\n"),
    );
    const data = { entries, libraryHash };

    libraryCache = { signature, data };
    return data;
  } catch {
    return {
      entries: [],
      libraryHash: "",
    };
  }
}

function lexicalSearch(entries: LibraryEntry[], query: string, limit: number, goal: ContentGoal): LibraryEntry[] {
  if (!entries.length) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return [...entries]
      .sort((a, b) => getPerformanceScore(b, goal) - getPerformanceScore(a, goal))
      .slice(0, limit);
  }

  const querySet = new Set(queryTokens);

  return entries
    .map((entry) => {
      const entryTokens = tokenize(entry.text);
      const tokenSet = new Set(entryTokens);
      const overlap = queryTokens.reduce((score, token) => score + Number(tokenSet.has(token)), 0);
      const phraseBonus = querySet.has("webinar") && entry.text.toLowerCase().includes("webinar") ? 2 : 0;
      const normalizedScore = overlap / Math.max(6, Math.sqrt(entryTokens.length));
      const performanceBonus = Math.min(3, Math.log10(getPerformanceScore(entry, goal) + 1));

      return {
        entry,
        score: normalizedScore + phraseBonus + performanceBonus,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const embeddings: number[][] = [];
  const batchSize = 40;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((text) => text.slice(0, 3500));
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

async function readLanceMeta(): Promise<{ libraryHash: string; embeddingModel: string } | null> {
  try {
    const raw = await fs.readFile(LANCEDB_META_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (typeof parsed?.libraryHash === "string" && typeof parsed?.embeddingModel === "string") {
      return {
        libraryHash: parsed.libraryHash,
        embeddingModel: parsed.embeddingModel,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function writeLanceMeta(libraryHash: string, embeddingModel: string): Promise<void> {
  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  await fs.writeFile(
    LANCEDB_META_PATH,
    JSON.stringify(
      {
        libraryHash,
        embeddingModel,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function ensureLanceTable(client: OpenAI, data: LibraryData): Promise<void> {
  if (!data.entries.length) {
    return;
  }

  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  const db = await connectLanceDb();
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  try {
    const [meta, tableNames] = await Promise.all([readLanceMeta(), db.tableNames()]);
    const tableExists = tableNames.includes(LANCEDB_TABLE_NAME);

    if (tableExists && meta?.libraryHash === data.libraryHash && meta.embeddingModel === embeddingModel) {
      return;
    }

    const vectors = await embedTexts(
      client,
      data.entries.map((entry) => entry.text),
    );

    const rows = data.entries.map((entry, index) => ({
      entryId: entry.id,
      text: entry.text,
      vector: vectors[index],
    }));

    if (!rows.length) {
      return;
    }

    await db.createTable(LANCEDB_TABLE_NAME, rows, {
      mode: tableExists ? "overwrite" : "create",
    });

    await writeLanceMeta(data.libraryHash, embeddingModel);
  } finally {
    db.close();
  }
}

async function lanceSearch(
  client: OpenAI,
  data: LibraryData,
  query: string,
  limit: number,
  goal: ContentGoal,
): Promise<LibraryEntry[]> {
  await ensureLanceTable(client, data);
  const db = await connectLanceDb();

  try {
    const table = await db.openTable(LANCEDB_TABLE_NAME);
    const [queryVector] = await embedTexts(client, [query]);

    const rows = await table.vectorSearch(queryVector).limit(limit).toArray();
    const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
    const resolved: Array<{ entry: LibraryEntry; rank: number }> = [];

    for (const [index, row] of (rows as Array<Record<string, unknown>>).entries()) {
      const entryId = typeof row.entryId === "string" ? row.entryId : "";
      const found = byId.get(entryId);
      if (found) {
        resolved.push({
          entry: found,
          rank: index,
        });
      }
    }

    return resolved
      .map((item) => ({
        entry: item.entry,
        score:
          (1 - item.rank / Math.max(2, resolved.length + 1)) +
          Math.min(0.35, Math.log10(getPerformanceScore(item.entry, goal) + 1) * 0.08),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  } finally {
    db.close();
  }
}

export async function retrieveLibraryContext({
  client,
  query,
  limit,
  goal = "virality",
}: {
  client?: OpenAI;
  query: string;
  limit: number;
  goal?: ContentGoal;
}): Promise<{
  method: RetrievalMethod;
  entries: LibraryEntry[];
  goalUsed: ContentGoal;
  performanceInsights?: LibraryPerformanceInsights;
}> {
  const data = await readLibrary();
  const performanceInsights = buildPerformanceInsights(data.entries, goal);

  if (!data.entries.length) {
    return {
      method: "lexical",
      entries: [],
      goalUsed: goal,
      performanceInsights,
    };
  }

  const useLanceDb = ["1", "true", "yes"].includes((process.env.ENABLE_LANCEDB ?? "").toLowerCase());

  if (useLanceDb && client) {
    try {
      const entries = await lanceSearch(client, data, query, limit, goal);
      if (entries.length) {
        return {
          method: "lancedb",
          entries,
          goalUsed: goal,
          performanceInsights,
        };
      }
    } catch (error) {
      console.error("LanceDB retrieval failed, falling back to lexical retrieval", error);
    }
  }

  return {
    method: "lexical",
    entries: lexicalSearch(data.entries, query, limit, goal),
    goalUsed: goal,
    performanceInsights,
  };
}
