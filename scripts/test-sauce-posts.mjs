#!/usr/bin/env node
/**
 * Test 3 sauce prompts and output the generated posts.
 * Run: node scripts/test-sauce-posts.mjs
 * Requires: dev server running (npm run dev)
 */

const BASE = "http://localhost:3000";

const PROMPTS = [
  { details: "Paywall conversion and trial timing" },
  { details: "Subscription retention benchmarks" },
  { details: "Pricing and LTV for mobile apps" },
];

async function run() {
  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    console.log("\n" + "=".repeat(80));
    console.log(`PROMPT ${i + 1}: ${prompt.details}`);
    console.log("=".repeat(80));

    const body = {
      inputType: "Sauce",
      numberOfPosts: 3,
      details: prompt.details,
      style: "adapty",
      goal: "virality",
    };

    try {
      const res = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error("Error:", res.status, await res.text());
        continue;
      }

      const data = await res.json();
      const posts = data?.posts ?? [];
      for (let j = 0; j < posts.length; j++) {
        const p = posts[j];
        console.log(`\n--- Post ${j + 1} ---`);
        console.log("Hook:", p.hook);
        console.log("Body:", p.body?.slice(0, 400) + (p.body?.length > 400 ? "..." : ""));
        console.log("CTA:", p.cta);
      }
    } catch (err) {
      console.error("Request failed:", err.message);
    }
  }
}

run();
