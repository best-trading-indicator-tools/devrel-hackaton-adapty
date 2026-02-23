"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";

import {
  CHART_TYPE_LABELS,
  CHART_TYPE_OPTIONS,
  GOAL_LABELS,
  GOAL_OPTIONS,
  INPUT_LENGTH_OPTIONS,
  MEME_TONE_OPTIONS,
  MEME_TEMPLATE_LABELS,
  MEME_TEMPLATE_OPTIONS,
  POST_TYPE_OPTIONS,
  type ChartTypeOption,
  type ContentGoal,
  type InputLength,
  type MemeTemplateId,
} from "@/lib/constants";
import type { GeneratePostsResponse } from "@/lib/schemas";

type ChartLegendPosition = "top" | "right" | "bottom" | "left";

type FormState = {
  style: string;
  hookStyle: string;
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
  hookStyle: "balanced",
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
const CUSTOM_HOOK_STYLE = "__custom_hook_style__";
const BRAND_VOICE_PRESETS = [
  "adapty",
  "clickbait",
  "founder personal",
  "bold / contrarian",
  "technical breakdown",
  "playful meme tone",
] as const;
const HOOK_STYLE_PRESETS = [
  "balanced",
  "clickbait",
  "data-driven",
  "question-led",
  "contrarian",
  "story-led",
] as const;
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

function needsEventDetails(inputType: string): boolean {
  return EVENT_TOPIC_PATTERN.test(inputType);
}

function needsMemeDetails(inputType: string): boolean {
  return MEME_TOPIC_PATTERN.test(inputType);
}

function needsChartDetails(inputType: string): boolean {
  return !MEME_TOPIC_PATTERN.test(inputType);
}

function isBrandVoicePreset(value: string): value is (typeof BRAND_VOICE_PRESETS)[number] {
  return (BRAND_VOICE_PRESETS as readonly string[]).includes(value);
}

function isHookStylePreset(value: string): value is (typeof HOOK_STYLE_PRESETS)[number] {
  return (HOOK_STYLE_PRESETS as readonly string[]).includes(value);
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
  const [form, setForm] = useState<FormState>(defaultForm);
  const [brandVoiceSelection, setBrandVoiceSelection] = useState<string>(() =>
    isBrandVoicePreset(defaultForm.style) ? defaultForm.style : CUSTOM_BRAND_VOICE,
  );
  const [hookStyleSelection, setHookStyleSelection] = useState<string>(() =>
    isHookStylePreset(defaultForm.hookStyle) ? defaultForm.hookStyle : CUSTOM_HOOK_STYLE,
  );
  const [result, setResult] = useState<GeneratePostsResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
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
  const showCustomHookStyleInput = hookStyleSelection === CUSTOM_HOOK_STYLE;
  const customInputsGridClass =
    showCustomBrandVoiceInput && showCustomHookStyleInput ? "grid gap-3 sm:grid-cols-2" : "grid gap-3";

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

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      const responsePayload = await response.json();

      if (!response.ok) {
        const apiError =
          responsePayload && typeof responsePayload === "object" && "error" in responsePayload
            ? String((responsePayload as { error?: unknown }).error ?? "")
            : "";
        const apiMessage =
          responsePayload && typeof responsePayload === "object" && "message" in responsePayload
            ? String((responsePayload as { message?: unknown }).message ?? "")
            : "";

        if (apiError && apiMessage && apiError !== apiMessage) {
          setError(`${apiError}: ${apiMessage}`);
        } else {
          setError(apiMessage || apiError || `Request failed (${response.status})`);
        }
        return;
      }

      setResult(sanitizeGenerationResult(responsePayload as GeneratePostsResponse));
    } catch {
      setError("Could not reach the API route.");
    } finally {
      setIsLoading(false);
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
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 text-slate-900 sm:px-6 sm:py-8 md:px-8 md:py-10">
      <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)] lg:gap-8">
        <form onSubmit={onSubmit} className="min-w-0 space-y-5 rounded-3xl border border-black/10 bg-white/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur sm:p-6">
          <header className="space-y-2">
            <p className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs tracking-wide text-white">LinkedIn Generator</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">Adapty Content Studio</h1>
            <p className="text-sm text-slate-600">Generate multiple post variants with hook suggestions, based on your own winning library.</p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-medium">Brand Voice</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={brandVoiceSelection}
                onChange={(event) => {
                  const nextValue = event.target.value;
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
                }}
              >
                {BRAND_VOICE_PRESETS.map((voice) => (
                  <option key={voice} value={voice}>
                    {formatLengthLabel(voice)}
                  </option>
                ))}
                <option value={CUSTOM_BRAND_VOICE}>Custom</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Hook Style</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={hookStyleSelection}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setHookStyleSelection(nextValue);

                  if (nextValue === CUSTOM_HOOK_STYLE) {
                    setForm((prev) => ({
                      ...prev,
                      hookStyle: isHookStylePreset(prev.hookStyle) ? "" : prev.hookStyle,
                    }));
                    return;
                  }

                  setForm((prev) => ({
                    ...prev,
                    hookStyle: nextValue,
                  }));
                }}
              >
                {HOOK_STYLE_PRESETS.map((hookStyle) => (
                  <option key={hookStyle} value={hookStyle}>
                    {formatLengthLabel(hookStyle)}
                  </option>
                ))}
                <option value={CUSTOM_HOOK_STYLE}>Custom</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Goal</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.goal}
                onChange={(event) => setForm((prev) => ({ ...prev, goal: event.target.value as ContentGoal }))}
              >
                {GOAL_OPTIONS.map((goal) => (
                  <option key={goal} value={goal}>
                    {GOAL_LABELS[goal]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {showCustomBrandVoiceInput || showCustomHookStyleInput ? (
            <div className={customInputsGridClass}>
              {showCustomBrandVoiceInput ? (
                <label className="space-y-1">
                  <span className="text-sm font-medium">Custom Brand Voice</span>
                  <textarea
                    rows={3}
                    placeholder="Describe your custom brand voice..."
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                    value={form.style}
                    required
                    onChange={(event) => setForm((prev) => ({ ...prev, style: event.target.value }))}
                  />
                </label>
              ) : null}

              {showCustomHookStyleInput ? (
                <label className="space-y-1">
                  <span className="text-sm font-medium">Custom Hook Style</span>
                  <textarea
                    rows={3}
                    placeholder="Describe your hook style..."
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                    value={form.hookStyle}
                    required
                    onChange={(event) => setForm((prev) => ({ ...prev, hookStyle: event.target.value }))}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1">
            <label className="space-y-1">
              <span className="text-sm font-medium">Post Type</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                  value={memeTemplateSearch}
                  onChange={(event) => setMemeTemplateSearch(event.target.value)}
                />
                <p className="text-xs text-slate-600">
                  Click one or more templates to include them. Leave all unselected for Auto.
                </p>

                <div className="grid max-h-[20rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  <button
                    type="button"
                    className={`rounded-xl border p-2 text-left transition ${
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
                        className="h-20 w-full rounded-md border border-black/10 object-cover"
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
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                        value={form.chartTitle}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartTitle: event.target.value }))}
                      />
                    </label>

                    <label className="flex h-full flex-col">
                      <span className="text-sm font-medium sm:min-h-[2.75rem]">Legend Position</span>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                        value={form.chartSeriesOneLabel}
                        onChange={(event) => setForm((prev) => ({ ...prev, chartSeriesOneLabel: event.target.value }))}
                      />
                    </label>

                    {!isRadialChartType(form.chartType) ? (
                      <label className="space-y-1">
                        <span className="text-sm font-medium">Secondary Series Name (optional)</span>
                        <input
                          placeholder="Paid conversions"
                          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                  value={form.time}
                  onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                />
                <p className="text-xs text-slate-600">Click to pick date and time from calendar/time selector.</p>
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium">Place</span>
                <input
                  placeholder="Paris / Online / Booth B12"
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
              className="w-full cursor-pointer rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
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
            {result?.posts.map((post, index) => (
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{post.body}</p>
                <p className="mt-4 whitespace-pre-wrap text-sm font-medium text-slate-900">{post.cta}</p>

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
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
