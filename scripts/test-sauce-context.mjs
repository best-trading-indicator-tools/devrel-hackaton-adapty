#!/usr/bin/env node
/**
 * Test that sauce posts use sauce context (LanceDB retrieval).
 * Run: node scripts/test-sauce-context.mjs
 * Requires: dev server running (npm run dev), OPENAI_API_KEY in .env
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnv();

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

async function main() {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      style: "adapty",
      goal: "virality",
      inputType: "SOIS",
      numberOfPosts: 1,
      details: "weekly subscriptions vs annual conversion",
      createXPosts: false,
    }),
  });

  if (!res.ok) {
    console.error("API error:", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  const post = data.posts?.[0];
  if (!post) {
    console.error("No post in response");
    process.exit(1);
  }

  const text = `${post.hook}\n${post.body}\n${post.cta}`.toLowerCase();

  // SOIS insight #5: weekly converts 1.7x to 7.4x more than annual
  const hasWeeklyConversion = /\b(1\.7x|7\.4x|2\.7x|5\.4x)\b/.test(text);
  const hasWeeklyVsAnnual = /weekly.*annual|annual.*weekly/.test(text);
  const hasSauceNumbers =
    /\b(55\.5%|43\.3%|46\.2%|28\.1%|58\.1%|49\.92|42\.45)\b/.test(text);

  console.log("--- Generated post ---");
  console.log("\nHook:", post.hook);
  console.log("\nBody:\n", post.body ?? "");
  console.log("\nCTA:", post.cta ?? "");
  console.log("\n--- SOIS context check ---");
  console.log("Has weekly conversion multipliers (1.7x, 7.4x, etc):", hasWeeklyConversion);
  console.log("Mentions weekly vs annual:", hasWeeklyVsAnnual);
  console.log("Has sauce benchmark numbers:", hasSauceNumbers);
  console.log(
    hasWeeklyConversion || hasWeeklyVsAnnual || hasSauceNumbers
      ? "\nPASS: Post appears to use sauce dataset evidence."
      : "\nWARN: Post may not be using sauce context (no expected numbers found)."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
