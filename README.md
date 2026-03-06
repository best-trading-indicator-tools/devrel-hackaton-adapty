# Adapty LinkedIn Content Studio

Next.js app that generates LinkedIn posts, hooks, meme companions, and optional chart companions from your historical content libraries.

## Current implementation status

Everything below is already implemented in this repo on `main`.

### Core product

- Web UI for marketers at `src/app/page.tsx`
- API endpoint at `POST /api/generate`
- Rewrite API endpoint at `POST /api/rewrite`
- Generation with `gpt-5.3-codex` by default
- Strong formatting guardrails for LinkedIn readability
- No em dash output normalization for hooks, posts, meme text, and chart title

### Inputs supported

- Brand Voice
  - Presets: `adapty`, `clickbait`, `founder personal`, `bold / contrarian`, `technical breakdown`, `playful meme tone`
  - Custom option with free text field
  - In-UI "Brand Voice Guide" that explains each preset
- Goal
  - `virality`, `engagement`, `traffic`, `awareness`, `balanced`
- Post Type
  - Product feature launch
  - Event / webinar promo
  - SOIS
  - SOIS Pre-launch
  - Industry news reaction
  - Engagement farming: poll/quiz
  - Case study / social proof
  - Hiring / team culture
  - Milestone / company update
  - Controversial hot take
  - Curated roundup
- Time and Place
  - Time uses `datetime-local` picker
  - Only shown when post type implies event/webinar
- CTA Link
  - Optional
  - If provided, appended into final CTA line in generated post
- Attach Image
  - Optional
  - Image is resized/compressed client-side, sent as data URL, and used as extra model context
- Input Length
  - `short`, `standard`, `long`, `mix`
- Number of Posts
  - 1 to 20
- Extra Prompt Details
  - Free text instruction field

### Post editing after generation

- Rewrite entire post with an optional prompt
- Click any body line to select it, then either:
  - edit it manually and apply changes
  - regenerate it with AI using an optional line-specific prompt
- Rewrites happen in place in the results view
- Meme companions are cleared when a post is rewritten so visuals do not drift from updated copy

### Conditional UI behavior

- Event fields (`Time`, `Place`) only appear for event/webinar post types
- Meme options appear for all post types (optional add-on)
- Chart options appear for all post types
- CTA link is optional

### Stack dopamine prompt framework

Posts are prompted to stack multiple dopamine elements — one hook is not enough. The shared rule: combine at least 2–3 of (a) concrete scenario, (b) counter-intuitive insight, (c) emotional payoff, (d) visual anchor when chart/meme is enabled.

**Per goal**

| Goal | Stack formula |
|------|---------------|
| virality | scenario + counter-intuitive insight + emotional payoff |
| engagement | relatable scenario + debatable take + question |
| traffic | specific pain + surprising angle + clear value |
| awareness | memorable scenario + one crisp message + repeatable framing |
| balanced | at least two of: scenario, insight, payoff |

**Per brand voice**

| Voice | Stack formula |
|-------|---------------|
| adapty | scenario + mechanism + proof |
| clickbait | curiosity + stakes + payoff |
| founder personal | lived moment + trade-off + honest caveat |
| bold / contrarian | contrarian claim + mechanism + better alternative |
| technical breakdown | concrete setup + step-by-step mechanism + surprising result |
| playful meme tone | setup + punchline + relatable pain |

**Per post type**

| Post type | Stack formula |
|-----------|---------------|
| event / webinar | relatable scenario + why-now + logistics + takeaway |
| product feature launch | pain story + what changed + concrete outcome |
| SOIS | concrete scenario + mechanism + numbers + caveat |
| SOIS pre-launch | launch update + teaser insight + prediction poll + payoff |
| industry news reaction | news hook + real-team impact + implication + next move |
| engagement farming | context + clear options + why it matters |
| case study | before + intervention + after + measurable result |
| hiring / team culture | culture-defining moment + ownership + human detail |
| milestone | milestone + brief story of how + why it matters |
| controversial hot take | contrarian claim + illustrative story + mechanics + alternative |
| curated roundup | one takeaway per item + recommendation on what to read first |

**SOIS posts and report data**

SOIS posts fetch real benchmark data from the State of in-app subscriptions report at `https://dags.adpinfra.dev/webhook/sois-data`. Categories used: conversions, pricing, retention, paywalls, ltv, market. For SOIS posts, only numbers/percentages from report evidence are allowed — not from web fact-check or user input. Unsupported claims are rewritten to qualitative phrasing.

### Meme companion system

- Optional add-on for any post type (toggle "Add Meme Companion")
- Meme tone dropdown:
  - `auto`, `playful`, `contrarian`, `clickbait`, `absurd`, `deadpan`, `sarcastic`, `dramatic`, `wholesome`
- Variants per post (1 to 6)
- Total generated meme images = `numberOfPosts x memeVariantCount`
- Template picker:
  - Fetches live templates from `https://api.memegen.link/templates/`
  - Searchable
  - Shows template preview images
  - Multi-select template support
  - Auto mode when nothing is selected
  - Fallback to curated local list if live template fetch fails
- Meme output rendering:
  - Top variant + additional variants per post
  - Each variant includes image URL, top text, bottom text, score, and short reason

### Chart companion system

- Optional checkbox: `Add Chart Companion`
- No JSON required in UI
- Chart data entry is row-based:
  - Label
  - Primary value
  - Optional secondary value for non-radial charts
- Supported chart types:
  - `bar`, `line`, `doughnut`, `pie`, `polarArea`, `radar`
- Rendered server-side with `chart.js + canvas`
- Returns one PNG chart per generation run
- Included in UI result with preview + Download PNG + Copy Data URL

### Retrieval and library intelligence

- Two libraries are read and merged for context:
  - `content/linkedin-adapty-library.txt`
  - `content/linkedin-others-library.txt`
- Optional SOIS benchmark context can be fetched from Adapty internal endpoint and merged into generation evidence:
  - `https://dags.adpinfra.dev/webhook/sois-data`
  - Categories: `ltv`, `conversions`, `pricing`, `market`, `retention`, `refunds`, `stores`, `ai`, `paywalls`, `webpaywalls`
- Block separator: line containing `---`
- Optional performance metadata per block:
  - `Impressions`, `Likes`, `Comments`, `Repost/Reposts`, `Clicks`, `CTR`
- Source-aware behavior:
  - `adapty` source examples are canonical tone when Brand Voice is `adapty`
  - `others` source examples are used for angle/pattern inspiration, not final brand tone
- Retrieval methods:
  - Lexical retrieval (default)
  - LanceDB retrieval with embeddings (optional)
- Automatic fallback:
  - If LanceDB fails, lexical retrieval is used
- Performance pattern extraction:
  - Analyzes metrics and pattern frequency to enrich prompt context
  - Goal-aware weighting profile changes by selected goal

### Goal weighting profiles used in retrieval scoring

These are implemented in `src/lib/library-retrieval.ts`.

| Goal | impressionsLog | likes | comments | reposts | clicks | engagementRate | ctr |
|---|---:|---:|---:|---:|---:|---:|---:|
| virality | 32 | 1.2 | 3.2 | 6.2 | 0.8 | 220 | 45 |
| engagement | 14 | 1.8 | 6.5 | 3.4 | 0.9 | 300 | 45 |
| traffic | 10 | 1.0 | 2.4 | 2.1 | 3.8 | 110 | 320 |
| awareness | 52 | 1.1 | 2.2 | 3.8 | 0.6 | 130 | 35 |
| balanced | 22 | 1.5 | 3.5 | 3.8 | 2.0 | 180 | 140 |

## Generation behavior and prompt policy

### Prompt design principles

The prompting system follows two core principles:

1. **Tell AI what to DO, not what NOT to do.** Positive voice targets ("write like a sharp friend talking to another app maker") produce better results than negative rule lists ("avoid corporate jargon", "reject robotic phrasing"). The model aims at a clear target instead of navigating a minefield of prohibitions.
2. **Show, don't tell.** Few-shot library examples are the primary voice anchor, positioned at the top of the user prompt. Models learn voice from examples far better than from rules.

### Generation pipeline

Each generation request goes through 3 passes:

1. **Writer pass** (temperature 0.8): Generates posts using the system prompt, writing guide, brand voice directive, goal playbook, post type directive, and library examples as voice anchors.
2. **Quality repair pass** (conditional): If regex-based checks detect mechanical issues (missing em dashes, missing proof units, etc.), the draft is sent back to the LLM for targeted fixes.
3. **Editor pass** (temperature 0.4, always runs): A separate LLM call with a dedicated editor persona reads every draft and rewrites sentences that sound AI-generated. Cuts throat-clearing, fixes false-profundity patterns, enforces natural phrasing, and applies terminology preferences. This pass only tightens existing content and never adds new material.

### Prompt files

- `prompts/linkedin/WRITING.md` — ~14 positive voice principles with before/after examples of sloppy vs clean writing
- `prompts/linkedin/SAUCE.md` (applied for SOIS post type)
- `prompts/linkedin/SOIS_PRELAUNCH.md` (applied for SOIS Pre-launch post type)
- `prompts/linkedin/ASO.md` (applied for SOIS post type)
- `prompts/linkedin/PAYWALL.md` (applied for SOIS post type)
- `prompts/linkedin/FACT_CHECK.md`

### Prompt structure

- System prompt is conversational: "write like a sharp friend who works in mobile apps talking to another operator"
- Library examples are positioned as "Voice anchor" at the top of the user prompt
- User prompt consolidates directives into ~7 lines (brand voice + hook, goal, post type, facts policy, details, chart, meme)
- Quality gate is 7 positive self-checks (down from 23 negative rules)
- Editor pass uses a focused ~15-line prompt with concrete before/after examples of AI slop patterns to fix
- If Brand Voice is `adapty`, prompt treats `linkedin-adapty-library` as canonical style source
- Hook strategy is auto-derived from Brand Voice + Goal combination
- Optional web fact-check context is injected when configured (Brave Search)
- If CTA link is provided, API ensures it is included in final CTA line
- Image context is passed to model when attached

## Auth and model routing

- Writer default: Claude Sonnet 4.5 when `ANTHROPIC_API_KEY` is set (`USE_CLAUDE_WRITER=true`)
- Reviewer is always Codex OAuth
- Reviewer requires Codex OAuth credentials (`OPENAI_CODEX_ACCESS_TOKEN` or `OPENAI_OAUTH_TOKEN`)
- Model fallback supported for unavailable model access

Priority order:

1. Codex OAuth credentials (`OPENAI_CODEX_ACCESS_TOKEN` / `OPENAI_OAUTH_TOKEN` or `~/.codex/auth.json`)
2. API key (`OPENAI_API_KEY` or `OPENAI_ACCESS_TOKEN`)

Codex OAuth path details:

- Uses Codex Responses endpoint (`/codex/responses`)
- Supports image input
- Supports strict JSON schema outputs
- Reads from env or `~/.codex/auth.json`
- Can auto-refresh OAuth token when refresh token is available

## Environment variables

Use `.env` (local) and set same keys in Vercel project settings.

### Generation/auth

- `OPENAI_MODEL` (default `gpt-5.3-codex`)
- `OPENAI_MODEL_FALLBACK` (default `gpt-5.2`)
- `ANTHROPIC_API_KEY` (Claude API key from Anthropic Console)
- `ANTHROPIC_AUTH_TOKEN` (optional fallback token from `claude setup-token`)
- `CLAUDE_WRITER_MODEL` (default `claude-sonnet-4-5`)
- `USE_CLAUDE_WRITER=true|false` (default `true`)
- `FORCE_CODEX_REVIEWER=true|false` (default `true`; always runs reviewer pass for all post types)
- `FORCE_CODEX_REVIEWER_FOR_SAUCE=true|false` (legacy fallback key; used only when `FORCE_CODEX_REVIEWER` is unset)
- `OPENAI_CODEX_AUTH_MODE` (optional; usually `chatgpt`)
- `OPENAI_CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_REFRESH_TOKEN` (optional)
- `OPENAI_CODEX_ACCOUNT_ID` (optional if derivable)
- `OPENAI_CODEX_EXPIRES_AT` or `OPENAI_CODEX_EXPIRES_AT_ISO` (optional)
- `OPENAI_OAUTH_TOKEN`
- `OPENAI_OAUTH_REFRESH_TOKEN` (optional)
- `OPENAI_OAUTH_ACCOUNT_ID` (optional if derivable)
- `OPENAI_OAUTH_EXPIRES_AT` (optional)
- `OPENAI_API_KEY` (API key mode and embeddings)
- `OPENAI_ACCESS_TOKEN` (alternative API key var)
- `OPENAI_BASE_URL` (optional OpenAI-compatible endpoint for API-key mode)
- `OPENAI_CODEX_BASE_URL` (optional Codex backend override)

### Retrieval

- `ENABLE_LANCEDB=true|false`
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`, recommended `text-embedding-3-large` for quality-first retrieval)
- `OPENAI_EMBEDDING_BASE_URL` (optional)
- `ENABLE_SOIS_CONTEXT=true|false` (default: true)
- `SOIS_DATA_URL` (default: `https://dags.adpinfra.dev/webhook/sois-data`)
- `SOIS_DATA_USERNAME`
- `SOIS_DATA_PASSWORD`
- `ENABLE_SOIS_SITE_CONTEXT=true|false` (default: true; include local SOIS website snapshot in retrieval evidence)
- `SOIS_SITE_CONTEXT_PATH` (optional path override; default `data/sois-site/context.json`)

### Memes

- `MEMEGEN_BASE_URL` (optional, defaults to `https://api.memegen.link`)

### Optional web fact-check

- `ENABLE_WEB_FACT_CHECK=true|false` (default: auto-enabled when Brave key is present)
- `BRAVE_SEARCH_API_KEY` (required to run live web evidence lookup)
- `WEB_FACT_CHECK_MAX_RESULTS` (optional, default `4`)

## Embedding model choice

- `text-embedding-3-small`:
  - Lower cost
  - Faster indexing and retrieval
  - Good default when iterating often
- `text-embedding-3-large`:
  - Better semantic precision and ranking quality
  - Better for nuanced style matching and mixed-topic libraries
  - Higher cost and a bit slower

Recommendation:
- Use `text-embedding-3-large` in production when output quality is the priority and library updates are not extremely frequent.

## SOIS website snapshot sync

Use this when you want to refresh context from the public SOIS website:

```bash
npm run sois-site-sync
```

The command:

- Discovers all `/data/*.json` files referenced by the SOIS frontend bundle
- Downloads raw datasets into `data/sois-site/raw/`
- Builds normalized machine context at `data/sois-site/context.json`
- Regenerates `prompts/linkedin/SOIS.md`

## Content library format

Use these two files only:

- `content/linkedin-adapty-library.txt`
- `content/linkedin-others-library.txt`

Formatting rules:

- One post block per example
- Separate blocks with `---`
- Metric lines go at the top of block, before post text
- `linkedin-others-library.txt` can omit `Impressions`, `Clicks`, `CTR`

Example block:

```txt
Impressions: 1511
Likes: 52
Comments: 2
Repost: 1
Clicks: 83
CTR: 5.49%

We're heading to Apps Forum Lisbon on March 4, and bringing the full crew.
...
---
```

## API contract

### Endpoint

- `POST /api/generate`

### Request body (high level)

- `style`
- `goal`
- `inputType`
- `time` (optional/conditional)
- `place` (optional/conditional)
- `ctaLink` (optional)
- `imageDataUrl` (optional)
- `inputLength`
- `numberOfPosts`
- `details`
- `memeTone` / `memeBrief` / `memeTemplateIds[]` / `memeVariantCount` (meme mode)
- `chartEnabled` / `chartType` / `chartTitle` / `chartData` / `chartOptions` (chart mode)

### Response body (high level)

- `hooks[]`
- `posts[]`
  - `hook`, `body`, `cta`, `length`
  - optional `meme` and `memeVariants[]`
- optional `chart`
- `generation` metadata
- `retrieval` metadata

Note: generation/retrieval metadata is returned by API but intentionally not shown in UI.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

If you get a lock error like `.next/dev/lock`, stop other running `next dev` process first, then restart.

## Build and deployment

### Vercel preset

- Use `Next.js` preset

### Auto deploy on push

- Connect the correct GitHub repo to your Vercel project
- Ensure production branch is `main`
- Push commits to `main`

### Serverless size handling

- `prebuild` runs `scripts/prune-lancedb-binaries.mjs`
- On Linux builds it keeps only one LanceDB native binary variant (glibc or musl)
- `build` runs `sois-embeddings` before `next build` (best-effort; requires `OPENAI_API_KEY` for semantic retrieval)

## Troubleshooting

### Chart rendering failed

- Validate chart rows have matching label/value counts
- Ensure numeric fields are valid numbers
- API returns detailed chart error message in response `message`

### Memegen template list fails to load

- UI automatically falls back to curated local template list
- Generation still works

### No Vercel deploy after push

- Confirm Vercel project Git integration points to this repo:
  - `best-trading-indicator-tools/devrel-hackaton-adapty`
- Confirm push landed on tracked branch (`main`)

## Security notes

- Never commit OAuth tokens or API keys
- Keep secrets only in local `.env` and Vercel environment variables
