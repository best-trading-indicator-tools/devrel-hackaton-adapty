#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const SOIS_SITE_ORIGIN = process.env.SOIS_SITE_ORIGIN?.trim() || "https://appstate2.vercel.app";
const OUTPUT_DIR = path.join(process.cwd(), "data", "sois-site");
const RAW_DIR = path.join(OUTPUT_DIR, "raw");
const CONTEXT_JSON_PATH = path.join(OUTPUT_DIR, "context.json");
const ALL_DATASETS_PATH = path.join(OUTPUT_DIR, "all-datasets.json");
const ALL_DATASETS_NORMALIZED_PATH = path.join(OUTPUT_DIR, "all-datasets.normalized.json");
const SOIS_MARKDOWN_PATH = path.join(process.cwd(), "prompts", "linkedin", "SOIS.md");
const MAX_ABS_NUMERIC = 1e15;

const DATASET_CATEGORY_HINTS = {
  "ltv-analytics": "ltv",
  "ltv-by-region": "ltv",
  "install-ltv": "ltv",
  "pricing-data": "pricing",
  "pricing-ltv": "pricing",
  "pricing-conversion": "pricing",
  "conversions-trial": "conversions",
  "conversions-direct": "conversions",
  retention: "retention",
  "renewal-by-price": "retention",
  "refund-share": "refunds",
  "revenue-by-region": "market",
  "fastest-growing-countries": "market",
  "revenue-concentration": "market",
  "revenue-by-product-type": "market",
  "trial-usage": "market",
  "discount-usage": "market",
  "install-to-trial-time": "market",
  "install-to-paid-time": "market",
};

const KNOWN_SOIS_DATA_PATHS = [
  "/data/conversions-direct.json",
  "/data/conversions-trial.json",
  "/data/discount-usage.json",
  "/data/fastest-growing-countries.json",
  "/data/install-ltv.json",
  "/data/install-to-paid-time.json",
  "/data/install-to-trial-time.json",
  "/data/ltv-analytics.json",
  "/data/ltv-by-region.json",
  "/data/pricing-conversion.json",
  "/data/pricing-data.json",
  "/data/pricing-ltv.json",
  "/data/refund-share.json",
  "/data/renewal-by-price.json",
  "/data/retention.json",
  "/data/revenue-by-product-type.json",
  "/data/revenue-by-region.json",
  "/data/revenue-concentration.json",
  "/data/trial-usage.json",
];

const DATASET_TITLE_OVERRIDES = {
  "ltv-analytics": "LTV Dashboard",
  "ltv-by-region": "Top Countries by LTV",
  "install-ltv": "Install LTV by Category",
  "pricing-data": "Price Distribution by Region and Category",
  "pricing-ltv": "LTV by Price Buckets",
  "pricing-conversion": "Conversion by Price Buckets",
  "conversions-trial": "Trial Conversion Benchmarks",
  "conversions-direct": "Direct Conversion Benchmarks",
  retention: "Retention by Category and Plan",
  "renewal-by-price": "Renewal by Price Bucket",
  "refund-share": "Refund Share by Region and Category",
  "revenue-by-region": "Revenue by Region",
  "fastest-growing-countries": "Fastest Growing Countries YoY",
  "revenue-concentration": "Revenue Concentration (Top 10%)",
  "revenue-by-product-type": "Revenue Share by Product Type",
  "trial-usage": "Trial Usage by Category",
  "discount-usage": "Discount Usage by Category",
  "install-to-trial-time": "Install-to-Trial Time",
  "install-to-paid-time": "Install-to-Paid Time",
};

function normalizeLabel(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function toStrictNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value) > MAX_ABS_NUMERIC) {
      return null;
    }
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(/,/g, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_ABS_NUMERIC) {
      return null;
    }
    return parsed;
  }

  return null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["data", "rows", "items", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function quantile(values, q) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}

function looksLikeRateKey(key) {
  return /(rate|share|ratio|retention|refund|conversion|cr|churn|renewal)/i.test(key);
}

function formatMetricValue(key, value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  if (looksLikeRateKey(key) && value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "");
}

function sanitizeForFilename(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, "_");
}

function buildDimensionSamples(rows) {
  const out = {};

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      if (/(app[_\s-]?id|obfuscated|hash|token|uuid)/i.test(key)) {
        continue;
      }
      const cleaned = value.trim();
      if (cleaned.length > 60) {
        continue;
      }
      const bucket = (out[key] ??= new Set());
      if (bucket.size < 8) {
        bucket.add(cleaned);
      }
    }
  }

  const normalized = {};
  for (const [key, set] of Object.entries(out)) {
    const values = [...set];
    if (values.length) {
      normalized[key] = values;
    }
  }

  return normalized;
}

function buildMetricSummaries(rows, columns) {
  const metricSummaries = [];

  for (const key of columns) {
    if (/(app[_\s-]?id|obfuscated|hash|token|uuid|date|timestamp)/i.test(key)) {
      continue;
    }

    const values = rows
      .map((row) => toStrictNumeric(row[key]))
      .filter((v) => v !== null);
    const minRequired = Math.max(5, Math.floor(rows.length * 0.25));
    if (!values.length || values.length < minRequired) {
      continue;
    }

    metricSummaries.push({
      key,
      count: values.length,
      min: Math.min(...values),
      p50: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      max: Math.max(...values),
    });
  }

  return metricSummaries.sort((a, b) => b.count - a.count);
}

function summarizeDataset(datasetId, rows, sourceUrl) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const metricSummaries = buildMetricSummaries(rows, columns);
  const topMetrics = metricSummaries.slice(0, 6);
  const summaryLines = topMetrics.slice(0, 4).map((metric) => {
    return `${normalizeLabel(metric.key)}: median ${formatMetricValue(metric.key, metric.p50)} | p90 ${formatMetricValue(
      metric.key,
      metric.p90,
    )} | max ${formatMetricValue(metric.key, metric.max)}`;
  });

  return {
    id: datasetId,
    title: DATASET_TITLE_OVERRIDES[datasetId] ?? normalizeLabel(datasetId),
    categoryHint: DATASET_CATEGORY_HINTS[datasetId] ?? "market",
    sourceUrl,
    rowCount: rows.length,
    columns,
    dimensionSamples: buildDimensionSamples(rows),
    numericMetrics: topMetrics,
    summaryLines,
    sampleRows: rows.slice(0, 5),
  };
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function toAbsoluteUrl(urlOrPath) {
  return new URL(urlOrPath, SOIS_SITE_ORIGIN).toString();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");
}

function extractSiteFactsFromHtml(html) {
  const cleanText = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();

  const capture = (pattern) => {
    const match = cleanText.match(pattern);
    return match?.[1]?.trim() || null;
  };

  const facts = {
    methodology: {
      appsAnalyzed: capture(/subscription data from\s*([\d,]+)\s*apps/i),
      revenueAnalyzed: capture(/generated\s*(\$[\d.]+[BMK])\s*in revenue/i),
      period: capture(/during\s*(\d{4}\s*[-–]\s*\d{4})/i),
      platformFocus: capture(/analysis focuses primarily on\s*([^,.]+(?:,\s*with one section comparing[^.]+)?)/i),
    },
    platform: {
      trackedRevenue: capture(/(\$[\d.]+[BMK])\s*tracked revenue/i),
      appsConnected: capture(/(\d+(?:\.\d+)?[KMB]\+?)\s*apps connected/i),
      transactions: capture(/(\d+(?:\.\d+)?[KMB])\s*transactions/i),
      historicalSla: capture(/(\d+(?:\.\d+)?%)\s*historical SLA/i),
    },
  };

  return facts;
}

async function discoverSiteDataFiles() {
  const html = await fetchText(SOIS_SITE_ORIGIN);
  const scriptUrls = new Set();
  const scriptRegex = /<script[^>]+src="([^"]+\.js)"/g;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    scriptUrls.add(toAbsoluteUrl(scriptMatch[1]));
  }

  const dataPaths = new Set();
  const dataRegex = /\/data\/[a-z0-9-]+\.json/gi;
  for (const scriptUrl of scriptUrls) {
    try {
      const body = await fetchText(scriptUrl);
      let dataMatch;
      while ((dataMatch = dataRegex.exec(body)) !== null) {
        dataPaths.add(dataMatch[0]);
      }
    } catch {
      // Skip failed script fetch
    }
  }

  const discoveredDataFiles =
    dataPaths.size > 0 ? [...dataPaths].sort() : KNOWN_SOIS_DATA_PATHS;

  return {
    html,
    discoveredDataFiles,
  };
}

function buildMarkdown(snapshot) {
  const lines = [];

  lines.push("# SOIS Website Dataset Snapshot");
  lines.push("");
  lines.push(`Generated: ${snapshot.generatedAtIso}`);
  lines.push(`Source: ${snapshot.sourceOrigin}`);
  lines.push(`Discovered data files: ${snapshot.discoveredDataFiles.length}`);
  const methodology = snapshot.siteFacts?.methodology ?? {};
  const platform = snapshot.siteFacts?.platform ?? {};
  if (methodology.appsAnalyzed || methodology.revenueAnalyzed || methodology.period || platform.trackedRevenue) {
    lines.push("");
    lines.push("## Methodology Facts");
    if (methodology.appsAnalyzed) {
      lines.push(`- Apps analyzed: ${methodology.appsAnalyzed}`);
    }
    if (methodology.revenueAnalyzed) {
      lines.push(`- Revenue analyzed: ${methodology.revenueAnalyzed}`);
    }
    if (methodology.period) {
      lines.push(`- Report period: ${methodology.period}`);
    }
    if (methodology.platformFocus) {
      lines.push(`- Focus: ${methodology.platformFocus}`);
    }
    if (platform.trackedRevenue) {
      lines.push(`- Adapty platform tracked revenue: ${platform.trackedRevenue}`);
    }
    if (platform.appsConnected) {
      lines.push(`- Adapty apps connected: ${platform.appsConnected}`);
    }
    if (platform.transactions) {
      lines.push(`- Adapty transactions: ${platform.transactions}`);
    }
    if (platform.historicalSla) {
      lines.push(`- Adapty historical SLA: ${platform.historicalSla}`);
    }
  }
  lines.push("");
  lines.push("## Usage Notes");
  lines.push("- This file summarizes chart datasets from the SOIS public web app.");
  lines.push("- Use this as supporting context and idea discovery for Sauce narratives.");
  lines.push("- Prefer official SOIS API evidence lines for strict numeric claims in generation.");
  lines.push("");

  for (const dataset of snapshot.datasets) {
    lines.push(`## ${dataset.title}`);
    lines.push(`- Dataset: \`${dataset.id}\``);
    lines.push(`- Category hint: \`${dataset.categoryHint}\``);
    lines.push(`- Source URL: ${dataset.sourceUrl}`);
    lines.push(`- Rows: ${dataset.rowCount.toLocaleString("en-US")}`);
    lines.push(`- Columns: ${dataset.columns.map((c) => `\`${c}\``).join(", ")}`);

    const dimEntries = Object.entries(dataset.dimensionSamples ?? {}).slice(0, 5);
    if (dimEntries.length) {
      const formatted = dimEntries
        .map(([key, values]) => `${key}=${values.slice(0, 5).join(" | ")}`)
        .join(" ; ");
      lines.push(`- Filter examples: ${formatted}`);
    }

    if (dataset.summaryLines.length) {
      lines.push("- Metric summary:");
      for (const summaryLine of dataset.summaryLines) {
        lines.push(`  - ${summaryLine}`);
      }
    }

    lines.push("");
  }

  lines.push("## Implementation Notes");
  lines.push("- Generated by `scripts/build-sois-site-context.mjs`.");
  lines.push("- Machine-readable snapshot lives at `data/sois-site/context.json`.");
  lines.push("- Full hardcoded payload bundle lives at `data/sois-site/all-datasets.json`.");

  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });

  const { html, discoveredDataFiles } = await discoverSiteDataFiles();
  if (!discoveredDataFiles.length) {
    throw new Error("No /data/*.json files discovered from SOIS site bundle.");
  }

  const siteFacts = extractSiteFactsFromHtml(html);
  const datasets = [];
  const allDatasetsPayloads = {};
  const allDatasetRowsById = {};
  const errors = [];

  for (const dataPath of discoveredDataFiles) {
    const datasetUrl = toAbsoluteUrl(dataPath);
    const datasetId = path.basename(dataPath, ".json");
    try {
      const payload = await fetchJson(datasetUrl);
      const rows = extractRows(payload);
      if (!rows.length) {
        continue;
      }

      const rawPath = path.join(RAW_DIR, sanitizeForFilename(path.basename(dataPath)));
      await fs.writeFile(rawPath, JSON.stringify(payload, null, 2), "utf8");
      allDatasetsPayloads[datasetId] = payload;
      allDatasetRowsById[datasetId] = rows;

      const analyzed = summarizeDataset(datasetId, rows, datasetUrl);
      datasets.push(analyzed);
    } catch (error) {
      errors.push(`${dataPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const snapshot = {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    sourceOrigin: SOIS_SITE_ORIGIN,
    discoveredDataFiles,
    siteFacts,
    datasetCount: datasets.length,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    datasets,
    errors,
  };

  const allDatasetsBundle = {
    version: 1,
    generatedAtIso: snapshot.generatedAtIso,
    sourceOrigin: SOIS_SITE_ORIGIN,
    discoveredDataFiles,
    siteFacts,
    datasetCount: Object.keys(allDatasetsPayloads).length,
    datasets: allDatasetsPayloads,
  };

  const allDatasetsNormalized = {
    version: 1,
    generatedAtIso: snapshot.generatedAtIso,
    sourceOrigin: SOIS_SITE_ORIGIN,
    discoveredDataFiles,
    siteFacts,
    datasetCount: datasets.length,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    datasets: datasets.map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      categoryHint: dataset.categoryHint,
      sourceUrl: dataset.sourceUrl,
      rowCount: dataset.rowCount,
      columns: dataset.columns,
      rows: allDatasetRowsById[dataset.id] ?? [],
    })),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(CONTEXT_JSON_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.writeFile(ALL_DATASETS_PATH, JSON.stringify(allDatasetsBundle, null, 2), "utf8");
  await fs.writeFile(ALL_DATASETS_NORMALIZED_PATH, JSON.stringify(allDatasetsNormalized, null, 2), "utf8");
  await fs.writeFile(SOIS_MARKDOWN_PATH, buildMarkdown(snapshot), "utf8");

  console.log(
    JSON.stringify(
      {
        contextJson: path.relative(process.cwd(), CONTEXT_JSON_PATH),
        allDatasetsJson: path.relative(process.cwd(), ALL_DATASETS_PATH),
        allDatasetsNormalizedJson: path.relative(process.cwd(), ALL_DATASETS_NORMALIZED_PATH),
        markdown: path.relative(process.cwd(), SOIS_MARKDOWN_PATH),
        discoveredDataFiles: discoveredDataFiles.length,
        datasets: datasets.length,
        totalRows: snapshot.totalRows,
        errors: errors.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
