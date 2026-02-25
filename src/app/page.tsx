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
import type { GeneratePostsResponse } from "@/lib/schemas";

type ChartLegendPosition = "top" | "right" | "bottom" | "left";

type FormState = {
  style: string;
  goal: ContentGoal;
  inputType: string;
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

const defaultForm: FormState = {
  style: "adapty",
  goal: "virality",
  inputType: POST_TYPE_OPTIONS[1],
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
  numberOfPosts: 3,
  details: "",
};

const MAX_IMAGE_EDGE_PX = 1400;
const MAX_IMAGE_DATA_URL_CHARS = 4_500_000;
const IMAGE_EXPORT_QUALITY = 0.82;
const MAX_CONCURRENT_GENERATION_REQUESTS = 3;
const EVENT_TOPIC_PATTERN = /\b(event|webinar)\b/i;
const WEBINAR_TOPIC_PATTERN = /\bwebinar\b/i;
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

type GeneratedPost = GeneratePostsResponse["posts"][number];

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
};

type MonthCalendarCell = {
  key: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  entries: NotionCalendarEntry[];
};

type CalendarEntryMissingField = "date" | "content";

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

function isWebinarCalendarEntry(entry: NotionCalendarEntry): boolean {
  if (WEBINAR_TOPIC_PATTERN.test(entry.name)) {
    return true;
  }

  if (entry.event?.eventName && WEBINAR_TOPIC_PATTERN.test(entry.event.eventName)) {
    return true;
  }

  if (entry.event?.eventType?.some((eventType) => WEBINAR_TOPIC_PATTERN.test(eventType))) {
    return true;
  }

  return false;
}

function getCalendarEntryMissingFields(entry: NotionCalendarEntry): CalendarEntryMissingField[] {
  const missing: CalendarEntryMissingField[] = [];

  if (!entry.date.trim() || !parseCalendarDate(entry.date)) {
    missing.push("date");
  }

  if (!entry.content.trim()) {
    missing.push("content");
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

export default function Home() {
  const baseControlClassName =
    "block w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900";
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
  const [generatedPostsMonthCursor, setGeneratedPostsMonthCursor] = useState<Date>(() => getStartOfMonth(new Date()));
  const [selectedGeneratedPostsDate, setSelectedGeneratedPostsDate] = useState<string | null>(null);
  const [numberOfPostsInput, setNumberOfPostsInput] = useState<string>(() => String(defaultForm.numberOfPosts));
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
  const [copyFeedbackByPost, setCopyFeedbackByPost] = useState<Record<number, "copied" | "failed">>({});
  const [imageName, setImageName] = useState<string>("");
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  const [isChartPromptLoading, setIsChartPromptLoading] = useState(false);
  const [chartPromptError, setChartPromptError] = useState("");
  const [chartPromptHint, setChartPromptHint] = useState("");
  const [notionCalendar, setNotionCalendar] = useState<NotionCalendarData | null>(null);
  const [notionCalendarLoading, setNotionCalendarLoading] = useState(false);
  const [notionCalendarSyncLoading, setNotionCalendarSyncLoading] = useState(false);
  const [showWebinarsOnly, setShowWebinarsOnly] = useState(true);
  const [calendarMonthCursor, setCalendarMonthCursor] = useState<Date>(() => getStartOfMonth(new Date()));
  const [selectedCalendarEntryIds, setSelectedCalendarEntryIds] = useState<string[]>([]);
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
  const calendarEntries = useMemo(() => {
    const entries = notionCalendar?.entries ?? [];
    return showWebinarsOnly ? entries.filter((entry) => isWebinarCalendarEntry(entry)) : entries;
  }, [notionCalendar?.entries, showWebinarsOnly]);
  const monthEntries = useMemo(() => {
    if (!calendarEntries.length) return [];
    return getEntriesForMonth(calendarEntries, calendarMonthCursor);
  }, [calendarEntries, calendarMonthCursor]);
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

    if (!selectedGeneratedPostsDate) {
      return result.posts.map((_, index) => index);
    }

    const selected = generatedPostIndicesByDate.get(selectedGeneratedPostsDate);
    if (selected?.length) {
      return selected;
    }

    return result.posts.map((_, index) => index);
  }, [generatedPostIndicesByDate, result?.posts, selectedGeneratedPostsDate]);
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
    if (!generatedPostDates.length) {
      setSelectedGeneratedPostsDate(null);
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

    setSelectedGeneratedPostsDate((previous) =>
      previous && generatedPostIndicesByDate.has(previous) ? previous : generatedPostDates[0],
    );
  }, [generatedPostDates, generatedPostIndicesByDate]);

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
    setSelectedGeneratedPostsDate((previous) => (previous === dateKey ? null : dateKey));
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
    setCopyFeedbackByPost({});
    setRewriteLoadingKey(null);
    setPostTypeByPostIndex({});
    setBrandVoiceByPostIndex({});
    setGoalByPostIndex({});
    setPostDateByPostIndex({});
    setSelectedGeneratedPostsDate(null);

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
      let generationAllocations: GenerationAllocation[];
      if (useNotionCalendarForGeneration) {
        const type = normalizedSelectedPostTypes[0] ?? defaultForm.inputType;
        const style = selectedStylesForGeneration[0] ?? defaultForm.style;
        const goal = normalizedSelectedGoals[0] ?? defaultForm.goal;
        generationAllocations = selectedCalendarEntries.map((entry) => ({
          inputType: type,
          style,
          goal,
          count: 1,
          calendarEntry: entry,
        }));
      } else {
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
        { allocation: GenerationAllocation; response: GeneratePostsResponse } | null
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

            const entry = allocation.calendarEntry;
            const timeVal = entry?.event?.time ?? form.time;
            const placeVal = entry?.event?.region ?? form.place;
            const detailsVal = entry ? buildDetailsFromCalendarEntry(entry) : form.details;
            const ctaVal = entry?.event?.eventPage ?? form.ctaLink;
            const requestPayload = {
              ...form,
              style: allocation.style,
              goal: allocation.goal,
              inputType: allocation.inputType,
              numberOfPosts: allocation.count,
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
            };
          }),
        );

        for (const item of settled) {
          if (item.status === "fulfilled") {
            generationChunksByIndex[item.value.allocationIndex] = {
              allocation: item.value.allocation,
              response: item.value.response,
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
        (chunk): chunk is { allocation: GenerationAllocation; response: GeneratePostsResponse } => Boolean(chunk),
      );

      if (!generationChunks.length) {
        setError("No posts were generated.");
        return;
      }

      const nextPostTypeByIndex: Record<number, string> = {};
      const nextBrandVoiceByIndex: Record<number, string> = {};
      const nextGoalByIndex: Record<number, ContentGoal> = {};
      const nextPostDateByIndex: Record<number, string> = {};
      const mergedPosts: GeneratePostsResponse["posts"] = [];
      let postCursor = 0;

      for (const chunk of generationChunks) {
        for (const post of chunk.response.posts) {
          nextPostTypeByIndex[postCursor] = chunk.allocation.inputType;
          nextBrandVoiceByIndex[postCursor] = chunk.allocation.style;
          nextGoalByIndex[postCursor] = chunk.allocation.goal;
          const generatedDate =
            chunk.allocation.calendarEntry?.date || extractDateKeyFromDateTimeInput(form.time);
          if (generatedDate) {
            nextPostDateByIndex[postCursor] = generatedDate;
          }
          mergedPosts.push(post);
          postCursor += 1;
        }
      }

      const postLimit = useNotionCalendarForGeneration ? mergedPosts.length : committedNumberOfPosts;
      const trimmedPosts = mergedPosts.slice(0, postLimit);
      const trimmedPostTypeByIndex: Record<number, string> = {};
      const trimmedBrandVoiceByIndex: Record<number, string> = {};
      const trimmedGoalByIndex: Record<number, ContentGoal> = {};
      const trimmedPostDateByIndex: Record<number, string> = {};

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
        ctaLink: form.ctaLink,
        details: form.details,
      };
      setPostTypeByPostIndex(trimmedPostTypeByIndex);
      setBrandVoiceByPostIndex(trimmedBrandVoiceByIndex);
      setGoalByPostIndex(trimmedGoalByIndex);
      setPostDateByPostIndex(trimmedPostDateByIndex);
      setResult(mergedResult);
      setRewriteContext(nextRewriteContext);
    } catch {
      setError("Could not reach the API route.");
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

  function showCopyFeedback(postIndex: number, status: "copied" | "failed") {
    setCopyFeedbackByPost((prev) => ({
      ...prev,
      [postIndex]: status,
    }));

    setTimeout(() => {
      setCopyFeedbackByPost((prev) => {
        const next = { ...prev };
        delete next[postIndex];
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
            <p className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs tracking-wide text-white">LinkedIn Generator</p>
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

          {showEventFields ? (
            <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">Notion calendar (month)</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-black/20"
                      checked={showWebinarsOnly}
                      onChange={(event) => setShowWebinarsOnly(event.target.checked)}
                    />
                    Webinars only
                  </label>
                  <button
                    type="button"
                    disabled={notionCalendarSyncLoading}
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={reloadNotionCalendar}
                  >
                    {notionCalendarSyncLoading ? "Reloading…" : "Reload"}
                  </button>
                </div>
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
                            <span className="min-w-0 truncate">{entry.name || "Untitled entry"}</span>
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
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={showPreviousCalendarMonth}
                        aria-label="Show previous month"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={jumpToCurrentCalendarMonth}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
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
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        onClick={selectAllEntriesInCurrentMonth}
                      >
                        Select month
                      </button>
                      <button
                        type="button"
                        disabled={!monthEntries.length}
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        onClick={clearCurrentMonthSelections}
                      >
                        Clear month
                      </button>
                    </div>
                  </div>

                  {!monthEntries.length ? (
                    <p className="text-xs text-slate-600">
                      No {showWebinarsOnly ? "webinar " : ""}entries scheduled in {calendarMonthLabel}.
                    </p>
                  ) : null}

                  <div className="overflow-x-auto">
                    <div className="grid min-w-[46rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10">
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
                              const missingLabel = missingFields.join(" + ");
                              return (
                                <div
                                  key={entry.id}
                                  className={`rounded-md border px-2 py-1 text-[11px] leading-tight transition ${
                                    isSelected ? selectableCardSelectedClass : selectableCardUnselectedClass
                                  } ${hasMissingFields ? "ring-2 ring-amber-300 ring-inset" : ""}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleCalendarEntrySelection(entry.id)}
                                    className="flex w-full items-start justify-between gap-1 text-left"
                                  >
                                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{entry.name}</span>
                                    <span className="mt-0.5 flex shrink-0 items-center gap-1">
                                      {hasMissingFields ? (
                                        <span
                                          className="rounded bg-amber-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                                          title={`Missing ${missingLabel}`}
                                        >
                                          Missing {missingLabel}
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
                                  </button>
                                  {hasMissingFields ? (
                                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                      Needs Notion update
                                    </p>
                                  ) : null}
                                  <div className="mt-1 flex items-center justify-between gap-1">
                                    <span className="min-w-0 truncate text-[10px] text-slate-500">
                                      {entry.event?.eventName || entry.date}
                                    </span>
                                    <a
                                      href={entry.notionUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 text-[10px] text-slate-500 underline-offset-2 hover:underline"
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
                        } will be used for generation.`
                      : "Select one or more events to generate posts from Notion context."}
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

          {showEventFields ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">Time</span>
                <input
                  type="datetime-local"
                  step={300}
                  className={baseControlClassName}
                  style={mediumInputStyle}
                  value={form.time}
                  onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                />
                <p className="text-xs text-slate-600">
                  {useNotionCalendarForGeneration
                    ? "Used as a fallback when a selected calendar event has no time."
                    : "Click to pick date and time from calendar/time selector."}
                </p>
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium">Place</span>
                <input
                  placeholder="Paris / Online / Booth B12"
                  className={baseControlClassName}
                  style={mediumInputStyle}
                  value={form.place}
                  onChange={(event) => setForm((prev) => ({ ...prev, place: event.target.value }))}
                />
              </label>
            </div>
          ) : null}

          <label className="space-y-1">
            <span className="text-sm font-medium">CTA Link (optional)</span>
            <input
              placeholder="https://adapty.io/webinar"
              className={baseControlClassName}
              style={compactInputStyle}
              value={form.ctaLink}
              onChange={(event) => setForm((prev) => ({ ...prev, ctaLink: event.target.value }))}
            />
          </label>

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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Input Length</span>
              <select
                className={baseControlClassName}
                style={{ width: inputLengthSelectWidth }}
                value={form.inputLength}
                onChange={(event) => setForm((prev) => ({ ...prev, inputLength: event.target.value as InputLength }))}
              >
                {INPUT_LENGTH_OPTIONS.map((length) => (
                  <option key={length} value={length}>
                    {formatLengthLabel(length)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Number of Posts</span>
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
            </label>
          </div>

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
                  disabled={!selectedGeneratedPostsDate}
                  className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => setSelectedGeneratedPostsDate(null)}
                >
                  Show all posts
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={showPreviousGeneratedPostsMonth}
                    aria-label="Show previous generated-post month"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={jumpToGeneratedPostsCurrentMonth}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={showNextGeneratedPostsMonth}
                    aria-label="Show next generated-post month"
                  >
                    ›
                  </button>
                </div>
                <span className="text-sm font-semibold text-slate-800">{generatedPostsMonthLabel}</span>
                <p className="text-xs text-slate-600">
                  {selectedGeneratedPostsDate
                    ? `Showing ${filteredGeneratedPostIndices.length} post${
                        filteredGeneratedPostIndices.length === 1 ? "" : "s"
                      } for ${formatCalendarDateLabel(selectedGeneratedPostsDate)}.`
                    : "Click a day to filter generated posts."}
                </p>
              </div>

              <div className="overflow-x-auto">
                <div className="grid min-w-[46rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10">
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
                    const isSelected = selectedGeneratedPostsDate === cell.key;
                    const previewPost = hasPosts && result?.posts ? result.posts[cell.postIndices[0]] : undefined;

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
                            <p className="truncate font-medium">
                              {cell.postIndices.length} post{cell.postIndices.length === 1 ? "" : "s"}
                            </p>
                            {previewPost?.hook ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{previewPost.hook}</p> : null}
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
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={async () => {
                        const text = `${post.hook}\n\n${post.body}\n\n${post.cta}`;
                        const copied = await copyTextToClipboard(text);
                        showCopyFeedback(index, copied ? "copied" : "failed");
                      }}
                    >
                      {copyFeedbackByPost[index] === "copied"
                        ? "Copied"
                        : copyFeedbackByPost[index] === "failed"
                          ? "Retry copy"
                          : "Copy"}
                    </button>
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
                    </div>
                  </div>

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
