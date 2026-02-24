import { readFile } from "node:fs/promises";
import path from "node:path";

type PromptGuideKey = "writing" | "sauce" | "aso" | "paywall" | "factCheck";

export type PromptGuides = Record<PromptGuideKey, string>;

const GUIDE_PATHS: Record<PromptGuideKey, string> = {
  writing: path.join(process.cwd(), "prompts", "linkedin", "WRITING.md"),
  sauce: path.join(process.cwd(), "prompts", "linkedin", "SAUCE.md"),
  aso: path.join(process.cwd(), "prompts", "linkedin", "ASO.md"),
  paywall: path.join(process.cwd(), "prompts", "linkedin", "PAYWALL.md"),
  factCheck: path.join(process.cwd(), "prompts", "linkedin", "FACT_CHECK.md"),
};

const DEFAULT_GUIDES: PromptGuides = {
  writing: [
    "Write like a cohesive mini-article, not stacked slogans.",
    "Use this default flow: observation, why it matters, mechanism/example, practical next move.",
    "Address reader directly at least once with you or your team when natural.",
    "Include one operator action sentence using verbs like test, measure, compare, or fix.",
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
  aso: [
    "For ASO topics, focus on intent fit, conversion levers, and practical diagnostics before tool chatter.",
    "Use concrete metrics and caveats by geo, app category, and traffic source.",
  ].join("\n"),
  paywall: [
    "For paywall topics, prioritize sequence, offer clarity, and traffic quality before micro-copy tweaks.",
    "Use concrete diagnostics and one practical experiment the team can run quickly.",
  ].join("\n"),
  factCheck: [
    "For factual claims, prefer web-verified evidence.",
    "If evidence is missing, rewrite as opinion or observation.",
    "Do not invent hard numbers or timing-sensitive facts.",
  ].join("\n"),
};

const MAX_GUIDE_CHARS = 6_000;
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

  const [writing, sauce, aso, paywall, factCheck] = await Promise.all([
    loadGuide("writing"),
    loadGuide("sauce"),
    loadGuide("aso"),
    loadGuide("paywall"),
    loadGuide("factCheck"),
  ]);

  guideCache = {
    writing,
    sauce,
    aso,
    paywall,
    factCheck,
  };

  return guideCache;
}

const PRODUCT_UPDATE_TONE_PATH = path.join(process.cwd(), "content", "adapty-changelog-tone.txt");
const PRODUCT_UPDATE_TONE_MAX_CHARS = 5_000;

export async function getProductUpdateToneContext(): Promise<string> {
  try {
    const raw = await readFile(PRODUCT_UPDATE_TONE_PATH, "utf8");
    return raw.replace(/\r\n?/g, "\n").trim().slice(0, PRODUCT_UPDATE_TONE_MAX_CHARS);
  } catch {
    return "";
  }
}
