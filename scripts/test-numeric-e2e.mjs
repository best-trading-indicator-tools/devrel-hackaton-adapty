#!/usr/bin/env node
/**
 * E2E test: POST to /api/generate with input that triggers numeric rewrites,
 * then verify output has no qualitative artifacts (double articles, etc.) 
 */
const base = process.env.BASE_URL || "http://localhost:3000";

const payload = {
  inputType: "sauce",
  style: "adapty",
  goal: "virality",
  details: `We saw a 35% lift in trial-to-paid after moving the paywall. 
First 100 users converted at 40%. 
We tested 3 paywall variants and 5 placement tests. 
Under 5% of users see the fallback offer. 
Revenue bucket: $500 to $1,000 MRR.`,
  numberOfPosts: 1,
  inputLength: "short",
};

async function main() {
  console.log("POST /api/generate (sauce + numbers in details)...\n");
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Error:", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  const post = data.posts?.[0];
  if (!post) {
    console.error("No posts in response");
    process.exit(1);
  }

  const text = `${post.hook}\n\n${post.body}\n\n${post.cta}`;

  // Artifacts the context-aware splice should prevent
  const badPatterns = [
    /\ba\s+a\s+/i,
    /\bthese\s+(?:several|a few|many)\s+/i,
    /\bfirst\s+many\s+/i,
    /\bunder\s+several\b/i,
    /\$\s*(?:a meaningful share|a few|several|many)/i,
  ];

  let hasArtifacts = false;
  for (const re of badPatterns) {
    if (re.test(text)) {
      console.error("❌ Artifact found:", re.source);
      hasArtifacts = true;
    }
  }

  console.log("--- OUTPUT ---\n");
  console.log(text);
  console.log("\n--- END ---\n");

  if (hasArtifacts) {
    console.error("FAIL: Output contains qualitative artifacts.");
    process.exit(1);
  }
  console.log("PASS: No qualitative artifacts detected.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
