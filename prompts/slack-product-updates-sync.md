# Slack Product Updates Sync

When the user asks to sync Slack product updates:

1. **Prerequisite**: `SLACK_BOT_TOKEN` in `.env`. Bot must be invited to #product-release (`/invite @adapty_product_update`).
2. Run: `npm run slack-sync`

## Auto-sync (GitHub Actions)

The workflow `.github/workflows/slack-product-updates-sync.yml` runs every 6 hours and on manual trigger. Add `SLACK_BOT_TOKEN` to repo Secrets.

## Filter rules

| Condition | Include? |
|-----------|----------|
| Thread has reply from Kir, Mykola Martynovets, or Maxim Borisik (≥50 chars) | Yes |
| Thread has @sales-team or @cs-team mention | Yes |
| No matching replies | No (exclude post) |

## Schema

See `src/lib/slack-product-updates.ts`. Entry fields: `id`, `slackUrl`, `name`, `author`, `jiraLink`, `affectedAreas`, `postDate`, `message`, `releaseDate`, `thread`, `content`, `matchingReplies`, `hasTeamMention`, `images`

---

## How to connect Slack MCP

### Option A: Official Slack MCP (Cursor partner)

1. **Cursor**: [cursor.directory/mcp/slack](https://cursor.directory/mcp/slack) — Cursor is an official partner; add Slack MCP in Cursor settings (Tools & MCP).
2. **OAuth flow**: You’ll be prompted to authorize your Slack workspace. No custom app needed for Cursor’s built-in integration.

### Option B: Community slack-mcp-server (korotovsky)

1. Add to Cursor MCP config (e.g. `.cursor/mcp.json` or Cursor Settings → MCP):

```json
{
  "slack": {
    "command": "npx",
    "args": ["-y", "slack-mcp-server@latest", "--transport", "stdio"],
    "env": {
      "SLACK_MCP_XOXC_TOKEN": "xoxc-...",
      "SLACK_MCP_XOXD_TOKEN": "xoxd-..."
    }
  }
}
```

2. **Tokens**: Extract `xoxc` and `xoxd` from browser DevTools (Application → Cookies) when logged into Slack, or use OAuth `xoxp` token.
3. **No admin approval** needed for stealth mode.

### Required scopes (Official Slack MCP)

For reading #product-release and threads:

| Tool | User scopes |
|------|-------------|
| Read channel/thread | `channels:history`, `groups:history` (if private) |
| Search messages | `search:read.public`, `search:read.private` |

Ref: [Slack MCP Server docs](https://docs.slack.dev/ai/slack-mcp-server/)
