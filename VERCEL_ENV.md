# Vercel Environment Variables

Add these in **Project Settings → Environment Variables**. Mark sensitive values as "Sensitive" so they're hidden in logs.

## Required for generation

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key (Console) | `sk-ant-api03-...` |
| `OPENAI_API_KEY` | Embeddings, LanceDB, fallback | `sk-proj-...` |
| `OPENAI_OAUTH_TOKEN` | Codex OAuth access token | `eyJ...` |
| `OPENAI_OAUTH_REFRESH_TOKEN` | Codex refresh token | `rt_...` |
| `OPENAI_CODEX_ACCOUNT_ID` | Codex account ID | `732016a6-852b-49f2-...` |

## Optional but recommended

| Variable | Description |
|----------|-------------|
| `OPENAI_CODEX_ACCESS_TOKEN` | Alternative to OPENAI_OAUTH_TOKEN |
| `OPENAI_CODEX_REFRESH_TOKEN` | Alternative to OPENAI_OAUTH_REFRESH_TOKEN |
| `ENABLE_LANCEDB` | `true` for semantic retrieval |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-large` recommended |
| `CLAUDE_WRITER_MODEL` | `claude-sonnet-4-5` (default) |
| `ANTHROPIC_AUTH_TOKEN` | Claude Code auth token fallback (`claude setup-token`) |

## SOIS / Sauce context

| Variable | Description |
|----------|-------------|
| `ENABLE_SOIS_CONTEXT` | `true` |
| `SOIS_DATA_URL` | `https://dags.adpinfra.dev/webhook/sois-data` |
| `SOIS_DATA_USERNAME` | SOIS API username |
| `SOIS_DATA_PASSWORD` | SOIS API password |
| `ENABLE_SOIS_SITE_CONTEXT` | `true` |
| `SOIS_SITE_CONTEXT_PATH` | `data/sois-site/context.json` |
| `ENABLE_SOIS_ALL_DATASETS_CONTEXT` | `true` |
| `SOIS_ALL_DATASETS_PATH` | `data/sois-site/all-datasets.json` |

## Web fact-check

| Variable | Description |
|----------|-------------|
| `ENABLE_WEB_FACT_CHECK` | `true` |
| `BRAVE_SEARCH_API_KEY` | Brave Search API key |

## Other

| Variable | Description |
|----------|-------------|
| `OPENAI_MODEL` | `gpt-5.3-codex` |
| `OPENAI_MODEL_FALLBACK` | `gpt-5.2` |
| `GIPHY_API_KEY` | For GIF companions |
| `SLACK_BOT_TOKEN` | For product updates sync |

## Copy-paste (fill your values)

```
ANTHROPIC_API_KEY=
ANTHROPIC_AUTH_TOKEN=
OPENAI_API_KEY=
OPENAI_OAUTH_TOKEN=
OPENAI_OAUTH_REFRESH_TOKEN=
OPENAI_CODEX_ACCOUNT_ID=
OPENAI_CODEX_ACCESS_TOKEN=
OPENAI_CODEX_REFRESH_TOKEN=
ENABLE_LANCEDB=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
CLAUDE_WRITER_MODEL=claude-sonnet-4-5
ENABLE_SOIS_CONTEXT=true
SOIS_DATA_URL=https://dags.adpinfra.dev/webhook/sois-data
SOIS_DATA_USERNAME=
SOIS_DATA_PASSWORD=
ENABLE_SOIS_SITE_CONTEXT=true
SOIS_SITE_CONTEXT_PATH=data/sois-site/context.json
ENABLE_SOIS_ALL_DATASETS_CONTEXT=true
SOIS_ALL_DATASETS_PATH=data/sois-site/all-datasets.json
ENABLE_WEB_FACT_CHECK=true
BRAVE_SEARCH_API_KEY=
OPENAI_MODEL=gpt-5.3-codex
OPENAI_MODEL_FALLBACK=gpt-5.2
GIPHY_API_KEY=
SLACK_BOT_TOKEN=
```

**Note:** prefer `ANTHROPIC_API_KEY` for direct Anthropic API calls. `ANTHROPIC_AUTH_TOKEN` is a fallback path.
