"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EMAIL, isEmail, loginEmail, USERNAME } from "@/lib/auth";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");

    if (isEmail(username) ? !EMAIL.test(username) : !USERNAME.test(username)) {
      setBusy(false);
      return setError("Enter your email address, or a username of 3 to 24 lowercase letters, numbers and underscores.");
    }
    if (mode === "signup") {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, full_name: form.get("full_name"), phone: form.get("phone") }),
      });
      if (!res.ok) {
        setBusy(false);
        return setError((await res.json().catch(() => ({}))).error ?? "Could not create the account.");
      }
    }
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: loginEmail(username), password });
    if (error) {
      setBusy(false);
      return setError("That email or username and password don't match.");
    }
    router.replace("/dashboard");
  }

  const input =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5 text-lg text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30";
  const label = "flex flex-col gap-2 text-base text-zinc-300";

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-5 py-16 text-white">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm font-semibold uppercase tracking-widest text-amber-400">
          Agent on Call
        </Link>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          {mode === "signin"
            ? "See your business, projects and what the agent has done."
            : "The agent recognises you by the phone you call from."}
        </p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          {mode === "signup" && (
            <>
              <label className={label}>
                Your name
                <input name="full_name" required maxLength={80} autoComplete="name" placeholder="Dana Brooks" className={input} />
              </label>
              <label className={label}>
                Mobile you&rsquo;ll call from
                <input name="phone" type="tel" required autoComplete="tel" placeholder="(415) 555-0123" className={input} />
              </label>
            </>
          )}
          <label className={label}>
            Email or username
            <input
              name="username"
              required
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              placeholder="you@example.com"
              className={input}
            />
          </label>
          <label className={label}>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
              className={input}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-950 px-4 py-3 text-base text-red-200">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-amber-400 px-5 py-3.5 text-lg font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="mt-6 text-base text-zinc-400 underline-offset-4 hover:text-white hover:underline"
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
