# Adapty LinkedIn Content Generator

A Next.js app that generates high-performing LinkedIn posts and hook ideas from your own content library.

## What this app includes

- Web UI with inputs for:
  - brand voice (`adapty`, `founder personal`, `bold / contrarian`, `technical breakdown`, `playful meme tone`, or custom)
  - goal (`virality`, `engagement`, `traffic`, `awareness`, `balanced`) with automatic metric-weight profile
  - post type
  - time
  - place
  - CTA link
  - optional image attachment (model vision context)
  - length (`short`, `standard`, `long`, `mix`)
  - number of posts
  - extra prompt details
- API route: `POST /api/generate`
- Local `.txt` library retrieval (default)
- Optional embeddings retrieval with OpenAI embeddings + LanceDB (`ENABLE_LANCEDB=true`)
- Automatic Memegen companions for `Meme / shitpost` post type with ranked variants
  - `Meme Variants Per Post` x `Number of Posts` = total meme images generated
  - Meme tone preset dropdown for faster setup
  - Template picker with live Memegen template fetch, search, image previews, and curated fallback
- Optional chart companions rendered server-side with `chartjs-node-canvas` from your chosen chart type, labels, and values

## Content library format

Edit both:
- `content/linkedin-adapty-library.txt` for your own Adapty posts
- `content/linkedin-others-library.txt` for competitor/market posts

- Put one example post per block
- Separate blocks with a line containing `---`
- Add as many examples as you want
- Optional: add performance metadata at the top of a block:
  - `Impressions: 12000`
  - `Likes: 340`
  - `Comments: 42`
  - `Repost: 15`
  - `Clicks: 180`
  - `CTR: 5.49%`
- Metadata lines must appear before the post text in that block.
- In `content/linkedin-others-library.txt`, `Likes`, `Comments`, and `Reposts` are enough. `Impressions`, `Clicks`, and `CTR` are optional.

Example:

```txt
Impressions: 24.5k
Likes: 690
Comments: 81
You asked, we built it.
[Feature] is live.

What changed:
- ...
---
```

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Configure env vars:

```bash
cp .env.example .env.local
```

For generation, OAuth is preferred:

- Set `OPENAI_OAUTH_TOKEN` (+ `OPENAI_OAUTH_ACCOUNT_ID`, optional refresh vars), or
- On local macOS/Linux with Codex CLI installed, the app auto-reads `~/.codex/auth.json`.

For embeddings/LanceDB, set `OPENAI_API_KEY` (OAuth tokens usually do not have embeddings scope).

3. Run:

```bash
npm run dev
```

## API request example

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "style":"adapty",
    "goal":"virality",
    "inputType":"Event / webinar promo",
    "chartEnabled": true,
    "chartType":"doughnut",
    "chartTitle":"Trial strategy split",
    "chartData":"{\"labels\":[\"Without trial\",\"Paid trial\",\"Free trial\"],\"datasets\":[{\"label\":\"Share %\",\"data\":[56.9,28.9,14.3]}]}",
    "chartOptions":"{\"plugins\":{\"legend\":{\"position\":\"right\"}}}",
    "time":"March 5, 2026 at 6pm CET",
    "place":"Online",
    "ctaLink":"https://adapty.io/webinar",
    "imageDataUrl":"data:image/jpeg;base64,...",
    "inputLength":"mix",
    "numberOfPosts":4,
    "details":"Focus on practical mobile subscription wins and urgency."
  }'
```

## Vercel preset

Select **Next.js** (correct choice).

## Model routing

- Default model is `OPENAI_MODEL=gpt-5.3-codex`.
- Generation auth priority:
  1. Codex OAuth (`OPENAI_OAUTH_TOKEN` or `~/.codex/auth.json`)
  2. API key (`OPENAI_API_KEY` / `OPENAI_ACCESS_TOKEN`)
- If the requested model is unavailable, the API auto-retries with `OPENAI_MODEL_FALLBACK` (default `gpt-5.2`).
- Codex OAuth calls `https://chatgpt.com/backend-api/codex/responses` by default (override with `OPENAI_CODEX_BASE_URL`).
- API-key mode uses Chat Completions and supports `OPENAI_BASE_URL` for OpenAI-compatible gateways.

## Deploy (claimable preview)

This project can be deployed with the `vercel-deploy` skill script:

```bash
bash /Users/dave/.codex/skills/vercel-deploy/scripts/deploy.sh .
```

The script returns:

- `Preview URL` (live immediately)
- `Claim URL` (attach deployment to your Vercel account/project)

## Notes

- If `ENABLE_LANCEDB=true`, the app builds/uses a local `.lancedb` index for retrieval.
- If LanceDB retrieval fails, the API falls back to lexical retrieval from the `.txt` library.
- Retrieval scoring weights auto-switch by selected goal; exact weight profiles are documented at the top of `content/linkedin-adapty-library.txt`.
- Retrieval combines both Adapty and Others libraries, and each example is tagged by source in prompt context.
- Vercel/serverless builds run a prebuild prune step to keep only one Linux LanceDB native package (`gnu` or `musl`) so `api/generate` stays under function size limits.
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` is the default for speed and lower cost when indexing large libraries.
- If you want higher semantic precision and accept higher cost/latency, switch to `text-embedding-3-large`.
- OAuth-only setups can still generate posts, but may fall back to lexical retrieval because embeddings usually require API-key scopes.
- Memegen URLs default to `https://api.memegen.link`; set `MEMEGEN_BASE_URL` to your own Memegen host if you self-host.
