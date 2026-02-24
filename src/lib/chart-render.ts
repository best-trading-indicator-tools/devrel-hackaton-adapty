import OpenAI from "openai";

import { CHART_TYPE_LABELS, type ChartTypeOption } from "@/lib/constants";

type JsonRecord = Record<string, unknown>;

const RADIAL_TYPES = new Set<ChartTypeOption>(["doughnut", "pie", "polarArea"]);
const LEGEND_POSITIONS = new Set(["top", "right", "bottom", "left"]);

export class ChartInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartInputError";
  }
}

export type PreparedChartInput = {
  type: ChartTypeOption;
  title: string;
  visualStyle: string;
  imagePrompt: string;
  legendPosition: "top" | "right" | "bottom" | "left";
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
  }>;
};

export type RenderedChartCompanion = {
  type: ChartTypeOption;
  title: string;
  visualStyle: string;
  imagePrompt: string;
  imageDataUrl: string;
  width: number;
  height: number;
  labelsCount: number;
  datasetCount: number;
};

type ChartImageCredentials = {
  oauth?: {
    accessToken: string;
    accountId: string;
  } | null;
  apiKey?: string;
  apiBaseUrl?: string;
  imageModel?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRadialChart(type: ChartTypeOption): boolean {
  return RADIAL_TYPES.has(type);
}

function parseJsonObjectField(rawValue: string, fieldName: string, required: boolean): JsonRecord {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    if (required) {
      throw new ChartInputError(`${fieldName} is required when chart companion is enabled.`);
    }
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!isRecord(parsed)) {
      throw new ChartInputError(`${fieldName} must be a JSON object.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof ChartInputError) {
      throw error;
    }

    throw new ChartInputError(`${fieldName} must be valid JSON.`);
  }
}

function toNumericArray(value: unknown, fieldName: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChartInputError(`${fieldName} must be a non-empty array.`);
  }

  return value.map((item, index) => {
    const numeric = typeof item === "number" ? item : Number(item);

    if (!Number.isFinite(numeric)) {
      throw new ChartInputError(`${fieldName}[${index}] must be numeric.`);
    }

    return Number(numeric);
  });
}

function normalizeLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels) || rawLabels.length === 0) {
    throw new ChartInputError("chartData.labels must be a non-empty array.");
  }

  return rawLabels.map((label, index) => {
    if (typeof label !== "string" && typeof label !== "number") {
      throw new ChartInputError(`chartData.labels[${index}] must be a string or number.`);
    }

    return String(label).trim().slice(0, 90);
  });
}

function normalizeDatasets(type: ChartTypeOption, rawDatasets: unknown, labelCount: number): PreparedChartInput["datasets"] {
  if (!Array.isArray(rawDatasets) || rawDatasets.length === 0) {
    throw new ChartInputError("chartData.datasets must be a non-empty array.");
  }

  return rawDatasets.map((datasetValue, datasetIndex) => {
    if (!isRecord(datasetValue)) {
      throw new ChartInputError(`chartData.datasets[${datasetIndex}] must be an object.`);
    }

    const data = toNumericArray(datasetValue.data, `chartData.datasets[${datasetIndex}].data`);
    const fallbackLabel = `Series ${datasetIndex + 1}`;
    const safeLabel = typeof datasetValue.label === "string" ? datasetValue.label.trim() : fallbackLabel;

    if (data.length !== labelCount && !isRadialChart(type)) {
      throw new ChartInputError(`chartData.datasets[${datasetIndex}].data count must match labels count.`);
    }

    return {
      label: safeLabel.slice(0, 90),
      data,
    };
  });
}

function parseLegendPosition(optionsObject: JsonRecord, chartType: ChartTypeOption): "top" | "right" | "bottom" | "left" {
  const pluginValue = optionsObject.plugins;
  if (!isRecord(pluginValue)) {
    return isRadialChart(chartType) ? "right" : "top";
  }

  const legendValue = pluginValue.legend;
  if (!isRecord(legendValue)) {
    return isRadialChart(chartType) ? "right" : "top";
  }

  const positionRaw = legendValue.position;
  if (typeof positionRaw !== "string") {
    return isRadialChart(chartType) ? "right" : "top";
  }

  const normalized = positionRaw.trim().toLowerCase();
  if (LEGEND_POSITIONS.has(normalized)) {
    return normalized as "top" | "right" | "bottom" | "left";
  }

  return isRadialChart(chartType) ? "right" : "top";
}

function sanitizeStyle(value: string): string {
  const trimmed = value.trim();
  return trimmed || "clean infographic";
}

function sanitizeImagePrompt(value: string): string {
  return value.trim();
}

function resolveImageSize(type: ChartTypeOption): "1024x1024" | "1536x1024" {
  return isRadialChart(type) ? "1024x1024" : "1536x1024";
}

function parseImageSize(size: "1024x1024" | "1536x1024"): { width: number; height: number } {
  const [widthText, heightText] = size.split("x");
  return {
    width: Number(widthText),
    height: Number(heightText),
  };
}

function buildChartImagePrompt(chartInput: PreparedChartInput): string {
  const datasetSummary = chartInput.datasets
    .map((dataset, datasetIndex) => {
      const valuePairs = chartInput.labels.map((label, labelIndex) => {
        const value = dataset.data[labelIndex];
        if (typeof value === "number" && Number.isFinite(value)) {
          return `${label}: ${value}`;
        }
        return `${label}: n/a`;
      });
      return `${datasetIndex + 1}. ${dataset.label}: ${valuePairs.join("; ")}`;
    })
    .join("\n");

  return `
Create a polished chart image for a LinkedIn post.

Chart type: ${CHART_TYPE_LABELS[chartInput.type]}
Chart title: ${chartInput.title || "(none)"}
Legend position: ${chartInput.legendPosition}
Visual style: ${chartInput.visualStyle}
Additional style prompt: ${chartInput.imagePrompt || "(none)"}

Data to visualize exactly:
${datasetSummary}

Requirements:
- Keep numbers and category labels exact. Do not invent, round, or alter values.
- Keep labels readable on mobile feed.
- No watermark, no logo, no brand marks, no extra annotations.
- White or very light background.
- Use a modern social-media-friendly composition.
- Return only the chart visual, no decorative scene.
`.trim();
}

function buildOpenAIClient(params: {
  token: string;
  accountId?: string;
  baseUrl?: string;
}): OpenAI {
  const defaultHeaders: Record<string, string> = {};
  if (params.accountId) {
    defaultHeaders["chatgpt-account-id"] = params.accountId;
  }

  return new OpenAI({
    apiKey: params.token,
    baseURL: params.baseUrl?.trim() || undefined,
    defaultHeaders: Object.keys(defaultHeaders).length ? defaultHeaders : undefined,
  });
}

async function imageDataUrlFromOpenAI(params: {
  client: OpenAI;
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024";
}): Promise<string> {
  const attempt = async (quality?: "high") =>
    params.client.images.generate({
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      quality,
    });

  let generation: Awaited<ReturnType<OpenAI["images"]["generate"]>>;

  try {
    generation = await attempt("high");
  } catch {
    generation = await attempt();
  }

  const firstImage = generation.data?.[0];

  if (firstImage?.b64_json) {
    return `data:image/png;base64,${firstImage.b64_json}`;
  }

  if (firstImage?.url) {
    const imageResponse = await fetch(firstImage.url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch generated image URL (${imageResponse.status})`);
    }
    const mimeType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  throw new Error("Image model returned no b64 image or URL.");
}

function parseOpenAIError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Unknown OpenAI image generation error.";
}

export function prepareChartInputFromRequest(params: {
  enabled: boolean;
  type: ChartTypeOption;
  title: string;
  visualStyle?: string;
  imagePrompt?: string;
  dataJson: string;
  optionsJson: string;
}): PreparedChartInput | null {
  if (!params.enabled) {
    return null;
  }

  const dataObject = parseJsonObjectField(params.dataJson, "chartData", true);
  const optionsObject = parseJsonObjectField(params.optionsJson, "chartOptions", false);
  const labels = normalizeLabels(dataObject.labels);
  const datasets = normalizeDatasets(params.type, dataObject.datasets, labels.length);
  const legendPosition = parseLegendPosition(optionsObject, params.type);

  return {
    type: params.type,
    title: params.title.trim(),
    visualStyle: sanitizeStyle(params.visualStyle ?? ""),
    imagePrompt: sanitizeImagePrompt(params.imagePrompt ?? ""),
    legendPosition,
    labels,
    datasets,
  };
}

export function summarizeChartForPrompt(chartInput: PreparedChartInput): string {
  const labelsPreview = chartInput.labels.slice(0, 8).join(", ");
  const datasetSummary = chartInput.datasets
    .slice(0, 4)
    .map((dataset, index) => {
      const values = dataset.data.slice(0, 8).join(", ");
      return `${dataset.label || `Series ${index + 1}`}: [${values}]`;
    })
    .join(" | ");

  return `type=${chartInput.type}; title=${chartInput.title || "(none)"}; style=${chartInput.visualStyle}; legend=${chartInput.legendPosition}; labels=[${labelsPreview}]; datasets=${datasetSummary}`;
}

export async function renderChartCompanion(
  chartInput: PreparedChartInput,
  credentials: ChartImageCredentials = {},
): Promise<RenderedChartCompanion> {
  const imageModel = credentials.imageModel?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1.5";
  const size = resolveImageSize(chartInput.type);
  const { width, height } = parseImageSize(size);
  const prompt = buildChartImagePrompt(chartInput);

  const oauthToken = credentials.oauth?.accessToken?.trim();
  const oauthAccountId = credentials.oauth?.accountId?.trim();
  const apiKey = credentials.apiKey?.trim();
  const apiBaseUrl = credentials.apiBaseUrl?.trim();

  if (!oauthToken && !apiKey) {
    throw new Error("Missing credentials for chart image generation.");
  }

  const errors: string[] = [];

  if (oauthToken) {
    try {
      const oauthClient = buildOpenAIClient({
        token: oauthToken,
        accountId: oauthAccountId,
        baseUrl: apiBaseUrl,
      });
      const imageDataUrl = await imageDataUrlFromOpenAI({
        client: oauthClient,
        model: imageModel,
        prompt,
        size,
      });

      return {
        type: chartInput.type,
        title: chartInput.title,
        visualStyle: chartInput.visualStyle,
        imagePrompt: chartInput.imagePrompt,
        imageDataUrl,
        width,
        height,
        labelsCount: chartInput.labels.length,
        datasetCount: chartInput.datasets.length,
      };
    } catch (error) {
      errors.push(`OAuth image generation failed: ${parseOpenAIError(error)}`);
    }
  }

  if (apiKey) {
    try {
      const apiClient = buildOpenAIClient({
        token: apiKey,
        baseUrl: apiBaseUrl,
      });
      const imageDataUrl = await imageDataUrlFromOpenAI({
        client: apiClient,
        model: imageModel,
        prompt,
        size,
      });

      return {
        type: chartInput.type,
        title: chartInput.title,
        visualStyle: chartInput.visualStyle,
        imagePrompt: chartInput.imagePrompt,
        imageDataUrl,
        width,
        height,
        labelsCount: chartInput.labels.length,
        datasetCount: chartInput.datasets.length,
      };
    } catch (error) {
      errors.push(`API key image generation failed: ${parseOpenAIError(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}
