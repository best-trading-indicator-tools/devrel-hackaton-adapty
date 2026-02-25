import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import type { SlackProductUpdatesData } from "@/lib/slack-product-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "slack-product-updates.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as SlackProductUpdatesData;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { syncedAt: "", channel: "#product-release", entries: [] } satisfies SlackProductUpdatesData,
      { status: 200 }
    );
  }
}
