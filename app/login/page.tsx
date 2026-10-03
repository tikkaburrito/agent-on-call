"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setBusy(false);
      return setError("That code didn't work. Check it and try again.");
    }
    await fetch("/api/claim", { method: "POST" });
    router.replace("/dashboard");
  }

  const input =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5 text-lg text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30";
  const button =
    "rounded-xl bg-amber-400 px-5 py-3.5 text-lg font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-60";

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-5 py-16 text-white">
      <div className="w-full max-w-md">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Agent on Call</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Owner sign in</h1>

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-base text-zinc-300">
              Email
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourbusiness.com"
                className={input}
              />
            </label>
            <button type="submit" disabled={busy} className={button}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button
              type="button"
              onClick={() => email.trim() && setStep("code")}
              className="text-base text-zinc-400 underline-offset-4 hover:underline"
            >
              I already have a code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-base text-zinc-300">
              Code sent to {email}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className={`${input} font-mono tracking-[0.3em]`}
              />
            </label>
            <button type="submit" disabled={busy} className={button}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button type="button" onClick={() => setStep("email")} className="text-base text-zinc-400 underline-offset-4 hover:underline">
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-950 px-4 py-3 text-base text-red-200">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
