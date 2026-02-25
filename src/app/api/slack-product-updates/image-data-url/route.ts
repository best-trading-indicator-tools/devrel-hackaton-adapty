import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_DATA_URL_CHARS = 4_500_000;
const MAX_IMAGE_BYTES = 3_200_000;

function isAllowedSlackFileUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return parsed.hostname === "files.slack.com";
  } catch {
    return false;
  }
}

function normalizeImageMediaType(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes("image/png")) return "image/png";
  if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "image/jpeg";
  if (lower.includes("image/webp")) return "image/webp";
  if (lower.includes("image/gif")) return "image/gif";
  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json({ error: "Missing image URL." }, { status: 400 });
    }

    if (!isAllowedSlackFileUrl(url)) {
      return NextResponse.json(
        { error: "Only https://files.slack.com image URLs are allowed." },
        { status: 400 },
      );
    }

    const slackBotToken = process.env.SLACK_BOT_TOKEN?.trim();
    if (!slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN is not configured." }, { status: 500 });
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Slack image fetch failed (${response.status}).`,
        },
        { status: 502 },
      );
    }

    const mediaType = normalizeImageMediaType(response.headers.get("content-type") ?? "");
    if (!mediaType) {
      return NextResponse.json(
        { error: "Slack response is not a supported image type (png/jpeg/webp/gif)." },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        {
          error: "Slack image is too large. Use a smaller screenshot (<= ~3.2MB).",
        },
        { status: 413 },
      );
    }

    const dataUrl = `data:${mediaType};base64,${bytes.toString("base64")}`;
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      return NextResponse.json(
        {
          error: "Slack image data URL is too large for generation context.",
        },
        { status: 413 },
      );
    }

    return NextResponse.json({
      dataUrl,
      mediaType,
      sourceUrl: url,
      bytes: bytes.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve Slack image.",
      },
      { status: 500 },
    );
  }
}
