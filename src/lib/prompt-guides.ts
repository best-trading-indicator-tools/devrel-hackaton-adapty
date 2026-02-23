import { readFile } from "node:fs/promises";
import path from "node:path";

type PromptGuideKey = "writing" | "sauce" | "factCheck";

export type PromptGuides = Record<PromptGuideKey, string>;

const GUIDE_PATHS: Record<PromptGuideKey, string> = {
  writing: path.join(process.cwd(), "prompts", "linkedin", "WRITING.md"),
  sauce: path.join(process.cwd(), "prompts", "linkedin", "SAUCE.md"),
  factCheck: path.join(process.cwd(), "prompts", "linkedin", "FACT_CHECK.md"),
};

const DEFAULT_GUIDES: PromptGuides = {
  writing: [
    "Write like a cohesive mini-article, not stacked slogans.",
    "Use line breaks for readability. Add blank lines between subtopics.",
    "Avoid rap cadence and short-fragment stacks.",
    "Include concrete proof units and caveats.",
    "Avoid buzzword fog and meta leakage.",
    "Never use em dash or en dash punctuation.",
  ].join("\n"),
  sauce: [
    "For Sauce posts, combine practical breakdown and data insight.",
    "Lead with a hard question, explain mechanism, add concrete evidence, give actions, include caveats.",
    "Keep concrete density high and include at least one lived observation line.",
  ].join("\n"),
  factCheck: [
    "For factual claims, prefer web-verified evidence.",
    "If evidence is missing, rewrite as opinion or observation.",
    "Do not invent hard numbers or timing-sensitive facts.",
  ].join("\n"),
};

const MAX_GUIDE_CHARS = 4_000;
let guideCache: PromptGuides | null = null;

function normalizeGuideText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_GUIDE_CHARS);
}

async function loadGuide(key: PromptGuideKey): Promise<string> {
  try {
    const raw = await readFile(GUIDE_PATHS[key], "utf8");
    const normalized = normalizeGuideText(raw);
    return normalized || DEFAULT_GUIDES[key];
  } catch {
    return DEFAULT_GUIDES[key];
  }
}

export async function getPromptGuides(): Promise<PromptGuides> {
  if (guideCache) {
    return guideCache;
  }

  const [writing, sauce, factCheck] = await Promise.all([
    loadGuide("writing"),
    loadGuide("sauce"),
    loadGuide("factCheck"),
  ]);

  guideCache = {
    writing,
    sauce,
    factCheck,
  };

  return guideCache;
}
