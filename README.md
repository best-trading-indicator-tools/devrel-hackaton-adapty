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
- Hook Style
  - Presets: `balanced`, `clickbait`, `data-driven`, `question-led`, `contrarian`, `story-led`
  - Custom option with free text field
- Goal
  - `virality`, `engagement`, `traffic`, `awareness`, `balanced`
- Post Type
  - Product feature launch
  - Event / webinar promo
  - Sauce
  - Meme / shitpost
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
  - 1 to 12
- Extra Prompt Details
  - Free text instruction field

### Post editing after generation

- Rewrite entire post with an optional prompt
- Regenerate one selected body line with an optional line-specific prompt
- Rewrites happen in place in the results view
- Meme companions are cleared when a post is rewritten so visuals do not drift from updated copy

### Conditional UI behavior

- Event fields (`Time`, `Place`) only appear for event/webinar post types
- Meme options only appear for meme/shitpost post type
- Chart options are hidden for meme/shitpost post type
- CTA link is optional

### Meme companion system

- Enabled only for meme/shitpost post type
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

- System prompt is explicitly anchored to Adapty business context:
  - "You create LinkedIn content at scale for Adapty"
  - Adapty described as helping app makers monetize mobile apps
- Prompt is modular:
  - Global anti-slop writing contract
  - Brand voice playbook
  - Post type playbook
  - Goal playbook
  - Hard self-check gate (regenerate if rules fail)
- Prompt also loads repository guides:
  - `prompts/linkedin/WRITING.md`
  - `prompts/linkedin/SAUCE.md` (applied for Sauce post type)
  - `prompts/linkedin/FACT_CHECK.md`
- If Brand Voice is `adapty`, prompt treats `linkedin-adapty-library` as canonical style source
- If Hook Style is `clickbait`, prompt applies curiosity-gap style while requiring truthful claims
- If Goal is `virality`, prompt emphasizes uncomfortable obvious truths with practical utility
- Optional web fact-check context is injected when configured (Brave Search)
- If CTA link is provided, API ensures it is included in final CTA line
- Image context is passed to model when attached

## Auth and model routing

- Preferred auth path: Codex OAuth
- API key path supported as fallback
- Model fallback supported for unavailable model access

Priority order:

1. Codex OAuth credentials (`OPENAI_OAUTH_TOKEN` or `~/.codex/auth.json`)
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
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `OPENAI_EMBEDDING_BASE_URL` (optional)

### Memes

- `MEMEGEN_BASE_URL` (optional, defaults to `https://api.memegen.link`)

### Optional web fact-check

- `ENABLE_WEB_FACT_CHECK=true|false` (default: auto-enabled when Brave key is present)
- `BRAVE_SEARCH_API_KEY` (required to run live web evidence lookup)
- `WEB_FACT_CHECK_MAX_RESULTS` (optional, default `4`)

## Why `text-embedding-3-small` by default

- Lower cost
- Faster indexing and retrieval
- Good quality for this library-matching use case

If you want more semantic precision, switch to `text-embedding-3-large`.

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
- `hookStyle`
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
