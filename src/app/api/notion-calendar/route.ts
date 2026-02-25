import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import type { NotionCalendarData } from "@/lib/notion-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "notion-calendar.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as NotionCalendarData;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { syncedAt: "", entries: [] } satisfies NotionCalendarData,
      { status: 200 }
    );
  }
}
