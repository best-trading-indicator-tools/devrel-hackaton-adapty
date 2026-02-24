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
  MEME_TEMPLATE_OPTIONS,
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
import { getProductUpdateToneContext, getPromptGuides } from "@/lib/prompt-guides";
import { retrieveRevenueCatContext } from "@/lib/revenuecat-retrieval";
import { runIndustryNewsContext } from "@/lib/rss-news";
import { retrieveSoisContext } from "@/lib/sois-context";
import {
  generatePostsRequestSchema,
  makeGeneratePostsResponseSchema,
  type GeneratePostsResponse,
} from "@/lib/schemas";

export const runtime = "nodejs";

const MEME_INPUT_TYPE_PATTERN = /\b(meme|shitpost)\b/i;
const MEME_LINE_MAX_CHARS = 72;
const DEFAULT_MEMEGEN_BASE_URL = "https://api.memegen.link";
const FACT_CHECK_EVIDENCE_PROMPT_LIMIT = 4;
const DEFAULT_SOIS_EVIDENCE_PROMPT_LIMIT = 8;
const DEFAULT_SOIS_BROAD_EVIDENCE_PROMPT_LIMIT = 24;
const INDUSTRY_NEWS_REACTION_PATTERN = /\bindustry news reaction\b/i;
const PRODUCT_UPDATE_PATTERN = /\bproduct feature launch\b/i;
const SOIS_ACRONYM_PATTERN = /\bsois\b/i;
const SOIS_EXPANDED_PATTERN = /\bstate of in[-\s]?app subscriptions\b/i;
const AI_LABEL_STYLE_OPENER_PATTERN = /(?:^|[.!?]\s+)[A-Za-z][A-Za-z ]{1,24}:\s+/i;
const HOOK_IF_OPENING_PATTERN = /^\s*if\b/i;
const ROBOTIC_FILLER_PATTERN = /\b(?:the|this|that)\s+[a-z][a-z\s]{0,24}\s+is real\./i;
const SNAPSHOT_JARGON_PATTERN = /\b(for one segment snapshot|segment snapshot|rows analyzed|sample size)\b/i;
const YOU_YOUR_PATTERN = /\b(you|your)\b/i;

function looksLikeProductUpdatePostType(inputType: string): boolean {
  return PRODUCT_UPDATE_PATTERN.test(inputType);
}

const GOAL_PLAYBOOKS: Record<ContentGoal, string> = {
  virality:
    "Say the uncomfortable obvious truth your audience already suspects but rarely says out loud. Keep it specific, useful, and defensible.",
  engagement:
    "Optimize for replies and conversation quality. End with a concrete question that invites expert opinions, not generic agreement.",
  traffic:
    "Drive qualified clicks by making the promise of the linked resource concrete. Make the value of clicking immediately clear.",
  awareness:
    "Maximize clarity and recall for broad audiences. Keep positioning crisp and repeat one memorable brand-level message.",
  balanced:
    "Balance reach, comments, and clicks without over-optimizing a single metric. Prioritize clarity and practical value.",
};

const POST_TYPE_PLAYBOOKS: Array<{ pattern: RegExp; directive: string }> = [
  {
    pattern: /event|webinar/i,
    directive:
      "Lead with a real operator pain teams feel now, explain why this event helps in concrete terms, include explicit logistics (date/time/place), who should attend, and one practical conversation or takeaway they will get.",
  },
  {
    pattern: /product feature launch/i,
    directive:
      "Frame the user pain first, then explain what changed, why it matters, and one concrete outcome or use case.",
  },
  {
    pattern: /sauce/i,
    directive:
      "For Sauce posts, combine clear practical breakdown with data-backed insight. Use concrete numbers, explain the mechanism, and include caveats or segmentation when relevant.",
  },
  {
    pattern: /meme|shitpost/i,
    directive:
      "Keep copy punchy and caption-friendly while still grounded in real B2C mobile app monetization pain points.",
  },
  {
    pattern: /industry news reaction/i,
    directive:
      "React quickly to the news with a clear stance, concrete implication for app teams, and a practical next move.",
  },
  {
    pattern: /poll|quiz|engagement farming/i,
    directive:
      "Ask a specific high-signal question with clear options and a short context block that makes voting easy and meaningful.",
  },
  {
    pattern: /case study|social proof/i,
    directive:
      "Use before and after framing with baseline, intervention, and measurable result. Keep claims concrete and scoped.",
  },
  {
    pattern: /hiring|team culture/i,
    directive:
      "Highlight role context, ownership, and why this team environment is compelling. Keep tone human and specific.",
  },
  {
    pattern: /milestone|company update/i,
    directive:
      "Share the milestone, why it matters, and what changed operationally to get there. Prefer specific numbers over hype.",
  },
  {
    pattern: /controversial hot take/i,
    directive:
      "Take a strong stance on a real industry habit, then back it with mechanics, caveats, and a practical alternative.",
  },
  {
    pattern: /curated roundup/i,
    directive:
      "Organize items into a clear digest with one practical takeaway per item and a short recommendation on what to read first.",
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

type NumericClaimKind = "percent" | "multiplier" | "unit" | "number";

type NumericClaim = {
  raw: string;
  start: number;
  end: number;
  kind: NumericClaimKind;
  canonical: string;
  unit?: string;
};

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
      if (claim.canonical) {
        allowed.add(claim.canonical);
      }
    }
  }

  return allowed;
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
    if (timeUnits.has(unit)) {
      return "over time";
    }
    if (magnitudeUnits.has(unit)) {
      return "a large amount";
    }
    if (unit) {
      return `many ${toPluralUnit(unit)}`;
    }
    return "many";
  }

  return "several";
}

function rewriteUnsupportedNumericClaims(value: string, allowedClaims: Set<string>): {
  value: string;
  unsupportedClaims: NumericClaim[];
} {
  const claims = extractNumericClaims(value);
  const unsupportedClaims = claims.filter((claim) => !allowedClaims.has(claim.canonical));

  if (!unsupportedClaims.length) {
    return {
      value,
      unsupportedClaims: [],
    };
  }

  let rewritten = value;
  const replacements = [...unsupportedClaims].sort((a, b) => b.start - a.start);

  for (const claim of replacements) {
    rewritten =
      rewritten.slice(0, claim.start) +
      qualitativeReplacementForNumericClaim(claim) +
      rewritten.slice(claim.end);
  }

  rewritten = rewritten
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  return {
    value: rewritten,
    unsupportedClaims,
  };
}

function sanitizeHookSuggestionsNumericClaims(hooks: string[], allowedClaims: Set<string>): {
  hooks: string[];
  unsupportedClaims: NumericClaim[];
} {
  const unsupportedClaims: NumericClaim[] = [];
  const sanitizedHooks = hooks.map((hook) => {
    const result = rewriteUnsupportedNumericClaims(hook, allowedClaims);
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
): {
  posts: T[];
  unsupportedClaims: NumericClaim[];
} {
  const unsupportedClaims: NumericClaim[] = [];
  const sanitizedPosts = posts.map((post) => {
    const hookResult = rewriteUnsupportedNumericClaims(post.hook, allowedClaims);
    const bodyResult = rewriteUnsupportedNumericClaims(post.body, allowedClaims);
    const ctaResult = rewriteUnsupportedNumericClaims(post.cta, allowedClaims);
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

function normalizeBodyRhythm(body: string): string {
  const paragraphs = splitParagraphs(body).map(stripAiScaffoldOpeners).filter(Boolean);
  if (paragraphs.length < 4) {
    return paragraphs.join("\n\n");
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

  return out.join("\n\n");
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
  const isMeme = MEME_INPUT_TYPE_PATTERN.test(lowerInputType);
  const isEvent = /event|webinar/.test(lowerInputType);
  const isClickbaitVirality = shouldEnforceClickbaitViralityHook(params.style, params.goal);
  const nonEmptyBodyLines = params.post.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (AI_SLOP_PHRASE_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.AI_SLOP_CLICHES);
  }

  if (!isMeme && hasCondescendingReaderLanguage(combinedText)) {
    issues.push(QUALITY_ISSUES.CONDESCENDING);
  }

  if (!isMeme && hasUnsupportedAdaptySuperlative(combinedText)) {
    issues.push(QUALITY_ISSUES.UNSUPPORTED_ADAPTY_SUPERLATIVE);
  }

  if (!isMeme && hasCorporateJargon(combinedText)) {
    issues.push(QUALITY_ISSUES.CORPORATE_JARGON);
  }

  if (!isMeme && hasRoboticCorporateTone(combinedText)) {
    issues.push(QUALITY_ISSUES.ROBOTIC_TONE);
  }

  if (!isMeme && !hasDirectReaderAddress(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_DIRECT_READER);
  }

  if (!isMeme && !hasOperatorActionLanguage(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_OPERATOR_ACTION);
  }

  if (!isMeme && hasUnexpandedSoisAcronym(combinedText)) {
    issues.push(QUALITY_ISSUES.UNEXPANDED_SOIS);
  }

  if (!isMeme && hasLabelStyleSentenceOpener(combinedText)) {
    issues.push(QUALITY_ISSUES.LABEL_STYLE_OPENER);
  }

  if (!isMeme && hasAiScaffoldOpener(params.post.body)) {
    issues.push(QUALITY_ISSUES.AI_SCAFFOLD_OPENER);
  }

  if (!isMeme && ROBOTIC_FILLER_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.ROBOTIC_FILLER);
  }

  if (!isMeme && SNAPSHOT_JARGON_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.SNAPSHOT_JARGON);
  }

  if (!isMeme && hasDenseMetricDump(combinedText)) {
    issues.push(QUALITY_ISSUES.DENSE_METRIC_DUMP);
  }

  if (!isMeme && countConcreteProofUnits(combinedText) < 1) {
    issues.push(QUALITY_ISSUES.MISSING_PROOF_UNIT);
  }

  if (!isMeme && params.requireNumericAnchor && countNumericTokens(combinedText) < 1) {
    issues.push(QUALITY_ISSUES.MISSING_NUMERIC_ANCHOR);
  }

  if (!isMeme && countSpecificityAnchors(combinedText) < 1 && !SPECIFICITY_ANCHOR_PATTERN.test(combinedText)) {
    issues.push(QUALITY_ISSUES.MISSING_SPECIFICITY);
  }

  if (!isMeme && params.post.body.length > 280 && !/\n\s*\n/.test(params.post.body)) {
    issues.push(QUALITY_ISSUES.MISSING_BLANK_LINES);
  }

  if (hasShortLineStack(params.post.body)) {
    issues.push(QUALITY_ISSUES.SHORT_LINE_STACK);
  }

  if (!isMeme && hasStaccatoParagraphRhythm(params.post.body)) {
    issues.push(QUALITY_ISSUES.STACCATO_RHYTHM);
  }

  if (!isMeme && isClickbaitVirality) {
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

function ensureFinalCta(cta: string, ctaLink: string): string {
  const cleanCta = cta.trim();
  const cleanLink = ctaLink.trim();

  if (!cleanLink) {
    return cleanCta;
  }

  if (cleanCta.includes(cleanLink)) {
    return cleanCta;
  }

  return `${cleanCta.replace(/[.\s]+$/g, "")}. ${cleanLink}`;
}

function normalizeNoEmDash(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function shouldGenerateMemes(inputType: string): boolean {
  return MEME_INPUT_TYPE_PATTERN.test(inputType);
}

function normalizeMemeLine(value: string): string {
  return normalizeNoEmDash(value)
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function clipMemeLine(value: string, maxChars: number): string {
  const clean = normalizeMemeLine(value);

  if (clean.length <= maxChars) {
    return clean;
  }

  const clipped = clean.slice(0, maxChars + 1).replace(/\s+\S*$/, "").trim();
  return clipped || clean.slice(0, maxChars).trim();
}

function pickMemeBottomLine(body: string): string {
  const candidates = body
    .split(/\n+/)
    .map((line) => normalizeMemeLine(line))
    .filter((line) => line.length >= 12 && !/^https?:\/\//i.test(line));

  if (candidates.length) {
    return candidates[0];
  }

  return "Still shipping and iterating";
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

type MemeVariantCandidate = {
  templateId: MemeTemplateId;
  topText: string;
  bottomText: string;
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
                required: ["templateId", "topText", "bottomText", "toneFitScore", "toneFitReason"],
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
    toneFitScore: number;
    toneFitReason: string;
  }>;
  allowedTemplateIds: MemeTemplateId[];
  postIndex: number;
}): MemeVariantCandidate[] {
  const allowedTemplateSet = new Set(params.allowedTemplateIds);
  const fallbackTemplateId =
    params.allowedTemplateIds[params.postIndex % params.allowedTemplateIds.length] ?? MEME_TEMPLATE_IDS[0];

  return params.variants.map((variant) => {
    const normalizedTemplateId = variant.templateId.trim().toLowerCase();
    const templateId = allowedTemplateSet.has(normalizedTemplateId as MemeTemplateId)
      ? (normalizedTemplateId as MemeTemplateId)
      : fallbackTemplateId;

    return {
      templateId,
      topText: normalizeNoEmDash(variant.topText),
      bottomText: normalizeNoEmDash(variant.bottomText),
      toneFitScore: variant.toneFitScore,
      toneFitReason: normalizeNoEmDash(variant.toneFitReason),
    };
  });
}

function buildMemeCompanionFromVariant(params: { variant: MemeVariantCandidate; rank: number }) {
  const templateName = MEME_TEMPLATE_LABELS[params.variant.templateId] ?? params.variant.templateId;
  const topText = clipMemeLine(params.variant.topText, MEME_LINE_MAX_CHARS) || "App teams shipping fast";
  const bottomText = clipMemeLine(params.variant.bottomText, MEME_LINE_MAX_CHARS) || "Growth teams in 2026";
  const url = `${getMemegenBaseUrl()}/images/${params.variant.templateId}/${encodeMemegenPathSegment(topText)}/${encodeMemegenPathSegment(bottomText)}.jpg`;

  return {
    rank: params.rank,
    templateId: params.variant.templateId,
    templateName,
    topText,
    bottomText,
    url,
    toneFitScore: Math.max(0, Math.min(100, Math.round(params.variant.toneFitScore))),
    toneFitReason: normalizeNoEmDash(params.variant.toneFitReason),
  };
}

function buildHeuristicMemeVariants(params: {
  hook: string;
  body: string;
  index: number;
  variantCount: number;
  toneProfile: string;
  preferredTemplateIds: MemeTemplateId[];
  allowedTemplateIds: MemeTemplateId[];
}) {
  const fallbackTop = clipMemeLine(params.hook, MEME_LINE_MAX_CHARS) || "App growth team update";
  const fallbackBottom = clipMemeLine(pickMemeBottomLine(params.body), MEME_LINE_MAX_CHARS) || "Still iterating";
  const compactTone = clipMemeLine(params.toneProfile, 48) || "clever";
  const preferredTemplates = params.preferredTemplateIds.length ? params.preferredTemplateIds : params.allowedTemplateIds;
  const allowedTemplates = preferredTemplates.length ? preferredTemplates : MEME_TEMPLATE_IDS;

  return Array.from({ length: params.variantCount }, (_, variantIndex) => {
    const templateId = allowedTemplates[(params.index + variantIndex) % allowedTemplates.length];
    const topText =
      variantIndex === 0
        ? fallbackTop
        : clipMemeLine(`${compactTone}: ${fallbackTop}`, MEME_LINE_MAX_CHARS) || fallbackTop;
    const bottomText =
      variantIndex === 0
        ? fallbackBottom
        : clipMemeLine(`${fallbackBottom} (${variantIndex + 1})`, MEME_LINE_MAX_CHARS) || fallbackBottom;

    return buildMemeCompanionFromVariant({
      rank: variantIndex + 1,
      variant: {
        templateId,
        topText,
        bottomText,
        toneFitScore: Math.max(35, 82 - variantIndex * 7),
        toneFitReason: variantIndex === 0 ? "Fallback best-fit based on hook and body." : "Fallback alternative variant.",
      },
    });
  });
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
    return `${baseDirective} ${sharedHumanDirective}`;
  }

  return `Follow custom brand voice: "${style.trim()}". ${sharedHumanDirective}`;
}

function resolveAutoHookDirective(params: { style: string; inputType: string; goal: ContentGoal }): string {
  const styleKey = params.style.trim().toLowerCase();

  const clickbaitViralityRule =
    styleKey === "clickbait" && params.goal === "virality"
      ? " Hook must be one declarative sentence with a concrete fact people suspect but rarely say. Use you/your. Do not start with If."
      : "";

  return `Hook: make it specific, scroll-stopping, and matched to the voice and goal.${clickbaitViralityRule}`;
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

  const postTypeProfile = /meme|shitpost/.test(typeKey)
    ? "keep captions short, visual, and directly relatable to mobile app monetization pain"
    : "keep humor useful and tied to the post context";

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
  imageDataUrl?: string;
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
  temperature?: number;
}) {
  const { client } = getOpenAIClient(params.token);
  const userContent: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] = params.imageDataUrl
    ? [
        { type: "text", text: params.userPrompt },
        {
          type: "image_url",
          image_url: {
            url: params.imageDataUrl,
            detail: "auto",
          },
        },
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

  return parsed;
}

async function runCodexOauthGeneration(params: {
  oauth: CodexOAuthCredentials;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
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
    imageDataUrl: params.imageDataUrl,
    schemaName: "linkedin_post_batch",
    jsonSchema: jsonSchema as Record<string, unknown>,
    baseUrl: process.env.OPENAI_CODEX_BASE_URL,
  });

  return params.responseSchema.parse(parsedJson);
}

const CLAUDE_WRITER_MODEL = "claude-sonnet-4-5";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- postCount reserved for future schema constraints
function buildClaudePostsJsonSchema(postCount: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      hooks: {
        type: "array",
        items: { type: "string" },
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
        minItems: 1,
      },
    },
    required: ["hooks", "posts"],
    additionalProperties: false,
  };
}

async function runClaudeWriterGeneration(params: {
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
  responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
  postCount: number;
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude writer");
  }

  const client = new Anthropic({ apiKey });
  const userContent: Anthropic.MessageParam["content"] = [];

  if (params.imageDataUrl) {
    const match = params.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mediaType = match[1] === "image/png" ? "image/png" : match[1] === "image/jpeg" ? "image/jpeg" : "image/png";
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: match[2] },
      });
    }
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
        schema: buildClaudePostsJsonSchema(params.postCount),
      },
    },
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content");
  }

  const parsed = JSON.parse(textBlock.text) as unknown;
  return params.responseSchema.parse(parsed);
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
            "Missing credentials. Set OPENAI_OAUTH_TOKEN (recommended) or OPENAI_API_KEY / OPENAI_ACCESS_TOKEN.",
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

    const [retrieval, soisContext, webFactCheck, industryNewsContext, revenueCatContext] = await Promise.all([
      retrieveLibraryContext({
        client: embeddingClient,
        query: retrievalQuery,
        limit: Math.min(12, Math.max(6, input.numberOfPosts * 3)),
        goal: input.goal,
      }),
      retrieveSoisContext({
        client: embeddingClient,
        query: soisRetrievalQuery || retrievalQuery,
        details: input.details,
        preferBroadCoverage: !hasSpecificSoisPromptDetails,
        inputType: input.inputType,
        limit: Math.min(12, Math.max(6, input.numberOfPosts * 2)),
      }),
      runWebFactCheck({
        style: input.style,
        goal: input.goal,
        inputType: input.inputType,
        details: input.details,
        time: input.time,
        place: input.place,
        ctaLink: input.ctaLink,
      }),
      runIndustryNewsContext({
        style: input.style,
        goal: input.goal,
        inputType: input.inputType,
        details: input.details,
      }),
      retrieveRevenueCatContext({
        client: embeddingClient,
        query: soisRetrievalQuery || retrievalQuery,
        inputType: input.inputType,
        limit: Math.min(8, Math.max(4, input.numberOfPosts * 2)),
      }),
    ]);

    const examplesForPrompt = retrieval.entries
      .slice(0, 10)
      .map(
        (entry, index) =>
          `Example ${index + 1}${formatExampleMetrics(entry)}:\n${normalizeNoEmDash(entry.text.slice(0, 1600))}`,
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
    const giphyVariantTarget = Math.max(1, Math.min(6, input.memeVariantCount));
    const memeExecutionDirective = shouldGenerateMemes(input.inputType)
      ? "This is a meme-focused request. Keep hooks and first body lines short, punchy, and caption-friendly. If no meme brief is provided, come up with clever and funny angles automatically."
      : "Not a meme-focused request.";
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
    const webEvidenceLines = webFactCheck.evidenceLines
      .slice(0, FACT_CHECK_EVIDENCE_PROMPT_LIMIT)
      .map((line) => normalizeNoEmDash(line));
    const soisEvidencePromptLimit = hasSpecificSoisPromptDetails
      ? DEFAULT_SOIS_EVIDENCE_PROMPT_LIMIT
      : soisBroadEvidencePromptLimit;
    const soisEvidenceLines = soisContext.items.slice(0, soisEvidencePromptLimit).map((item, index) => {
      const compactText = normalizeNoEmDash(item.text.replace(/\s*\n+\s*/g, " | "));
      return `${index + 1}. [${item.categoryLabel} ${item.subcategory}] ${item.subcategoryLabel}
- Source: ${item.sourceUrl}
- Evidence: ${compactText}`;
    });
    const factCheckDirective = webEvidenceLines.length
      ? "Web evidence is available. For factual claims, stay consistent with the evidence context and avoid unsupported new hard facts. Prefer real numbers only when they can be grounded in this evidence or other provided context."
      : "Web evidence is unavailable or empty. Do not invent hard facts or numbers. Rewrite uncertain factual claims as opinion, observation, or hypothesis.";
    const soisDirective = soisContext.enabled
      ? "State of In-App Subscriptions (SOIS) benchmark evidence is available. Use it as a first-class factual source for hooks, mechanisms, caveats, and numeric anchors."
      : "State of In-App Subscriptions (SOIS) benchmark evidence is unavailable for this run. Do not fabricate benchmark numbers or section-specific claims.";
    const factCheckEvidenceForPrompt = webEvidenceLines.length
      ? webEvidenceLines.join("\n")
      : "No live web evidence available for this request.";
    const soisEvidenceForPrompt = soisEvidenceLines.length
      ? soisEvidenceLines.join("\n")
      : "No SOIS benchmark evidence available for this request.";
    const revenueCatEvidenceForPrompt =
      revenueCatContext.enabled && revenueCatContext.items.length
        ? revenueCatContext.items.map((item) => item.text).join("\n")
        : "";
    const allowedNumericClaims = buildAllowedNumericClaimSet(
      [
        factCheckEvidenceForPrompt,
        soisEvidenceForPrompt,
        revenueCatEvidenceForPrompt,
        input.details,
        input.time,
        input.place,
        input.ctaLink,
        chartPromptSummary,
        industryNewsContextSummary,
        industryNewsTopicPlanSummary,
      ].filter(Boolean),
    );

    const responseSchema = makeGeneratePostsResponseSchema(input.numberOfPosts);
    const promptGuides = await getPromptGuides();
    const sauceDomainGuideSection = looksLikeSaucePostType(input.inputType)
      ? `
Sauce guide from repository prompt file:
${promptGuides.sauce}

ASO guide from repository prompt file:
${promptGuides.aso}

Paywall guide from repository prompt file:
${promptGuides.paywall}
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

    const systemPrompt = `
You write LinkedIn posts for Adapty, the tool app teams use to grow subscription revenue through paywalls, experiments, and analytics.

Voice: write like a sharp friend who works in mobile apps talking to another operator. Not a marketing department. Not a consultant. A real person who's been in the trenches and talks like it.

If a sentence sounds like it could come from a press release, a consulting deck, or a default AI response, rewrite it the way you'd actually say it to a colleague over coffee. If a sentence just restates itself in two halves separated by a comma, it's doing nothing — cut or rewrite.

Hooks need soul. Soulful hooks start from a specific observation: a number, a name, a thing that happened. Soulless hooks use the "X is not Y, it's Z" template (e.g. "Your traffic is not the main paywall problem, your sequence is"). Rewrite soulless hooks to anchor in something concrete.

Writing guide:
${promptGuides.writing}
${sauceDomainGuideSection}${productUpdateToneSection}
Fact-check guide:
${promptGuides.factCheck}

Output format:
- For each post return: hook (first line), body (full post excluding CTA), cta (final action line).
- Use line breaks between subtopics so posts breathe.
- If CTA link is provided, weave it naturally into the CTA line.
- For multi-post industry news batches, anchor each post to a different news item.
- When source metadata says "others", use for structural inspiration, not voice imitation.
- Back any Adapty positioning with proof or mechanism, not empty superlatives.

Numbers rule: NEVER invent statistics, percentages, sample sizes, or multipliers. Every number in a post must be copy-pasted from the evidence sections in the user prompt. If a number does not appear in those sections, do NOT use it. Use qualitative language instead (e.g. "significantly higher" not "5x higher", "most apps" not "763 apps"). A post with one fabricated number is worse than a post with zero numbers. Do NOT hallucinate sample sizes like "763 apps" or "1,200 apps" — if the evidence does not state a sample size, omit it.

Before returning, read each post out loud in your head. If any sentence sounds like something no human would actually say, rewrite it.
${toBulletedSection(QUALITY_GATE_PROMPT_LINES)}
`;

    const factsPolicy = [factCheckDirective, soisDirective].filter(Boolean).join(" ");

    const memeSection = shouldGenerateMemes(input.inputType)
      ? `\nMeme config: ${memeExecutionDirective}
- Tone: ${memeToneProfile}
- Brief: ${memeBriefPreference || "(auto)"}
- Templates: ${memeTemplatePreferences.length ? memeTemplatePreferences.join(", ") : "auto"}
- Variants per post: ${memeVariantTarget}
- GIPHY companions: ${input.giphyEnabled ? "enabled" : "disabled"}
- GIPHY query hint: ${giphyQueryPreference || "(auto from each post content)"}`
      : "";

    const userPrompt = `
Voice anchor — match the tone, rhythm, and phrasing of these posts:
${examplesForPrompt || "No library examples available."}

Performance patterns from past posts:
${performanceInsightsForPrompt}

Generation request:
- Brand voice: ${input.style} — ${brandVoiceDirective} ${autoHookDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]}) — ${goalExecutionDirective}
- Post type: ${input.inputType} — ${postTypeDirective}
- Facts policy: ${factsPolicy} EVERY number must come verbatim from the evidence sections below. If no number exists for a claim, use qualitative language. Zero tolerance for invented statistics.
- Details: ${input.details || "(none)"}
- CTA link: ${input.ctaLink || "(not provided)"}
- Event time: ${input.time || "(not provided)"}
- Event place: ${input.place || "(not provided)"}
- Number of posts: ${input.numberOfPosts}
- Chart: ${chartExecutionDirective} ${chartPromptSummary !== "(not provided)" ? `Summary: ${chartPromptSummary}` : ""}
- Image context: ${input.imageDataUrl ? "provided" : "(none)"}${memeSection}

Required length per post:
${lengthPlan.map((length, index) => `${index + 1}. ${length} -> ${lengthGuide(length)}`).join("\n")}

Evidence context (priority order: SOIS > RevenueCat > web. ONLY use numbers that appear verbatim below — do NOT invent any statistic, percentage, sample size, or multiplier):

1. SOIS benchmark context (highest priority — Adapty State of In-App Subscriptions):
${soisEvidenceForPrompt}

2. RevenueCat benchmarks (second priority — State of Subscription Apps 2025):
${revenueCatEvidenceForPrompt || "No RevenueCat data for this post type."}

3. Web fact-check (third priority — use only if SOIS/RevenueCat lack the claim):
${factCheckEvidenceForPrompt}

Industry news context:
${industryNewsContextSummary}
${industryNewsExecutionDirective}

Per-post industry topic plan:
${industryNewsTopicPlanSummary}

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
    const useClaudeWriter = Boolean(anthropicApiKey);

    const runGeneration = (params: {
      model: string;
      userPrompt: string;
      responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
    }): Promise<GeneratedBatch> => {
      if (useClaudeWriter) {
        return runClaudeWriterGeneration({
          systemPrompt,
          userPrompt: params.userPrompt,
          imageDataUrl: input.imageDataUrl || undefined,
          responseSchema: params.responseSchema,
          postCount: input.numberOfPosts,
        });
      }

      if (oauthCredentials) {
        return runCodexOauthGeneration({
          oauth: oauthCredentials,
          model: params.model,
          systemPrompt,
          userPrompt: params.userPrompt,
          imageDataUrl: input.imageDataUrl || undefined,
          responseSchema: params.responseSchema,
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
        imageDataUrl: input.imageDataUrl || undefined,
        responseSchema: params.responseSchema,
      });
    };

    const runGenerationWithFallback = async (params: {
      userPrompt: string;
      responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
    }) => {
      try {
        const parsed = await runGeneration({
          model: requestedModel,
          userPrompt: params.userPrompt,
          responseSchema: params.responseSchema,
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
    const shouldSplitIndustryNewsBatch =
      looksLikeIndustryNewsReactionPostType(input.inputType) && input.numberOfPosts > 1 && industryNewsContext.items.length > 1;

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
        const singlePostSchema = makeGeneratePostsResponseSchema(1);
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
- Keep implication and CTA aligned to this assigned topic.

Ranked item index for this post: ${(index % industryNewsContext.items.length) + 1}
All ranked item titles for reference:
${rankedContextLines}`;

        const singleRun = await runGenerationWithFallback({
          userPrompt: singlePostPrompt,
          responseSchema: singlePostSchema,
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
      });
      parsed = batchRun.parsed;
      if (!useClaudeWriter) {
        modelUsed = batchRun.modelUsed;
        fallbackUsed = batchRun.fallbackUsed;
      }
    }

    const includeMemeCompanion = shouldGenerateMemes(input.inputType);
    const shouldEnforceParagraphNormalization = !MEME_INPUT_TYPE_PATTERN.test(input.inputType.toLowerCase());
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
        const normalizedCta = stripAiScaffoldOpeners(normalizeNoEmDash(ensureFinalCta(post.cta, input.ctaLink)));

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

    if (qualityIssuesByPost.length > 0) {
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
      });

      if (repairedBatchRun.fallbackUsed) {
        fallbackUsed = true;
        modelUsed = repairedBatchRun.modelUsed;
      }

      parsed = repairedBatchRun.parsed;
      normalizedPosts = normalizeGeneratedPosts(parsed.posts);
      qualityIssuesByPost = collectQualityIssues(normalizedPosts);
    }

    const shouldRunEditorPass = qualityIssuesByPost.length > 0;

    if (shouldRunEditorPass) {
      const editorSystemPrompt = `You edit LinkedIn posts to sound like a real human wrote them.

Read the draft. For each sentence ask: would someone actually say this to a friend? If not, rewrite it simpler.

Hooks need soul. Soulful hooks start from a specific observation: a number, a name, a thing that happened. Soulless hooks use the "X is not Y, it's Z" template — they sound like consultant deck headlines. Rewrite soulless hooks to anchor in something concrete.

Do this:
- Cut sentences whose only job is to frame the next sentence ("This is what most people miss", "Here's the thing", "Let's talk about why").
- Rewrite sentences that restate themselves in two halves separated by a comma or period.
- Replace stiff phrasing with how someone would actually say it.
- Say "app makers" or "app founders" instead of "teams" or "operators."
- Use digits for numbers ("3 things" not "three things").
- Use hyphens, commas, and periods. No em dashes or en dashes.

Keep all facts, numbers, arguments, and structure intact. Do not add new content. Only tighten what is there.

Patterns to catch and fix:

Soulless hooks (X is not Y, it's Z) — rewrite with something concrete:
Before: "Your traffic is not the main paywall problem, your sequence is."
After: "We ran 12 paywall tests last quarter. The one that moved LTV had nothing to do with copy."

Before: "Your app is probably not under-monetized, it is under-tested."
After: "Most apps I audit have 3 paywall variants and 0 placement tests."

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

      const editorUserPrompt = `Edit these ${normalizedPosts.length} post(s). Return the same number of posts with the same hooks array.\n\n${editorDraftPrompt}\n\nReturn ${parsed.hooks.length} hook suggestions as well (keep good ones, tighten sloppy ones).`;

      const runEditorGeneration = (params: {
        model: string;
        userPrompt: string;
        responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
      }): Promise<GeneratedBatch> => {
        if (oauthCredentials) {
          return runCodexOauthGeneration({
            oauth: oauthCredentials,
            model: params.model,
            systemPrompt: editorSystemPrompt,
            userPrompt: params.userPrompt,
            responseSchema: params.responseSchema,
          });
        }

        if (!openAiApiToken) {
          throw new Error("OpenAI API token is missing");
        }

        return runOpenAiChatGeneration({
          token: openAiApiToken,
          model: params.model,
          systemPrompt: editorSystemPrompt,
          userPrompt: params.userPrompt,
          responseSchema: params.responseSchema,
          temperature: 0.4,
        });
      };

      try {
        const editorRun = await (async () => {
          try {
            return await runEditorGeneration({
              model: requestedModel,
              userPrompt: editorUserPrompt,
              responseSchema,
            });
          } catch (primaryError) {
            if (fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError)) {
              return runEditorGeneration({
                model: fallbackModel,
                userPrompt: editorUserPrompt,
                responseSchema,
              });
            }
            throw primaryError;
          }
        })();

        parsed = editorRun;
        normalizedPosts = normalizeGeneratedPosts(editorRun.posts);
      } catch {
        // Editor pass is best-effort; if it fails, keep the original posts
      }
    }

    let normalizedHooks = parsed.hooks.map((hook) => normalizeNoEmDash(hook));
    const sanitizedHooksResult = sanitizeHookSuggestionsNumericClaims(normalizedHooks, allowedNumericClaims);
    normalizedHooks = sanitizedHooksResult.hooks.map((hook) => normalizeNoEmDash(hook));

    const sanitizedPostsResult = sanitizeGeneratedPostsNumericClaims(normalizedPosts, allowedNumericClaims);
    normalizedPosts = sanitizedPostsResult.posts;

    const numericClaimsSanitizedCount =
      sanitizedHooksResult.unsupportedClaims.length + sanitizedPostsResult.unsupportedClaims.length;
    if (numericClaimsSanitizedCount > 0) {
      console.warn(
        `Numeric safety pass rewrote ${numericClaimsSanitizedCount} unsupported number claim(s) to qualitative phrasing.`,
      );
    }

    let postsWithMemes: GeneratePostsResponse["posts"] = normalizedPosts;

    if (includeMemeCompanion) {
      const allowedTemplateIds: MemeTemplateId[] = memeTemplatePreferences.length ? memeTemplatePreferences : [...MEME_TEMPLATE_IDS];
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
          return meaning ? `- ${id}: ${name} — ${meaning}` : `- ${id}: ${name}`;
        })
        .join("\n");
      const memeSelectionSystemPrompt = `
You are selecting meme templates and caption lines for LinkedIn meme posts.
You must choose only from the provided template IDs and produce ranked variants.

CRITICAL: The caption (top/bottom text) must semantically match the meme image. Each template has a specific visual meaning and format. Choose templates whose meaning fits your joke, and write captions that are the actual joke a viewer would see — not meta-commentary about the post style, tone, or "Adapty-style humor." The text overlay IS the punchline.

The caption must be funny (it's a meme) and relevant to the specific post. Derive the joke from the post's hook and body — the meme should illustrate or punch up a point from that post, not generic filler. Make sense and land the joke.
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
3. Keep top and bottom lines concise and readable on image memes.
4. Match caption to template: topText and bottomText must fit the template's format and visual meaning. Do not paste style labels or meta-commentary.
5. Joke must be funny and relevant to the post — extract the humor from the hook/body, not generic one-liners.
6. Score tone fit from 0 to 100 and explain briefly.
`;

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

      try {
        parsedMemeSelection = await runMemeSelection(modelUsed);
      } catch (memeError) {
        console.error("Meme variant generation failed, using heuristic fallback", memeError);
      }

      const selectionsByPostIndex = new Map<number, { variants: MemeVariantCandidate[] }>();

      for (const selection of parsedMemeSelection?.selections ?? []) {
        selectionsByPostIndex.set(selection.postIndex - 1, {
          variants: selection.variants,
        });
      }

      postsWithMemes = normalizedPosts.map((post, index) => {
        const modelVariants = selectionsByPostIndex.get(index)?.variants;
        const normalizedModelVariants =
          modelVariants?.length === memeVariantTarget
            ? sanitizeModelMemeVariants({
                variants: modelVariants,
                allowedTemplateIds,
                postIndex: index,
              })
            : null;
        const variants =
          normalizedModelVariants?.length === memeVariantTarget
            ? normalizedModelVariants.map((variant, variantIndex) =>
                buildMemeCompanionFromVariant({
                  rank: variantIndex + 1,
                  variant,
                }),
              )
            : buildHeuristicMemeVariants({
                hook: post.hook,
                body: post.body,
                index,
                variantCount: memeVariantTarget,
                toneProfile: memeToneProfile,
                preferredTemplateIds: memeTemplatePreferences,
                allowedTemplateIds,
              });

        return {
          ...post,
          meme: variants[0],
          memeVariants: variants,
        };
      });
    }

    let postsWithMedia: GeneratePostsResponse["posts"] = postsWithMemes;
    const shouldGenerateGiphy = input.giphyEnabled;
    const giphyApiKey = process.env.GIPHY_API_KEY?.trim();

    if (shouldGenerateGiphy && giphyApiKey) {
      const giphyVariantsByPost = await Promise.all(
        postsWithMemes.map(async (post) => {
          const query = buildGiphyQuery({
            hook: post.hook,
            body: post.body,
            memeBrief: memeBriefPreference,
            giphyQuery: giphyQueryPreference,
          });

          try {
            const queryVariants = await fetchGiphyVariants({
              apiKey: giphyApiKey,
              query,
              limit: giphyVariantTarget,
            });
            return ensureDistinctGiphyVariants(queryVariants, giphyVariantTarget);
          } catch (giphyError) {
            console.error("GIPHY companion fetch failed for one post", giphyError);
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
      posts: postsWithMedia,
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
      },
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
