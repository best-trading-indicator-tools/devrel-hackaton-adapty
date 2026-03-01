import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { BRAND_VOICE_PROFILES, GOAL_DESCRIPTIONS, GOAL_LABELS, GOAL_OPTIONS, isBrandVoicePreset } from "@/lib/constants";
import { createCodexStructuredCompletion } from "@/lib/codex-responses";
import { getCodexOAuthCredentials, type CodexOAuthCredentials } from "@/lib/codex-oauth";
import { getPromptGuides } from "@/lib/prompt-guides";

export const runtime = "nodejs";

const REWRITE_INTENSITY_OPTIONS = ["light", "medium", "high"] as const;
type RewriteIntensity = (typeof REWRITE_INTENSITY_OPTIONS)[number];

const REWRITE_INTENSITY_LABELS: Record<RewriteIntensity, string> = {
  light: "Light",
  medium: "Medium",
  high: "High",
};

const REWRITE_INTENSITY_GUIDANCE: Record<RewriteIntensity, string> = {
  light:
    "Make minimal edits. Preserve wording, sentence structure, and rhythm as much as possible. Only tighten clarity and obvious awkward phrasing.",
  medium:
    "Balance preservation and improvement. Rephrase lines for stronger clarity and flow while keeping the original intent and direction.",
  high:
    "Rewrite aggressively for impact. You may substantially rephrase and restructure while preserving core meaning, factual boundaries, and requested context.",
};

const REWRITE_OPENAI_TEMPERATURE: Record<RewriteIntensity, number> = {
  light: 0.45,
  medium: 0.7,
  high: 0.85,
};

const rewriteRequestSchema = z.object({
  mode: z.enum(["post", "line"]),
  lineTarget: z.enum(["body", "cta"]).default("body"),
  rewriteIntensity: z.enum(REWRITE_INTENSITY_OPTIONS).default("medium"),
  style: z.string().trim().min(1).max(260),
  goal: z.enum(GOAL_OPTIONS),
  inputType: z.string().trim().min(1).max(120),
  ctaLink: z.string().trim().max(500).default(""),
  details: z.string().trim().max(3000).default(""),
  prompt: z.string().trim().max(1200).default(""),
  post: z.object({
    length: z.enum(["short", "medium", "long", "very long", "standard"]).transform((value) => (value === "standard" ? "medium" : value)),
    hook: z.string().trim().min(1).max(400),
    body: z.string().trim().min(1).max(5000),
    cta: z.string().trim().min(1).max(500),
  }),
  lineIndex: z.number().int().min(0).max(200).optional(),
});

const rewritePostResponseSchema = z.object({
  hook: z.string().min(8).max(320),
  body: z.string().min(40).max(4200),
  cta: z.string().min(4).max(320),
});

const rewriteLineResponseSchema = z.object({
  line: z.string().min(4).max(320),
});

const FIRST_PERSON_SINGULAR_PATTERN = /\b(i(?:'m|'d|'ll|'ve)?|me|my|mine|myself)\b/i;

function normalizeNoEmDash(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function hasFirstPersonSingularPronouns(value: string): boolean {
  return FIRST_PERSON_SINGULAR_PATTERN.test(value);
}

function enforceCompanyVoicePronouns(value: string): string {
  if (!hasFirstPersonSingularPronouns(value)) {
    return value;
  }

  return value
    .replace(/\bI(?:'|’)m\b/g, "we're")
    .replace(/\bI(?:'|’)d\b/g, "we'd")
    .replace(/\bI(?:'|’)ll\b/g, "we'll")
    .replace(/\bI(?:'|’)ve\b/g, "we've")
    .replace(/\bI am\b/gi, "we are")
    .replace(/\bmyself\b/gi, "ourselves")
    .replace(/\bmine\b/gi, "ours")
    .replace(/\bmy\b/gi, "our")
    .replace(/\bme\b/gi, "us")
    .replace(/\bI\b/g, "we");
}

function getOpenAIApiToken(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.OPENAI_ACCESS_TOKEN;
}

function getOpenAIClient(token: string): OpenAI {
  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  if (baseURL) {
    return new OpenAI({
      apiKey: token,
      baseURL,
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

function resolveBrandVoiceDirective(style: string): string {
  const normalizedStyle = style.trim().toLowerCase();

  if (isBrandVoicePreset(normalizedStyle)) {
    return BRAND_VOICE_PROFILES[normalizedStyle].promptDirective;
  }

  return `Follow custom brand voice exactly as requested: "${style.trim()}". Keep the output coherent, practical, and human sounding.`;
}

function looksLikeSaucePostType(inputType: string): boolean {
  return /\bsauce\b/i.test(inputType);
}

async function runOpenAiRewrite<T>(params: {
  token: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: z.ZodType<T>;
  schemaName: string;
}) {
  const client = getOpenAIClient(params.token);
  const completion = await client.chat.completions.parse({
    model: params.model,
    temperature: params.temperature,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    response_format: zodResponseFormat(params.responseSchema, params.schemaName),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Model returned no parsable rewrite output.");
  }

  return parsed;
}

async function runCodexOauthRewrite<T>(params: {
  oauth: CodexOAuthCredentials;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: z.ZodType<T>;
  schemaName: string;
}) {
  const responseFormat = zodResponseFormat(params.responseSchema, params.schemaName);
  const jsonSchema = responseFormat.json_schema?.schema;

  if (!jsonSchema || typeof jsonSchema !== "object") {
    throw new Error("Failed to derive JSON schema for Codex rewrite structured output");
  }

  const parsedJson = await createCodexStructuredCompletion<unknown>({
    accessToken: params.oauth.accessToken,
    accountId: params.oauth.accountId,
    model: params.model,
    instructions: params.systemPrompt,
    userInput: params.userPrompt,
    schemaName: params.schemaName,
    jsonSchema: jsonSchema as Record<string, unknown>,
    baseUrl: process.env.OPENAI_CODEX_BASE_URL,
  });

  return params.responseSchema.parse(parsedJson);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedInput = rewriteRequestSchema.safeParse(body);

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
    const rewriteIntensity = input.rewriteIntensity;
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

    const brandVoiceDirective = resolveBrandVoiceDirective(input.style);
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
    const promptDirective = input.prompt.trim()
      ? input.prompt.trim()
      : input.mode === "line"
        ? rewriteIntensity === "light"
          ? "Regenerate this line with minimal edits. Keep wording and structure close while improving clarity."
          : rewriteIntensity === "high"
            ? "Regenerate this line with a stronger rewrite. You may substantially rephrase for punch and clarity while preserving intent."
            : "Regenerate this line to be stronger, clearer, and more human while preserving intent."
        : rewriteIntensity === "light"
          ? "Rewrite the post lightly: keep structure and wording mostly intact while tightening clarity."
          : rewriteIntensity === "high"
            ? "Rewrite the post heavily for stronger clarity and engagement. You may substantially rephrase while preserving core meaning."
            : "Rewrite the post to improve quality, clarity, and engagement while preserving the core message.";

    const commonSystemPrompt = `
You rewrite LinkedIn content for Adapty.
Adapty helps app makers monetize mobile apps with subscription growth, paywall optimization, experimentation, and analytics.

Rules:
- Keep the requested brand voice, goal, and post type.
- Keep copy practical, specific, and human sounding.
- Preserve core meaning unless explicit rewrite prompt asks to change it.
- Never use em dash or en dash punctuation.
- Avoid generic AI-like cadence and buzzword filler.
- Keep claims concrete and defensible.
- Use Adapty company voice: "we", "our", and "us". Never use first-person singular pronouns ("I", "me", "my").

Rewrite intensity:
- Selected intensity: ${REWRITE_INTENSITY_LABELS[rewriteIntensity]}
- Guidance: ${REWRITE_INTENSITY_GUIDANCE[rewriteIntensity]}

Repository writing guide:
${promptGuides.writing}
${sauceDomainGuideSection}
Repository fact-check guide:
${promptGuides.factCheck}
`;

    const runRewrite = async (model: string) => {
      if (input.mode === "post") {
        const userPrompt = `
Rewrite the full LinkedIn post.

Context:
- Brand voice: ${input.style}
- Brand voice directive: ${brandVoiceDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]})
- Post type: ${input.inputType}
- Length bucket: ${input.post.length}
- CTA link to include when provided: ${input.ctaLink || "(none)"}
- Extra details: ${input.details || "(none)"}

Original post:
Hook:
${input.post.hook}

Body:
${input.post.body}

CTA:
${input.post.cta}

Rewrite instruction:
${promptDirective}

Output requirements:
- Return JSON with hook, body, cta.
- Keep the same broad length bucket (${input.post.length}).
- If CTA link exists, include it in cta.
`;

        if (oauthCredentials) {
          return runCodexOauthRewrite({
            oauth: oauthCredentials,
            model,
            systemPrompt: commonSystemPrompt,
            userPrompt,
            responseSchema: rewritePostResponseSchema,
            schemaName: "linkedin_post_rewrite",
          });
        }

        if (!openAiApiToken) {
          throw new Error("OpenAI API token is missing");
        }

        return runOpenAiRewrite({
          token: openAiApiToken,
          model,
          temperature: REWRITE_OPENAI_TEMPERATURE[rewriteIntensity],
          systemPrompt: commonSystemPrompt,
          userPrompt,
          responseSchema: rewritePostResponseSchema,
          schemaName: "linkedin_post_rewrite",
        });
      }

      const bodyLines = input.post.body.split("\n");
      const lineTarget = input.lineTarget;
      const lineIndex = input.lineIndex ?? 0;
      let selectedLine = "";
      let previousLine = "";
      let nextLine = "";
      let lineLabel = "";

      if (lineTarget === "cta") {
        selectedLine = input.post.cta;
        const previousBodyLine = [...bodyLines].reverse().find((line) => line.trim().length > 0) ?? "";
        previousLine = previousBodyLine;
        nextLine = "";
        lineLabel = "CTA line";
      } else {
        if (lineIndex < 0 || lineIndex >= bodyLines.length) {
          throw new Error("Selected line index is out of range.");
        }

        selectedLine = bodyLines[lineIndex] ?? "";
        previousLine = lineIndex > 0 ? bodyLines[lineIndex - 1] ?? "" : "";
        nextLine = lineIndex < bodyLines.length - 1 ? bodyLines[lineIndex + 1] ?? "" : "";
        lineLabel = `Body line ${lineIndex + 1}`;
      }

      const userPrompt = `
Regenerate one line of a LinkedIn post.

Context:
- Brand voice: ${input.style}
- Brand voice directive: ${brandVoiceDirective}
- Goal: ${GOAL_LABELS[input.goal]} (${GOAL_DESCRIPTIONS[input.goal]})
- Post type: ${input.inputType}
- Length bucket: ${input.post.length}
- Extra details: ${input.details || "(none)"}

Post hook:
${input.post.hook}

Line target: ${lineLabel}
Current line text:
${selectedLine}

Previous line:
${previousLine || "(none)"}

Next line:
${nextLine || "(none)"}

Rewrite instruction:
${promptDirective}

Output requirements:
- Return JSON with one field: line
- Rewrite only the selected target line
- Keep line style coherent with adjacent lines and overall post direction
- Do not include numbering, bullets, or quotes
`;

      if (oauthCredentials) {
        return runCodexOauthRewrite({
          oauth: oauthCredentials,
          model,
          systemPrompt: commonSystemPrompt,
          userPrompt,
          responseSchema: rewriteLineResponseSchema,
          schemaName: "linkedin_line_rewrite",
        });
      }

      if (!openAiApiToken) {
        throw new Error("OpenAI API token is missing");
      }

      return runOpenAiRewrite({
        token: openAiApiToken,
        model,
        temperature: REWRITE_OPENAI_TEMPERATURE[rewriteIntensity],
        systemPrompt: commonSystemPrompt,
        userPrompt,
        responseSchema: rewriteLineResponseSchema,
        schemaName: "linkedin_line_rewrite",
      });
    };

    let modelUsed = requestedModel;
    let fallbackUsed = false;
    let parsed: z.infer<typeof rewritePostResponseSchema> | z.infer<typeof rewriteLineResponseSchema>;

    try {
      parsed = await runRewrite(requestedModel);
    } catch (primaryError) {
      const canFallback =
        fallbackModel.trim().length > 0 && fallbackModel !== requestedModel && isModelAccessError(primaryError);

      if (!canFallback) {
        throw primaryError;
      }

      parsed = await runRewrite(fallbackModel);
      modelUsed = fallbackModel;
      fallbackUsed = true;
    }

    if (input.mode === "post") {
      const post = rewritePostResponseSchema.parse(parsed);
      return NextResponse.json({
        mode: "post",
        post: {
          hook: normalizeNoEmDash(enforceCompanyVoicePronouns(post.hook)),
          body: normalizeNoEmDash(enforceCompanyVoicePronouns(post.body)),
          cta: normalizeNoEmDash(enforceCompanyVoicePronouns(post.cta)),
        },
        generation: {
          modelRequested: requestedModel,
          modelUsed,
          fallbackUsed,
          authMode: oauthCredentials ? "oauth" : "api_key",
          oauthSource: oauthCredentials?.source,
        },
      });
    }

    const lineRewrite = rewriteLineResponseSchema.parse(parsed);
    return NextResponse.json({
      mode: "line",
      line: normalizeNoEmDash(enforceCompanyVoicePronouns(lineRewrite.line)),
      generation: {
        modelRequested: requestedModel,
        modelUsed,
        fallbackUsed,
        authMode: oauthCredentials ? "oauth" : "api_key",
        oauthSource: oauthCredentials?.source,
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to rewrite content",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
