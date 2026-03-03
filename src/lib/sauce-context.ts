import path from "node:path";

import OpenAI from "openai";

// Read from project root where sois-embeddings writes during build (deployed on Vercel)
const SAUCE_LANCEDB_PATH = path.join(process.cwd(), ".lancedb");
const SOIS_LANCEDB_TABLE_NAME = "sois_insights";

type LanceDbConnection = import("@lancedb/lancedb").Connection;

async function connectLanceDb(): Promise<LanceDbConnection> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(SAUCE_LANCEDB_PATH);
}

const SAUCE_EMBEDDING_MODEL = "text-embedding-3-small";

async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_SAUCE_EMBEDDING_MODEL ?? SAUCE_EMBEDDING_MODEL;
  const embeddings: number[][] = [];
  const batchSize = 40;

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize).map((text) => text.slice(0, 3500));
    const response = await client.embeddings.create({ model, input: batch });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) embeddings.push(item.embedding);
  }

  return embeddings;
}

export async function retrieveSauceContext(params: {
  client: OpenAI;
  query: string;
  details?: string;
  limit: number;
  insightIds?: string[];
}): Promise<{ items: { id: string; text: string }[]; method: "lancedb" | "none" }> {
  return retrieveEmbeddedContext({
    ...params,
    // Legacy call sites now use the SOIS-only embedding table.
    tableName: SOIS_LANCEDB_TABLE_NAME,
  });
}

export async function retrieveSoisEmbeddedContext(params: {
  client: OpenAI;
  query: string;
  details?: string;
  limit: number;
  insightIds?: string[];
}): Promise<{ items: { id: string; text: string }[]; method: "lancedb" | "none" }> {
  return retrieveEmbeddedContext({
    ...params,
    tableName: SOIS_LANCEDB_TABLE_NAME,
  });
}

function normalizeInsightId(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const rawNumberMatch = trimmed.match(/^#?\s*(\d{1,4})$/);
  if (rawNumberMatch?.[1]) {
    return `sois-insight-${Number.parseInt(rawNumberMatch[1], 10)}`;
  }

  const insightMatch = trimmed.match(/^sois[-_\s]?insight[-_\s]?(\d{1,4})$/i);
  if (insightMatch?.[1]) {
    return `sois-insight-${Number.parseInt(insightMatch[1], 10)}`;
  }

  return null;
}

async function retrieveEmbeddedContext(params: {
  client: OpenAI;
  query: string;
  details?: string;
  limit: number;
  tableName: string;
  insightIds?: string[];
}): Promise<{ items: { id: string; text: string }[]; method: "lancedb" | "none" }> {
  const db = await connectLanceDb();

  try {
    const tableNames = await db.tableNames();
    if (!tableNames.includes(params.tableName)) {
      return { items: [], method: "none" };
    }

    const table = await db.openTable(params.tableName);
    const count = await table.countRows();
    if (count === 0) {
      return { items: [], method: "none" };
    }

    const normalizedInsightIds = Array.from(
      new Set((params.insightIds ?? []).map((id) => normalizeInsightId(id)).filter((id): id is string => Boolean(id))),
    );

    if (normalizedInsightIds.length > 0) {
      const rows = await table.query().limit(Math.max(200, count)).toArray();
      const textById = new Map<string, string>();

      for (const row of rows as Array<Record<string, unknown>>) {
        const rowId = normalizeInsightId(String(row.insightId ?? ""));
        if (!rowId) {
          continue;
        }
        textById.set(rowId, String(row.text ?? ""));
      }

      const items = normalizedInsightIds
        .map((id) => {
          const text = textById.get(id);
          if (!text) {
            return null;
          }
          return { id, text };
        })
        .filter((item): item is { id: string; text: string } => Boolean(item));

      return { items, method: "lancedb" };
    }

    const focusQuery = [params.details?.trim(), params.query].filter(Boolean).join(" | ").trim() || params.query;
    const [queryVector] = await embedTexts(params.client, [focusQuery]);
    const rows = await table.vectorSearch(queryVector).limit(params.limit).toArray();

    const items = (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.insightId ?? ""),
      text: String(row.text ?? ""),
    }));

    return { items, method: "lancedb" };
  } finally {
    db.close();
  }
}
