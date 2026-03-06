import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CLAUDE_CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

export type ClaudeCredentials = {
  apiKey?: string;
  authToken?: string;
  source: "env" | "claude-credentials-json";
};

async function readClaudeCredentialsFile(): Promise<ClaudeCredentials | null> {
  try {
    const raw = await fs.readFile(CLAUDE_CREDENTIALS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const token =
      (typeof parsed.access_token === "string" ? parsed.access_token : null) ??
      (typeof parsed.token === "string" ? parsed.token : null) ??
      (typeof parsed.api_key === "string" ? parsed.api_key : null);

    if (token?.trim()) {
      const trimmed = token.trim();
      if (trimmed.startsWith("sk-ant-oat")) {
        return { authToken: trimmed, source: "claude-credentials-json" };
      }
      return { apiKey: trimmed, source: "claude-credentials-json" };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return { apiKey, source: "env" };
  }

  // Fallback path for Claude Code auth-token setups.
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) {
    return { authToken, source: "env" };
  }

  return readClaudeCredentialsFile();
}
