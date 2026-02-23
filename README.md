# Adapty LinkedIn Content Generator

A Next.js app that generates high-performing LinkedIn posts and hook ideas from your own content library.

## What this app includes

- Web UI with inputs for:
  - style (default `adapty`)
  - post type
  - time
  - place
  - CTA link
  - length (`short`, `standard`, `long`, `mix`)
  - number of posts
  - extra prompt details
- API route: `POST /api/generate`
- Local `.txt` library retrieval (default)
- Optional embeddings retrieval with OpenAI embeddings + LanceDB (`ENABLE_LANCEDB=true`)

## Content library format

Edit `content/linkedin-library.txt`.

- Put one example post per block
- Separate blocks with a line containing `---`
- Add as many examples as you want

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Configure env vars:

```bash
cp .env.example .env.local
```

Then set at least `OPENAI_API_KEY` (or `OPENAI_OAUTH_TOKEN` / `OPENAI_ACCESS_TOKEN`).

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
    "inputType":"Event / webinar promo",
    "time":"March 5, 2026 at 6pm CET",
    "place":"Online",
    "ctaLink":"https://adapty.io/webinar",
    "inputLength":"mix",
    "numberOfPosts":4,
    "details":"Focus on practical mobile subscription wins and urgency."
  }'
```

## Vercel preset

Select **Next.js** (correct choice).

## Model routing

- Default model is `OPENAI_MODEL=gpt-5.3-codex`.
- If that model is not available for your token, the API auto-retries with `OPENAI_MODEL_FALLBACK` (default `gpt-5.2`).
- For OpenClaw/OpenAI-compatible gateways, set:
  - `OPENAI_BASE_URL` (for example `http://127.0.0.1:18789/v1`)
  - `OPENAI_API_KEY` to your gateway bearer token
  - `OPENAI_MODEL` to the model your gateway accepts

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
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` is the default for speed and lower cost when indexing large libraries.
- If you want higher semantic precision and accept higher cost/latency, switch to `text-embedding-3-large`.
