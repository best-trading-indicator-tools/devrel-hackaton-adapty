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
import { runWebFactCheck } from "@/lib/fact-check";
import { retrieveLibraryContext, type LibraryEntry } from "@/lib/library-retrieval";
import { getPromptGuides } from "@/lib/prompt-guides";
import { runIndustryNewsContext } from "@/lib/rss-news";
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
const INDUSTRY_NEWS_REACTION_PATTERN = /\bindustry news reaction\b/i;

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

const LINKEDIN_WRITING_CONTRACT = [
  "Write like a cohesive mini-article, not stacked slogans.",
  "Use line breaks for readability. One sentence per line when practical, and add blank lines between subtopics.",
  "Keep paragraph rhythm human, usually 2 to 5 sentences before a blank line.",
  "Do not stack ultra-short lines back-to-back. Avoid rap or poem cadence.",
  "Mix short, medium, and long sentence lengths so rhythm feels human.",
  "Avoid internet template cadence and motivational filler patterns.",
  "Avoid MBA buzzword fog. Prefer concrete verbs, nouns, and mechanics.",
  "Include at least one concrete proof unit per post, such as a number, metric, micro-example, or specific scenario.",
  "Include caveats and boundary conditions like most, unless, in practice, or for this category.",
  "Prefer lived perspective lines where relevant, such as I saw, from what I see, or we tested.",
  "Occasional ellipses are acceptable as human texture, but keep them rare and clear.",
  "No separator lines like _____, ---, or ***.",
  "Never leak meta text such as assistant, final, json, or planning notes.",
  "Never use em dash or en dash punctuation. Use commas, periods, colons, semicolons, or normal hyphen.",
] as const;

const POST_TYPE_PLAYBOOKS: Array<{ pattern: RegExp; directive: string }> = [
  {
    pattern: /event|webinar/i,
    directive:
      "Lead with why this event matters now, then provide concrete logistics, who should attend, and what they will learn.",
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

const HARD_QUALITY_GATE = [
  "Silently self-check every output before finalizing.",
  "If any rule fails, rewrite and self-check again before returning.",
  "Reject generic template cadence, staccato short-line stacks, and abstract filler.",
  "Reject outputs without concrete proof units and without caveats.",
  "Reject any sentence containing em dash or en dash punctuation.",
  "For factual claims: if web evidence is available, align to it. If evidence is missing, rewrite as opinion or observation and avoid unsupported hard facts.",
] as const;

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

  if (isBrandVoicePreset(normalizedStyle)) {
    return BRAND_VOICE_PROFILES[normalizedStyle].promptDirective;
  }

  return `Follow custom brand voice exactly as requested: "${style.trim()}". Keep the output coherent, practical, and human sounding.`;
}

function resolveAutoHookDirective(params: { style: string; inputType: string; goal: ContentGoal }): string {
  const styleKey = params.style.trim().toLowerCase();
  const typeKey = params.inputType.trim().toLowerCase();

  const styleDirective = (() => {
    if (styleKey === "clickbait") {
      return "Use high-curiosity hook framing with clear stakes, while keeping claims truthful and specific.";
    }
    if (styleKey === "founder personal") {
      return "Use founder-style hooks that sound lived, practical, and grounded in real operating pain.";
    }
    if (styleKey === "bold / contrarian") {
      return "Use contrarian hooks that challenge common assumptions, then make them defensible.";
    }
    if (styleKey === "technical breakdown") {
      return "Use mechanism-first hooks with concrete signal words like conversion, retention, paywall, trial, and revenue.";
    }
    if (styleKey === "playful meme tone") {
      return "Use witty, internet-native hooks with clear product-growth relevance.";
    }
    return "Use hooks aligned with the selected brand voice and grounded in concrete operator pain points.";
  })();

  const postTypeDirective = (() => {
    if (/event|webinar/.test(typeKey)) {
      return "For event or webinar posts, hooks should connect a real market pain to why attending is worth the time now.";
    }
    if (/sauce/.test(typeKey)) {
      return "For Sauce posts, hooks should open with a hard question, friction point, or surprising operating truth.";
    }
    if (/meme|shitpost/.test(typeKey)) {
      return "For meme posts, hooks should be short, punchy, and caption-friendly.";
    }
    if (/case study|social proof/.test(typeKey)) {
      return "For case study posts, hooks should tease a specific before-after outcome.";
    }
    if (/poll|quiz|engagement farming/.test(typeKey)) {
      return "For poll or quiz posts, hooks should ask a concrete, vote-worthy question.";
    }
    return "Hooks should match the requested post type and be immediately clear to the target audience.";
  })();

  const goalDirective = (() => {
    if (params.goal === "virality") {
      return "Prioritize scroll-stopping hooks that say the uncomfortable obvious truth in a useful way.";
    }
    if (params.goal === "engagement") {
      return "Prioritize discussion-driving hooks that invite thoughtful replies.";
    }
    if (params.goal === "traffic") {
      return "Prioritize value-tease hooks that naturally motivate qualified clicks.";
    }
    if (params.goal === "awareness") {
      return "Prioritize clear, memorable hooks for broad audience recall.";
    }
    return "Balance reach, clarity, and action intent in hook phrasing.";
  })();

  return `${styleDirective} ${postTypeDirective} ${goalDirective}`;
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
    temperature: 0.8,
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
    const retrievalQuery = [
      input.goal,
      input.style,
      input.inputType,
      preparedChartInput ? `chart:${preparedChartInput.type}` : "",
      preparedChartInput?.title ?? "",
      preparedChartInput?.visualStyle ?? "",
      preparedChartInput?.imagePrompt ?? "",
      input.memeBrief,
      input.memeTemplateIds.length ? `templates:${input.memeTemplateIds.join(",")}` : "",
      input.time,
      input.place,
      input.details,
    ]
      .filter(Boolean)
      .join(" | ");

    const retrieval = await retrieveLibraryContext({
      client: getEmbeddingClient(),
      query: retrievalQuery,
      limit: Math.min(12, Math.max(6, input.numberOfPosts * 3)),
      goal: input.goal,
    });

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
    const memeTemplatePreferences = Array.from(
      new Set(
        input.memeTemplateIds
          .map((id) => id.trim().toLowerCase())
          .filter((id): id is MemeTemplateId => Boolean(id)),
      ),
    );
    const memeVariantTarget = input.memeVariantCount;
    const memeExecutionDirective = shouldGenerateMemes(input.inputType)
      ? "This is a meme-focused request. Keep hooks and first body lines short, punchy, and caption-friendly. If no meme brief is provided, come up with clever and funny angles automatically."
      : "Not a meme-focused request.";
    const webFactCheck = await runWebFactCheck({
      style: input.style,
      goal: input.goal,
      inputType: input.inputType,
      details: input.details,
      time: input.time,
      place: input.place,
      ctaLink: input.ctaLink,
    });
    const industryNewsContext = await runIndustryNewsContext({
      style: input.style,
      goal: input.goal,
      inputType: input.inputType,
      details: input.details,
    });
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
    const industryNewsStatusSummary = industryNewsContext.enabled
      ? industryNewsContext.warning
        ? `enabled with warning: ${industryNewsContext.warning} (feeds ok: ${industryNewsContext.feedsSucceeded}/${industryNewsContext.feedsAttempted})`
        : `enabled (feeds ok: ${industryNewsContext.feedsSucceeded}/${industryNewsContext.feedsAttempted})`
      : "disabled";
    const webEvidenceLines = webFactCheck.evidenceLines
      .slice(0, FACT_CHECK_EVIDENCE_PROMPT_LIMIT)
      .map((line) => normalizeNoEmDash(line));
    const factCheckDirective = webEvidenceLines.length
      ? "Web evidence is available. For factual claims, stay consistent with the evidence context and avoid unsupported new hard facts."
      : "Web evidence is unavailable or empty. Do not invent hard facts. Rewrite uncertain factual claims as opinion, observation, or hypothesis.";
    const factCheckStatusSummary = webFactCheck.enabled
      ? webFactCheck.warning
        ? `enabled (${webFactCheck.provider}) with warning: ${webFactCheck.warning}`
        : `enabled (${webFactCheck.provider})`
      : webFactCheck.warning || "disabled";
    const factCheckQueriesSummary = webFactCheck.queries.length
      ? webFactCheck.queries.map((query, index) => `${index + 1}. ${normalizeNoEmDash(query)}`).join("\n")
      : "(none)";
    const factCheckEvidenceForPrompt = webEvidenceLines.length
      ? webEvidenceLines.join("\n")
      : "No live web evidence available for this request.";

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

    const systemPrompt = `
You create LinkedIn content at scale for Adapty.
Adapty enables app makers to monetize their mobile apps with subscription growth, paywall optimization, experimentation, and analytics.
Mission:
- Create high-performing LinkedIn posts for B2B SaaS growth teams.
- Keep voice sharp, clear, practical, and human sounding.
- Never output generic fluff.

Global writing contract:
${toBulletedSection(LINKEDIN_WRITING_CONTRACT)}

Repository writing guide:
${promptGuides.writing}
${sauceDomainGuideSection}
Repository fact-check guide:
${promptGuides.factCheck}

Output contract:
- Tone must follow requested brand voice.
- Execution must follow requested goal and post type.
- Hook suggestions must be punchy, specific, and scroll-stopping.
- For each post return:
  - hook: first line
  - body: full post text excluding final CTA line
  - cta: final action line
- For industry news reaction batches with multiple posts, use different primary news topics across posts when multiple items are provided.
- Use line breaks for readability.
- Avoid overusing emojis and hashtags.
- If CTA link is provided, include it naturally in the CTA line.
- Use performance insights and recurring winning patterns when available.
- Examples are tagged with source metadata. If source is "others", use for angle discovery and winning structures, not final Adapty voice imitation.

Quality gate before final answer:
${toBulletedSection(HARD_QUALITY_GATE)}
`;

    const userPrompt = `
Generation request:
- Brand voice: ${input.style}
- Brand voice directive: ${brandVoiceDirective}
- Hook directive: ${autoHookDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]})
- Goal execution directive: ${goalExecutionDirective}
- Post type execution directive: ${postTypeDirective}
- Industry news execution directive: ${industryNewsExecutionDirective}
- Industry news status: ${industryNewsStatusSummary}
- Chart execution directive: ${chartExecutionDirective}
- Chart summary: ${chartPromptSummary}
- Meme execution directive: ${memeExecutionDirective}
- Meme tone profile (auto-inferred): ${memeToneProfile}
- Meme brief: ${memeBriefPreference || "(not provided, use clever/funny defaults)"}
- Meme template preferences: ${memeTemplatePreferences.length ? memeTemplatePreferences.join(", ") : "auto"}
- Meme variants per post target: ${memeVariantTarget}
- Fact-check policy: ${factCheckDirective}
- Fact-check status: ${factCheckStatusSummary}
- Fact-check queries:
${factCheckQueriesSummary}
- Post type: ${input.inputType}
- Event time: ${input.time || "(not provided)"}
- Event place: ${input.place || "(not provided)"}
- CTA link: ${input.ctaLink || "(not provided)"}
- Attached image context: ${input.imageDataUrl ? "provided" : "(none)"}
- Number of posts: ${input.numberOfPosts}
- Additional details: ${input.details || "(none)"}

Required length per post in order:
${lengthPlan.map((length, index) => `${index + 1}. ${length} -> ${lengthGuide(length)}`).join("\n")}

Use the following high-performing library examples as stylistic inspiration:
${examplesForPrompt || "No library examples available."}

Performance insights extracted from your historical posts:
${performanceInsightsForPrompt}

Web fact-check evidence context:
${factCheckEvidenceForPrompt}

Ranked RSS context for industry news reactions:
${industryNewsContextSummary}

Per-post industry topic plan (follow post order when provided):
${industryNewsTopicPlanSummary}

Also generate a list of hook suggestions inspired by this style and request.
`;

    type GeneratedPost = {
      length: "short" | "medium" | "long" | "very long";
      hook: string;
      body: string;
      cta: string;
    };

    type GeneratedBatch = {
      hooks: string[];
      posts: GeneratedPost[];
    };

    const runGeneration = (params: {
      model: string;
      userPrompt: string;
      responseSchema: ReturnType<typeof makeGeneratePostsResponseSchema>;
    }): Promise<GeneratedBatch> => {
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

    let modelUsed = requestedModel;
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
      modelUsed = batchRun.modelUsed;
      fallbackUsed = batchRun.fallbackUsed;
    }

    const includeMemeCompanion = shouldGenerateMemes(input.inputType);
    const normalizedPosts = parsed.posts.map((post, index) => ({
      length: lengthPlan[index] ?? post.length,
      hook: normalizeNoEmDash(post.hook),
      body: normalizeNoEmDash(post.body),
      cta: normalizeNoEmDash(ensureFinalCta(post.cta, input.ctaLink)),
    }));

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
      const memeTemplateCatalog = MEME_TEMPLATE_OPTIONS.filter((template) =>
        allowedTemplateIds.includes(template.id),
      )
        .map((template) => `- ${template.id}: ${template.name}`)
        .join("\n");
      const memeSelectionSystemPrompt = `
You are selecting meme templates and caption lines for LinkedIn meme posts.
You must choose only from the provided template IDs and produce ranked variants.
Optimize for tone fit and humor quality while staying relevant to B2C mobile apps and monetization.
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
4. Score tone fit from 0 to 100 and explain briefly.
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
      hooks: parsed.hooks.map((hook) => normalizeNoEmDash(hook)),
      chart: chartCompanion,
      posts: postsWithMemes,
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
