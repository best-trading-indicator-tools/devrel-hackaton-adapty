import { createCanvas } from "canvas";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

import { type ChartTypeOption } from "@/lib/constants";

const CHART_COLORS = ["#5B8DC8", "#B876C6", "#FF5E66", "#2BB3A3", "#FFB020", "#64748B"] as const;
const LANDSCAPE_SIZE = { width: 1200, height: 675 } as const;
const SQUARE_SIZE = { width: 1200, height: 1200 } as const;
let chartModulesRegistered = false;

function ensureChartModulesRegistered() {
  if (chartModulesRegistered) {
    return;
  }

  Chart.register(...registerables);
  chartModulesRegistered = true;
}

type JsonRecord = Record<string, unknown>;

export class ChartInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartInputError";
  }
}

export type PreparedChartInput = {
  type: ChartTypeOption;
  title: string;
  labels: string[];
  datasets: Array<JsonRecord>;
  options: JsonRecord;
};

export type RenderedChartCompanion = {
  type: ChartTypeOption;
  title: string;
  imageDataUrl: string;
  width: number;
  height: number;
  labelsCount: number;
  datasetCount: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRadialChart(type: ChartTypeOption): boolean {
  return type === "doughnut" || type === "pie" || type === "polarArea";
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

function mergeJsonRecords(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];

    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergeJsonRecords(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function buildDefaultOptions(type: ChartTypeOption, title: string): JsonRecord {
  const base: JsonRecord = {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    layout: {
      padding: 18,
    },
    plugins: {
      legend: {
        display: true,
        position: isRadialChart(type) ? "right" : "top",
        labels: {
          color: "#1E293B",
          font: {
            size: 16,
          },
        },
      },
      title: {
        display: Boolean(title),
        text: title,
        color: "#0F172A",
        font: {
          size: 28,
          weight: "600",
        },
        padding: {
          top: 8,
          bottom: 16,
        },
      },
      tooltip: {
        enabled: true,
      },
    },
  };

  if (!isRadialChart(type)) {
    base.scales = {
      x: {
        ticks: {
          color: "#334155",
          font: {
            size: 14,
          },
        },
        grid: {
          color: "#E2E8F0",
        },
      },
      y: {
        ticks: {
          color: "#334155",
          font: {
            size: 14,
          },
        },
        grid: {
          color: "#E2E8F0",
        },
      },
    };
  }

  return base;
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

function normalizeDatasets(type: ChartTypeOption, rawDatasets: unknown, labelCount: number): Array<JsonRecord> {
  if (!Array.isArray(rawDatasets) || rawDatasets.length === 0) {
    throw new ChartInputError("chartData.datasets must be a non-empty array.");
  }

  return rawDatasets.map((datasetValue, datasetIndex) => {
    if (!isRecord(datasetValue)) {
      throw new ChartInputError(`chartData.datasets[${datasetIndex}] must be an object.`);
    }

    const data = toNumericArray(datasetValue.data, `chartData.datasets[${datasetIndex}].data`);
    const fallbackLabel = `Series ${datasetIndex + 1}`;
    const safeLabel = typeof datasetValue.label === "string" ? datasetValue.label : fallbackLabel;

    const dataset: JsonRecord = {
      ...datasetValue,
      label: safeLabel.slice(0, 90),
      data,
    };

    if (!("borderWidth" in dataset)) {
      dataset.borderWidth = type === "line" ? 3 : 1;
    }

    if (isRadialChart(type)) {
      if (!("backgroundColor" in dataset)) {
        dataset.backgroundColor = Array.from({ length: Math.max(labelCount, data.length) }, (_, colorIndex) => CHART_COLORS[colorIndex % CHART_COLORS.length]);
      }
      if (!("borderColor" in dataset)) {
        dataset.borderColor = "#FFFFFF";
      }
      if (!("hoverOffset" in dataset)) {
        dataset.hoverOffset = 4;
      }
    } else {
      const color = CHART_COLORS[datasetIndex % CHART_COLORS.length];
      if (!("backgroundColor" in dataset)) {
        dataset.backgroundColor = type === "line" ? `${color}33` : color;
      }
      if (!("borderColor" in dataset)) {
        dataset.borderColor = color;
      }
      if (type === "line" && !("fill" in dataset)) {
        dataset.fill = true;
      }
      if (type === "line" && !("pointRadius" in dataset)) {
        dataset.pointRadius = 3;
      }
      if (type === "radar" && !("fill" in dataset)) {
        dataset.fill = true;
      }
    }

    return dataset;
  });
}

function resolveCanvasSize(type: ChartTypeOption): { width: number; height: number } {
  return isRadialChart(type) ? SQUARE_SIZE : LANDSCAPE_SIZE;
}

export function prepareChartInputFromRequest(params: {
  enabled: boolean;
  type: ChartTypeOption;
  title: string;
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
  const defaultOptions = buildDefaultOptions(params.type, params.title.trim());

  return {
    type: params.type,
    title: params.title.trim(),
    labels,
    datasets,
    options: mergeJsonRecords(defaultOptions, optionsObject),
  };
}

export function summarizeChartForPrompt(chartInput: PreparedChartInput): string {
  const labelsPreview = chartInput.labels.slice(0, 8).join(", ");
  const datasetSummary = chartInput.datasets
    .slice(0, 4)
    .map((dataset, index) => {
      const label = typeof dataset.label === "string" ? dataset.label : `Series ${index + 1}`;
      const values = Array.isArray(dataset.data) ? dataset.data.slice(0, 8).join(", ") : "";
      return `${label}: [${values}]`;
    })
    .join(" | ");

  return `type=${chartInput.type}; title=${chartInput.title || "(none)"}; labels=[${labelsPreview}]; datasets=${datasetSummary}`;
}

export async function renderChartCompanion(chartInput: PreparedChartInput): Promise<RenderedChartCompanion> {
  ensureChartModulesRegistered();

  const { width, height } = resolveCanvasSize(chartInput.type);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  const config: ChartConfiguration = {
    type: chartInput.type,
    data: {
      labels: chartInput.labels,
      datasets: chartInput.datasets as unknown as ChartConfiguration["data"]["datasets"],
    },
    options: chartInput.options as ChartConfiguration["options"],
  };

  // Keep a white background so exported PNGs are social-ready.
  const whiteBackgroundPlugin = {
    id: "white-background",
    beforeDraw(chartInstance: { ctx: CanvasRenderingContext2D; width: number; height: number }) {
      const { ctx, width, height } = chartInstance;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
  };

  const chart = new Chart(context as unknown as CanvasRenderingContext2D, {
    ...config,
    plugins: [whiteBackgroundPlugin],
  });

  chart.update();
  const buffer = canvas.toBuffer("image/png");
  chart.destroy();

  return {
    type: chartInput.type,
    title: chartInput.title,
    imageDataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    width,
    height,
    labelsCount: chartInput.labels.length,
    datasetCount: chartInput.datasets.length,
  };
}
