"use client";

import { FormEvent, useMemo, useState } from "react";

import { INPUT_LENGTH_OPTIONS, POST_TYPE_OPTIONS, type InputLength } from "@/lib/constants";
import type { GeneratePostsResponse } from "@/lib/schemas";

type FormState = {
  style: string;
  inputType: string;
  time: string;
  place: string;
  ctaLink: string;
  inputLength: InputLength;
  numberOfPosts: number;
  details: string;
};

const defaultForm: FormState = {
  style: "adapty",
  inputType: POST_TYPE_OPTIONS[1],
  time: "",
  place: "",
  ctaLink: "",
  inputLength: "standard",
  numberOfPosts: 3,
  details: "",
};

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [result, setResult] = useState<GeneratePostsResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const subtitle = useMemo(() => {
    if (form.inputLength !== "mix") {
      return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""} in ${form.inputLength} format`;
    }

    return `${form.numberOfPosts} post${form.numberOfPosts > 1 ? "s" : ""} with mixed lengths (short, standard, long)`;
  }, [form.inputLength, form.numberOfPosts]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error ?? payload?.message ?? "Request failed");
        return;
      }

      setResult(payload as GeneratePostsResponse);
    } catch {
      setError("Could not reach the API route.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10 text-slate-900 md:px-10">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_1.2fr]">
        <form onSubmit={onSubmit} className="space-y-5 rounded-3xl border border-black/10 bg-white/90 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur">
          <header className="space-y-2">
            <p className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs tracking-wide text-white">LinkedIn Generator</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">Adapty Content Studio</h1>
            <p className="text-sm text-slate-600">Generate multiple post variants with hook suggestions, based on your own winning library.</p>
          </header>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Style</span>
              <input
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.style}
                onChange={(event) => setForm((prev) => ({ ...prev, style: event.target.value }))}
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Post Type</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.inputType}
                onChange={(event) => setForm((prev) => ({ ...prev, inputType: event.target.value }))}
              >
                {POST_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Time</span>
              <input
                placeholder="May 17, 5pm CET"
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.time}
                onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Place</span>
              <input
                placeholder="Paris / Online / Booth B12"
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.place}
                onChange={(event) => setForm((prev) => ({ ...prev, place: event.target.value }))}
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-sm font-medium">CTA Link</span>
            <input
              placeholder="https://adapty.io/webinar"
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
              value={form.ctaLink}
              onChange={(event) => setForm((prev) => ({ ...prev, ctaLink: event.target.value }))}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <label className="space-y-1">
              <span className="text-sm font-medium">Input Length</span>
              <select
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.inputLength}
                onChange={(event) => setForm((prev) => ({ ...prev, inputLength: event.target.value as InputLength }))}
              >
                {INPUT_LENGTH_OPTIONS.map((length) => (
                  <option key={length} value={length}>
                    {length}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Number of Posts</span>
              <input
                type="number"
                min={1}
                max={12}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
                value={form.numberOfPosts}
                onChange={(event) => setForm((prev) => ({ ...prev, numberOfPosts: Number(event.target.value || 1) }))}
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-sm font-medium">Extra Prompt Details</span>
            <textarea
              rows={5}
              placeholder="Audience, feature details, angle, constraints, examples to imitate..."
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900"
              value={form.details}
              onChange={(event) => setForm((prev) => ({ ...prev, details: event.target.value }))}
            />
          </label>

          <div className="rounded-xl bg-slate-900/5 px-3 py-2 text-xs text-slate-600">{subtitle}</div>

          <button
            disabled={isLoading}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? "Generating..." : "Generate Posts"}
          </button>

          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </form>

        <section className="space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur">
            <h2 className="text-lg font-semibold">Hook Suggestions</h2>
            {result?.hooks?.length ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {result.hooks.map((hook, index) => (
                  <li key={`${hook}-${index}`} className="rounded-xl border border-black/8 bg-white px-3 py-2">
                    {hook}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Generate posts to see hook ideas here.</p>
            )}
          </div>

          {result ? (
            <div className="space-y-1 text-xs uppercase tracking-wide text-slate-500">
              <p>
                Retrieval method: {result.retrieval.method} ({result.retrieval.examplesUsed} examples)
              </p>
              <p>
                Model: {result.generation.modelUsed}
                {result.generation.fallbackUsed ? ` (fallback from ${result.generation.modelRequested})` : ""}
              </p>
            </div>
          ) : null}

          <div className="space-y-4">
            {result?.posts.map((post, index) => (
              <article key={`${post.hook}-${index}`} className="rounded-3xl border border-black/10 bg-white p-5 shadow-[0_10px_24px_rgba(0,0,0,0.07)]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-wide text-slate-700">
                    Post {index + 1} · {post.length}
                  </p>
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      const text = `${post.hook}\n\n${post.body}\n\n${post.cta}`;
                      navigator.clipboard.writeText(text).catch(() => {});
                    }}
                  >
                    Copy
                  </button>
                </div>

                <p className="mb-3 text-lg font-semibold leading-snug">{post.hook}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{post.body}</p>
                <p className="mt-4 whitespace-pre-wrap text-sm font-medium text-slate-900">{post.cta}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
