import { z } from "zod";

import {
  CHART_TYPE_OPTIONS,
  GOAL_OPTIONS,
  INPUT_LENGTH_OPTIONS,
  type ChartTypeOption,
  type ContentGoal,
  type MemeTemplateId,
} from "@/lib/constants";

const inputLengthSchema = z
  .preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalized = value.trim().toLowerCase();
      return normalized === "standard" ? "medium" : normalized;
    },
    z.enum(INPUT_LENGTH_OPTIONS),
  )
  .default("medium");

const outputLengthSchema = z
  .enum(["short", "medium", "long", "very long", "standard"])
  .transform((value) => (value === "standard" ? "medium" : value));

export const generatePostsRequestSchema = z.object({
  style: z.string().trim().min(1).max(260).default("adapty"),
  goal: z.enum(GOAL_OPTIONS).default("virality"),
  inputType: z.string().trim().min(1).max(120),
  chartEnabled: z.coerce.boolean().default(false),
  chartType: z.enum(CHART_TYPE_OPTIONS).default("doughnut"),
  chartTitle: z.string().trim().max(140).default(""),
  chartVisualStyle: z.string().trim().max(120).default("clean infographic"),
  chartImagePrompt: z.string().trim().max(1200).default(""),
  chartData: z.string().trim().max(20_000).default(""),
  chartOptions: z.string().trim().max(20_000).default(""),
  memeBrief: z.string().trim().max(400).default(""),
  memeTemplateIds: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9-]+$/i, "memeTemplateIds entries must use letters, numbers, and hyphen only"),
    )
    .max(30)
    .default([]),
  memeVariantCount: z.coerce.number().int().min(1).max(6).default(3),
  time: z.string().trim().max(120).default(""),
  place: z.string().trim().max(120).default(""),
  ctaLink: z.string().trim().max(500).default(""),
  imageDataUrl: z
    .string()
    .trim()
    .max(4_500_000)
    .default("")
    .refine((value) => !value || /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value), {
      message: "imageDataUrl must be a base64 data URL for an image",
    }),
  inputLength: inputLengthSchema,
  numberOfPosts: z.coerce.number().int().min(1).max(12).default(3),
  details: z.string().trim().max(3000).default(""),
});

export type GeneratePostsRequest = z.infer<typeof generatePostsRequestSchema>;

export function makeGeneratePostsResponseSchema(postCount: number) {
  return z.object({
    hooks: z.array(z.string().min(8).max(220)).min(Math.max(5, postCount)).max(20),
    posts: z
      .array(
        z.object({
          length: outputLengthSchema,
          hook: z.string().min(8).max(280),
          body: z.string().min(40).max(3500),
          cta: z.string().min(4).max(320),
        }),
      )
      .length(postCount),
  });
}

export type GeneratePostsResponse = {
  hooks: string[];
  chart?: {
    type: ChartTypeOption;
    title: string;
    visualStyle?: string;
    imagePrompt?: string;
    imageDataUrl: string;
    width: number;
    height: number;
    labelsCount: number;
    datasetCount: number;
  };
  posts: Array<{
    length: "short" | "medium" | "long" | "very long";
    hook: string;
    body: string;
    cta: string;
    meme?: {
      rank: number;
      templateId: MemeTemplateId;
      templateName: string;
      topText: string;
      bottomText: string;
      url: string;
      toneFitScore?: number;
      toneFitReason?: string;
    };
    memeVariants?: Array<{
      rank: number;
      templateId: MemeTemplateId;
      templateName: string;
      topText: string;
      bottomText: string;
      url: string;
      toneFitScore?: number;
      toneFitReason?: string;
    }>;
  }>;
  generation: {
    modelRequested: string;
    modelUsed: string;
    fallbackUsed: boolean;
    baseUrlType: "openai" | "custom";
    authMode: "oauth" | "api_key";
    oauthSource?: "env" | "codex-auth-json";
  };
  retrieval: {
    method: "lexical" | "lancedb";
    goalUsed: ContentGoal;
    examplesUsed: number;
    performancePostsAnalyzed: number;
    performanceInsightsUsed: number;
  };
};
