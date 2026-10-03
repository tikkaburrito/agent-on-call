"use client";

import { useState } from "react";

export function BookingForm({ siteId, cta }: { siteId: string; cta: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone"),
          consent: form.get("consent") === "on",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/25";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
        Name
        <input name="name" required maxLength={100} autoComplete="name" placeholder="Your name" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
        Email
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
        <span>
          Mobile <span className="font-normal text-stone-500">(optional)</span>
        </span>
        <input name="phone" type="tel" autoComplete="tel" placeholder="(415) 555-0123" className={input} />
      </label>
      <label className="flex items-start gap-3 text-sm text-stone-600">
        <input name="consent" type="checkbox" className="mt-0.5 size-4 accent-amber-700" />
        Text me about my booking. Message rates may apply.
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-amber-700 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
      >
        {busy ? "One moment…" : cta}
      </button>
    </form>
  );
}
