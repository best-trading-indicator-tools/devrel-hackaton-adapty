import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { CHART_TYPE_LABELS, CHART_TYPE_OPTIONS, GOAL_LABELS, GOAL_OPTIONS, type ChartTypeOption } from "@/lib/constants";
import { createCodexStructuredCompletion } from "@/lib/codex-responses";
import { getCodexOAuthCredentials, type CodexOAuthCredentials } from "@/lib/codex-oauth";

export const runtime = "nodejs";

const chartPromptRequestSchema = z.object({
  style: z.string().trim().max(260).default("adapty"),
  goal: z.enum(GOAL_OPTIONS).default("virality"),
  inputType: z.string().trim().max(120).default(""),
  details: z.string().trim().max(3000).default(""),
  chartType: z.enum(CHART_TYPE_OPTIONS).default("doughnut"),
  chartTitle: z.string().trim().max(140).default(""),
  chartVisualStyle: z.string().trim().max(120).default("clean infographic"),
  chartLegendPosition: z.enum(["top", "right", "bottom", "left"]).default("right"),
  chartSeriesOneLabel: z.string().trim().max(120).default("Series 1"),
  chartSeriesTwoLabel: z.string().trim().max(120).default(""),
  chartLabels: z.string().trim().max(2400).default(""),
  chartSeriesOneValues: z.string().trim().max(2400).default(""),
  chartSeriesTwoValues: z.string().trim().max(2400).default(""),
});

const chartPromptResponseSchema = z.object({
  prompt: z.string().trim().min(12).max(260),
});

function normalizeNoEmDash(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function splitCsvLoose(value: string, maxItems: number): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildDatasetPreview(params: {
  chartType: ChartTypeOption;
  labels: string[];
  primaryValues: string[];
  secondaryValues: string[];
}): string {
  const rows = params.labels.map((label, index) => {
    const primaryValue = params.primaryValues[index] ?? "";
    const secondaryValue = params.secondaryValues[index] ?? "";
    const secondaryPart = secondaryValue ? `, secondary=${secondaryValue}` : "";
    return `${label}: primary=${primaryValue}${secondaryPart}`;
  });

  if (!rows.length) {
    return "(no data rows provided)";
  }

  const isRadial = params.chartType === "doughnut" || params.chartType === "pie" || params.chartType === "polarArea";
  const cappedRows = rows.slice(0, isRadial ? 8 : 10);
  return cappedRows.join(" | ");
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

async function runOpenAiPromptSuggestion(params: {
  token: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const client = getOpenAIClient(params.token);
  const completion = await client.chat.completions.parse({
    model: params.model,
    temperature: 0.7,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    response_format: zodResponseFormat(chartPromptResponseSchema, "chart_image_prompt_suggestion"),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("Model returned no parsable chart prompt suggestion.");
  }

  return parsed;
}

async function runCodexOauthPromptSuggestion(params: {
  oauth: CodexOAuthCredentials;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const responseFormat = zodResponseFormat(chartPromptResponseSchema, "chart_image_prompt_suggestion");
  const jsonSchema = responseFormat.json_schema?.schema;

  if (!jsonSchema || typeof jsonSchema !== "object") {
    throw new Error("Failed to derive JSON schema for chart prompt suggestion.");
  }

  const parsedJson = await createCodexStructuredCompletion<unknown>({
    accessToken: params.oauth.accessToken,
    accountId: params.oauth.accountId,
    model: params.model,
    instructions: params.systemPrompt,
    userInput: params.userPrompt,
    schemaName: "chart_image_prompt_suggestion",
    jsonSchema: jsonSchema as Record<string, unknown>,
    baseUrl: process.env.OPENAI_CODEX_BASE_URL,
  });

  return chartPromptResponseSchema.parse(parsedJson);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedInput = chartPromptRequestSchema.safeParse(body);

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
    const requestedModel =
      process.env.OPENAI_CHART_PROMPT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.3-codex";
    const fallbackModel = process.env.OPENAI_MODEL_FALLBACK?.trim() || "gpt-5.2";

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

    const labels = splitCsvLoose(input.chartLabels, 12);
    const primaryValues = splitCsvLoose(input.chartSeriesOneValues, 12);
    const secondaryValues = splitCsvLoose(input.chartSeriesTwoValues, 12);
    const datasetPreview = buildDatasetPreview({
      chartType: input.chartType,
      labels,
      primaryValues,
      secondaryValues,
    });
    const seriesSummary = [
      `Primary series name: ${input.chartSeriesOneLabel || "Series 1"}`,
      input.chartSeriesTwoLabel ? `Secondary series name: ${input.chartSeriesTwoLabel}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const systemPrompt = `
You write concise image-generation prompts for social media chart visuals.
Return one single prompt sentence suitable for an OpenAI image model.

Hard rules:
- Keep it 18 to 40 words.
- Focus on legibility, clean composition, and data-first clarity.
- Mention readable labels or values.
- Mention visual style direction.
- No em dash or en dash.
- No markdown, no quotes, no bullet points.
`;

    const userPrompt = `
Suggest one chart image prompt for this LinkedIn post context:
- Brand voice: ${input.style}
- Goal: ${GOAL_LABELS[input.goal]}
- Post type: ${input.inputType || "(not provided)"}
- Chart type: ${CHART_TYPE_LABELS[input.chartType]}
- Chart title: ${input.chartTitle || "(none)"}
- Legend position: ${input.chartLegendPosition}
- Visual style preference: ${input.chartVisualStyle}
- Data preview: ${datasetPreview}
- Series summary: ${seriesSummary || "(none)"}
- Extra post details: ${input.details || "(none)"}

Output JSON with field "prompt" only.
`;

    const runSuggestion = (model: string) => {
      if (oauthCredentials) {
        return runCodexOauthPromptSuggestion({
          oauth: oauthCredentials,
          model,
          systemPrompt,
          userPrompt,
        });
      }

      if (!openAiApiToken) {
        throw new Error("OpenAI API token is missing");
      }

      return runOpenAiPromptSuggestion({
        token: openAiApiToken,
        model,
        systemPrompt,
        userPrompt,
      });
    };

    let parsed;
    try {
      parsed = await runSuggestion(requestedModel);
    } catch (primaryError) {
      const canFallback = fallbackModel && fallbackModel !== requestedModel && isModelAccessError(primaryError);

      if (!canFallback) {
        throw primaryError;
      }

      parsed = await runSuggestion(fallbackModel);
    }

    return NextResponse.json({
      prompt: normalizeNoEmDash(parsed.prompt),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate chart prompt suggestion",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

