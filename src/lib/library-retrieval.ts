import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

const LIBRARY_PATH = path.join(process.cwd(), "content", "linkedin-library.txt");
const LANCEDB_PATH = path.join(process.cwd(), ".lancedb");
const LANCEDB_META_PATH = path.join(LANCEDB_PATH, "linkedin_library_meta.json");
const LANCEDB_TABLE_NAME = "linkedin_library_examples";

type RetrievalMethod = "lexical" | "lancedb";

type LanceDbConnection = import("@lancedb/lancedb").Connection;

export type LibraryEntry = {
  id: string;
  text: string;
};

type LibraryData = {
  entries: LibraryEntry[];
  libraryHash: string;
};

let libraryCache: { mtimeMs: number; data: LibraryData } | null = null;

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

async function connectLanceDb(): Promise<LanceDbConnection> {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb.connect(LANCEDB_PATH);
}

async function readLibrary(): Promise<LibraryData> {
  try {
    const stat = await fs.stat(LIBRARY_PATH);

    if (libraryCache && libraryCache.mtimeMs === stat.mtimeMs) {
      return libraryCache.data;
    }

    const raw = await fs.readFile(LIBRARY_PATH, "utf8");
    const blocks = raw
      .split(/\n-{3,}\n/g)
      .map((block) => block.trim())
      .filter(Boolean);

    const entries = blocks.map((text, index) => ({
      id: `entry-${index + 1}`,
      text,
    }));

    const libraryHash = toHash(entries.map((entry) => entry.text).join("\n---\n"));
    const data = { entries, libraryHash };

    libraryCache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch {
    return {
      entries: [],
      libraryHash: "",
    };
  }
}

function lexicalSearch(entries: LibraryEntry[], query: string, limit: number): LibraryEntry[] {
  if (!entries.length) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return entries.slice(0, limit);
  }

  const querySet = new Set(queryTokens);

  return entries
    .map((entry) => {
      const entryTokens = tokenize(entry.text);
      const tokenSet = new Set(entryTokens);
      const overlap = queryTokens.reduce((score, token) => score + Number(tokenSet.has(token)), 0);
      const phraseBonus = querySet.has("webinar") && entry.text.toLowerCase().includes("webinar") ? 2 : 0;
      const normalizedScore = overlap / Math.max(6, Math.sqrt(entryTokens.length));

      return {
        entry,
        score: normalizedScore + phraseBonus,
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
): Promise<LibraryEntry[]> {
  await ensureLanceTable(client, data);
  const db = await connectLanceDb();

  try {
    const table = await db.openTable(LANCEDB_TABLE_NAME);
    const [queryVector] = await embedTexts(client, [query]);

    const rows = await table.vectorSearch(queryVector).limit(limit).toArray();
    const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
    const resolved: LibraryEntry[] = [];

    for (const row of rows as Array<Record<string, unknown>>) {
      const entryId = typeof row.entryId === "string" ? row.entryId : "";
      const found = byId.get(entryId);
      if (found) {
        resolved.push(found);
      }
    }

    return resolved;
  } finally {
    db.close();
  }
}

export async function retrieveLibraryContext({
  client,
  query,
  limit,
}: {
  client?: OpenAI;
  query: string;
  limit: number;
}): Promise<{ method: RetrievalMethod; entries: LibraryEntry[] }> {
  const data = await readLibrary();

  if (!data.entries.length) {
    return {
      method: "lexical",
      entries: [],
    };
  }

  const useLanceDb = ["1", "true", "yes"].includes((process.env.ENABLE_LANCEDB ?? "").toLowerCase());

  if (useLanceDb && client) {
    try {
      const entries = await lanceSearch(client, data, query, limit);
      if (entries.length) {
        return {
          method: "lancedb",
          entries,
        };
      }
    } catch (error) {
      console.error("LanceDB retrieval failed, falling back to lexical retrieval", error);
    }
  }

  return {
    method: "lexical",
    entries: lexicalSearch(data.entries, query, limit),
  };
}
