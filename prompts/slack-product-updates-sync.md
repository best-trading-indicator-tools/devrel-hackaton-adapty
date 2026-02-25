# Slack Product Updates Sync (via MCP)

When the user asks to sync Slack product updates:

1. **Prerequisite**: Slack MCP must be connected. See "How to connect Slack MCP" below.
2. Use Slack MCP tools to read `#product-release` channel history.
3. For each message that has thread replies:
   - Use `conversations_replies` (or equivalent) to get full thread
   - Keep only posts where the thread has **lengthy comments** (≥80 chars) from:
     - **Product people**: @Kir, @Mykola Martynovets, @Maxim Borisik
     - **OR** any team mention: @sales-team, @cs-team
4. Build JSON matching `SlackProductUpdatesData` in `src/lib/slack-product-updates.ts`
5. Write to `data/slack-product-updates.json`

## Filter rules

| Condition | Include? |
|-----------|----------|
| Thread has reply from Kir, Mykola Martynovets, or Maxim Borisik (≥80 chars) | Yes |
| Thread has @sales-team or @cs-team mention | Yes |
| Thread reply is &lt;80 chars | No (skip that reply; check others) |
| No matching replies | No (exclude post) |

**Lengthy comment**: Reply text length ≥ 80 characters (exclude short reactions/acknowledgments).

## Schema

- `syncedAt`: ISO string
- `channel`: `"#product-release"`
- `entries`: array of `{ id, slackUrl, message, date, matchingReplies, hasTeamMention }`
- `matchingReplies`: `{ userId, userName, text, date }[]`

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
