import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  ChartInputError,
  prepareChartInputFromRequest,
  renderChartCompanion,
  summarizeChartForPrompt,
  type PreparedChartInput,
} from "@/lib/chart-render";
import {
  BRAND_VOICE_PROFILES,
  MEME_TEMPLATE_IDS,
  MEME_TEMPLATE_LABELS,
  MEME_TEMPLATE_MEANINGS,
  buildLengthPlan,
  GOAL_DESCRIPTIONS,
  GOAL_LABELS,
  isBrandVoicePreset,
  lengthGuide,
  type ContentGoal,
  type MemeTemplateId,
} from "@/lib/constants";
import { createCodexStructuredCompletion } from "@/lib/codex-responses";
import { getCodexOAuthCredentials, type CodexOAuthCredentials } from "@/lib/codex-oauth";
import {
  QUALITY_GATE_PROMPT_LINES,
  QUALITY_ISSUES,
  QUALITY_REPAIR_REQUIREMENT_LINES,
} from "@/lib/enforcement-rules";
import { runWebFactCheck } from "@/lib/fact-check";
import {
  buildGiphyQuery,
  ensureDistinctGiphyVariants,
  fetchGiphyVariants,
} from "@/lib/giphy";
import { retrieveLibraryContext, type LibraryEntry } from "@/lib/library-retrieval";
import { getProductUpdateToneContext, getPromptGuides, getSauceDataset } from "@/lib/prompt-guides";
import { runIndustryNewsContext } from "@/lib/rss-news";
import { retrieveSauceContext } from "@/lib/sauce-context";
import { retrieveSoisContext, type SoisContextItem } from "@/lib/sois-context";
import {
  generatePostsRequestSchema,
  makeGeneratePostsResponseSchema,
  type GeneratePostsResponse,
} from "@/lib/schemas";

export const runtime = "nodejs";

const MEME_LINE_MAX_CHARS = 72;
const DEFAULT_MEMEGEN_BASE_URL = "https://api.memegen.link";
const DEFAULT_MEME_TEMPLATE_LINE_COUNT = 2;
const MAX_MEME_TEMPLATE_LINE_COUNT = 8;
const MEME_TEMPLATE_LINE_COUNT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MEME_TEMPLATE_LINE_COUNT_TIMEOUT_MS = 3_000;
const MEME_TEMPLATE_LINE_COUNT_CACHE = new Map<string, { lineCount: number; expiresAt: number }>();
const GONE_TEMPLATE_ID = "gone";
const GONE_TEMPLATE_FIXED_BOTTOM_TEXT = "Aaaaand..... it's gone";
const KNOWN_MEME_TEMPLATE_LINE_COUNTS: Record<string, number> = {
  chair: 6,
  gru: 4,
  right: 5,
  anakin: 4,
  db: 3,
  same: 3,
};
const MEME_DIALOGUE_TEMPLATE_IDS = new Set<string>(["right", "chair", "anakin"]);
const MEME_SPEAKER_PREFIX_PATTERN = /^([A-Za-z][A-Za-z0-9 '&/-]{0,24}):\s+/;
const MEME_SPEAKER_ROLE_HINT_PATTERN =
  /\b(?:leader|analyst|manager|director|founder|boss|pm|pmm|ceo|cfo|cto|engineer|dev|designer|marketer|sales|finance|legal|team|client|user|ops)\b/i;
const MEME_TEMPLATE_FLOW_RULES: Record<string, string> = {
  right:
    "5-line dialogue: line1 setup claim, line2 optimistic \"right?\", line3 hidden catch, line4 nervous follow-up question, line5 awkward payoff.",
  chair:
    "6-line argument with alternating speakers: line1 claim, line2 rebuttal, line3 escalation, line4 counter, line5 loud thesis, line6 final reality-check punchline.",
  gru: "4-line plan flow: idea, expected result, failure realization, corrected action.",
  [GONE_TEMPLATE_ID]:
    `2-line format: line1 is setup, line2 must be exactly "${GONE_TEMPLATE_FIXED_BOTTOM_TEXT}".`,
};
const MEME_TEMPLATE_PROMPT_STRATEGIES: Record<string, string> = {
  drake:
    "Top line states a concrete bad choice. Bottom line names the specific better move. Maximize contrast and keep the payoff immediate.",
  "woman-cat":
    "Line 1 is an emotional accusation from one side. Line 2 is a short, deadpan reply from the clueless side that makes the scene funnier.",
  spiderman:
    "Use two labels for the same behavior. The joke is that both sides are effectively identical.",
  both: "Set up a fake either-or choice, then resolve it with a practical \"do both\" payoff.",
  wonka:
    "Use dry sarcasm. Bottom line should sound like a condescending comeback to a naive growth take.",
  buzz:
    "Line 1 names the thing. Line 2 exaggerates that same thing being everywhere. Keep it short and visual.",
  fry: "Frame two plausible explanations and keep skeptical uncertainty in the payoff.",
  stonks:
    "Describe an obviously questionable move, then frame the bad outcome as if it were genius for ironic effect.",
  disastergirl:
    "Setup a situation that is quietly chaotic. Payoff is a smug or knowing reaction as if this was expected.",
  db:
    "3-line triangle: line1 what gets ignored, line2 shiny distraction, line3 what should have been prioritized.",
  dbg: "Top is idealized expectation, bottom is blunt reality with concrete disappointment.",
  pigeon:
    "Top line labels the real thing. Bottom line is the deliberately wrong guess in a \"is this\" tone.",
  spongebob:
    "Repeat the same core phrase. First line normal, second line mocking or distorted to ridicule the idea.",
  same: "Use 3 slots to show that different labels all point to the same underlying problem.",
  kombucha: "Line 1 initial interest, line 2 instant disgust reversal after the second beat.",
  harold:
    "Line 1 states painful reality. Line 2 is forced-optimistic coping that clearly hides stress.",
  rollsafe:
    "Use flawed smart-sounding logic. Bottom line should be a cheeky \"can't fail if...\" style loophole.",
  gru: "4 beats: bold plan, expected result, realization it backfires, corrected action.",
  anakin:
    "4-line dialogue with mounting confidence and a final worried silence/realization in the last beat.",
  right:
    "5 beats: statement, hopeful \"right?\", hidden downside, worried follow-up, awkward truth.",
  chair:
    "6 alternating dialogue beats that escalate conflict before ending with a hard reality-check line.",
  [GONE_TEMPLATE_ID]:
    `Line 1 sets up the loss. Line 2 must stay exactly "${GONE_TEMPLATE_FIXED_BOTTOM_TEXT}".`,
};
const MEME_TEMPLATE_LINE_ROLE_HINTS: Record<string, string[]> = {
  drake: ["rejected option", "preferred option"],
  "woman-cat": ["frustrated accusation", "clueless or deadpan response"],
  spiderman: ["first label", "second label for the same thing"],
  both: ["either-or setup", "explicit both payoff (usually 'why not both?')"],
  wonka: ["naive claim or brag", "sarcastic put-down"],
  buzz: ["thing name", "same thing but 'everywhere'"],
  fry: ["uncertain first possibility", "second possibility that completes the doubt"],
  stonks: ["bad move setup", "ironic fake-smart payoff"],
  disastergirl: ["chaos setup", "smug knowing reaction"],
  db: ["thing being ignored", "new distraction", "current priority being neglected"],
  dbg: ["expectation", "reality"],
  pigeon: ["observer/subject", "object being misread", "wrong-question payoff (often 'Is this ...?')"],
  spongebob: ["normal quote to mock", "same idea in mocking voice"],
  same: ["label A", "label B", "they are equivalent verdict"],
  kombucha: ["first reaction", "immediate reaction reversal"],
  harold: ["painful situation", "forced-smile coping response"],
  rollsafe: ["problem setup", "clever-but-flawed loophole"],
  gru: ["plan", "expected result", "realization it breaks", "awkward consequence"],
  right: ["bold claim", "optimistic 'right?'", "hidden catch", "worried follow-up", "awkward final beat"],
  chair: ["claim A", "rebuttal", "counter-rebuttal", "correction", "escalation", "final exasperated line"],
  [GONE_TEMPLATE_ID]: ["setup before loss", `exactly "${GONE_TEMPLATE_FIXED_BOTTOM_TEXT}"`],
};

function resolveMemeTemplateLineRoleHint(templateId: string, lineCount: number): string {
  const key = templateId.trim().toLowerCase();
  const hints = MEME_TEMPLATE_LINE_ROLE_HINTS[key];

  if (!hints?.length) {
    return `L1-L${lineCount} must follow the template's visual beat order.`;
  }

  const clipped = hints.slice(0, lineCount);
  const normalized = clipped.map((hint, index) => `L${index + 1}: ${normalizeNoEmDash(hint)}`);
  return normalized.join(" | ");
}

function resolveMemeTemplatePromptStrategy(params: {
  templateId: string;
  lineCount: number;
  meaning?: string;
  flowRule?: string;
}): string {
  const key = params.templateId.trim().toLowerCase();
  const explicitRule = MEME_TEMPLATE_PROMPT_STRATEGIES[key];
  const flowRule = params.flowRule ? normalizeNoEmDash(params.flowRule).trim() : "";
  const semanticMeaning = params.meaning ? normalizeNoEmDash(params.meaning).trim() : "";

  if (explicitRule && flowRule) {
    return `${normalizeNoEmDash(explicitRule)} Also follow flow: ${flowRule}`;
  }

  if (explicitRule) {
    return normalizeNoEmDash(explicitRule);
  }

  if (flowRule && semanticMeaning) {
    return `Respect meaning: ${semanticMeaning}. Follow flow: ${flowRule}`;
  }

  if (semanticMeaning) {
    return `Respect meaning: ${semanticMeaning}. Keep exactly ${params.lineCount} lines with a clear setup-to-payoff arc.`;
  }

  return `Keep exactly ${params.lineCount} lines mapped to the template visual beats, with setup first and punchline last.`;
}

function detectSpeakerLabelPrefix(line: string): string | null {
  const prefixMatch = line.match(MEME_SPEAKER_PREFIX_PATTERN);
  if (!prefixMatch) {
    return null;
  }

  const label = prefixMatch[1]?.trim() ?? "";
  if (!label) {
    return null;
  }

  const compactLabel = label.replace(/\s+/g, "");
  const isShortAllCaps = compactLabel.length > 0 && compactLabel.length <= 6 && compactLabel === compactLabel.toUpperCase();
  const looksLikeRoleLabel = MEME_SPEAKER_ROLE_HINT_PATTERN.test(label);

  return isShortAllCaps || looksLikeRoleLabel ? label : null;
}
const FACT_CHECK_EVIDENCE_PROMPT_LIMIT = 4;
const DEFAULT_SOIS_EVIDENCE_PROMPT_LIMIT = 8;
const DEFAULT_SOIS_BROAD_EVIDENCE_PROMPT_LIMIT = 24;
const MAX_X_THREAD_POST_CHARS = 280;
const X_THREAD_PACK_TARGET_CHARS = 272;
const X_THREAD_FIRST_POST_OPENER = "A thread 🧵";
const DEFAULT_FAST_BATCH_THRESHOLD = 8;
const FAST_PATH_SOIS_BROAD_EVIDENCE_PROMPT_LIMIT = 12;
const DEFAULT_PROMPT_EXAMPLE_LIMIT = 10;
const DEFAULT_PROMPT_EXAMPLE_CHAR_LIMIT = 1600;
const FAST_PATH_PROMPT_EXAMPLE_LIMIT = 4;
const FAST_PATH_PROMPT_EXAMPLE_CHAR_LIMIT = 700;
const SAUCE_TOPIC_ANCHOR_MAX_CHARS = 220;
const INDUSTRY_NEWS_REACTION_PATTERN = /\bindustry news reaction\b/i;
const PRODUCT_UPDATE_PATTERN =
  /\bproduct\s+(?:feature\s+)?(?:launch|lunch)(?:\s+update)?\b|\bproduct\s+update\b/i;
const YOUTUBE_PROMO_POST_TYPE_PATTERN = /\b(content promo|post[-\s]?event youtube promo|youtube promo)\b/i;
const SOIS_ACRONYM_PATTERN = /\bsois\b/i;
const SOIS_EXPANDED_PATTERN = /\bstate of in[-\s]?app subscriptions\b/i;
const AI_LABEL_STYLE_OPENER_PATTERN = /(?:^|[.!?]\s+)[A-Za-z][A-Za-z ]{1,24}:\s+/i;
const HOOK_IF_OPENING_PATTERN = /^\s*if\b/i;
const ROBOTIC_FILLER_PATTERN = /\b(?:the|this|that)\s+[a-z][a-z\s]{0,24}\s+is real\./i;
const SNAPSHOT_JARGON_PATTERN = /\b(for one segment snapshot|segment snapshot|rows analyzed|sample size)\b/i;
const YOU_YOUR_PATTERN = /\b(you|your)\b/i;
const FIRST_PERSON_SINGULAR_PATTERN = /\b(i(?:'m|'d|'ll|'ve)?|me|my|mine|myself)\b/i;

function looksLikeProductUpdatePostType(inputType: string): boolean {
  return PRODUCT_UPDATE_PATTERN.test(inputType);
}

function looksLikeEventOrWebinarPostType(inputType: string): boolean {
  return /\bevent\b|\bwebinar\b/i.test(inputType);
}

function looksLikeYouTubePromoPostType(inputType: string): boolean {
  return YOUTUBE_PROMO_POST_TYPE_PATTERN.test(inputType);
}

const GOAL_PLAYBOOKS: Record<ContentGoal, string> = {
  virality:
    "Say the uncomfortable obvious truth your audience already suspects but rarely says out loud. Stack: concrete scenario + counter-intuitive insight + emotional payoff. Keep it specific, useful, and defensible.",
  engagement:
    "Optimize for replies and conversation quality. Stack: relatable scenario + debatable take + question that invites expert opinions. End with a concrete question, not generic agreement.",
  traffic:
    "Drive qualified clicks by making the promise of the linked resource concrete. Stack: specific pain + surprising angle + clear value of clicking. Make the value immediately clear.",
  awareness:
    "Maximize clarity and recall for broad audiences. Stack: memorable scenario + one crisp message + repeatable framing. Keep positioning crisp.",
  balanced:
    "Balance reach, comments, and clicks. Stack at least two: scenario, insight, payoff. Prioritize clarity and practical value.",
};

const POST_TYPE_PLAYBOOKS: Array<{ pattern: RegExp; directive: string }> = [
  {
    pattern: /event|webinar/i,
    directive:
      "Lead with a real operator pain or short story teams relate to. Stack: relatable scenario + why-now + logistics + takeaway. Include explicit logistics (date/time/place), who should attend, and one practical conversation or takeaway.",
  },
  {
    pattern: /content promo|post[-\s]?event youtube promo|youtube promo/i,
    directive:
      "Promote one specific content asset (especially YouTube). Stack: sharp hook + one concrete takeaway from the video + why it matters + clear 'watch now' CTA tied to the provided link.",
  },
  {
    pattern: /product feature launch|product launch update|product update/i,
    directive:
      "Frame the user pain first. Stack: pain story + what changed + concrete outcome. Explain why it matters and one concrete use case.",
  },
  {
    pattern: /sauce/i,
    directive:
      "For Sauce posts, combine clear practical breakdown with data-backed insight. Stack: concrete scenario (e.g. a test that surprised you) + mechanism + numbers + caveat. Use concrete numbers and include caveats or segmentation.",
  },
  {
    pattern: /industry news reaction/i,
    directive:
      "React quickly to the news with a clear stance. Stack: news hook + how it affects a real team + implication + next move. Add concrete implication and a practical next move.",
  },
  {
    pattern: /poll|quiz|engagement farming/i,
    directive:
      "Ask a specific high-signal question. Stack: context block + clear options + why it matters. Make voting easy and meaningful.",
  },
  {
    pattern: /case study|social proof/i,
    directive:
      "Tell the story. Stack: before + intervention + after + measurable result. Keep claims concrete and scoped.",
  },
  {
    pattern: /hiring|team culture/i,
    directive:
      "Highlight role context and why this team is compelling. Stack: moment that defines culture + ownership + human detail. Keep tone human and specific.",
  },
  {
    pattern: /milestone|company update/i,
    directive:
      "Share the milestone and what changed operationally. Stack: milestone + brief story of how + why it matters. Prefer specific numbers over hype.",
  },
  {
    pattern: /controversial hot take/i,
    directive:
      "Take a strong stance on a real industry habit. Stack: contrarian claim + story that illustrates + mechanics + alternative. Back with caveats and a practical alternative.",
  },
  {
    pattern: /curated roundup/i,
    directive:
      "Organize items into a clear digest. Stack: one takeaway per item + short recommendation on what to read first. Make each item reward reading.",
  },
];

const AI_SLOP_PHRASE_PATTERN =
  /\b(hard truth|game changer|nobody talks about|let that sink in|this changes everything|stop scrolling)\b/i;
const AI_SCAFFOLD_OPENING_PATTERN =
  /^(?:strong stance|hard truth|hot take|reality check|bottom line|thesis|frank truth)\s*[:,-]\s*/i;
const AI_SCAFFOLD_SOFT_OPENING_PATTERN = /^caveat\s*,\s*/i;
const CONDESCENDING_READER_PATTERN =
  /\b(idiot|idiots|stupid|dumb|moron|morons|naive|clueless|fool|fools|cr[eé]tin|cr[eé]tins|d[eé]bile|d[eé]biles|connard|connards)\b/i;
const ADAPTY_SUPERLATIVE_PATTERN =
  /\badapty\b[\s\S]{0,90}\b(best|best-in-class|best in class|best on the market|number one|#1|no\.?\s*1|unbeatable|ultimate|only real)\b/i;
const ADAPTY_PROOF_SIGNAL_PATTERN =
  /\b(because|for example|for instance|in practice|based on|case study|data|metric|trial|conversion|retention|benchmark|experiment|evidence|proof)\b/i;
const CORPORATE_JARGON_PATTERN =
  /\b(?:synergy|stakeholder(?:s)?|stakeholder alignment|north star|best-in-class|go-to-market(?:\s+motion)?|thought leadership|unlock value|move the needle|bandwidth|circle back|leverage(?:d|ing)?|low-hanging fruit|paradigm|core competency|value proposition|strategic pillar)\b/i;
const ROBOTIC_CORPORATE_PATTERN =
  /\b(?:it is important to note|in today's|in order to|this underscores|therefore teams must|at scale we|from a strategic standpoint)\b/i;
const OPERATOR_ACTION_VERB_PATTERN =
  /\b(?:test|measure|compare|check|audit|fix|ship|cut|reduce|increase|prioritize|validate|instrument|review|run)\b/i;
const EVENT_FORMAT_PATTERN =
  /\b(webinar|roundtable|workshop|summit|conference|meetup|panel|ama|office hours|fireside|dinner|breakfast|happy hour|networking)\b/i;
const SPECIFICITY_ANCHOR_PATTERN =
  /\b(\d+(?:[.,]\d+)?%?|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|https?:\/\/|apple|google|meta|tiktok|appfigures|revenuecat|adapty|ios|android|app store|google play|skadnetwork|att)\b/i;

function normalizeLooseMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looseIncludes(haystack: string, needle: string): boolean {
  const hay = normalizeLooseMatch(haystack);
  const ndl = normalizeLooseMatch(needle);

  if (!hay || !ndl) {
    return false;
  }

  return hay.includes(ndl) || ndl.split(" ").every((part) => part.length > 2 && hay.includes(part));
}

function parsePositiveIntEnv(value: string | undefined, fallbackValue: number, maxValue = 120): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(maxValue, parsed);
}

function parseBooleanEnv(value: string | undefined, fallbackValue: boolean): boolean {
  if (!value) {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

type NumericClaimKind = "percent" | "multiplier" | "unit" | "number";

type NumericClaim = {
  raw: string;
  start: number;
  end: number;
  kind: NumericClaimKind;
  canonical: string;
  unit?: string;
};

const MAX_ALLOWED_NUMERIC_CLAIM_ABS = 1e15;
const SAUCE_FUZZY_NUMERIC_PLACEHOLDER_PATTERN = /\b(a few|meaningful share|broad range|a low threshold)\b/i;
const SAUCE_FUZZY_QUANTIFIER_PATTERN =
  /\bseveral\s+(?:days?|weeks?|months?|years?|hours?|minutes?|apps?|users?|installs?|downloads?|trials?|tests?|experiments?|placements?|paywalls?|countries?|markets?|segments?|cohorts?|regions?|categories?)\b/i;
const SAUCE_BLOCKED_ANECDOTE_PATTERN =
  /\b(?:one|another|third)\s+app\b|\b(?:we|our team)\s+(?:support(?:ed)?|work(?:ed)? with|had a client|helped)\b/i;
const SAUCE_DETAILS_ANECDOTE_ALLOW_PATTERN =
  /\b(one app|another app|third app|client story|customer story|case study|we support|we worked with|we saw|we tested)\b/i;
const SAUCE_BENCHMARK_NOISE_SEGMENT_PATTERN =
  /^(?:rows analyzed|columns|global row snapshot|state of in[-\s]?app subscriptions|benchmark anchor|highlights?)\b/i;
const SAUCE_BENCHMARK_LOW_SIGNAL_PREFIX_PATTERN = /^(?:top|low|sample size)\s*:/i;
const SAUCE_BENCHMARK_METRIC_SIGNAL_PATTERN =
  /\b(install|trial|paid|renewal|refund|retention|churn|ltv|arpu|revenue|pricing|price|paywall|conversion|direct|cohort|region|country|category|annual|monthly|weekly|plan)\b/i;
const SAUCE_BENCHMARK_UNIT_SIGNAL_PATTERN =
  /(?:[$€£]\s*\d)|(?:\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%)|(?:\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:x|day|days|week|weeks|month|months|year|years|k|m|b|million|billion|thousand)\b)/i;
const SAUCE_WEAK_HOOK_PATTERN =
  /^(?:sois(?:\s+benchmark)?|benchmark|rows analyzed|top|low|max|min|median|p90)\b[:\s-]*/i;

const NUMERIC_CLAIM_EXTRACTORS: Array<{ kind: NumericClaimKind; regex: RegExp }> = [
  {
    kind: "percent",
    regex: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%/g,
  },
  {
    kind: "multiplier",
    regex: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*x\b/gi,
  },
  {
    kind: "unit",
    regex:
      /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:apps?|users?|installs?|downloads?|impressions?|sessions?|trials?|tests?|experiments?|days?|weeks?|months?|years?|hours?|minutes?|countries?|markets?|segments?|cohorts?|paywalls?|placements?|regions?|categories?|million|billion|thousand|k|m|b)\b/gi,
  },
  {
    kind: "number",
    regex: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g,
  },
];

function normalizeNumericLiteral(value: string): string {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    return value.trim().toLowerCase();
  }
  return parsed.toString();
}

function normalizeNumericUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();

  const aliases: Record<string, string> = {
    app: "app",
    apps: "app",
    user: "user",
    users: "user",
    install: "install",
    installs: "install",
    download: "download",
    downloads: "download",
    impression: "impression",
    impressions: "impression",
    session: "session",
    sessions: "session",
    trial: "trial",
    trials: "trial",
    test: "test",
    tests: "test",
    experiment: "experiment",
    experiments: "experiment",
    day: "day",
    days: "day",
    week: "week",
    weeks: "week",
    month: "month",
    months: "month",
    year: "year",
    years: "year",
    hour: "hour",
    hours: "hour",
    minute: "minute",
    minutes: "minute",
    country: "country",
    countries: "country",
    market: "market",
    markets: "market",
    segment: "segment",
    segments: "segment",
    cohort: "cohort",
    cohorts: "cohort",
    paywall: "paywall",
    paywalls: "paywall",
    placement: "placement",
    placements: "placement",
    region: "region",
    regions: "region",
    category: "category",
    categories: "category",
    million: "million",
    billion: "billion",
    thousand: "thousand",
    k: "k",
    m: "m",
    b: "b",
  };

  return aliases[normalized] ?? normalized;
}

function canonicalizeNumericClaim(raw: string, kind: NumericClaimKind): { canonical: string; unit?: string } {
  const token = raw.trim().toLowerCase().replace(/\s+/g, " ");

  if (kind === "percent") {
    const match = token.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*%$/);
    if (match) {
      return {
        canonical: `${normalizeNumericLiteral(match[1])}%`,
      };
    }
  }

  if (kind === "multiplier") {
    const match = token.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*x$/);
    if (match) {
      return {
        canonical: `${normalizeNumericLiteral(match[1])}x`,
      };
    }
  }

  if (kind === "unit") {
    const match = token.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([a-z]+)$/);
    if (match) {
      const normalizedUnit = normalizeNumericUnit(match[2]);
      return {
        canonical: `${normalizeNumericLiteral(match[1])} ${normalizedUnit}`,
        unit: normalizedUnit,
      };
    }
  }

  if (kind === "number") {
    const match = token.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d+)?)$/);
    if (match) {
      return {
        canonical: normalizeNumericLiteral(match[1]),
      };
    }
  }

  return { canonical: token };
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function extractNumericClaims(value: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];

  for (const extractor of NUMERIC_CLAIM_EXTRACTORS) {
    const regex = new RegExp(extractor.regex.source, extractor.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(value)) !== null) {
      const raw = match[0]?.trim();
      const index = match.index;
      if (!raw) {
        continue;
      }
      const start = index;
      const end = index + raw.length;
      const range = { start, end };
      if (occupiedRanges.some((existingRange) => rangesOverlap(existingRange, range))) {
        continue;
      }
      occupiedRanges.push(range);
      const { canonical, unit } = canonicalizeNumericClaim(raw, extractor.kind);
      claims.push({
        raw,
        start,
        end,
        kind: extractor.kind,
        canonical,
        unit,
      });
    }
  }

  return claims.sort((a, b) => a.start - b.start);
}

function buildAllowedNumericClaimSet(contexts: string[]): Set<string> {
  const allowed = new Set<string>();

  for (const context of contexts) {
    for (const claim of extractNumericClaims(context)) {
      if (!claim.canonical) {
        continue;
      }
      const numericValue = parseCanonicalToNumber(claim.canonical);
      if (numericValue !== null && Math.abs(numericValue) > MAX_ALLOWED_NUMERIC_CLAIM_ABS) {
        continue;
      }
      allowed.add(claim.canonical);
    }
  }

  return allowed;
}

function parseCanonicalToNumber(canonical: string): number | null {
  const s = canonical.trim().replace(/,/g, "");
  const withoutSuffix = s.replace(/%$/, "").replace(/x$/i, "").split(/\s/)[0];
  const n = Number.parseFloat(withoutSuffix);
  return Number.isFinite(n) ? n : null;
}

function numericValuesWithinTolerance(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.abs(a - b) / scale < 0.02;
}

function isNumericClaimAllowed(
  claim: NumericClaim,
  allowedClaims: Set<string>,
  allowApproximate: boolean,
): boolean {
  if (allowedClaims.has(claim.canonical)) {
    return true;
  }
  if (!allowApproximate) {
    return false;
  }
  const claimVal = parseCanonicalToNumber(claim.canonical);
  if (claimVal === null) {
    return false;
  }

  const isClaimShapeCompatible = (claimValue: NumericClaim, allowedCanonical: string): boolean => {
    const allowed = allowedCanonical.trim().toLowerCase();

    if (claimValue.kind === "percent") {
      return allowed.endsWith("%");
    }

    if (claimValue.kind === "multiplier") {
      return allowed.endsWith("x");
    }

    if (claimValue.kind === "unit") {
      const unitMatch = allowed.match(/^\d+(?:\.\d+)?\s+([a-z]+)$/i);
      if (!unitMatch) {
        return false;
      }
      return normalizeNumericUnit(unitMatch[1]) === (claimValue.unit ?? "");
    }

    return /^\d+(?:\.\d+)?$/.test(allowed);
  };

  for (const allowed of allowedClaims) {
    if (!isClaimShapeCompatible(claim, allowed)) {
      continue;
    }
    const allowedVal = parseCanonicalToNumber(allowed);
    if (allowedVal !== null && numericValuesWithinTolerance(claimVal, allowedVal)) {
      return true;
    }
  }
  return false;
}

function countAllowedNumericClaims(value: string, allowedClaims: Set<string>): number {
  if (!allowedClaims.size) {
    return 0;
  }

  const claims = extractNumericClaims(value);
  return claims.filter((claim) => allowedClaims.has(claim.canonical)).length;
}

function collectBenchmarkEvidenceSnippets(contexts: string[], maxSnippets = 60): string[] {
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const context of contexts) {
    const segments = context
      .split(/\n/)
      .map((segment) => normalizeNoEmDash(segment.replace(/^[-*]\s*/, "").trim()))
      .filter(Boolean);

    for (let index = 0; index < segments.length; index += 1) {
      const rawSegment = segments[index];
      let segment = rawSegment;

      if (!/\d/.test(segment)) {
        continue;
      }
      if (/(app[_\s-]?id|obfuscated|hash|token|uuid)/i.test(segment)) {
        continue;
      }
      if (SAUCE_BENCHMARK_NOISE_SEGMENT_PATTERN.test(segment)) {
        continue;
      }
      if (SAUCE_BENCHMARK_LOW_SIGNAL_PREFIX_PATTERN.test(segment)) {
        continue;
      }
      if (/^median\s*:/i.test(segment) && index > 0) {
        const previous = segments[index - 1] ?? "";
        if (SAUCE_BENCHMARK_METRIC_SIGNAL_PATTERN.test(previous) && !/\d/.test(previous)) {
          segment = `${previous}. ${segment}`;
        }
      }
      if (!SAUCE_BENCHMARK_METRIC_SIGNAL_PATTERN.test(segment)) {
        continue;
      }
      if (!SAUCE_BENCHMARK_UNIT_SIGNAL_PATTERN.test(segment)) {
        continue;
      }
      if (/\b\d{1,3}(?:,\d{3}){6,}(?:\.\d+)?\b/.test(segment)) {
        continue;
      }
      const claims = extractNumericClaims(segment);
      if (
        claims.some((claim) => {
          const value = parseCanonicalToNumber(claim.canonical);
          return value !== null && Math.abs(value) > MAX_ALLOWED_NUMERIC_CLAIM_ABS;
        })
      ) {
        continue;
      }

      const compact = segment.replace(/\s+/g, " ");
      const normalized = compact.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      snippets.push(compact);

      if (snippets.length >= maxSnippets) {
        return snippets;
      }
    }
  }

  return snippets;
}

function buildSauceAllowedNumericClaimSet(contexts: string[]): Set<string> {
  const raw = buildAllowedNumericClaimSet(contexts);
  const filtered = new Set<string>();

  for (const canonical of raw) {
    if (/^\d+(?:\.\d+)?$/.test(canonical)) {
      continue;
    }
    if (/^\d{4}$/.test(canonical)) {
      continue;
    }
    filtered.add(canonical);
  }

  return filtered;
}

type SauceTopicPillar = {
  key: string;
  label: string;
  categories: string[];
  pattern: RegExp;
};

const SAUCE_TOPIC_PILLARS: SauceTopicPillar[] = [
  {
    key: "pricing",
    label: "Pricing strategy",
    categories: ["pricing"],
    pattern: /\b(price|pricing|usd|annual|monthly|weekly|plan)\b/i,
  },
  {
    key: "conversions",
    label: "Trial-to-paid conversion",
    categories: ["conversions"],
    pattern: /\b(trial|install to paid|download to paid|direct rate|conversion)\b/i,
  },
  {
    key: "retention",
    label: "Retention and renewals",
    categories: ["retention"],
    pattern: /\b(retention|renewal|churn|cohort)\b/i,
  },
  {
    key: "paywalls",
    label: "Paywall and placement mechanics",
    categories: ["paywalls"],
    pattern: /\b(paywall|placement|onboarding|experiment)\b/i,
  },
  {
    key: "ltv",
    label: "LTV and revenue quality",
    categories: ["ltv"],
    pattern: /\b(ltv|lifetime value|arpu|revenue)\b/i,
  },
  {
    key: "market",
    label: "Market dynamics",
    categories: ["market"],
    pattern: /\b(market|region|category|share|concentration|competition)\b/i,
  },
];

function clipTextAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const clipped = value.slice(0, maxChars + 1).replace(/\s+\S*$/, "").trim();
  const fallback = value.slice(0, maxChars).trim();
  return `${clipped || fallback}...`;
}

function compactSoisEvidenceAnchor(text: string): string {
  const normalized = normalizeNoEmDash(text.replace(/\s*\n+\s*/g, " | ").replace(/\s+/g, " ").trim());
  return clipTextAtWordBoundary(normalized, SAUCE_TOPIC_ANCHOR_MAX_CHARS);
}

function extractSauceAnchorFromItem(item: SoisContextItem): string {
  const segments = item.text
    .split(/\n|\|/)
    .map((segment) => normalizeNoEmDash(segment.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim()))
    .filter(Boolean);

  const withNumbers = segments.find((segment) => /\d/.test(segment));
  const fallback = segments[0] ?? `${item.categoryLabel} ${item.subcategoryLabel}`;
  return compactSoisEvidenceAnchor(withNumbers ?? fallback);
}

function sauceItemMatchesPillar(item: SoisContextItem, pillar: SauceTopicPillar): boolean {
  if (pillar.categories.includes(item.category)) {
    return true;
  }

  const haystack = `${item.categoryLabel} ${item.subcategoryLabel} ${item.text}`;
  return pillar.pattern.test(haystack);
}

function sectionKeyFromItemId(itemId: string): string {
  const overviewSuffix = "-overview";
  const metricMarker = "-metric-";
  if (itemId.endsWith(overviewSuffix)) {
    return itemId.slice(0, -overviewSuffix.length);
  }
  const markerIndex = itemId.indexOf(metricMarker);
  if (markerIndex > 0) {
    return itemId.slice(0, markerIndex);
  }
  return itemId;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildSauceAutoTopicPlan(
  items: SoisContextItem[],
  postCount: number,
): { planLines: string[]; assignedSectionKeys: Set<string> } {
  const empty = { planLines: [], assignedSectionKeys: new Set<string>() };
  if (postCount <= 0) {
    return empty;
  }

  const bySection = new Map<string, SoisContextItem[]>();
  for (const item of items) {
    const key = sectionKeyFromItemId(item.id);
    const existing = bySection.get(key);
    if (existing) {
      existing.push(item);
    } else {
      bySection.set(key, [item]);
    }
  }

  const sections = [...bySection.keys()];
  const assignedSectionKeys = new Set<string>();

  if (!sections.length) {
    return {
      planLines: Array.from({ length: postCount }, (_, index) =>
        `Post ${index + 1}: ${SAUCE_TOPIC_PILLARS[index % SAUCE_TOPIC_PILLARS.length]!.label}
- Primary pillar: ${SAUCE_TOPIC_PILLARS[index % SAUCE_TOPIC_PILLARS.length]!.label}
- Anchor: No SOIS evidence retrieved. Keep this post qualitative and mechanism-focused.`,
      ),
      assignedSectionKeys,
    };
  }

  const planLines = Array.from({ length: postCount }, (_, index) => {
    const sectionKey = sections[Math.floor(Math.random() * sections.length)]!;
    assignedSectionKeys.add(sectionKey);
    const sectionItems = bySection.get(sectionKey) ?? [];
    const evidenceItem = sectionItems[Math.floor(Math.random() * sectionItems.length)] ?? sectionItems[0];

    if (!evidenceItem) {
      const fallbackPillar = SAUCE_TOPIC_PILLARS[index % SAUCE_TOPIC_PILLARS.length]!;
      return `Post ${index + 1}: ${fallbackPillar.label}
- Primary pillar: ${fallbackPillar.label}
- Anchor: No SOIS evidence matched. Keep this post qualitative and mechanism-focused.`;
    }

    return `Post ${index + 1}: ${evidenceItem.categoryLabel} / ${evidenceItem.subcategoryLabel}
- Primary pillar: ${evidenceItem.categoryLabel} / ${evidenceItem.subcategoryLabel}
- Anchor: ${extractSauceAnchorFromItem(evidenceItem)}
- Source: ${evidenceItem.sourceUrl}`;
  });

  return { planLines, assignedSectionKeys };
}

function toPluralUnit(unit: string): string {
  if (unit.endsWith("s")) {
    return unit;
  }

  if (unit.endsWith("y")) {
    return `${unit.slice(0, -1)}ies`;
  }

  return `${unit}s`;
}

function qualitativeReplacementForNumericClaim(claim: NumericClaim): string {
  if (claim.kind === "percent") {
    return "a meaningful share";
  }

  if (claim.kind === "multiplier") {
    return "significantly";
  }

  if (claim.kind === "unit") {
    const unit = claim.unit ?? "";
    const timeUnits = new Set(["day", "week", "month", "year", "hour", "minute"]);
    const magnitudeUnits = new Set(["million", "billion", "thousand", "k", "m", "b"]);
    const smallCountUnits = new Set(["app", "user", "install", "download", "trial", "test", "experiment", "placement", "paywall"]);
    if (timeUnits.has(unit)) {
      return `several ${toPluralUnit(unit)}`;
    }
    if (magnitudeUnits.has(unit)) {
      return "meaningful";
    }
    if (smallCountUnits.has(unit)) {
      return `a few ${toPluralUnit(unit)}`;
    }
    if (unit) {
      return `many ${toPluralUnit(unit)}`;
    }
    return "many";
  }

  return "a few";
}

const RANGE_BETWEEN = /^\s*[$€£¥]?\s*(?:to|-|–)\s*[$€£¥]?\s*$/i;
const CURRENCY = /^[$€£¥]$/;

function contextAwareNumericSplice(
  value: string,
  claimsToReplace: NumericClaim[],
  allClaims: NumericClaim[],
): string {
  if (!claimsToReplace.length) return value;

  const replaceStarts = new Set(claimsToReplace.map((c) => c.start));

  const rangePairs: Array<{ left: NumericClaim; right: NumericClaim }> = [];
  for (let i = 0; i < allClaims.length - 1; i++) {
    const left = allClaims[i];
    const right = allClaims[i + 1];
    const between = value.slice(left.end, right.start).replace(/\s+/g, " ").trim();
    if (RANGE_BETWEEN.test(between) && (replaceStarts.has(left.start) || replaceStarts.has(right.start))) {
      rangePairs.push({ left, right });
    }
  }

  const absorbedLeft = new Set<number>();
  for (const { left, right } of rangePairs) {
    if (absorbedLeft.has(left.start)) continue;
    absorbedLeft.add(left.start);
  }

  const sorted = [...claimsToReplace].sort((a, b) => b.start - a.start);

  let result = value;
  for (const claim of sorted) {
    if (absorbedLeft.has(claim.start)) continue;

    let rStart = claim.start;
    let rEnd = claim.end;
    let rep = qualitativeReplacementForNumericClaim(claim);

    const rangePair = rangePairs.find((p) => p.right.start === claim.start || p.left.start === claim.start);
    if (rangePair && (claim.start === rangePair.right.start || claim.start === rangePair.left.start)) {
      rStart = rangePair.left.start;
      rEnd = rangePair.right.end;
      rep = "a broad range";
      absorbedLeft.add(rangePair.left.start);
    } else {
      const before = result.slice(0, claim.start);
      const after = result.slice(claim.end);

      if (CURRENCY.test(result[claim.start - 1] ?? "")) {
        rStart = claim.start - 1;
      }
      const artMatch = before.match(/((?:a|an)\s+)$/i);
      if (artMatch && (rep.startsWith("a ") || /^(?:many|several|significantly|meaningful)\b/.test(rep))) {
        rStart -= artMatch[1].length;
      }

      const firstMatch = before.match(/(first\s+)$/i);
      const theseMatch = before.match(/(these\s+)$/i);
      const underMatch = before.match(/(under\s+)$/i);
      if (theseMatch) {
        rep = "";
      } else if (firstMatch && rep.startsWith("many ")) {
        rStart -= firstMatch[1].length;
        rep = `early ${rep.slice(5)}`;
      } else if (underMatch) {
        rStart -= underMatch[1].length;
        rep = "a low threshold";
      }

      const lastWord = rep.split(/\s+/).pop() ?? "";
      const trailMatch = after.match(new RegExp(`^\\s+(${lastWord})\\b`, "i"));
      if (lastWord && trailMatch) {
        rEnd += trailMatch[0].length;
      }
    }

    result = result.slice(0, rStart) + rep + result.slice(rEnd);
  }

  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function rewriteUnsupportedNumericClaims(
  value: string,
  allowedClaims: Set<string>,
  allowApproximate = false,
): {
  value: string;
  unsupportedClaims: NumericClaim[];
} {
  const claims = extractNumericClaims(value);
  const unsupportedClaims = claims.filter(
    (claim) => !isNumericClaimAllowed(claim, allowedClaims, allowApproximate),
  );

  if (!unsupportedClaims.length) {
    return {
      value,
      unsupportedClaims: [],
    };
  }

  const rewritten = contextAwareNumericSplice(value, unsupportedClaims, claims);

  return {
    value: rewritten,
    unsupportedClaims,
  };
}

function rewriteNumericClaimsWithBudget(
  value: string,
  allowedClaims: Set<string>,
  maxUniqueAllowedClaims: number,
  seenAllowedClaims: Set<string>,
): {
  value: string;
  rewrittenClaims: NumericClaim[];
} {
  const claims = extractNumericClaims(value);
  const rewrittenClaims: NumericClaim[] = [];

  for (const claim of claims) {
    if (!allowedClaims.has(claim.canonical)) {
      rewrittenClaims.push(claim);
      continue;
    }

    if (seenAllowedClaims.has(claim.canonical)) {
      continue;
    }

    if (seenAllowedClaims.size < maxUniqueAllowedClaims) {
      seenAllowedClaims.add(claim.canonical);
      continue;
    }

    rewrittenClaims.push(claim);
  }

  if (!rewrittenClaims.length) {
    return {
      value,
      rewrittenClaims: [],
    };
  }

  const rewritten = contextAwareNumericSplice(value, rewrittenClaims, claims);

  return {
    value: rewritten,
    rewrittenClaims,
  };
}

function rewriteRepeatedAllowedNumericClaims(
  value: string,
  allowedClaims: Set<string>,
  maxOccurrencesPerClaim: number,
  seenAllowedClaimCounts: Map<string, number>,
): {
  value: string;
  rewrittenClaims: NumericClaim[];
} {
  const claims = extractNumericClaims(value);
  const rewrittenClaims: NumericClaim[] = [];
  const occurrenceLimit = Math.max(1, Math.floor(maxOccurrencesPerClaim));

  for (const claim of claims) {
    if (!allowedClaims.has(claim.canonical)) {
      continue;
    }

    const seenCount = seenAllowedClaimCounts.get(claim.canonical) ?? 0;
    if (seenCount < occurrenceLimit) {
      seenAllowedClaimCounts.set(claim.canonical, seenCount + 1);
      continue;
    }

    rewrittenClaims.push(claim);
  }

  if (!rewrittenClaims.length) {
    return {
      value,
      rewrittenClaims: [],
    };
  }

  const rewritten = contextAwareNumericSplice(value, rewrittenClaims, claims);

  return {
    value: rewritten,
    rewrittenClaims,
  };
}

function sanitizeHookNumericClaimRepetition(
  hooks: string[],
  allowedClaims: Set<string>,
  maxOccurrencesPerClaim = 2,
): {
  hooks: string[];
  rewrittenClaims: NumericClaim[];
} {
  const rewrittenClaims: NumericClaim[] = [];
  const seenAllowedClaimCounts = new Map<string, number>();

  const sanitizedHooks = hooks.map((hook) => {
    const result = rewriteRepeatedAllowedNumericClaims(
      hook,
      allowedClaims,
      maxOccurrencesPerClaim,
      seenAllowedClaimCounts,
    );
    rewrittenClaims.push(...result.rewrittenClaims);
    return result.value;
  });

  return {
    hooks: sanitizedHooks,
    rewrittenClaims,
  };
}

function sanitizeHookSuggestionsNumericClaims(
  hooks: string[],
  allowedClaims: Set<string>,
  allowApproximate = false,
): {
  hooks: string[];
  unsupportedClaims: NumericClaim[];
} {
  const unsupportedClaims: NumericClaim[] = [];
  const sanitizedHooks = hooks.map((hook) => {
    const result = rewriteUnsupportedNumericClaims(hook, allowedClaims, allowApproximate);
    unsupportedClaims.push(...result.unsupportedClaims);
    return result.value;
  });

  return {
    hooks: sanitizedHooks,
    unsupportedClaims,
  };
}

function sanitizeGeneratedPostsNumericClaims<T extends { hook: string; body: string; cta: string }>(
  posts: T[],
  allowedClaims: Set<string>,
  allowApproximate = false,
): {
  posts: T[];
  unsupportedClaims: NumericClaim[];
} {
  const unsupportedClaims: NumericClaim[] = [];
  const sanitizedPosts = posts.map((post) => {
    const hookResult = rewriteUnsupportedNumericClaims(post.hook, allowedClaims, allowApproximate);
    const bodyResult = rewriteUnsupportedNumericClaims(post.body, allowedClaims, allowApproximate);
    const ctaResult = rewriteUnsupportedNumericClaims(post.cta, allowedClaims, allowApproximate);
    unsupportedClaims.push(...hookResult.unsupportedClaims, ...bodyResult.unsupportedClaims, ...ctaResult.unsupportedClaims);
    return {
      ...post,
      hook: hookResult.value,
      body: bodyResult.value,
      cta: ctaResult.value,
    };
  });

  return {
    posts: sanitizedPosts,
    unsupportedClaims,
  };
}

function sentenceHasUnsupportedNumericClaim(sentence: string, allowedClaims: Set<string>): boolean {
  const claims = extractNumericClaims(sentence);
  if (!claims.length) {
    return false;
  }
  return claims.some((claim) => !allowedClaims.has(claim.canonical));
}

function sentenceHasFuzzyNumericPlaceholder(sentence: string): boolean {
  return SAUCE_FUZZY_NUMERIC_PLACEHOLDER_PATTERN.test(sentence) || SAUCE_FUZZY_QUANTIFIER_PATTERN.test(sentence);
}

function sentenceHasBlockedAnecdote(sentence: string): boolean {
  return SAUCE_BLOCKED_ANECDOTE_PATTERN.test(sentence);
}

function sentenceIsDegenerateNumericArtifact(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return false;
  }

  if (/^0+[.,;:!?-]*$/i.test(trimmed)) {
    return true;
  }

  const stripped = trimmed.replace(/[()]/g, "").replace(/\s+/g, " ");
  if (stripped.length <= 8 && /^[0-9.%$€£:-]+$/i.test(stripped)) {
    return true;
  }

  return false;
}

function detailsAllowSauceAnecdotes(details: string): boolean {
  return SAUCE_DETAILS_ANECDOTE_ALLOW_PATTERN.test(details);
}

function sanitizeSauceTextStrict(
  value: string,
  options: {
    allowedClaims: Set<string>;
    allowAnecdotes: boolean;
  },
): {
  value: string;
  removedUnsupportedNumericSentences: number;
  removedFuzzyPlaceholderSentences: number;
  removedAnecdoteSentences: number;
} {
  const paragraphs = splitParagraphs(value);
  const keptParagraphs: string[] = [];
  let removedUnsupportedNumericSentences = 0;
  let removedFuzzyPlaceholderSentences = 0;
  let removedAnecdoteSentences = 0;

  for (const paragraph of paragraphs) {
    const sentenceUnits = splitSentenceUnits(paragraph)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const sentences = sentenceUnits.length ? sentenceUnits : [paragraph.replace(/\s+/g, " ").trim()];
    const keptSentences: string[] = [];

    for (const sentence of sentences) {
      if (!sentence) {
        continue;
      }

      const hasUnsupportedNumeric = sentenceHasUnsupportedNumericClaim(sentence, options.allowedClaims);
      const hasFuzzyPlaceholder = sentenceHasFuzzyNumericPlaceholder(sentence);
      const hasBlockedAnecdote = !options.allowAnecdotes && sentenceHasBlockedAnecdote(sentence);
      const hasDegenerateArtifact = sentenceIsDegenerateNumericArtifact(sentence);

      if (hasUnsupportedNumeric || hasFuzzyPlaceholder || hasBlockedAnecdote || hasDegenerateArtifact) {
        if (hasUnsupportedNumeric) {
          removedUnsupportedNumericSentences += 1;
        }
        if (hasFuzzyPlaceholder) {
          removedFuzzyPlaceholderSentences += 1;
        }
        if (hasBlockedAnecdote) {
          removedAnecdoteSentences += 1;
        }
        continue;
      }

      keptSentences.push(sentence);
    }

    if (keptSentences.length > 0) {
      keptParagraphs.push(keptSentences.join(" "));
    }
  }

  const sanitized = normalizeNoEmDash(keptParagraphs.join("\n\n").replace(/\s+\n/g, "\n").trim());
  return {
    value: sanitized,
    removedUnsupportedNumericSentences,
    removedFuzzyPlaceholderSentences,
    removedAnecdoteSentences,
  };
}

function pickStrictSauceBenchmarkSnippet(
  snippets: string[],
  allowedClaims: Set<string>,
  seedIndex: number,
): string | null {
  if (!snippets.length) {
    return null;
  }

  const offset = Math.max(0, seedIndex) % snippets.length;
  for (let index = 0; index < snippets.length; index += 1) {
    const snippet = snippets[(offset + index) % snippets.length]?.replace(/\s+/g, " ").trim();
    if (!snippet) {
      continue;
    }
    if (!extractMetricLabelFromBenchmarkSnippet(snippet)) {
      continue;
    }
    const claims = extractNumericClaims(snippet);
    if (!claims.length) {
      continue;
    }
    if (claims.some((claim) => allowedClaims.has(claim.canonical))) {
      return snippet;
    }
  }

  for (let index = 0; index < snippets.length; index += 1) {
    const snippet = snippets[(offset + index) % snippets.length]?.replace(/\s+/g, " ").trim();
    if (!snippet) {
      continue;
    }
    if (extractMetricLabelFromBenchmarkSnippet(snippet)) {
      return snippet;
    }
  }

  for (let index = 0; index < snippets.length; index += 1) {
    const snippet = snippets[(offset + index) % snippets.length]?.replace(/\s+/g, " ").trim();
    if (!snippet) {
      continue;
    }
    const claims = extractNumericClaims(snippet);
    if (claims.length && claims.some((claim) => allowedClaims.has(claim.canonical))) {
      return snippet;
    }
  }

  return null;
}

function buildStrictSauceBenchmarkSentence(snippet: string): string {
  const compact = snippet.replace(/\s+/g, " ").trim();
  const metricLabelRaw = extractMetricLabelFromBenchmarkSnippet(compact);
  const metricLabel = metricLabelRaw ? normalizeHookMetricLabel(metricLabelRaw) : "";
  const stats = extractBenchmarkStatClaims(compact);
  const topClaim = pickTopBenchmarkClaim(stats);
  const typical = formatBenchmarkClaim(stats.median) ?? formatBenchmarkClaim(stats.min);
  const top = formatBenchmarkClaim(topClaim);
  const primaryValues = extractBenchmarkPrimaryValues(compact);
  const first = typical ?? primaryValues[0];

  if (metricLabel && first && top && first !== top) {
    return `${metricLabel} is typically around ${first}, while top-performing apps reach about ${top}.`;
  }
  if (metricLabel && first) {
    return `Typical ${metricLabel.toLowerCase()} is around ${first}.`;
  }
  if (metricLabel) {
    return `${metricLabel} shows meaningful variance by cohort and region.`;
  }
  if (first && top && first !== top) {
    return `SOIS shows a meaningful spread: typical apps are around ${first}, while top performers reach about ${top}.`;
  }
  if (first) {
    return `SOIS shows typical performance around ${first}.`;
  }
  return compact.endsWith(".") ? compact : `${compact}.`;
}

function normalizeHookMetricLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanBenchmarkMetricLabel(value: string): string {
  let label = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!label) {
    return "";
  }

  if (label.includes(" - ")) {
    const parts = label.split(/\s+-\s+/);
    label = parts[parts.length - 1] ?? label;
  }

  const coreMetricMatch = label.match(
    /\b(install to|trial to|paid to|retention|renewal|refund|churn|ltv|arpu|price|pricing|revenue)\b[\s\S]*$/i,
  );
  if (coreMetricMatch) {
    label = coreMetricMatch[0];
  }

  label = label
    .replace(/\((?:rate:[^)]+|usd[^)]*|[^)]*log scale[^)]*)\)/gi, "")
    .replace(/^\b(conversions?|pricing|retention|refunds?|ltv|market|paywalls?|ai|stores?)\b\s+\b\1\b\s*/i, "")
    .replace(/^\b(conversions?|pricing|retention|refunds?|ltv|market|paywalls?|ai|stores?)\b\s*\([^)]+\)\s*/i, "")
    .replace(/^\b(conversions?|pricing|retention|refunds?|ltv|market|paywalls?|ai|stores?)\b\s*/i, "")
    .replace(/\brate\b/gi, "rate")
    .replace(/\s+/g, " ")
    .trim();

  return label;
}

function extractMetricLabelFromBenchmarkSnippet(snippet: string): string {
  const compact = snippet.replace(/\s+/g, " ").trim();
  const colonMedianMatch = compact.match(/^(.+?):\s*median\b/i);
  if (colonMedianMatch) {
    return cleanBenchmarkMetricLabel(colonMedianMatch[1]);
  }

  const periodMedianMatch = compact.match(/^(.+?)\.\s*median\s*:/i);
  if (periodMedianMatch) {
    return cleanBenchmarkMetricLabel(periodMedianMatch[1]);
  }

  return "";
}

function extractBenchmarkPrimaryValues(snippet: string): string[] {
  const claims = extractNumericClaims(snippet)
    .filter((claim) => claim.kind !== "number")
    .map((claim) => claim.raw.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return claims.slice(0, 2);
}

function formatBenchmarkClaim(claim: NumericClaim | null | undefined): string | null {
  if (!claim) {
    return null;
  }
  const value = claim.raw.replace(/\s+/g, " ").trim();
  return value || null;
}

function findLabeledBenchmarkClaim(params: {
  snippet: string;
  labelPattern: RegExp;
  claims: NumericClaim[];
  usedClaimStarts: Set<number>;
  maxDistance?: number;
}): NumericClaim | null {
  const maxDistance = params.maxDistance ?? 28;
  const labelRegex = new RegExp(params.labelPattern.source, params.labelPattern.flags);
  let match: RegExpExecArray | null;

  while ((match = labelRegex.exec(params.snippet)) !== null) {
    const labelEnd = match.index + match[0].length;
    const candidate = params.claims.find(
      (claim) =>
        !params.usedClaimStarts.has(claim.start) &&
        claim.start >= labelEnd &&
        claim.start - labelEnd <= maxDistance,
    );
    if (!candidate) {
      continue;
    }
    params.usedClaimStarts.add(candidate.start);
    return candidate;
  }

  return null;
}

function extractBenchmarkStatClaims(snippet: string): {
  median: NumericClaim | null;
  p90: NumericClaim | null;
  max: NumericClaim | null;
  min: NumericClaim | null;
} {
  const claims = extractNumericClaims(snippet).filter((claim) => claim.kind !== "number");
  const usedClaimStarts = new Set<number>();

  return {
    median: findLabeledBenchmarkClaim({
      snippet,
      labelPattern: /\bmedian\b\s*:?/gi,
      claims,
      usedClaimStarts,
    }),
    p90: findLabeledBenchmarkClaim({
      snippet,
      labelPattern: /\bp90\b\s*:?/gi,
      claims,
      usedClaimStarts,
    }),
    max: findLabeledBenchmarkClaim({
      snippet,
      labelPattern: /\bmax\b\s*:?/gi,
      claims,
      usedClaimStarts,
    }),
    min: findLabeledBenchmarkClaim({
      snippet,
      labelPattern: /\bmin\b\s*:?/gi,
      claims,
      usedClaimStarts,
    }),
  };
}

function pickTopBenchmarkClaim(stats: {
  median: NumericClaim | null;
  p90: NumericClaim | null;
  max: NumericClaim | null;
}): NumericClaim | null {
  const medianValue = stats.median ? parseCanonicalToNumber(stats.median.canonical) : null;
  const highCandidates = [stats.p90, stats.max].filter((claim): claim is NumericClaim => Boolean(claim));

  if (medianValue !== null) {
    for (const candidate of highCandidates) {
      const candidateValue = parseCanonicalToNumber(candidate.canonical);
      if (candidateValue !== null && candidateValue > medianValue) {
        return candidate;
      }
    }
    return null;
  }

  return highCandidates[0] ?? null;
}

function buildStrictSauceFallbackHook(snippet: string | null): string {
  const compact = snippet?.replace(/\s+/g, " ").trim() ?? "";
  const metricLabel = extractMetricLabelFromBenchmarkSnippet(compact);
  const stats = extractBenchmarkStatClaims(compact);
  const topClaim = pickTopBenchmarkClaim(stats);
  const primaryValue = formatBenchmarkClaim(stats.median) ?? formatBenchmarkClaim(stats.min);
  const topValue = formatBenchmarkClaim(topClaim);

  if (metricLabel && primaryValue && topValue && primaryValue !== topValue) {
    return `${normalizeHookMetricLabel(metricLabel)} has a bigger gap than most app makers expect: typical performance is near ${primaryValue}, while top apps reach about ${topValue}.`;
  }

  if (metricLabel && primaryValue) {
    return `${normalizeHookMetricLabel(metricLabel)} varies more by cohort than most app makers assume, with typical performance near ${primaryValue}.`;
  }

  if (metricLabel) {
    return `${normalizeHookMetricLabel(metricLabel)} benchmarks vary more by cohort than most app makers assume.`;
  }

  return "Most app makers have bigger benchmark variance by cohort than their dashboards suggest.";
}

function sanitizeSauceHookFallback(hook: string, benchmarkSnippet: string | null): string {
  const cleaned = hook.replace(/\s+/g, " ").trim();
  if (!cleaned || SAUCE_WEAK_HOOK_PATTERN.test(cleaned)) {
    return buildStrictSauceFallbackHook(benchmarkSnippet);
  }
  return cleaned;
}

function countStrictSauceOutputViolations(
  values: string[],
  options: { allowedClaims: Set<string>; allowAnecdotes: boolean },
): { unsupportedNumericClaims: number; fuzzyPlaceholderSentences: number; blockedAnecdoteSentences: number } {
  let unsupportedNumericClaims = 0;
  let fuzzyPlaceholderSentences = 0;
  let blockedAnecdoteSentences = 0;

  for (const value of values) {
    const text = value.trim();
    if (!text) {
      continue;
    }

    const claims = extractNumericClaims(text);
    unsupportedNumericClaims += claims.filter((claim) => !options.allowedClaims.has(claim.canonical)).length;

    const paragraphs = splitParagraphs(text);
    for (const paragraph of paragraphs) {
      const sentenceUnits = splitSentenceUnits(paragraph)
        .map((sentence) => sentence.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const sentences = sentenceUnits.length ? sentenceUnits : [paragraph.replace(/\s+/g, " ").trim()];

      for (const sentence of sentences) {
        if (!sentence) {
          continue;
        }
        if (sentenceHasFuzzyNumericPlaceholder(sentence)) {
          fuzzyPlaceholderSentences += 1;
        }
        if (!options.allowAnecdotes && sentenceHasBlockedAnecdote(sentence)) {
          blockedAnecdoteSentences += 1;
        }
      }
    }
  }

  return {
    unsupportedNumericClaims,
    fuzzyPlaceholderSentences,
    blockedAnecdoteSentences,
  };
}

function countConcreteProofUnits(value: string): number {
  const numberLike = value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [];
  const concreteSignal =
    value.match(/\b(trial|conversion|retention|ctr|cac|arppu|mrr|paywall|onboarding|revenue|churn|install)\b/gi) ?? [];

  return numberLike.length + (concreteSignal.length ? 1 : 0);
}

function countSpecificityAnchors(value: string): number {
  const anchorMatches = value.match(
    /\b(\d+(?:[.,]\d+)?%?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|https?:\/\/|apple|google|meta|tiktok|appfigures|revenuecat|adapty|ios|android|app store|google play|skadnetwork|att)\b/gi,
  );

  return anchorMatches?.length ?? 0;
}

function countNumericTokens(value: string): number {
  const numericMatches = value.match(/\b\d+(?:[.,]\d+)?%?\b/g);
  return numericMatches?.length ?? 0;
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function countSentencesInParagraph(paragraph: string): number {
  return splitSentenceUnits(paragraph).length;
}

function hasShortLineStack(body: string): boolean {
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    const currentWords = lines[index].split(/\s+/).filter(Boolean).length;
    const nextWords = lines[index + 1].split(/\s+/).filter(Boolean).length;

    if (currentWords <= 5 && nextWords <= 5) {
      return true;
    }
  }

  return false;
}

function splitSentenceUnits(paragraph: string): string[] {
  const matches = paragraph
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((part) => part.trim())
    .filter(Boolean);

  return matches?.length ? matches : [paragraph.trim()].filter(Boolean);
}

function normalizeComparisonText(value: string): string {
  return normalizeNoEmDash(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripLeadingHookFromBody(hook: string, body: string): string {
  const normalizedHook = normalizeComparisonText(hook);
  if (!normalizedHook) {
    return body.trim();
  }

  const lines = body.split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) {
    return body.trim();
  }

  const firstContentLine = lines[firstContentLineIndex] ?? "";
  const normalizedFirstContentLine = normalizeComparisonText(firstContentLine);
  if (normalizedFirstContentLine !== normalizedHook) {
    return body.trim();
  }

  const nextLines = [...lines];
  nextLines.splice(firstContentLineIndex, 1);
  return nextLines.join("\n").trim();
}

function splitTextByWordBudget(value: string, maxChars: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const parts: string[] = [];
  let remaining = trimmed;
  while (remaining.length > maxChars) {
    let cutIndex = remaining.lastIndexOf(" ", maxChars);
    if (cutIndex <= 0) {
      cutIndex = maxChars;
    }

    const head = remaining.slice(0, cutIndex).trim();
    if (head) {
      parts.push(head);
    }
    remaining = remaining.slice(cutIndex).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function buildThreadSegmentsFromText(value: string, maxChars: number): string[] {
  const normalizedParagraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => normalizeNoEmDash(paragraph).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const paragraph of normalizedParagraphs) {
    const sentences = splitSentenceUnits(paragraph);
    if (!sentences.length) {
      continue;
    }

    let current = "";
    for (const sentence of sentences) {
      const sentenceText = sentence.replace(/\s+/g, " ").trim();
      if (!sentenceText) {
        continue;
      }

      const candidate = current ? `${current} ${sentenceText}` : sentenceText;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }

      if (current) {
        segments.push(current);
      }

      if (sentenceText.length <= maxChars) {
        current = sentenceText;
      } else {
        const longSentenceParts = splitTextByWordBudget(sentenceText, maxChars);
        if (longSentenceParts.length > 1) {
          segments.push(...longSentenceParts.slice(0, -1));
        }
        current = longSentenceParts[longSentenceParts.length - 1] ?? "";
      }
    }

    if (current) {
      segments.push(current);
    }
  }

  return segments;
}

function stripThreadPaginationMarkers(value: string): string {
  const withoutLeading = value.replace(/^\s*\d+\s*\/\s*\d+\s*[-–—:]\s*/g, "");
  const withoutTrailing = withoutLeading.replace(/\s*[-–—:]?\s*\d+\s*\/\s*\d+\s*$/g, "");
  return withoutTrailing.trim();
}

function stripThreadOpenerMarker(value: string): string {
  return value.replace(/\s*a thread\s*🧵\s*$/i, "").trim();
}

function formatXThreadPosts(threadPosts: string[]): string[] {
  if (!threadPosts.length) {
    return [];
  }

  if (threadPosts.length === 1) {
    const singlePost = stripThreadOpenerMarker(threadPosts[0]) || threadPosts[0];
    return [clipTextStrictMax(singlePost, MAX_X_THREAD_POST_CHARS)];
  }

  const total = threadPosts.length;
  const firstBaseRaw = stripThreadOpenerMarker(threadPosts[0]) || threadPosts[0];
  const firstBodyMaxChars = Math.max(1, MAX_X_THREAD_POST_CHARS - X_THREAD_FIRST_POST_OPENER.length - 1);
  const firstBody = clipTextStrictMax(firstBaseRaw, firstBodyMaxChars);
  const firstPost = `${firstBody} ${X_THREAD_FIRST_POST_OPENER}`.trim();

  const remainingPosts = threadPosts.slice(1).map((post, index) => {
    const ordinalPrefix = `${index + 2}/${total} - `;
    const cleanPost = stripThreadOpenerMarker(post) || post;
    const maxBodyChars = Math.max(1, MAX_X_THREAD_POST_CHARS - ordinalPrefix.length);
    const clippedBody = clipTextStrictMax(cleanPost, maxBodyChars);
    return `${ordinalPrefix}${clippedBody}`.trim();
  });

  return [firstPost, ...remainingPosts];
}

function sanitizeXThreadPosts(threadPosts: string[]): string[] {
  const normalized = threadPosts
    .map((post) => stripThreadPaginationMarkers(normalizeNoEmDash(post).replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .slice(0, 24);

  if (!normalized.length) {
    return [];
  }

  return formatXThreadPosts(normalized);
}

function buildXThreadFromLinkedInPost(post: { hook: string; body: string; cta: string }): string[] {
  const hook = normalizeNoEmDash(post.hook).replace(/\s+/g, " ").trim();
  const body = stripLeadingHookFromBody(post.hook, post.body);
  const cta = normalizeNoEmDash(post.cta).replace(/\s+/g, " ").trim();

  const sourceBlocks = [hook, body, cta].filter(Boolean);
  if (!sourceBlocks.length) {
    return [];
  }

  const segments = sourceBlocks.flatMap((block) => buildThreadSegmentsFromText(block, X_THREAD_PACK_TARGET_CHARS));
  if (!segments.length) {
    return [];
  }

  const packedPosts: string[] = [];
  let current = "";

  for (const segment of segments) {
    const candidate = current ? `${current}\n\n${segment}` : segment;
    if (candidate.length <= X_THREAD_PACK_TARGET_CHARS) {
      current = candidate;
      continue;
    }

    if (current) {
      packedPosts.push(current);
    }

    if (segment.length <= X_THREAD_PACK_TARGET_CHARS) {
      current = segment;
      continue;
    }

    const forcedParts = splitTextByWordBudget(segment, X_THREAD_PACK_TARGET_CHARS);
    if (forcedParts.length > 1) {
      packedPosts.push(...forcedParts.slice(0, -1));
    }
    current = forcedParts[forcedParts.length - 1] ?? "";
  }

  if (current) {
    packedPosts.push(current);
  }

  const normalizedPackedPosts = packedPosts
    .map((part) => normalizeNoEmDash(part).trim())
    .filter(Boolean);

  return sanitizeXThreadPosts(normalizedPackedPosts);
}

function stripAiScaffoldOpeners(paragraph: string): string {
  const trimmed = paragraph.trim();
  if (!trimmed) {
    return "";
  }

  const stripped = trimmed
    .replace(AI_SCAFFOLD_OPENING_PATTERN, "")
    .replace(AI_SCAFFOLD_SOFT_OPENING_PATTERN, "")
    .trim();

  return stripped || trimmed;
}

function collapseSingleNewlinesToSpaces(text: string): string {
  return text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

function splitParagraphIntoBalancedChunks(paragraph: string): string[] {
  const compactParagraph = collapseSingleNewlinesToSpaces(paragraph);
  if (!compactParagraph) {
    return [];
  }

  if (isListLikeParagraph(compactParagraph)) {
    return [compactParagraph];
  }

  const sentences = splitSentenceUnits(compactParagraph)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!sentences.length) {
    return [];
  }

  if (sentences.length <= 4) {
    return [sentences.join(" ")];
  }

  const chunks: string[] = [];
  let index = 0;

  while (index < sentences.length) {
    const remaining = sentences.length - index;
    let size = 3;

    if (remaining <= 4) {
      size = remaining;
    } else if (remaining === 5) {
      size = 2;
    } else if (remaining === 8) {
      size = 4;
    } else if (remaining % 3 === 1 && remaining >= 4) {
      size = 4;
    }

    const chunk = sentences
      .slice(index, index + size)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (chunk) {
      chunks.push(chunk);
    }
    index += size;
  }

  if (chunks.length >= 2) {
    const lastChunk = chunks[chunks.length - 1] ?? "";
    const lastChunkSentenceCount = countSentencesInParagraph(lastChunk);

    if (lastChunkSentenceCount === 1) {
      const previousChunk = chunks[chunks.length - 2] ?? "";
      const previousSentenceCount = countSentencesInParagraph(previousChunk);
      if (previousChunk && previousSentenceCount < 4) {
        chunks[chunks.length - 2] = `${previousChunk} ${lastChunk}`.replace(/\s+/g, " ").trim();
        chunks.pop();
      }
    }
  }

  return chunks;
}

function stabilizeParagraphCadence(paragraphs: string[]): string[] {
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const cleanParagraph = paragraph.replace(/\s+/g, " ").trim();
    if (!cleanParagraph) {
      continue;
    }

    const sentenceCount = countSentencesInParagraph(cleanParagraph);
    if (
      sentenceCount === 1 &&
      out.length > 0 &&
      !isListLikeParagraph(cleanParagraph) &&
      countSentencesInParagraph(out[out.length - 1] ?? "") < 4
    ) {
      out[out.length - 1] = `${out[out.length - 1]} ${cleanParagraph}`.replace(/\s+/g, " ").trim();
      continue;
    }

    out.push(cleanParagraph);
  }

  return out;
}

function isListLikeParagraph(paragraph: string): boolean {
  return /^(?:first|second|third|fourth|fifth|finally|lastly|\d+[.)]|-)\b/i.test(paragraph.trim());
}

function mergeThinParagraphRuns(paragraphs: string[]): string[] {
  if (paragraphs.length < 6) {
    return paragraphs;
  }

  const merged: string[] = [];
  let index = 0;

  while (index < paragraphs.length) {
    const paragraph = paragraphs[index];
    const sentenceCount = countSentencesInParagraph(paragraph);
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    const isThin = sentenceCount <= 2 && words <= 55 && !isListLikeParagraph(paragraph);

    if (!isThin) {
      merged.push(paragraph);
      index += 1;
      continue;
    }

    const run: string[] = [];
    while (index < paragraphs.length) {
      const candidate = paragraphs[index];
      const candidateSentences = countSentencesInParagraph(candidate);
      const candidateWords = candidate.split(/\s+/).filter(Boolean).length;
      const candidateIsThin =
        candidateSentences <= 2 && candidateWords <= 55 && !isListLikeParagraph(candidate);
      if (!candidateIsThin) {
        break;
      }
      run.push(candidate);
      index += 1;
    }

    if (run.length < 3) {
      merged.push(...run);
      continue;
    }

    let runIndex = 0;
    while (runIndex < run.length) {
      const chunk: string[] = [];
      let chunkSentences = 0;

      while (runIndex < run.length) {
        const nextParagraph = run[runIndex];
        const nextSentences = countSentencesInParagraph(nextParagraph);
        const nextTotal = chunkSentences + nextSentences;

        if (chunkSentences >= 2 && nextTotal > 4) {
          break;
        }

        chunk.push(nextParagraph);
        chunkSentences = nextTotal;
        runIndex += 1;

        if (chunkSentences >= 3) {
          break;
        }
      }

      if (!chunk.length) {
        break;
      }

      if (chunk.length === 1 && runIndex < run.length) {
        chunk.push(run[runIndex]);
        runIndex += 1;
      }

      merged.push(chunk.join(" ").replace(/\s+/g, " ").trim());
    }
  }

  return merged;
}

function enforceReadableParagraphBreaks(body: string): string {
  const normalizedBody = normalizeNoEmDash(body).trim();
  if (!normalizedBody) {
    return "";
  }

  const sourceParagraphs = splitParagraphs(normalizedBody);
  const seedParagraphs = sourceParagraphs.length ? sourceParagraphs : [normalizedBody];
  const balancedParagraphs = seedParagraphs.flatMap((paragraph) => splitParagraphIntoBalancedChunks(paragraph));
  const cadenceStabilized = stabilizeParagraphCadence(balancedParagraphs);
  const nonEmptyParagraphs = cadenceStabilized.filter(Boolean);

  if (!nonEmptyParagraphs.length) {
    return collapseSingleNewlinesToSpaces(normalizedBody);
  }

  if (nonEmptyParagraphs.length === 1) {
    return nonEmptyParagraphs[0] ?? "";
  }

  return nonEmptyParagraphs.join("\n\n");
}

function normalizeBodyRhythm(body: string): string {
  const rawParagraphs = splitParagraphs(body).map(stripAiScaffoldOpeners).filter(Boolean);
  const paragraphs = rawParagraphs.map((p) => collapseSingleNewlinesToSpaces(p));
  if (paragraphs.length < 4) {
    return enforceReadableParagraphBreaks(paragraphs.join("\n\n"));
  }

  const out: string[] = [];
  let index = 0;

  while (index < paragraphs.length) {
    const sentenceCount = countSentencesInParagraph(paragraphs[index]);

    if (sentenceCount !== 1) {
      out.push(paragraphs[index]);
      index += 1;
      continue;
    }

    const run: string[] = [];
    while (index < paragraphs.length && countSentencesInParagraph(paragraphs[index]) === 1) {
      run.push(paragraphs[index]);
      index += 1;
    }

    if (run.length <= 1) {
      out.push(run[0]);
      continue;
    }

    const groupSize = run.length >= 5 ? 3 : 2;
    for (let runIndex = 0; runIndex < run.length; runIndex += groupSize) {
      const chunk = run.slice(runIndex, runIndex + groupSize);
      if (!chunk.length) {
        continue;
      }
      out.push(chunk.join(" ").replace(/\s+/g, " ").trim());
    }
  }

  const rebalanced = mergeThinParagraphRuns(out);
  return enforceReadableParagraphBreaks(rebalanced.join("\n\n"));
}

function hasAiScaffoldOpener(body: string): boolean {
  const paragraphs = splitParagraphs(body);
  return paragraphs.some(
    (paragraph) => AI_SCAFFOLD_OPENING_PATTERN.test(paragraph) || AI_SCAFFOLD_SOFT_OPENING_PATTERN.test(paragraph),
  );
}

function hasCondescendingReaderLanguage(value: string): boolean {
  return CONDESCENDING_READER_PATTERN.test(value);
}

function hasFirstPersonSingularPronouns(value: string): boolean {
  return FIRST_PERSON_SINGULAR_PATTERN.test(value);
}

function hasUnsupportedAdaptySuperlative(value: string): boolean {
  if (!ADAPTY_SUPERLATIVE_PATTERN.test(value)) {
    return false;
  }

  return !ADAPTY_PROOF_SIGNAL_PATTERN.test(value);
}

function hasCorporateJargon(value: string): boolean {
  return CORPORATE_JARGON_PATTERN.test(value);
}

function hasRoboticCorporateTone(value: string): boolean {
  return ROBOTIC_CORPORATE_PATTERN.test(value);
}

function hasDirectReaderAddress(value: string): boolean {
  return /\b(you|your|your app|your team)\b/i.test(value);
}

function hasOperatorActionLanguage(value: string): boolean {
  return OPERATOR_ACTION_VERB_PATTERN.test(value);
}

function hasUnexpandedSoisAcronym(value: string): boolean {
  return SOIS_ACRONYM_PATTERN.test(value) && !SOIS_EXPANDED_PATTERN.test(value);
}

function hasLabelStyleSentenceOpener(value: string): boolean {
  return AI_LABEL_STYLE_OPENER_PATTERN.test(value);
}

function hasDenseMetricDump(value: string): boolean {
  const sentences = splitSentenceUnits(value);
  return sentences.some((sentence) => {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;
    const numericCount = countNumericTokens(sentence);
    return wordCount >= 24 && numericCount >= 3;
  });
}

function shouldEnforceClickbaitViralityHook(style: string, goal: ContentGoal): boolean {
  return style.trim().toLowerCase() === "clickbait" && goal === "virality";
}

function hasStaccatoParagraphRhythm(body: string): boolean {
  const paragraphs = splitParagraphs(body);

  if (paragraphs.length < 4) {
    return false;
  }

  let oneSentenceParagraphs = 0;
  let totalSentences = 0;
  let shortSentences = 0;
  let maxOneSentenceRun = 0;
  let currentOneSentenceRun = 0;

  for (const paragraph of paragraphs) {
    const sentenceUnits = splitSentenceUnits(paragraph);
    if (sentenceUnits.length <= 1) {
      oneSentenceParagraphs += 1;
      currentOneSentenceRun += 1;
      if (currentOneSentenceRun > maxOneSentenceRun) {
        maxOneSentenceRun = currentOneSentenceRun;
      }
    } else {
      currentOneSentenceRun = 0;
    }

    for (const sentence of sentenceUnits) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      totalSentences += 1;
      if (words <= 8) {
        shortSentences += 1;
      }
    }
  }

  const oneSentenceRatio = oneSentenceParagraphs / paragraphs.length;
  const shortSentenceRatio = totalSentences > 0 ? shortSentences / totalSentences : 0;

  return (
    (paragraphs.length >= 5 && oneSentenceRatio >= 0.5) ||
    (totalSentences >= 8 && shortSentenceRatio >= 0.5) ||
    maxOneSentenceRun >= 3
  );
}

function evaluatePostQuality(params: {
  post: {
    hook: string;
    body: string;
    cta: string;
  };
  style: string;
  goal: ContentGoal;
  inputType: string;
  time: string;
  place: string;
  requireNumericAnchor: boolean;
}): string[] {
  const issues: string[] = [];
  const combinedText = `${params.post.hook}\n${params.post.body}\n${params.post.cta}`;
  const lowerInputType = params.inputType.toLowerCase();
  const isEvent = /event|webinar/.test(lowerInputType);
  const isClickbaitVirality = shouldEnforceClickbaitViralityHook(params.style, params.goal);
  const nonEmptyBodyLines = params.post.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (AI_SLOP_PHRASE_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.AI_SLOP_CLICHES);
  }

  if (hasCondescendingReaderLanguage(combinedText)) {
    issues.push(QUALITY_ISSUES.CONDESCENDING);
  }

  if (hasFirstPersonSingularPronouns(combinedText)) {
    issues.push(QUALITY_ISSUES.FIRST_PERSON_SINGULAR);
  }

  if (hasUnsupportedAdaptySuperlative(combinedText)) {
    issues.push(QUALITY_ISSUES.UNSUPPORTED_ADAPTY_SUPERLATIVE);
  }

  if (hasCorporateJargon(combinedText)) {
    issues.push(QUALITY_ISSUES.CORPORATE_JARGON);
  }

  if (hasRoboticCorporateTone(combinedText)) {
    issues.push(QUALITY_ISSUES.ROBOTIC_TONE);
  }

  if (!hasDirectReaderAddress(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_DIRECT_READER);
  }

  if (!hasOperatorActionLanguage(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_OPERATOR_ACTION);
  }

  if (hasUnexpandedSoisAcronym(combinedText)) {
    issues.push(QUALITY_ISSUES.UNEXPANDED_SOIS);
  }

  if (hasLabelStyleSentenceOpener(combinedText)) {
    issues.push(QUALITY_ISSUES.LABEL_STYLE_OPENER);
  }

  if (hasAiScaffoldOpener(params.post.body)) {
    issues.push(QUALITY_ISSUES.AI_SCAFFOLD_OPENER);
  }

  if (ROBOTIC_FILLER_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.ROBOTIC_FILLER);
  }

  if (SNAPSHOT_JARGON_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.SNAPSHOT_JARGON);
  }

  if (hasDenseMetricDump(combinedText)) {
    issues.push(QUALITY_ISSUES.DENSE_METRIC_DUMP);
  }

  if (countConcreteProofUnits(combinedText) < 1) {
    issues.push(QUALITY_ISSUES.MISSING_PROOF_UNIT);
  }

  if (params.requireNumericAnchor && countNumericTokens(combinedText) < 1) {
    issues.push(QUALITY_ISSUES.MISSING_NUMERIC_ANCHOR);
  }

  if (countSpecificityAnchors(combinedText) < 1 && !SPECIFICITY_ANCHOR_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_SPECIFICITY);
  }

  if (params.post.body.length > 280 && !/\n\s*\n/.test(params.post.body)) {
    issues.push(QUALITY_ISSUES.MISSING_BLANK_LINES);
  }

  if (hasShortLineStack(params.post.body)) {
    issues.push(QUALITY_ISSUES.SHORT_LINE_STACK);
  }

  if (hasStaccatoParagraphRhythm(params.post.body)) {
    issues.push(QUALITY_ISSUES.STACCATO_RHYTHM);
  }

  if (isClickbaitVirality) {
    const hook = params.post.hook.trim();
    const hookSentences = splitSentenceUnits(hook);
    const firstSentence = hookSentences[0]?.trim() ?? hook;

    if (hookSentences.length !== 1) {
      issues.push(QUALITY_ISSUES.CLICKBAIT_HOOK_ONE_SENTENCE);
    }

    if (firstSentence.endsWith("?")) {
      issues.push(QUALITY_ISSUES.CLICKBAIT_HOOK_DECLARATIVE);
    }

    if (HOOK_IF_OPENING_PATTERN.test(firstSentence)) {
      issues.push(QUALITY_ISSUES.CLICKBAIT_HOOK_NO_IF);
    }

    if (countNumericTokens(firstSentence) < 1 && !SPECIFICITY_ANCHOR_PATTERN.test(firstSentence)) {
      issues.push(QUALITY_ISSUES.CLICKBAIT_HOOK_NEEDS_FACT_ANCHOR);
    }

    if (!YOU_YOUR_PATTERN.test(firstSentence)) {
      issues.push(QUALITY_ISSUES.CLICKBAIT_HOOK_DIRECT_READER);
    }
  }

  if (isEvent) {
    if (params.time.trim() && !looseIncludes(combinedText, params.time)) {
      issues.push(QUALITY_ISSUES.EVENT_MISSING_TIME);
    }

    if (params.place.trim() && !looseIncludes(combinedText, params.place)) {
      issues.push(QUALITY_ISSUES.EVENT_MISSING_PLACE);
    }

    if (nonEmptyBodyLines.length < 4) {
      issues.push(QUALITY_ISSUES.EVENT_BODY_THIN);
    }

    if (!EVENT_FORMAT_PATTERN.test(combinedText)) {
      issues.push(QUALITY_ISSUES.EVENT_MISSING_FORMAT);
    }
  }

  return issues;
}

function getOpenAIApiToken(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.OPENAI_ACCESS_TOKEN;
}

function getOpenAIClient(token: string): { client: OpenAI; usingCustomBaseUrl: boolean } {
  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  if (baseURL) {
    return {
      client: new OpenAI({
        apiKey: token,
        baseURL,
      }),
      usingCustomBaseUrl: true,
    };
  }

  return {
    client: new OpenAI({ apiKey: token }),
    usingCustomBaseUrl: false,
  };
}

function getEmbeddingClient(): OpenAI | undefined {
  const token = getOpenAIApiToken();
  if (!token) {
    return undefined;
  }

  const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL?.trim();

  if (embeddingBaseUrl) {
    return new OpenAI({
      apiKey: token,
      baseURL: embeddingBaseUrl,
    });
  }

  return new OpenAI({ apiKey: token });
}

function isModelAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("unknown model") ||
    message.includes("invalid model") ||
    message.includes("model not found")
  );
}

function isCodexOauthModelSupported(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  // Codex ChatGPT-account responses do not support Anthropic model IDs.
  if (normalized.startsWith("claude")) {
    return false;
  }

  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLooseLinkPattern(link: string): RegExp {
  const pattern = link
    .split("")
    .map((char) => `${escapeRegExp(char)}\\s*`)
    .join("");
  return new RegExp(pattern, "gi");
}

function ensureFinalCta(cta: string, ctaLink: string): string {
  const cleanCta = cta.trim();
  const cleanLink = ctaLink.trim();

  if (!cleanLink) {
    return cleanCta;
  }

  if (!cleanCta) {
    return cleanLink;
  }

  const ctaWithoutLink = cleanCta.replace(buildLooseLinkPattern(cleanLink), " ");
  const hadLink = ctaWithoutLink !== cleanCta;

  if (hadLink) {
    const strippedCta = ctaWithoutLink
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[-\u2013\u2014\s.,;:!?]+$/g, "");
    return strippedCta ? `${strippedCta}. ${cleanLink}` : cleanLink;
  }

  return `${cleanCta.replace(/[.\s]+$/g, "")}. ${cleanLink}`;
}

function normalizeCtaLink(rawLink: string): string {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:";
    if (!isHttp) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function trimTrailingEmptyStrings(values: string[]): string[] {
  const next = [...values];
  while (next.length && !next[next.length - 1].trim()) {
    next.pop();
  }
  return next;
}

function normalizeNoEmDash(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function normalizeMemeLine(value: string): string {
  return normalizeNoEmDash(value)
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function normalizeMemeComparisonKey(value: string): string {
  return normalizeMemeLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function memeLinesAreEquivalent(first: string, second: string): boolean {
  const firstKey = normalizeMemeComparisonKey(first);
  const secondKey = normalizeMemeComparisonKey(second);

  return Boolean(firstKey && secondKey && firstKey === secondKey);
}

function clipMemeLine(value: string, maxChars: number): string {
  const clean = normalizeMemeLine(value);

  if (clean.length <= maxChars) {
    return clean;
  }

  const clipped = clean.slice(0, maxChars + 1).replace(/\s+\S*$/, "").trim();
  return clipped || clean.slice(0, maxChars).trim();
}

function encodeMemegenPathSegment(value: string): string {
  const clean = normalizeMemeLine(value);

  if (!clean) {
    return "_";
  }

  return clean
    .replace(/-/g, "--")
    .replace(/_/g, "__")
    .replace(/\?/g, "~q")
    .replace(/%/g, "~p")
    .replace(/#/g, "~h")
    .replace(/\//g, "~s")
    .replace(/"/g, "''")
    .replace(/\s+/g, "_");
}

function getMemegenBaseUrl(): string {
  const custom = process.env.MEMEGEN_BASE_URL?.trim();

  if (!custom) {
    return DEFAULT_MEMEGEN_BASE_URL;
  }

  return custom.replace(/\/+$/g, "");
}

function getKnownMemeTemplateLineCount(templateId: string): number {
  const normalized = templateId.trim().toLowerCase();
  const known = KNOWN_MEME_TEMPLATE_LINE_COUNTS[normalized];
  if (Number.isInteger(known) && known >= 2 && known <= MAX_MEME_TEMPLATE_LINE_COUNT) {
    return known;
  }

  return DEFAULT_MEME_TEMPLATE_LINE_COUNT;
}

function sanitizeMemeLineCount(value: unknown, fallbackValue = DEFAULT_MEME_TEMPLATE_LINE_COUNT): number {
  if (!Number.isInteger(value)) {
    return fallbackValue;
  }

  return Math.min(MAX_MEME_TEMPLATE_LINE_COUNT, Math.max(2, Number(value)));
}

async function fetchMemegenTemplateLineCount(templateId: string): Promise<number> {
  const normalizedTemplateId = templateId.trim().toLowerCase();
  if (!normalizedTemplateId) {
    return DEFAULT_MEME_TEMPLATE_LINE_COUNT;
  }

  const cached = MEME_TEMPLATE_LINE_COUNT_CACHE.get(normalizedTemplateId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.lineCount;
  }

  const fallbackLineCount = getKnownMemeTemplateLineCount(normalizedTemplateId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEME_TEMPLATE_LINE_COUNT_TIMEOUT_MS);

  try {
    const response = await fetch(`${getMemegenBaseUrl()}/templates/${encodeURIComponent(normalizedTemplateId)}`, {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal,
    });

    if (!response.ok) {
      MEME_TEMPLATE_LINE_COUNT_CACHE.set(normalizedTemplateId, {
        lineCount: fallbackLineCount,
        expiresAt: Date.now() + MEME_TEMPLATE_LINE_COUNT_CACHE_TTL_MS,
      });
      return fallbackLineCount;
    }

    const payload = (await response.json()) as { lines?: unknown };
    const resolvedLineCount = sanitizeMemeLineCount(payload.lines, fallbackLineCount);
    MEME_TEMPLATE_LINE_COUNT_CACHE.set(normalizedTemplateId, {
      lineCount: resolvedLineCount,
      expiresAt: Date.now() + MEME_TEMPLATE_LINE_COUNT_CACHE_TTL_MS,
    });
    return resolvedLineCount;
  } catch {
    MEME_TEMPLATE_LINE_COUNT_CACHE.set(normalizedTemplateId, {
      lineCount: fallbackLineCount,
      expiresAt: Date.now() + MEME_TEMPLATE_LINE_COUNT_CACHE_TTL_MS,
    });
    return fallbackLineCount;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveMemegenTemplateLineCountMap(templateIds: string[]): Promise<Map<string, number>> {
  const uniqueTemplateIds = Array.from(
    new Set(
      templateIds
        .map((templateId) => templateId.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const lineCountEntries = await Promise.all(
    uniqueTemplateIds.map(async (templateId) => [templateId, await fetchMemegenTemplateLineCount(templateId)] as const),
  );

  return new Map<string, number>(lineCountEntries);
}

function resolveMemeTextLines(params: {
  templateId: string;
  templateLineCount: number;
  topText: string;
  bottomText: string;
  textLines?: string[];
}): string[] {
  const normalizedTemplateId = params.templateId.trim().toLowerCase();
  const targetLineCount = sanitizeMemeLineCount(params.templateLineCount);
  const slotMaxChars =
    targetLineCount >= 6 ? 52 : targetLineCount === 5 ? 48 : targetLineCount === 4 ? 44 : targetLineCount === 3 ? 56 : MEME_LINE_MAX_CHARS;
  const danglingTailWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "because",
    "to",
    "for",
    "with",
    "without",
    "in",
    "on",
    "at",
    "of",
    "your",
    "our",
    "their",
    "his",
    "her",
    "my",
  ]);
  const validateLine = (line: string, lineIndex: number) => {
    const clean = clipMemeLine(line, slotMaxChars);
    if (!clean) {
      throw new Error(`Template '${normalizedTemplateId}' line ${lineIndex + 1} is empty.`);
    }

    // Normalize common model artifacts without aborting the entire generation.
    let normalized = clean.replace(/^(and|but)\b[\s,:-]*/i, "").trim();
    if (!normalized) {
      throw new Error(`Template '${normalizedTemplateId}' line ${lineIndex + 1} is empty after cleanup.`);
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    while (words.length > 1) {
      const tail = words.at(-1)?.toLowerCase() ?? "";
      if (!tail || !danglingTailWords.has(tail)) {
        break;
      }
      words.pop();
    }

    normalized = words.join(" ").trim();
    if (!normalized) {
      throw new Error(`Template '${normalizedTemplateId}' line ${lineIndex + 1} is empty after cleanup.`);
    }

    const speakerLabel = detectSpeakerLabelPrefix(normalized);
    if (speakerLabel && !MEME_DIALOGUE_TEMPLATE_IDS.has(normalizedTemplateId)) {
      throw new Error(
        `Template '${normalizedTemplateId}' line ${lineIndex + 1} should not start with a speaker label ("${speakerLabel}:").`,
      );
    }

    return normalized;
  };

  const normalizedProvidedLines = (params.textLines ?? [])
    .map((line) => normalizeNoEmDash(line))
    .map((line) => line.trim())
    .filter(Boolean);

  const resolvedLines =
    targetLineCount <= 2 && normalizedProvidedLines.length < 2
      ? [params.topText, params.bottomText].map((line) => normalizeNoEmDash(line)).map((line) => line.trim()).filter(Boolean)
      : normalizedProvidedLines;

  if (resolvedLines.length < targetLineCount) {
    throw new Error(
      `Template '${normalizedTemplateId}' requires at least ${targetLineCount} lines, received ${resolvedLines.length}.`,
    );
  }

  const finalLines = resolvedLines.slice(0, targetLineCount).map((line, lineIndex) => validateLine(line, lineIndex));

  if (normalizedTemplateId === GONE_TEMPLATE_ID && finalLines.length >= 2) {
    // Force the canonical South Park punchline for this template.
    finalLines[1] = GONE_TEMPLATE_FIXED_BOTTOM_TEXT;
  }

  const uniqueCount = finalLines.filter((line, index) => !finalLines.slice(0, index).some((prev) => memeLinesAreEquivalent(prev, line))).length;

  if (uniqueCount < finalLines.length) {
    throw new Error(`Template '${normalizedTemplateId}' includes duplicate lines; provide unique line-by-line dialogue.`);
  }

  if ((normalizedTemplateId === "right" || normalizedTemplateId === "anakin") && finalLines.length >= 4) {
    if (!finalLines[1]?.includes("?") || !finalLines[3]?.includes("?")) {
      throw new Error(`Template '${normalizedTemplateId}' must follow dialogue flow with question beats on lines 2 and 4.`);
    }
  }

  return finalLines;
}

function buildMemegenImageUrl(templateId: string, textLines: string[]): string {
  const encodedLines = textLines.map((line) => encodeMemegenPathSegment(line)).join("/");
  return `${getMemegenBaseUrl()}/images/${templateId}/${encodedLines}.jpg`;
}

type MemeVariantCandidate = {
  templateId: MemeTemplateId;
  topText: string;
  bottomText: string;
  textLines?: string[];
  toneFitScore: number;
  toneFitReason: string;
};

function makeMemeSelectionResponseSchema(postCount: number, variantCount: number) {
  return z.object({
    selections: z
      .array(
        z.object({
          postIndex: z.number().int().min(1).max(postCount),
          variants: z
            .array(
              z.object({
                templateId: z
                  .string()
                  .trim()
                  .min(1)
                  .max(120)
                  .regex(/^[a-z0-9-]+$/i, "templateId must use letters, numbers, and hyphen only"),
                topText: z.string().min(4).max(120),
                bottomText: z.string().min(4).max(120),
                textLines: z
                  .array(z.string().min(2).max(120))
                  .min(2)
                  .max(MAX_MEME_TEMPLATE_LINE_COUNT)
                  .optional(),
                toneFitScore: z.number().int().min(0).max(100),
                toneFitReason: z.string().min(8).max(220),
              }),
            )
            .length(variantCount),
        }),
      )
      .length(postCount),
  });
}

function makeMemeSelectionJsonSchema(postCount: number, variantCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["selections"],
    properties: {
      selections: {
        type: "array",
        minItems: postCount,
        maxItems: postCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["postIndex", "variants"],
          properties: {
            postIndex: {
              type: "integer",
              minimum: 1,
              maximum: postCount,
            },
            variants: {
              type: "array",
              minItems: variantCount,
              maxItems: variantCount,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["templateId", "topText", "bottomText", "textLines", "toneFitScore", "toneFitReason"],
                properties: {
                  templateId: {
                    type: "string",
                    minLength: 1,
                    maxLength: 120,
                    pattern: "^[a-zA-Z0-9-]+$",
                  },
                  topText: {
                    type: "string",
                    minLength: 4,
                    maxLength: 120,
                  },
                  bottomText: {
                    type: "string",
                    minLength: 4,
                    maxLength: 120,
                  },
                  textLines: {
                    type: "array",
                    minItems: 2,
                    maxItems: MAX_MEME_TEMPLATE_LINE_COUNT,
                    items: {
                      type: "string",
                      minLength: 2,
                      maxLength: 120,
                    },
                  },
                  toneFitScore: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                  },
                  toneFitReason: {
                    type: "string",
                    minLength: 8,
                    maxLength: 220,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function sanitizeModelMemeVariants(params: {
  variants: Array<{
    templateId: string;
    topText: string;
    bottomText: string;
    textLines?: string[];
    toneFitScore: number;
    toneFitReason: string;
  }>;
  allowedTemplateIds: MemeTemplateId[];
}): MemeVariantCandidate[] {
  const allowedTemplateSet = new Set(params.allowedTemplateIds);

  return params.variants.map((variant) => {
    const normalizedTemplateId = variant.templateId.trim().toLowerCase();
    if (!allowedTemplateSet.has(normalizedTemplateId as MemeTemplateId)) {
      throw new Error(`Model returned disallowed meme template '${variant.templateId}'.`);
    }
    const templateId = normalizedTemplateId as MemeTemplateId;
    const topText = normalizeNoEmDash(variant.topText);
    const bottomText = normalizeNoEmDash(variant.bottomText);
    const normalizedTextLines = Array.isArray(variant.textLines)
      ? variant.textLines
          .map((line) => normalizeNoEmDash(line))
          .filter((line) => Boolean(line.trim()))
          .slice(0, MAX_MEME_TEMPLATE_LINE_COUNT)
      : undefined;

    return {
      templateId,
      topText,
      bottomText,
      textLines: normalizedTextLines,
      toneFitScore: variant.toneFitScore,
      toneFitReason: normalizeNoEmDash(variant.toneFitReason),
    };
  });
}

function buildMemeCompanionFromVariant(params: {
  variant: MemeVariantCandidate;
  rank: number;
  templateLineCount: number;
}) {
  const templateName = MEME_TEMPLATE_LABELS[params.variant.templateId] ?? params.variant.templateId;
  const textLines = resolveMemeTextLines({
    templateId: params.variant.templateId,
    templateLineCount: params.templateLineCount,
    topText: params.variant.topText,
    bottomText: params.variant.bottomText,
    textLines: params.variant.textLines,
  });
  const topText = textLines[0];
  const bottomText = textLines[1];
  if (!topText || !bottomText) {
    throw new Error("Insufficient meme lines from LLM");
  }
  const url = buildMemegenImageUrl(params.variant.templateId, textLines);

  return {
    rank: params.rank,
    templateId: params.variant.templateId,
    templateName,
    topText,
    bottomText,
    textLines,
    url,
    toneFitScore: Math.max(0, Math.min(100, Math.round(params.variant.toneFitScore))),
    toneFitReason: normalizeNoEmDash(params.variant.toneFitReason),
  };
}

function formatExampleMetrics(entry: LibraryEntry): string {
  const parts: string[] = [`source: ${entry.source}`];

  if (typeof entry.performance?.impressions === "number") {
    parts.push(`impressions: ${entry.performance.impressions.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance?.likes === "number") {
    parts.push(`likes: ${entry.performance.likes.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance?.comments === "number") {
    parts.push(`comments: ${entry.performance.comments.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance?.reposts === "number") {
    parts.push(`reposts: ${entry.performance.reposts.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance?.clicks === "number") {
    parts.push(`clicks: ${entry.performance.clicks.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance?.ctr === "number") {
    parts.push(`ctr: ${(entry.performance.ctr * 100).toFixed(2)}%`);
  }
  if (typeof entry.performance?.engagementRate === "number") {
    parts.push(`engagement: ${(entry.performance.engagementRate * 100).toFixed(2)}%`);
  }

  return ` [${parts.join(" | ")}]`;
}

function toBulletedSection(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function resolveBrandVoiceDirective(style: string): string {
  const normalizedStyle = style.trim().toLowerCase();
  const sharedHumanDirective =
    "Always sound like a sharp friend talking to another app maker. Human, direct, relatable.";

  if (isBrandVoicePreset(normalizedStyle)) {
    const baseDirective = BRAND_VOICE_PROFILES[normalizedStyle].promptDirective;
    return baseDirective.includes(sharedHumanDirective) ? baseDirective : `${baseDirective} ${sharedHumanDirective}`;
  }

  return `Follow custom brand voice: "${style.trim()}". ${sharedHumanDirective}`;
}

function resolveAutoHookDirective(params: { style: string; inputType: string; goal: ContentGoal }): string {
  const styleKey = params.style.trim().toLowerCase();

  const clickbaitViralityRule =
    styleKey === "clickbait" && params.goal === "virality"
      ? " Hook must be one declarative sentence with a concrete fact people suspect but rarely say. Use you/your. Do not start with If."
      : "";

  const viralityStackRule =
    params.goal === "virality"
      ? " Stack the hook with at least one more dopamine element in the first line or two: scenario, surprise, or payoff."
      : "";

  return `Hook: make it specific, scroll-stopping, and matched to the voice and goal.${clickbaitViralityRule}${viralityStackRule}`;
}

function resolvePostTypeDirective(inputType: string): string {
  for (const entry of POST_TYPE_PLAYBOOKS) {
    if (entry.pattern.test(inputType)) {
      return entry.directive;
    }
  }

  return "Respect the requested post type with concrete context, practical value, and clear reader payoff.";
}

function resolveMemeToneProfile(params: {
  style: string;
  goal: ContentGoal;
  inputType: string;
  memeBrief: string;
}): string {
  const styleKey = params.style.trim().toLowerCase();
  const typeKey = params.inputType.trim().toLowerCase();

  const styleProfile = (() => {
    if (styleKey === "clickbait") {
      return "high-contrast curiosity, punchy lines, and sharp payoff";
    }
    if (styleKey === "founder personal") {
      return "lived operator pain, practical and self-aware humor";
    }
    if (styleKey === "bold / contrarian") {
      return "provocative contrarian framing with strong but useful punchlines";
    }
    if (styleKey === "technical breakdown") {
      return "builder-grade jokes tied to mechanics, metrics, and workflows";
    }
    if (styleKey === "playful meme tone") {
      return "internet-native humor with clever and playful caption style";
    }
    return "Adapty-style sharp practical humor grounded in growth reality";
  })();

  const goalProfile = (() => {
    if (params.goal === "virality") {
      return "optimize for shareability and quote-worthy contrast";
    }
    if (params.goal === "engagement") {
      return "optimize for comments and debate without losing clarity";
    }
    if (params.goal === "traffic") {
      return "optimize for curiosity that leads to qualified clicks";
    }
    if (params.goal === "awareness") {
      return "optimize for broad clarity and memorable framing";
    }
    return "balance reach, comments, and click intent";
  })();

  const postTypeProfile = "keep humor useful and tied to the post context";

  const briefProfile = params.memeBrief.trim()
    ? `honor user brief: "${normalizeNoEmDash(params.memeBrief.trim())}"`
    : "no custom brief provided, invent a clever and funny angle automatically";

  return `${styleProfile}; ${goalProfile}; ${postTypeProfile}; ${briefProfile}.`;
}

function looksLikeSaucePostType(inputType: string): boolean {
  return /\bsauce\b/i.test(inputType);
}

function looksLikeIndustryNewsReactionPostType(inputType: string): boolean {
  return INDUSTRY_NEWS_REACTION_PATTERN.test(inputType);
}

async function runOpenAiChatGeneration(params: {
  token: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
  postCount: number;
  temperature?: number;
}) {
  const { client } = getOpenAIClient(params.token);
  const imageDataUrls = (params.imageDataUrls ?? []).filter(Boolean);
  const userContent: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] = imageDataUrls.length
    ? [
        { type: "text", text: params.userPrompt },
        ...imageDataUrls.map((imageDataUrl) => ({
          type: "image_url" as const,
          image_url: {
            url: imageDataUrl,
            detail: "auto" as const,
          },
        })),
      ]
    : params.userPrompt;

  const completion = await client.chat.completions.parse({
    model: params.model,
    temperature: params.temperature ?? 0.8,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: zodResponseFormat(params.responseSchema, "linkedin_post_batch"),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Model returned no parsable output.");
  }

  return params.responseSchema.parse(normalizeGeneratedBatchPayload(parsed, params.postCount));
}

async function runCodexOauthGeneration(params: {
  oauth: CodexOAuthCredentials;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
  postCount: number;
}) {
  const responseFormat = zodResponseFormat(params.responseSchema, "linkedin_post_batch");
  const jsonSchema = responseFormat.json_schema?.schema;

  if (!jsonSchema || typeof jsonSchema !== "object") {
    throw new Error("Failed to derive JSON schema for Codex structured output");
  }

  const parsedJson = await createCodexStructuredCompletion<unknown>({
    accessToken: params.oauth.accessToken,
    accountId: params.oauth.accountId,
    model: params.model,
    instructions: params.systemPrompt,
    userInput: params.userPrompt,
    imageDataUrls: params.imageDataUrls,
    schemaName: "linkedin_post_batch",
    jsonSchema: jsonSchema as Record<string, unknown>,
    baseUrl: process.env.OPENAI_CODEX_BASE_URL,
  });

  return params.responseSchema.parse(normalizeGeneratedBatchPayload(parsedJson, params.postCount));
}

const CLAUDE_WRITER_MODEL = "claude-sonnet-4-5";
const CLAUDE_ALLOWED_LENGTHS = new Set(["short", "medium", "long", "very long", "standard"]);
const CLAUDE_HOOK_LIMITS = { min: 8, max: 220 } as const;
const CLAUDE_POST_HOOK_LIMITS = { min: 8, max: 280 } as const;
const CLAUDE_POST_BODY_LIMITS = { min: 40, max: 5000 } as const;
const CLAUDE_POST_CTA_LIMITS = { min: 4, max: 320 } as const;
const CLAUDE_FALLBACK_HOOK = "Operator benchmark takeaway you can act on today.";
const CLAUDE_FALLBACK_BODY =
  "Here is a practical breakdown with a concrete lesson app makers can apply this week.";
const CLAUDE_FALLBACK_CTA = "Share your main blocker in the comments.";

function clipTextStrictMax(value: string, maxChars: number): string {
  const normalized = normalizeNoEmDash(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxChars + 1).replace(/\s+\S*$/, "").trim();
  const fallback = normalized.slice(0, maxChars).trim();
  const resolved = clipped || fallback;
  return resolved.length <= maxChars ? resolved : resolved.slice(0, maxChars).trim();
}

function clipMultilineTextStrictMax(value: string, maxChars: number): string {
  const normalized = normalizeNoEmDash(value).replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxChars + 1).replace(/\s+\S*$/, "").trim();
  const fallback = normalized.slice(0, maxChars).trim();
  const resolved = clipped || fallback;
  return resolved.length <= maxChars ? resolved : resolved.slice(0, maxChars).trim();
}

function normalizeClaudeBoundedString(
  value: unknown,
  limits: { min: number; max: number },
  fallbackValue: string,
): string {
  const fallback = clipTextStrictMax(fallbackValue, limits.max);
  const rawValue = typeof value === "string" ? value : fallback;
  const normalized = clipTextStrictMax(rawValue, limits.max);

  if (normalized.length >= limits.min) {
    return normalized;
  }

  if (fallback.length >= limits.min) {
    return fallback;
  }

  return fallback.padEnd(limits.min, ".").slice(0, limits.max);
}

function buildClaudeFallbackPost(length: "short" | "medium" | "long" | "very long" | "standard" = "medium") {
  return {
    length,
    hook: normalizeClaudeBoundedString(CLAUDE_FALLBACK_HOOK, CLAUDE_POST_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK),
    body: normalizeClaudeBoundedString(CLAUDE_FALLBACK_BODY, CLAUDE_POST_BODY_LIMITS, CLAUDE_FALLBACK_BODY),
    cta: normalizeClaudeBoundedString(CLAUDE_FALLBACK_CTA, CLAUDE_POST_CTA_LIMITS, CLAUDE_FALLBACK_CTA),
  };
}

function normalizeGeneratedBatchPayload(
  payload: unknown,
  postCount: number,
): {
  hooks: string[];
  posts: Array<{
    length: "short" | "medium" | "long" | "very long" | "standard";
    hook: string;
    body: string;
    cta: string;
  }>;
} {
  const requiredHookCount = Math.max(5, postCount);
  const normalizedPayload =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawHooks = Array.isArray(normalizedPayload.hooks) ? normalizedPayload.hooks : [];

  const rawPosts = (() => {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(normalizedPayload.posts)) {
      return normalizedPayload.posts;
    }
    if (Array.isArray(normalizedPayload.items)) {
      return normalizedPayload.items;
    }
    if (Array.isArray(normalizedPayload.data)) {
      return normalizedPayload.data;
    }
    return [];
  })();

  const clippedPosts = rawPosts.slice(0, postCount);
  const sanitizedPosts = clippedPosts.map((post) => {
    const rawPost = post && typeof post === "object" ? (post as Record<string, unknown>) : {};
    const rawLength = typeof rawPost.length === "string" ? rawPost.length.trim().toLowerCase() : "";
    const safeLength = CLAUDE_ALLOWED_LENGTHS.has(rawLength) ? rawLength : "medium";

    return {
      length: safeLength as "short" | "medium" | "long" | "very long" | "standard",
      hook: normalizeClaudeBoundedString(rawPost.hook, CLAUDE_POST_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK),
      body: normalizeClaudeBoundedString(rawPost.body, CLAUDE_POST_BODY_LIMITS, CLAUDE_FALLBACK_BODY),
      cta: normalizeClaudeBoundedString(rawPost.cta, CLAUDE_POST_CTA_LIMITS, CLAUDE_FALLBACK_CTA),
    };
  });

  if (!sanitizedPosts.length) {
    sanitizedPosts.push(buildClaudeFallbackPost("medium"));
  }

  while (sanitizedPosts.length < postCount) {
    const templatePost = sanitizedPosts[sanitizedPosts.length - 1] ?? buildClaudeFallbackPost("medium");
    sanitizedPosts.push({ ...templatePost });
  }

  const hookCandidatesFromResponse = rawHooks
    .map((hook) => normalizeClaudeBoundedString(hook, CLAUDE_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK))
    .filter((hook) => hook.length >= CLAUDE_HOOK_LIMITS.min);

  const postHooks = sanitizedPosts
    .map((post) => normalizeClaudeBoundedString(post.hook, CLAUDE_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK))
    .filter((hook) => hook.length >= CLAUDE_HOOK_LIMITS.min);

  const dedupedHookCandidates: string[] = [];
  for (const hook of [...hookCandidatesFromResponse, ...postHooks]) {
    if (dedupedHookCandidates.includes(hook)) {
      continue;
    }
    dedupedHookCandidates.push(hook);
    if (dedupedHookCandidates.length >= 20) {
      break;
    }
  }

  const finalizedHooks = dedupedHookCandidates.length
    ? [...dedupedHookCandidates]
    : [normalizeClaudeBoundedString(CLAUDE_FALLBACK_HOOK, CLAUDE_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK)];
  const hookCycleSource = finalizedHooks.length ? finalizedHooks : [CLAUDE_FALLBACK_HOOK];

  while (finalizedHooks.length < requiredHookCount) {
    finalizedHooks.push(hookCycleSource[finalizedHooks.length % hookCycleSource.length] ?? hookCycleSource[0]);
  }

  return {
    hooks: finalizedHooks
      .slice(0, 20)
      .map((hook) => normalizeClaudeBoundedString(hook, CLAUDE_HOOK_LIMITS, CLAUDE_FALLBACK_HOOK)),
    posts: sanitizedPosts,
  };
}

function buildClaudePostsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      hooks: {
        type: "array",
        items: { type: "string" },
        // Anthropic JSON schema currently allows only minItems 0 or 1.
        minItems: 1,
      },
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            length: { type: "string", enum: ["short", "medium", "long", "very long", "standard"] },
            hook: { type: "string" },
            body: { type: "string" },
            cta: { type: "string" },
          },
          required: ["length", "hook", "body", "cta"],
          additionalProperties: false,
        },
        // Anthropic JSON schema currently allows only minItems 0 or 1.
        minItems: 1,
      },
    },
    required: ["hooks", "posts"],
    additionalProperties: false,
  };
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function parseClaudeJsonBestEffort(value: string): unknown | null {
  const candidates = new Set<string>();
  const trimmed = value.trim();

  if (trimmed) {
    candidates.add(trimmed);
    candidates.add(stripMarkdownCodeFence(trimmed));

    const firstObjectIndex = trimmed.indexOf("{");
    const lastObjectIndex = trimmed.lastIndexOf("}");
    if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
      candidates.add(trimmed.slice(firstObjectIndex, lastObjectIndex + 1));
    }

    const firstArrayIndex = trimmed.indexOf("[");
    const lastArrayIndex = trimmed.lastIndexOf("]");
    if (firstArrayIndex >= 0 && lastArrayIndex > firstArrayIndex) {
      candidates.add(trimmed.slice(firstArrayIndex, lastArrayIndex + 1));
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate
    }
  }

  return null;
}

async function runClaudeWriterGeneration(params: {
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
  postCount: number;
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude writer");
  }

  const client = new Anthropic({ apiKey });
  const userContent: Anthropic.MessageParam["content"] = [];

  for (const imageDataUrl of params.imageDataUrls ?? []) {
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      continue;
    }

    const mediaType = match[1] === "image/png" ? "image/png" : match[1] === "image/jpeg" ? "image/jpeg" : "image/png";
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: match[2] },
    });
  }

  userContent.push({ type: "text", text: params.userPrompt });

  const response = await client.messages.create({
    model: process.env.CLAUDE_WRITER_MODEL ?? CLAUDE_WRITER_MODEL,
    max_tokens: 4096,
    system: params.systemPrompt,
    messages: [{ role: "user", content: userContent }],
    temperature: 0.8,
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: buildClaudePostsJsonSchema(),
      },
    },
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content");
  }

  const parsed =
    parseClaudeJsonBestEffort(textBlock.text) ??
    (() => {
      console.warn(
        "Claude writer returned non-parseable JSON; using fallback post skeleton.",
        textBlock.text.slice(0, 240),
      );
      return {
        hooks: [CLAUDE_FALLBACK_HOOK],
        posts: Array.from({ length: params.postCount }, () => buildClaudeFallbackPost("medium")),
      };
    })();

  return params.responseSchema.parse(normalizeGeneratedBatchPayload(parsed, params.postCount));
}

type XThreadSourcePost = {
  postIndex: number;
  hook: string;
  body: string;
  cta: string;
};

function buildClaudeXThreadJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      threads: {
        type: "array",
        // Anthropic JSON schema currently allows only minItems 0 or 1.
        minItems: 1,
        items: {
          type: "object",
          properties: {
            postIndex: { type: "integer", minimum: 1 },
            posts: {
              type: "array",
              // Anthropic JSON schema currently allows only minItems 0 or 1.
              minItems: 1,
              items: { type: "string" },
            },
          },
          required: ["postIndex", "posts"],
          additionalProperties: false,
        },
      },
    },
    required: ["threads"],
    additionalProperties: false,
  };
}

function buildClaudeMemeSelectionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      selections: {
        type: "array",
        // Anthropic JSON schema currently allows only minItems 0 or 1.
        minItems: 1,
        items: {
          type: "object",
          properties: {
            postIndex: { type: "integer", minimum: 1 },
            variants: {
              type: "array",
              // Anthropic JSON schema currently allows only minItems 0 or 1.
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  templateId: { type: "string" },
                  topText: { type: "string" },
                  bottomText: { type: "string" },
                  textLines: {
                    type: "array",
                    // Anthropic JSON schema currently allows only minItems 0 or 1.
                    minItems: 1,
                    items: { type: "string" },
                  },
                  toneFitScore: { type: "integer", minimum: 0, maximum: 100 },
                  toneFitReason: { type: "string" },
                },
                required: ["templateId", "topText", "bottomText", "textLines", "toneFitScore", "toneFitReason"],
                additionalProperties: false,
              },
            },
          },
          required: ["postIndex", "variants"],
          additionalProperties: false,
        },
      },
    },
    required: ["selections"],
    additionalProperties: false,
  };
}

async function runClaudeXThreadGeneration(params: {
  apiKey: string;
  model: string;
  sourcePosts: XThreadSourcePost[];
}): Promise<Map<number, string[]>> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const sourcePostBlock = params.sourcePosts
    .map(
      (post) => `Post ${post.postIndex}
Hook:
${normalizeNoEmDash(post.hook)}

Body:
${normalizeNoEmDash(post.body)}

CTA:
${normalizeNoEmDash(post.cta)}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: params.model,
    max_tokens: 4096,
    temperature: 0.4,
    system: `You convert LinkedIn posts into X threads.

Rules:
- Keep every claim factual and aligned to the source post.
- Keep tone practical and operator-focused.
- Keep each X post <= ${MAX_X_THREAD_POST_CHARS} characters.
- If a thread has 2 or more posts:
  - First post must end with "${X_THREAD_FIRST_POST_OPENER}".
  - Post 2+ must start with "X/Y - " (for example, "2/11 - ").
  - Never place X/Y at the end of a post.
- Do not include markdown formatting.
- Do not include hashtags unless directly justified by source context.
- Keep links only when they appear in the source CTA/body.
- Return strict JSON only.`,
    messages: [
      {
        role: "user",
        content: `Create one X thread per source post.
Return JSON object:
{
  "threads": [
    { "postIndex": 1, "posts": ["...", "..."] }
  ]
}

Include an item for every source post index.
Each thread should feel cohesive and readable as a sequence.

Source posts:
${sourcePostBlock}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: buildClaudeXThreadJsonSchema(),
      },
    },
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content for X thread generation");
  }

  const parsed = parseClaudeJsonBestEffort(textBlock.text);
  const threadsByPostIndex = new Map<number, string[]>();

  if (!parsed || typeof parsed !== "object") {
    console.warn("Claude X-thread output was non-parseable JSON; skipping X-thread conversion.");
    return threadsByPostIndex;
  }

  const rawThreads = (parsed as { threads?: unknown }).threads;
  if (!Array.isArray(rawThreads)) {
    return threadsByPostIndex;
  }

  for (const rawThread of rawThreads) {
    if (!rawThread || typeof rawThread !== "object") {
      continue;
    }

    const threadCandidate = rawThread as { postIndex?: unknown; posts?: unknown };
    const postIndex =
      Number.isInteger(threadCandidate.postIndex) && Number(threadCandidate.postIndex) > 0
        ? Number(threadCandidate.postIndex)
        : NaN;
    if (!Number.isInteger(postIndex)) {
      continue;
    }

    if (!Array.isArray(threadCandidate.posts)) {
      continue;
    }

    const sanitizedThreadPosts = sanitizeXThreadPosts(
      threadCandidate.posts.filter((post): post is string => typeof post === "string"),
    );
    if (!sanitizedThreadPosts.length) {
      continue;
    }

    threadsByPostIndex.set(postIndex, sanitizedThreadPosts);
  }

  return threadsByPostIndex;
}

async function runClaudeMemeSelection(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: ReturnType<typeof makeMemeSelectionResponseSchema>;
  postCount: number;
  variantCount: number;
  defaultTemplateId: MemeTemplateId;
}) {
  const client = new Anthropic({ apiKey: params.apiKey });
  const response = await client.messages.create({
    model: params.model,
    max_tokens: 4096,
    temperature: 0.95,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: buildClaudeMemeSelectionJsonSchema(),
      },
    },
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content for meme selection");
  }

  const parsed = parseClaudeJsonBestEffort(textBlock.text) ?? {};

  // Keep Claude schema relaxed for compatibility, then tighten shape for strict Zod validation.
  const normalizedPayload = (() => {
    if (!parsed || typeof parsed !== "object") {
      return parsed;
    }

    const parsedObject = parsed as { selections?: unknown };
    const rawSelections = Array.isArray(parsedObject.selections) ? parsedObject.selections : [];
    const selections = rawSelections.slice(0, params.postCount).map((rawSelection, selectionIndex) => {
      const selection = rawSelection && typeof rawSelection === "object" ? (rawSelection as Record<string, unknown>) : {};
      const rawPostIndex =
        typeof selection.postIndex === "number"
          ? selection.postIndex
          : Number.isFinite(Number(selection.postIndex))
            ? Number(selection.postIndex)
            : selectionIndex + 1;
      const postIndex = Math.max(1, Math.min(params.postCount, Math.round(rawPostIndex)));
      const rawVariants = Array.isArray(selection.variants) ? selection.variants : [];
      const variants = rawVariants.slice(0, params.variantCount).map((rawVariant) => {
        const variant = rawVariant && typeof rawVariant === "object" ? (rawVariant as Record<string, unknown>) : {};
        const fallbackTopText = "When the KPI deck says everything is fine";
        const fallbackBottomText = "and production says absolutely not";
        const templateId =
          typeof variant.templateId === "string" && variant.templateId.trim()
            ? variant.templateId.trim()
            : params.defaultTemplateId;
        const topText = clipTextStrictMax(
          normalizeNoEmDash(typeof variant.topText === "string" ? variant.topText : fallbackTopText).trim() || fallbackTopText,
          120,
        );
        const bottomText = clipTextStrictMax(
          normalizeNoEmDash(typeof variant.bottomText === "string" ? variant.bottomText : fallbackBottomText).trim() ||
            fallbackBottomText,
          120,
        );
        const rawTextLines = Array.isArray(variant.textLines) ? variant.textLines : [];
        const normalizedTextLines = rawTextLines
          .filter((line): line is string => typeof line === "string")
          .map((line) => clipTextStrictMax(normalizeNoEmDash(line).trim(), 120))
          .filter((line) => Boolean(line))
          .slice(0, MAX_MEME_TEMPLATE_LINE_COUNT);
        const textLines = normalizedTextLines.length >= 2 ? normalizedTextLines : [topText, bottomText];
        const toneFitScore =
          typeof variant.toneFitScore === "number" && Number.isFinite(variant.toneFitScore)
            ? Math.max(0, Math.min(100, Math.round(variant.toneFitScore)))
            : 78;
        const toneFitReason = clipTextStrictMax(
          normalizeNoEmDash(
            typeof variant.toneFitReason === "string"
              ? variant.toneFitReason
              : "Template meaning and punchline align with the post tension.",
          ).trim() || "Template meaning and punchline align with the post tension.",
          220,
        );
        return {
          templateId,
          topText,
          bottomText,
          textLines,
          toneFitScore,
          toneFitReason,
        };
      });

      return {
        postIndex,
        variants,
      };
    });

    return {
      selections,
    };
  })();

  return params.responseSchema.parse(normalizedPayload);
}

async function runOpenAiChatMemeSelection(params: {
  token: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: ReturnType<typeof makeMemeSelectionResponseSchema>;
}) {
  const { client } = getOpenAIClient(params.token);
  const completion = await client.chat.completions.parse({
    model: params.model,
    temperature: 0.9,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    response_format: zodResponseFormat(params.responseSchema, "meme_variants_batch"),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Model returned no parsable meme output.");
  }

  return parsed;
}

async function runCodexOauthMemeSelection(params: {
  oauth: CodexOAuthCredentials;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: ReturnType<typeof makeMemeSelectionResponseSchema>;
  jsonSchema?: Record<string, unknown>;
}) {
  const jsonSchema =
    params.jsonSchema ??
    (() => {
      const responseFormat = zodResponseFormat(params.responseSchema, "meme_variants_batch");
      return responseFormat.json_schema?.schema;
    })();

  if (!jsonSchema || typeof jsonSchema !== "object") {
    throw new Error("Failed to derive JSON schema for Codex meme structured output");
  }

  const parsedJson = await createCodexStructuredCompletion<unknown>({
    accessToken: params.oauth.accessToken,
    accountId: params.oauth.accountId,
    model: params.model,
    instructions: params.systemPrompt,
    userInput: params.userPrompt,
    schemaName: "meme_variants_batch",
    jsonSchema: jsonSchema as Record<string, unknown>,
    baseUrl: process.env.OPENAI_CODEX_BASE_URL,
  });

  return params.responseSchema.parse(parsedJson);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedInput = generatePostsRequestSchema.safeParse(body);

    if (!parsedInput.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: parsedInput.error.flatten(),
        },
        { status: 400 },
      );
    }

    const input = parsedInput.data;
    const isProductUpdateInputType = looksLikeProductUpdatePostType(input.inputType);
    const shouldIncludeCta = input.includeCta;
    const fallbackCtaLink = shouldIncludeCta
      ? isProductUpdateInputType
        ? normalizeCtaLink(input.ctaLink)
        : input.ctaLink.trim()
      : "";
    const requestedCtaLinks = shouldIncludeCta
      ? trimTrailingEmptyStrings(input.ctaLinks.map((value) => value.trim()))
      : [];
    const effectiveCtaLinksByPost = Array.from({ length: input.numberOfPosts }, (_, index) => {
      const candidateLink = requestedCtaLinks[index] ?? "";
      const normalizedCandidateLink = isProductUpdateInputType
        ? normalizeCtaLink(candidateLink)
        : candidateLink;
      return normalizedCandidateLink || fallbackCtaLink;
    });
    const effectiveCtaLink = effectiveCtaLinksByPost.find(Boolean) ?? fallbackCtaLink;
    const hasPerPostCtaPlan = shouldIncludeCta && requestedCtaLinks.length > 0;
    const shouldUseVisionImageContext = !looksLikeProductUpdatePostType(input.inputType);
    const inputImageDataUrls = shouldUseVisionImageContext
      ? Array.from(
          new Set(
            [input.imageDataUrl, ...input.imageDataUrls]
              .map((value) => value.trim())
              .filter((value) => value.startsWith("data:image/")),
          ),
        ).slice(0, 3)
      : [];
    if (input.giphyEnabled && !process.env.GIPHY_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error: "GIPHY API key is missing",
          message: "Set GIPHY_API_KEY to enable GIF companions.",
        },
        { status: 400 },
      );
    }
    let preparedChartInput: PreparedChartInput | null = null;

    try {
      preparedChartInput = prepareChartInputFromRequest({
        enabled: input.chartEnabled,
        type: input.chartType,
        title: input.chartTitle,
        visualStyle: input.chartVisualStyle,
        imagePrompt: input.chartImagePrompt,
        dataJson: input.chartData,
        optionsJson: input.chartOptions,
      });
    } catch (chartError) {
      if (chartError instanceof ChartInputError) {
        return NextResponse.json(
          {
            error: "Invalid chart input",
            message: chartError.message,
          },
          { status: 400 },
        );
      }

      throw chartError;
    }

    const requestedModel = process.env.OPENAI_MODEL ?? "gpt-5.3-codex";
    const fallbackModel = process.env.OPENAI_MODEL_FALLBACK ?? "gpt-5.2";

    let oauthCredentials: CodexOAuthCredentials | null = null;

    try {
      oauthCredentials = await getCodexOAuthCredentials();
    } catch (oauthError) {
      return NextResponse.json(
        {
          error: "Failed to resolve OpenAI Codex OAuth credentials",
          message: oauthError instanceof Error ? oauthError.message : String(oauthError),
        },
        { status: 500 },
      );
    }

    const openAiApiToken = getOpenAIApiToken();

    if (!oauthCredentials && !openAiApiToken) {
      return NextResponse.json(
        {
          error:
            "Missing credentials. Set OPENAI_CODEX_ACCESS_TOKEN or OPENAI_OAUTH_TOKEN (recommended), or OPENAI_API_KEY / OPENAI_ACCESS_TOKEN.",
        },
        { status: 500 },
      );
    }

    const lengthPlan = buildLengthPlan(input.inputLength, input.numberOfPosts);
    const embeddingClient = getEmbeddingClient();
    const hasSpecificSoisPromptDetails = Boolean(input.details.trim());
    const soisBroadEvidencePromptLimit = parsePositiveIntEnv(
      process.env.SOIS_BROAD_EVIDENCE_PROMPT_LIMIT,
      DEFAULT_SOIS_BROAD_EVIDENCE_PROMPT_LIMIT,
      80,
    );
    const fastBatchThreshold = parsePositiveIntEnv(
      process.env.GENERATION_FAST_BATCH_THRESHOLD,
      DEFAULT_FAST_BATCH_THRESHOLD,
      20,
    );
    const forceFullPasses = parseBooleanEnv(process.env.GENERATION_FORCE_FULL_PASSES, false);
    const preferFastPath = input.numberOfPosts >= fastBatchThreshold && !forceFullPasses;
    const effectiveSoisBroadEvidencePromptLimit = preferFastPath
      ? Math.min(soisBroadEvidencePromptLimit, FAST_PATH_SOIS_BROAD_EVIDENCE_PROMPT_LIMIT)
      : soisBroadEvidencePromptLimit;
    const promptExampleLimit = parsePositiveIntEnv(
      process.env.PROMPT_EXAMPLE_LIMIT,
      DEFAULT_PROMPT_EXAMPLE_LIMIT,
      20,
    );
    const promptExampleCharLimit = parsePositiveIntEnv(
      process.env.PROMPT_EXAMPLE_CHAR_LIMIT,
      DEFAULT_PROMPT_EXAMPLE_CHAR_LIMIT,
      5000,
    );
    const effectivePromptExampleLimit = preferFastPath
      ? Math.min(promptExampleLimit, FAST_PATH_PROMPT_EXAMPLE_LIMIT)
      : promptExampleLimit;
    const effectivePromptExampleCharLimit = preferFastPath
      ? Math.min(promptExampleCharLimit, FAST_PATH_PROMPT_EXAMPLE_CHAR_LIMIT)
      : promptExampleCharLimit;

    if (preferFastPath) {
      console.info(
        `Generation fast-path enabled for ${input.numberOfPosts} posts (threshold=${fastBatchThreshold}): trimming prompt context for speed.`,
      );
    }

    const retrievalQuery = [
      input.goal,
      input.style,
      input.inputType,
      preparedChartInput ? `chart:${preparedChartInput.type}` : "",
      preparedChartInput?.title ?? "",
      preparedChartInput?.visualStyle ?? "",
      preparedChartInput?.imagePrompt ?? "",
      input.memeBrief,
      input.giphyEnabled ? "giphy:on" : "",
      input.giphyQuery,
      input.memeTemplateIds.length ? `templates:${input.memeTemplateIds.join(",")}` : "",
      input.time,
      input.place,
      input.details,
    ]
      .filter(Boolean)
      .join(" | ");
    const soisRetrievalQuery = [
      input.inputType,
      input.details,
      input.time,
      input.place,
      preparedChartInput ? summarizeChartForPrompt(preparedChartInput) : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const isEventOrWebinarPostType = looksLikeEventOrWebinarPostType(input.inputType);
    const isProductUpdatePostType = looksLikeProductUpdatePostType(input.inputType);
    const isYouTubePromoPostType = looksLikeYouTubePromoPostType(input.inputType);
    const shouldRunWebFactCheck = !isProductUpdatePostType && !isYouTubePromoPostType;
    const shouldRunSoisContext = !isProductUpdatePostType && !isEventOrWebinarPostType;
    const webFactCheckSkipReason = isProductUpdatePostType
      ? "Web fact-check skipped for product feature launch post type."
      : isYouTubePromoPostType
        ? "Web fact-check skipped for YouTube promo post type."
      : "Web fact-check skipped for this post type.";
    const soisContextSkipReason = isProductUpdatePostType
      ? "SOIS context skipped for product feature launch post type."
      : isEventOrWebinarPostType
        ? "SOIS context skipped for event/webinar post type."
        : "SOIS context skipped for this post type.";
    const webFactCheckPromise = shouldRunWebFactCheck
      ? runWebFactCheck({
          style: input.style,
          goal: input.goal,
          inputType: input.inputType,
          details: input.details,
          time: input.time,
          place: input.place,
          ctaLink: effectiveCtaLink,
        })
      : Promise.resolve({
          enabled: false,
          provider: "none" as const,
          queries: [],
          sources: [],
          evidenceLines: [],
          warning: webFactCheckSkipReason,
        });
    const sauceLimit = Math.min(12, Math.max(6, input.numberOfPosts * 3));
    const soisContextPromise = looksLikeSaucePostType(input.inputType)
      ? (embeddingClient
          ? retrieveSauceContext({
              client: embeddingClient,
              query: retrievalQuery,
              details: input.details,
              limit: sauceLimit,
            })
          : Promise.resolve<{ items: { id: string; text: string }[]; method: "none" }>({ items: [], method: "none" })
        ).then(async (sauce) => {
          let items = sauce.items.map((item) => ({
            id: item.id,
            category: "market" as const,
            categoryLabel: "Sauce",
            subcategory: 1,
            subcategoryLabel: item.id,
            sourceUrl: "https://appstate2.vercel.app/",
            rows: 0,
            text: item.text,
          }));
          if (items.length === 0) {
            const fallback = await getSauceDataset();
            if (fallback.trim()) {
              items = [
                {
                  id: "sauce-fallback",
                  category: "market" as const,
                  categoryLabel: "Sauce",
                  subcategory: 1,
                  subcategoryLabel: "Sauce dataset",
                  sourceUrl: "https://appstate2.vercel.app/",
                  rows: 0,
                  text: fallback.slice(0, 25_000),
                },
              ];
            }
          }
          return {
            enabled: items.length > 0,
            method: items.length ? sauce.method : ("none" as const),
            items,
            warning: undefined,
            fetchedSections: items.length,
            availableSections: items.length,
          };
        })
      : shouldRunSoisContext
        ? retrieveSoisContext({
            client: embeddingClient,
            query: soisRetrievalQuery || retrievalQuery,
            details: input.details,
            preferBroadCoverage: !hasSpecificSoisPromptDetails,
            inputType: input.inputType,
            limit: Math.min(12, Math.max(6, input.numberOfPosts * 2)),
          })
        : Promise.resolve({
            enabled: false,
            method: "none" as const,
            items: [],
            warning: soisContextSkipReason,
            fetchedSections: 0,
            availableSections: 0,
          });
    const [retrieval, soisContext, webFactCheck, industryNewsContext] = await Promise.all([
      retrieveLibraryContext({
        client: embeddingClient,
        query: retrievalQuery,
        limit: Math.min(12, Math.max(6, input.numberOfPosts * 3)),
        goal: input.goal,
      }),
      soisContextPromise,
      webFactCheckPromise,
      runIndustryNewsContext({
        style: input.style,
        goal: input.goal,
        inputType: input.inputType,
        details: input.details,
      }),
    ]);

    const examplesForPrompt = retrieval.entries
      .slice(0, effectivePromptExampleLimit)
      .map(
        (entry, index) =>
          `Example ${index + 1}${formatExampleMetrics(entry)}:\n${normalizeNoEmDash(
            entry.text.slice(0, effectivePromptExampleCharLimit),
          )}`,
      )
      .join("\n\n---\n\n");

    const performanceInsightsForPrompt = retrieval.performanceInsights?.summaryLines?.length
      ? retrieval.performanceInsights.summaryLines
          .map((line, index) => `${index + 1}. ${normalizeNoEmDash(line)}`)
          .join("\n")
      : "No performance metrics were provided in the content library.";

    const brandVoiceDirective = resolveBrandVoiceDirective(input.style);
    const autoHookDirective = resolveAutoHookDirective({
      style: input.style,
      inputType: input.inputType,
      goal: input.goal,
    });
    const goalExecutionDirective = GOAL_PLAYBOOKS[input.goal];
    const postTypeDirective = resolvePostTypeDirective(input.inputType);
    const chartExecutionDirective = preparedChartInput
      ? "Chart companion is enabled. Ground the narrative in the provided chart values and call out one or two concrete numbers naturally. Match the requested chart visual style."
      : "No chart companion requested.";
    const chartPromptSummary = preparedChartInput ? summarizeChartForPrompt(preparedChartInput) : "(not provided)";
    const memeToneProfile = resolveMemeToneProfile({
      style: input.style,
      goal: input.goal,
      inputType: input.inputType,
      memeBrief: input.memeBrief,
    });
    const memeBriefPreference = input.memeBrief.trim();
    const giphyQueryPreference = input.giphyQuery.trim();
    const memeTemplatePreferences = Array.from(
      new Set(
        input.memeTemplateIds
          .map((id) => id.trim().toLowerCase())
          .filter((id): id is MemeTemplateId => Boolean(id)),
      ),
    );
    const memeVariantTarget = input.memeVariantCount;
    const giphyVariantTarget = 1;
    const includeMemeCompanion = input.memeEnabled;
    const memeExecutionDirective = includeMemeCompanion
      ? "Meme companion is enabled. Keep post copy strong for the selected post type, and let meme captions punch up one concrete insight."
      : "Meme companion is disabled for this request.";
    const industryNewsPromptLines = industryNewsContext.items.map((item, index) => {
      const keywordPart = item.matchedKeywords.length ? ` | matched keywords: ${item.matchedKeywords.join(", ")}` : "";
      return `${index + 1}. [${item.sourceName}] ${normalizeNoEmDash(item.title)}
- URL: ${item.url}
- Published: ${item.publishedAtIso}
- Summary: ${normalizeNoEmDash(item.summary)}
- Score: ${item.score}${keywordPart}`;
    });
    const industryNewsTopicPlanLines =
      looksLikeIndustryNewsReactionPostType(input.inputType) && input.numberOfPosts > 1 && industryNewsContext.items.length
        ? Array.from({ length: input.numberOfPosts }, (_, index) => {
            const item = industryNewsContext.items[index % industryNewsContext.items.length];
            return `Post ${index + 1}: [${item.sourceName}] ${normalizeNoEmDash(item.title)}
- URL: ${item.url}`;
          })
        : [];
    const industryNewsExecutionDirective = looksLikeIndustryNewsReactionPostType(input.inputType)
      ? industryNewsPromptLines.length
        ? input.numberOfPosts > 1
          ? "Industry news context is available. Diversify: each post must anchor to a different primary news item when possible. Follow the per-post topic plan and avoid repeating one story across all posts unless there are fewer unique news items than requested posts."
          : "Industry news context is available. Anchor the post to one relevant recent news item and explain practical implications for app teams."
        : "Industry news context is empty. Do not pretend there is breaking news; provide an opinionated reaction format without fabricated details."
      : "No industry news reaction context required.";
    const industryNewsContextSummary = industryNewsPromptLines.length
      ? industryNewsPromptLines.join("\n\n")
      : "No ranked RSS items available within recency window.";
    const industryNewsTopicPlanSummary = industryNewsTopicPlanLines.length
      ? industryNewsTopicPlanLines.join("\n\n")
      : "(none)";
    const shouldUseSauceAutoTopicPlan = looksLikeSaucePostType(input.inputType) && !hasSpecificSoisPromptDetails;
    const sauceSoisItems = looksLikeSaucePostType(input.inputType)
      ? soisContext.items
      : soisContext.items.filter((item) => item.id.startsWith("all-"));
    const sauceTopicPlanResult = shouldUseSauceAutoTopicPlan
      ? buildSauceAutoTopicPlan(sauceSoisItems, input.numberOfPosts)
      : { planLines: [] as string[], assignedSectionKeys: new Set<string>() };
    const sauceTopicPlanLines = sauceTopicPlanResult.planLines;
    const sauceTopicPlanSummary = sauceTopicPlanLines.length ? sauceTopicPlanLines.join("\n\n") : "(none)";
    const sauceTopicExecutionDirective = shouldUseSauceAutoTopicPlan
      ? sauceTopicPlanLines.length
        ? "Sauce auto-topic planner is active because Details is empty. Follow the per-post Sauce topic plan strictly: each post must center on its assigned pillar and anchor."
        : "Sauce auto-topic planner is active because Details is empty, but no SOIS evidence was retrieved. Follow assigned pillars and keep claims qualitative."
      : "No Sauce auto-topic plan required.";
    const webEvidenceLines = webFactCheck.evidenceLines
      .slice(0, FACT_CHECK_EVIDENCE_PROMPT_LIMIT)
      .map((line) => normalizeNoEmDash(line));
    const soisEvidencePromptLimit = hasSpecificSoisPromptDetails
      ? DEFAULT_SOIS_EVIDENCE_PROMPT_LIMIT
      : effectiveSoisBroadEvidencePromptLimit;
    const soisItemsForEvidence =
      shouldUseSauceAutoTopicPlan && sauceTopicPlanResult.assignedSectionKeys.size > 0
        ? sauceSoisItems.filter((item) =>
            sauceTopicPlanResult.assignedSectionKeys.has(sectionKeyFromItemId(item.id)),
          )
        : sauceSoisItems;
    const soisEvidenceLines = soisItemsForEvidence.slice(0, soisEvidencePromptLimit).map((item, index) => {
      const compactText = normalizeNoEmDash(item.text.replace(/\s*\n+\s*/g, " | "));
      return `${index + 1}. [${item.categoryLabel} ${item.subcategory}] ${item.subcategoryLabel}
- Source: ${item.sourceUrl}
- Evidence: ${compactText}`;
    });
    const factCheckDirective = !shouldRunWebFactCheck
      ? `${webFactCheckSkipReason} Use only internal context and provided evidence.`
      : webEvidenceLines.length
        ? "Web evidence is available. Ground factual claims in this evidence. Use real numbers only when they appear in the evidence or provided context."
        : "Web evidence is unavailable or empty. Phrase uncertain factual claims as opinion, observation, or hypothesis.";
    const soisDirective = !shouldRunSoisContext
      ? `${soisContextSkipReason} Use only non-SOIS evidence and provided event/request details.`
      : soisContext.enabled
        ? "State of In-App Subscriptions (SOIS) benchmark evidence is available. Use it as a first-class factual source for hooks, mechanisms, caveats, and numeric anchors."
        : "State of In-App Subscriptions (SOIS) benchmark evidence is unavailable for this run. Use only numbers and claims from other provided evidence.";
    const eventWebEnrichmentDirective =
      isEventOrWebinarPostType && shouldRunWebFactCheck
        ? "For event/webinar posts, use web evidence to recover missing logistics (date, time, place, registration URL) only when explicitly supported by evidence. If time or place is still missing, assume there is no time or place and do not invent one."
        : "";
    const factCheckEvidenceForPrompt = !shouldRunWebFactCheck
      ? webFactCheckSkipReason
      : webEvidenceLines.length
        ? webEvidenceLines.join("\n")
        : "No live web evidence available for this request.";
    const soisEvidenceForPrompt = !shouldRunSoisContext
      ? soisContextSkipReason
      : soisEvidenceLines.length
        ? soisEvidenceLines.join("\n")
        : "No SOIS benchmark evidence available for this request.";
    const evidencePriorityOrder = shouldRunSoisContext
      ? shouldRunWebFactCheck
        ? "SOIS > web"
        : "SOIS > internal context"
      : shouldRunWebFactCheck
        ? "web > internal context"
        : "internal context";
    const evidenceContextGuidance = shouldRunSoisContext
      ? looksLikeSaucePostType(input.inputType)
        ? `Evidence context: Sauce dataset (TOP 35 INSIGHTS) below. MANDATORY: Every Sauce post body MUST include at least 1 concrete number from the Sauce dataset (e.g. 1.7x, 55.5%, $54.17, 46.2%). Copy numbers verbatim. Zero numbers in a Sauce post = invalid output. Do not use numbers from web fact-check or user input.`
        : `Evidence context (priority order: ${evidencePriorityOrder}). Numbers from SOIS are real benchmarks - use them, they make posts more compelling. Copy numbers verbatim from the evidence below. Use each number for its labeled metric only: install_to_paid_rate as %, avg_ltv as $, price_usd as $. When a number is not in the evidence, write the sentence without it. For Sauce posts: only use numbers from the SOIS evidence or Sauce dataset below (not from web fact-check or user input). REQUIRED: Each Sauce post body must include at least 1 concrete number from the evidence (e.g. X%, $Y, Z rate). Never output a Sauce post with zero numbers.`
      : shouldRunWebFactCheck
        ? `Evidence context (priority order: ${evidencePriorityOrder}). Use web evidence to fill factual gaps when available (especially for event logistics). If a detail is not supported by evidence, keep phrasing qualitative and avoid invented specifics. Do not introduce SOIS benchmark claims.`
        : `Evidence context (priority order: ${evidencePriorityOrder}). Use internal request context only (details, event data, date/time/place${
            shouldIncludeCta ? ", and CTA link" : ""
          }). Do not introduce SOIS benchmark claims.`;
    const soisSectionTitle = shouldRunSoisContext
      ? looksLikeSaucePostType(input.inputType)
        ? "1. Sauce dataset (TOP 35 INSIGHTS - use at least 1 number from here in every post):"
        : "1. SOIS (Adapty State of In-App Subscriptions) - fetched from dags.adpinfra.dev:"
      : `1. SOIS benchmark context: ${soisContextSkipReason}`;
    const webFactCheckSectionTitle = shouldRunWebFactCheck
      ? shouldRunSoisContext
        ? "2. Web fact-check (use when SOIS lacks the claim):"
        : "2. Web fact-check (primary external evidence source):"
      : `2. Web fact-check: ${webFactCheckSkipReason}`;
    if (shouldRunSoisContext) {
      console.log("[Evidence] SOIS lines:", soisEvidenceLines.length, "\n", soisEvidenceForPrompt.slice(0, 1500));
    } else {
      console.log("[Evidence]", soisContextSkipReason);
    }
    const allowedNumericClaims = buildAllowedNumericClaimSet(
      [
        factCheckEvidenceForPrompt,
        soisEvidenceForPrompt,
        input.details,
        input.time,
        input.place,
        ...effectiveCtaLinksByPost,
        effectiveCtaLink,
        chartPromptSummary,
        industryNewsContextSummary,
        industryNewsTopicPlanSummary,
        sauceTopicPlanSummary,
      ].filter(Boolean),
    );
    const sauceItemTexts = soisItemsForEvidence.map((item) => item.text);
    let sauceBenchmarkSnippets = collectBenchmarkEvidenceSnippets(sauceItemTexts);
    if (looksLikeSaucePostType(input.inputType) && sauceBenchmarkSnippets.length === 0 && sauceItemTexts.length > 0) {
      const fallbackSnippets: string[] = [];
      for (const text of sauceItemTexts) {
        for (const line of text.split(/\n/)) {
          const trimmed = line.replace(/\s+/g, " ").trim();
          if (/\d/.test(trimmed) && /[$%]|\d+(?:\.\d+)?x/.test(trimmed) && trimmed.length < 400) {
            fallbackSnippets.push(trimmed);
          }
        }
      }
      sauceBenchmarkSnippets = [...new Set(fallbackSnippets)].slice(0, 60);
    }
    const sauceBenchmarkNumericClaims = buildSauceAllowedNumericClaimSet(
      looksLikeSaucePostType(input.inputType) && sauceItemTexts.length > 0
        ? [...sauceBenchmarkSnippets, ...sauceItemTexts, ...effectiveCtaLinksByPost, effectiveCtaLink].filter(Boolean)
        : [...sauceBenchmarkSnippets, ...effectiveCtaLinksByPost, effectiveCtaLink].filter(Boolean),
    );

    const responseSchema = makeGeneratePostsResponseSchema(input.numberOfPosts, {
      requireCta: shouldIncludeCta,
    });
    const promptGuides = await getPromptGuides();
    const sauceDomainGuideSection = looksLikeSaucePostType(input.inputType)
      ? `
Sauce guide from repository prompt file:
${promptGuides.sauce}

SOIS website context guide from repository prompt file:
${promptGuides.sois}

ASO guide from repository prompt file:
${promptGuides.aso}

Paywall guide from repository prompt file:
${promptGuides.paywall}
Sauce number rule (MANDATORY - non-negotiable):
- Every Sauce post body MUST include at least 1 concrete number from the Sauce dataset below (e.g. 1.7x, 7.4x, 55.5%, $54.17, 46.2%, 58.1%). A Sauce post with zero numbers is invalid.
- Target 1-2 benchmark numbers per post. Copy numbers verbatim from the Sauce dataset evidence.
- Every number must come from the Sauce dataset below. Do not use numbers from web fact-check or user input.
- Do not repeat the same benchmark number multiple times in the same post or across most hook suggestions.
`
      : "";

    const productUpdateToneContext = looksLikeProductUpdatePostType(input.inputType)
      ? await getProductUpdateToneContext()
      : "";
    const productUpdateToneSection = productUpdateToneContext
      ? `

Product update tone reference (Adapty changelog style — use as inspiration for rhythm, structure, and voice):
${productUpdateToneContext}
`
      : "";
    const ctaOutputDirective = shouldIncludeCta
      ? "- For each post return: hook (first line), body (full post excluding CTA), cta (final action line)."
      : "- For each post return: hook (first line), body (full post), cta (empty string).";
    const ctaGuidanceDirective = shouldIncludeCta
      ? "- If CTA link is provided, weave it naturally into the CTA line."
      : "- CTA is disabled for this run. Keep cta empty and avoid action lines asking readers to click, register, or book a demo.";

    const systemPrompt = `
You write LinkedIn posts for Adapty, the tool app teams use to grow subscription revenue through paywalls, experiments, and analytics.

Voice: write like a sharp friend who works in mobile apps talking to another operator over coffee. A real person who's been in the trenches and talks like it.

Rewrite any sentence to sound the way you'd say it to a colleague. Each sentence adds something new.

Hooks start from a specific observation: a number, a name, a thing that happened. Anchor in something concrete.

Writing guide:
${promptGuides.writing}
${sauceDomainGuideSection}${productUpdateToneSection}
Fact-check guide:
${promptGuides.factCheck}

Output format:
${ctaOutputDirective}
- Use paragraphs of 2-4 sentences. Add blank lines only between paragraphs, not between sentences. Do not put each sentence on its own line.
${ctaGuidanceDirective}
- For multi-post industry news batches, anchor each post to a different news item.
- When source metadata says "others", use for structural inspiration, not voice imitation.
- Back any Adapty positioning with proof or mechanism, not empty superlatives.
- Voice perspective: speak as Adapty company voice. Use "we", "our", and "us". Never use first-person singular pronouns ("I", "me", "my").

Numbers: copy every number verbatim from the evidence sections in the user prompt. When a number exists in the evidence, use it. When it does not, rewrite naturally with qualitative language ("higher than peers", "lower than baseline", "most apps"). Omit sample sizes when the evidence does not state them.
Do not use vague filler fragments like "significantly", "meaningful", or "premium" without a concrete noun.

Before returning, read each post out loud in your head. Rewrite any sentence that sounds unnatural spoken.
${toBulletedSection(QUALITY_GATE_PROMPT_LINES)}
`;

    const factsPolicy = [factCheckDirective, soisDirective, eventWebEnrichmentDirective].filter(Boolean).join(" ");

    const memeSection = includeMemeCompanion
      ? `\nMeme config: ${memeExecutionDirective}
- Tone: ${memeToneProfile}
- Brief: ${memeBriefPreference || "(auto)"}
- Templates: ${memeTemplatePreferences.length ? memeTemplatePreferences.join(", ") : "auto"}
- Variants per post: ${memeVariantTarget}
- GIPHY companions: ${input.giphyEnabled ? "enabled" : "disabled"}
- GIPHY query hint: ${giphyQueryPreference || "(auto from each post content)"}`
      : "";
    const sauceAutoTopicPlanSection = shouldUseSauceAutoTopicPlan
      ? `
Sauce topic context:
${sauceTopicExecutionDirective}

Per-post Sauce topic plan:
${sauceTopicPlanSummary}`
      : "";
    const perPostCtaPlanSection = hasPerPostCtaPlan
      ? `
- Per-post CTA links (post order):
${effectiveCtaLinksByPost.map((link, index) => `  ${index + 1}. ${link || "(none)"}`).join("\n")}`
      : "";
    const ctaRequestSection = shouldIncludeCta
      ? `- CTA link: ${effectiveCtaLink || "(not provided)"}${perPostCtaPlanSection}`
      : "- CTA: disabled for this run. Return cta as an empty string for every post.";

    const userPrompt = `
Voice anchor - match the tone, rhythm, and phrasing of these posts:
${examplesForPrompt || "No library examples available."}

Performance patterns from past posts:
${performanceInsightsForPrompt}

Generation request:
- Brand voice: ${input.style} — ${brandVoiceDirective} ${autoHookDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]}) — ${goalExecutionDirective}
- Post type: ${input.inputType} - ${postTypeDirective}
- Facts policy: ${factsPolicy} Copy numbers verbatim from the evidence sections below. When no number exists for a claim, use qualitative language.
- Details: ${input.details || "(none)"}
${ctaRequestSection}
- Event time: ${input.time || "(not provided)"}
- Event place: ${input.place || "(not provided)"}
- Event logistics rule: if time or place is not provided in request/evidence, assume there is no time or place.
- Number of posts: ${input.numberOfPosts}
- Chart: ${chartExecutionDirective} ${chartPromptSummary !== "(not provided)" ? `Summary: ${chartPromptSummary}` : ""}
- Image context: ${
      inputImageDataUrls.length
        ? `provided (${inputImageDataUrls.length} image${inputImageDataUrls.length === 1 ? "" : "s"})`
        : "(none)"
    }${memeSection}

Required length per post:
${lengthPlan.map((length, index) => `${index + 1}. ${length} -> ${lengthGuide(length)}`).join("\n")}

${evidenceContextGuidance}

${soisSectionTitle}
${soisEvidenceForPrompt}

${webFactCheckSectionTitle}
${factCheckEvidenceForPrompt}

Industry news context:
${industryNewsContextSummary}
${industryNewsExecutionDirective}

Per-post industry topic plan:
${industryNewsTopicPlanSummary}
${sauceAutoTopicPlanSection}

Also generate a list of hook suggestions inspired by this style and request.
`;

    type GeneratedPost = {
      length: "short" | "medium" | "long" | "very long" | "standard";
      hook: string;
      body: string;
      cta: string;
    };

    type GeneratedBatch = {
      hooks: string[];
      posts: GeneratedPost[];
    };

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const preferClaudeWriter = parseBooleanEnv(process.env.USE_CLAUDE_WRITER, true);
    const preferCodexReviewer = parseBooleanEnv(process.env.USE_CODEX_REVIEWER, true);
    const forceCodexReviewerPass = parseBooleanEnv(
      process.env.FORCE_CODEX_REVIEWER,
      parseBooleanEnv(process.env.FORCE_CODEX_REVIEWER_FOR_SAUCE, true),
    );
    const useClaudeWriter = Boolean(anthropicApiKey && preferClaudeWriter);
    const useCodexReviewer = Boolean(oauthCredentials && preferCodexReviewer);
    const hasCodexReviewerPath = Boolean((useCodexReviewer || openAiApiToken) && preferCodexReviewer);
    const enableNumericSanitizerRewrite = parseBooleanEnv(
      process.env.ENABLE_NUMERIC_SANITIZER_REWRITE,
      false,
    );

    const runGeneration = (params: {
      model: string;
      userPrompt: string;
      responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
      postCount: number;
    }): Promise<GeneratedBatch> => {
      if (useClaudeWriter) {
        return runClaudeWriterGeneration({
          systemPrompt,
          userPrompt: params.userPrompt,
          imageDataUrls: inputImageDataUrls.length ? inputImageDataUrls : undefined,
          responseSchema: params.responseSchema,
          postCount: params.postCount,
        });
      }

      if (oauthCredentials) {
        return runCodexOauthGeneration({
          oauth: oauthCredentials,
          model: params.model,
          systemPrompt,
          userPrompt: params.userPrompt,
          imageDataUrls: inputImageDataUrls.length ? inputImageDataUrls : undefined,
          responseSchema: params.responseSchema,
          postCount: params.postCount,
        });
      }

      if (!openAiApiToken) {
        throw new Error("OpenAI API token is missing");
      }

      return runOpenAiChatGeneration({
        token: openAiApiToken,
        model: params.model,
        systemPrompt,
        userPrompt: params.userPrompt,
        imageDataUrls: inputImageDataUrls.length ? inputImageDataUrls : undefined,
        responseSchema: params.responseSchema,
        postCount: params.postCount,
      });
    };

    const runGenerationWithFallback = async (params: {
      userPrompt: string;
      responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
      postCount: number;
    }) => {
      try {
        const parsed = await runGeneration({
          model: requestedModel,
          userPrompt: params.userPrompt,
          responseSchema: params.responseSchema,
          postCount: params.postCount,
        });
        return {
          parsed,
          modelUsed: requestedModel,
          fallbackUsed: false,
        };
      } catch (primaryError) {
        const canFallback =
          fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError);

        if (!canFallback) {
          throw primaryError;
        }

        const parsed = await runGeneration({
          model: fallbackModel,
          userPrompt: params.userPrompt,
          responseSchema: params.responseSchema,
          postCount: params.postCount,
        });
        return {
          parsed,
          modelUsed: fallbackModel,
          fallbackUsed: true,
        };
      }
    };

    let modelUsed = useClaudeWriter ? (process.env.CLAUDE_WRITER_MODEL ?? CLAUDE_WRITER_MODEL) : requestedModel;
    let fallbackUsed = false;

    let parsed: GeneratedBatch;
    const enableIndustryNewsSplit = parseBooleanEnv(process.env.ENABLE_INDUSTRY_NEWS_SPLIT, false);
    const shouldSplitIndustryNewsBatch =
      enableIndustryNewsSplit &&
      looksLikeIndustryNewsReactionPostType(input.inputType) &&
      input.numberOfPosts > 1 &&
      industryNewsContext.items.length > 1;

    if (shouldSplitIndustryNewsBatch) {
      const batchHooks: string[] = [];
      const batchPosts: GeneratedPost[] = [];
      const requiredHookCount = Math.max(5, input.numberOfPosts);
      const rankedContextLines = industryNewsContext.items
        .map((item, index) => `${index + 1}. ${normalizeNoEmDash(item.title)} (${item.sourceName})`)
        .join("\n");

      for (let index = 0; index < input.numberOfPosts; index += 1) {
        const assignedItem = industryNewsContext.items[index % industryNewsContext.items.length];
        const postLength = lengthPlan[index] ?? "medium";
        const singlePostSchema = makeGeneratePostsResponseSchema(1, {
          requireCta: shouldIncludeCta,
        });
        const singlePostPrompt = `${userPrompt}

Hard per-post assignment for this call:
- Generate exactly 1 post in posts array.
- This is post ${index + 1} of ${input.numberOfPosts} in the full batch.
- Required length: ${postLength} -> ${lengthGuide(postLength)}
- Mandatory primary topic:
  - Source: ${assignedItem.sourceName}
  - Title: ${normalizeNoEmDash(assignedItem.title)}
  - URL: ${assignedItem.url}
  - Published: ${assignedItem.publishedAtIso}
  - Summary: ${normalizeNoEmDash(assignedItem.summary)}
- Use this assigned topic as the main story driver. Do not anchor this post to another ranked item as primary.
- Keep implication${shouldIncludeCta ? " and CTA" : ""} aligned to this assigned topic.

Ranked item index for this post: ${(index % industryNewsContext.items.length) + 1}
All ranked item titles for reference:
${rankedContextLines}`;

        const singleRun = await runGenerationWithFallback({
          userPrompt: singlePostPrompt,
          responseSchema: singlePostSchema,
          postCount: 1,
        });

        if (singleRun.fallbackUsed) {
          fallbackUsed = true;
          modelUsed = singleRun.modelUsed;
        }

        batchHooks.push(...singleRun.parsed.hooks.map((hook) => normalizeNoEmDash(hook)));
        if (singleRun.parsed.posts[0]) {
          batchPosts.push(singleRun.parsed.posts[0]);
        }
      }

      const dedupedHooks: string[] = [];
      for (const hook of batchHooks) {
        if (!dedupedHooks.includes(hook)) {
          dedupedHooks.push(hook);
        }
        if (dedupedHooks.length >= 20) {
          break;
        }
      }

      if (dedupedHooks.length < requiredHookCount) {
        for (const post of batchPosts) {
          const hook = normalizeNoEmDash(post.hook);
          if (!dedupedHooks.includes(hook)) {
            dedupedHooks.push(hook);
          }
          if (dedupedHooks.length >= requiredHookCount) {
            break;
          }
        }
      }

      if (batchPosts.length !== input.numberOfPosts) {
        throw new Error("Failed to generate full industry news batch with assigned topics.");
      }

      parsed = {
        hooks: dedupedHooks.slice(0, 20),
        posts: batchPosts.slice(0, input.numberOfPosts),
      };
    } else {
      const batchRun = await runGenerationWithFallback({
        userPrompt,
        responseSchema,
        postCount: input.numberOfPosts,
      });
      parsed = batchRun.parsed;
      if (!useClaudeWriter) {
        modelUsed = batchRun.modelUsed;
        fallbackUsed = batchRun.fallbackUsed;
      }
    }

    const shouldEnforceParagraphNormalization = true;
    const hasNumericInputsAvailable =
      webEvidenceLines.length > 0 ||
      soisEvidenceLines.length > 0 ||
      preparedChartInput !== null ||
      /\d/.test(input.time) ||
      /\d/.test(input.details) ||
      (retrieval.performanceInsights?.summaryLines?.some((line) => /\d/.test(line)) ?? false);
    const normalizeGeneratedPosts = (posts: GeneratedPost[]) =>
      posts.map((post, index) => {
        const normalizedHook = stripAiScaffoldOpeners(normalizeNoEmDash(post.hook));
        const normalizedBody = normalizeNoEmDash(post.body);
        const ctaLinkForPost = effectiveCtaLinksByPost[index] ?? effectiveCtaLink;
        const normalizedCta = shouldIncludeCta
          ? stripAiScaffoldOpeners(normalizeNoEmDash(ensureFinalCta(post.cta, ctaLinkForPost)))
          : "";

        return {
          length: lengthPlan[index] ?? post.length,
          hook: normalizedHook,
          body: shouldEnforceParagraphNormalization ? normalizeBodyRhythm(normalizedBody) : normalizedBody,
          cta: normalizedCta,
        };
      });

    const collectQualityIssues = (posts: ReturnType<typeof normalizeGeneratedPosts>) =>
      posts
        .map((post, index) => ({
          postIndex: index,
          issues: evaluatePostQuality({
            post,
            style: input.style,
            goal: input.goal,
            inputType: input.inputType,
            time: input.time,
            place: input.place,
            requireNumericAnchor: hasNumericInputsAvailable,
          }),
        }))
        .filter((item) => item.issues.length > 0);

    let normalizedPosts = normalizeGeneratedPosts(parsed.posts);
    let qualityIssuesByPost = collectQualityIssues(normalizedPosts);

    const enableQualityRepairPass = parseBooleanEnv(process.env.ENABLE_QUALITY_REPAIR_PASS, false);
    const shouldRunQualityRepairPass = enableQualityRepairPass && qualityIssuesByPost.length > 0;

    if (shouldRunQualityRepairPass) {
      const qualityIssueSummary = qualityIssuesByPost
        .map(
          (item) =>
            `Post ${item.postIndex + 1}:\n${item.issues.map((issue) => `- ${issue}`).join("\n")}`,
        )
        .join("\n\n");
      const draftSummary = normalizedPosts
        .map(
          (post, index) => `Post ${index + 1}
Hook: ${post.hook}
Body:
${post.body}
CTA: ${post.cta}`,
        )
        .join("\n\n");
      const qualityRepairPrompt = `${userPrompt}

Quality repair pass required.
The first draft did not satisfy anti-slop and formatting gates.
Fix the failing posts while preserving the core message.

Failing checks:
${qualityIssueSummary}

Draft to repair:
${draftSummary}

Repair requirements:
${toBulletedSection(QUALITY_REPAIR_REQUIREMENT_LINES)}
`;

      const repairedBatchRun = await runGenerationWithFallback({
        userPrompt: qualityRepairPrompt,
        responseSchema,
        postCount: input.numberOfPosts,
      });

      if (repairedBatchRun.fallbackUsed) {
        fallbackUsed = true;
        modelUsed = repairedBatchRun.modelUsed;
      }

      parsed = repairedBatchRun.parsed;
      normalizedPosts = normalizeGeneratedPosts(parsed.posts);
      qualityIssuesByPost = collectQualityIssues(normalizedPosts);
    } else if (qualityIssuesByPost.length > 0 && !enableQualityRepairPass) {
      console.info(
        `Quality repair pass disabled (ENABLE_QUALITY_REPAIR_PASS=false): proceeding to editor review with ${qualityIssuesByPost.length} post(s) flagged after first draft.`,
      );
    }

    const skipEditorForTest = process.env.SKIP_CODEX_EDITOR === "1";
    const shouldForceCodexReviewerPass = forceCodexReviewerPass && hasCodexReviewerPath;
    const shouldRunEditorPass = !skipEditorForTest && (qualityIssuesByPost.length > 0 || shouldForceCodexReviewerPass);

    if (shouldRunEditorPass) {
      const editorPassGoals = [
        "Fix the remaining quality-gate issues without changing the core argument.",
        "Eliminate staccato formatting. Merge isolated one-sentence lines into fuller paragraphs while preserving flow and readability.",
        "Ensure body text uses paragraph breaks (blank line between paragraphs). Never leave a wall of text without paragraph breaks.",
        looksLikeSaucePostType(input.inputType)
          ? "For Sauce posts: verify every number or percentage appears verbatim in the Sauce dataset evidence. Rewrite unsupported numbers qualitatively. Every Sauce post must include at least 1 number from the Sauce dataset."
          : "",
      ]
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      const editorEvidenceBlock = looksLikeSaucePostType(input.inputType)
        ? `Evidence context for factual QA - Sauce dataset (use numbers from here):
Sauce dataset:
${soisEvidenceForPrompt.slice(0, 2400)}

If a Sauce post has ZERO numbers, you MUST add at least 1 number from the Sauce dataset above (e.g. 1.7x, 55.5%, $54.17, 46.2%). Do not output a Sauce post without a number.

Web evidence (secondary):
${factCheckEvidenceForPrompt.slice(0, 1400)}`
        : `Evidence context for factual QA (SOIS > web):
SOIS evidence:
${soisEvidenceForPrompt.slice(0, 2400)}

Web evidence:
${factCheckEvidenceForPrompt.slice(0, 1400)}`;
      const editorSystemPrompt = `You edit LinkedIn posts to sound like a real human wrote them.

Read the draft. For each sentence ask: would someone actually say this to a friend? If not, rewrite it simpler.

Hooks need soul. Soulful hooks start from a specific observation: a number, a name, a thing that happened. Soulless hooks use the "X is not Y, it's Z" template — they sound like consultant deck headlines. Rewrite soulless hooks to anchor in something concrete.

Do this:
- Start with the point. Remove sentences that only frame the next one.
- Rewrite sentences that restate themselves in two halves separated by a comma or period.
- Replace stiff phrasing with how someone would actually say it.
- Replace vague filler wording ("significantly", "meaningful", "premium") with concrete language or remove it.
- Format body with clear paragraphs: 2-4 sentences per paragraph, blank line (double newline) between paragraphs. Never return a wall of text without paragraph breaks.
- Keep paragraphs of 2-4 sentences. Add blank lines only between paragraphs, not between sentences. Do not put each sentence on its own line.
- Never return consecutive one-sentence paragraphs. At most one one-sentence paragraph in the whole body, and only if it is a deliberate punch line.
- Say "app makers" or "app founders" instead of "teams" or "operators."
- Use digits for numbers ("3 things" not "three things").
- Use hyphens, commas, and periods.
- Use Adapty company voice: "we", "our", and "us". Never use first-person singular pronouns ("I", "me", "my").

Fact and benchmark rules:
- Keep all facts, arguments, and structure intact.
- Keep a number only if it appears verbatim in the provided evidence context.
- When a numeric claim is unsupported, rewrite it qualitatively.
- Use each metric in its correct unit: conversion as %, LTV as currency, price as currency.
- For Sauce posts: only keep numbers that appear verbatim in the Sauce dataset evidence above (not web evidence). Replace any other number with qualitative phrasing.
- For Sauce posts: each post body MUST include at least 1 concrete number from the Sauce dataset. Never output a Sauce post with zero numbers.
- Vary benchmark numbers across posts and hook suggestions.

Rewrite to concrete anchors:
Before: "Your traffic is not the main paywall problem, your sequence is."
After: "We ran 12 paywall tests last quarter. The one that moved LTV had nothing to do with copy."

Before: "Your app is probably not under-monetized, it is under-tested."
After: "Most apps we audit have 3 paywall variants and 0 placement tests."

Before: "We keep seeing the same pattern: app makers drive installs, start trials, then watch 40% disappear by day 3."
After: "App makers drive installs, start trials, then watch 40% disappear by day 3."

Before: "This is the part most teams feel but do not say out loud. Traffic volume does not fix a weak paywall sequence."
After: "Traffic volume does not fix a weak paywall sequence."

Before: "That gap is where revenue leaks. And most of the time, the leak is not visual polish."
After: "Most of the time, it is not visual polish. It is flow design."

Before: "the hidden leak is often acquisition quality, not billing mechanics."
After: "Acquisition quality matters more than billing mechanics for most apps."

Before: "If you want a simple plan this week, do three things."
After: "If you want a simple plan this week, do these 3 things."`;

      const editorDraftPrompt = normalizedPosts
        .map(
          (post, index) => `Post ${index + 1}:
Hook: ${post.hook}
Body:
${post.body}
CTA: ${post.cta}`,
        )
        .join("\n\n");

      const editorUserPrompt = `Edit these ${normalizedPosts.length} post(s). Return the same number of posts with the same hooks array.

Pass goals:
${editorPassGoals}

${editorEvidenceBlock}

Draft:
${editorDraftPrompt}

Return ${parsed.hooks.length} hook suggestions as well (keep good ones, tighten sloppy ones).`;

      const runEditorGeneration = (params: {
        model: string;
        userPrompt: string;
        responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
        postCount: number;
      }): Promise<GeneratedBatch> => {
        if (useCodexReviewer && oauthCredentials) {
          return runCodexOauthGeneration({
            oauth: oauthCredentials,
            model: params.model,
            systemPrompt: editorSystemPrompt,
            userPrompt: params.userPrompt,
            responseSchema: params.responseSchema,
            postCount: params.postCount,
          });
        }

        if (openAiApiToken && preferCodexReviewer) {
          return runOpenAiChatGeneration({
            token: openAiApiToken,
            model: params.model,
            systemPrompt: editorSystemPrompt,
            userPrompt: params.userPrompt,
            responseSchema: params.responseSchema,
            postCount: params.postCount,
            temperature: 0.4,
          });
        }

        if (useClaudeWriter && anthropicApiKey) {
          return runClaudeWriterGeneration({
            systemPrompt: editorSystemPrompt,
            userPrompt: params.userPrompt,
            responseSchema: params.responseSchema,
            postCount: params.postCount,
          });
        }

        if (openAiApiToken) {
          return runOpenAiChatGeneration({
            token: openAiApiToken,
            model: params.model,
            systemPrompt: editorSystemPrompt,
            userPrompt: params.userPrompt,
            responseSchema: params.responseSchema,
            postCount: params.postCount,
            temperature: 0.4,
          });
        }

        throw new Error("No reviewer model credentials available (Codex/OpenAI/Claude).");
      };

      try {
        const editorRun = await (async () => {
          try {
            return await runEditorGeneration({
              model: requestedModel,
              userPrompt: editorUserPrompt,
              responseSchema,
              postCount: input.numberOfPosts,
            });
          } catch (primaryError) {
            if (fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError)) {
              return runEditorGeneration({
                model: fallbackModel,
                userPrompt: editorUserPrompt,
                responseSchema,
                postCount: input.numberOfPosts,
              });
            }
            throw primaryError;
          }
        })();

        parsed = editorRun;
        normalizedPosts = normalizeGeneratedPosts(editorRun.posts);
      } catch (editorError) {
        // Editor pass is best-effort; if it fails, keep the original posts
        console.warn("Editor review pass failed; keeping current draft.", editorError);
      }
    }

    let normalizedHooks = parsed.hooks.map((hook) => normalizeNoEmDash(hook));
    const sauceUsesSoisOnly =
      looksLikeSaucePostType(input.inputType) && sauceBenchmarkNumericClaims.size > 0;
    const hooksAllowedClaims = sauceUsesSoisOnly ? sauceBenchmarkNumericClaims : allowedNumericClaims;
    const postsAllowedClaims = sauceUsesSoisOnly ? sauceBenchmarkNumericClaims : allowedNumericClaims;

    if (enableNumericSanitizerRewrite) {
      const sanitizedHooksResult = sanitizeHookSuggestionsNumericClaims(
        normalizedHooks,
        hooksAllowedClaims,
        sauceUsesSoisOnly,
      );
      normalizedHooks = sanitizedHooksResult.hooks.map((hook) => normalizeNoEmDash(hook));

      const sanitizedPostsResult = sanitizeGeneratedPostsNumericClaims(
        normalizedPosts,
        postsAllowedClaims,
        sauceUsesSoisOnly,
      );
      normalizedPosts = sanitizedPostsResult.posts;

      const numericClaimsSanitizedCount =
        sanitizedHooksResult.unsupportedClaims.length + sanitizedPostsResult.unsupportedClaims.length;
      if (numericClaimsSanitizedCount > 0) {
        console.warn(
          `Numeric safety pass rewrote ${numericClaimsSanitizedCount} unsupported number claim(s) to qualitative phrasing.`,
        );
      }
    } else {
      console.info(
        "Numeric sanitizer rewrite pass disabled (ENABLE_NUMERIC_SANITIZER_REWRITE=false): relying on prompt+reviewer quality passes.",
      );
    }

    if (sauceUsesSoisOnly && enableNumericSanitizerRewrite) {
      const sauceHookSanitization = sanitizeHookSuggestionsNumericClaims(
        normalizedHooks,
        sauceBenchmarkNumericClaims,
        true,
      );
      normalizedHooks = sauceHookSanitization.hooks.map((hook) => normalizeNoEmDash(hook));
      const sauceHookRepetitionSanitization = sanitizeHookNumericClaimRepetition(
        normalizedHooks,
        sauceBenchmarkNumericClaims,
        2,
      );
      normalizedHooks = sauceHookRepetitionSanitization.hooks.map((hook) => normalizeNoEmDash(hook));

      const saucePostSanitization = sanitizeGeneratedPostsNumericClaims(
        normalizedPosts,
        sauceBenchmarkNumericClaims,
        true,
      );
      normalizedPosts = saucePostSanitization.posts;

      const sauceStrictSanitizedCount =
        sauceHookSanitization.unsupportedClaims.length + saucePostSanitization.unsupportedClaims.length;
      if (sauceStrictSanitizedCount > 0) {
        console.warn(
          `Sauce benchmark safety pass rewrote ${sauceStrictSanitizedCount} non-benchmark number claim(s).`,
        );
      }
      if (sauceHookRepetitionSanitization.rewrittenClaims.length > 0) {
        console.warn(
          `Sauce hook diversity pass rewrote ${sauceHookRepetitionSanitization.rewrittenClaims.length} repeated benchmark number claim(s).`,
        );
      }
    }

    const sauceSnippetsForInjection =
      sauceBenchmarkSnippets.length > 0
        ? sauceBenchmarkSnippets
        : looksLikeSaucePostType(input.inputType)
          ? sauceItemTexts.flatMap((t) =>
              t.split(/\n/).filter((line) => /\d/.test(line) && /[$%]|\d+(?:\.\d+)?x/.test(line)),
            )
          : [];
    const shouldEnforceSauceBenchmarkAnchor =
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0 &&
      sauceSnippetsForInjection.length > 0;

    if (shouldEnforceSauceBenchmarkAnchor) {
      let injectedBenchmarkAnchors = 0;
      normalizedPosts = normalizedPosts.map((post, index) => {
        const combinedText = `${post.hook}\n${post.body}\n${post.cta}`;
        if (countAllowedNumericClaims(combinedText, sauceBenchmarkNumericClaims) > 0) {
          return post;
        }

        const benchmarkSnippet = pickStrictSauceBenchmarkSnippet(
          sauceSnippetsForInjection,
          sauceBenchmarkNumericClaims,
          index,
        );
        if (!benchmarkSnippet) {
          return post;
        }
        const benchmarkSentence = buildStrictSauceBenchmarkSentence(benchmarkSnippet);

        injectedBenchmarkAnchors += 1;
        return {
          ...post,
          body: `${post.body.trim()}\n\n${benchmarkSentence}`,
        };
      });

      if (injectedBenchmarkAnchors > 0) {
        if (enableNumericSanitizerRewrite) {
          const reSanitizedClaims = sauceUsesSoisOnly ? sauceBenchmarkNumericClaims : allowedNumericClaims;
          const reSanitizedPostsResult = sanitizeGeneratedPostsNumericClaims(
            normalizedPosts,
            reSanitizedClaims,
            sauceUsesSoisOnly,
          );
          normalizedPosts = reSanitizedPostsResult.posts;
          if (reSanitizedPostsResult.unsupportedClaims.length > 0) {
            console.warn(
              `Numeric safety pass rewrote ${reSanitizedPostsResult.unsupportedClaims.length} unsupported number claim(s) after benchmark injection.`,
            );
          }
        }
        console.warn(
          `Sauce benchmark guard injected evidence-backed numeric anchors into ${injectedBenchmarkAnchors} post(s).`,
        );
      }
    }

    if (
      enableNumericSanitizerRewrite &&
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0
    ) {
      const sauceBenchmarkMaxUniqueNumbers = 2;
      let sauceBudgetRewriteCount = 0;

      normalizedPosts = normalizedPosts.map((post) => {
        const seenClaims = new Set<string>();
        const hookRewrite = rewriteNumericClaimsWithBudget(
          post.hook,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxUniqueNumbers,
          seenClaims,
        );
        const bodyRewrite = rewriteNumericClaimsWithBudget(
          post.body,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxUniqueNumbers,
          seenClaims,
        );

        sauceBudgetRewriteCount += hookRewrite.rewrittenClaims.length + bodyRewrite.rewrittenClaims.length;

        return {
          ...post,
          hook: hookRewrite.value,
          body: bodyRewrite.value,
        };
      });

      if (sauceBudgetRewriteCount > 0) {
        console.warn(
          `Sauce benchmark budget pass rewrote ${sauceBudgetRewriteCount} numeric claim(s) to keep each post at <=2 benchmark numbers.`,
        );
      }
    }

    if (
      enableNumericSanitizerRewrite &&
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0
    ) {
      const sauceBenchmarkMaxRepeatsPerPost = 1;
      let sauceRepeatRewriteCount = 0;

      normalizedPosts = normalizedPosts.map((post) => {
        const seenAllowedClaimCounts = new Map<string, number>();
        const hookRepeatRewrite = rewriteRepeatedAllowedNumericClaims(
          post.hook,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsPerPost,
          seenAllowedClaimCounts,
        );
        const bodyRepeatRewrite = rewriteRepeatedAllowedNumericClaims(
          post.body,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsPerPost,
          seenAllowedClaimCounts,
        );
        const ctaRepeatRewrite = rewriteRepeatedAllowedNumericClaims(
          post.cta,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsPerPost,
          seenAllowedClaimCounts,
        );

        sauceRepeatRewriteCount +=
          hookRepeatRewrite.rewrittenClaims.length +
          bodyRepeatRewrite.rewrittenClaims.length +
          ctaRepeatRewrite.rewrittenClaims.length;

        return {
          ...post,
          hook: hookRepeatRewrite.value,
          body: bodyRepeatRewrite.value,
          cta: ctaRepeatRewrite.value,
        };
      });

      if (sauceRepeatRewriteCount > 0) {
        console.warn(
          `Sauce repetition pass rewrote ${sauceRepeatRewriteCount} repeated benchmark number mention(s) within posts.`,
        );
      }
    }

    if (
      enableNumericSanitizerRewrite &&
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0 &&
      normalizedPosts.length > 1
    ) {
      const sauceBenchmarkMaxRepeatsAcrossPosts = Math.max(1, Math.ceil(normalizedPosts.length / 2));
      let sauceCrossPostRewriteCount = 0;
      const seenAllowedClaimCounts = new Map<string, number>();

      normalizedPosts = normalizedPosts.map((post) => {
        const hookRewrite = rewriteRepeatedAllowedNumericClaims(
          post.hook,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsAcrossPosts,
          seenAllowedClaimCounts,
        );
        const bodyRewrite = rewriteRepeatedAllowedNumericClaims(
          post.body,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsAcrossPosts,
          seenAllowedClaimCounts,
        );
        const ctaRewrite = rewriteRepeatedAllowedNumericClaims(
          post.cta,
          sauceBenchmarkNumericClaims,
          sauceBenchmarkMaxRepeatsAcrossPosts,
          seenAllowedClaimCounts,
        );

        sauceCrossPostRewriteCount +=
          hookRewrite.rewrittenClaims.length + bodyRewrite.rewrittenClaims.length + ctaRewrite.rewrittenClaims.length;

        return {
          ...post,
          hook: hookRewrite.value,
          body: bodyRewrite.value,
          cta: ctaRewrite.value,
        };
      });

      if (sauceCrossPostRewriteCount > 0) {
        console.warn(
          `Sauce cross-post diversity pass rewrote ${sauceCrossPostRewriteCount} repeated benchmark number mention(s) across posts.`,
        );
      }
    }

    const enforceStrictSauceEvidenceMode =
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0 &&
      parseBooleanEnv(process.env.ENABLE_SAUCE_STRICT_EVIDENCE_MODE, true);

    if (enforceStrictSauceEvidenceMode) {
      const allowAnecdotes = detailsAllowSauceAnecdotes(input.details);
      const strictFallbackCta = shouldIncludeCta
        ? clipTextStrictMax(
            effectiveCtaLink
              ? `See full SOIS benchmarks here: ${effectiveCtaLink}`
              : "See full SOIS benchmarks in State of In-App Subscriptions.",
            CLAUDE_POST_CTA_LIMITS.max,
          )
        : "";

      let strictPostRewrites = 0;
      normalizedPosts = normalizedPosts.map((post, index) => {
        const ctaLinkForPost = effectiveCtaLinksByPost[index] ?? effectiveCtaLink;
        const benchmarkSnippet = pickStrictSauceBenchmarkSnippet(
          sauceSnippetsForInjection,
          sauceBenchmarkNumericClaims,
          index,
        );
        const benchmarkSentence = benchmarkSnippet ? buildStrictSauceBenchmarkSentence(benchmarkSnippet) : "";

        const hookSanitized = sanitizeSauceTextStrict(post.hook, {
          allowedClaims: sauceBenchmarkNumericClaims,
          allowAnecdotes,
        });
        const bodySanitized = sanitizeSauceTextStrict(post.body, {
          allowedClaims: sauceBenchmarkNumericClaims,
          allowAnecdotes,
        });

        strictPostRewrites +=
          hookSanitized.removedUnsupportedNumericSentences +
          hookSanitized.removedFuzzyPlaceholderSentences +
          hookSanitized.removedAnecdoteSentences +
          bodySanitized.removedUnsupportedNumericSentences +
          bodySanitized.removedFuzzyPlaceholderSentences +
          bodySanitized.removedAnecdoteSentences;

        let hook = hookSanitized.value;
        let body = bodySanitized.value;
        let cta = shouldIncludeCta
          ? normalizeNoEmDash(ensureFinalCta(post.cta || strictFallbackCta, ctaLinkForPost))
              .replace(/\s+/g, " ")
              .trim()
          : "";

        hook = sanitizeSauceHookFallback(hook, benchmarkSnippet);
        if (!body) {
          body = benchmarkSentence || "SOIS evidence shows clear benchmark differences by segment and setup.";
        }
        if (!shouldIncludeCta) {
          cta = "";
        } else if (!cta) {
          cta = strictFallbackCta;
        }

        const combined = `${hook}\n${body}\n${cta}`;
        if (countAllowedNumericClaims(combined, sauceBenchmarkNumericClaims) === 0 && benchmarkSentence) {
          body = `${body}\n\n${benchmarkSentence}`;
        }

        body = normalizeBodyRhythm(body);

        return {
          ...post,
          hook: clipTextStrictMax(hook, CLAUDE_POST_HOOK_LIMITS.max),
          body: clipMultilineTextStrictMax(body, CLAUDE_POST_BODY_LIMITS.max),
          cta: shouldIncludeCta ? clipTextStrictMax(cta || strictFallbackCta, CLAUDE_POST_CTA_LIMITS.max) : "",
        };
      });

      let strictHookRewrites = 0;
      normalizedHooks = normalizedHooks.map((hook, index) => {
        const benchmarkSnippet = pickStrictSauceBenchmarkSnippet(sauceSnippetsForInjection, sauceBenchmarkNumericClaims, index);
        const sanitized = sanitizeSauceTextStrict(hook, {
          allowedClaims: sauceBenchmarkNumericClaims,
          allowAnecdotes,
        });
        strictHookRewrites +=
          sanitized.removedUnsupportedNumericSentences +
          sanitized.removedFuzzyPlaceholderSentences +
          sanitized.removedAnecdoteSentences;
        const fallbackHook = sanitizeSauceHookFallback(sanitized.value, benchmarkSnippet);
        return clipTextStrictMax(fallbackHook, CLAUDE_HOOK_LIMITS.max);
      });

      const strictValuesToCheck = [
        ...normalizedHooks,
        ...normalizedPosts.flatMap((post) => [post.hook, post.body, post.cta]),
      ];
      const strictViolations = countStrictSauceOutputViolations(strictValuesToCheck, {
        allowedClaims: sauceBenchmarkNumericClaims,
        allowAnecdotes,
      });

      if (strictPostRewrites > 0 || strictHookRewrites > 0) {
        console.warn(
          `Strict Sauce evidence pass rewrote ${strictPostRewrites} post sentence(s) and ${strictHookRewrites} hook sentence(s).`,
        );
      }

      if (
        strictViolations.unsupportedNumericClaims > 0 ||
        strictViolations.fuzzyPlaceholderSentences > 0 ||
        strictViolations.blockedAnecdoteSentences > 0
      ) {
        console.warn(
          `Strict Sauce evidence gate triggered cleanup: unsupported_numeric=${strictViolations.unsupportedNumericClaims}, fuzzy_placeholders=${strictViolations.fuzzyPlaceholderSentences}, blocked_anecdotes=${strictViolations.blockedAnecdoteSentences}.`,
        );

        if (enableNumericSanitizerRewrite) {
          normalizedHooks = normalizedHooks.map((hook, index) => {
            const benchmarkSnippet = pickStrictSauceBenchmarkSnippet(
              sauceSnippetsForInjection,
              sauceBenchmarkNumericClaims,
              index,
            );
            const rewrittenHook = rewriteUnsupportedNumericClaims(hook, sauceBenchmarkNumericClaims, false).value;
            return clipTextStrictMax(
              sanitizeSauceHookFallback(rewrittenHook, benchmarkSnippet),
              CLAUDE_HOOK_LIMITS.max,
            );
          });

          normalizedPosts = normalizedPosts.map((post, index) => {
            const benchmarkSnippet = pickStrictSauceBenchmarkSnippet(
              sauceBenchmarkSnippets,
              sauceBenchmarkNumericClaims,
              index,
            );
            const benchmarkSentence = benchmarkSnippet ? buildStrictSauceBenchmarkSentence(benchmarkSnippet) : "";
            const hookRewrite = rewriteUnsupportedNumericClaims(post.hook, sauceBenchmarkNumericClaims, false).value;
            const bodyRewrite = rewriteUnsupportedNumericClaims(post.body, sauceBenchmarkNumericClaims, false).value;
            const ctaRewrite = rewriteUnsupportedNumericClaims(post.cta, sauceBenchmarkNumericClaims, false).value;
            const nextHook = clipTextStrictMax(
              sanitizeSauceHookFallback(hookRewrite, benchmarkSnippet),
              CLAUDE_POST_HOOK_LIMITS.max,
            );
            const nextBody = clipMultilineTextStrictMax(
              normalizeBodyRhythm((bodyRewrite || benchmarkSentence).trim()),
              CLAUDE_POST_BODY_LIMITS.max,
            );
            const nextCta = shouldIncludeCta
              ? clipTextStrictMax(ctaRewrite || strictFallbackCta, CLAUDE_POST_CTA_LIMITS.max)
              : "";

            return {
              ...post,
              hook: nextHook,
              body: nextBody,
              cta: nextCta,
            };
          });
        } else {
          console.info(
            "Strict Sauce fallback numeric rewriter disabled (ENABLE_NUMERIC_SANITIZER_REWRITE=false); keeping prompt-reviewed copy.",
          );
        }
      }
    }

    let postsWithMemes: GeneratePostsResponse["posts"] = normalizedPosts;

    if (includeMemeCompanion) {
      try {
        const allowedTemplateIds: MemeTemplateId[] = memeTemplatePreferences.length ? memeTemplatePreferences : [...MEME_TEMPLATE_IDS];
        const templateLineCountById = await resolveMemegenTemplateLineCountMap(allowedTemplateIds);
        const memeSelectionSchema = makeMemeSelectionResponseSchema(
          normalizedPosts.length,
          memeVariantTarget,
        );
        const memeSelectionJsonSchema = makeMemeSelectionJsonSchema(
          normalizedPosts.length,
          memeVariantTarget,
        );
        const memeTemplateCatalog = allowedTemplateIds
          .map((id) => {
            const name = MEME_TEMPLATE_LABELS[id] ?? id.replace(/-/g, " ");
            const meaning = MEME_TEMPLATE_MEANINGS[id];
            const lineCount = templateLineCountById.get(id.trim().toLowerCase()) ?? getKnownMemeTemplateLineCount(id);
            const flowRule = MEME_TEMPLATE_FLOW_RULES[id.trim().toLowerCase()];
            const lineRoleHint = resolveMemeTemplateLineRoleHint(id, lineCount);
            const promptStrategy = resolveMemeTemplatePromptStrategy({
              templateId: id,
              lineCount,
              meaning,
              flowRule,
            });
            const speakerLabelRule = MEME_DIALOGUE_TEMPLATE_IDS.has(id.trim().toLowerCase())
              ? "speaker labels optional (dialogue template)"
              : "speaker labels forbidden";
            const flowRuleSuffix = flowRule ? ` | flow: ${flowRule}` : "";
            const roleSuffix = lineRoleHint ? ` | line roles: ${lineRoleHint}` : "";
            const strategySuffix = promptStrategy ? ` | caption strategy: ${promptStrategy}` : "";
            const speakerSuffix = ` | ${speakerLabelRule}`;
            return meaning
              ? `- ${id}: ${name} (lines: ${lineCount})${flowRuleSuffix}${roleSuffix}${speakerSuffix} - ${meaning}${strategySuffix}`
              : `- ${id}: ${name} (lines: ${lineCount})${flowRuleSuffix}${roleSuffix}${speakerSuffix}${strategySuffix}`;
          })
          .join("\n");
        const memeTemplateStrategyGuide = allowedTemplateIds
          .map((id) => {
            const lineCount = templateLineCountById.get(id.trim().toLowerCase()) ?? getKnownMemeTemplateLineCount(id);
            const meaning = MEME_TEMPLATE_MEANINGS[id];
            const flowRule = MEME_TEMPLATE_FLOW_RULES[id.trim().toLowerCase()];
            const lineRoleHint = resolveMemeTemplateLineRoleHint(id, lineCount);
            const promptStrategy = resolveMemeTemplatePromptStrategy({
              templateId: id,
              lineCount,
              meaning,
              flowRule,
            });
            const speakerLabelRule = MEME_DIALOGUE_TEMPLATE_IDS.has(id.trim().toLowerCase())
              ? "speaker labels optional"
              : "no speaker labels";
            return `- ${id}: ${promptStrategy} | ${lineRoleHint} | ${speakerLabelRule}`;
          })
          .join("\n");
        const memeSelectionSystemPrompt = `
You are selecting meme templates and caption lines for LinkedIn meme posts.
You must choose only from the provided template IDs and produce ranked variants.

CRITICAL: The caption (top/bottom text) must semantically match the meme image. Each template has a specific visual meaning and format. Choose templates whose meaning fits your joke, and write captions that are the actual joke a viewer would see — not meta-commentary about the post style, tone, or "Adapty-style humor." The text overlay IS the punchline.

The caption must be funny (it's a meme) and relevant to the specific post. Derive the joke from the post's hook and body — the meme should illustrate or punch up a point from that post, not generic filler. Make sense and land the joke.
Humor quality rules:
- Use tension then payoff: line 1 sets expectation, line 2 flips it with a concrete punchline.
- Prefer specific operator pain (paywall tests, churn, trial drop-off, analytics chaos) over abstract "business struggle" phrasing.
- Reject bland meme cliches ("when you realize", "nobody talks about this", "optimize your funnel") unless rewritten into a novel, post-specific joke.
- If a caption could fit any random SaaS post, rewrite it until it is specific to this post.
- For every selected template, strictly follow the template's line roles, caption strategy notes, and flow notes from the prompt.
- Do not swap line roles between slots. Keep line intent tied to its designated slot.
- Do not use speaker prefixes like "Leader:" or "Analyst:" unless template is right, chair, or anakin.
Never use em dash punctuation. Use standard hyphen if needed.
`;
        const memeSelectionUserPrompt = `
Meme selection request:
- Tone profile (inferred): ${memeToneProfile}
- Meme brief: ${memeBriefPreference || "(none provided - come up with a clever and funny angle automatically)"}
- Template preferences: ${memeTemplatePreferences.length ? memeTemplatePreferences.join(", ") : "(auto choose from allowed templates)"}
- Variants required per post: ${memeVariantTarget}

Allowed Memegen templates:
${memeTemplateCatalog}

Template-specific writing strategy (mandatory when template is selected):
${memeTemplateStrategyGuide}

Posts to adapt into meme captions:
${normalizedPosts
  .map(
    (post, index) => `Post ${index + 1}
Hook: ${post.hook}
Body excerpt: ${post.body.slice(0, 450)}
`,
  )
  .join("\n")}

For each post:
1. Return exactly ${memeVariantTarget} ranked variants.
2. ${
   memeTemplatePreferences.length
     ? `Use only these templates: ${memeTemplatePreferences.join(", ")}. Vary between them across variants.`
     : "Vary templates across variants when possible."
 }
3. Keep each text line concise and readable on image memes.
4. Match caption to template format and visual meaning. Do not paste style labels or meta-commentary.
   Avoid speaker prefixes (for example "Leader:"/"Analyst:") unless template is right, chair, or anakin.
5. Special template rule: if templateId is "${GONE_TEMPLATE_ID}", set bottomText and textLines[1] exactly to "${GONE_TEMPLATE_FIXED_BOTTOM_TEXT}".
6. Always include textLines array in order.
   textLines length must exactly match the selected template's line count from the catalog.
   If a template includes a flow note, follow that line-by-line order.
   For standard templates: textLines has 2 lines matching topText and bottomText.
   For templates with more slots (for example Gru, Anakin/Padme, or American Chopper): include every slot in order.
7. Joke must be funny and relevant to the post — extract the humor from the hook/body, not generic one-liners.
8. Each variant needs a distinct joke angle (for example: metric irony, team-process pain, founder expectation vs reality).
9. Score tone fit from 0 to 100 and explain briefly.
`;

        const claudeMemeModel =
          process.env.CLAUDE_MEME_MODEL?.trim() || process.env.CLAUDE_WRITER_MODEL?.trim() || CLAUDE_WRITER_MODEL;

        const runMemeSelection = (model: string) => {
          if (oauthCredentials) {
            return runCodexOauthMemeSelection({
              oauth: oauthCredentials,
              model,
              systemPrompt: memeSelectionSystemPrompt,
              userPrompt: memeSelectionUserPrompt,
              responseSchema: memeSelectionSchema,
              jsonSchema: memeSelectionJsonSchema,
            });
          }

          if (!openAiApiToken) {
            throw new Error("OpenAI API token is missing");
          }

          return runOpenAiChatMemeSelection({
            token: openAiApiToken,
            model,
            systemPrompt: memeSelectionSystemPrompt,
            userPrompt: memeSelectionUserPrompt,
            responseSchema: memeSelectionSchema,
          });
        };

        let parsedMemeSelection: z.infer<typeof memeSelectionSchema> | null = null;
        let memeSelectionError: unknown = null;

        if (useClaudeWriter && anthropicApiKey) {
          try {
            parsedMemeSelection = await runClaudeMemeSelection({
              apiKey: anthropicApiKey,
              model: claudeMemeModel,
              systemPrompt: memeSelectionSystemPrompt,
              userPrompt: memeSelectionUserPrompt,
              responseSchema: memeSelectionSchema,
              postCount: normalizedPosts.length,
              variantCount: memeVariantTarget,
              defaultTemplateId: allowedTemplateIds[0] ?? "drake",
            });
          } catch (memeError) {
            memeSelectionError = memeError;
            console.warn(
              `Claude meme selection failed; trying OpenAI/Codex fallback. ${
                memeError instanceof Error ? memeError.message : String(memeError)
              }`,
            );
          }
        }

        if (!parsedMemeSelection) {
          const memeModelCandidates: string[] = [];
          const pushMemeModelCandidate = (candidate: string) => {
            const normalized = candidate.trim();
            if (!normalized) {
              return;
            }
            if (oauthCredentials && !isCodexOauthModelSupported(normalized)) {
              return;
            }
            if (!memeModelCandidates.includes(normalized)) {
              memeModelCandidates.push(normalized);
            }
          };

          pushMemeModelCandidate(requestedModel);
          pushMemeModelCandidate(fallbackModel);
          if (oauthCredentials && memeModelCandidates.length === 0) {
            pushMemeModelCandidate("gpt-5.2");
          }

          for (const candidateModel of memeModelCandidates) {
            try {
              parsedMemeSelection = await runMemeSelection(candidateModel);
              break;
            } catch (memeError) {
              memeSelectionError = memeError;
            }
          }
        }

        if (!parsedMemeSelection) {
          throw new Error(
            `Meme selection produced no valid result.${
              memeSelectionError
                ? ` Last error: ${memeSelectionError instanceof Error ? memeSelectionError.message : String(memeSelectionError)}`
                : ""
            }`,
          );
        }

        const selectionsByPostIndex = new Map<number, { variants: MemeVariantCandidate[] }>();

        for (const selection of parsedMemeSelection.selections) {
          selectionsByPostIndex.set(selection.postIndex - 1, {
            variants: selection.variants,
          });
        }

        const variantCandidatesByPost = normalizedPosts.map((_post, index) => {
          const modelVariants = selectionsByPostIndex.get(index)?.variants;
          const normalizedModelVariants =
            modelVariants?.length === memeVariantTarget
              ? sanitizeModelMemeVariants({
                  variants: modelVariants,
                  allowedTemplateIds,
                })
              : null;
          if (normalizedModelVariants?.length !== memeVariantTarget) {
            throw new Error(
              `Meme variant generation failed: expected ${memeVariantTarget} variants from LLM, got ${normalizedModelVariants?.length ?? 0}`,
            );
          }

          return normalizedModelVariants;
        });

        postsWithMemes = normalizedPosts.map((post, index) => {
          const variantCandidates = variantCandidatesByPost[index] ?? [];
          const variants = variantCandidates.flatMap((variant, variantIndex) => {
            try {
              return [
                buildMemeCompanionFromVariant({
                  rank: variantIndex + 1,
                  variant,
                  templateLineCount:
                    templateLineCountById.get(variant.templateId.trim().toLowerCase()) ??
                    getKnownMemeTemplateLineCount(variant.templateId),
                }),
              ];
            } catch (variantError) {
              console.warn(
                `Skipping invalid meme variant #${variantIndex + 1} for post ${index + 1}: ${
                  variantError instanceof Error ? variantError.message : String(variantError)
                }`,
              );
              return [];
            }
          });

          if (!variants.length) {
            console.warn(`No valid meme variants remained for post ${index + 1}; returning post without meme companions.`);
            return post;
          }

          const rankedVariants = variants.map((variant, variantIndex) => ({
            ...variant,
            rank: variantIndex + 1,
          }));

          return {
            ...post,
            meme: rankedVariants[0],
            memeVariants: rankedVariants,
          };
        });
      } catch (memePipelineError) {
        console.warn(
          `Meme companion pipeline failed; continuing without memes. ${
            memePipelineError instanceof Error ? memePipelineError.message : String(memePipelineError)
          }`,
        );
        postsWithMemes = normalizedPosts;
      }
    }

    let postsWithMedia: GeneratePostsResponse["posts"] = postsWithMemes;
    const shouldGenerateGiphy = input.giphyEnabled;
    const giphyApiKey = process.env.GIPHY_API_KEY?.trim();

    if (shouldGenerateGiphy && giphyApiKey) {
      // Extract one focused keyword per post via LLM for better Giphy relevance
      let giphyKeywords: string[] = postsWithMemes.map((post) =>
        buildGiphyQuery({ hook: post.hook, body: post.body, memeBrief: memeBriefPreference, giphyQuery: giphyQueryPreference }),
      );

      if (openAiApiToken) {
        try {
          const { client: kwClient } = getOpenAIClient(openAiApiToken);
          const postSummaries = postsWithMemes
            .map((post, i) => `Post ${i + 1}: ${post.hook.slice(0, 120)}`)
            .join("\n");
          const hintLine = giphyQueryPreference ? `\nUser hint: "${giphyQueryPreference}"` : "";
          const kwResponse = await kwClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "user",
                content: `For each LinkedIn post, return the single best 2-4 word Giphy search keyword that would find a funny and contextually relevant reaction GIF (e.g. "mind blown", "money printer", "facepalm").${hintLine}\n\n${postSummaries}\n\nReturn JSON: {"queries": ["...", ...]}`,
              },
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
          });
          const parsed = JSON.parse(kwResponse.choices[0]?.message?.content ?? "{}") as { queries?: unknown };
          if (Array.isArray(parsed.queries) && parsed.queries.length === postsWithMemes.length) {
            giphyKeywords = (parsed.queries as unknown[]).map((q, i) =>
              typeof q === "string" && q.trim() ? q.trim().slice(0, 60) : (giphyKeywords[i] ?? ""),
            );
          }
        } catch (kwError) {
          console.warn("Giphy keyword extraction failed, falling back to buildGiphyQuery", kwError);
        }
      }

      const giphyVariantsByPost = await Promise.all(
        postsWithMemes.map(async (post, index) => {
          const query = giphyKeywords[index] ?? buildGiphyQuery({ hook: post.hook, body: post.body, memeBrief: memeBriefPreference, giphyQuery: giphyQueryPreference });

          try {
            const queryVariants = await fetchGiphyVariants({
              apiKey: giphyApiKey,
              query,
              limit: giphyVariantTarget,
            });
            return ensureDistinctGiphyVariants(queryVariants, giphyVariantTarget);
          } catch (giphyError) {
            console.error("GIPHY fetch failed", {
              query,
              hook: post.hook.slice(0, 60),
              error: giphyError instanceof Error ? giphyError.message : String(giphyError),
            });
            return [];
          }
        }),
      );

      postsWithMedia = postsWithMemes.map((post, index) => {
        const variants = giphyVariantsByPost[index] ?? [];

        if (!variants.length) {
          return post;
        }

        return {
          ...post,
          giphy: variants[0],
          giphyVariants: variants,
        };
      });
    }

    const shouldCreateXThreads =
      input.createXPosts && (input.inputLength === "long" || input.inputLength === "very long");
    const eligibleXThreadPostIndices = shouldCreateXThreads
      ? postsWithMedia
          .map((post, postIndex) => ({ post, postIndex }))
          .filter(({ post }) => post.length === "long" || post.length === "very long")
          .map(({ postIndex }) => postIndex)
      : [];

    let claudeXThreadsByPostIndex = new Map<number, string[]>();
    if (eligibleXThreadPostIndices.length && useClaudeWriter && anthropicApiKey) {
      try {
        const sourcePostsForXThreads = eligibleXThreadPostIndices.map((postIndex) => {
          const post = postsWithMedia[postIndex];
          return {
            postIndex: postIndex + 1,
            hook: post?.hook ?? "",
            body: post?.body ?? "",
            cta: post?.cta ?? "",
          };
        });

        claudeXThreadsByPostIndex = await runClaudeXThreadGeneration({
          apiKey: anthropicApiKey,
          model: process.env.CLAUDE_WRITER_MODEL ?? CLAUDE_WRITER_MODEL,
          sourcePosts: sourcePostsForXThreads,
        });
      } catch (xThreadError) {
        console.warn(
          `Claude X-thread generation failed; falling back to deterministic thread split. ${
            xThreadError instanceof Error ? xThreadError.message : String(xThreadError)
          }`,
        );
      }
    }

    const postsWithXThreads: GeneratePostsResponse["posts"] = shouldCreateXThreads
      ? postsWithMedia.map((post, postIndex) => {
          const shouldBuildThread = post.length === "long" || post.length === "very long";
          if (!shouldBuildThread) {
            return post;
          }

          const xThreadFromClaude = claudeXThreadsByPostIndex.get(postIndex + 1) ?? [];
          const fallbackThread = buildXThreadFromLinkedInPost({
            hook: post.hook,
            body: post.body,
            cta: post.cta,
          });
          const xThread = xThreadFromClaude.length ? xThreadFromClaude : fallbackThread;

          if (!xThread.length) {
            return post;
          }

          return {
            ...post,
            xThread,
          };
        })
      : postsWithMedia;

    let chartCompanion: GeneratePostsResponse["chart"] | undefined;

    if (preparedChartInput) {
      try {
        chartCompanion = await renderChartCompanion(preparedChartInput, {
          oauth: oauthCredentials
            ? {
                accessToken: oauthCredentials.accessToken,
                accountId: oauthCredentials.accountId,
              }
            : null,
          apiKey: openAiApiToken,
          apiBaseUrl: process.env.OPENAI_BASE_URL,
          imageModel: process.env.OPENAI_IMAGE_MODEL,
        });
      } catch (chartRenderError) {
        const message =
          chartRenderError instanceof Error
            ? chartRenderError.message
            : "Chart image generation failed for the provided chart data.";

        return NextResponse.json(
          {
            error: "Chart image generation failed",
            message,
          },
          { status: 400 },
        );
      }
    }

    const response: GeneratePostsResponse = {
      hooks: normalizedHooks,
      chart: chartCompanion,
      posts: postsWithXThreads,
      generation: {
        modelRequested: requestedModel,
        modelUsed,
        fallbackUsed,
        baseUrlType: oauthCredentials || process.env.OPENAI_BASE_URL ? "custom" : "openai",
        authMode: oauthCredentials ? "oauth" : "api_key",
        oauthSource: oauthCredentials?.source,
      },
      retrieval: {
        method: retrieval.method,
        goalUsed: retrieval.goalUsed,
        examplesUsed: retrieval.entries.length,
        performancePostsAnalyzed: retrieval.performanceInsights?.analyzedPosts ?? 0,
        performanceInsightsUsed: retrieval.performanceInsights?.summaryLines.length ?? 0,
        evidenceSources: {
          sois: soisContext.enabled && soisContext.items.length > 0,
          web: webEvidenceLines.length > 0,
        },
      },
      giphyRequested: input.giphyEnabled,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to generate posts",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
