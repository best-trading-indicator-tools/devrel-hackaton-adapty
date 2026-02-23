import { z } from "zod";

import { INPUT_LENGTH_OPTIONS } from "@/lib/constants";

export const generatePostsRequestSchema = z.object({
  style: z.string().trim().min(1).max(80).default("adapty"),
  inputType: z.string().trim().min(1).max(120),
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
  inputLength: z.enum(INPUT_LENGTH_OPTIONS).default("standard"),
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
          length: z.enum(["short", "standard", "long"]),
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
  posts: Array<{
    length: "short" | "standard" | "long";
    hook: string;
    body: string;
    cta: string;
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
    examplesUsed: number;
    performancePostsAnalyzed: number;
    performanceInsightsUsed: number;
  };
};
