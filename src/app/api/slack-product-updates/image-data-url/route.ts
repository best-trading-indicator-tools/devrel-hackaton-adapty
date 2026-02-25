import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_DATA_URL_CHARS = 4_500_000;
const MAX_IMAGE_BYTES_FOR_DATA_URL = 3_200_000;
const MAX_IMAGE_BYTES_FOR_PROXY = 8_000_000;

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

type SlackImageFetchResult =
  | {
      ok: true;
      bytes: Buffer;
      mediaType: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function getSlackBotTokenOrError():
  | {
      ok: true;
      token: string;
    }
  | {
      ok: false;
      response: NextResponse;
    } {
  const slackBotToken = process.env.SLACK_BOT_TOKEN?.trim();
  if (!slackBotToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "SLACK_BOT_TOKEN is not configured." }, { status: 500 }),
    };
  }

  return {
    ok: true,
    token: slackBotToken,
  };
}

async function fetchSlackImageBytes(params: {
  url: string;
  slackBotToken: string;
  maxBytes: number;
}): Promise<SlackImageFetchResult> {
  const response = await fetch(params.url, {
    headers: {
      Authorization: `Bearer ${params.slackBotToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: `Slack image fetch failed (${response.status}).`,
    };
  }

  const mediaType = normalizeImageMediaType(response.headers.get("content-type") ?? "");
  if (!mediaType) {
    return {
      ok: false,
      status: 400,
      error: "Slack response is not a supported image type (png/jpeg/webp/gif).",
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > params.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Slack image is too large (> ${Math.round(params.maxBytes / 1_000_000)}MB).`,
    };
  }

  return {
    ok: true,
    bytes,
    mediaType,
  };
}

function parseRequestImageUrl(rawUrl: unknown): string {
  return typeof rawUrl === "string" ? rawUrl.trim() : "";
}

export async function GET(request: NextRequest) {
  try {
    const url = parseRequestImageUrl(request.nextUrl.searchParams.get("url"));

    if (!url) {
      return NextResponse.json({ error: "Missing image URL." }, { status: 400 });
    }

    if (!isAllowedSlackFileUrl(url)) {
      return NextResponse.json(
        { error: "Only https://files.slack.com image URLs are allowed." },
        { status: 400 },
      );
    }

    const tokenResult = getSlackBotTokenOrError();
    if (!tokenResult.ok) {
      return tokenResult.response;
    }

    const fetched = await fetchSlackImageBytes({
      url,
      slackBotToken: tokenResult.token,
      maxBytes: MAX_IMAGE_BYTES_FOR_PROXY,
    });
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }

    return new NextResponse(new Uint8Array(fetched.bytes), {
      status: 200,
      headers: {
        "Content-Type": fetched.mediaType,
        "Cache-Control": "private, max-age=300",
      },
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = parseRequestImageUrl(body?.url);

    if (!url) {
      return NextResponse.json({ error: "Missing image URL." }, { status: 400 });
    }

    if (!isAllowedSlackFileUrl(url)) {
      return NextResponse.json(
        { error: "Only https://files.slack.com image URLs are allowed." },
        { status: 400 },
      );
    }

    const tokenResult = getSlackBotTokenOrError();
    if (!tokenResult.ok) {
      return tokenResult.response;
    }

    const fetched = await fetchSlackImageBytes({
      url,
      slackBotToken: tokenResult.token,
      maxBytes: MAX_IMAGE_BYTES_FOR_DATA_URL,
    });
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }

    const dataUrl = `data:${fetched.mediaType};base64,${fetched.bytes.toString("base64")}`;
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
      mediaType: fetched.mediaType,
      sourceUrl: url,
      bytes: fetched.bytes.length,
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
