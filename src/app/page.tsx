"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";

import { RSS_FEEDS, type FeedCategory, type RssFeed } from "@/config/rss-feeds";
import {
  BRAND_VOICE_PRESETS,
  BRAND_VOICE_PROFILES,
  CHART_TYPE_LABELS,
  CHART_TYPE_OPTIONS,
  GOAL_LABELS,
  GOAL_UI_DESCRIPTIONS,
  GOAL_OPTIONS,
  INPUT_LENGTH_OPTIONS,
  MEME_TEMPLATE_LABELS,
  MEME_TEMPLATE_OPTIONS,
  POST_TYPE_UI_DESCRIPTIONS,
  POST_TYPE_OPTIONS,
  isBrandVoicePreset,
  type ChartTypeOption,
  type ContentGoal,
  type InputLength,
  type MemeTemplateId,
} from "@/lib/constants";
import {
  getEntriesForMonth,
  type NotionCalendarData,
  type NotionCalendarEntry,
} from "@/lib/notion-calendar";
import type { SlackProductUpdateEntry, SlackProductUpdatesData } from "@/lib/slack-product-updates";
import type { GeneratePostsResponse } from "@/lib/schemas";

type ChartLegendPosition = "top" | "right" | "bottom" | "left";
type CtaLinkMode = "shared" | "per_post";

type FormState = {
  style: string;
  goal: ContentGoal;
  inputType: string;
  createXPosts: boolean;
  chartEnabled: boolean;
  chartType: ChartTypeOption;
  chartTitle: string;
  chartVisualStyle: string;
  chartImagePrompt: string;
  chartLabels: string;
  chartSeriesOneLabel: string;
  chartSeriesOneValues: string;
  chartSeriesTwoLabel: string;
  chartSeriesTwoValues: string;
  chartLegendPosition: ChartLegendPosition;
  memeEnabled: boolean;
  memeBrief: string;
  giphyEnabled: boolean;
  giphyQuery: string;
  memeTemplateIds: MemeTemplateId[];
  memeVariantCount: number;
  time: string;
  place: string;
  ctaLink: string;
  imageDataUrl: string;
  inputLength: InputLength;
  numberOfPosts: number;
  details: string;
};

type GeneratedPost = GeneratePostsResponse["posts"][number];
type MemeCompanion = NonNullable<GeneratedPost["meme"]>;
type GiphyCompanion = NonNullable<GeneratedPost["giphy"]>;
type CopyAction = "post_images" | "x_thread" | "memes" | "giphy" | "everything";

const defaultForm: FormState = {
  style: "adapty",
  goal: "virality",
  inputType: POST_TYPE_OPTIONS[1],
  createXPosts: false,
  chartEnabled: false,
  chartType: "doughnut",
  chartTitle: "",
  chartVisualStyle: "clean infographic",
  chartImagePrompt: "",
  chartLabels: "Without trial, With paid trial, With free trial",
  chartSeriesOneLabel: "Share %",
  chartSeriesOneValues: "56.9, 28.9, 14.3",
  chartSeriesTwoLabel: "",
  chartSeriesTwoValues: "",
  chartLegendPosition: "right",
  memeEnabled: false,
  memeBrief: "",
  giphyEnabled: false,
  giphyQuery: "",
  memeTemplateIds: [],
  memeVariantCount: 3,
  time: "",
  place: "",
  ctaLink: "",
  imageDataUrl: "",
  inputLength: "medium",
  numberOfPosts: 1,
  details: "",
};

const MAX_IMAGE_EDGE_PX = 1400;
const MAX_IMAGE_DATA_URL_CHARS = 4_500_000;
const IMAGE_EXPORT_QUALITY = 0.82;
const MAX_CONCURRENT_GENERATION_REQUESTS = 3;
const EVENT_TOPIC_PATTERN = /\b(event|webinar)\b/i;
const PRODUCT_FEATURE_LAUNCH_PATTERN = /\bproduct feature launch\b/i;
const CUSTOM_BRAND_VOICE = "__custom__";
const CHART_LEGEND_POSITIONS: ChartLegendPosition[] = ["top", "right", "bottom", "left"];
const CHART_VISUAL_STYLE_OPTIONS = [
  "clean infographic",
  "corporate report",
  "anime",
  "realistic",
  "minimal monochrome",
  "neon cyberpunk",
] as const;
const CHART_IMAGE_PROMPT_QUICK_SUGGESTIONS = [
  {
    id: "linkedin-clean",
    label: "LinkedIn Clean",
    prompt: "clean LinkedIn-ready infographic, high contrast, crisp labels, direct value callouts, minimal clutter, white background",
  },
  {
    id: "executive-report",
    label: "Executive Report",
    prompt: "executive report style, subtle grid, precise typography, readable legend and labels, polished but simple, data-first composition",
  },
  {
    id: "bold-feed",
    label: "Bold Feed",
    prompt: "bold social feed chart style, strong color separation, large readable labels, clear percentages, mobile-friendly layout",
  },
  {
    id: "minimal-bw",
    label: "Minimal Monochrome",
    prompt: "minimal monochrome chart, grayscale palette, clean spacing, legible labels and values, no decorative elements",
  },
  {
    id: "playful-anime",
    label: "Playful Anime",
    prompt: "anime-inspired infographic style with playful colors, keep labels and values very readable, balanced composition for LinkedIn",
  },
] as const;
const MAX_TEMPLATE_RESULTS = 80;
const INDUSTRY_NEWS_REACTION_PATTERN = /\bindustry news reaction\b/i;
const CALENDAR_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const URL_PATTERN = /https?:\/\/[^\s)]+/i;
const IMAGE_URL_PATTERN = /https?:\/\/[^\s)]+\.(png|jpe?g|webp|gif|avif|svg)(\?[^\s)]*)?$/i;
const VISUAL_HINT_PATTERN = /\b(image|img|photo|visual|screenshot|creative|banner|thumbnail|cover|asset|after-photo)\b/i;
const ARTICLE_PROMO_PATTERN = /\barticle\b/i;
const PRODUCT_UPDATE_PATTERN = /\bproduct update\b/i;
const MAX_MODEL_CONTEXT_IMAGES_PER_POST = 3;
const MAX_PRODUCT_UPDATE_IMAGES_PER_POST = 8;

type MemeTemplateOption = {
  id: string;
  name: string;
  previewUrl: string;
};

type MemegenTemplateApiItem = {
  id?: string;
  name?: string;
  blank?: string;
};

type EditableBodyLine = {
  lineIndex: number;
  text: string;
  isBlank: boolean;
};

type RewriteContext = Pick<FormState, "style" | "goal" | "inputType" | "ctaLink" | "details">;

type GenerationAllocation = {
  inputType: string;
  style: string;
  goal: ContentGoal;
  count: number;
  calendarEntry?: NotionCalendarEntry;
  productUpdateEntry?: SlackProductUpdateEntry;
};

type MonthCalendarCell = {
  key: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  entries: NotionCalendarEntry[];
};

type ProductUpdatesMonthCalendarCell = {
  key: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  entries: SlackProductUpdateEntry[];
};

type CalendarEntryMissingField = "date" | "content" | "url" | "image";

type GeneratedPostsCalendarCell = {
  key: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  postIndices: number[];
};

type ChartWizardPreset = {
  id: string;
  label: string;
  chartType: ChartTypeOption;
  chartTitle: string;
  chartLegendPosition: ChartLegendPosition;
  chartSeriesOneLabel: string;
  chartSeriesTwoLabel: string;
  chartVisualStyle: (typeof CHART_VISUAL_STYLE_OPTIONS)[number];
  chartImagePrompt: string;
  chartLabels: string;
  chartSeriesOneValues: string;
  chartSeriesTwoValues: string;
};

const CHART_WIZARD_PRESETS: ChartWizardPreset[] = [
  {
    id: "trial-split",
    label: "Trial mix",
    chartType: "doughnut",
    chartTitle: "Trial strategy split",
    chartLegendPosition: "right",
    chartSeriesOneLabel: "Share %",
    chartSeriesTwoLabel: "",
    chartVisualStyle: "clean infographic",
    chartImagePrompt: "make it polished and social media ready with crisp labels",
    chartLabels: "Without trial, With paid trial, With free trial",
    chartSeriesOneValues: "56.9, 28.9, 14.3",
    chartSeriesTwoValues: "",
  },
  {
    id: "cohort-retention",
    label: "Cohort retention",
    chartType: "line",
    chartTitle: "Week-4 retention by cohort",
    chartLegendPosition: "top",
    chartSeriesOneLabel: "Current flow",
    chartSeriesTwoLabel: "Optimized flow",
    chartVisualStyle: "corporate report",
    chartImagePrompt: "clean benchmark style, subtle grid, easy to read on LinkedIn feed",
    chartLabels: "Week 1, Week 2, Week 3, Week 4",
    chartSeriesOneValues: "42, 33, 27, 21",
    chartSeriesTwoValues: "44, 38, 33, 29",
  },
  {
    id: "paywall-funnel",
    label: "Paywall funnel",
    chartType: "bar",
    chartTitle: "Paywall funnel drop-off",
    chartLegendPosition: "top",
    chartSeriesOneLabel: "Current",
    chartSeriesTwoLabel: "Target",
    chartVisualStyle: "minimal monochrome",
    chartImagePrompt: "high-contrast bars with direct value labels and no clutter",
    chartLabels: "Paywall views, Trial starts, Paid starts, Month-2 renewals",
    chartSeriesOneValues: "100, 26, 11, 6",
    chartSeriesTwoValues: "100, 30, 14, 9",
  },
  {
    id: "channel-roi",
    label: "Channel ROI",
    chartType: "radar",
    chartTitle: "Channel quality by metric",
    chartLegendPosition: "top",
    chartSeriesOneLabel: "Paid social",
    chartSeriesTwoLabel: "Search",
    chartVisualStyle: "neon cyberpunk",
    chartImagePrompt: "bold futuristic style, still keep labels readable",
    chartLabels: "CTR, Trial rate, Paid rate, LTV, Payback",
    chartSeriesOneValues: "71, 52, 44, 39, 47",
    chartSeriesTwoValues: "56, 68, 61, 63, 59",
  },
];

function IconPencil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function IconSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3Z" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function isRadialChartType(chartType: ChartTypeOption): boolean {
  return chartType === "doughnut" || chartType === "pie" || chartType === "polarArea";
}

function getDefaultChartFields(chartType: ChartTypeOption) {
  if (isRadialChartType(chartType)) {
    return {
      chartLabels: "Without trial, With paid trial, With free trial",
      chartSeriesOneLabel: "Share %",
      chartSeriesOneValues: "56.9, 28.9, 14.3",
      chartSeriesTwoLabel: "",
      chartSeriesTwoValues: "",
      chartLegendPosition: "right" as ChartLegendPosition,
    };
  }

  return {
    chartLabels: "Week 1, Week 2, Week 3, Week 4",
    chartSeriesOneLabel: "Trial starts",
    chartSeriesOneValues: "180, 220, 260, 310",
    chartSeriesTwoLabel: "Paid conversions",
    chartSeriesTwoValues: "82, 94, 118, 142",
    chartLegendPosition: "top" as ChartLegendPosition,
  };
}

function splitCsvText(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitCsvLoose(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return value.split(",").map((part) => part.trim());
}

function trimTrailingEmpty(values: string[]): string[] {
  const next = [...values];
  while (next.length && !next[next.length - 1].trim()) {
    next.pop();
  }
  return next;
}

function splitCsvNumbers(value: string): number[] {
  return splitCsvText(value).map((part) => Number(part));
}

function splitMultilineUrls(value: string): string[] {
  return trimTrailingEmpty(
    value.split(/\r?\n/).map((line) => line.trim()),
  );
}

function getLegendLabel(position: ChartLegendPosition): string {
  return position.charAt(0).toUpperCase() + position.slice(1);
}

function formatChartVisualStyleLabel(style: string): string {
  return style
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDetailsFromCalendarEntry(entry: NotionCalendarEntry): string {
  const parts: string[] = [];
  if (entry.name) parts.push(`Post: ${entry.name}`);
  if (entry.content) parts.push(entry.content);
  const e = entry.event;
  if (e) {
    if (e.eventName) parts.push(`Event: ${e.eventName}`);
    if (e.eventDate) parts.push(`Date: ${e.eventDate}`);
    if (e.region) parts.push(`Place: ${e.region}`);
    if (e.time) parts.push(`Time: ${e.time}`);
    if (e.eventPage) parts.push(`Link: ${e.eventPage}`);
  }
  return parts.join("\n\n");
}

function clipTextForDetails(value: string, maxChars = 2800): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars).trimEnd()}...`;
}

function getTopProductUpdateImageUrls(entry: SlackProductUpdateEntry, limit = MAX_PRODUCT_UPDATE_IMAGES_PER_POST): string[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit));
  if (normalizedLimit === 0) {
    return [];
  }

  const deduped = new Set<string>();

  for (const imageUrl of entry.images) {
    const normalized = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (!normalized) {
      continue;
    }

    deduped.add(normalized);
    if (deduped.size >= normalizedLimit) {
      return Array.from(deduped);
    }
  }

  for (const message of entry.thread) {
    for (const imageUrl of message.images) {
      const normalized = typeof imageUrl === "string" ? imageUrl.trim() : "";
      if (!normalized) {
        continue;
      }

      deduped.add(normalized);
      if (deduped.size >= normalizedLimit) {
        return Array.from(deduped);
      }
    }
  }

  return Array.from(deduped);
}

function normalizeCtaLink(rawLink: string): string {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:";
    if (!isHttp) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function ensureFinalCtaText(cta: string, ctaLink: string): string {
  const cleanCta = cta.trim();
  const cleanLink = ctaLink.trim();

  if (!cleanLink) {
    return cleanCta;
  }

  if (!cleanCta) {
    return cleanLink;
  }

  if (cleanCta.includes(cleanLink)) {
    return cleanCta;
  }

  return `${cleanCta.replace(/[.\s]+$/g, "")}. ${cleanLink}`;
}

function buildDetailsFromProductUpdateEntry(entry: SlackProductUpdateEntry): string {
  const parts: string[] = [];
  if (entry.name.trim()) parts.push(`Feature: ${entry.name.trim()}`);
  if (entry.releaseDate.trim()) parts.push(`Release date: ${entry.releaseDate.trim()}`);
  if (entry.message.trim()) parts.push(`Main update:\n${entry.message.trim()}`);
  if (entry.matchingReplies.length) {
    const keyReplies = entry.matchingReplies
      .map((reply) => `[${reply.userName}] ${reply.text}`)
      .join("\n\n")
      .trim();
    if (keyReplies) {
      parts.push(`Key product comments:\n${keyReplies}`);
    }
  } else if (entry.content.trim()) {
    parts.push(`Thread context:\n${entry.content.trim()}`);
  }
  if (entry.images.length) {
    parts.push(`Thread images:\n${entry.images.join("\n")}`);
  }
  if (entry.slackUrl.trim()) {
    parts.push(`Slack thread: ${entry.slackUrl.trim()}`);
  }

  return clipTextForDetails(parts.join("\n\n"), 2900);
}

function formatEventTimeForPrompt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);

  return `${formatted} (local time)`;
}

function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function getStartOfMonth(value: Date): Date {
  const month = new Date(value.getFullYear(), value.getMonth(), 1);
  month.setHours(0, 0, 0, 0);
  return month;
}

function shiftMonth(value: Date, delta: number): Date {
  return getStartOfMonth(new Date(value.getFullYear(), value.getMonth() + delta, 1));
}

function getStartOfWeek(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function getWeekRange(referenceDate: Date, weekOffset = 0): { start: Date; end: Date } {
  const start = addCalendarDays(getStartOfWeek(referenceDate), weekOffset * 7);
  const end = addCalendarDays(start, 6);
  return { start, end };
}

function addCalendarDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatCalendarDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarMonthKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatCalendarMonthLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatCalendarDateLabel(value: string): string {
  const parsed = parseCalendarDate(value);
  if (!parsed) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatWeekRangeLabel(range: { start: Date; end: Date }): string {
  return `${formatCalendarDateLabel(formatCalendarDateKey(range.start))} - ${formatCalendarDateLabel(formatCalendarDateKey(range.end))}`;
}

function extractDateKeyFromDateTimeInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const directMatch = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatCalendarDateKey(parsed);
}

function buildMonthCalendarCells(
  allEntries: NotionCalendarEntry[],
  monthCursor: Date,
  todayDate: Date,
): MonthCalendarCell[] {
  const monthStart = getStartOfMonth(monthCursor);
  const monthYear = monthStart.getFullYear();
  const monthIndex = monthStart.getMonth();
  const todayKey = formatCalendarDateKey(todayDate);
  const entriesByDate = new Map<string, NotionCalendarEntry[]>();

  for (const entry of allEntries) {
    const parsedDate = parseCalendarDate(entry.date);
    if (!parsedDate) {
      continue;
    }

    const key = formatCalendarDateKey(parsedDate);
    const existing = entriesByDate.get(key);
    if (existing) {
      existing.push(entry);
      continue;
    }
    entriesByDate.set(key, [entry]);
  }

  const gridStart = addCalendarDays(monthStart, -monthStart.getDay());
  const cells: MonthCalendarCell[] = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const cellDate = addCalendarDays(gridStart, offset);
    const key = formatCalendarDateKey(cellDate);
    const entries = entriesByDate.get(key) ?? [];

    cells.push({
      key,
      dayOfMonth: cellDate.getDate(),
      isCurrentMonth: cellDate.getFullYear() === monthYear && cellDate.getMonth() === monthIndex,
      isToday: key === todayKey,
      entries,
    });
  }

  return cells;
}

function getProductUpdateEntriesForMonth(entries: SlackProductUpdateEntry[], monthDate: Date): SlackProductUpdateEntry[] {
  const monthKey = `${formatCalendarMonthKey(monthDate)}-`;
  return entries
    .filter((entry) => entry.releaseDate.startsWith(monthKey))
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name));
}

function getCalendarEntriesForWeek(entries: NotionCalendarEntry[], referenceDate: Date, weekOffset = 0): NotionCalendarEntry[] {
  const { start, end } = getWeekRange(referenceDate, weekOffset);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return entries
    .filter((entry) => {
      const parsedDate = parseCalendarDate(entry.date);
      if (!parsedDate) {
        return false;
      }
      const entryMs = parsedDate.getTime();
      return entryMs >= startMs && entryMs <= endMs;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function getProductUpdateEntriesForWeek(
  entries: SlackProductUpdateEntry[],
  referenceDate: Date,
  weekOffset = 0,
): SlackProductUpdateEntry[] {
  const { start, end } = getWeekRange(referenceDate, weekOffset);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return entries
    .filter((entry) => {
      const parsedDate = parseCalendarDate(entry.releaseDate);
      if (!parsedDate) {
        return false;
      }
      const entryMs = parsedDate.getTime();
      return entryMs >= startMs && entryMs <= endMs;
    })
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name));
}

function buildProductUpdatesMonthCalendarCells(
  entries: SlackProductUpdateEntry[],
  monthCursor: Date,
  todayDate: Date,
): ProductUpdatesMonthCalendarCell[] {
  const monthStart = getStartOfMonth(monthCursor);
  const monthYear = monthStart.getFullYear();
  const monthIndex = monthStart.getMonth();
  const todayKey = formatCalendarDateKey(todayDate);
  const entriesByDate = new Map<string, SlackProductUpdateEntry[]>();

  for (const entry of entries) {
    const parsedDate = parseCalendarDate(entry.releaseDate);
    if (!parsedDate) {
      continue;
    }

    const key = formatCalendarDateKey(parsedDate);
    const existing = entriesByDate.get(key);
    if (existing) {
      existing.push(entry);
      continue;
    }
    entriesByDate.set(key, [entry]);
  }

  const gridStart = addCalendarDays(monthStart, -monthStart.getDay());
  const cells: ProductUpdatesMonthCalendarCell[] = [];

  for (let offset = 0; offset < 42; offset += 1) {
    const cellDate = addCalendarDays(gridStart, offset);
    const key = formatCalendarDateKey(cellDate);
    cells.push({
      key,
      dayOfMonth: cellDate.getDate(),
      isCurrentMonth: cellDate.getFullYear() === monthYear && cellDate.getMonth() === monthIndex,
      isToday: key === todayKey,
      entries: entriesByDate.get(key) ?? [],
    });
  }

  return cells;
}

function buildGeneratedPostsCalendarCells(
  postIndicesByDate: Map<string, number[]>,
  monthCursor: Date,
  todayDate: Date,
): GeneratedPostsCalendarCell[] {
  const monthStart = getStartOfMonth(monthCursor);
  const monthYear = monthStart.getFullYear();
  const monthIndex = monthStart.getMonth();
  const todayKey = formatCalendarDateKey(todayDate);

  const gridStart = addCalendarDays(monthStart, -monthStart.getDay());
  const cells: GeneratedPostsCalendarCell[] = [];

  for (let offset = 0; offset < 42; offset += 1) {
    const cellDate = addCalendarDays(gridStart, offset);
    const key = formatCalendarDateKey(cellDate);
    cells.push({
      key,
      dayOfMonth: cellDate.getDate(),
      isCurrentMonth: cellDate.getFullYear() === monthYear && cellDate.getMonth() === monthIndex,
      isToday: key === todayKey,
      postIndices: postIndicesByDate.get(key) ?? [],
    });
  }

  return cells;
}

function formatTemplateIdLabel(templateId: string): string {
  return templateId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildFallbackMemeTemplates(): MemeTemplateOption[] {
  return MEME_TEMPLATE_OPTIONS.map((template) => ({
    id: template.id,
    name: template.name,
    previewUrl: `https://api.memegen.link/images/${template.id}.jpg`,
  }));
}

function normalizeMemegenTemplateId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function mapMemegenTemplateItems(items: MemegenTemplateApiItem[]): MemeTemplateOption[] {
  const deduped = new Map<string, MemeTemplateOption>();

  for (const item of items) {
    const id = typeof item.id === "string" ? normalizeMemegenTemplateId(item.id) : "";
    if (!id) {
      continue;
    }

    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : formatTemplateIdLabel(id);
    const previewUrl =
      typeof item.blank === "string" && item.blank.trim()
        ? item.blank.trim()
        : `https://api.memegen.link/images/${id}.jpg`;

    deduped.set(id, {
      id,
      name,
      previewUrl,
    });
  }

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildChartRows(form: Pick<FormState, "chartType" | "chartLabels" | "chartSeriesOneValues" | "chartSeriesTwoValues">) {
  const labels = splitCsvLoose(form.chartLabels);
  const primaryValues = splitCsvLoose(form.chartSeriesOneValues);
  const secondaryValues = splitCsvLoose(form.chartSeriesTwoValues);
  const minRows = isRadialChartType(form.chartType) ? 3 : 4;
  const rowCount = Math.max(minRows, labels.length, primaryValues.length, secondaryValues.length, 1);

  return Array.from({ length: rowCount }, (_, index) => ({
    label: labels[index] ?? "",
    primary: primaryValues[index] ?? "",
    secondary: secondaryValues[index] ?? "",
  }));
}

function buildChartPayload(form: FormState): { chartData: string; chartOptions: string } | { error: string } {
  const labels = splitCsvText(form.chartLabels);
  if (!labels.length) {
    return { error: "Chart labels are required. Use comma-separated labels." };
  }

  const seriesOneValues = splitCsvNumbers(form.chartSeriesOneValues);
  if (!seriesOneValues.length) {
    return { error: "Primary chart values are required. Use comma-separated numbers." };
  }

  if (seriesOneValues.some((value) => !Number.isFinite(value))) {
    return { error: "Primary chart values must be numeric." };
  }

  if (seriesOneValues.length !== labels.length) {
    return { error: "Primary chart values count must match labels count." };
  }

  const datasets: Array<{ label: string; data: number[] }> = [
    {
      label: form.chartSeriesOneLabel.trim() || "Series 1",
      data: seriesOneValues,
    },
  ];

  const radialChart = isRadialChartType(form.chartType);
  if (!radialChart) {
    const seriesTwoValuesText = form.chartSeriesTwoValues.trim();
    const seriesTwoLabelText = form.chartSeriesTwoLabel.trim();
    if (seriesTwoValuesText || seriesTwoLabelText) {
      const seriesTwoValues = splitCsvNumbers(seriesTwoValuesText);
      if (!seriesTwoValues.length) {
        return { error: "Secondary values are empty. Add numbers or clear the secondary fields." };
      }
      if (seriesTwoValues.some((value) => !Number.isFinite(value))) {
        return { error: "Secondary chart values must be numeric." };
      }
      if (seriesTwoValues.length !== labels.length) {
        return { error: "Secondary chart values count must match labels count." };
      }

      datasets.push({
        label: seriesTwoLabelText || "Series 2",
        data: seriesTwoValues,
      });
    }
  }

  const chartData = JSON.stringify({ labels, datasets });
  const chartOptions = JSON.stringify({
    plugins: {
      legend: {
        position: form.chartLegendPosition,
      },
    },
  });

  return { chartData, chartOptions };
}

function normalizeNoEmDash(value: string): string {
  return value
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/([^\s])[\u2012\u2013\u2014\u2015\u2212]([^\s])/g, "$1 - $2")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
}

function sanitizeGenerationResult(result: GeneratePostsResponse): GeneratePostsResponse {
  return {
    ...result,
    chart: result.chart
      ? {
          ...result.chart,
          title: normalizeNoEmDash(result.chart.title),
          visualStyle: result.chart.visualStyle ? normalizeNoEmDash(result.chart.visualStyle) : result.chart.visualStyle,
          imagePrompt: result.chart.imagePrompt ? normalizeNoEmDash(result.chart.imagePrompt) : result.chart.imagePrompt,
          imageDataUrl: result.chart.imageDataUrl.trim(),
        }
      : undefined,
    hooks: result.hooks.map((hook) => normalizeNoEmDash(hook)),
    posts: result.posts.map((post) => ({
      ...post,
      hook: normalizeNoEmDash(post.hook),
      body: normalizeNoEmDash(post.body),
      cta: normalizeNoEmDash(post.cta),
      xThread: post.xThread?.map((threadPost) => normalizeNoEmDash(threadPost)),
      meme: post.meme
        ? {
            ...post.meme,
            topText: normalizeNoEmDash(post.meme.topText),
            bottomText: normalizeNoEmDash(post.meme.bottomText),
            textLines: post.meme.textLines?.map((line) => normalizeNoEmDash(line)),
            url: post.meme.url.trim(),
            toneFitReason: post.meme.toneFitReason ? normalizeNoEmDash(post.meme.toneFitReason) : post.meme.toneFitReason,
          }
        : undefined,
      memeVariants: post.memeVariants?.map((variant) => ({
        ...variant,
        topText: normalizeNoEmDash(variant.topText),
        bottomText: normalizeNoEmDash(variant.bottomText),
        textLines: variant.textLines?.map((line) => normalizeNoEmDash(line)),
        toneFitReason: variant.toneFitReason ? normalizeNoEmDash(variant.toneFitReason) : variant.toneFitReason,
        url: variant.url.trim(),
      })),
      giphy: post.giphy
        ? {
            ...post.giphy,
            title: normalizeNoEmDash(post.giphy.title),
            sourceQuery: normalizeNoEmDash(post.giphy.sourceQuery),
            url: post.giphy.url.trim(),
            previewUrl: post.giphy.previewUrl.trim(),
          }
        : undefined,
      giphyVariants: post.giphyVariants?.map((variant) => ({
        ...variant,
        title: normalizeNoEmDash(variant.title),
        sourceQuery: normalizeNoEmDash(variant.sourceQuery),
        url: variant.url.trim(),
        previewUrl: variant.previewUrl.trim(),
      })),
    })),
  };
}

function formatLengthLabel(value: string): string {
  if (!value) {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "standard") {
    return "Medium";
  }

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSelectWidthFromOptions(
  options: readonly string[],
  config: { minCh?: number; maxCh?: number; paddingCh?: number } = {},
): string {
  const { minCh = 12, maxCh = 40, paddingCh = 5 } = config;
  const longest = options.reduce((max, option) => Math.max(max, option.length), 0);
  const widthInCh = Math.max(minCh, Math.min(maxCh, longest + paddingCh));
  return `min(100%, ${widthInCh}ch)`;
}

function needsEventDetails(inputType: string): boolean {
  return EVENT_TOPIC_PATTERN.test(inputType);
}

function needsProductFeatureLaunchSelection(inputType: string): boolean {
  return PRODUCT_FEATURE_LAUNCH_PATTERN.test(inputType);
}

function getCalendarMissingFieldLabel(field: CalendarEntryMissingField): string {
  switch (field) {
    case "date":
      return "date";
    case "content":
      return "content";
    case "url":
      return "url";
    case "image":
      return "image";
    default:
      return field;
  }
}

function getCalendarEntryMissingFields(entry: NotionCalendarEntry): CalendarEntryMissingField[] {
  const missing: CalendarEntryMissingField[] = [];
  const content = entry.content.trim();
  const eventPage = entry.event?.eventPage?.trim() ?? "";
  const tagText = (entry.tags ?? []).join(" ");
  const hasUrl = Boolean(eventPage) || URL_PATTERN.test(content);
  const hasImageSignal = VISUAL_HINT_PATTERN.test(content) || IMAGE_URL_PATTERN.test(content);
  const eventText = `${entry.name} ${entry.event?.eventName ?? ""} ${tagText}`.trim();
  const isEventOrWebinar = Boolean(entry.event) || EVENT_TOPIC_PATTERN.test(eventText);
  const isArticlePromo = ARTICLE_PROMO_PATTERN.test(eventText);
  const isProductUpdate = PRODUCT_UPDATE_PATTERN.test(eventText);

  if (!entry.date.trim() || !parseCalendarDate(entry.date)) {
    missing.push("date");
  }

  if (!content) {
    missing.push("content");
  }

  if ((isArticlePromo || isEventOrWebinar) && !hasUrl) {
    missing.push("url");
  }

  if ((isEventOrWebinar || isProductUpdate) && !hasImageSignal) {
    missing.push("image");
  }

  return missing;
}

function needsChartDetails(inputType: string): boolean {
  void inputType;
  return true;
}

function needsIndustryNewsRssGuide(inputType: string): boolean {
  return INDUSTRY_NEWS_REACTION_PATTERN.test(inputType);
}

function formatFeedCategoryLabel(category: FeedCategory): string {
  switch (category) {
    case "platform":
      return "Platform";
    case "monetization":
      return "Monetization";
    case "growth":
      return "Growth";
    default:
      return category;
  }
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildGenerationAllocations(params: {
  inputTypes: string[];
  styles: string[];
  goals: ContentGoal[];
  totalPosts: number;
}): GenerationAllocation[] {
  const safeTypes = uniqueNonEmptyStrings(params.inputTypes).filter((type) =>
    POST_TYPE_OPTIONS.includes(type as (typeof POST_TYPE_OPTIONS)[number]),
  );
  const safeStyles = uniqueNonEmptyStrings(params.styles);
  const safeGoals = Array.from(new Set(params.goals));

  if (!safeTypes.length || !safeStyles.length || !safeGoals.length) {
    return [];
  }

  const voiceGoalCombos = safeStyles.flatMap((style) => safeGoals.map((goal) => ({ style, goal })));
  const safeTotal = Math.max(1, Math.trunc(params.totalPosts));
  const allocationByKey = new Map<string, GenerationAllocation>();

  for (let index = 0; index < safeTotal; index += 1) {
    const inputType = safeTypes[index % safeTypes.length] ?? safeTypes[0];
    const voiceGoalCombo = voiceGoalCombos[index % voiceGoalCombos.length] ?? voiceGoalCombos[0];
    const key = `${inputType}|||${voiceGoalCombo.style}|||${voiceGoalCombo.goal}`;
    const existing = allocationByKey.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    allocationByKey.set(key, {
      inputType,
      style: voiceGoalCombo.style,
      goal: voiceGoalCombo.goal,
      count: 1,
    });
  }

  return Array.from(allocationByKey.values());
}

function summarizeSelectedItems(items: string[], fallback: string): string {
  if (!items.length) {
    return fallback;
  }
  if (items.length <= 2) {
    return items.join(", ");
  }

  return `${items.slice(0, 2).join(", ")} +${items.length - 2} more`;
}

function buildGeneratedCalendarCellSummary(params: {
  postIndices: number[];
  postTypeByPostIndex: Record<number, string>;
  postEventLabelByPostIndex: Record<number, string>;
}): string {
  const uniqueEventLabels = Array.from(
    new Set(
      params.postIndices
        .map((postIndex) => params.postEventLabelByPostIndex[postIndex]?.trim() ?? "")
        .filter(Boolean),
    ),
  );

  if (uniqueEventLabels.length === 1) {
    return uniqueEventLabels[0];
  }

  if (uniqueEventLabels.length > 1) {
    return `${uniqueEventLabels.length} events: ${summarizeSelectedItems(uniqueEventLabels, "")}`;
  }

  const typeCounts = new Map<string, number>();
  for (const postIndex of params.postIndices) {
    const type = params.postTypeByPostIndex[postIndex]?.trim();
    if (!type) {
      continue;
    }
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  if (!typeCounts.size) {
    return "";
  }

  const typeEntries = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (typeEntries.length === 1) {
    return typeEntries[0][0];
  }

  const typeSummaryParts = typeEntries.map(([type, count]) => `${count}x ${type}`);
  return `Mixed: ${summarizeSelectedItems(typeSummaryParts, "")}`;
}

function buildEditableBodyLines(body: string): EditableBodyLine[] {
  const rawLines = body.split("\n");
  if (!rawLines.length) {
    return [{ lineIndex: 0, text: "", isBlank: true }];
  }

  return rawLines.map((line, lineIndex) => ({
    lineIndex,
    text: line,
    isBlank: line.trim().length === 0,
  }));
}

function normalizeCopyComparisonLine(value: string): string {
  return normalizeNoEmDash(value)
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim()
    .toLowerCase();
}

function removeLeadingHookFromBodyForCopy(hook: string, body: string): string {
  const normalizedHook = normalizeCopyComparisonLine(hook);
  const lines = body.split("\n");
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (!normalizedHook || firstContentLineIndex < 0) {
    return body.trim();
  }

  const firstContentLine = lines[firstContentLineIndex] ?? "";
  const normalizedFirstContentLine = normalizeCopyComparisonLine(firstContentLine);

  if (normalizedFirstContentLine !== normalizedHook) {
    return body.trim();
  }

  const nextLines = [...lines];
  nextLines.splice(firstContentLineIndex, 1);
  return nextLines.join("\n").trim();
}

function buildPostTextForCopy(
  post: { hook: string; body: string; cta: string },
  sourceImageUrls: string[] = [],
): string {
  const hook = post.hook.trim();
  const body = removeLeadingHookFromBodyForCopy(post.hook, post.body);
  const cta = post.cta.trim();
  const normalizedSourceImageUrls = Array.from(
    new Set(
      sourceImageUrls
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const attachedImagesSection = normalizedSourceImageUrls.length
    ? ["Attached images:", ...normalizedSourceImageUrls.map((url, index) => `${index + 1}. ${url}`)].join("\n")
    : "";

  return [hook, body, cta, attachedImagesSection].filter(Boolean).join("\n\n");
}

function normalizeHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function isSlackPrivateFileUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" && parsed.hostname === "files.slack.com";
  } catch {
    return false;
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getMemeVariantsForPost(post: GeneratedPost): MemeCompanion[] {
  return post.memeVariants?.length ? post.memeVariants : post.meme ? [post.meme] : [];
}

function getGiphyVariantsForPost(post: GeneratedPost): GiphyCompanion[] {
  return post.giphyVariants?.length ? post.giphyVariants : post.giphy ? [post.giphy] : [];
}

function buildMemeCompanionsTextForCopy(memeVariants: MemeCompanion[]): string {
  if (!memeVariants.length) {
    return "";
  }

  const blocks = memeVariants.map((variant, variantIndex) => {
    const lines: string[] = [
      `${variantIndex + 1}. ${variant.templateName} (${variant.templateId})`,
      `URL: ${variant.url}`,
    ];

    if (Array.isArray(variant.textLines) && variant.textLines.length > 2) {
      variant.textLines.forEach((line, lineIndex) => {
        lines.push(`Line ${lineIndex + 1}: ${line}`);
      });
    } else {
      lines.push(`Top: ${variant.topText}`);
      lines.push(`Bottom: ${variant.bottomText}`);
    }

    if (variant.toneFitReason) {
      lines.push(`Reason: ${variant.toneFitReason}`);
    }

    return lines.join("\n");
  });

  return ["Meme companions:", ...blocks].join("\n\n");
}

function buildGiphyCompanionsTextForCopy(giphyVariants: GiphyCompanion[]): string {
  if (!giphyVariants.length) {
    return "";
  }

  const blocks = giphyVariants.map((variant, variantIndex) => {
    const lines = [
      `${variantIndex + 1}. ${variant.title}`,
      `Page URL: ${variant.url}`,
      `Preview URL: ${variant.previewUrl || variant.url}`,
      `Query: ${variant.sourceQuery}`,
      variant.rating ? `Rating: ${variant.rating.toUpperCase()}` : "",
    ].filter(Boolean);

    return lines.join("\n");
  });

  return ["GIPHY companions:", ...blocks].join("\n\n");
}

function normalizeXThreadPosts(threadPosts: string[]): string[] {
  return threadPosts
    .map((threadPost) => normalizeNoEmDash(threadPost).trim())
    .filter(Boolean);
}

function buildXThreadTextForCopy(threadPosts: string[]): string {
  const normalizedThreadPosts = normalizeXThreadPosts(threadPosts);
  if (!normalizedThreadPosts.length) {
    return "";
  }

  return normalizedThreadPosts.join("\n\n\n");
}

function buildRichClipboardHtml(params: {
  textSections: string[];
  sourceUrls: string[];
  embeddedImageUrls: string[];
}): string {
  const sectionHtml = params.textSections
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => `<p>${escapeHtml(section).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  const sourceListHtml = params.sourceUrls.length
    ? `<p><strong>Links:</strong></p><ol>${params.sourceUrls
        .map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`)
        .join("")}</ol>`
    : "";

  const embeddedImagesHtml = params.embeddedImageUrls.length
    ? `<div>${params.embeddedImageUrls
        .map(
          (imageUrl, index) =>
            `<p><img src="${escapeHtml(imageUrl)}" alt="Attached image ${index + 1}" style="max-width:100%;height:auto;" /></p>`,
        )
        .join("")}</div>`
    : "";

  return `<article>
${sectionHtml}
${sourceListHtml}
${embeddedImagesHtml}
</article>`;
}

function extractApiErrorMessage(responsePayload: unknown, status: number): string {
  const apiError =
    responsePayload && typeof responsePayload === "object" && "error" in responsePayload
      ? String((responsePayload as { error?: unknown }).error ?? "")
      : "";
  const apiMessage =
    responsePayload && typeof responsePayload === "object" && "message" in responsePayload
      ? String((responsePayload as { message?: unknown }).message ?? "")
      : "";

  if (apiError && apiMessage && apiError !== apiMessage) {
    return `${apiError}: ${apiMessage}`;
  }

  return apiMessage || apiError || `Request failed (${status})`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image file."));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("Unexpected image file format."));
        return;
      }
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Could not decode the selected image."));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });
}

async function buildImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please attach an image file.");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const largestEdge = Math.max(sourceWidth, sourceHeight);
  const scale = largestEdge > MAX_IMAGE_EDGE_PX ? MAX_IMAGE_EDGE_PX / largestEdge : 1;

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return originalDataUrl;
  }

  context.drawImage(image, 0, 0, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const optimizedDataUrl =
    outputType === "image/jpeg"
      ? canvas.toDataURL(outputType, IMAGE_EXPORT_QUALITY)
      : canvas.toDataURL(outputType);

  return optimizedDataUrl.length <= originalDataUrl.length ? optimizedDataUrl : originalDataUrl;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy copy path
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPostHtmlForClipboard(params: {
  post: { hook: string; body: string; cta: string };
  sourceImageUrls: string[];
  embeddedImageUrls: string[];
}): string {
  const hook = params.post.hook.trim();
  const body = removeLeadingHookFromBodyForCopy(params.post.hook, params.post.body);
  const cta = params.post.cta.trim();
  const sourceImageUrls = Array.from(
    new Set(
      params.sourceImageUrls
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  const embeddedImageUrls = Array.from(
    new Set(
      params.embeddedImageUrls
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  const sourceListHtml = sourceImageUrls.length
    ? `<p><strong>Attached images:</strong></p><ol>${sourceImageUrls
        .map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`)
        .join("")}</ol>`
    : "";

  const embeddedImagesHtml = embeddedImageUrls.length
    ? `<div>${embeddedImageUrls
        .map(
          (imageUrl, index) =>
            `<p><img src="${escapeHtml(imageUrl)}" alt="Attached image ${index + 1}" style="max-width:100%;height:auto;" /></p>`,
        )
        .join("")}</div>`
    : "";

  return `<article>
<p><strong>${escapeHtml(hook)}</strong></p>
${body ? `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>` : ""}
${cta ? `<p>${escapeHtml(cta)}</p>` : ""}
${sourceListHtml}
${embeddedImagesHtml}
</article>`;
}

async function fetchSlackImageDataUrlForClipboard(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch("/api/slack-product-updates/image-data-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: imageUrl,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return null;
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      !("dataUrl" in payload) ||
      typeof (payload as { dataUrl?: unknown }).dataUrl !== "string"
    ) {
      return null;
    }

    const dataUrl = (payload as { dataUrl: string }).dataUrl.trim();
    if (!dataUrl.startsWith("data:image/")) {
      return null;
    }

    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      return null;
    }

    return dataUrl;
  } catch {
    return null;
  }
}

function buildSlackImageProxyUrl(imageUrl: string): string {
  return `/api/slack-product-updates/image-data-url?url=${encodeURIComponent(imageUrl)}`;
}

async function resolveClipboardImageUrl(imageUrl: string): Promise<string | null> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  const normalizedUrl = normalizeHttpUrl(trimmed);
  if (!normalizedUrl) {
    return null;
  }

  if (isSlackPrivateFileUrl(normalizedUrl)) {
    const slackDataUrl = await fetchSlackImageDataUrlForClipboard(normalizedUrl);
    return slackDataUrl || normalizedUrl;
  }

  return normalizedUrl;
}

async function copySectionsAndImagesToClipboard(params: {
  textSections: string[];
  sourceUrls?: string[];
  imageUrls?: string[];
}): Promise<boolean> {
  const textSections = params.textSections
    .map((section) => section.trim())
    .filter(Boolean);
  const sourceUrls = dedupeStrings((params.sourceUrls ?? []).map((value) => normalizeHttpUrl(value)).filter(Boolean));
  const plainTextSourceSection = sourceUrls.length
    ? ["Links:", ...sourceUrls.map((url, index) => `${index + 1}. ${url}`)].join("\n")
    : "";
  const plainText = [...textSections, plainTextSourceSection].filter(Boolean).join("\n\n");

  if (!plainText) {
    return false;
  }

  const imageCandidates = dedupeStrings(params.imageUrls ?? []);
  const settled = await Promise.allSettled(imageCandidates.map((imageUrl) => resolveClipboardImageUrl(imageUrl)));
  let embeddedImageUrls = settled.flatMap((item) => {
    if (item.status !== "fulfilled" || !item.value) {
      return [];
    }
    return [item.value];
  });

  if (!embeddedImageUrls.length) {
    embeddedImageUrls = dedupeStrings(
      imageCandidates.map((imageUrl) => {
        if (imageUrl.trim().startsWith("data:image/")) {
          return imageUrl.trim();
        }
        return normalizeHttpUrl(imageUrl);
      }),
    );
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const html = buildRichClipboardHtml({
        textSections,
        sourceUrls,
        embeddedImageUrls,
      });
      const item = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall back to plain text copy.
    }
  }

  return copyTextToClipboard(plainText);
}

async function copyPostAndImagesToClipboard(params: {
  post: { hook: string; body: string; cta: string };
  sourceImageUrls: string[];
  imageDataUrls: string[];
}): Promise<boolean> {
  const sourceImageUrls = Array.from(
    new Set(
      params.sourceImageUrls
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const plainText = buildPostTextForCopy(params.post, sourceImageUrls);
  if (!plainText) {
    return false;
  }

  let embeddedImageUrls = Array.from(
    new Set(
      params.imageDataUrls
        .map((value) => value.trim())
        .filter((value) => value.startsWith("data:image/")),
    ),
  );

  if (!embeddedImageUrls.length && sourceImageUrls.length) {
    const settled = await Promise.allSettled(
      sourceImageUrls.map((sourceImageUrl) => fetchSlackImageDataUrlForClipboard(sourceImageUrl)),
    );
    embeddedImageUrls = settled.flatMap((item) => {
      if (item.status !== "fulfilled" || !item.value) {
        return [];
      }
      return [item.value];
    });
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const html = buildPostHtmlForClipboard({
        post: params.post,
        sourceImageUrls,
        embeddedImageUrls: embeddedImageUrls.length ? embeddedImageUrls : sourceImageUrls,
      });
      const item = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall back to plain text copy.
    }
  }

  return copyTextToClipboard(plainText);
}

async function copyXThreadToClipboard(threadPosts: string[]): Promise<boolean> {
  const threadText = buildXThreadTextForCopy(threadPosts);
  if (!threadText) {
    return false;
  }

  return copyTextToClipboard(threadText);
}

async function copyMemeCompanionsToClipboard(memeVariants: MemeCompanion[]): Promise<boolean> {
  const memeText = buildMemeCompanionsTextForCopy(memeVariants);
  if (!memeText) {
    return false;
  }

  const memeUrls = dedupeStrings(memeVariants.map((variant) => normalizeHttpUrl(variant.url)).filter(Boolean));
  return copySectionsAndImagesToClipboard({
    textSections: [memeText],
    sourceUrls: memeUrls,
    imageUrls: memeUrls,
  });
}

async function copyGiphyCompanionsToClipboard(giphyVariants: GiphyCompanion[]): Promise<boolean> {
  const giphyText = buildGiphyCompanionsTextForCopy(giphyVariants);
  if (!giphyText) {
    return false;
  }

  const giphyPageUrls = dedupeStrings(giphyVariants.map((variant) => normalizeHttpUrl(variant.url)).filter(Boolean));
  const giphyPreviewUrls = dedupeStrings(
    giphyVariants.map((variant) => normalizeHttpUrl(variant.previewUrl || variant.url)).filter(Boolean),
  );

  return copySectionsAndImagesToClipboard({
    textSections: [giphyText],
    sourceUrls: [...giphyPageUrls, ...giphyPreviewUrls],
    imageUrls: giphyPreviewUrls,
  });
}

async function copyEverythingToClipboard(params: {
  post: { hook: string; body: string; cta: string };
  sourceImageUrls: string[];
  imageDataUrls: string[];
  memeVariants: MemeCompanion[];
  giphyVariants: GiphyCompanion[];
}): Promise<boolean> {
  const postText = buildPostTextForCopy(params.post);
  const memeText = buildMemeCompanionsTextForCopy(params.memeVariants);
  const giphyText = buildGiphyCompanionsTextForCopy(params.giphyVariants);

  const memeImageUrls = dedupeStrings(params.memeVariants.map((variant) => normalizeHttpUrl(variant.url)).filter(Boolean));
  const giphyPreviewUrls = dedupeStrings(
    params.giphyVariants.map((variant) => normalizeHttpUrl(variant.previewUrl || variant.url)).filter(Boolean),
  );
  const giphyPageUrls = dedupeStrings(params.giphyVariants.map((variant) => normalizeHttpUrl(variant.url)).filter(Boolean));

  return copySectionsAndImagesToClipboard({
    textSections: [postText, memeText, giphyText],
    sourceUrls: [...params.sourceImageUrls, ...memeImageUrls, ...giphyPageUrls, ...giphyPreviewUrls],
    imageUrls: [...params.imageDataUrls, ...params.sourceImageUrls, ...memeImageUrls, ...giphyPreviewUrls],
  });
}

export default function Home() {
  const baseControlClassName =
    "block w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900";
  const calendarControlButtonClassName =
    "inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 hover:shadow active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-45";
  const calendarPrimaryButtonClassName =
    "inline-flex cursor-pointer items-center justify-center rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-100 hover:shadow active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-45";
  const selectableCardSelectedClass =
    "border-sky-500 bg-sky-50 shadow-[0_0_0_1px_rgba(56,189,248,0.22)]";
  const selectableCardUnselectedClass = "border-black/10 bg-white hover:border-slate-400 hover:bg-slate-50";
  const compactInputStyle = { width: "min(100%, 34rem)" } as const;
  const mediumInputStyle = { width: "min(100%, 26rem)" } as const;
  const smallNumberInputStyle = { width: "min(100%, 20ch)" } as const;
  const defaultRewriteContext: RewriteContext = {
    style: defaultForm.style,
    goal: defaultForm.goal,
    inputType: defaultForm.inputType,
    ctaLink: defaultForm.ctaLink,
    details: defaultForm.details,
  };
  const [form, setForm] = useState<FormState>(defaultForm);
  const [selectedPostTypes, setSelectedPostTypes] = useState<string[]>(() => [defaultForm.inputType]);
  const [selectedBrandVoices, setSelectedBrandVoices] = useState<string[]>(() => [
    isBrandVoicePreset(defaultForm.style) ? defaultForm.style : CUSTOM_BRAND_VOICE,
  ]);
  const [selectedGoals, setSelectedGoals] = useState<ContentGoal[]>(() => [defaultForm.goal]);
  const [postTypeByPostIndex, setPostTypeByPostIndex] = useState<Record<number, string>>({});
  const [brandVoiceByPostIndex, setBrandVoiceByPostIndex] = useState<Record<number, string>>({});
  const [goalByPostIndex, setGoalByPostIndex] = useState<Record<number, ContentGoal>>({});
  const [postDateByPostIndex, setPostDateByPostIndex] = useState<Record<number, string>>({});
  const [postEventLabelByPostIndex, setPostEventLabelByPostIndex] = useState<Record<number, string>>({});
  const [postImageDataUrlByPostIndex, setPostImageDataUrlByPostIndex] = useState<Record<number, string[]>>({});
  const [postSourceImageUrlByPostIndex, setPostSourceImageUrlByPostIndex] = useState<Record<number, string[]>>({});
  const [postCtaLinkByPostIndex, setPostCtaLinkByPostIndex] = useState<Record<number, string>>({});
  const [generatedPostsMonthCursor, setGeneratedPostsMonthCursor] = useState<Date>(() => getStartOfMonth(new Date()));
  const [selectedGeneratedPostsDates, setSelectedGeneratedPostsDates] = useState<string[]>([]);
  const [numberOfPostsInput, setNumberOfPostsInput] = useState<string>(() => String(defaultForm.numberOfPosts));
  const [ctaLinkMode, setCtaLinkMode] = useState<CtaLinkMode>("shared");
  const [perPostCtaLinksInput, setPerPostCtaLinksInput] = useState<string>("");
  const [result, setResult] = useState<GeneratePostsResponse | null>(null);
  const [rewriteContext, setRewriteContext] = useState<RewriteContext>(defaultRewriteContext);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [rewriteLoadingKey, setRewriteLoadingKey] = useState<string | null>(null);
  const [rewritePromptByPost, setRewritePromptByPost] = useState<Record<number, string>>({});
  const [manualLineDraftByPost, setManualLineDraftByPost] = useState<Record<number, string>>({});
  const [manualCtaDraftByPost, setManualCtaDraftByPost] = useState<Record<number, string>>({});
  const [selectedLineByPost, setSelectedLineByPost] = useState<Record<number, number>>({});
  const [selectedCtaByPost, setSelectedCtaByPost] = useState<Record<number, boolean>>({});
  const [rewriteErrorByPost, setRewriteErrorByPost] = useState<Record<number, string>>({});
  const [lineFeedbackByPost, setLineFeedbackByPost] = useState<Record<number, string>>({});
  const [copyFeedbackByPostAction, setCopyFeedbackByPostAction] = useState<Record<string, "copied" | "failed">>({});
  const [imageName, setImageName] = useState<string>("");
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  const [isChartPromptLoading, setIsChartPromptLoading] = useState(false);
  const [chartPromptError, setChartPromptError] = useState("");
  const [chartPromptHint, setChartPromptHint] = useState("");
  const [notionCalendar, setNotionCalendar] = useState<NotionCalendarData | null>(null);
  const [notionCalendarLoading, setNotionCalendarLoading] = useState(false);
  const [notionCalendarSyncLoading, setNotionCalendarSyncLoading] = useState(false);
  const [calendarMonthCursor, setCalendarMonthCursor] = useState<Date>(() => getStartOfMonth(new Date()));
  const [selectedCalendarEntryIds, setSelectedCalendarEntryIds] = useState<string[]>([]);
  const [productUpdatesMonthCursor, setProductUpdatesMonthCursor] = useState<Date>(() => getStartOfMonth(new Date()));
  const [slackProductUpdates, setSlackProductUpdates] = useState<SlackProductUpdatesData | null>(null);
  const [slackProductUpdatesLoading, setSlackProductUpdatesLoading] = useState(false);
  const [slackProductUpdatesSyncLoading, setSlackProductUpdatesSyncLoading] = useState(false);
  const [selectedProductUpdateIds, setSelectedProductUpdateIds] = useState<string[]>([]);
  const fallbackMemeTemplates = useMemo(() => buildFallbackMemeTemplates(), []);
  const [memeTemplateOptions, setMemeTemplateOptions] = useState<MemeTemplateOption[]>(fallbackMemeTemplates);
  const [memeTemplateSearch, setMemeTemplateSearch] = useState("");
  const [memeTemplateLoadError, setMemeTemplateLoadError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const todayDate = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);
  const normalizedSelectedPostTypes = useMemo(
    () => (selectedPostTypes.length ? selectedPostTypes : [defaultForm.inputType]),
    [selectedPostTypes],
  );
  const normalizedSelectedBrandVoices = useMemo(
    () =>
      selectedBrandVoices.length
        ? selectedBrandVoices
        : [isBrandVoicePreset(defaultForm.style) ? defaultForm.style : CUSTOM_BRAND_VOICE],
    [selectedBrandVoices],
  );
  const normalizedSelectedGoals = useMemo(
    () => (selectedGoals.length ? selectedGoals : [defaultForm.goal]),
    [selectedGoals],
  );
  const showEventFields = useMemo(
    () => normalizedSelectedPostTypes.some((type) => needsEventDetails(type)),
    [normalizedSelectedPostTypes],
  );
  const showProductLaunchFields = useMemo(
    () => normalizedSelectedPostTypes.some((type) => needsProductFeatureLaunchSelection(type)),
    [normalizedSelectedPostTypes],
  );
  const calendarEntries = useMemo(() => notionCalendar?.entries ?? [], [notionCalendar?.entries]);
  const currentWeekRange = useMemo(() => getWeekRange(todayDate, 0), [todayDate]);
  const nextWeekRange = useMemo(() => getWeekRange(todayDate, 1), [todayDate]);
  const currentWeekRangeLabel = useMemo(() => formatWeekRangeLabel(currentWeekRange), [currentWeekRange]);
  const nextWeekRangeLabel = useMemo(() => formatWeekRangeLabel(nextWeekRange), [nextWeekRange]);
  const monthEntries = useMemo(() => {
    if (!calendarEntries.length) return [];
    return getEntriesForMonth(calendarEntries, calendarMonthCursor);
  }, [calendarEntries, calendarMonthCursor]);
  const currentWeekCalendarEntries = useMemo(
    () => getCalendarEntriesForWeek(calendarEntries, todayDate, 0),
    [calendarEntries, todayDate],
  );
  const nextWeekCalendarEntries = useMemo(
    () => getCalendarEntriesForWeek(calendarEntries, todayDate, 1),
    [calendarEntries, todayDate],
  );
  const missingFieldsByCalendarEntryId = useMemo(() => {
    const byId = new Map<string, CalendarEntryMissingField[]>();
    for (const entry of calendarEntries) {
      const missing = getCalendarEntryMissingFields(entry);
      if (missing.length) {
        byId.set(entry.id, missing);
      }
    }
    return byId;
  }, [calendarEntries]);
  const calendarEntriesMissingDate = useMemo(
    () => calendarEntries.filter((entry) => missingFieldsByCalendarEntryId.get(entry.id)?.includes("date")),
    [calendarEntries, missingFieldsByCalendarEntryId],
  );
  const selectedCalendarEntryIdSet = useMemo(() => new Set(selectedCalendarEntryIds), [selectedCalendarEntryIds]);
  const selectedCalendarEntries = useMemo(() => {
    if (!calendarEntries.length || !selectedCalendarEntryIds.length) {
      return [];
    }

    const selectedIds = new Set(selectedCalendarEntryIds);
    return calendarEntries
      .filter((entry) => selectedIds.has(entry.id))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }, [calendarEntries, selectedCalendarEntryIds]);
  const monthCalendarCells = useMemo(
    () => buildMonthCalendarCells(calendarEntries, calendarMonthCursor, todayDate),
    [calendarEntries, calendarMonthCursor, todayDate],
  );
  const calendarMonthLabel = useMemo(() => formatCalendarMonthLabel(calendarMonthCursor), [calendarMonthCursor]);
  const useNotionCalendarForGeneration = showEventFields && selectedCalendarEntries.length > 0;
  const productUpdateEntries = useMemo(() => slackProductUpdates?.entries ?? [], [slackProductUpdates?.entries]);
  const productUpdateMonthEntries = useMemo(
    () => getProductUpdateEntriesForMonth(productUpdateEntries, productUpdatesMonthCursor),
    [productUpdateEntries, productUpdatesMonthCursor],
  );
  const currentWeekProductUpdateEntries = useMemo(
    () => getProductUpdateEntriesForWeek(productUpdateEntries, todayDate, 0),
    [productUpdateEntries, todayDate],
  );
  const nextWeekProductUpdateEntries = useMemo(
    () => getProductUpdateEntriesForWeek(productUpdateEntries, todayDate, 1),
    [productUpdateEntries, todayDate],
  );
  const productUpdatesMonthCells = useMemo(
    () => buildProductUpdatesMonthCalendarCells(productUpdateEntries, productUpdatesMonthCursor, todayDate),
    [productUpdateEntries, productUpdatesMonthCursor, todayDate],
  );
  const productUpdatesMonthLabel = useMemo(
    () => formatCalendarMonthLabel(productUpdatesMonthCursor),
    [productUpdatesMonthCursor],
  );
  const selectedProductUpdateIdSet = useMemo(() => new Set(selectedProductUpdateIds), [selectedProductUpdateIds]);
  const selectedProductUpdateEntries = useMemo(() => {
    if (!productUpdateEntries.length || !selectedProductUpdateIds.length) {
      return [];
    }

    const selectedIds = new Set(selectedProductUpdateIds);
    return productUpdateEntries
      .filter((entry) => selectedIds.has(entry.id))
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
  }, [productUpdateEntries, selectedProductUpdateIds]);
  const useSlackProductUpdatesForGeneration = showProductLaunchFields && selectedProductUpdateEntries.length > 0;
  const plannedPostCountForCta = useMemo(() => {
    if (useNotionCalendarForGeneration) {
      return selectedCalendarEntries.length * form.numberOfPosts;
    }
    if (useSlackProductUpdatesForGeneration) {
      return selectedProductUpdateEntries.length * form.numberOfPosts;
    }
    return form.numberOfPosts;
  }, [
    form.numberOfPosts,
    selectedCalendarEntries.length,
    selectedProductUpdateEntries.length,
    useNotionCalendarForGeneration,
    useSlackProductUpdatesForGeneration,
  ]);
  const generatedPostIndicesByDate = useMemo(() => {
    const byDate = new Map<string, number[]>();
    if (!result?.posts.length) {
      return byDate;
    }

    for (let index = 0; index < result.posts.length; index += 1) {
      const dateKey = postDateByPostIndex[index];
      if (!dateKey || !parseCalendarDate(dateKey)) {
        continue;
      }

      const existing = byDate.get(dateKey);
      if (existing) {
        existing.push(index);
      } else {
        byDate.set(dateKey, [index]);
      }
    }

    return byDate;
  }, [postDateByPostIndex, result?.posts]);
  const generatedPostDates = useMemo(() => Array.from(generatedPostIndicesByDate.keys()).sort(), [generatedPostIndicesByDate]);
  const selectedGeneratedPostsDateSet = useMemo(
    () => new Set(selectedGeneratedPostsDates),
    [selectedGeneratedPostsDates],
  );
  const generatedPostsMonthCells = useMemo(
    () => buildGeneratedPostsCalendarCells(generatedPostIndicesByDate, generatedPostsMonthCursor, todayDate),
    [generatedPostIndicesByDate, generatedPostsMonthCursor, todayDate],
  );
  const generatedPostsMonthLabel = useMemo(
    () => formatCalendarMonthLabel(generatedPostsMonthCursor),
    [generatedPostsMonthCursor],
  );
  const filteredGeneratedPostIndices = useMemo(() => {
    if (!result?.posts.length) {
      return [];
    }

    if (!selectedGeneratedPostsDates.length) {
      return result.posts.map((_, index) => index);
    }

    const selectedPostIndexSet = new Set<number>();
    for (const dateKey of selectedGeneratedPostsDates) {
      const indices = generatedPostIndicesByDate.get(dateKey);
      if (!indices?.length) {
        continue;
      }
      for (const postIndex of indices) {
        selectedPostIndexSet.add(postIndex);
      }
    }

    if (selectedPostIndexSet.size) {
      return result.posts.map((_, index) => index).filter((index) => selectedPostIndexSet.has(index));
    }

    return result.posts.map((_, index) => index);
  }, [generatedPostIndicesByDate, result?.posts, selectedGeneratedPostsDates]);
  const showMemeFields = normalizedSelectedPostTypes.length > 0;
  const showChartFields = useMemo(
    () => normalizedSelectedPostTypes.some((type) => needsChartDetails(type)),
    [normalizedSelectedPostTypes],
  );
  const showGiphyFields = normalizedSelectedPostTypes.length > 0;
  const groupedIndustryRssFeeds = useMemo(() => {
    const grouped: Record<FeedCategory, RssFeed[]> = {
      platform: [],
      monetization: [],
      growth: [],
    };

    for (const feed of RSS_FEEDS) {
      if (!feed.enabled) {
        continue;
      }
      grouped[feed.category].push(feed);
    }

    return grouped;
  }, []);
  const enabledIndustryRssCount = useMemo(
    () => RSS_FEEDS.filter((feed) => feed.enabled).length,
    [],
  );
  const selectedPostTypeSummary = useMemo(
    () => summarizeSelectedItems(normalizedSelectedPostTypes, defaultForm.inputType),
    [normalizedSelectedPostTypes],
  );
  const showCustomBrandVoiceInput = normalizedSelectedBrandVoices.includes(CUSTOM_BRAND_VOICE);
  const selectedBrandVoiceSummary = useMemo(
    () =>
      summarizeSelectedItems(
        normalizedSelectedBrandVoices.map((voice) => {
          if (voice === CUSTOM_BRAND_VOICE) {
            return "Custom";
          }
          return isBrandVoicePreset(voice) ? BRAND_VOICE_PROFILES[voice].label : voice;
        }),
        "Custom",
      ),
    [normalizedSelectedBrandVoices],
  );
  const selectedGoalSummary = useMemo(
    () => summarizeSelectedItems(normalizedSelectedGoals.map((goal) => GOAL_LABELS[goal]), GOAL_LABELS[defaultForm.goal]),
    [normalizedSelectedGoals],
  );
  const chartTypeSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(CHART_TYPE_OPTIONS.map((chartType) => CHART_TYPE_LABELS[chartType]), {
        minCh: 12,
        maxCh: 22,
        paddingCh: 5,
      }),
    [],
  );
  const chartLegendSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(CHART_LEGEND_POSITIONS.map((position) => getLegendLabel(position)), {
        minCh: 12,
        maxCh: 20,
        paddingCh: 5,
      }),
    [],
  );
  const chartVisualStyleSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(
        CHART_VISUAL_STYLE_OPTIONS.map((style) => formatChartVisualStyleLabel(style)),
        {
          minCh: 16,
          maxCh: 24,
          paddingCh: 5,
        },
      ),
    [],
  );
  const inputLengthSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(INPUT_LENGTH_OPTIONS.map((length) => formatLengthLabel(length)), {
        minCh: 12,
        maxCh: 20,
        paddingCh: 5,
      }),
    [],
  );
  const canCreateXPosts = form.inputLength === "long" || form.inputLength === "very long";

  const subtitle = useMemo(() => {
    const scopeParts: string[] = [];
    if (normalizedSelectedPostTypes.length > 1) {
      scopeParts.push(`${normalizedSelectedPostTypes.length} post types`);
    }
    if (normalizedSelectedBrandVoices.length > 1) {
      scopeParts.push(`${normalizedSelectedBrandVoices.length} brand voices`);
    }
    if (normalizedSelectedGoals.length > 1) {
      scopeParts.push(`${normalizedSelectedGoals.length} goals`);
    }
    const scopeSuffix = scopeParts.length ? ` across ${scopeParts.join(", ")}` : "";

    if (form.inputLength !== "mix") {
      return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""}${scopeSuffix} in ${formatLengthLabel(form.inputLength)} format`;
    }

    return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""}${scopeSuffix} with mixed lengths (Short, Medium, Long, Very Long)`;
  }, [form.inputLength, form.numberOfPosts, normalizedSelectedBrandVoices.length, normalizedSelectedGoals.length, normalizedSelectedPostTypes.length]);
  const totalMemeVariants = useMemo(() => {
    const posts = Math.max(1, Number(form.numberOfPosts) || 1);
    const perPost = Math.max(1, Number(form.memeVariantCount) || defaultForm.memeVariantCount);
    return posts * perPost;
  }, [form.numberOfPosts, form.memeVariantCount]);
  const chartRows = useMemo(
    () =>
      buildChartRows({
        chartType: form.chartType,
        chartLabels: form.chartLabels,
        chartSeriesOneValues: form.chartSeriesOneValues,
        chartSeriesTwoValues: form.chartSeriesTwoValues,
      }),
    [form.chartType, form.chartLabels, form.chartSeriesOneValues, form.chartSeriesTwoValues],
  );
  const memeTemplateNameById = useMemo(() => {
    const map: Record<string, string> = { ...MEME_TEMPLATE_LABELS };
    for (const template of memeTemplateOptions) {
      map[template.id] = template.name;
    }
    return map;
  }, [memeTemplateOptions]);
  const filteredMemeTemplates = useMemo(() => {
    const query = memeTemplateSearch.trim().toLowerCase();
    const filtered = query
      ? memeTemplateOptions.filter(
          (template) =>
            template.name.toLowerCase().includes(query) ||
            template.id.toLowerCase().includes(query),
        )
      : memeTemplateOptions;

    return filtered.slice(0, MAX_TEMPLATE_RESULTS);
  }, [memeTemplateOptions, memeTemplateSearch]);
  const totalMemeTemplateMatches = useMemo(() => {
    const query = memeTemplateSearch.trim().toLowerCase();
    if (!query) {
      return memeTemplateOptions.length;
    }

    return memeTemplateOptions.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.id.toLowerCase().includes(query),
    ).length;
  }, [memeTemplateOptions, memeTemplateSearch]);

  function applyBrandVoiceSelection(nextValue: string) {
    const isSelected = selectedBrandVoices.includes(nextValue);

    if (isSelected && selectedBrandVoices.length === 1) {
      return;
    }

    const nextSelected = isSelected
      ? selectedBrandVoices.filter((voice) => voice !== nextValue)
      : [...selectedBrandVoices, nextValue];
    const effectiveSelected = nextSelected.length ? nextSelected : [nextValue];

    setSelectedBrandVoices(effectiveSelected);

    setForm((prev) => {
      const hasCustom = effectiveSelected.includes(CUSTOM_BRAND_VOICE);
      const firstPreset = effectiveSelected.find((voice): voice is (typeof BRAND_VOICE_PRESETS)[number] =>
        isBrandVoicePreset(voice),
      );

      if (hasCustom) {
        return {
          ...prev,
          style: isBrandVoicePreset(prev.style) ? "" : prev.style,
        };
      }

      return {
        ...prev,
        style: firstPreset ?? prev.style,
      };
    });
  }

  function applyGoalSelection(nextGoal: ContentGoal) {
    const isSelected = selectedGoals.includes(nextGoal);

    if (isSelected && selectedGoals.length === 1) {
      return;
    }

    const nextSelected = isSelected ? selectedGoals.filter((goal) => goal !== nextGoal) : [...selectedGoals, nextGoal];
    const effectiveSelected = nextSelected.length ? nextSelected : [nextGoal];
    setSelectedGoals(effectiveSelected);

    setForm((prev) => ({
      ...prev,
      goal: effectiveSelected[0] ?? prev.goal,
    }));
  }

  function applyPostTypeSelection(nextType: string) {
    const isSelected = selectedPostTypes.includes(nextType);

    if (isSelected && selectedPostTypes.length === 1) {
      return;
    }

    const nextSelected = isSelected
      ? selectedPostTypes.filter((type) => type !== nextType)
      : [...selectedPostTypes, nextType];
    const effectiveSelected = nextSelected.length ? nextSelected : [nextType];

    setSelectedPostTypes(effectiveSelected);
    setForm((prev) => ({
      ...prev,
      inputType: effectiveSelected[0] ?? prev.inputType,
      time: effectiveSelected.some((type) => needsEventDetails(type)) ? prev.time : "",
      place: effectiveSelected.some((type) => needsEventDetails(type)) ? prev.place : "",
      chartEnabled: effectiveSelected.some((type) => needsChartDetails(type)) ? prev.chartEnabled : false,
    }));
  }

  function commitNumberOfPostsInput(): number {
    const raw = numberOfPostsInput.trim();
    if (!raw) {
      setNumberOfPostsInput(String(form.numberOfPosts));
      return form.numberOfPosts;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setNumberOfPostsInput(String(form.numberOfPosts));
      return form.numberOfPosts;
    }

    const normalized = Math.min(20, Math.max(1, Math.trunc(parsed)));

    setNumberOfPostsInput(String(normalized));
    setForm((prev) => {
      if (prev.numberOfPosts === normalized) {
        return prev;
      }

      return {
        ...prev,
        numberOfPosts: normalized,
      };
    });

    return normalized;
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadMemegenTemplates() {
      try {
        const response = await fetch("https://api.memegen.link/templates/");

        if (!response.ok) {
          throw new Error(`template fetch failed with status ${response.status}`);
        }

        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) {
          throw new Error("template payload is not an array");
        }

        const mappedTemplates = mapMemegenTemplateItems(payload as MemegenTemplateApiItem[]);
        if (!mappedTemplates.length) {
          throw new Error("template payload is empty");
        }

        if (isCancelled) {
          return;
        }

        setMemeTemplateOptions(mappedTemplates);
        setMemeTemplateLoadError("");
      } catch (loadError) {
        if (isCancelled) {
          return;
        }

        setMemeTemplateOptions(fallbackMemeTemplates);
        setMemeTemplateLoadError(
          loadError instanceof Error
            ? "Using fallback template list because Memegen template fetch failed."
            : "Using fallback template list.",
        );
      }
    }

    loadMemegenTemplates();

    return () => {
      isCancelled = true;
    };
  }, [fallbackMemeTemplates]);

  useEffect(() => {
    if (!showEventFields) return;
    let isCancelled = false;
    setNotionCalendarLoading(true);
    fetch("/api/notion-calendar")
      .then((r) => r.json())
      .then((data: NotionCalendarData) => {
        if (!isCancelled) setNotionCalendar(data);
      })
      .catch(() => {
        if (!isCancelled) setNotionCalendar(null);
      })
      .finally(() => {
        if (!isCancelled) setNotionCalendarLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [showEventFields]);

  useEffect(() => {
    if (!showProductLaunchFields) return;
    let isCancelled = false;
    setSlackProductUpdatesLoading(true);
    fetch("/api/slack-product-updates")
      .then((response) => response.json())
      .then((data: SlackProductUpdatesData) => {
        if (!isCancelled) {
          setSlackProductUpdates(data);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSlackProductUpdates(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setSlackProductUpdatesLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [showProductLaunchFields]);

  useEffect(() => {
    if (!calendarEntries.length) {
      return;
    }

    setCalendarMonthCursor((currentCursor) => {
      if (getEntriesForMonth(calendarEntries, currentCursor).length) {
        return currentCursor;
      }

      const firstEntry = [...calendarEntries].sort((a, b) => a.date.localeCompare(b.date))[0];
      const firstEntryDate = firstEntry ? parseCalendarDate(firstEntry.date) : null;
      return firstEntryDate ? getStartOfMonth(firstEntryDate) : currentCursor;
    });
  }, [calendarEntries]);

  useEffect(() => {
    if (!productUpdateEntries.length) {
      return;
    }

    setProductUpdatesMonthCursor((currentCursor) => {
      if (getProductUpdateEntriesForMonth(productUpdateEntries, currentCursor).length) {
        return currentCursor;
      }

      const firstEntry = [...productUpdateEntries]
        .filter((entry) => Boolean(parseCalendarDate(entry.releaseDate)))
        .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name))[0];
      const firstEntryDate = firstEntry ? parseCalendarDate(firstEntry.releaseDate) : null;
      return firstEntryDate ? getStartOfMonth(firstEntryDate) : currentCursor;
    });
  }, [productUpdateEntries]);

  useEffect(() => {
    if (!calendarEntries.length) {
      setSelectedCalendarEntryIds([]);
      return;
    }

    setSelectedCalendarEntryIds((previous) => {
      const validIds = new Set(calendarEntries.map((entry) => entry.id));
      return previous.filter((id) => validIds.has(id));
    });
  }, [calendarEntries]);

  useEffect(() => {
    if (!productUpdateEntries.length) {
      setSelectedProductUpdateIds([]);
      return;
    }

    setSelectedProductUpdateIds((previous) => {
      const validIds = new Set(productUpdateEntries.map((entry) => entry.id));
      return previous.filter((id) => validIds.has(id));
    });
  }, [productUpdateEntries]);

  useEffect(() => {
    if (!generatedPostDates.length) {
      setSelectedGeneratedPostsDates([]);
      return;
    }

    setGeneratedPostsMonthCursor((currentCursor) => {
      const monthKey = formatCalendarMonthKey(currentCursor);
      if (generatedPostDates.some((date) => date.startsWith(`${monthKey}-`))) {
        return currentCursor;
      }

      const firstDate = parseCalendarDate(generatedPostDates[0]);
      return firstDate ? getStartOfMonth(firstDate) : currentCursor;
    });

    setSelectedGeneratedPostsDates((previous) => previous.filter((date) => generatedPostIndicesByDate.has(date)));
  }, [generatedPostDates, generatedPostIndicesByDate]);

  useEffect(() => {
    if (canCreateXPosts) {
      return;
    }

    setForm((prev) => (prev.createXPosts ? { ...prev, createXPosts: false } : prev));
  }, [canCreateXPosts]);

  async function reloadNotionCalendar() {
    setNotionCalendarSyncLoading(true);
    try {
      const cal = await fetch("/api/notion-calendar").then((res) => res.json());
      setNotionCalendar(cal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    } finally {
      setNotionCalendarSyncLoading(false);
    }
  }

  async function reloadSlackProductUpdates() {
    setSlackProductUpdatesSyncLoading(true);
    try {
      const feed = (await fetch("/api/slack-product-updates").then((res) => res.json())) as SlackProductUpdatesData;
      setSlackProductUpdates(feed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    } finally {
      setSlackProductUpdatesSyncLoading(false);
    }
  }

  function showPreviousCalendarMonth() {
    setCalendarMonthCursor((current) => shiftMonth(current, -1));
  }

  function showNextCalendarMonth() {
    setCalendarMonthCursor((current) => shiftMonth(current, 1));
  }

  function jumpToCurrentCalendarMonth() {
    setCalendarMonthCursor(getStartOfMonth(todayDate));
  }

  function toggleCalendarEntrySelection(entryId: string) {
    setSelectedCalendarEntryIds((previous) =>
      previous.includes(entryId) ? previous.filter((id) => id !== entryId) : [...previous, entryId],
    );
  }

  function selectAllEntriesInCurrentMonth() {
    const monthIds = monthEntries.map((entry) => entry.id);
    if (!monthIds.length) {
      return;
    }

    setSelectedCalendarEntryIds((previous) => Array.from(new Set([...previous, ...monthIds])));
  }

  function clearCurrentMonthSelections() {
    if (!monthEntries.length) {
      return;
    }

    const monthIds = new Set(monthEntries.map((entry) => entry.id));
    setSelectedCalendarEntryIds((previous) => previous.filter((id) => !monthIds.has(id)));
  }

  function selectCalendarEntriesForWeek(weekOffset: number) {
    const weekEntries = getCalendarEntriesForWeek(calendarEntries, todayDate, weekOffset);
    const weekIds = weekEntries.map((entry) => entry.id);
    setSelectedCalendarEntryIds(weekIds);
    const weekRange = getWeekRange(todayDate, weekOffset);
    setCalendarMonthCursor(getStartOfMonth(weekRange.start));
  }

  function toggleProductUpdateSelection(entryId: string) {
    setSelectedProductUpdateIds((previous) =>
      previous.includes(entryId) ? previous.filter((id) => id !== entryId) : [...previous, entryId],
    );
  }

  function showPreviousProductUpdatesMonth() {
    setProductUpdatesMonthCursor((current) => shiftMonth(current, -1));
  }

  function showNextProductUpdatesMonth() {
    setProductUpdatesMonthCursor((current) => shiftMonth(current, 1));
  }

  function jumpToCurrentProductUpdatesMonth() {
    setProductUpdatesMonthCursor(getStartOfMonth(todayDate));
  }

  function selectAllProductUpdatesInCurrentMonth() {
    const monthIds = productUpdateMonthEntries.map((entry) => entry.id);
    if (!monthIds.length) {
      return;
    }

    setSelectedProductUpdateIds((previous) => Array.from(new Set([...previous, ...monthIds])));
  }

  function clearCurrentProductUpdatesMonthSelections() {
    if (!productUpdateMonthEntries.length) {
      return;
    }

    const monthIds = new Set(productUpdateMonthEntries.map((entry) => entry.id));
    setSelectedProductUpdateIds((previous) => previous.filter((id) => !monthIds.has(id)));
  }

  function selectProductUpdatesForWeek(weekOffset: number) {
    const weekEntries = getProductUpdateEntriesForWeek(productUpdateEntries, todayDate, weekOffset);
    const weekIds = weekEntries.map((entry) => entry.id);
    setSelectedProductUpdateIds(weekIds);
    const weekRange = getWeekRange(todayDate, weekOffset);
    setProductUpdatesMonthCursor(getStartOfMonth(weekRange.start));
  }

  function showPreviousGeneratedPostsMonth() {
    setGeneratedPostsMonthCursor((current) => shiftMonth(current, -1));
  }

  function showNextGeneratedPostsMonth() {
    setGeneratedPostsMonthCursor((current) => shiftMonth(current, 1));
  }

  function jumpToGeneratedPostsCurrentMonth() {
    setGeneratedPostsMonthCursor(getStartOfMonth(todayDate));
  }

  function toggleGeneratedPostsDateSelection(dateKey: string) {
    setSelectedGeneratedPostsDates((previous) =>
      previous.includes(dateKey) ? previous.filter((existingDate) => existingDate !== dateKey) : [...previous, dateKey],
    );
  }

  function updateChartRows(
    updater: (rows: Array<{ label: string; primary: string; secondary: string }>) => Array<{
      label: string;
      primary: string;
      secondary: string;
    }>,
  ) {
    setForm((prev) => {
      const currentRows = buildChartRows({
        chartType: prev.chartType,
        chartLabels: prev.chartLabels,
        chartSeriesOneValues: prev.chartSeriesOneValues,
        chartSeriesTwoValues: prev.chartSeriesTwoValues,
      });

      const nextRows = updater(currentRows);
      const nextLabels = trimTrailingEmpty(nextRows.map((row) => row.label));
      const nextPrimary = trimTrailingEmpty(nextRows.map((row) => row.primary));
      const nextSecondary = trimTrailingEmpty(nextRows.map((row) => row.secondary));

      return {
        ...prev,
        chartLabels: nextLabels.join(", "),
        chartSeriesOneValues: nextPrimary.join(", "),
        chartSeriesTwoValues: nextSecondary.join(", "),
      };
    });
  }

  function applyChartWizardPreset(preset: ChartWizardPreset) {
    setForm((prev) => ({
      ...prev,
      chartType: preset.chartType,
      chartTitle: preset.chartTitle,
      chartLegendPosition: preset.chartLegendPosition,
      chartSeriesOneLabel: preset.chartSeriesOneLabel,
      chartSeriesTwoLabel: preset.chartSeriesTwoLabel,
      chartVisualStyle: preset.chartVisualStyle,
      chartImagePrompt: preset.chartImagePrompt,
      chartLabels: preset.chartLabels,
      chartSeriesOneValues: preset.chartSeriesOneValues,
      chartSeriesTwoValues: preset.chartSeriesTwoValues,
    }));
  }

  function applyChartPromptQuickSuggestion(prompt: string) {
    setChartPromptError("");
    setChartPromptHint("Suggestion applied.");
    setForm((prev) => ({
      ...prev,
      chartImagePrompt: prompt,
    }));
  }

  async function generateChartPromptWithAi() {
    setChartPromptError("");
    setChartPromptHint("");
    setIsChartPromptLoading(true);

    try {
      const response = await fetch("/api/chart-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style: form.style,
          goal: form.goal,
          inputType: form.inputType,
          details: form.details,
          chartType: form.chartType,
          chartTitle: form.chartTitle,
          chartVisualStyle: form.chartVisualStyle,
          chartLegendPosition: form.chartLegendPosition,
          chartSeriesOneLabel: form.chartSeriesOneLabel,
          chartSeriesTwoLabel: form.chartSeriesTwoLabel,
          chartLabels: form.chartLabels,
          chartSeriesOneValues: form.chartSeriesOneValues,
          chartSeriesTwoValues: form.chartSeriesTwoValues,
        }),
      });

      const responsePayload = await response.json();
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(responsePayload, response.status));
      }

      const prompt =
        responsePayload &&
        typeof responsePayload === "object" &&
        "prompt" in responsePayload &&
        typeof (responsePayload as { prompt?: unknown }).prompt === "string"
          ? normalizeNoEmDash((responsePayload as { prompt: string }).prompt).trim()
          : "";

      if (!prompt) {
        throw new Error("AI did not return a prompt suggestion.");
      }

      setForm((prev) => ({
        ...prev,
        chartImagePrompt: prompt,
      }));
      setChartPromptHint("AI suggestion applied.");
    } catch (suggestionError) {
      setChartPromptError(
        suggestionError instanceof Error ? suggestionError.message : "Could not generate chart prompt suggestion.",
      );
    } finally {
      setIsChartPromptLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const committedNumberOfPosts = commitNumberOfPostsInput();
    setError("");
    setResult(null);
    setIsLoading(true);
    setRewritePromptByPost({});
    setManualLineDraftByPost({});
    setManualCtaDraftByPost({});
    setSelectedLineByPost({});
    setSelectedCtaByPost({});
    setRewriteErrorByPost({});
    setLineFeedbackByPost({});
    setCopyFeedbackByPostAction({});
    setRewriteLoadingKey(null);
    setPostTypeByPostIndex({});
    setBrandVoiceByPostIndex({});
    setGoalByPostIndex({});
    setPostDateByPostIndex({});
    setPostEventLabelByPostIndex({});
    setPostImageDataUrlByPostIndex({});
    setPostSourceImageUrlByPostIndex({});
    setPostCtaLinkByPostIndex({});
    setSelectedGeneratedPostsDates([]);

    if (isImageProcessing) {
      setError("Image is still processing. Please wait a second and retry.");
      setIsLoading(false);
      return;
    }

    try {
      const customBrandVoiceText = form.style.trim();
      if (normalizedSelectedBrandVoices.includes(CUSTOM_BRAND_VOICE) && !customBrandVoiceText) {
        setError("Custom Brand Voice is selected. Add custom voice instructions or deselect Custom.");
        setIsLoading(false);
        return;
      }

      const selectedStylesForGeneration = Array.from(
        new Set(
          normalizedSelectedBrandVoices
            .map((voice) => (voice === CUSTOM_BRAND_VOICE ? customBrandVoiceText : voice.trim()))
            .filter(Boolean),
        ),
      );
      let generationAllocations: GenerationAllocation[] = [];
      const contextStyle = selectedStylesForGeneration[0] ?? defaultForm.style;
      const contextGoal = normalizedSelectedGoals[0] ?? defaultForm.goal;
      const selectedEventPostType =
        normalizedSelectedPostTypes.find((type) => needsEventDetails(type)) ?? POST_TYPE_OPTIONS[1];
      const selectedProductLaunchPostType =
        normalizedSelectedPostTypes.find((type) => needsProductFeatureLaunchSelection(type)) ?? POST_TYPE_OPTIONS[0];

      if (useNotionCalendarForGeneration) {
        generationAllocations = generationAllocations.concat(
          selectedCalendarEntries.map((entry) => ({
            inputType: selectedEventPostType,
            style: contextStyle,
            goal: contextGoal,
            count: committedNumberOfPosts,
            calendarEntry: entry,
          })),
        );
      }

      if (useSlackProductUpdatesForGeneration) {
        generationAllocations = generationAllocations.concat(
          selectedProductUpdateEntries.map((entry) => ({
            inputType: selectedProductLaunchPostType,
            style: contextStyle,
            goal: contextGoal,
            count: committedNumberOfPosts,
            productUpdateEntry: entry,
          })),
        );
      }

      if (!generationAllocations.length) {
        generationAllocations = buildGenerationAllocations({
          inputTypes: normalizedSelectedPostTypes,
          styles: selectedStylesForGeneration,
          goals: normalizedSelectedGoals,
          totalPosts: committedNumberOfPosts,
        });
      }
      if (!generationAllocations.length) {
        setError("Please select at least one post type.");
        setIsLoading(false);
        return;
      }

      const sharedCtaLink = form.ctaLink.trim();
      const getDefaultCtaLinkForAllocation = (allocation: GenerationAllocation): string => {
        if (allocation.productUpdateEntry) {
          return normalizeCtaLink(sharedCtaLink);
        }

        if (sharedCtaLink) {
          return sharedCtaLink;
        }

        const calendarCtaLink = allocation.calendarEntry?.event?.eventPage?.trim() ?? "";
        return calendarCtaLink;
      };
      const requestedPerPostCtaLinks = ctaLinkMode === "per_post" ? splitMultilineUrls(perPostCtaLinksInput) : [];
      let ctaLinkCursor = 0;
      const ctaLinksByAllocationIndex = generationAllocations.map((allocation) => {
        if (ctaLinkMode !== "per_post") {
          return [];
        }

        const defaultCtaLinkForAllocation = getDefaultCtaLinkForAllocation(allocation);
        const ctaLinksForAllocation = Array.from({ length: allocation.count }, () => {
          const rawCandidate = requestedPerPostCtaLinks[ctaLinkCursor] ?? defaultCtaLinkForAllocation;
          ctaLinkCursor += 1;

          if (allocation.productUpdateEntry) {
            return normalizeCtaLink(rawCandidate);
          }
          return rawCandidate.trim();
        });

        return ctaLinksForAllocation;
      });

      let chartDataPayload = "";
      let chartOptionsPayload = "";
      const shouldValidateChart =
        form.chartEnabled && generationAllocations.some((allocation) => needsChartDetails(allocation.inputType));

      if (shouldValidateChart) {
        const chartPayload = buildChartPayload(form);
        if ("error" in chartPayload) {
          setError(chartPayload.error);
          setIsLoading(false);
          return;
        }

        chartDataPayload = chartPayload.chartData;
        chartOptionsPayload = chartPayload.chartOptions;
      }

      const generationChunksByIndex: Array<
        {
          allocation: GenerationAllocation;
          response: GeneratePostsResponse;
          imageDataUrlsUsed: string[];
          sourceImageUrls: string[];
          ctaLinkUsed: string;
          ctaLinksUsed: string[];
        } | null
      > = new Array(generationAllocations.length).fill(null);
      const firstChartAllocationIndex = form.chartEnabled
        ? generationAllocations.findIndex((allocation) => needsChartDetails(allocation.inputType))
        : -1;

      let allocationErrorMessage = "";
      const concurrency = Math.max(1, Math.min(MAX_CONCURRENT_GENERATION_REQUESTS, generationAllocations.length));

      for (let startIndex = 0; startIndex < generationAllocations.length; startIndex += concurrency) {
        if (allocationErrorMessage) {
          break;
        }

        const currentBatch = generationAllocations.slice(startIndex, startIndex + concurrency);
        const settled = await Promise.allSettled(
          currentBatch.map(async (allocation, batchOffset) => {
            const allocationIndex = startIndex + batchOffset;
            const typeNeedsChart = needsChartDetails(allocation.inputType);
            const typeNeedsEvent = needsEventDetails(allocation.inputType);
            const shouldAttachChart =
              typeNeedsChart && form.chartEnabled && allocationIndex === firstChartAllocationIndex;

            const calendarEntry = allocation.calendarEntry;
            const productUpdateEntry = allocation.productUpdateEntry;
            const timeVal = calendarEntry ? (calendarEntry.event?.time ?? "") : form.time;
            const placeVal = calendarEntry ? (calendarEntry.event?.region ?? "") : form.place;
            const detailsVal = calendarEntry
              ? buildDetailsFromCalendarEntry(calendarEntry)
              : productUpdateEntry
                ? buildDetailsFromProductUpdateEntry(productUpdateEntry)
                : form.details;
            const defaultCtaLinkForAllocation = getDefaultCtaLinkForAllocation(allocation);
            const ctaLinksForRequest = ctaLinksByAllocationIndex[allocationIndex] ?? [];
            const ctaVal =
              ctaLinkMode === "per_post"
                ? defaultCtaLinkForAllocation
                : ctaLinksForRequest.find((link) => link.trim().length > 0) ?? defaultCtaLinkForAllocation;
            const sourceImageUrls = productUpdateEntry
              ? getTopProductUpdateImageUrls(productUpdateEntry, MAX_PRODUCT_UPDATE_IMAGES_PER_POST)
              : [];
            const shouldUseVisionContext = !productUpdateEntry && !calendarEntry;
            const imageDataUrlsForRequest = shouldUseVisionContext ? [form.imageDataUrl] : [];

            const normalizedImageDataUrlsForRequest = Array.from(
              new Set(
                imageDataUrlsForRequest
                  .map((value) => value.trim())
                  .filter((value) => value.startsWith("data:image/")),
              ),
            ).slice(0, MAX_MODEL_CONTEXT_IMAGES_PER_POST);
            const primaryImageDataUrlForRequest = normalizedImageDataUrlsForRequest[0] ?? "";

            const requestPayload = {
              ...form,
              createXPosts: canCreateXPosts ? form.createXPosts : false,
              style: allocation.style,
              goal: allocation.goal,
              inputType: allocation.inputType,
              numberOfPosts: allocation.count,
              imageDataUrl: primaryImageDataUrlForRequest,
              imageDataUrls: normalizedImageDataUrlsForRequest,
              chartEnabled: shouldAttachChart,
              chartType: shouldAttachChart ? form.chartType : defaultForm.chartType,
              chartTitle: shouldAttachChart ? form.chartTitle : "",
              chartVisualStyle: shouldAttachChart ? form.chartVisualStyle : defaultForm.chartVisualStyle,
              chartImagePrompt: shouldAttachChart ? form.chartImagePrompt : "",
              chartData: shouldAttachChart ? chartDataPayload : "",
              chartOptions: shouldAttachChart ? chartOptionsPayload : "",
              time: typeNeedsEvent ? formatEventTimeForPrompt(timeVal) : "",
              place: typeNeedsEvent ? placeVal : "",
              details: detailsVal,
              ctaLink: ctaVal,
              ctaLinks: ctaLinksForRequest,
              memeEnabled: form.memeEnabled,
              memeBrief: form.memeEnabled ? form.memeBrief : "",
              giphyEnabled: form.giphyEnabled,
              giphyQuery: form.giphyQuery,
              memeTemplateIds: form.memeEnabled ? form.memeTemplateIds : [],
              memeVariantCount: form.memeEnabled ? form.memeVariantCount : defaultForm.memeVariantCount,
            };

            const response = await fetch("/api/generate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(requestPayload),
            });

            const responsePayload = await response.json();

            if (!response.ok) {
              throw new Error(
                `[${allocation.inputType} | ${allocation.style} | ${GOAL_LABELS[allocation.goal]}] ${extractApiErrorMessage(responsePayload, response.status)}`,
              );
            }

            return {
              allocationIndex,
              allocation,
              response: sanitizeGenerationResult(responsePayload as GeneratePostsResponse),
              imageDataUrlsUsed: normalizedImageDataUrlsForRequest,
              sourceImageUrls,
              ctaLinkUsed: ctaVal,
              ctaLinksUsed: ctaLinksForRequest,
            };
          }),
        );

        for (const item of settled) {
          if (item.status === "fulfilled") {
            generationChunksByIndex[item.value.allocationIndex] = {
              allocation: item.value.allocation,
              response: item.value.response,
              imageDataUrlsUsed: item.value.imageDataUrlsUsed,
              sourceImageUrls: item.value.sourceImageUrls,
              ctaLinkUsed: item.value.ctaLinkUsed,
              ctaLinksUsed: item.value.ctaLinksUsed,
            };
            continue;
          }

          allocationErrorMessage =
            item.reason instanceof Error ? item.reason.message : "One generation request failed.";
          break;
        }
      }

      if (allocationErrorMessage) {
        setError(allocationErrorMessage);
        return;
      }

      const generationChunks = generationChunksByIndex.filter(
        (chunk): chunk is {
          allocation: GenerationAllocation;
          response: GeneratePostsResponse;
          imageDataUrlsUsed: string[];
          sourceImageUrls: string[];
          ctaLinkUsed: string;
          ctaLinksUsed: string[];
        } => Boolean(chunk),
      );

      if (!generationChunks.length) {
        setError("No posts were generated.");
        return;
      }

      const nextPostTypeByIndex: Record<number, string> = {};
      const nextBrandVoiceByIndex: Record<number, string> = {};
      const nextGoalByIndex: Record<number, ContentGoal> = {};
      const nextPostDateByIndex: Record<number, string> = {};
      const nextPostEventLabelByIndex: Record<number, string> = {};
      const nextPostImageDataUrlByIndex: Record<number, string[]> = {};
      const nextPostSourceImageUrlByIndex: Record<number, string[]> = {};
      const nextPostCtaLinkByIndex: Record<number, string> = {};
      const mergedPosts: GeneratePostsResponse["posts"] = [];
      let postCursor = 0;

      for (const chunk of generationChunks) {
        for (let chunkPostIndex = 0; chunkPostIndex < chunk.response.posts.length; chunkPostIndex += 1) {
          const post = chunk.response.posts[chunkPostIndex];
          nextPostTypeByIndex[postCursor] = chunk.allocation.inputType;
          nextBrandVoiceByIndex[postCursor] = chunk.allocation.style;
          nextGoalByIndex[postCursor] = chunk.allocation.goal;
          const generatedDate =
            chunk.allocation.calendarEntry?.date ||
            chunk.allocation.productUpdateEntry?.releaseDate ||
            extractDateKeyFromDateTimeInput(form.time);
          if (generatedDate) {
            nextPostDateByIndex[postCursor] = generatedDate;
          }
          const generatedEventLabel =
            chunk.allocation.calendarEntry?.event?.eventName?.trim() ||
            chunk.allocation.calendarEntry?.name?.trim() ||
            chunk.allocation.productUpdateEntry?.name?.trim() ||
            "";
          if (generatedEventLabel) {
            nextPostEventLabelByIndex[postCursor] = generatedEventLabel;
          }
          if (chunk.imageDataUrlsUsed.length) {
            nextPostImageDataUrlByIndex[postCursor] = [...chunk.imageDataUrlsUsed];
          }
          if (chunk.sourceImageUrls.length) {
            nextPostSourceImageUrlByIndex[postCursor] = [...chunk.sourceImageUrls];
          }
          const requestedCtaLinkForPost = chunk.ctaLinksUsed[chunkPostIndex];
          const ctaLinkForPost = requestedCtaLinkForPost?.trim() ? requestedCtaLinkForPost : chunk.ctaLinkUsed;
          nextPostCtaLinkByIndex[postCursor] = ctaLinkForPost;
          mergedPosts.push({
            ...post,
            cta: ensureFinalCtaText(post.cta, ctaLinkForPost),
          });
          postCursor += 1;
        }
      }

      const postLimit =
        useNotionCalendarForGeneration || useSlackProductUpdatesForGeneration ? mergedPosts.length : committedNumberOfPosts;
      const trimmedPosts = mergedPosts.slice(0, postLimit);
      const trimmedPostTypeByIndex: Record<number, string> = {};
      const trimmedBrandVoiceByIndex: Record<number, string> = {};
      const trimmedGoalByIndex: Record<number, ContentGoal> = {};
      const trimmedPostDateByIndex: Record<number, string> = {};
      const trimmedPostEventLabelByIndex: Record<number, string> = {};
      const trimmedPostImageDataUrlByIndex: Record<number, string[]> = {};
      const trimmedPostSourceImageUrlByIndex: Record<number, string[]> = {};
      const trimmedPostCtaLinkByIndex: Record<number, string> = {};

      for (let index = 0; index < trimmedPosts.length; index += 1) {
        if (Object.prototype.hasOwnProperty.call(nextPostTypeByIndex, index)) {
          trimmedPostTypeByIndex[index] = nextPostTypeByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextBrandVoiceByIndex, index)) {
          trimmedBrandVoiceByIndex[index] = nextBrandVoiceByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextGoalByIndex, index)) {
          trimmedGoalByIndex[index] = nextGoalByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextPostDateByIndex, index)) {
          trimmedPostDateByIndex[index] = nextPostDateByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextPostEventLabelByIndex, index)) {
          trimmedPostEventLabelByIndex[index] = nextPostEventLabelByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextPostImageDataUrlByIndex, index)) {
          trimmedPostImageDataUrlByIndex[index] = nextPostImageDataUrlByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextPostSourceImageUrlByIndex, index)) {
          trimmedPostSourceImageUrlByIndex[index] = nextPostSourceImageUrlByIndex[index];
        }
        if (Object.prototype.hasOwnProperty.call(nextPostCtaLinkByIndex, index)) {
          trimmedPostCtaLinkByIndex[index] = nextPostCtaLinkByIndex[index];
        }
      }

      const mergedHooks = Array.from(
        new Set(
          generationChunks
            .flatMap((chunk) => chunk.response.hooks)
            .map((hook) => hook.trim())
            .filter(Boolean),
        ),
      ).slice(0, 20);
      const firstChunk = generationChunks[0].response;
      const generationModelSet = new Set(generationChunks.map((chunk) => chunk.response.generation.modelUsed));
      const oauthSourceSet = new Set(
        generationChunks
          .map((chunk) => chunk.response.generation.oauthSource)
          .filter((value): value is "env" | "codex-auth-json" => Boolean(value)),
      );
      const mergedResult: GeneratePostsResponse = {
        ...firstChunk,
        hooks: mergedHooks,
        chart: generationChunks.map((chunk) => chunk.response.chart).find(Boolean),
        posts: trimmedPosts,
        giphyRequested: generationChunks.some((chunk) => chunk.response.giphyRequested),
        generation: {
          modelRequested: firstChunk.generation.modelRequested,
          modelUsed: generationModelSet.size === 1 ? firstChunk.generation.modelUsed : "mixed",
          fallbackUsed: generationChunks.some((chunk) => chunk.response.generation.fallbackUsed),
          baseUrlType: generationChunks.some((chunk) => chunk.response.generation.baseUrlType === "custom")
            ? "custom"
            : "openai",
          authMode: generationChunks.some((chunk) => chunk.response.generation.authMode === "oauth")
            ? "oauth"
            : "api_key",
          oauthSource: oauthSourceSet.size === 1 ? Array.from(oauthSourceSet)[0] : undefined,
        },
        retrieval: {
          method: generationChunks.some((chunk) => chunk.response.retrieval.method === "lancedb") ? "lancedb" : "lexical",
          goalUsed: generationAllocations[0]?.goal ?? form.goal,
          examplesUsed: generationChunks.reduce((sum, chunk) => sum + chunk.response.retrieval.examplesUsed, 0),
          performancePostsAnalyzed: generationChunks.reduce(
            (sum, chunk) => sum + chunk.response.retrieval.performancePostsAnalyzed,
            0,
          ),
          performanceInsightsUsed: generationChunks.reduce(
            (sum, chunk) => sum + chunk.response.retrieval.performanceInsightsUsed,
            0,
          ),
          evidenceSources:
            firstChunk.retrieval.evidenceSources ?? generationChunks[0]?.response.retrieval.evidenceSources,
        },
      };

      const nextRewriteContext: RewriteContext = {
        style: generationAllocations[0]?.style ?? form.style,
        goal: generationAllocations[0]?.goal ?? form.goal,
        inputType: generationAllocations[0]?.inputType ?? form.inputType,
        ctaLink:
          trimmedPostCtaLinkByIndex[0]?.trim()
            ? trimmedPostCtaLinkByIndex[0]
            : generationAllocations[0]?.productUpdateEntry
              ? normalizeCtaLink(form.ctaLink)
              : form.ctaLink,
        details: form.details,
      };
      setPostTypeByPostIndex(trimmedPostTypeByIndex);
      setBrandVoiceByPostIndex(trimmedBrandVoiceByIndex);
      setGoalByPostIndex(trimmedGoalByIndex);
      setPostDateByPostIndex(trimmedPostDateByIndex);
      setPostEventLabelByPostIndex(trimmedPostEventLabelByIndex);
      setPostImageDataUrlByPostIndex(trimmedPostImageDataUrlByIndex);
      setPostSourceImageUrlByPostIndex(trimmedPostSourceImageUrlByIndex);
      setPostCtaLinkByPostIndex(trimmedPostCtaLinkByIndex);
      setResult(mergedResult);
      setRewriteContext(nextRewriteContext);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not reach the API route.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateResultPost(postIndex: number, updater: (post: GeneratedPost) => GeneratedPost) {
    setResult((prev) => {
      if (!prev) {
        return prev;
      }

      if (!prev.posts[postIndex]) {
        return prev;
      }

      return {
        ...prev,
        posts: prev.posts.map((post, index) => (index === postIndex ? updater(post) : post)),
      };
    });
  }

  function selectBodyLineForEditing(postIndex: number, lineIndex: number, lineText: string) {
    setSelectedLineByPost((prev) => ({
      ...prev,
      [postIndex]: lineIndex,
    }));
    setManualLineDraftByPost((prev) => ({
      ...prev,
      [postIndex]: lineText,
    }));
    setSelectedCtaByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualCtaDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
  }

  function applyManualBodyLineEdit(postIndex: number, lineIndex: number) {
    const post = result?.posts[postIndex];
    if (!post) {
      return;
    }

    const draft = manualLineDraftByPost[postIndex];
    if (typeof draft !== "string") {
      return;
    }

    const normalizedDraft = normalizeNoEmDash(draft);

    updateResultPost(postIndex, (currentPost) => {
      const lines = currentPost.body.split("\n");
      if (lineIndex < 0 || lineIndex >= lines.length) {
        return currentPost;
      }

      lines[lineIndex] = normalizedDraft;
      const rebuiltBody = lines.join("\n").replace(/\n{3,}/g, "\n\n");

      return {
        ...currentPost,
        body: rebuiltBody,
        meme: undefined,
        memeVariants: undefined,
        giphy: undefined,
        giphyVariants: undefined,
      };
    });
    setSelectedLineByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualLineDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "Line saved.",
    }));
  }

  function selectCtaForEditing(postIndex: number, ctaText: string) {
    setSelectedCtaByPost((prev) => ({
      ...prev,
      [postIndex]: true,
    }));
    setManualCtaDraftByPost((prev) => ({
      ...prev,
      [postIndex]: ctaText,
    }));
    setSelectedLineByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualLineDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
  }

  function applyManualCtaEdit(postIndex: number) {
    const post = result?.posts[postIndex];
    if (!post) {
      return;
    }

    const draft = manualCtaDraftByPost[postIndex];
    if (typeof draft !== "string") {
      return;
    }

    const normalizedDraft = normalizeNoEmDash(draft);

    updateResultPost(postIndex, (currentPost) => ({
      ...currentPost,
      cta: normalizedDraft,
      meme: undefined,
      memeVariants: undefined,
      giphy: undefined,
      giphyVariants: undefined,
    }));

    setSelectedCtaByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualCtaDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "CTA saved.",
    }));
  }

  function cancelBodyLineEdit(postIndex: number) {
    setSelectedLineByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualLineDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
  }

  function cancelCtaEdit(postIndex: number) {
    setSelectedCtaByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setManualCtaDraftByPost((prev) => {
      const next = { ...prev };
      delete next[postIndex];
      return next;
    });
    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
  }

  function getRewriteInputType(postIndex: number): string {
    return postTypeByPostIndex[postIndex] || rewriteContext.inputType;
  }

  function getRewriteStyle(postIndex: number): string {
    return brandVoiceByPostIndex[postIndex] || rewriteContext.style;
  }

  function getRewriteGoal(postIndex: number): ContentGoal {
    return goalByPostIndex[postIndex] || rewriteContext.goal;
  }

  function getRewriteCtaLink(postIndex: number): string {
    if (Object.prototype.hasOwnProperty.call(postCtaLinkByPostIndex, postIndex)) {
      return postCtaLinkByPostIndex[postIndex] ?? "";
    }

    return rewriteContext.ctaLink;
  }

  async function rewriteEntirePost(postIndex: number) {
    const post = result?.posts[postIndex];
    if (!post) {
      return;
    }

    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setRewriteLoadingKey(`post-${postIndex}`);

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "post",
          ...rewriteContext,
          style: getRewriteStyle(postIndex),
          goal: getRewriteGoal(postIndex),
          inputType: getRewriteInputType(postIndex),
          ctaLink: getRewriteCtaLink(postIndex),
          prompt: rewritePromptByPost[postIndex] ?? "",
          post: {
            length: post.length,
            hook: post.hook,
            body: post.body,
            cta: post.cta,
          },
        }),
      });

      const responsePayload = await response.json();

      if (!response.ok) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: extractApiErrorMessage(responsePayload, response.status),
        }));
        return;
      }

      const nextPost =
        responsePayload &&
        typeof responsePayload === "object" &&
        "post" in responsePayload &&
        typeof (responsePayload as { post?: unknown }).post === "object"
          ? ((responsePayload as { post: { hook?: unknown; body?: unknown; cta?: unknown } }).post ?? null)
          : null;

      if (!nextPost) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: "Rewrite API returned invalid post payload.",
        }));
        return;
      }

      updateResultPost(postIndex, (currentPost) => ({
        ...currentPost,
        hook: normalizeNoEmDash(String(nextPost.hook ?? currentPost.hook)),
        body: normalizeNoEmDash(String(nextPost.body ?? currentPost.body)),
        cta: normalizeNoEmDash(String(nextPost.cta ?? currentPost.cta)),
        meme: undefined,
        memeVariants: undefined,
        giphy: undefined,
        giphyVariants: undefined,
      }));
      setManualLineDraftByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setLineFeedbackByPost((prev) => ({
        ...prev,
        [postIndex]: "",
      }));
      setSelectedCtaByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setManualCtaDraftByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setSelectedLineByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
    } catch {
      setRewriteErrorByPost((prev) => ({
        ...prev,
        [postIndex]: "Could not reach the rewrite API route.",
      }));
    } finally {
      setRewriteLoadingKey(null);
    }
  }

  async function regenerateBodyLine(postIndex: number, lineIndex: number) {
    const post = result?.posts[postIndex];
    if (!post) {
      return;
    }

    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setRewriteLoadingKey(`line-${postIndex}-${lineIndex}`);

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "line",
          ...rewriteContext,
          style: getRewriteStyle(postIndex),
          goal: getRewriteGoal(postIndex),
          inputType: getRewriteInputType(postIndex),
          ctaLink: getRewriteCtaLink(postIndex),
          prompt: "",
          lineIndex,
          post: {
            length: post.length,
            hook: post.hook,
            body: post.body,
            cta: post.cta,
          },
        }),
      });

      const responsePayload = await response.json();

      if (!response.ok) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: extractApiErrorMessage(responsePayload, response.status),
        }));
        return;
      }

      const nextLine =
        responsePayload && typeof responsePayload === "object" && "line" in responsePayload
          ? String((responsePayload as { line?: unknown }).line ?? "")
          : "";

      if (!nextLine.trim()) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: "Rewrite API returned an empty line.",
        }));
        return;
      }

      updateResultPost(postIndex, (currentPost) => {
        const lines = currentPost.body.split("\n");
        if (lineIndex < 0 || lineIndex >= lines.length) {
          return currentPost;
        }

        const normalizedLine = normalizeNoEmDash(nextLine.trim());
        lines[lineIndex] = normalizedLine;
        const rebuiltBody = lines.join("\n").replace(/\n{3,}/g, "\n\n");

        return {
          ...currentPost,
          body: rebuiltBody,
          meme: undefined,
          memeVariants: undefined,
          giphy: undefined,
          giphyVariants: undefined,
        };
      });
      setSelectedLineByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setManualLineDraftByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setLineFeedbackByPost((prev) => ({
        ...prev,
        [postIndex]: "Line rewritten with AI.",
      }));
    } catch {
      setRewriteErrorByPost((prev) => ({
        ...prev,
        [postIndex]: "Could not reach the rewrite API route.",
      }));
    } finally {
      setRewriteLoadingKey(null);
    }
  }

  async function regenerateCtaLine(postIndex: number) {
    const post = result?.posts[postIndex];
    if (!post) {
      return;
    }

    setRewriteErrorByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setLineFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: "",
    }));
    setRewriteLoadingKey(`cta-${postIndex}`);

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "line",
          lineTarget: "cta",
          ...rewriteContext,
          style: getRewriteStyle(postIndex),
          goal: getRewriteGoal(postIndex),
          inputType: getRewriteInputType(postIndex),
          ctaLink: getRewriteCtaLink(postIndex),
          prompt: "",
          post: {
            length: post.length,
            hook: post.hook,
            body: post.body,
            cta: post.cta,
          },
        }),
      });

      const responsePayload = await response.json();

      if (!response.ok) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: extractApiErrorMessage(responsePayload, response.status),
        }));
        return;
      }

      const nextLine =
        responsePayload && typeof responsePayload === "object" && "line" in responsePayload
          ? String((responsePayload as { line?: unknown }).line ?? "")
          : "";

      if (!nextLine.trim()) {
        setRewriteErrorByPost((prev) => ({
          ...prev,
          [postIndex]: "Rewrite API returned an empty CTA line.",
        }));
        return;
      }

      updateResultPost(postIndex, (currentPost) => ({
        ...currentPost,
        cta: normalizeNoEmDash(nextLine.trim()),
        meme: undefined,
        memeVariants: undefined,
        giphy: undefined,
        giphyVariants: undefined,
      }));

      setSelectedCtaByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setManualCtaDraftByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
        return next;
      });
      setLineFeedbackByPost((prev) => ({
        ...prev,
        [postIndex]: "CTA rewritten with AI.",
      }));
    } catch {
      setRewriteErrorByPost((prev) => ({
        ...prev,
        [postIndex]: "Could not reach the rewrite API route.",
      }));
    } finally {
      setRewriteLoadingKey(null);
    }
  }

  function copyFeedbackKey(postIndex: number, action: CopyAction): string {
    return `${postIndex}:${action}`;
  }

  function getCopyButtonLabel(postIndex: number, action: CopyAction, defaultLabel: string): string {
    const feedback = copyFeedbackByPostAction[copyFeedbackKey(postIndex, action)];
    if (feedback === "copied") {
      return "Copied";
    }
    if (feedback === "failed") {
      return "Retry";
    }
    return defaultLabel;
  }

  function showCopyFeedback(postIndex: number, action: CopyAction, status: "copied" | "failed") {
    const key = copyFeedbackKey(postIndex, action);
    setCopyFeedbackByPostAction((prev) => ({
      ...prev,
      [key]: status,
    }));

    setTimeout(() => {
      setCopyFeedbackByPostAction((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 1500);
  }

  async function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setForm((prev) => ({ ...prev, imageDataUrl: "" }));
      setImageName("");
      return;
    }

    setError("");
    setIsImageProcessing(true);

    try {
      const dataUrl = await buildImageDataUrl(file);

      if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
        throw new Error("Image is too large. Please use a smaller file.");
      }

      setForm((prev) => ({ ...prev, imageDataUrl: dataUrl }));
      setImageName(file.name);
    } catch (imageError) {
      setForm((prev) => ({ ...prev, imageDataUrl: "" }));
      setImageName("");

      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }

      setError(imageError instanceof Error ? imageError.message : "Failed to process image.");
    } finally {
      setIsImageProcessing(false);
    }
  }

  function removeImage() {
    setForm((prev) => ({ ...prev, imageDataUrl: "" }));
    setImageName("");
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-384 px-4 py-6 text-slate-900 sm:px-6 sm:py-8 md:px-8 md:py-10">
      <section className="space-y-6 lg:space-y-8">
        <form onSubmit={onSubmit} className="w-full min-w-0 space-y-5 rounded-3xl border border-black/10 bg-white/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur sm:p-6">
          <header className="space-y-2">
            <p className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs tracking-wide text-white">LinkedIn/X Generator</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">Adapty Content Studio</h1>
            <p className="text-sm text-slate-600">Generate multiple post variants with hook suggestions, based on your own winning library.</p>
          </header>

          <div className="inline-flex w-fit max-w-[min(100%,56rem)] flex-col gap-1 rounded-xl border border-black/10 bg-white px-3 py-2 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Mix Mode</p>
            <p className="text-xs text-slate-700">
              If you select multiple Brand Voices, Goals, or Post Types, posts are automatically distributed across those selections.
            </p>
            <p className="text-xs text-slate-600">The generator rotates through selected combinations until it reaches your post count.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-sm font-medium">Brand Voice</span>
              <p className="text-xs text-slate-500">Answers: &quot;How should it sound?&quot; Select one or more voice cards below.</p>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium">Goal</span>
              <p className="text-xs text-slate-500">Answers: &quot;What outcome should it optimize for?&quot; Select one or more goal cards below.</p>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">Brand Voice Guide</p>
              <p className="text-xs text-slate-600">Selected: {selectedBrandVoiceSummary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BRAND_VOICE_PRESETS.map((voice) => {
                const isSelected = normalizedSelectedBrandVoices.includes(voice);
                return (
                  <button
                    key={voice}
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${
                      isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                    }`}
                    onClick={() => applyBrandVoiceSelection(voice)}
                  >
                    <p className="text-sm font-semibold text-slate-900">{BRAND_VOICE_PROFILES[voice].label}</p>
                    <p className="mt-1 text-xs text-slate-600">{BRAND_VOICE_PROFILES[voice].uiDescription}</p>
                  </button>
                );
              })}
              <button
                type="button"
                className={`rounded-xl border p-3 text-left transition ${
                  normalizedSelectedBrandVoices.includes(CUSTOM_BRAND_VOICE)
                    ? selectableCardSelectedClass
                    : selectableCardUnselectedClass
                }`}
                onClick={() => applyBrandVoiceSelection(CUSTOM_BRAND_VOICE)}
              >
                <p className="text-sm font-semibold text-slate-900">Custom</p>
                <p className="mt-1 text-xs text-slate-600">
                  Define your own brand persona, tone rules, and writing style.
                </p>
              </button>
            </div>
          </div>

          {showCustomBrandVoiceInput ? (
            <div className="grid gap-3">
              <label className="space-y-1">
                <span className="text-sm font-medium">Custom Brand Voice</span>
                <textarea
                  rows={3}
                  placeholder="Describe your custom brand voice..."
                  className={baseControlClassName}
                  value={form.style}
                  required
                  onChange={(event) => setForm((prev) => ({ ...prev, style: event.target.value }))}
                />
              </label>
            </div>
          ) : null}

          <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">Goal Guide</p>
              <p className="text-xs text-slate-600">Selected: {selectedGoalSummary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {GOAL_OPTIONS.map((goal) => {
                const isSelected = normalizedSelectedGoals.includes(goal);
                return (
                  <button
                    key={goal}
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${
                      isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                    }`}
                    onClick={() => applyGoalSelection(goal)}
                  >
                    <p className="text-sm font-semibold text-slate-900">{GOAL_LABELS[goal]}</p>
                    <p className="mt-1 text-xs text-slate-600">{GOAL_UI_DESCRIPTIONS[goal]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">Post Type Guide</p>
              <p className="text-xs text-slate-600">Selected: {selectedPostTypeSummary}</p>
            </div>
            <p className="text-xs text-slate-600">
              Select one or more post types. Total posts are distributed across selected post types, brand voices, and goals.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {POST_TYPE_OPTIONS.map((type) => {
                const isSelected = normalizedSelectedPostTypes.includes(type);
                const isIndustryNewsType = needsIndustryNewsRssGuide(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${
                      isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                    }`}
                    onClick={() => applyPostTypeSelection(type)}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <span>{type}</span>
                      {isIndustryNewsType ? (
                        <span className="group/industry-rss relative inline-flex items-center">
                          <span
                            aria-label="Industry news RSS sources"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-600"
                          >
                            i
                          </span>
                          <span
                            className="invisible pointer-events-auto absolute bottom-full left-1/2 z-20 mb-2 w-[min(90vw,30rem)] -translate-x-1/2 rounded-xl border border-sky-200 bg-white p-3 text-left opacity-0 shadow-xl transition group-hover/industry-rss:visible group-hover/industry-rss:opacity-100"
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <div className="text-xs font-semibold text-slate-900">
                              RSS feeds used for Industry news reaction posts
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600">
                              {enabledIndustryRssCount} enabled feeds, grouped by category.
                            </div>
                            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1">
                              {(Object.keys(groupedIndustryRssFeeds) as FeedCategory[]).map((category) => {
                                const feeds = groupedIndustryRssFeeds[category];
                                if (!feeds.length) {
                                  return null;
                                }
                                return (
                                  <div key={category} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                                      {formatFeedCategoryLabel(category)} ({feeds.length})
                                    </p>
                                    <ul className="space-y-1.5">
                                      {feeds.map((feed) => (
                                        <li key={feed.id} className="text-[11px] text-slate-600">
                                          <p className="font-medium text-slate-800">{feed.name}</p>
                                          <p className="break-all font-mono text-[10px] text-slate-500">{feed.url}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{POST_TYPE_UI_DESCRIPTIONS[type]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {showProductLaunchFields ? (
            <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">Slack product updates</span>
                <button
                  type="button"
                  disabled={slackProductUpdatesSyncLoading}
                  className={calendarControlButtonClassName}
                  onClick={reloadSlackProductUpdates}
                >
                  {slackProductUpdatesSyncLoading ? "Reloading…" : "Reload"}
                </button>
              </div>

              {slackProductUpdatesLoading ? (
                <p className="text-xs text-slate-600">Loading product updates…</p>
              ) : productUpdateEntries.length ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={showPreviousProductUpdatesMonth}
                        aria-label="Show previous month"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={jumpToCurrentProductUpdatesMonth}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={showNextProductUpdatesMonth}
                        aria-label="Show next month"
                      >
                        ›
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{productUpdatesMonthLabel}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={calendarPrimaryButtonClassName}
                        disabled={!productUpdateMonthEntries.length}
                        onClick={selectAllProductUpdatesInCurrentMonth}
                      >
                        Select month
                      </button>
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        disabled={!productUpdateMonthEntries.length}
                        onClick={clearCurrentProductUpdatesMonthSelections}
                      >
                        Clear month
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-medium text-slate-600">Quick week:</span>
                    <button
                      type="button"
                      className={calendarPrimaryButtonClassName}
                      disabled={!currentWeekProductUpdateEntries.length}
                      onClick={() => selectProductUpdatesForWeek(0)}
                      title={currentWeekRangeLabel}
                    >
                      Current week ({currentWeekProductUpdateEntries.length})
                    </button>
                    <button
                      type="button"
                      className={calendarPrimaryButtonClassName}
                      disabled={!nextWeekProductUpdateEntries.length}
                      onClick={() => selectProductUpdatesForWeek(1)}
                      title={nextWeekRangeLabel}
                    >
                      Next week ({nextWeekProductUpdateEntries.length})
                    </button>
                  </div>

                  {!productUpdateMonthEntries.length ? (
                    <p className="text-xs text-slate-600">No releases scheduled in {productUpdatesMonthLabel}.</p>
                  ) : null}

                  <div className="overflow-x-auto">
                    <div className="grid min-w-184 grid-cols-7 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10">
                      {CALENDAR_DAY_LABELS.map((dayLabel) => (
                        <div
                          key={dayLabel}
                          className="bg-slate-100 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                        >
                          {dayLabel}
                        </div>
                      ))}
                      {productUpdatesMonthCells.map((cell) => (
                        <div
                          key={cell.key}
                          className={`min-h-24 space-y-1 p-1.5 ${cell.isCurrentMonth ? "bg-white" : "bg-slate-50/80"}`}
                        >
                          <div className="flex items-center justify-end">
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                                cell.isToday
                                  ? "bg-rose-500 text-white"
                                  : cell.isCurrentMonth
                                    ? "text-slate-700"
                                    : "text-slate-400"
                              }`}
                            >
                              {cell.dayOfMonth}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {cell.entries.map((entry) => {
                              const isSelected = selectedProductUpdateIdSet.has(entry.id);
                              const contextImageUrls = getTopProductUpdateImageUrls(entry);
                              const primaryImageUrl = contextImageUrls[0] ?? "";
                              return (
                                <div
                                  key={entry.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => toggleProductUpdateSelection(entry.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      toggleProductUpdateSelection(entry.id);
                                    }
                                  }}
                                  className={`cursor-pointer rounded-md border px-1.5 py-1 text-[10px] leading-tight transition ${
                                    isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                                  }`}
                                  title={`${entry.name || "Untitled feature update"} (${entry.releaseDate || "unknown date"})`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                                      {entry.name.trim() || "Untitled"}
                                    </span>
                                    {isSelected ? <IconCheck className="mt-0.5 h-3 w-3 shrink-0 text-sky-700" /> : null}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1 text-[9px] text-slate-500">
                                    <span>{contextImageUrls.length} ctx img</span>
                                    {primaryImageUrl ? (
                                      <a
                                        href={primaryImageUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline underline-offset-2"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        image
                                      </a>
                                    ) : null}
                                    <a
                                      href={entry.slackUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline underline-offset-2"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      open
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">
                    {selectedProductUpdateEntries.length
                      ? `${selectedProductUpdateEntries.length} selected release${
                          selectedProductUpdateEntries.length === 1 ? "" : "s"
                        } × ${form.numberOfPosts} post${form.numberOfPosts === 1 ? "" : "s"} each (${selectedProductUpdateEntries.length * form.numberOfPosts} total).`
                      : "Select one or more releases to generate Product feature launch posts."}
                  </p>
                  <p className="text-xs text-slate-600">
                    {slackProductUpdates?.syncedAt
                      ? `Feed synced ${new Date(slackProductUpdates.syncedAt).toLocaleString("en-US")}.`
                      : "Feed loaded."}
                  </p>
                  <p className="text-xs text-slate-600">
                    Up to the top {MAX_PRODUCT_UPDATE_IMAGES_PER_POST} release images are attached to each generated post.
                  </p>
                </>
              ) : slackProductUpdates?.syncedAt ? (
                <p className="text-xs text-slate-600">No product updates found in the Slack feed.</p>
              ) : (
                <p className="text-xs text-slate-600">Run `npm run slack-sync`, then click Reload.</p>
              )}
            </div>
          ) : null}

          {showEventFields ? (
            <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">Webinar Events Notion calendar (month)</span>
                <button
                  type="button"
                  disabled={notionCalendarSyncLoading}
                  className={calendarControlButtonClassName}
                  onClick={reloadNotionCalendar}
                >
                  {notionCalendarSyncLoading ? "Reloading…" : "Reload"}
                </button>
              </div>
              {notionCalendarLoading ? (
                <p className="text-xs text-slate-600">Loading calendar…</p>
              ) : notionCalendar?.entries.length ? (
                <>
                  {calendarEntriesMissingDate.length ? (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        Missing date in Notion ({calendarEntriesMissingDate.length}) - not shown on calendar grid
                      </p>
                      <ul className="space-y-1">
                        {calendarEntriesMissingDate.map((entry) => (
                          <li key={entry.id} className="flex items-center justify-between gap-2 text-xs text-amber-900">
                            <span className="min-w-0 whitespace-normal break-normal">{entry.name || "Untitled entry"}</span>
                            <a
                              href={entry.notionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 underline underline-offset-2"
                            >
                              Open
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={showPreviousCalendarMonth}
                        aria-label="Show previous month"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={jumpToCurrentCalendarMonth}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className={calendarControlButtonClassName}
                        onClick={showNextCalendarMonth}
                        aria-label="Show next month"
                      >
                        ›
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{calendarMonthLabel}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!monthEntries.length}
                        className={calendarPrimaryButtonClassName}
                        onClick={selectAllEntriesInCurrentMonth}
                      >
                        Select month
                      </button>
                      <button
                        type="button"
                        disabled={!monthEntries.length}
                        className={calendarControlButtonClassName}
                        onClick={clearCurrentMonthSelections}
                      >
                        Clear month
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-medium text-slate-600">Quick week:</span>
                    <button
                      type="button"
                      disabled={!currentWeekCalendarEntries.length}
                      className={calendarPrimaryButtonClassName}
                      onClick={() => selectCalendarEntriesForWeek(0)}
                      title={currentWeekRangeLabel}
                    >
                      Current week ({currentWeekCalendarEntries.length})
                    </button>
                    <button
                      type="button"
                      disabled={!nextWeekCalendarEntries.length}
                      className={calendarPrimaryButtonClassName}
                      onClick={() => selectCalendarEntriesForWeek(1)}
                      title={nextWeekRangeLabel}
                    >
                      Next week ({nextWeekCalendarEntries.length})
                    </button>
                  </div>

                  {!monthEntries.length ? (
                    <p className="text-xs text-slate-600">No entries scheduled in {calendarMonthLabel}.</p>
                  ) : null}

                  <div className="overflow-x-auto">
                    <div className="grid min-w-184 grid-cols-7 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10">
                      {CALENDAR_DAY_LABELS.map((dayLabel) => (
                        <div
                          key={dayLabel}
                          className="bg-slate-100 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                        >
                          {dayLabel}
                        </div>
                      ))}
                      {monthCalendarCells.map((cell) => (
                        <div
                          key={cell.key}
                          className={`min-h-28 space-y-1.5 p-2 ${cell.isCurrentMonth ? "bg-white" : "bg-slate-50/80"}`}
                        >
                          <div className="flex items-center justify-end">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                                cell.isToday
                                  ? "bg-rose-500 text-white"
                                  : cell.isCurrentMonth
                                    ? "text-slate-700"
                                    : "text-slate-400"
                              }`}
                            >
                              {cell.dayOfMonth}
                            </span>
                          </div>

                          <div className="space-y-1">
                            {cell.entries.map((entry) => {
                              const isSelected = selectedCalendarEntryIdSet.has(entry.id);
                              const needsAttention = entry.needsAuthorInput || entry.needsEventDetails;
                              const missingFields = missingFieldsByCalendarEntryId.get(entry.id) ?? [];
                              const hasMissingFields = missingFields.length > 0;
                              const missingLabel = missingFields.map((field) => getCalendarMissingFieldLabel(field)).join(", ");
                              return (
                                <div
                                  key={entry.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => toggleCalendarEntrySelection(entry.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      toggleCalendarEntrySelection(entry.id);
                                    }
                                  }}
                                  className={`rounded-md border px-2 py-1 text-[11px] leading-tight transition ${
                                    isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                                  } ${hasMissingFields ? "ring-2 ring-amber-300 ring-inset" : ""} cursor-pointer`}
                                >
                                  <div className="flex w-full items-start justify-between gap-1 text-left">
                                    <span className="min-w-0 flex-1 whitespace-normal break-normal font-medium text-slate-800">{entry.name}</span>
                                    <span className="mt-0.5 flex shrink-0 items-center gap-1">
                                      {hasMissingFields ? (
                                        <span
                                          className="rounded bg-amber-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                                          title={`Missing: ${missingLabel}`}
                                        >
                                          Missing data
                                        </span>
                                      ) : null}
                                      {needsAttention ? (
                                        <span
                                          className="h-1.5 w-1.5 rounded-full bg-amber-500"
                                          title="Missing info: ask Cursor to tag author in Notion"
                                        />
                                      ) : null}
                                      {isSelected ? <IconCheck className="h-3 w-3 text-sky-700" /> : null}
                                    </span>
                                  </div>
                                  {hasMissingFields ? (
                                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                      Missing: {missingLabel}
                                    </p>
                                  ) : null}
                                  <div className="mt-1 flex items-start justify-between gap-1">
                                    <span className="min-w-0 flex-1 whitespace-normal break-normal text-[10px] text-slate-500">
                                      {entry.event?.eventName || entry.date}
                                    </span>
                                    <a
                                      href={entry.notionUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 text-[10px] text-slate-500 underline-offset-2 hover:underline"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      Open
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">
                    {selectedCalendarEntries.length
                      ? `${selectedCalendarEntries.length} selected event${
                          selectedCalendarEntries.length === 1 ? "" : "s"
                        } × ${form.numberOfPosts} post${form.numberOfPosts === 1 ? "" : "s"} each (${selectedCalendarEntries.length * form.numberOfPosts} total).`
                      : "Select one or more events to generate posts from Notion context."}
                  </p>
                  <p className="text-xs text-slate-600">
                    Missing fields are highlighted. When event name/details are present, generation will attempt web enrichment for missing event logistics.
                  </p>
                </>
              ) : notionCalendar?.syncedAt ? (
                <p className="text-xs text-slate-600">No calendar entries found.</p>
              ) : (
                <p className="text-xs text-slate-600">
                  Ask Cursor to sync the Notion calendar (using Notion MCP), then click Reload.
                </p>
              )}
            </div>
          ) : null}

          {showMemeFields ? (
            <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Meme Options (optional)</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20"
                  checked={form.memeEnabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, memeEnabled: event.target.checked }))}
                />
                <span className="text-sm font-medium">Add Meme Companion to each post</span>
              </label>

              {form.memeEnabled ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium sm:min-h-11">Variants Per Post</span>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        className={baseControlClassName}
                        style={smallNumberInputStyle}
                        value={form.memeVariantCount}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            memeVariantCount: Math.min(6, Math.max(1, Number(event.target.value || defaultForm.memeVariantCount))),
                          }))
                        }
                      />
                      <p className="mt-1 text-xs text-slate-600">
                        Generates {form.memeVariantCount} meme variant{form.memeVariantCount > 1 ? "s" : ""} for each post.
                      </p>
                    </label>
                  </div>

                  <div className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Template Picker (optional)</p>
                      <button
                        type="button"
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        onClick={() => setForm((prev) => ({ ...prev, memeTemplateIds: [] }))}
                      >
                        Use Auto Template
                      </button>
                    </div>

                    <input
                      placeholder="Search templates by name or id..."
                      className={baseControlClassName}
                      style={compactInputStyle}
                      value={memeTemplateSearch}
                      onChange={(event) => setMemeTemplateSearch(event.target.value)}
                    />
                    <p className="text-xs text-slate-600">
                      Click one or more templates to include them. Leave all unselected for Auto.
                    </p>

                    <div className="grid max-h-104 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2 overflow-y-auto pr-1">
                      <button
                        type="button"
                        className={`min-h-40 rounded-xl border p-2 text-left transition ${
                          form.memeTemplateIds.length === 0 ? selectableCardSelectedClass : selectableCardUnselectedClass
                        }`}
                        onClick={() => setForm((prev) => ({ ...prev, memeTemplateIds: [] }))}
                      >
                        <p className="text-sm font-medium text-slate-900">Auto</p>
                        <p className="text-xs text-slate-600">Model picks best template per variant.</p>
                      </button>

                      {filteredMemeTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className={`rounded-xl border p-2 text-left transition ${
                            form.memeTemplateIds.includes(template.id) ? selectableCardSelectedClass : selectableCardUnselectedClass
                          }`}
                          onClick={() =>
                            setForm((prev) => {
                              const isSelected = prev.memeTemplateIds.includes(template.id);
                              return {
                                ...prev,
                                memeTemplateIds: isSelected
                                  ? prev.memeTemplateIds.filter((id) => id !== template.id)
                                  : [...prev.memeTemplateIds, template.id],
                              };
                            })
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={template.previewUrl}
                            alt={template.name}
                            className="aspect-video w-full rounded-md border border-black/10 bg-slate-100 object-cover object-center"
                            loading="lazy"
                          />
                          <p className="mt-2 text-xs font-medium text-slate-900">{template.name}</p>
                          <p className="mt-0.5 text-[11px] text-slate-600">@{template.id}</p>
                        </button>
                      ))}
                    </div>

                    {totalMemeTemplateMatches > filteredMemeTemplates.length ? (
                      <p className="text-xs text-slate-600">
                        Showing first {filteredMemeTemplates.length} matches out of {totalMemeTemplateMatches}. Refine search to narrow further.
                      </p>
                    ) : null}

                    {memeTemplateLoadError ? <p className="text-xs text-slate-600">{memeTemplateLoadError}</p> : null}

                    <p className="text-xs text-slate-600">
                      Selected templates:{" "}
                      {form.memeTemplateIds.length
                        ? form.memeTemplateIds
                            .slice(0, 6)
                            .map((id) => memeTemplateNameById[id] ?? formatTemplateIdLabel(id))
                            .join(", ") + (form.memeTemplateIds.length > 6 ? ` +${form.memeTemplateIds.length - 6} more` : "")
                        : "Auto"}
                    </p>
                  </div>

                  <label className="space-y-1">
                    <span className="text-sm font-medium">Meme Prompt</span>
                    <textarea
                      rows={3}
                      placeholder="Any specific angle, joke format, or comparison to include..."
                      className={baseControlClassName}
                      value={form.memeBrief}
                      onChange={(event) => setForm((prev) => ({ ...prev, memeBrief: event.target.value }))}
                    />
                  </label>

                  <p className="text-xs text-slate-600">
                    Meme style is inferred automatically from Brand Voice, Goal, Post Type, and your prompt details.
                  </p>
                  <p className="text-xs text-slate-600">
                    Total meme images for this run: {totalMemeVariants} ({form.numberOfPosts} post
                    {form.numberOfPosts > 1 ? "s" : ""} x {form.memeVariantCount} variant
                    {form.memeVariantCount > 1 ? "s" : ""} each).
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          {showGiphyFields ? (
            <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">GIPHY GIF Companions (optional)</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20"
                  checked={form.giphyEnabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, giphyEnabled: event.target.checked }))}
                />
                <span className="text-sm font-medium">Add GIPHY GIF to each post</span>
              </label>

              {form.giphyEnabled ? (
                <div className="space-y-1">
                  <label className="space-y-1">
                    <span className="text-sm font-medium">GIPHY Query (optional)</span>
                    <input
                      type="text"
                      placeholder="Optional base query, e.g. frustrated PM, growth marketing"
                      className={baseControlClassName}
                      style={compactInputStyle}
                      value={form.giphyQuery}
                      onChange={(event) => setForm((prev) => ({ ...prev, giphyQuery: event.target.value }))}
                    />
                    <p className="text-xs text-slate-600">
                      AI chooses the best query for each post from its hook/body. Your query, if provided, is used as a hint only.
                    </p>
                    <p className="text-xs text-slate-600">Powered by GIPHY. Beta keys are rate-limited to 100 calls/hour.</p>
                  </label>
                  <p className="text-xs text-slate-600">
                    Total GIFs: {form.numberOfPosts * form.memeVariantCount} ({form.numberOfPosts} post
                    {form.numberOfPosts > 1 ? "s" : ""} × {form.memeVariantCount} variant
                    {form.memeVariantCount > 1 ? "s" : ""} each).
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {showChartFields ? (
            <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20"
                  checked={form.chartEnabled}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      chartEnabled: event.target.checked,
                      ...(event.target.checked && !prev.chartLabels.trim() && !prev.chartSeriesOneValues.trim()
                        ? getDefaultChartFields(prev.chartType)
                        : {}),
                    }))
                  }
                />
                <span className="text-sm font-medium">Add Chart Companion</span>
              </label>

              {form.chartEnabled ? (
                <div className="space-y-3">
                  <div className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Chart Wizard</p>
                    <p className="text-xs text-slate-600">Pick a starter template, then tweak values, style, and prompt.</p>
                    <div className="flex flex-wrap gap-2">
                      {CHART_WIZARD_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={() => applyChartWizardPreset(preset)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium">Chart Type</span>
                      <select
                        className={baseControlClassName}
                        style={{ width: chartTypeSelectWidth }}
                        value={form.chartType}
                        onChange={(event) => {
                          const nextType = event.target.value as ChartTypeOption;
                          const defaults = getDefaultChartFields(nextType);
                          const shouldSeedDefaults = !form.chartLabels.trim() && !form.chartSeriesOneValues.trim();

                          setForm((prev) => ({
                            ...prev,
                            chartType: nextType,
                            chartLegendPosition: shouldSeedDefaults ? defaults.chartLegendPosition : prev.chartLegendPosition,
                            chartLabels: shouldSeedDefaults ? defaults.chartLabels : prev.chartLabels,
                            chartSeriesOneLabel: shouldSeedDefaults ? defaults.chartSeriesOneLabel : prev.chartSeriesOneLabel,
                            chartSeriesOneValues: shouldSeedDefaults ? defaults.chartSeriesOneValues : prev.chartSeriesOneValues,
                            chartSeriesTwoLabel: isRadialChartType(nextType)
                              ? ""
                              : shouldSeedDefaults
                                ? defaults.chartSeriesTwoLabel
                                : prev.chartSeriesTwoLabel,
                            chartSeriesTwoValues: isRadialChartType(nextType)
                              ? ""
                              : shouldSeedDefaults
                                ? defaults.chartSeriesTwoValues
                                : prev.chartSeriesTwoValues,
                          }));
                        }}
                      >
                        {CHART_TYPE_OPTIONS.map((chartType) => (
                          <option key={chartType} value={chartType}>
                            {CHART_TYPE_LABELS[chartType]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium">Chart Title</span>
                      <input
                        placeholder="Trial strategy split by app sample"
                        className={baseControlClassName}
                        style={mediumInputStyle}
                        value={form.chartTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartTitle: event.target.value }))}
                      />
                    </label>

                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium">Legend Position</span>
                      <select
                        className={baseControlClassName}
                        style={{ width: chartLegendSelectWidth }}
                        value={form.chartLegendPosition}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            chartLegendPosition: event.target.value as ChartLegendPosition,
                          }))
                        }
                      >
                        {CHART_LEGEND_POSITIONS.map((position) => (
                          <option key={position} value={position}>
                            {getLegendLabel(position)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium">Chart Visual Style</span>
                      <select
                        className={baseControlClassName}
                        style={{ width: chartVisualStyleSelectWidth }}
                        value={form.chartVisualStyle}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartVisualStyle: event.target.value }))}
                      >
                        {CHART_VISUAL_STYLE_OPTIONS.map((style) => (
                          <option key={style} value={style}>
                            {formatChartVisualStyleLabel(style)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Primary Series Name</span>
                      <input
                        placeholder="Share %"
                        className={baseControlClassName}
                        style={mediumInputStyle}
                        value={form.chartSeriesOneLabel}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartSeriesOneLabel: event.target.value }))}
                      />
                    </label>

                    {!isRadialChartType(form.chartType) ? (
                      <label className="space-y-1">
                        <span className="text-sm font-medium">Secondary Series Name (optional)</span>
                        <input
                          placeholder="Paid conversions"
                          className={baseControlClassName}
                          style={mediumInputStyle}
                          value={form.chartSeriesTwoLabel}
                          onChange={(event) => setForm((prev) => ({ ...prev, chartSeriesTwoLabel: event.target.value }))}
                        />
                      </label>
                    ) : (
                      <div className="hidden sm:block" aria-hidden />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">Chart Image Prompt (optional)</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={generateChartPromptWithAi}
                        disabled={isChartPromptLoading || isLoading}
                      >
                        <IconSpark className="h-3.5 w-3.5" />
                        {isChartPromptLoading ? "Suggesting..." : "AI Suggest"}
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Optional style direction, e.g. anime infographic, realistic magazine style, hand-drawn look."
                      className={baseControlClassName}
                      value={form.chartImagePrompt}
                      onChange={(event) => {
                        setChartPromptError("");
                        setChartPromptHint("");
                        setForm((prev) => ({ ...prev, chartImagePrompt: event.target.value }));
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      {CHART_IMAGE_PROMPT_QUICK_SUGGESTIONS.map((suggestion) => {
                        const selected = form.chartImagePrompt.trim() === suggestion.prompt;
                        return (
                          <button
                            key={suggestion.id}
                            type="button"
                            className={`rounded-lg border px-2 py-1 text-xs transition ${
                              selected
                                ? "border-sky-400 bg-sky-100 text-sky-900"
                                : "border-black/10 bg-white text-slate-700 hover:bg-slate-100"
                            }`}
                            onClick={() => applyChartPromptQuickSuggestion(suggestion.prompt)}
                          >
                            {suggestion.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-600">
                      Click a suggestion to pre-fill the prompt, or use AI Suggest to generate one from your chart type, labels, and values.
                    </p>
                    {chartPromptError ? <p className="text-xs text-red-600">{chartPromptError}</p> : null}
                    {chartPromptHint ? <p className="text-xs text-emerald-700">{chartPromptHint}</p> : null}
                  </div>

                  <div className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Data Points</p>
                      <button
                        type="button"
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        onClick={() =>
                          updateChartRows((rows) => [...rows, { label: "", primary: "", secondary: "" }])
                        }
                      >
                        Add Row
                      </button>
                    </div>

                    <div
                      className={`hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid ${
                        isRadialChartType(form.chartType)
                          ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                          : "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                      }`}
                    >
                      <span>Label</span>
                      <span>{form.chartSeriesOneLabel.trim() || "Primary Value"}</span>
                      {!isRadialChartType(form.chartType) ? <span>{form.chartSeriesTwoLabel.trim() || "Secondary Value"}</span> : null}
                      <span className="text-right">Row</span>
                    </div>

                    <div className="space-y-2">
                      {chartRows.map((row, rowIndex) => (
                        <div
                          key={`chart-row-${rowIndex}`}
                          className={`grid gap-2 ${
                            isRadialChartType(form.chartType)
                              ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                              : "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                          }`}
                        >
                          <input
                            placeholder={`Label ${rowIndex + 1}`}
                            className={baseControlClassName}
                            value={row.label}
                            onChange={(event) =>
                              updateChartRows((rows) =>
                                rows.map((item, index) =>
                                  index === rowIndex
                                    ? {
                                        ...item,
                                        label: event.target.value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          <input
                            placeholder={`${form.chartSeriesOneLabel.trim() || "Primary"} value`}
                            className={baseControlClassName}
                            value={row.primary}
                            onChange={(event) =>
                              updateChartRows((rows) =>
                                rows.map((item, index) =>
                                  index === rowIndex
                                    ? {
                                        ...item,
                                        primary: event.target.value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          {!isRadialChartType(form.chartType) ? (
                            <input
                              placeholder={`${form.chartSeriesTwoLabel.trim() || "Secondary"} value`}
                              className={baseControlClassName}
                              value={row.secondary}
                              onChange={(event) =>
                                updateChartRows((rows) =>
                                  rows.map((item, index) =>
                                    index === rowIndex
                                      ? {
                                          ...item,
                                          secondary: event.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          ) : null}
                          <button
                            type="button"
                            className="rounded-xl border border-black/10 px-2 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={chartRows.length <= 1}
                            onClick={() =>
                              updateChartRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, index) => index !== rowIndex)))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          ...getDefaultChartFields(prev.chartType),
                        }))
                      }
                    >
                      Use Example Values
                    </button>
                  </div>

                  <p className="text-xs text-slate-600">
                    Each row links one chart label directly to its value(s). No JSON and no comma juggling.
                  </p>
                  <p className="text-xs text-slate-600">
                    Chart image is generated server-side with OpenAI image model and returned in your results.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  Enable this to generate one chart image per run and reuse it alongside the generated posts.
                </p>
              )}
            </div>
          ) : null}

          {showEventFields && useNotionCalendarForGeneration ? (
            <p className="text-xs text-slate-600">
              Time and place are taken from selected Notion calendar entries.
            </p>
          ) : null}

          <div className="space-y-2">
            <span className="text-sm font-medium">CTA URL Mode</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-2 py-1 text-xs transition ${
                  ctaLinkMode === "shared"
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-black/10 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setCtaLinkMode("shared")}
              >
                Same URL for all posts
              </button>
              <button
                type="button"
                className={`rounded-lg border px-2 py-1 text-xs transition ${
                  ctaLinkMode === "per_post"
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-black/10 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setCtaLinkMode("per_post")}
              >
                Different URL per post
              </button>
            </div>
          </div>

          <label className="space-y-1">
            <span className="text-sm font-medium">
              {ctaLinkMode === "per_post" ? "Default CTA URL (optional)" : "CTA URL (optional)"}
            </span>
            <input
              placeholder="https://example.com/webinar"
              className={baseControlClassName}
              style={compactInputStyle}
              value={form.ctaLink}
              onChange={(event) => setForm((prev) => ({ ...prev, ctaLink: event.target.value }))}
            />
            {ctaLinkMode === "per_post" ? (
              <p className="text-xs text-slate-600">
                This URL is used automatically for any post that does not have its own URL in the list below.
              </p>
            ) : null}
          </label>

          {ctaLinkMode === "per_post" ? (
            <label className="space-y-1">
              <span className="text-sm font-medium">Per-post CTA URLs (one per line)</span>
              <textarea
                rows={Math.min(8, Math.max(3, plannedPostCountForCta))}
                placeholder={`https://example.com/link-1\nhttps://example.com/link-2`}
                className={baseControlClassName}
                value={perPostCtaLinksInput}
                onChange={(event) => setPerPostCtaLinksInput(event.target.value)}
              />
              <p className="text-xs text-slate-600">
                <span className="block">Line 1 maps to Post 1, Line 2 to Post 2, and so on.</span>
                <span className="block">Planned posts: {plannedPostCountForCta}.</span>
                <span className="block">Leave a line empty to use the default CTA URL above.</span>
              </p>
            </label>
          ) : null}

          {useSlackProductUpdatesForGeneration ? (
            <p className="text-xs text-slate-600">
              For Product feature launch posts, you can use any valid CTA URL (including Slack links).
            </p>
          ) : null}

          {showEventFields && useNotionCalendarForGeneration ? (
            <p className="text-xs text-slate-600">
              Webinar/event posts use CTA URLs from this planner; if CTA fields are empty, the Notion event page URL is used.
            </p>
          ) : null}

          {showEventFields && useNotionCalendarForGeneration ? (
            <p className="text-xs text-slate-600">
              Event images are taken from selected Notion calendar entries when available.
            </p>
          ) : useSlackProductUpdatesForGeneration ? (
            <p className="text-xs text-slate-600">
              Product release images are taken from selected Slack product updates (top {MAX_PRODUCT_UPDATE_IMAGES_PER_POST}) and attached to generated posts.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              <span className="text-sm font-medium">Attach Image (optional)</span>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className={`${baseControlClassName} cursor-pointer`}
                style={compactInputStyle}
                onChange={onImageChange}
              />
              <p className="text-xs text-slate-600">Attached image will be analyzed as additional context for hooks and post copy.</p>

              {isImageProcessing ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">Processing image...</p>
              ) : null}

              {form.imageDataUrl ? (
                <div className="rounded-2xl border border-black/10 bg-white p-3">
                  <NextImage
                    src={form.imageDataUrl}
                    alt={imageName || "Attached context image"}
                    width={1200}
                    height={480}
                    unoptimized
                    className="h-36 w-full rounded-xl object-cover"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="truncate">{imageName || "Attached image"}</span>
                    <button
                      type="button"
                      className="rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      onClick={removeImage}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Input Length</span>
              <select
                className={baseControlClassName}
                style={{ width: inputLengthSelectWidth }}
                value={form.inputLength}
                onChange={(event) => {
                  const nextLength = event.target.value as InputLength;
                  const nextCanCreateXPosts = nextLength === "long" || nextLength === "very long";
                  setForm((prev) => ({
                    ...prev,
                    inputLength: nextLength,
                    createXPosts: nextCanCreateXPosts ? prev.createXPosts : false,
                  }));
                }}
              >
                {INPUT_LENGTH_OPTIONS.map((length) => (
                  <option key={length} value={length}>
                    {formatLengthLabel(length)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">
                {useNotionCalendarForGeneration
                  ? "Posts Per Selected Event"
                  : useSlackProductUpdatesForGeneration
                    ? "Posts Per Selected Release"
                    : "Number of Posts"}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                className={baseControlClassName}
                style={smallNumberInputStyle}
                value={numberOfPostsInput}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!/^\d*$/.test(next)) {
                    return;
                  }
                  setNumberOfPostsInput(next);
                }}
                onBlur={() => {
                  commitNumberOfPostsInput();
                }}
              />
              {useNotionCalendarForGeneration ? (
                <p className="text-xs text-slate-600">
                  Total planned: {selectedCalendarEntries.length * form.numberOfPosts} posts (
                  {selectedCalendarEntries.length} event{selectedCalendarEntries.length === 1 ? "" : "s"} ×{" "}
                  {form.numberOfPosts} each).
                </p>
              ) : useSlackProductUpdatesForGeneration ? (
                <p className="text-xs text-slate-600">
                  Total planned: {selectedProductUpdateEntries.length * form.numberOfPosts} posts (
                  {selectedProductUpdateEntries.length} release{selectedProductUpdateEntries.length === 1 ? "" : "s"} ×{" "}
                  {form.numberOfPosts} each).
                </p>
              ) : null}
            </label>
          </div>

          {canCreateXPosts ? (
            <div className="space-y-2 rounded-2xl border border-black/10 bg-slate-50 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20"
                  checked={form.createXPosts}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      createXPosts: event.target.checked,
                    }))
                  }
                />
                <span className="text-sm font-medium">Create X posts</span>
              </label>
              <p className="text-xs text-slate-600">
                For each generated LinkedIn post, also create an X thread split into X-ready posts with a dedicated copy button.
              </p>
              <p className="text-xs text-slate-600">
                Use this for long and very long LinkedIn generation runs.
              </p>
            </div>
          ) : null}

          <label className="space-y-1">
            <span className="text-sm font-medium">Extra Prompt Details</span>
            <textarea
              rows={5}
              placeholder="Audience, feature details, angle, constraints, examples to imitate..."
              className={baseControlClassName}
              value={form.details}
              onChange={(event) => setForm((prev) => ({ ...prev, details: event.target.value }))}
            />
          </label>

          <div className="rounded-xl bg-slate-900/5 px-3 py-2 text-xs text-slate-600">{subtitle}</div>

          <button
            disabled={isLoading || isImageProcessing}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? "Generating..." : isImageProcessing ? "Processing image..." : "Generate Posts"}
          </button>

          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </form>

        <section className="min-w-0 space-y-5">
          {/* Hook Suggestions section intentionally commented out by request. Keep for easy restore later.
          <div className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur">
            <h2 className="text-lg font-semibold">Hook Suggestions</h2>
            {result?.hooks?.length ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {result.hooks.map((hook, index) => (
                  <li key={`${hook}-${index}`} className="rounded-xl border border-black/8 bg-white px-3 py-2">
                    {hook}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Generate posts to see hook ideas here.</p>
            )}
          </div>
          */}

          {result?.retrieval?.evidenceSources ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Evidence sources:</span>
              {result.retrieval.evidenceSources.sois ? (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">SOIS</span>
              ) : null}
              {result.retrieval.evidenceSources.web ? (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Web</span>
              ) : null}
              {!result.retrieval.evidenceSources.sois && !result.retrieval.evidenceSources.web ? (
                <span className="text-[11px] text-slate-500">None</span>
              ) : null}
            </div>
          ) : null}

          {result?.chart ? (
            <div className="rounded-3xl border border-black/10 bg-white/90 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Chart Companion</h2>
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    {CHART_TYPE_LABELS[result.chart.type]} · {result.chart.labelsCount} labels · {result.chart.datasetCount} dataset
                    {result.chart.datasetCount > 1 ? "s" : ""}
                  </p>
                  {result.chart.visualStyle ? <p className="text-xs text-slate-600">Style: {result.chart.visualStyle}</p> : null}
                  {result.chart.imagePrompt ? <p className="text-xs text-slate-600">Prompt: {result.chart.imagePrompt}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={result.chart.imageDataUrl}
                    download={`chart-${result.chart.type}.png`}
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Download PNG
                  </a>
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      navigator.clipboard.writeText(result.chart?.imageDataUrl ?? "").catch(() => {});
                    }}
                  >
                    Copy Data URL
                  </button>
                </div>
              </div>

              {result.chart.title ? <p className="mt-2 text-sm text-slate-700">{result.chart.title}</p> : null}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.chart.imageDataUrl}
                alt={result.chart.title || `${CHART_TYPE_LABELS[result.chart.type]} chart`}
                className="mt-3 h-auto w-full rounded-xl border border-black/10 bg-white"
                loading="lazy"
              />
            </div>
          ) : null}

          {result?.posts.length && generatedPostDates.length ? (
            <div className="space-y-3 rounded-3xl border border-black/10 bg-white/90 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.06)] sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Generated posts calendar</h2>
                <button
                  type="button"
                  disabled={!selectedGeneratedPostsDates.length}
                  className={calendarControlButtonClassName}
                  onClick={() => setSelectedGeneratedPostsDates([])}
                >
                  Show all posts
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={calendarControlButtonClassName}
                    onClick={showPreviousGeneratedPostsMonth}
                    aria-label="Show previous generated-post month"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className={calendarControlButtonClassName}
                    onClick={jumpToGeneratedPostsCurrentMonth}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={calendarControlButtonClassName}
                    onClick={showNextGeneratedPostsMonth}
                    aria-label="Show next generated-post month"
                  >
                    ›
                  </button>
                </div>
                <span className="text-sm font-semibold text-slate-800">{generatedPostsMonthLabel}</span>
                <p className="text-xs text-slate-600">
                  {selectedGeneratedPostsDates.length
                    ? `Showing ${filteredGeneratedPostIndices.length} post${
                        filteredGeneratedPostIndices.length === 1 ? "" : "s"
                      } for ${selectedGeneratedPostsDates.length} selected day${
                        selectedGeneratedPostsDates.length === 1 ? "" : "s"
                      }.`
                    : "Click one or more days to filter generated posts."}
                </p>
              </div>

              <div className="overflow-x-auto">
                <div className="grid min-w-184 grid-cols-7 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10">
                  {CALENDAR_DAY_LABELS.map((dayLabel) => (
                    <div
                      key={dayLabel}
                      className="bg-slate-100 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                    >
                      {dayLabel}
                    </div>
                  ))}
                  {generatedPostsMonthCells.map((cell) => {
                    const hasPosts = cell.postIndices.length > 0;
                    const isSelected = selectedGeneratedPostsDateSet.has(cell.key);
                    const calendarCellSummary = buildGeneratedCalendarCellSummary({
                      postIndices: cell.postIndices,
                      postTypeByPostIndex,
                      postEventLabelByPostIndex,
                    });

                    return (
                      <div
                        key={cell.key}
                        className={`min-h-24 space-y-1.5 p-2 ${cell.isCurrentMonth ? "bg-white" : "bg-slate-50/80"}`}
                      >
                        <div className="flex items-center justify-end">
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                              cell.isToday
                                ? "bg-rose-500 text-white"
                                : cell.isCurrentMonth
                                  ? "text-slate-700"
                                  : "text-slate-400"
                            }`}
                          >
                            {cell.dayOfMonth}
                          </span>
                        </div>

                        {hasPosts ? (
                          <button
                            type="button"
                            onClick={() => toggleGeneratedPostsDateSelection(cell.key)}
                            className={`w-full rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition ${
                              isSelected
                                ? "border-sky-500 bg-sky-50 text-sky-900"
                                : "border-black/10 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                            }`}
                          >
                            <p className="whitespace-normal break-normal font-medium">
                              {cell.postIndices.length} post{cell.postIndices.length === 1 ? "" : "s"}
                            </p>
                            {calendarCellSummary ? (
                              <p className="mt-0.5 whitespace-normal break-normal text-[10px] text-slate-500">{calendarCellSummary}</p>
                            ) : null}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {result?.posts && filteredGeneratedPostIndices.map((postIndex) => {
              const post = result.posts[postIndex];
              if (!post) {
                return null;
              }

              const index = postIndex;
              const bodyLineOptions = buildEditableBodyLines(post.body);
              const generatedPostType = postTypeByPostIndex[index];
              const generatedStyle = brandVoiceByPostIndex[index];
              const generatedGoal = goalByPostIndex[index];
              const generatedPostDate = postDateByPostIndex[index];
              const generatedImageDataUrls = postImageDataUrlByPostIndex[index] ?? [];
              const generatedSourceImageUrls = postSourceImageUrlByPostIndex[index] ?? [];
              const xThreadForPost = normalizeXThreadPosts(post.xThread ?? []);
              const hasXThreadForPost = xThreadForPost.length > 0;
              const memeVariantsForPost = getMemeVariantsForPost(post);
              const giphyVariantsForPost = getGiphyVariantsForPost(post);
              const hasMemeVariantsForPost = memeVariantsForPost.length > 0;
              const hasGiphyVariantsForPost = giphyVariantsForPost.length > 0;
              const generatedSourcePreviewUrls = generatedSourceImageUrls.map((sourceImageUrl) =>
                buildSlackImageProxyUrl(sourceImageUrl),
              );
              const previewImageUrls = generatedImageDataUrls.length ? generatedImageDataUrls : generatedSourcePreviewUrls;
              const configuredCtaLink = postCtaLinkByPostIndex[index]?.trim() ?? "";
              const selectedLine = bodyLineOptions.find(
                (lineOption) => lineOption.lineIndex === selectedLineByPost[index] && !lineOption.isBlank,
              );
              const isCtaEditing = Boolean(selectedCtaByPost[index]);
              const manualLineDraft = manualLineDraftByPost[index] ?? selectedLine?.text ?? "";
              const manualCtaDraft = manualCtaDraftByPost[index] ?? post.cta;
              const isPostRewriteLoading = rewriteLoadingKey === `post-${index}`;
              const isLineRewriteLoading = selectedLine
                ? rewriteLoadingKey === `line-${index}-${selectedLine.lineIndex}`
                : false;
              const isCtaRewriteLoading = rewriteLoadingKey === `cta-${index}`;

              return (
                <article key={`${post.hook}-${index}`} className="rounded-3xl border border-black/10 bg-white p-4 shadow-[0_10px_24px_rgba(0,0,0,0.07)] sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-wide text-slate-700">
                      Post {index + 1}
                      {generatedPostType ? ` · ${generatedPostType}` : ""}
                      {generatedStyle ? ` · ${generatedStyle}` : ""}
                      {generatedGoal ? ` · ${GOAL_LABELS[generatedGoal]}` : ""}
                      {generatedPostDate ? ` · ${formatCalendarDateLabel(generatedPostDate)}` : ""}
                      {" · "}
                      {formatLengthLabel(post.length)}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={async () => {
                          const copied = await copyPostAndImagesToClipboard({
                            post,
                            sourceImageUrls: generatedSourceImageUrls,
                            imageDataUrls: generatedImageDataUrls,
                          });
                          showCopyFeedback(index, "post_images", copied ? "copied" : "failed");
                        }}
                      >
                        {getCopyButtonLabel(index, "post_images", "Copy Post + Images")}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!hasXThreadForPost}
                        onClick={async () => {
                          const copied = await copyXThreadToClipboard(xThreadForPost);
                          showCopyFeedback(index, "x_thread", copied ? "copied" : "failed");
                        }}
                      >
                        {getCopyButtonLabel(index, "x_thread", "Copy X Thread")}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!hasMemeVariantsForPost}
                        onClick={async () => {
                          const copied = await copyMemeCompanionsToClipboard(memeVariantsForPost);
                          showCopyFeedback(index, "memes", copied ? "copied" : "failed");
                        }}
                      >
                        {getCopyButtonLabel(index, "memes", "Copy Memes")}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!hasGiphyVariantsForPost}
                        onClick={async () => {
                          const copied = await copyGiphyCompanionsToClipboard(giphyVariantsForPost);
                          showCopyFeedback(index, "giphy", copied ? "copied" : "failed");
                        }}
                      >
                        {getCopyButtonLabel(index, "giphy", "Copy GIPHY")}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={async () => {
                          const copied = await copyEverythingToClipboard({
                            post,
                            sourceImageUrls: generatedSourceImageUrls,
                            imageDataUrls: generatedImageDataUrls,
                            memeVariants: memeVariantsForPost,
                            giphyVariants: giphyVariantsForPost,
                          });
                          showCopyFeedback(index, "everything", copied ? "copied" : "failed");
                        }}
                      >
                        {getCopyButtonLabel(index, "everything", "Copy Everything")}
                      </button>
                    </div>
                  </div>

                  <p className="mb-3 text-lg font-semibold leading-snug">{post.hook}</p>
                  <div className="space-y-1 rounded-xl border border-sky-200 bg-linear-to-b from-sky-50/80 to-white p-2.5">
                    <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-sky-700">
                      <IconPencil className="h-3.5 w-3.5" />
                      Click a body line to edit inline.
                    </p>
                    {bodyLineOptions.map((lineOption) => {
                      if (lineOption.isBlank) {
                        return <div key={`${index}-${lineOption.lineIndex}`} className="h-2" />;
                      }

                      const isSelected = selectedLine?.lineIndex === lineOption.lineIndex;

                      if (isSelected) {
                        return (
                          <div
                            key={`${index}-${lineOption.lineIndex}`}
                            className="rounded-lg border border-sky-300 bg-white p-2 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]"
                          >
                            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                              <IconPencil className="h-3 w-3" />
                              L{lineOption.lineIndex + 1} Editing
                            </p>
                            <textarea
                              rows={2}
                              autoFocus
                              className="w-full rounded-lg border border-sky-200 bg-white px-2 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500"
                              value={manualLineDraft}
                              onChange={(event) =>
                                setManualLineDraftByPost((prev) => ({
                                  ...prev,
                                  [index]: event.target.value,
                                }))
                              }
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isLoading || Boolean(rewriteLoadingKey) || !manualLineDraft.trim()}
                                onClick={() => applyManualBodyLineEdit(index, lineOption.lineIndex)}
                              >
                                <IconCheck className="h-3.5 w-3.5" />
                                Save Line
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isLoading || isLineRewriteLoading || Boolean(rewriteLoadingKey)}
                                onClick={() => regenerateBodyLine(index, lineOption.lineIndex)}
                              >
                                <IconSpark className="h-3.5 w-3.5" />
                                {isLineRewriteLoading ? "AI Rewriting..." : "AI Rewrite Line"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isLoading || Boolean(rewriteLoadingKey)}
                                onClick={() => cancelBodyLineEdit(index)}
                              >
                                <IconClose className="h-3.5 w-3.5" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={`${index}-${lineOption.lineIndex}`}
                          type="button"
                          className="w-full rounded-md border border-transparent px-2 py-1 text-left text-sm leading-relaxed text-slate-700 transition hover:border-sky-200 hover:bg-white"
                          onClick={() => selectBodyLineForEditing(index, lineOption.lineIndex, lineOption.text)}
                        >
                          {lineOption.text}
                        </button>
                      );
                    })}

                    <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">CTA</p>
                      {isCtaEditing ? (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-2">
                          <textarea
                            rows={2}
                            autoFocus
                            className="w-full rounded-lg border border-emerald-200 bg-white px-2 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-emerald-500"
                            value={manualCtaDraft}
                            onChange={(event) =>
                              setManualCtaDraftByPost((prev) => ({
                                ...prev,
                                [index]: event.target.value,
                              }))
                            }
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isLoading || Boolean(rewriteLoadingKey) || !manualCtaDraft.trim()}
                              onClick={() => applyManualCtaEdit(index)}
                            >
                              <IconCheck className="h-3.5 w-3.5" />
                              Save CTA
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isLoading || isCtaRewriteLoading || Boolean(rewriteLoadingKey)}
                              onClick={() => regenerateCtaLine(index)}
                            >
                              <IconSpark className="h-3.5 w-3.5" />
                              {isCtaRewriteLoading ? "AI Rewriting..." : "AI Rewrite CTA"}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isLoading || Boolean(rewriteLoadingKey)}
                              onClick={() => cancelCtaEdit(index)}
                            >
                              <IconClose className="h-3.5 w-3.5" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="w-full rounded-md border border-transparent px-1 py-0.5 text-left text-sm font-medium text-slate-900 transition hover:border-emerald-200 hover:bg-emerald-50/60"
                          onClick={() => selectCtaForEditing(index, post.cta)}
                        >
                          {post.cta}
                        </button>
                      )}
                      {configuredCtaLink ? (
                        <p className="mt-1 break-all px-1 text-[11px] text-slate-500">
                          CTA URL used:{" "}
                          <a
                            href={configuredCtaLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            {configuredCtaLink}
                          </a>
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {hasXThreadForPost ? (
                    <div className="mt-5 space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          X Thread · {xThreadForPost.length} post{xThreadForPost.length === 1 ? "" : "s"}
                        </p>
                        <button
                          type="button"
                          className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={async () => {
                            const copied = await copyXThreadToClipboard(xThreadForPost);
                            showCopyFeedback(index, "x_thread", copied ? "copied" : "failed");
                          }}
                        >
                          {getCopyButtonLabel(index, "x_thread", "Copy X Thread")}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        Copy and paste into X composer. Thread posts are separated with blank lines for quick posting.
                      </p>
                      <div className="space-y-2">
                        {xThreadForPost.map((threadPost, threadIndex) => (
                          <div
                            key={`${index}-x-thread-${threadIndex}`}
                            className="rounded-xl border border-black/10 bg-white p-2.5"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              X post {threadIndex + 1}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{threadPost}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {generatedImageDataUrls.length || generatedSourceImageUrls.length ? (
                    <div className="mt-5 space-y-2 rounded-2xl border border-black/10 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {generatedSourceImageUrls.length
                            ? `Attached Release Images (${generatedSourceImageUrls.length})`
                            : `Source Image Context (${generatedImageDataUrls.length})`}
                        </p>
                        <div className="flex items-center gap-2">
                          {generatedSourceImageUrls.map((sourceUrl, sourceIndex) => (
                            <a
                              key={`${index}-source-${sourceIndex}`}
                              href={sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                            >
                              Open Source {sourceIndex + 1}
                            </a>
                          ))}
                          {generatedSourceImageUrls.length ? (
                            <button
                              type="button"
                              className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedSourceImageUrls.join("\n")).catch(() => {});
                              }}
                            >
                              Copy Source URLs
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {previewImageUrls.length ? (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {previewImageUrls.map((imageUrl, imageIndex) => (
                            <NextImage
                              key={`${index}-source-image-${imageIndex}`}
                              src={imageUrl}
                              alt={`Source context ${imageIndex + 1} for post ${index + 1}`}
                              width={1200}
                              height={620}
                              unoptimized
                              className="h-auto w-full rounded-xl border border-black/10 bg-white object-contain"
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600">Image previews are unavailable. Use source links above.</p>
                      )}
                    </div>
                  ) : null}

                  <div className="mt-5 space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Rewrite Entire Post</p>

                    <label className="space-y-1">
                      <span className="text-sm font-medium">AI Rewrite Prompt (optional)</span>
                      <textarea
                        rows={2}
                        placeholder="Optional rewrite prompt, e.g. make it punchier for founders and add one concrete metric."
                        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                        value={rewritePromptByPost[index] ?? ""}
                        onChange={(event) =>
                          setRewritePromptByPost((prev) => ({
                            ...prev,
                            [index]: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <button
                      type="button"
                      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isLoading || isPostRewriteLoading || Boolean(rewriteLoadingKey)}
                      onClick={() => rewriteEntirePost(index)}
                    >
                      {isPostRewriteLoading ? "Rewriting post..." : "Rewrite Post"}
                    </button>
                  </div>

                  {lineFeedbackByPost[index] ? (
                    <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      {lineFeedbackByPost[index]}
                    </p>
                  ) : null}

                  {rewriteErrorByPost[index] ? (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{rewriteErrorByPost[index]}</p>
                  ) : null}

                  {(() => {
                    const memeVariants = post.memeVariants?.length ? post.memeVariants : post.meme ? [post.meme] : [];
                    if (!memeVariants.length) {
                      return null;
                    }

                    return (
                      <div className="mt-5 space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Meme Companions · {memeVariants.length} variant{memeVariants.length > 1 ? "s" : ""}
                          </p>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {memeVariants.map((variant) => (
                            <div
                              key={`${variant.rank}-${variant.templateId}-${variant.url}`}
                              className="space-y-2 rounded-xl border border-black/10 bg-white p-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  #{variant.rank} · {variant.templateName}
                                  {typeof variant.toneFitScore === "number" ? ` · score ${variant.toneFitScore}` : ""}
                                </p>
                                <div className="flex items-center gap-2">
                                  <a
                                    href={variant.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    Open
                                  </a>
                                  <button
                                    type="button"
                                    className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                                    onClick={() => {
                                      navigator.clipboard.writeText(variant.url).catch(() => {});
                                    }}
                                  >
                                    Copy URL
                                  </button>
                                </div>
                              </div>

                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={variant.url}
                                alt={`${variant.templateName} meme variant ${variant.rank}`}
                                className="h-auto w-full rounded-xl border border-black/10 bg-white"
                                loading="lazy"
                              />

                              <p className="text-xs text-slate-600">
                                {Array.isArray(variant.textLines) && variant.textLines.length > 2 ? (
                                  <>
                                    {variant.textLines.map((line, lineIndex) => (
                                      <span key={`${variant.rank}-${variant.templateId}-line-${lineIndex}`}>
                                        Line {lineIndex + 1}: {line}
                                        <br />
                                      </span>
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    Top: {variant.topText}
                                    <br />
                                    Bottom: {variant.bottomText}
                                  </>
                                )}
                              </p>

                              {variant.toneFitReason ? <p className="text-xs text-slate-600">{variant.toneFitReason}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const giphyVariants = post.giphyVariants?.length ? post.giphyVariants : post.giphy ? [post.giphy] : [];
                    const giphyRequested = result?.giphyRequested ?? form.giphyEnabled;
                    if (giphyVariants.length) {
                      return (
                      <div className="mt-5 space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            GIPHY Companions · {giphyVariants.length} GIF{giphyVariants.length > 1 ? "s" : ""}
                          </p>
                          <a
                            href="https://giphy.com"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
                          >
                            Powered by GIPHY
                          </a>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {giphyVariants.map((variant) => (
                            <div
                              key={`${variant.rank}-${variant.id}-${variant.url}`}
                              className="space-y-2 rounded-xl border border-black/10 bg-white p-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  #{variant.rank} · {variant.title}
                                  {variant.rating ? ` · ${variant.rating.toUpperCase()}` : ""}
                                </p>
                                <div className="flex items-center gap-2">
                                  <a
                                    href={variant.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    Open
                                  </a>
                                  <button
                                    type="button"
                                    className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                                    onClick={() => {
                                      navigator.clipboard.writeText(variant.url).catch(() => {});
                                    }}
                                  >
                                    Copy URL
                                  </button>
                                </div>
                              </div>

                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={variant.previewUrl || variant.url}
                                alt={`GIPHY variant ${variant.rank}: ${variant.title}`}
                                className="h-auto w-full rounded-xl border border-black/10 bg-white"
                                loading="lazy"
                              />

                              <p className="text-xs text-slate-600">Query: {variant.sourceQuery}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                    }
                    if (giphyRequested) {
                      return (
                        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                          <p className="text-xs text-amber-800">
                            GIPHY requested but no GIFs found for this post. Check server logs for GIPHY fetch errors.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </article>
              );
            })}
          </div>
        </section>
      </section>

      {isLoading ? (
        <div className="generation-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="generation-overlay__grain" />
          <div className="generation-overlay__grid" />
          <div className="generation-overlay__orb generation-overlay__orb--one" />
          <div className="generation-overlay__orb generation-overlay__orb--two" />

          <div className="generation-overlay__card">
            <p className="generation-overlay__kicker">Adapty Content Studio</p>
            <h2 className="generation-overlay__title">Generating your posts set</h2>
            <p className="generation-overlay__subtitle">
              Running retrieval, writing, and quality pass.
            </p>
            <div className="generation-overlay__progress" aria-hidden>
              <span className="generation-overlay__progress-bar" />
            </div>
            <p className="generation-overlay__meta">
              This can take up to a minute.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
