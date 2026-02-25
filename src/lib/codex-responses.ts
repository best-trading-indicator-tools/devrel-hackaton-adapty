const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

type CodexResponsesOptions = {
  accessToken: string;
  accountId: string;
  model: string;
  instructions: string;
  userInput: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  baseUrl?: string;
  signal?: AbortSignal;
};

type CodexResponseEnvelope = {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

function resolveCodexUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim() || DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");

  if (normalized.endsWith("/codex/responses")) {
    return normalized;
  }

  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`;
  }

  return `${normalized}/codex/responses`;
}

function parseErrorText(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }

    if (parsed.error && typeof parsed.error === "object") {
      const message = (parsed.error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }

    return text;
  } catch {
    return text;
  }
}

async function* parseSseEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    throw new Error("Codex endpoint returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (!dataLines.length) {
        separatorIndex = buffer.indexOf("\n\n");
        continue;
      }

      const payload = dataLines.join("\n").trim();

      if (!payload || payload === "[DONE]") {
        separatorIndex = buffer.indexOf("\n\n");
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        yield parsed;
      } catch {
        // Ignore malformed chunks.
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

function extractResponseText(response: CodexResponseEnvelope): string {
  const parts: string[] = [];

  for (const item of response.output ?? []) {
    if (item?.type !== "message" || item.role !== "assistant") {
      continue;
    }

    for (const contentItem of item.content ?? []) {
      if (contentItem?.type === "output_text" && typeof contentItem.text === "string") {
        parts.push(contentItem.text);
      }
      if (contentItem?.type === "refusal" && typeof contentItem.refusal === "string") {
        parts.push(contentItem.refusal);
      }
    }
  }

  return parts.join("\n").trim();
}

export async function createCodexStructuredCompletion<T>(options: CodexResponsesOptions): Promise<T> {
  const normalizedImageDataUrls = [options.imageDataUrl, ...(options.imageDataUrls ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  const contentParts: Array<
    { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }
  > = [
    {
      type: "input_text",
      text: options.userInput,
    },
  ];

  for (const imageDataUrl of normalizedImageDataUrls) {
    contentParts.push({
      type: "input_image",
      image_url: imageDataUrl,
      detail: "auto",
    });
  }

  const response = await fetch(resolveCodexUrl(options.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "chatgpt-account-id": options.accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: "pi",
      "content-type": "application/json",
      accept: "text/event-stream",
      "user-agent": "openclaw-adapty",
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      store: false,
      instructions: options.instructions,
      input: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: options.schemaName,
          strict: true,
          schema: options.jsonSchema,
        },
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Codex responses error (${response.status}): ${parseErrorText(errorBody).slice(0, 500)}`);
  }

  let completedResponse: CodexResponseEnvelope | null = null;

  for await (const event of parseSseEvents(response)) {
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "error") {
      const message =
        typeof event.message === "string"
          ? event.message
          : typeof event.code === "string"
            ? event.code
            : JSON.stringify(event);
      throw new Error(`Codex error: ${message}`);
    }

    if (type === "response.failed") {
      const responseObj =
        event.response && typeof event.response === "object"
          ? (event.response as Record<string, unknown>)
          : undefined;
      const errObj =
        responseObj?.error && typeof responseObj.error === "object"
          ? (responseObj.error as Record<string, unknown>)
          : undefined;
      const message = typeof errObj?.message === "string" ? errObj.message : "Codex response failed";
      throw new Error(message);
    }

    if (type === "response.completed" || type === "response.done") {
      const responseObj = event.response;
      if (responseObj && typeof responseObj === "object") {
        completedResponse = responseObj as CodexResponseEnvelope;
        break;
      }
    }
  }

  if (!completedResponse) {
    throw new Error("Codex stream ended without response.completed event");
  }

  const rawText = extractResponseText(completedResponse);

  if (!rawText) {
    throw new Error("Codex returned empty assistant output");
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error("Codex returned non-JSON output for structured request");
  }
}
