#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import OpenAI from "openai";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env optional
  }
}

loadEnv();

const SAUCE_DATASET_PATH = path.join(process.cwd(), "data", "sauce-dataset.md");
// Always write to project root so the table is included in Vercel deployment
const LANCEDB_PATH = path.join(process.cwd(), ".lancedb");
const TABLE_NAME = "sauce_insights";
const EMBEDDING_MODEL = process.env.OPENAI_SAUCE_EMBEDDING_MODEL ?? "text-embedding-3-small";

function parseInsights(content) {
  const parts = content.split(/(?=\n#\d+\s|\n###\s*#\d+\s)/);
  const insights = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(?:###\s*)?#(\d+)\s/m);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    if (num < 1 || num > 35) continue;

    insights.push({ insightId: `insight-${num}`, text: trimmed });
  }

  return insights.sort((a, b) => {
    const nA = parseInt(a.insightId.replace("insight-", ""), 10);
    const nB = parseInt(b.insightId.replace("insight-", ""), 10);
    return nA - nB;
  });
}

async function embedTexts(client, texts) {
  const embeddings = [];
  const batchSize = 40;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 3500));
    const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    const ordered = [...resp.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) embeddings.push(item.embedding);
  }

  return embeddings;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required");
    process.exit(1);
  }

  const raw = await fs.readFile(SAUCE_DATASET_PATH, "utf8");
  const insights = parseInsights(raw);

  if (insights.length === 0) {
    console.error("No insights parsed from sauce-dataset.md");
    process.exit(1);
  }

  const client = new OpenAI();
  const vectors = await embedTexts(client, insights.map((i) => i.text));

  const rows = insights.map((insight, i) => ({
    insightId: insight.insightId,
    text: insight.text,
    vector: vectors[i],
  }));

  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(LANCEDB_PATH);

  try {
    const tableNames = await db.tableNames();
    await db.createTable(TABLE_NAME, rows, { mode: tableNames.includes(TABLE_NAME) ? "overwrite" : "create" });
    console.log(`Stored ${rows.length} sauce insights in ${TABLE_NAME}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
