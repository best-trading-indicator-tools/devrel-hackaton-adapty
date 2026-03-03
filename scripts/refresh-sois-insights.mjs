#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_SOURCE_PATH = "/Users/dave/Downloads/SOIS26Maininsights.html";
const DEFAULT_OUTPUT_MARKDOWN = path.join(process.cwd(), "data", "sois-insights.md");
const INSIGHT_CATEGORY_PATTERN =
  /^(LTV|Pricing|Conversions|Market|Paywalls|Retention|Refunds|Stores|iOS vs Android|AI|Web Paywalls)\b/i;

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    source: process.env.SOIS_SOURCE_PATH?.trim() || process.env.SOIS_SOURCE_DOCX?.trim() || DEFAULT_SOURCE_PATH,
    output: process.env.SOIS_INSIGHTS_DATASET_PATH?.trim() || DEFAULT_OUTPUT_MARKDOWN,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === "--source" || arg === "-s") && args[index + 1]) {
      options.source = args[index + 1];
      index += 1;
      continue;
    }
    if ((arg === "--output" || arg === "-o") && args[index + 1]) {
      options.output = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    copy: "(c)",
    emsp: " ",
    endash: "-",
    ensp: " ",
    gt: ">",
    hellip: "...",
    laquo: '"',
    ldquo: '"',
    lsquo: "'",
    lt: "<",
    mdash: "--",
    middot: "*",
    minus: "-",
    ndash: "-",
    nbsp: " ",
    quot: '"',
    raquo: '"',
    rdquo: '"',
    rarr: "->",
    rsquo: "'",
    times: "x",
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z]+);/gi, (full, name) => named[name.toLowerCase()] ?? full);
}

function normalizeWhitespace(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInlineHtml(fragment) {
  return decodeHtmlEntities(
    fragment
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function extractCellLines(cellHtml) {
  const lines = [];

  for (const match of cellHtml.matchAll(/<p\b[\s\S]*?<\/p>/gi)) {
    const text = normalizeWhitespace(stripInlineHtml(match[0]));
    if (text) lines.push(text);
  }

  for (const match of cellHtml.matchAll(/<li\b[\s\S]*?<\/li>/gi)) {
    const text = normalizeWhitespace(stripInlineHtml(match[0]));
    if (text) lines.push(text);
  }

  if (lines.length === 0) {
    const fallback = normalizeWhitespace(stripInlineHtml(cellHtml));
    if (fallback) lines.push(fallback);
  }

  return lines;
}

function parseTableRows(tableHtml) {
  const rows = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowCells = [];
    for (const cellMatch of rowMatch[0].matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)) {
      const lines = extractCellLines(cellMatch[0]);
      rowCells.push({
        lines,
        text: normalizeWhitespace(lines.join(" ")),
      });
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows;
}

function parseBodyBlocks(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const blocks = [];

  for (const match of body.matchAll(/<table\b[\s\S]*?<\/table>|<p\b[\s\S]*?<\/p>/gi)) {
    const blockHtml = match[0];
    if (/^<p\b/i.test(blockHtml)) {
      const text = normalizeWhitespace(stripInlineHtml(blockHtml));
      if (text) blocks.push({ type: "paragraph", text });
      continue;
    }

    const rows = parseTableRows(blockHtml);
    if (rows.length > 0) blocks.push({ type: "table", rows });
  }

  return blocks;
}

function parseSectionHeading(text) {
  const normalized = normalizeWhitespace(text.replace(/[*_`]/g, "")).toUpperCase();
  if (normalized === "CONTEXT") return "context";
  if (normalized === "DATA EVIDENCE") return "dataEvidence";
  if (normalized === "ACTIONABLE TAKEAWAYS") return "takeaways";
  return null;
}

function isNarrativeNoiseLine(text) {
  if (!text) return true;
  return (
    /^TOP 35 INSIGHTS$/i.test(text) ||
    /^State of in-app subscriptions/i.test(text) ||
    /^Adapty$/i.test(text) ||
    /^(GLOBAL INSIGHTS|CATEGORY(?:-SPECIFIC)? INSIGHTS|REGION(?:-SPECIFIC)? INSIGHTS)\b/i.test(text) ||
    /^Patterns that apply across all categories/i.test(text) ||
    /^Insights that vary dramatically by app vertical/i.test(text) ||
    /^Each insight follows a 4-part content-ready structure/i.test(text)
  );
}

function extractInsightHeading(tableRows) {
  if (tableRows.length === 0 || tableRows[0].length === 0) return null;

  const firstCellLines = tableRows[0][0].lines.map(normalizeWhitespace).filter(Boolean);
  const headingLine = firstCellLines.find((line) => /^#\s*\d+\b/.test(line));
  if (!headingLine) return null;

  const headingMatch = headingLine.match(/^#\s*(\d+)\s*(.*)$/);
  if (!headingMatch) return null;

  const number = Number.parseInt(headingMatch[1] ?? "", 10);
  if (!Number.isFinite(number)) return null;

  let category = normalizeWhitespace(headingMatch[2] ?? "");
  if (!category) {
    const index = firstCellLines.indexOf(headingLine);
    category = normalizeWhitespace(firstCellLines.slice(index + 1).join(" "));
  }
  if (!category || !INSIGHT_CATEGORY_PATTERN.test(category)) return null;

  const hook = normalizeWhitespace(tableRows[0][1]?.text ?? "");
  return { number, category, hook };
}

function tableRowsToMarkdown(rows) {
  if (rows.length === 0) return "";

  const normalizedRows = rows.map((row) => row.map((cell) => normalizeWhitespace(cell.text)));
  const columnCount = Math.max(...normalizedRows.map((row) => row.length));
  if (columnCount === 0) return "";

  const paddedRows = normalizedRows.map((row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")]);
  const nonEmptyColumns = [];
  for (let column = 0; column < columnCount; column += 1) {
    if (paddedRows.some((row) => row[column])) nonEmptyColumns.push(column);
  }
  if (nonEmptyColumns.length === 0) return "";

  const compactRows = paddedRows.map((row) => nonEmptyColumns.map((column) => row[column]));
  const escapeCell = (value) => value.replace(/\|/g, "\\|");
  const header = compactRows[0].map((cell, index) => escapeCell(cell || `Column ${index + 1}`));
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];

  for (let rowIndex = 1; rowIndex < compactRows.length; rowIndex += 1) {
    lines.push(`| ${compactRows[rowIndex].map((cell) => escapeCell(cell)).join(" | ")} |`);
  }

  return lines.join("\n");
}

function addTextToSection(insight, section, text) {
  const clean = normalizeWhitespace(text);
  if (!clean || isNarrativeNoiseLine(clean)) return;

  if (section === "takeaways") {
    const takeaway = clean.replace(/^[\u2022\-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (takeaway) insight.takeaways.push(takeaway);
    return;
  }

  if (section === "context") {
    insight.context.push(clean);
    return;
  }

  if (section === "dataEvidence") {
    insight.dataEvidenceLines.push(clean);
    return;
  }

  insight.hookParts.push(clean);
}

function parseInsightsFromBlocks(blocks) {
  const insights = [];
  let current = null;
  let currentSection = "hook";

  const flush = () => {
    if (!current) return;
    insights.push(current);
    current = null;
  };

  for (const block of blocks) {
    if (block.type === "table") {
      const heading = extractInsightHeading(block.rows);
      if (heading) {
        flush();
        current = {
          number: heading.number,
          category: heading.category,
          hookParts: heading.hook ? [heading.hook] : [],
          context: [],
          dataEvidenceTables: [],
          dataEvidenceLines: [],
          takeaways: [],
        };
        currentSection = "hook";
        continue;
      }
    }

    if (!current) continue;

    if (block.type === "paragraph") {
      const section = parseSectionHeading(block.text);
      if (section) {
        currentSection = section;
        continue;
      }
      addTextToSection(current, currentSection, block.text);
      continue;
    }

    if (block.rows.length === 1 && block.rows[0].length === 1) {
      const lines = block.rows[0][0].lines.map(normalizeWhitespace).filter(Boolean);
      const section = parseSectionHeading(lines[0] ?? "");
      if (section) {
        currentSection = section;
        for (const line of lines.slice(1)) addTextToSection(current, currentSection, line);
        continue;
      }
    }

    if (currentSection === "dataEvidence") {
      const markdown = tableRowsToMarkdown(block.rows);
      if (markdown) current.dataEvidenceTables.push(markdown);
      continue;
    }

    for (const row of block.rows) {
      for (const cell of row) {
        for (const line of cell.lines) addTextToSection(current, currentSection, line);
      }
    }
  }

  flush();

  const deduped = new Map();
  for (const insight of insights) {
    if (!deduped.has(insight.number)) deduped.set(insight.number, insight);
  }

  return [...deduped.values()].sort((a, b) => a.number - b.number);
}

function uniqueConsecutive(values) {
  const result = [];
  for (const value of values) {
    if (result.length === 0 || result[result.length - 1] !== value) result.push(value);
  }
  return result;
}

function buildMarkdown(insights) {
  const output = [];

  for (const insight of insights) {
    const hook = normalizeWhitespace(uniqueConsecutive(insight.hookParts).join(" "));
    const context = uniqueConsecutive(insight.context).filter(Boolean);
    const takeaways = uniqueConsecutive(insight.takeaways).filter(Boolean);
    const evidenceLines = uniqueConsecutive(insight.dataEvidenceLines).filter(Boolean);

    output.push(`#${insight.number} ${insight.category}`);
    if (hook) output.push(hook);

    if (context.length > 0) {
      output.push("", "CONTEXT");
      for (const paragraph of context) output.push(paragraph);
    }

    if (insight.dataEvidenceTables.length > 0 || evidenceLines.length > 0) {
      output.push("", "DATA EVIDENCE");
      if (insight.dataEvidenceTables.length > 0) {
        for (const table of insight.dataEvidenceTables) {
          output.push(table, "");
        }
        if (output[output.length - 1] === "") output.pop();
      } else {
        for (const line of evidenceLines) output.push(`- ${line}`);
      }
    }

    if (takeaways.length > 0) {
      output.push("", "ACTIONABLE TAKEAWAYS");
      for (const takeaway of takeaways) output.push(`- ${takeaway}`);
    }

    output.push("", "");
  }

  while (output.length > 0 && output[output.length - 1] === "") output.pop();
  return `${output.join("\n")}\n`;
}

async function convertDocxToHtml(sourceDocx) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sois-docx-"));
  const htmlPath = path.join(tempDir, "sois-2026.html");
  try {
    await execFileAsync("textutil", ["-convert", "html", "-output", htmlPath, sourceDocx]);
    return await fs.readFile(htmlPath, "utf8");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function loadHtmlFromSource(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return fs.readFile(sourcePath, "utf8");
  }

  return convertDocxToHtml(sourcePath);
}

async function main() {
  const options = parseArgs(process.argv);

  let html;
  try {
    html = await loadHtmlFromSource(options.source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load source file: ${message}`);
  }

  const blocks = parseBodyBlocks(html);
  const insights = parseInsightsFromBlocks(blocks);
  if (insights.length === 0) {
    throw new Error("No insights were parsed from the source file.");
  }

  await fs.mkdir(path.dirname(options.output), { recursive: true });
  const markdown = buildMarkdown(insights);
  await fs.writeFile(options.output, markdown, "utf8");

  console.log(`Wrote ${insights.length} insights to ${path.relative(process.cwd(), options.output)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
