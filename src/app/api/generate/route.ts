import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import { buildLengthPlan, lengthGuide } from "@/lib/constants";
import { retrieveLibraryContext } from "@/lib/library-retrieval";
import {
  generatePostsRequestSchema,
  makeGeneratePostsResponseSchema,
  type GeneratePostsResponse,
} from "@/lib/schemas";

export const runtime = "nodejs";

function getApiToken(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.OPENAI_OAUTH_TOKEN ?? process.env.OPENAI_ACCESS_TOKEN;
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

function isModelAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("unknown model") ||
    message.includes("invalid model")
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

export async function POST(request: Request) {
  try {
    const token = getApiToken();
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Missing OpenAI credentials. Set OPENAI_API_KEY (or OPENAI_OAUTH_TOKEN / OPENAI_ACCESS_TOKEN).",
        },
        { status: 500 },
      );
    }

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
    const { client, usingCustomBaseUrl } = getOpenAIClient(token);

    const lengthPlan = buildLengthPlan(input.inputLength, input.numberOfPosts);
    const retrievalQuery = [input.style, input.inputType, input.time, input.place, input.details]
      .filter(Boolean)
      .join(" | ");

    const retrieval = await retrieveLibraryContext({
      client,
      query: retrievalQuery,
      limit: Math.min(12, Math.max(6, input.numberOfPosts * 3)),
    });

    const examplesForPrompt = retrieval.entries
      .slice(0, 10)
      .map((entry, index) => `Example ${index + 1}:\n${entry.text.slice(0, 1600)}`)
      .join("\n\n---\n\n");

    const responseSchema = makeGeneratePostsResponseSchema(input.numberOfPosts);

    const systemPrompt = `
You write high-performing LinkedIn content for B2B SaaS growth teams.
The voice must feel sharp, clear, and practical, with strong hooks and concise storytelling.
Never use generic fluff.

Rules:
1. Keep the tone aligned with the requested brand style.
2. Respect requested post type and input details.
3. Create hook suggestions that are punchy, specific, and scroll-stopping.
4. For each post, produce:
   - hook: the first line
   - body: the full post content excluding the final CTA line
   - cta: final line for action
5. Use line breaks to improve readability.
6. Avoid overusing emojis and hashtags.
7. If a CTA link is provided, include it in the CTA line.
`;

    const userPrompt = `
Generation request:
- Brand style: ${input.style}
- Post type: ${input.inputType}
- Event time: ${input.time || "(not provided)"}
- Event place: ${input.place || "(not provided)"}
- CTA link: ${input.ctaLink || "(not provided)"}
- Number of posts: ${input.numberOfPosts}
- Additional details: ${input.details || "(none)"}

Required length per post in order:
${lengthPlan.map((length, index) => `${index + 1}. ${length} -> ${lengthGuide(length)}`).join("\n")}

Use the following high-performing library examples as stylistic inspiration:
${examplesForPrompt || "No library examples available."}

Also generate a list of hook suggestions inspired by this style and request.
`;

    const runGeneration = async (model: string) =>
      client.chat.completions.parse({
        model,
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: zodResponseFormat(responseSchema, "linkedin_post_batch"),
      });

    let modelUsed = requestedModel;
    let fallbackUsed = false;

    let completion;

    try {
      completion = await runGeneration(requestedModel);
    } catch (primaryError) {
      const canFallback =
        fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError);

      if (!canFallback) {
        throw primaryError;
      }

      completion = await runGeneration(fallbackModel);
      modelUsed = fallbackModel;
      fallbackUsed = true;
    }

    const parsed = completion.choices[0]?.message.parsed;

    if (!parsed) {
      return NextResponse.json(
        {
          error: "Model returned no parsable output.",
        },
        { status: 502 },
      );
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
        baseUrlType: usingCustomBaseUrl ? "custom" : "openai",
      },
      retrieval: {
        method: retrieval.method,
        examplesUsed: retrieval.entries.length,
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
