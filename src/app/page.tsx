"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";

import {
  BRAND_VOICE_PRESETS,
  BRAND_VOICE_PROFILES,
  CHART_TYPE_LABELS,
  CHART_TYPE_OPTIONS,
  GOAL_LABELS,
  GOAL_UI_DESCRIPTIONS,
  GOAL_OPTIONS,
  INPUT_LENGTH_OPTIONS,
  MEME_TONE_OPTIONS,
  MEME_TEMPLATE_LABELS,
  MEME_TEMPLATE_OPTIONS,
  POST_TYPE_OPTIONS,
  isBrandVoicePreset,
  type ChartTypeOption,
  type ContentGoal,
  type InputLength,
  type MemeTemplateId,
} from "@/lib/constants";
import type { GeneratePostsResponse } from "@/lib/schemas";

type ChartLegendPosition = "top" | "right" | "bottom" | "left";

type FormState = {
  style: string;
  goal: ContentGoal;
  inputType: string;
  chartEnabled: boolean;
  chartType: ChartTypeOption;
  chartTitle: string;
  chartLabels: string;
  chartSeriesOneLabel: string;
  chartSeriesOneValues: string;
  chartSeriesTwoLabel: string;
  chartSeriesTwoValues: string;
  chartLegendPosition: ChartLegendPosition;
  memeTone: string;
  memeBrief: string;
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
  chartLabels: "Without trial, With paid trial, With free trial",
  chartSeriesOneLabel: "Share %",
  chartSeriesOneValues: "56.9, 28.9, 14.3",
  chartSeriesTwoLabel: "",
  chartSeriesTwoValues: "",
  chartLegendPosition: "right",
  memeTone: "",
  memeBrief: "",
  memeTemplateIds: [],
  memeVariantCount: 3,
  time: "",
  place: "",
  ctaLink: "",
  imageDataUrl: "",
  inputLength: "standard",
  numberOfPosts: 3,
  details: "",
};

const MAX_IMAGE_EDGE_PX = 1400;
const MAX_IMAGE_DATA_URL_CHARS = 4_500_000;
const IMAGE_EXPORT_QUALITY = 0.82;
const EVENT_TOPIC_PATTERN = /\b(event|webinar)\b/i;
const MEME_TOPIC_PATTERN = /\b(meme|shitpost)\b/i;
const CUSTOM_BRAND_VOICE = "__custom__";
const CHART_LEGEND_POSITIONS: ChartLegendPosition[] = ["top", "right", "bottom", "left"];
const MAX_TEMPLATE_RESULTS = 80;

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

function getMemeToneLabel(tone: string): string {
  if (tone === "auto") {
    return "Auto";
  }

  return tone
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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
            url: post.meme.url.trim(),
            toneFitReason: post.meme.toneFitReason ? normalizeNoEmDash(post.meme.toneFitReason) : post.meme.toneFitReason,
          }
        : undefined,
      memeVariants: post.memeVariants?.map((variant) => ({
        ...variant,
        topText: normalizeNoEmDash(variant.topText),
        bottomText: normalizeNoEmDash(variant.bottomText),
        toneFitReason: variant.toneFitReason ? normalizeNoEmDash(variant.toneFitReason) : variant.toneFitReason,
        url: variant.url.trim(),
      })),
    })),
  };
}

function formatLengthLabel(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
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

function needsMemeDetails(inputType: string): boolean {
  return MEME_TOPIC_PATTERN.test(inputType);
}

function needsChartDetails(inputType: string): boolean {
  return !MEME_TOPIC_PATTERN.test(inputType);
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

export default function Home() {
  const baseControlClassName =
    "block w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900";
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
  const [brandVoiceSelection, setBrandVoiceSelection] = useState<string>(() =>
    isBrandVoicePreset(defaultForm.style) ? defaultForm.style : CUSTOM_BRAND_VOICE,
  );
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
  const [imageName, setImageName] = useState<string>("");
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  const fallbackMemeTemplates = useMemo(() => buildFallbackMemeTemplates(), []);
  const [memeTemplateOptions, setMemeTemplateOptions] = useState<MemeTemplateOption[]>(fallbackMemeTemplates);
  const [memeTemplateSearch, setMemeTemplateSearch] = useState("");
  const [memeTemplateLoadError, setMemeTemplateLoadError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const showEventFields = useMemo(() => needsEventDetails(form.inputType), [form.inputType]);
  const showMemeFields = useMemo(() => needsMemeDetails(form.inputType), [form.inputType]);
  const showChartFields = useMemo(() => needsChartDetails(form.inputType), [form.inputType]);
  const showCustomBrandVoiceInput = brandVoiceSelection === CUSTOM_BRAND_VOICE;
  const selectedBrandVoiceLabel =
    brandVoiceSelection === CUSTOM_BRAND_VOICE
      ? "Custom"
      : isBrandVoicePreset(brandVoiceSelection)
        ? BRAND_VOICE_PROFILES[brandVoiceSelection].label
        : "Custom";
  const postTypeSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(POST_TYPE_OPTIONS, {
        minCh: 18,
        maxCh: 40,
        paddingCh: 5,
      }),
    [],
  );
  const memeToneSelectWidth = useMemo(
    () =>
      getSelectWidthFromOptions(MEME_TONE_OPTIONS.map((tone) => getMemeToneLabel(tone)), {
        minCh: 12,
        maxCh: 24,
        paddingCh: 5,
      }),
    [],
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
    if (form.inputLength !== "mix") {
      return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""} in ${formatLengthLabel(form.inputLength)} format`;
    }

    return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""} with mixed lengths (Short, Standard, Long)`;
  }, [form.inputLength, form.numberOfPosts]);
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
  const memeToneSelection = useMemo(() => {
    const current = form.memeTone.trim().toLowerCase();
    if (!current) {
      return "auto";
    }

    return (MEME_TONE_OPTIONS as readonly string[]).includes(current) ? current : "auto";
  }, [form.memeTone]);
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
    setBrandVoiceSelection(nextValue);

    if (nextValue === CUSTOM_BRAND_VOICE) {
      setForm((prev) => ({
        ...prev,
        style: isBrandVoicePreset(prev.style) ? "" : prev.style,
      }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      style: nextValue,
    }));
  }

  function applyGoalSelection(nextGoal: ContentGoal) {
    setForm((prev) => ({
      ...prev,
      goal: nextGoal,
    }));
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setRewriteLoadingKey(null);

    if (isImageProcessing) {
      setError("Image is still processing. Please wait a second and retry.");
      setIsLoading(false);
      return;
    }

    try {
      let chartDataPayload = "";
      let chartOptionsPayload = "";

      if (showChartFields && form.chartEnabled) {
        const chartPayload = buildChartPayload(form);
        if ("error" in chartPayload) {
          setError(chartPayload.error);
          setIsLoading(false);
          return;
        }

        chartDataPayload = chartPayload.chartData;
        chartOptionsPayload = chartPayload.chartOptions;
      }

      const requestPayload = {
        ...form,
        chartEnabled: showChartFields ? form.chartEnabled : false,
        chartType: showChartFields && form.chartEnabled ? form.chartType : defaultForm.chartType,
        chartTitle: showChartFields && form.chartEnabled ? form.chartTitle : "",
        chartData: showChartFields && form.chartEnabled ? chartDataPayload : "",
        chartOptions: showChartFields && form.chartEnabled ? chartOptionsPayload : "",
        time: showEventFields ? formatEventTimeForPrompt(form.time) : "",
        place: showEventFields ? form.place : "",
        memeTone: showMemeFields ? form.memeTone : "",
        memeBrief: showMemeFields ? form.memeBrief : "",
        memeTemplateIds: showMemeFields ? form.memeTemplateIds : [],
        memeVariantCount: showMemeFields ? form.memeVariantCount : defaultForm.memeVariantCount,
      };
      const nextRewriteContext: RewriteContext = {
        style: requestPayload.style,
        goal: requestPayload.goal,
        inputType: requestPayload.inputType,
        ctaLink: requestPayload.ctaLink,
        details: requestPayload.details,
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
        setError(extractApiErrorMessage(responsePayload, response.status));
        return;
      }

      setResult(sanitizeGenerationResult(responsePayload as GeneratePostsResponse));
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
    <main className="mx-auto min-h-screen max-w-[96rem] px-4 py-6 text-slate-900 sm:px-6 sm:py-8 md:px-8 md:py-10">
      <section className="space-y-6 lg:space-y-8">
        <form onSubmit={onSubmit} className="w-full min-w-0 space-y-5 rounded-3xl border border-black/10 bg-white/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur sm:p-6">
          <header className="space-y-2">
            <p className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs tracking-wide text-white">LinkedIn Generator</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">Adapty Content Studio</h1>
            <p className="text-sm text-slate-600">Generate multiple post variants with hook suggestions, based on your own winning library.</p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-sm font-medium">Brand Voice</span>
              <p className="text-xs text-slate-500">Click one voice card below to select it.</p>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium">Goal</span>
              <p className="text-xs text-slate-500">Click one goal card below to select it.</p>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">Brand Voice Guide</p>
              <p className="text-xs text-slate-600">Selected: {selectedBrandVoiceLabel}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BRAND_VOICE_PRESETS.map((voice) => {
                const isSelected = brandVoiceSelection === voice;
                return (
                  <button
                    key={voice}
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.08)]"
                        : "border-black/10 bg-white hover:border-slate-400"
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
                  showCustomBrandVoiceInput
                    ? "border-slate-900 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.08)]"
                    : "border-black/10 bg-white hover:border-slate-400"
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
              <p className="text-xs text-slate-600">Selected: {GOAL_LABELS[form.goal]}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {GOAL_OPTIONS.map((goal) => {
                const isSelected = form.goal === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.08)]"
                        : "border-black/10 bg-white hover:border-slate-400"
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

          <div className="space-y-1">
            <label className="space-y-1">
              <span className="text-sm font-medium">Post Type</span>
              <select
                className={baseControlClassName}
                style={{ width: postTypeSelectWidth }}
                value={form.inputType}
                onChange={(event) =>
                  setForm((prev) => {
                    const nextType = event.target.value;
                    return {
                      ...prev,
                      inputType: nextType,
                      time: needsEventDetails(nextType) ? prev.time : "",
                      place: needsEventDetails(nextType) ? prev.place : "",
                      chartEnabled: needsChartDetails(nextType) ? prev.chartEnabled : false,
                      memeTone: needsMemeDetails(nextType) ? prev.memeTone : "",
                      memeBrief: needsMemeDetails(nextType) ? prev.memeBrief : "",
                      memeTemplateIds: needsMemeDetails(nextType) ? prev.memeTemplateIds : [],
                      memeVariantCount: needsMemeDetails(nextType) ? prev.memeVariantCount : defaultForm.memeVariantCount,
                    };
                  })
                }
              >
                {POST_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {showMemeFields ? (
            <div className="space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Meme Options (optional)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex h-full flex-col">
                  <span className="text-sm font-medium sm:min-h-[2.75rem]">Meme Tone</span>
                  <select
                    className={baseControlClassName}
                    style={{ width: memeToneSelectWidth }}
                    value={memeToneSelection}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        memeTone: event.target.value === "auto" ? "" : event.target.value,
                      }))
                    }
                  >
                    {MEME_TONE_OPTIONS.map((tone) => (
                      <option key={tone} value={tone}>
                        {getMemeToneLabel(tone)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex h-full flex-col">
                  <span className="text-sm font-medium sm:min-h-[2.75rem]">Variants Per Post</span>
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

                <div className="grid max-h-[26rem] grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className={`min-h-40 rounded-xl border p-2 text-left transition ${
                      form.memeTemplateIds.length === 0
                        ? "border-slate-900 bg-slate-50"
                        : "border-black/10 bg-white hover:bg-slate-50"
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
                        form.memeTemplateIds.includes(template.id)
                          ? "border-slate-900 bg-slate-50"
                          : "border-black/10 bg-white hover:bg-slate-50"
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
                Leave tone and prompt blank to let AI come up with clever and funny meme variants automatically.
              </p>
              <p className="text-xs text-slate-600">
                Total meme images for this run: {totalMemeVariants} ({form.numberOfPosts} post
                {form.numberOfPosts > 1 ? "s" : ""} x {form.memeVariantCount} variant
                {form.memeVariantCount > 1 ? "s" : ""} each).
              </p>
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
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium sm:min-h-[2.75rem]">Chart Type</span>
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
                      <span className="text-sm font-medium sm:min-h-[2.75rem]">Chart Title</span>
                      <input
                        placeholder="Trial strategy split by app sample"
                        className={baseControlClassName}
                        style={mediumInputStyle}
                        value={form.chartTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartTitle: event.target.value }))}
                      />
                    </label>

                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium sm:min-h-[2.75rem]">Legend Position</span>
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
                    Chart image is rendered automatically server-side and returned in your results.
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
                <p className="text-xs text-slate-600">Click to pick date and time from calendar/time selector.</p>
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
                max={12}
                className={baseControlClassName}
                style={smallNumberInputStyle}
                value={form.numberOfPosts}
                onChange={(event) => setForm((prev) => ({ ...prev, numberOfPosts: Number(event.target.value || 1) }))}
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

          {result?.chart ? (
            <div className="rounded-3xl border border-black/10 bg-white/90 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Chart Companion</h2>
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    {CHART_TYPE_LABELS[result.chart.type]} · {result.chart.labelsCount} labels · {result.chart.datasetCount} dataset
                    {result.chart.datasetCount > 1 ? "s" : ""}
                  </p>
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

          <div className="space-y-4">
            {result?.posts.map((post, index) => {
              const bodyLineOptions = buildEditableBodyLines(post.body);
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
                      Post {index + 1} · {formatLengthLabel(post.length)}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => {
                        const text = `${post.hook}\n\n${post.body}\n\n${post.cta}`;
                        navigator.clipboard.writeText(text).catch(() => {});
                      }}
                    >
                      Copy
                    </button>
                  </div>

                  <p className="mb-3 text-lg font-semibold leading-snug">{post.hook}</p>
                  <div className="space-y-1 rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/80 to-white p-2.5">
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
                                Top: {variant.topText}
                                <br />
                                Bottom: {variant.bottomText}
                              </p>

                              {variant.toneFitReason ? <p className="text-xs text-slate-600">{variant.toneFitReason}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
