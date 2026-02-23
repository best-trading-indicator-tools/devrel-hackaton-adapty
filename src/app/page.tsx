"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import NextImage from "next/image";

import {
  CHART_TYPE_LABELS,
  CHART_TYPE_OPTIONS,
  GOAL_LABELS,
  GOAL_OPTIONS,
  INPUT_LENGTH_OPTIONS,
  POST_TYPE_OPTIONS,
  type ChartTypeOption,
  type ContentGoal,
  type InputLength,
} from "@/lib/constants";
import type { GeneratePostsResponse } from "@/lib/schemas";

type FormState = {
  style: string;
  hookStyle: string;
  goal: ContentGoal;
  inputType: string;
  chartEnabled: boolean;
  chartType: ChartTypeOption;
  chartTitle: string;
  chartData: string;
  chartOptions: string;
  memeTone: string;
  memeBrief: string;
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
  chartData: "",
  chartOptions: "",
  memeTone: "",
  memeBrief: "",
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

function getDefaultChartData(chartType: ChartTypeOption): string {
  if (chartType === "doughnut" || chartType === "pie" || chartType === "polarArea") {
    return JSON.stringify(
      {
        labels: ["Without trial", "With paid trial", "With free trial"],
        datasets: [
          {
            label: "Share %",
            data: [56.9, 28.9, 14.3],
          },
        ],
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
      datasets: [
        {
          label: "Trial starts",
          data: [180, 220, 260, 310],
        },
        {
          label: "Paid conversions",
          data: [82, 94, 118, 142],
        },
      ],
    },
    null,
    2,
  );
}

function getDefaultChartOptions(): string {
  return JSON.stringify(
    {
      plugins: {
        legend: {
          position: "right",
        },
      },
    },
    null,
    2,
  );
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const showEventFields = useMemo(() => needsEventDetails(form.inputType), [form.inputType]);
  const showMemeFields = useMemo(() => needsMemeDetails(form.inputType), [form.inputType]);
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
      const requestPayload = {
        ...form,
        chartEnabled: form.chartEnabled,
        chartType: form.chartEnabled ? form.chartType : defaultForm.chartType,
        chartTitle: form.chartEnabled ? form.chartTitle : "",
        chartData: form.chartEnabled ? form.chartData : "",
        chartOptions: form.chartEnabled ? form.chartOptions : "",
        time: showEventFields ? form.time : "",
        place: showEventFields ? form.place : "",
        memeTone: showMemeFields ? form.memeTone : "",
        memeBrief: showMemeFields ? form.memeBrief : "",
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
        setError(responsePayload?.error ?? responsePayload?.message ?? "Request failed");
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
                      memeTone: needsMemeDetails(nextType) ? prev.memeTone : "",
                      memeBrief: needsMemeDetails(nextType) ? prev.memeBrief : "",
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
                <label className="space-y-1">
                  <span className="text-sm font-medium">Meme Tone</span>
                  <input
                    placeholder="playful, contrarian, absurd, deadpan..."
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                    value={form.memeTone}
                    onChange={(event) => setForm((prev) => ({ ...prev, memeTone: event.target.value }))}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium">Meme Variants Per Post</span>
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
                  <p className="text-xs text-slate-600">
                    Generates {form.memeVariantCount} meme variant{form.memeVariantCount > 1 ? "s" : ""} for each post.
                  </p>
                </label>
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
                Leave these blank to let AI come up with clever and funny meme variants automatically.
              </p>
              <p className="text-xs text-slate-600">
                Total meme images for this run: {totalMemeVariants} ({form.numberOfPosts} post
                {form.numberOfPosts > 1 ? "s" : ""} x {form.memeVariantCount} variant
                {form.memeVariantCount > 1 ? "s" : ""} each).
              </p>
            </div>
          ) : null}

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
                    chartData:
                      event.target.checked && !prev.chartData.trim()
                        ? getDefaultChartData(prev.chartType)
                        : prev.chartData,
                    chartOptions:
                      event.target.checked && !prev.chartOptions.trim()
                        ? getDefaultChartOptions()
                        : prev.chartOptions,
                  }))
                }
              />
              <span className="text-sm font-medium">Add Chart Companion</span>
            </label>

            {form.chartEnabled ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Chart Type</span>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                      value={form.chartType}
                      onChange={(event) => {
                        const nextType = event.target.value as ChartTypeOption;

                        setForm((prev) => ({
                          ...prev,
                          chartType: nextType,
                          chartData: prev.chartData.trim() ? prev.chartData : getDefaultChartData(nextType),
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

                  <label className="space-y-1">
                    <span className="text-sm font-medium">Chart Title (optional)</span>
                    <input
                      placeholder="Trial strategy split by app sample"
                      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                      value={form.chartTitle}
                      onChange={(event) => setForm((prev) => ({ ...prev, chartTitle: event.target.value }))}
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-sm font-medium">Chart Data (JSON)</span>
                  <textarea
                    rows={7}
                    placeholder='{"labels":["A","B"],"datasets":[{"label":"Share %","data":[60,40]}]}'
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none transition focus:border-slate-900"
                    value={form.chartData}
                    onChange={(event) => setForm((prev) => ({ ...prev, chartData: event.target.value }))}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium">Chart Options (JSON, optional)</span>
                  <textarea
                    rows={4}
                    placeholder='{"plugins":{"legend":{"position":"right"}}}'
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none transition focus:border-slate-900"
                    value={form.chartOptions}
                    onChange={(event) => setForm((prev) => ({ ...prev, chartOptions: event.target.value }))}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        chartData: getDefaultChartData(prev.chartType),
                      }))
                    }
                  >
                    Use Example Data
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        chartOptions: getDefaultChartOptions(),
                      }))
                    }
                  >
                    Use Example Options
                  </button>
                </div>

                <p className="text-xs text-slate-600">
                  Chart image is rendered server-side with chartjs-node-canvas and returned in the generation result.
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                Enable this to generate one chart image per run and reuse it alongside the generated posts.
              </p>
            )}
          </div>

          {showEventFields ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">Time</span>
                <input
                  placeholder="May 17, 5pm CET"
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                  value={form.time}
                  onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                />
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
                  const primaryMeme = memeVariants[0];

                  if (!primaryMeme) {
                    return null;
                  }

                  return (
                    <div className="mt-5 space-y-3 rounded-2xl border border-black/10 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Meme Companion · {primaryMeme.templateName} · Rank #{primaryMeme.rank}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                            onClick={() => {
                              navigator.clipboard.writeText(primaryMeme.url).catch(() => {});
                            }}
                          >
                            Copy Meme URL
                          </button>
                          <a
                            href={primaryMeme.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            Open Meme
                          </a>
                        </div>
                      </div>

                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={primaryMeme.url}
                        alt={`${primaryMeme.templateName} meme preview`}
                        className="h-auto w-full rounded-xl border border-black/10 bg-white"
                        loading="lazy"
                      />

                      <p className="text-xs text-slate-600">
                        Top: {primaryMeme.topText}
                        <br />
                        Bottom: {primaryMeme.bottomText}
                      </p>

                      {typeof primaryMeme.toneFitScore === "number" ? (
                        <p className="text-xs text-slate-600">
                          Tone fit: {primaryMeme.toneFitScore}
                          {primaryMeme.toneFitReason ? ` · ${primaryMeme.toneFitReason}` : ""}
                        </p>
                      ) : null}

                      {memeVariants.length > 1 ? (
                        <div className="space-y-2 rounded-xl border border-black/10 bg-white p-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">More Variants</p>
                          <ul className="space-y-2">
                            {memeVariants.slice(1).map((variant) => (
                              <li key={`${variant.rank}-${variant.templateId}-${variant.url}`} className="rounded-lg border border-black/10 px-2 py-2 text-xs text-slate-700">
                                <p className="font-medium">
                                  #{variant.rank} · {variant.templateName}
                                  {typeof variant.toneFitScore === "number" ? ` · score ${variant.toneFitScore}` : ""}
                                </p>
                                <p className="mt-1">Top: {variant.topText}</p>
                                <p>Bottom: {variant.bottomText}</p>
                                {variant.toneFitReason ? <p className="mt-1 text-slate-600">{variant.toneFitReason}</p> : null}
                                <div className="mt-2 flex items-center gap-2">
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
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
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
