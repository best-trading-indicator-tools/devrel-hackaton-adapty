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
import { buildLengthPlan, GOAL_DESCRIPTIONS, GOAL_LABELS, lengthGuide } from "@/lib/constants";
import { createCodexStructuredCompletion } from "@/lib/codex-responses";
import { getCodexOAuthCredentials, type CodexOAuthCredentials } from "@/lib/codex-oauth";
import { retrieveLibraryContext, type LibraryEntry } from "@/lib/library-retrieval";
import {
  generatePostsRequestSchema,
  makeGeneratePostsResponseSchema,
  type GeneratePostsResponse,
} from "@/lib/schemas";

export const runtime = "nodejs";

const MEME_INPUT_TYPE_PATTERN = /\b(meme|shitpost)\b/i;
const MEME_LINE_MAX_CHARS = 72;
const DEFAULT_MEME_TONE = "clever, funny, and relevant to B2C mobile app growth";
const DEFAULT_MEMEGEN_BASE_URL = "https://api.memegen.link";
const MEME_TEMPLATES = [
  { id: "drake", name: "Drake Hotline Bling" },
  { id: "woman-cat", name: "Woman Yelling at Cat" },
  { id: "spiderman", name: "Spider-Man Pointing at Spider-Man" },
  { id: "both", name: "Why Not Both?" },
  { id: "wonka", name: "Condescending Wonka" },
  { id: "buzz", name: "X Everywhere" },
  { id: "fry", name: "Futurama Fry" },
  { id: "stonks", name: "Stonks" },
] as const;
const MEME_TEMPLATE_IDS = MEME_TEMPLATES.map((template) => template.id) as [
  (typeof MEME_TEMPLATES)[number]["id"],
  ...(typeof MEME_TEMPLATES)[number]["id"][],
];
type MemeTemplateId = (typeof MEME_TEMPLATES)[number]["id"];
const MEME_TEMPLATE_NAME_BY_ID: Record<MemeTemplateId, string> = MEME_TEMPLATES.reduce(
  (acc, template) => {
    acc[template.id] = template.name;
    return acc;
  },
  {} as Record<MemeTemplateId, string>,
);

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
                templateId: z.enum(MEME_TEMPLATE_IDS),
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

function buildMemeCompanionFromVariant(params: { variant: MemeVariantCandidate; rank: number }) {
  const templateName = MEME_TEMPLATE_NAME_BY_ID[params.variant.templateId] ?? params.variant.templateId;
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
  tone: string;
}) {
  const fallbackTop = clipMemeLine(params.hook, MEME_LINE_MAX_CHARS) || "App growth team update";
  const fallbackBottom = clipMemeLine(pickMemeBottomLine(params.body), MEME_LINE_MAX_CHARS) || "Still iterating";
  const compactTone = clipMemeLine(params.tone, 48) || "clever";

  return Array.from({ length: params.variantCount }, (_, variantIndex) => {
    const template = MEME_TEMPLATES[(params.index + variantIndex) % MEME_TEMPLATES.length];
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
        templateId: template.id,
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
}) {
  const responseFormat = zodResponseFormat(params.responseSchema, "meme_variants_batch");
  const jsonSchema = responseFormat.json_schema?.schema;

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
      input.hookStyle,
      input.inputType,
      preparedChartInput ? `chart:${preparedChartInput.type}` : "",
      preparedChartInput?.title ?? "",
      input.memeTone,
      input.memeBrief,
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

    const isAdaptyVoice = input.style.trim().toLowerCase() === "adapty";
    const brandVoiceDirective = isAdaptyVoice
      ? "Selected brand voice is Adapty. Treat the provided linkedin-adapty-library examples as the canonical style guide and mirror their tone, rhythm, formatting, and storytelling style as closely as possible while keeping copy original."
      : `Selected brand voice is "${input.style}". Follow that voice while still leveraging the winning structures from the provided library examples.`;
    const isClickbaitHookStyle = input.hookStyle.trim().toLowerCase() === "clickbait";
    const hookStyleDirective = isClickbaitHookStyle
      ? 'Use clickbait-style hooks with curiosity gaps and tension, while keeping all claims truthful and specific.'
      : `Use "${input.hookStyle}" as the hook style for both hook suggestions and each post opening line.`;
    const goalExecutionDirective =
      input.goal === "virality"
        ? "For virality, say the uncomfortable obvious truth your audience already suspects but rarely says out loud. Make it specific, defensible, and useful."
        : "Prioritize the selected goal while staying concrete, credible, and practical.";
    const chartExecutionDirective = preparedChartInput
      ? "Chart companion is enabled. Ground the narrative in the provided chart values and call out one or two concrete numbers naturally."
      : "No chart companion requested.";
    const chartPromptSummary = preparedChartInput ? summarizeChartForPrompt(preparedChartInput) : "(not provided)";
    const memeTonePreference = input.memeTone.trim() || DEFAULT_MEME_TONE;
    const memeBriefPreference = input.memeBrief.trim();
    const memeVariantTarget = input.memeVariantCount;
    const memeExecutionDirective = shouldGenerateMemes(input.inputType)
      ? "This is a meme-focused request. Keep hooks and first body lines short, punchy, and caption-friendly. If no meme brief is provided, come up with clever and funny angles automatically."
      : "Not a meme-focused request.";

    const responseSchema = makeGeneratePostsResponseSchema(input.numberOfPosts);

    const systemPrompt = `
You create LinkedIn content at scale for Adapty.
Adapty enables app makers to monetize their mobile apps with subscription growth, paywall optimization, experimentation, and analytics.
You write high-performing LinkedIn content for B2B SaaS growth teams.
The voice must feel sharp, clear, and practical, with strong hooks and concise storytelling.
Never use generic fluff.

Rules:
1. Keep the tone aligned with the requested brand voice.
2. Optimize for the requested goal.
3. Respect requested post type and input details.
4. Create hook suggestions that are punchy, specific, and scroll-stopping.
5. For each post, produce:
   - hook: the first line
   - body: the full post content excluding the final CTA line
   - cta: final line for action
6. Use line breaks to improve readability.
7. Avoid overusing emojis and hashtags.
8. If a CTA link is provided, include it in the CTA line.
9. Use the performance insights and recurring winning patterns when available.
10. If the selected brand voice is "Adapty", closely imitate the exact style and tone from the provided linkedin-adapty-library examples.
11. Never use em dash or en dash punctuation. Use commas, periods, colons, semicolons, or normal hyphen instead.
12. Apply the requested hook style to the hook suggestion list and to each post hook line.
13. Examples are tagged with source metadata. If source is "others", use them for topic angles and winning structures, not for final brand tone.
`;

    const userPrompt = `
Generation request:
- Brand voice: ${input.style}
- Brand voice directive: ${brandVoiceDirective}
- Hook style: ${input.hookStyle}
- Hook style directive: ${hookStyleDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]})
- Goal execution directive: ${goalExecutionDirective}
- Chart execution directive: ${chartExecutionDirective}
- Chart summary: ${chartPromptSummary}
- Meme execution directive: ${memeExecutionDirective}
- Meme tone preference: ${memeTonePreference}
- Meme brief: ${memeBriefPreference || "(not provided, use clever/funny defaults)"}
- Meme variants per post target: ${memeVariantTarget}
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

Also generate a list of hook suggestions inspired by this style and request.
`;

    const runGeneration = (model: string) => {
      if (oauthCredentials) {
        return runCodexOauthGeneration({
          oauth: oauthCredentials,
          model,
          systemPrompt,
          userPrompt,
          imageDataUrl: input.imageDataUrl || undefined,
          responseSchema,
        });
      }

      if (!openAiApiToken) {
        throw new Error("OpenAI API token is missing");
      }

      return runOpenAiChatGeneration({
        token: openAiApiToken,
        model,
        systemPrompt,
        userPrompt,
        imageDataUrl: input.imageDataUrl || undefined,
        responseSchema,
      });
    };

    let modelUsed = requestedModel;
    let fallbackUsed = false;

    let parsed;

    try {
      parsed = await runGeneration(requestedModel);
    } catch (primaryError) {
      const canFallback =
        fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError);

      if (!canFallback) {
        throw primaryError;
      }

      parsed = await runGeneration(fallbackModel);
      modelUsed = fallbackModel;
      fallbackUsed = true;
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
      const memeSelectionSchema = makeMemeSelectionResponseSchema(normalizedPosts.length, memeVariantTarget);
      const memeTemplateCatalog = MEME_TEMPLATES.map((template) => `- ${template.id}: ${template.name}`).join("\n");
      const memeSelectionSystemPrompt = `
You are selecting meme templates and caption lines for LinkedIn meme posts.
You must choose only from the provided template IDs and produce ranked variants.
Optimize for tone fit and humor quality while staying relevant to B2C mobile apps and monetization.
Never use em dash punctuation. Use standard hyphen if needed.
`;
      const memeSelectionUserPrompt = `
Meme selection request:
- Tone preference: ${memeTonePreference}
- Meme brief: ${memeBriefPreference || "(none provided - come up with a clever and funny angle automatically)"}
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
2. Vary templates across variants when possible.
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
        const variants =
          modelVariants?.length === memeVariantTarget
            ? modelVariants.map((variant, variantIndex) =>
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
                tone: memeTonePreference,
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
        chartCompanion = await renderChartCompanion(preparedChartInput);
      } catch (chartRenderError) {
        const message =
          chartRenderError instanceof Error
            ? chartRenderError.message
            : "Chart rendering failed for the provided chart data/options.";

        return NextResponse.json(
          {
            error: "Chart rendering failed",
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
