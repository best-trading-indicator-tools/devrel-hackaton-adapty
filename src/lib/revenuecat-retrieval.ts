import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

const REVENUECAT_DATA_DIR = path.join(process.cwd(), "revenuecat-data");
const LANCEDB_PATH = process.env.VERCEL ? path.join("/tmp", ".lancedb") : path.join(process.cwd(), ".lancedb");
const LANCEDB_META_PATH = path.join(LANCEDB_PATH, "revenuecat_meta.json");
const LANCEDB_TABLE_NAME = "revenuecat_benchmarks";

type LanceDbConnection = import("@lancedb/lancedb").Connection;

export type RevenueCatContextItem = {
  id: string;
  category: string;
  file: string;
  text: string;
};

function toHash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function flattenToPairs(obj: unknown, prefix = ""): Array<{ key: string; value: number }> {
  const pairs: Array<{ key: string; value: number }> = [];
  if (obj == null) return pairs;
  if (typeof obj === "number") return pairs;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_") || k === "category") continue;
      const key = prefix ? `${prefix} ${k}` : k;
      const label = key.replace(/([A-Z])/g, " $1").trim().toLowerCase();
      if (typeof v === "number") {
        pairs.push({ key: label, value: v });
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        pairs.push(...flattenToPairs(v, key));
      }
    }
  }
  return pairs;
}

function formatChunk(category: string, file: string, data: Record<string, unknown>): string {
  const pairs = flattenToPairs(data);
  const fmt = (key: string, val: number) => {
    if (/rate|percent|churn|conversion|share|discount|renewal|retention/i.test(key)) return `${val}%`;
    if (/price|ltv|rpi|median.*\$/i.test(key) || (val < 100 && /month|year|d14|d60/i.test(key))) return `$${val}`;
    return String(val);
  };
  const parts = pairs.map(({ key, value }) => `${key}: ${fmt(key, value)}`);
  return `[${file}] ${category}: ${parts.join(", ")}`;
}

async function loadAllBenchmarks(): Promise<RevenueCatContextItem[]> {
  const items: RevenueCatContextItem[] = [];

  const categoryFiles = [
    "conversion-benchmarks.json",
    "category-benchmarks.json",
    "pricing-benchmarks.json",
    "revenue-benchmarks.json",
    "revenue-milestone-benchmarks.json",
  ];

  for (const file of categoryFiles) {
    try {
      const raw = await fs.readFile(path.join(REVENUECAT_DATA_DIR, file), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const benchmarks = (parsed.benchmarks ?? parsed.byCategory) as Record<string, Record<string, unknown>>;
      if (typeof benchmarks !== "object") continue;

      const fileLabel = file.replace(".json", "").replace(/-/g, " ");
      for (const [category, data] of Object.entries(benchmarks)) {
        if (!data || typeof data !== "object" || category === "categoryMapping") continue;
        const text = formatChunk(category, fileLabel, data);
        if (text.length < 20) continue;
        items.push({
          id: `rc-${file}-${category.replace(/\s+/g, "-")}`,
          category,
          file: fileLabel,
          text,
        });
      }
    } catch {
      // skip
    }
  }

  try {
    const raw = await fs.readFile(path.join(REVENUECAT_DATA_DIR, "ltv-constants.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const data = { ...parsed } as Record<string, unknown>;
    delete data._source;
    delete data._url;
    delete data._note;
    const text = formatChunk("Global", "ltv constants", data);
    if (text.length >= 20) {
      items.push({ id: "rc-ltv-constants-global", category: "Global", file: "ltv constants", text });
    }
  } catch {
    // skip
  }

  return items;
}

async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const embeddings: number[][] = [];
  const batchSize = 40;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 3500));
    const res = await client.embeddings.create({ model, input: batch });
    const ordered = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) embeddings.push(item.embedding);
  }
  return embeddings;
}

async function connectLanceDb(): Promise<LanceDbConnection> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(LANCEDB_PATH);
}

async function readMeta(): Promise<{ hash: string; model: string } | null> {
  try {
    const raw = await fs.readFile(LANCEDB_META_PATH, "utf8");
    const p = JSON.parse(raw);
    if (typeof p?.hash === "string" && typeof p?.embeddingModel === "string") {
      return { hash: p.hash, model: p.embeddingModel };
    }
  } catch {
    // ignore
  }
  return null;
}

async function writeMeta(hash: string, model: string): Promise<void> {
  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  await fs.writeFile(
    LANCEDB_META_PATH,
    JSON.stringify({ hash, embeddingModel: model, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

async function ensureTable(client: OpenAI, items: RevenueCatContextItem[]): Promise<void> {
  if (!items.length) return;

  const hash = toHash(items.map((i) => `${i.id}|${i.text}`).join("\n"));
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  const db = await connectLanceDb();

  try {
    const [meta, tableNames] = await Promise.all([readMeta(), db.tableNames()]);
    const exists = tableNames.includes(LANCEDB_TABLE_NAME);

    if (exists && meta?.hash === hash && meta.model === model) return;

    const vectors = await embedTexts(client, items.map((i) => i.text));
    const rows = items.map((item, i) => ({
      itemId: item.id,
      category: item.category,
      file: item.file,
      text: item.text,
      vector: vectors[i],
    }));

    await db.createTable(LANCEDB_TABLE_NAME, rows, { mode: exists ? "overwrite" : "create" });
    await writeMeta(hash, model);
  } finally {
    db.close();
  }
}

const SAUCE_POST_TYPE_PATTERN =
  /\b(sauce|sois|state of in[-\s]?app subscriptions|sois\s*pre[-\s]?launch|curated roundup|controversial hot take|case study|social proof)\b/i;

export function shouldUseRevenueCatContextForPostType(inputType: string): boolean {
  return SAUCE_POST_TYPE_PATTERN.test(inputType);
}

export async function retrieveRevenueCatContext(params: {
  client?: OpenAI;
  query: string;
  inputType: string;
  limit?: number;
}): Promise<{
  enabled: boolean;
  method: "none" | "lancedb" | "lexical";
  items: RevenueCatContextItem[];
}> {
  const enabled = shouldUseRevenueCatContextForPostType(params.inputType);
  if (!enabled) {
    return { enabled: false, method: "none", items: [] };
  }

  const items = await loadAllBenchmarks();
  if (!items.length) return { enabled: true, method: "none", items: [] };

  const limit = Math.min(params.limit ?? 8, items.length);
  const client = params.client;

  if (client) {
    try {
      await ensureTable(client, items);
      const db = await connectLanceDb();
      try {
        const table = await db.openTable(LANCEDB_TABLE_NAME);
        const [qv] = await embedTexts(client, [params.query]);
        const rows = await table.vectorSearch(qv).limit(limit * 2).toArray();
        const byId = new Map(items.map((i) => [i.id, i]));
        const resolved: RevenueCatContextItem[] = [];
        for (const row of rows as Array<Record<string, unknown>>) {
          const id = String(row.itemId ?? "");
          const item = byId.get(id);
          if (item && !resolved.some((r) => r.id === item.id)) resolved.push(item);
          if (resolved.length >= limit) break;
        }
        return { enabled: true, method: "lancedb", items: resolved };
      } finally {
        db.close();
      }
    } catch {
      // fallback to lexical
    }
  }

  const q = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = items.map((item) => {
    const t = item.text.toLowerCase();
    const score = q.reduce((s, tok) => s + (t.includes(tok) ? 1 : 0), 0);
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const lexical = scored.slice(0, limit).map((s) => s.item);

  return { enabled: true, method: "lexical", items: lexical };
}
