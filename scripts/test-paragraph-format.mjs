#!/usr/bin/env node
/**
 * Test paragraph formatting: Claude-only vs full pipeline (Claude + Codex editor).
 *
 * Run 1 - Claude only (no Codex editor):
 *   SKIP_CODEX_EDITOR=1 npm run dev
 *   Then in another terminal: node scripts/test-paragraph-format.mjs
 *
 * Run 2 - Full pipeline (with Codex editor):
 *   npm run dev  (no SKIP_CODEX_EDITOR)
 *   node scripts/test-paragraph-format.mjs
 *
 * Compare outputs to see if one-sentence-per-line comes from Claude or Codex.
 */

const BASE = process.env.TEST_PORT ? `http://localhost:${process.env.TEST_PORT}` : "http://localhost:3000";

async function run() {
  console.log("SKIP_CODEX_EDITOR:", process.env.SKIP_CODEX_EDITOR === "1" ? "Claude only" : "Full (Claude + Codex)");
  console.log("");

  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputType: "Sauce",
      numberOfPosts: 1,
      details: "Paywall placement and install-to-trial",
      style: "adapty",
      goal: "virality",
    }),
  });

  if (!res.ok) {
    console.error("Error:", res.status, await res.text());
    return;
  }

  const data = await res.json();
  const post = data?.posts?.[0];
  if (!post) {
    console.error("No post data");
    return;
  }

  console.log("--- Post body (raw) ---");
  console.log(post.body);
  console.log("\n--- Body structure ---");
  const paras = post.body.split(/\n\n+/);
  console.log("Paragraphs:", paras.length);
  paras.forEach((p, i) => {
    const sents = p.split(/[.!?]+/).filter(Boolean).length;
    const lines = p.split(/\n/).filter(Boolean).length;
    console.log(`  P${i + 1}: ${sents} sentences, ${lines} line(s)`);
  });
}

run();
