import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

type CodexAuthFile = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    [key: string]: unknown;
  };
  last_refresh?: string;
  [key: string]: unknown;
};

export type CodexOAuthCredentials = {
  accessToken: string;
  refreshToken?: string;
  accountId: string;
  expiresAt?: number;
  source: "env" | "codex-auth-json";
  refreshed: boolean;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);
    const raw = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(raw);

    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getAccountIdFromToken(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const auth = payload?.[JWT_CLAIM_PATH];

  if (!auth || typeof auth !== "object") {
    return undefined;
  }

  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
}

function getExpiresAtFromToken(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;

  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) {
    return undefined;
  }

  return exp * 1000;
}

function parseExpiry(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }

  // Treat small values as Unix seconds.
  if (num < 1_000_000_000_000) {
    return num * 1000;
  }

  return num;
}

function shouldRefresh(expiresAt: number | undefined): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.now() + REFRESH_BUFFER_MS >= expiresAt;
}

function resolveCodexAuthPath(): string {
  const codexHomeRaw = process.env.CODEX_HOME?.trim();
  const codexHome = codexHomeRaw ? path.resolve(codexHomeRaw) : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

async function refreshCodexOAuth(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number;
}> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Codex OAuth refresh failed: ${response.status} ${text.slice(0, 300)}`);
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Codex OAuth refresh returned invalid JSON");
  }

  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  const nextRefreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : Number.NaN;

  if (!accessToken || !nextRefreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Codex OAuth refresh missing required fields");
  }

  const accountId = getAccountIdFromToken(accessToken);

  if (!accountId) {
    throw new Error("Codex OAuth refresh could not extract account id from token");
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    accountId,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function readCodexAuthFile(filePath: string): Promise<CodexAuthFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    return parsed && typeof parsed === "object" ? (parsed as CodexAuthFile) : null;
  } catch {
    return null;
  }
}

async function writeCodexAuthFile(filePath: string, data: CodexAuthFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

async function getEnvCodexOAuthCredentials(): Promise<CodexOAuthCredentials | null> {
  const accessToken = process.env.OPENAI_OAUTH_TOKEN?.trim();

  if (!accessToken) {
    return null;
  }

  const refreshToken = process.env.OPENAI_OAUTH_REFRESH_TOKEN?.trim() || undefined;
  const accountIdFromEnv = process.env.OPENAI_OAUTH_ACCOUNT_ID?.trim();
  const accountId = accountIdFromEnv || getAccountIdFromToken(accessToken);
  const expiresAt = parseExpiry(process.env.OPENAI_OAUTH_EXPIRES_AT) ?? getExpiresAtFromToken(accessToken);

  if (!accountId) {
    throw new Error("OPENAI_OAUTH_TOKEN is set but account id is missing. Set OPENAI_OAUTH_ACCOUNT_ID.");
  }

  if (refreshToken && shouldRefresh(expiresAt)) {
    const refreshed = await refreshCodexOAuth(refreshToken);

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accountId: refreshed.accountId,
      expiresAt: refreshed.expiresAt,
      source: "env",
      refreshed: true,
    };
  }

  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt,
    source: "env",
    refreshed: false,
  };
}

async function getCodexHomeOAuthCredentials(): Promise<CodexOAuthCredentials | null> {
  const authPath = resolveCodexAuthPath();
  const data = await readCodexAuthFile(authPath);

  if (!data?.tokens || typeof data.tokens !== "object") {
    return null;
  }

  const accessToken = typeof data.tokens.access_token === "string" ? data.tokens.access_token.trim() : "";
  const refreshToken = typeof data.tokens.refresh_token === "string" ? data.tokens.refresh_token.trim() : "";
  const accountIdFromFile = typeof data.tokens.account_id === "string" ? data.tokens.account_id.trim() : "";

  if (!accessToken) {
    return null;
  }

  const accountId = accountIdFromFile || getAccountIdFromToken(accessToken);
  const expiresAt = getExpiresAtFromToken(accessToken);

  if (!accountId) {
    return null;
  }

  if (refreshToken && shouldRefresh(expiresAt)) {
    const refreshed = await refreshCodexOAuth(refreshToken);

    const nextData: CodexAuthFile = {
      ...data,
      tokens: {
        ...(data.tokens ?? {}),
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        account_id: refreshed.accountId,
      },
      last_refresh: new Date().toISOString(),
    };

    await writeCodexAuthFile(authPath, nextData);

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accountId: refreshed.accountId,
      expiresAt: refreshed.expiresAt,
      source: "codex-auth-json",
      refreshed: true,
    };
  }

  return {
    accessToken,
    refreshToken: refreshToken || undefined,
    accountId,
    expiresAt,
    source: "codex-auth-json",
    refreshed: false,
  };
}

export async function getCodexOAuthCredentials(): Promise<CodexOAuthCredentials | null> {
  const envCreds = await getEnvCodexOAuthCredentials();

  if (envCreds) {
    return envCreds;
  }

  return getCodexHomeOAuthCredentials();
}
