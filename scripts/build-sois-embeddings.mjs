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

const SOIS_INSIGHTS_DATASET_PATH = path.join(process.cwd(), "data", "sois-insights.md");
// Always write to project root so the table is included in Vercel deployment
const LANCEDB_PATH = path.join(process.cwd(), ".lancedb");
const EMBEDDING_MODEL = process.env.OPENAI_SAUCE_EMBEDDING_MODEL ?? "text-embedding-3-small";
const DATASET_SOURCE = {
  label: "sois",
  filePath: SOIS_INSIGHTS_DATASET_PATH,
  tableName: "sois_insights",
  idPrefix: "sois",
};
const SOIS_HEADING_CATEGORY_PATTERN =
  /^(LTV|Pricing|Conversions|Market|Paywalls|Retention|Refunds|Stores|iOS vs Android|AI|Web Paywalls)\b/i;
const SECTION_HEADING_PATTERN = /^(CONTEXT|DATA EVIDENCE|ACTIONABLE TAKEAWAYS)$/i;

function normalizeLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function toParagraphs(lines) {
  const paragraphs = [];
  let current = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      if (current.length) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.join("\n\n");
}

function inferTabularEvidence(lines) {
  const cleaned = lines.map(normalizeLine).filter(Boolean);
  if (cleaned.length < 6) return null;

  const isMetricValue = (cell) => /[$%]|^[+-]?\d+(?:\.\d+)?(?:x|pp)?$|^\d{4}$/.test(cell);
  let best = null;

  for (let cols = 6; cols >= 2; cols -= 1) {
    if (cleaned.length <= cols * 2) continue;
    const headers = cleaned.slice(0, cols);
    const body = cleaned.slice(cols);
    if (body.length % cols !== 0) continue;

    const rows = [];
    for (let i = 0; i < body.length; i += cols) {
      rows.push(body.slice(i, i + cols));
    }
    if (rows.length < 2) continue;

    const headerQuality = headers.filter((header) => /[A-Za-z]/.test(header) || /^\d{4}$/.test(header)).length;
    if (headerQuality < Math.ceil(cols * 0.75)) continue;

    const mostlyLabelFirstColumn =
      rows.filter((row) => !isMetricValue(row[0] ?? "") && /[A-Za-z]/.test(row[0] ?? "")).length >=
      Math.ceil(rows.length * 0.6);
    if (!mostlyLabelFirstColumn) continue;

    const metricDensity =
      rows
        .flatMap((row) => row.slice(1))
        .filter((cell) => isMetricValue(cell)).length / Math.max(1, rows.length * (cols - 1));
    if (metricDensity < 0.4) continue;

    const score = rows.length * cols + metricDensity;
    if (!best || score > best.score) {
      best = { headers, rows, score };
    }
  }

  return best;
}

function normalizeDataEvidence(lines) {
  const cleaned = lines.map(normalizeLine).filter(Boolean);
  if (!cleaned.length) return "";

  const looksLikeMarkdownTable =
    cleaned.length >= 2 &&
    cleaned[0].startsWith("|") &&
    cleaned.some((line) => /^\|\s*:?-{3,}/.test(line));
  if (looksLikeMarkdownTable) {
    return cleaned.join("\n");
  }

  const table = inferTabularEvidence(cleaned);
  if (table) {
    const headerRow = `| ${table.headers.join(" | ")} |`;
    const separatorRow = `| ${table.headers.map(() => "---").join(" | ")} |`;
    const bodyRows = table.rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerRow, separatorRow, ...bodyRows].join("\n");
  }

  return cleaned.map((line) => `- ${line}`).join("\n");
}

function normalizeTakeaways(lines) {
  const items = [];
  for (const raw of lines) {
    const line = normalizeLine(raw).replace(/^[\-*]\s+/, "").replace(/^\d+\.\s+/, "");
    if (!line) continue;

    if (items.length === 0) {
      items.push(line);
      continue;
    }

    const isNewItem = /^[A-Z0-9]/.test(line);
    if (isNewItem) {
      items.push(line);
    } else {
      items[items.length - 1] = `${items[items.length - 1]} ${line}`;
    }
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function normalizeInsightBlock(params) {
  const { number, title, lines } = params;
  const body = lines.slice(1);
  let cursor = 0;

  while (cursor < body.length && !normalizeLine(body[cursor])) cursor += 1;
  if (normalizeLine(body[cursor] ?? "").toLowerCase() === title.toLowerCase()) {
    cursor += 1;
  }

  const sections = {
    hook: [],
    context: [],
    dataEvidence: [],
    takeaways: [],
  };
  let currentSection = "hook";

  for (let index = cursor; index < body.length; index += 1) {
    const rawLine = body[index];
    const line = normalizeLine(rawLine);
    if (SECTION_HEADING_PATTERN.test(line)) {
      const key = line.toLowerCase();
      if (key === "context") currentSection = "context";
      if (key === "data evidence") currentSection = "dataEvidence";
      if (key === "actionable takeaways") currentSection = "takeaways";
      continue;
    }

    sections[currentSection].push(rawLine);
  }

  const hookText = toParagraphs(sections.hook);
  const contextText = toParagraphs(sections.context);
  const dataEvidenceText = normalizeDataEvidence(sections.dataEvidence);
  const takeawaysText = normalizeTakeaways(sections.takeaways);

  const outputLines = [`#${number} ${title}`];
  if (hookText) outputLines.push("", hookText);
  if (contextText) outputLines.push("", "**CONTEXT**", contextText);
  if (dataEvidenceText) outputLines.push("", "**DATA EVIDENCE**", dataEvidenceText);
  if (takeawaysText) outputLines.push("", "**ACTIONABLE TAKEAWAYS**", takeawaysText);

  return outputLines.join("\n");
}

function parseInsights(content, idPrefix) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const insights = [];
  let index = 0;

  while (index < lines.length) {
    const line = normalizeLine(lines[index]);
    const headingMatch = line.match(/^#(\d+)(.*)$/);
    if (!headingMatch) {
      index += 1;
      continue;
    }

    const number = Number.parseInt(headingMatch[1] ?? "", 10);
    if (!Number.isFinite(number) || number < 1) {
      index += 1;
      continue;
    }

    let headingTitle = normalizeLine(headingMatch[2] ?? "");
    if (!headingTitle) {
      let probe = index + 1;
      while (probe < lines.length && !normalizeLine(lines[probe])) probe += 1;
      const maybeCategory = normalizeLine(lines[probe] ?? "");
      if (SOIS_HEADING_CATEGORY_PATTERN.test(maybeCategory)) {
        headingTitle = maybeCategory;
      }
    }

    if (idPrefix === "sois" && !SOIS_HEADING_CATEGORY_PATTERN.test(headingTitle)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length && !/^#\d+/.test(normalizeLine(lines[end]))) {
      end += 1;
    }

    const blockLines = lines.slice(index, end);
    insights.push({
      insightId: `${idPrefix}-insight-${number}`,
      text: normalizeInsightBlock({
        number,
        title: headingTitle,
        lines: blockLines,
      }),
    });

    index = end;
  }

  const deduped = new Map();
  for (const insight of insights) {
    if (!deduped.has(insight.insightId)) deduped.set(insight.insightId, insight);
  }

  return [...deduped.values()].sort((a, b) => {
    const nA = Number.parseInt(a.insightId.split("-").at(-1) ?? "0", 10);
    const nB = Number.parseInt(b.insightId.split("-").at(-1) ?? "0", 10);
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

  const client = new OpenAI();

  await fs.mkdir(LANCEDB_PATH, { recursive: true });
  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(LANCEDB_PATH);

  try {
    let raw = "";
    try {
      raw = await fs.readFile(DATASET_SOURCE.filePath, "utf8");
    } catch {
      throw new Error(`Dataset file not found at ${DATASET_SOURCE.filePath}`);
    }

    const insights = parseInsights(raw, DATASET_SOURCE.idPrefix);
    if (insights.length === 0) {
      throw new Error(`No numbered insights parsed from ${DATASET_SOURCE.filePath}`);
    }

    const vectors = await embedTexts(client, insights.map((i) => i.text));
    const rows = insights.map((insight, i) => ({
      insightId: insight.insightId,
      text: insight.text,
      vector: vectors[i],
    }));

    const tableNames = await db.tableNames();
    const mode = tableNames.includes(DATASET_SOURCE.tableName) ? "overwrite" : "create";
    await db.createTable(DATASET_SOURCE.tableName, rows, { mode });
    console.log(`Stored ${rows.length} ${DATASET_SOURCE.label} insights in ${DATASET_SOURCE.tableName}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
