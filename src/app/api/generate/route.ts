import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

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

function formatExampleMetrics(entry: LibraryEntry): string {
  if (!entry.performance) {
    return "";
  }

  const parts: string[] = [];

  if (typeof entry.performance.impressions === "number") {
    parts.push(`impressions: ${entry.performance.impressions.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance.likes === "number") {
    parts.push(`likes: ${entry.performance.likes.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance.comments === "number") {
    parts.push(`comments: ${entry.performance.comments.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance.reposts === "number") {
    parts.push(`reposts: ${entry.performance.reposts.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance.clicks === "number") {
    parts.push(`clicks: ${entry.performance.clicks.toLocaleString("en-US")}`);
  }
  if (typeof entry.performance.ctr === "number") {
    parts.push(`ctr: ${(entry.performance.ctr * 100).toFixed(2)}%`);
  }
  if (typeof entry.performance.engagementRate === "number") {
    parts.push(`engagement: ${(entry.performance.engagementRate * 100).toFixed(2)}%`);
  }

  return parts.length ? ` [${parts.join(" | ")}]` : "";
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
    const retrievalQuery = [input.goal, input.style, input.inputType, input.time, input.place, input.details]
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
      .map((entry, index) => `Example ${index + 1}${formatExampleMetrics(entry)}:\n${entry.text.slice(0, 1600)}`)
      .join("\n\n---\n\n");

    const performanceInsightsForPrompt = retrieval.performanceInsights?.summaryLines?.length
      ? retrieval.performanceInsights.summaryLines.map((line, index) => `${index + 1}. ${line}`).join("\n")
      : "No performance metrics were provided in the content library.";

    const isAdaptyVoice = input.style.trim().toLowerCase() === "adapty";
    const brandVoiceDirective = isAdaptyVoice
      ? "Selected brand voice is Adapty. Treat the provided linkedin-library examples as the canonical style guide and mirror their tone, rhythm, formatting, and storytelling style as closely as possible while keeping copy original."
      : `Selected brand voice is "${input.style}". Follow that voice while still leveraging the winning structures from the provided library examples.`;

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
10. If the selected brand voice is "Adapty", closely imitate the exact style and tone from the provided linkedin-library examples.
`;

    const userPrompt = `
Generation request:
- Brand voice: ${input.style}
- Brand voice directive: ${brandVoiceDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]})
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

    const response: GeneratePostsResponse = {
      hooks: parsed.hooks,
      posts: parsed.posts.map((post, index) => ({
        length: lengthPlan[index] ?? post.length,
        hook: post.hook,
        body: post.body,
        cta: ensureFinalCta(post.cta, input.ctaLink),
      })),
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
