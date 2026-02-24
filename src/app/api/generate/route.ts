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
const DEFAULT_MEME_TEMPLATE_LINE_COUNT = 2;
const MAX_MEME_TEMPLATE_LINE_COUNT = 8;
const MEME_TEMPLATE_LINE_COUNT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MEME_TEMPLATE_LINE_COUNT_TIMEOUT_MS = 3_000;
const MEME_TEMPLATE_LINE_COUNT_CACHE = new Map<string, { lineCount: number; expiresAt: number }>();
const KNOWN_MEME_TEMPLATE_LINE_COUNTS: Record<string, number> = {
  chair: 6,
  gru: 4,
  right: 5,
  anakin: 4,
  db: 3,
  same: 3,
};
const MEME_TEMPLATE_FLOW_RULES: Record<string, string> = {
  right:
    "5-line dialogue: line1 setup claim, line2 optimistic \"right?\", line3 hidden catch, line4 nervous follow-up question, line5 awkward payoff.",
  chair:
    "6-line argument with alternating speakers: line1 claim, line2 rebuttal, line3 escalation, line4 counter, line5 loud thesis, line6 final reality-check punchline.",
  gru: "4-line plan flow: idea, expected result, failure realization, corrected action.",
};
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
      .split(/\n|\|/)
      .map((segment) => normalizeNoEmDash(segment.replace(/^[-*]\s*/, "").trim()))
      .filter(Boolean);

    for (const segment of segments) {
      if (!/\d/.test(segment)) {
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

  let rewritten = value;
  const replacements = [...rewrittenClaims].sort((a, b) => b.start - a.start);

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

  let rewritten = value;
  const replacements = [...rewrittenClaims].sort((a, b) => b.start - a.start);

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
    if (/^(and|but)\b/i.test(clean)) {
      throw new Error(`Template '${normalizedTemplateId}' line ${lineIndex + 1} starts with dangling conjunction.`);
    }
    const tail = clean.split(/\s+/).filter(Boolean).at(-1)?.toLowerCase() ?? "";
    if (tail && danglingTailWords.has(tail)) {
      throw new Error(`Template '${normalizedTemplateId}' line ${lineIndex + 1} ends with dangling word '${tail}'.`);
    }
    return clean;
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
        schema: buildClaudePostsJsonSchema(),
      },
    },
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content");
  }

  const parsed = JSON.parse(textBlock.text) as unknown;

  // Claude can occasionally over-generate array items even with JSON schema guidance.
  if (parsed && typeof parsed === "object") {
    const normalized = parsed as { hooks?: unknown[]; posts?: unknown[] };
    const requiredHookCount = Math.max(5, params.postCount);

    if (Array.isArray(normalized.posts)) {
      if (normalized.posts.length > params.postCount) {
        normalized.posts = normalized.posts.slice(0, params.postCount);
      }

      if (normalized.posts.length > 0 && normalized.posts.length < params.postCount) {
        const templatePost = normalized.posts[normalized.posts.length - 1];
        while (normalized.posts.length < params.postCount) {
          normalized.posts.push({ ...(templatePost as Record<string, unknown>) });
        }
      }
    }

    if (Array.isArray(normalized.hooks)) {
      const hooks = normalized.hooks.filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0);
      const postHooks =
        Array.isArray(normalized.posts)
          ? normalized.posts
              .map((post) =>
                post && typeof post === "object" && typeof (post as { hook?: unknown }).hook === "string"
                  ? ((post as { hook: string }).hook ?? "")
                  : "",
              )
              .filter(Boolean)
          : [];

      const candidateHooks = [...hooks, ...postHooks].slice(0, 20);
      const finalizedHooks = [...candidateHooks];

      if (!finalizedHooks.length) {
        finalizedHooks.push("Operator benchmark takeaway you can act on today.");
      }

      const cycleHooks = candidateHooks.length ? candidateHooks : finalizedHooks;
      while (finalizedHooks.length < requiredHookCount) {
        finalizedHooks.push(cycleHooks[finalizedHooks.length % cycleHooks.length] ?? finalizedHooks[0]);
      }

      normalized.hooks = finalizedHooks.slice(0, 20);
    }
  }

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
    const revenueCatQuery =
      looksLikeSaucePostType(input.inputType) && (soisRetrievalQuery || retrievalQuery)
        ? `${soisRetrievalQuery || retrievalQuery} | conversion trial paywall LTV revenue benchmark`
        : soisRetrievalQuery || retrievalQuery;

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
        query: revenueCatQuery,
        inputType: input.inputType,
        limit: looksLikeSaucePostType(input.inputType)
          ? 24
          : Math.min(8, Math.max(4, input.numberOfPosts * 2)),
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
    const giphyVariantTarget = 1;
    const includeMemeCompanion = input.memeEnabled || shouldGenerateMemes(input.inputType);
    const memeExecutionDirective = includeMemeCompanion
      ? shouldGenerateMemes(input.inputType)
        ? "This is a meme-focused request. Keep hooks and first body lines short, punchy, and caption-friendly. If no meme brief is provided, come up with clever and funny angles automatically."
        : "Meme companion is enabled. Keep post copy strong for the selected post type, and let meme captions punch up one concrete insight."
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
      ? "Web evidence is available. Ground factual claims in this evidence. Use real numbers only when they appear in the evidence or provided context."
      : "Web evidence is unavailable or empty. Phrase uncertain factual claims as opinion, observation, or hypothesis.";
    const soisDirective = soisContext.enabled
      ? "State of In-App Subscriptions (SOIS) benchmark evidence is available. Use it as a first-class factual source for hooks, mechanisms, caveats, and numeric anchors."
      : "State of In-App Subscriptions (SOIS) benchmark evidence is unavailable for this run. Use only numbers and claims from other provided evidence.";
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

    console.log("[Evidence] SOIS lines:", soisEvidenceLines.length, "\n", soisEvidenceForPrompt.slice(0, 1500));
    console.log("[Evidence] RevenueCat lines:", revenueCatContext.items.length, "\n", revenueCatEvidenceForPrompt.slice(0, 1500));
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
    const sauceBenchmarkNumericClaims = buildAllowedNumericClaimSet(
      [
        ...soisContext.items.map((item) => item.text),
        ...revenueCatContext.items.map((item) => item.text),
        input.ctaLink,
      ].filter(Boolean),
    );
    const sauceBenchmarkSnippets = collectBenchmarkEvidenceSnippets([
      ...soisContext.items.map((item) => item.text),
      ...revenueCatContext.items.map((item) => item.text),
    ]);

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

Sauce number rule:
- Default target is 1 to 2 benchmark numbers per post, not a metric dump.
- Prefer SOIS benchmarks first; only use RevenueCat when SOIS does not cover the specific point.
- Every number must be copied verbatim from the SOIS or RevenueCat evidence below.
- If relevant evidence exists, each Sauce post must include at least one benchmark number.
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
- For each post return: hook (first line), body (full post excluding CTA), cta (final action line).
- Use line breaks between subtopics so posts breathe.
- If CTA link is provided, weave it naturally into the CTA line.
- For multi-post industry news batches, anchor each post to a different news item.
- When source metadata says "others", use for structural inspiration, not voice imitation.
- Back any Adapty positioning with proof or mechanism, not empty superlatives.

Numbers: copy every number verbatim from the evidence sections in the user prompt. When a number exists in the evidence, use it. When it does not, use qualitative language ("significantly higher", "most apps"). Omit sample sizes when the evidence does not state them.

Before returning, read each post out loud in your head. Rewrite any sentence that sounds unnatural spoken.
${toBulletedSection(QUALITY_GATE_PROMPT_LINES)}
`;

    const factsPolicy = [factCheckDirective, soisDirective].filter(Boolean).join(" ");

    const memeSection = includeMemeCompanion
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
- Facts policy: ${factsPolicy} Copy numbers verbatim from the evidence sections below. When no number exists for a claim, use qualitative language.
- Details: ${input.details || "(none)"}
- CTA link: ${input.ctaLink || "(not provided)"}
- Event time: ${input.time || "(not provided)"}
- Event place: ${input.place || "(not provided)"}
- Number of posts: ${input.numberOfPosts}
- Chart: ${chartExecutionDirective} ${chartPromptSummary !== "(not provided)" ? `Summary: ${chartPromptSummary}` : ""}
- Image context: ${input.imageDataUrl ? "provided" : "(none)"}${memeSection}

Required length per post:
${lengthPlan.map((length, index) => `${index + 1}. ${length} -> ${lengthGuide(length)}`).join("\n")}

Evidence context (priority order: SOIS > RevenueCat > web). Numbers from SOIS and RevenueCat are real benchmarks — use them, they make posts more compelling. Copy numbers verbatim from the evidence below. Use each number for its labeled metric only: install_to_paid_rate as %, avg_ltv as $, price_usd as $. When a number is not in the evidence, write the sentence without it. For Sauce posts, use 1-2 benchmark numbers total per post.

1. SOIS (Adapty State of In-App Subscriptions) — fetched from dags.adpinfra.dev:
${soisEvidenceForPrompt}

2. RevenueCat (State of Subscription Apps 2025) — from revenuecat-data/*.json:
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
      postCount: number;
    }): Promise<GeneratedBatch> => {
      if (useClaudeWriter) {
        return runClaudeWriterGeneration({
          systemPrompt,
          userPrompt: params.userPrompt,
          imageDataUrl: input.imageDataUrl || undefined,
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
        postCount: input.numberOfPosts,
      });

      if (repairedBatchRun.fallbackUsed) {
        fallbackUsed = true;
        modelUsed = repairedBatchRun.modelUsed;
      }

      parsed = repairedBatchRun.parsed;
      normalizedPosts = normalizeGeneratedPosts(parsed.posts);
      qualityIssuesByPost = collectQualityIssues(normalizedPosts);
    }

    const shouldRunCodexReviewPass = useClaudeWriter && Boolean(oauthCredentials);
    const shouldRunEditorPass = qualityIssuesByPost.length > 0 || shouldRunCodexReviewPass;

    if (shouldRunEditorPass) {
      const editorPassGoals = [
        qualityIssuesByPost.length > 0
          ? "Fix the remaining quality-gate issues without changing the core argument."
          : "",
        shouldRunCodexReviewPass
          ? "Run a second-pass factual QA pass: verify benchmark numbers and metric labels against evidence, and tighten weak phrasing."
          : "",
      ]
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      const editorEvidenceBlock = `Evidence context for factual QA (SOIS > RevenueCat > web):
SOIS evidence:
${soisEvidenceForPrompt.slice(0, 2400)}

RevenueCat evidence:
${(revenueCatEvidenceForPrompt || "No RevenueCat data for this request.").slice(0, 2400)}

Web evidence:
${factCheckEvidenceForPrompt.slice(0, 1400)}`;
      const editorSystemPrompt = `You edit LinkedIn posts to sound like a real human wrote them.

Read the draft. For each sentence ask: would someone actually say this to a friend? If not, rewrite it simpler.

Hooks need soul. Soulful hooks start from a specific observation: a number, a name, a thing that happened. Soulless hooks use the "X is not Y, it's Z" template — they sound like consultant deck headlines. Rewrite soulless hooks to anchor in something concrete.

Do this:
- Start with the point. Remove sentences that only frame the next one.
- Rewrite sentences that restate themselves in two halves separated by a comma or period.
- Replace stiff phrasing with how someone would actually say it.
- Say "app makers" or "app founders" instead of "teams" or "operators."
- Use digits for numbers ("3 things" not "three things").
- Use hyphens, commas, and periods.

Fact and benchmark rules:
- Keep all facts, arguments, and structure intact.
- Keep a number only if it appears verbatim in the provided evidence context.
- When a numeric claim is unsupported, rewrite it qualitatively.
- Use each metric in its correct unit: conversion as %, LTV as currency, price as currency.
- For Sauce posts with benchmark evidence, use 1-2 benchmark numbers per post.
- Vary benchmark numbers across posts and hook suggestions.

Rewrite to concrete anchors:
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
        if (shouldRunCodexReviewPass) {
          console.info("Codex OAuth second-pass editor applied to Claude draft.");
        }
      } catch (editorError) {
        // Editor pass is best-effort; if it fails, keep the original posts
        if (shouldRunCodexReviewPass) {
          console.warn("Codex OAuth second-pass editor failed; keeping Claude draft.", editorError);
        }
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

    if (looksLikeSaucePostType(input.inputType) && sauceBenchmarkNumericClaims.size > 0) {
      const sauceHookSanitization = sanitizeHookSuggestionsNumericClaims(normalizedHooks, sauceBenchmarkNumericClaims);
      normalizedHooks = sauceHookSanitization.hooks.map((hook) => normalizeNoEmDash(hook));
      const sauceHookRepetitionSanitization = sanitizeHookNumericClaimRepetition(
        normalizedHooks,
        sauceBenchmarkNumericClaims,
        2,
      );
      normalizedHooks = sauceHookRepetitionSanitization.hooks.map((hook) => normalizeNoEmDash(hook));

      const saucePostSanitization = sanitizeGeneratedPostsNumericClaims(normalizedPosts, sauceBenchmarkNumericClaims);
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

    const shouldEnforceSauceBenchmarkAnchor =
      looksLikeSaucePostType(input.inputType) &&
      sauceBenchmarkNumericClaims.size > 0 &&
      sauceBenchmarkSnippets.length > 0;

    if (shouldEnforceSauceBenchmarkAnchor) {
      let injectedBenchmarkAnchors = 0;
      normalizedPosts = normalizedPosts.map((post, index) => {
        const combinedText = `${post.hook}\n${post.body}\n${post.cta}`;
        if (countAllowedNumericClaims(combinedText, sauceBenchmarkNumericClaims) > 0) {
          return post;
        }

        const rawSnippet = sauceBenchmarkSnippets[index % sauceBenchmarkSnippets.length];
        const compactSnippet = rawSnippet.replace(/\s+/g, " ").trim();
        const safeSnippet =
          compactSnippet.length > 220 ? `${compactSnippet.slice(0, 217).trimEnd()}...` : compactSnippet;
        const benchmarkSentence = safeSnippet.endsWith(".") ? safeSnippet : `${safeSnippet}.`;

        injectedBenchmarkAnchors += 1;
        return {
          ...post,
          body: `${post.body.trim()}\n\nBenchmark anchor: ${benchmarkSentence}`,
        };
      });

      if (injectedBenchmarkAnchors > 0) {
        const reSanitizedPostsResult = sanitizeGeneratedPostsNumericClaims(normalizedPosts, allowedNumericClaims);
        normalizedPosts = reSanitizedPostsResult.posts;
        if (reSanitizedPostsResult.unsupportedClaims.length > 0) {
          console.warn(
            `Numeric safety pass rewrote ${reSanitizedPostsResult.unsupportedClaims.length} unsupported number claim(s) after benchmark injection.`,
          );
        }
        console.warn(
          `Sauce benchmark guard injected evidence-backed numeric anchors into ${injectedBenchmarkAnchors} post(s).`,
        );
      }
    }

    if (looksLikeSaucePostType(input.inputType) && sauceBenchmarkNumericClaims.size > 0) {
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

    if (looksLikeSaucePostType(input.inputType) && sauceBenchmarkNumericClaims.size > 0) {
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

    let postsWithMemes: GeneratePostsResponse["posts"] = normalizedPosts;

    if (includeMemeCompanion) {
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
          const flowRuleSuffix = flowRule ? ` | flow: ${flowRule}` : "";
          return meaning
            ? `- ${id}: ${name} (lines: ${lineCount})${flowRuleSuffix} — ${meaning}`
            : `- ${id}: ${name} (lines: ${lineCount})${flowRuleSuffix}`;
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
3. Keep each text line concise and readable on image memes.
4. Match caption to template format and visual meaning. Do not paste style labels or meta-commentary.
5. Always include textLines array in order.
   textLines length must exactly match the selected template's line count from the catalog.
   If a template includes a flow note, follow that line-by-line order.
   For standard templates: textLines has 2 lines matching topText and bottomText.
   For templates with more slots (for example Gru, Anakin/Padme, or American Chopper): include every slot in order.
6. Joke must be funny and relevant to the post — extract the humor from the hook/body, not generic one-liners.
7. Score tone fit from 0 to 100 and explain briefly.
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

      pushMemeModelCandidate(oauthCredentials ? requestedModel : modelUsed);
      pushMemeModelCandidate(fallbackModel);
      if (oauthCredentials && memeModelCandidates.length === 0) {
        pushMemeModelCandidate("gpt-5.2");
      }

      let memeSelectionError: unknown = null;
      for (const candidateModel of memeModelCandidates) {
        try {
          parsedMemeSelection = await runMemeSelection(candidateModel);
          break;
        } catch (memeError) {
          memeSelectionError = memeError;
        }
      }

      if (!parsedMemeSelection && memeSelectionError) {
        throw memeSelectionError;
      }

      const selectionsByPostIndex = new Map<number, { variants: MemeVariantCandidate[] }>();

      for (const selection of parsedMemeSelection?.selections ?? []) {
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
        const variants = variantCandidates.map((variant, variantIndex) =>
          buildMemeCompanionFromVariant({
            rank: variantIndex + 1,
            variant,
            templateLineCount:
              templateLineCountById.get(variant.templateId.trim().toLowerCase()) ?? getKnownMemeTemplateLineCount(variant.templateId),
          }),
        );

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
        evidenceSources: {
          sois: soisContext.enabled && soisContext.items.length > 0,
          revenueCat: revenueCatContext.enabled && revenueCatContext.items.length > 0,
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
