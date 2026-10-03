"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { type ActionStatus, AUTOMATION_LABEL, type Automation, dollars } from "@/lib/types";

type CallEvent = {
  id: number;
  at: string;
  kind: "transcript" | "tool_call" | "tool_result" | "status";
  role: string | null;
  text: string | null;
  data: { args?: unknown; tool?: string; ok?: boolean; ms?: number } | null;
};
type CallAction = {
  id: string;
  type: "email" | "sms" | "invoice" | "call";
  status: ActionStatus;
  payload: { subject?: string; body?: string; amount_cents?: number; intent?: string; copy_source?: string };
  result: { error?: string; reason?: string; note?: string; hosted_invoice_url?: string; sms_error?: string; outcome?: string; outcome_note?: string } | null;
  created_at: string;
  customers: { name: string; email: string } | null;
};
type CallBuild = { id: string; status: string; url: string | null; error: string | null };
type Call = {
  id: string;
  business: string | null;
  caller_phone: string | null;
  type: string | null;
  status: string;
  ended_reason: string | null;
  summary: string | null;
  recording_url: string | null;
  started_at: string;
  ended_at: string | null;
  events: CallEvent[];
  actions: CallAction[];
  builds: CallBuild[];
};
type BusinessRow = {
  id: string;
  name: string;
  owner: { username: string; full_name: string | null; phone: string | null; is_admin: boolean } | null;
  projects: { id: string; slug: string; product_name: string; price_cents: number; discount_percent: number; landing_url: string | null; customers: number }[];
};

type AutoRule = Automation & { business?: string; project?: string };
type AutoAction = CallAction & { business?: string; project?: string };

const STATUS_STYLE: Record<ActionStatus, string> = {
  proposed: "bg-zinc-700 text-zinc-100",
  approved: "bg-sky-500 text-sky-950",
  executing: "bg-sky-400 text-sky-950 animate-pulse",
  executed: "bg-emerald-400 text-emerald-950",
  simulated: "bg-violet-400 text-violet-950",
  failed: "bg-red-500 text-white",
  cancelled: "bg-zinc-800 text-zinc-400 line-through",
};
const TYPE_LABEL = { email: "Email", sms: "Text", invoice: "Invoice", call: "Call" } as const;
const TOOL_LABEL: Record<string, string> = {
  get_attention_items: "Checked what needs attention",
  find_customers: "Looked up customers",
  propose_actions: "Drafted messages",
  confirm_actions: "Sent the batch",
  cancel_actions: "Cancelled the batch",
  build_landing_page: "Started a landing page",
  get_recent_actions: "Read back what was sent",
  get_project: "Looked at the project and its landing page",
  create_project: "Created a new project",
  set_automation: "Changed an automation",
  add_customer: "Added a customer",
  mark_paid: "Marked an order paid",
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const live = (c: Call) => c.status !== "ended";
function duration(c: Call) {
  if (!c.ended_at) return "";
  const s = Math.max(0, Math.round((Date.parse(c.ended_at) - Date.parse(c.started_at)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function Admin() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [tab, setTab] = useState<"calls" | "automations" | "businesses">("calls");
  const [calls, setCalls] = useState<Call[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [auto, setAuto] = useState<{ rules: AutoRule[]; actions: AutoAction[] }>({ rules: [], actions: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/data", { cache: "no-store" });
    if (res.status === 401) return router.replace("/login");
    if (res.status === 403) return setState("denied");
    if (!res.ok) return;
    const data = await res.json();
    setCalls(data.calls);
    setBusinesses(data.businesses);
    setAuto(data.automations ?? { rules: [], actions: [] });
    setSelected((current) => current ?? data.calls[0]?.id ?? null);
    setState("ready");
  }, [router]);

  useEffect(() => {
    void load();
    // Any new transcript line, tool call or action status refreshes the view.
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 350);
    };
    const channel = supabase.channel("admin-console");
    for (const table of ["calls", "call_events", "actions", "site_builds", "automations"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, soon);
    }
    channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));
    const tick = setInterval(() => void load(), 15_000);
    return () => {
      clearInterval(tick);
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  if (state === "loading") {
    return <main className="flex flex-1 items-center justify-center bg-zinc-950 text-2xl text-zinc-400">Loading…</main>;
  }
  if (state === "denied") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 bg-zinc-950 px-6 text-center text-white">
        <h1 className="text-3xl font-semibold">This page is for admins.</h1>
        <Link href="/dashboard" className="rounded-xl bg-zinc-800 px-5 py-3 text-lg hover:bg-zinc-700">
          Go to your dashboard
        </Link>
      </main>
    );
  }

  const call = calls.find((c) => c.id === selected) ?? null;
  const tabClass = (active: boolean) =>
    `rounded-full px-5 py-2 text-base font-semibold transition ${active ? "bg-amber-400 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800"}`;

  return (
    <main className="flex-1 bg-zinc-950 px-5 py-6 text-white md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-semibold uppercase tracking-widest text-amber-400">
            Agent on Call
          </Link>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">Admin console</h1>
        </div>
        <div className="flex items-center gap-5 text-base text-zinc-400">
          <span className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {connected ? "Live" : "Connecting…"}
          </span>
          <Link href="/dashboard" className="underline-offset-4 hover:text-white hover:underline">
            My dashboard
          </Link>
        </div>
      </header>

      <nav className="mt-6 flex gap-2">
        <button onClick={() => setTab("calls")} className={tabClass(tab === "calls")}>
          Calls ({calls.length})
        </button>
        <button onClick={() => setTab("automations")} className={tabClass(tab === "automations")}>
          Automations ({auto.rules.length} on)
        </button>
        <button onClick={() => setTab("businesses")} className={tabClass(tab === "businesses")}>
          Users and businesses ({businesses.length})
        </button>
      </nav>

      {tab === "automations" ? (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Switched on</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {auto.rules.length === 0 && <li className="text-base text-zinc-400">No automations are on. Owners turn them on by asking the agent.</li>}
            {auto.rules.map((r) => (
              <li key={r.id} className="rounded-2xl bg-zinc-900 px-4 py-3 text-base ring-1 ring-zinc-800">
                <span className="font-semibold text-emerald-300">{AUTOMATION_LABEL[r.kind]}</span>
                {r.kind !== "welcome_new_signups" ? ` after ${r.delay_minutes >= 60 ? `${Math.round(r.delay_minutes / 60)}h` : `${r.delay_minutes}m`}` : ""}
                <span className="text-zinc-400"> · {r.business} / {r.project}</span>
              </li>
            ))}
          </ul>
          <h2 className="mt-8 text-xl font-semibold">Sent automatically</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {auto.actions.length === 0 && <li className="text-base text-zinc-400">Nothing has been sent by an automation yet.</li>}
            {auto.actions.map((a) => (
              <li key={a.id} className="row-in rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
                <button onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                  <span className="w-24 shrink-0 text-base font-semibold text-amber-400">{TYPE_LABEL[a.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-medium">{a.customers?.name ?? "Customer"}</span>
                    <span className="block truncate text-sm text-zinc-400">
                      {a.business} / {a.project} · {day(a.created_at)} {clock(a.created_at)} · {a.payload.subject || a.payload.body}
                    </span>
                  </span>
                  <span key={a.status} className={`status-pop shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[a.status]}`}>
                    {a.status}
                  </span>
                </button>
                {open === a.id && (
                  <div className="border-t border-zinc-800 px-5 py-4 text-base leading-relaxed text-zinc-300">
                    {a.payload.subject && <p className="font-semibold text-white">{a.payload.subject}</p>}
                    <p className="mt-1 whitespace-pre-wrap">{a.payload.body}</p>
                    {a.result?.error && <p className="mt-3 text-red-300">Failed: {a.result.error}</p>}
                    {a.result?.reason && <p className="mt-3 text-violet-300">Not sent: {a.result.reason} (demo data).</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : tab === "businesses" ? (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {businesses.map((b) => (
            <article key={b.id} className="rounded-2xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
              <h2 className="text-2xl font-semibold">{b.name}</h2>
              <p className="mt-1 text-base text-zinc-400">
                {b.owner
                  ? `Owner: ${b.owner.full_name ?? b.owner.username} (${b.owner.username})${b.owner.phone ? ` · calls from ${b.owner.phone}` : ""}${b.owner.is_admin ? " · admin" : ""}`
                  : "No owner"}
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {b.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-zinc-950 px-4 py-3">
                    <span className="text-lg font-medium">{p.product_name}</span>
                    <span className="text-base text-zinc-400">
                      {dollars(p.price_cents)}
                      {p.discount_percent ? ` · ${p.discount_percent}% off` : ""} · {p.customers} customers ·{" "}
                      <a href={`/s/${p.slug}`} target="_blank" rel="noreferrer" className="text-amber-400 underline underline-offset-4">
                        signup page
                      </a>
                      {p.landing_url && (
                        <>
                          {" · "}
                          <a href={p.landing_url} target="_blank" rel="noreferrer" className="text-emerald-400 underline underline-offset-4">
                            landing page
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
          <aside aria-label="Calls" className="flex max-h-[75vh] flex-col gap-2 overflow-y-auto pr-1">
            {calls.length === 0 && (
              <p className="rounded-2xl bg-zinc-900 p-5 text-lg text-zinc-400 ring-1 ring-zinc-800">
                No calls yet. Call the agent and it will show up here as it happens.
              </p>
            )}
            {calls.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                aria-current={c.id === selected}
                className={`rounded-2xl p-4 text-left ring-1 transition ${
                  c.id === selected ? "bg-zinc-800 ring-amber-400" : "bg-zinc-900 ring-zinc-800 hover:bg-zinc-800"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-lg font-semibold">{c.business ?? "Unknown caller"}</span>
                  {live(c) ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-sm font-semibold text-emerald-300">
                      <span className="size-2 animate-pulse rounded-full bg-emerald-400" /> Live
                    </span>
                  ) : (
                    <span className="text-sm text-zinc-500">{duration(c)}</span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-zinc-400">
                  {day(c.started_at)} {clock(c.started_at)} ·{" "}
                  {c.type === "webCall" ? "web call" : c.type === "outboundPhoneCall" ? `outbound to ${c.caller_phone ?? "customer"}` : c.caller_phone ?? "no caller ID"}
                </span>
                <span className="mt-1 block text-sm text-zinc-500">
                  {c.events.filter((e) => e.kind === "tool_call").length} tool calls · {c.actions.length} actions
                </span>
              </button>
            ))}
          </aside>

          <section aria-label="Call detail" className="min-w-0">
            {!call ? (
              <p className="text-lg text-zinc-400">Select a call.</p>
            ) : (
              <>
                <div className="rounded-2xl bg-zinc-900 p-5 ring-1 ring-zinc-800">
                  <h2 className="text-2xl font-semibold">{call.business ?? "Unknown caller"}</h2>
                  <p className="mt-1 text-base text-zinc-400">
                    {day(call.started_at)} {clock(call.started_at)} · {call.type === "webCall" ? "web call" : call.type === "outboundPhoneCall" ? `outbound call to ${call.caller_phone ?? "customer"}` : `from ${call.caller_phone ?? "unknown"}`} ·{" "}
                    {live(call) ? "in progress" : `ended${call.ended_reason ? ` (${call.ended_reason.replaceAll("-", " ")})` : ""}`}
                  </p>
                  {call.summary && <p className="mt-3 text-base leading-relaxed text-zinc-300">{call.summary}</p>}
                  {call.recording_url && (
                    <a href={call.recording_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-amber-400 underline underline-offset-4">
                      Listen to the recording
                    </a>
                  )}
                </div>

                <h3 className="mt-6 text-xl font-semibold">Transcript and tool calls</h3>
                <ol className="mt-3 flex flex-col gap-2.5">
                  {call.events.length === 0 && <li className="text-base text-zinc-400">Nothing recorded for this call.</li>}
                  {call.events.map((e) => {
                    if (e.kind === "transcript") {
                      const user = e.role === "user";
                      return (
                        <li key={e.id} className={`row-in flex ${user ? "justify-end" : ""}`}>
                          <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed ${user ? "rounded-br-md bg-amber-400 text-zinc-950" : "rounded-bl-md bg-zinc-800 text-zinc-100"}`}>
                            <span className={`block text-xs font-semibold uppercase tracking-wide ${user ? "text-zinc-800" : "text-zinc-400"}`}>
                              {user ? (call.type === "outboundPhoneCall" ? "Customer" : "Owner") : "Agent"} · {clock(e.at)}
                            </span>
                            {e.text}
                          </div>
                        </li>
                      );
                    }
                    if (e.kind === "status") {
                      return (
                        <li key={e.id} className="row-in text-center text-sm text-zinc-500">
                          Call {e.text} · {clock(e.at)}
                        </li>
                      );
                    }
                    const isCall = e.kind === "tool_call";
                    const failed = e.kind === "tool_result" && e.data?.ok === false;
                    return (
                      <li key={e.id} className={`row-in rounded-xl border px-4 py-3 text-sm ${failed ? "border-red-500/50 bg-red-950/40" : "border-zinc-800 bg-zinc-900"}`}>
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-sky-300">
                            {isCall ? `Tool call: ${TOOL_LABEL[e.text ?? ""] ?? e.text}` : `Tool result${e.data?.tool ? `: ${e.data.tool}` : ""}`}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {clock(e.at)}
                            {typeof e.data?.ms === "number" ? ` · ${e.data.ms} ms` : ""}
                          </span>
                        </span>
                        {isCall ? (
                          <code className="mt-1.5 block whitespace-pre-wrap break-words font-mono text-xs text-zinc-400">
                            {e.text}({JSON.stringify(e.data?.args ?? {})})
                          </code>
                        ) : (
                          <p className="mt-1.5 leading-relaxed text-zinc-300">{e.text}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <h3 className="mt-8 text-xl font-semibold">What the agent did after this call</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {call.actions.length === 0 && call.builds.length === 0 && (
                    <li className="text-base text-zinc-400">No emails, texts, invoices or pages came out of this call.</li>
                  )}
                  {call.builds.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-zinc-900 px-5 py-4 ring-1 ring-zinc-800">
                      <span className="w-24 shrink-0 text-base font-semibold text-amber-400">Landing page</span>
                      <span className="min-w-0 flex-1 truncate text-base">
                        {b.url ? (
                          <a href={b.url} target="_blank" rel="noreferrer" className="text-emerald-400 underline underline-offset-4">
                            {b.url.replace("https://", "")}
                          </a>
                        ) : (
                          b.error ?? "building…"
                        )}
                      </span>
                      <span key={b.status} className={`status-pop rounded-full px-3 py-1 text-sm font-semibold ${b.status === "live" ? "bg-emerald-400 text-emerald-950" : b.status === "failed" ? "bg-red-500 text-white" : "animate-pulse bg-sky-400 text-sky-950"}`}>
                        {b.status}
                      </span>
                    </li>
                  ))}
                  {call.actions.map((a) => (
                    <li key={a.id} className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
                      <button onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                        <span className="w-24 shrink-0 text-base font-semibold text-amber-400">{TYPE_LABEL[a.type]}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-lg font-medium">{a.customers?.name ?? "Customer"}</span>
                          <span className="block truncate text-sm text-zinc-400">
                            {a.payload.subject || a.payload.body}
                            {a.type === "invoice" && a.payload.amount_cents ? ` · ${dollars(a.payload.amount_cents)}` : ""}
                          </span>
                        </span>
                        <span key={a.status} className={`status-pop shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[a.status]}`}>
                          {a.status}
                        </span>
                      </button>
                      {open === a.id && (
                        <div className="border-t border-zinc-800 px-5 py-4 text-base leading-relaxed text-zinc-300">
                          <p className="text-sm text-zinc-500">
                            To {a.customers?.email} · owner asked: &ldquo;{a.payload.intent}&rdquo; · copy by {a.payload.copy_source === "claude" ? "Claude" : "template"}
                          </p>
                          {a.payload.subject && <p className="mt-2 font-semibold text-white">{a.payload.subject}</p>}
                          <p className="mt-1 whitespace-pre-wrap">{a.payload.body}</p>
                          {a.result?.hosted_invoice_url && (
                            <a href={a.result.hosted_invoice_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-emerald-400 underline underline-offset-4">
                              View Stripe invoice
                            </a>
                          )}
                          {a.result?.error && <p className="mt-3 text-red-300">Failed: {a.result.error}</p>}
                          {a.result?.sms_error && <p className="mt-3 text-red-300">Text: {a.result.sms_error}</p>}
                          {a.result?.outcome && (
                            <p className="mt-3 text-emerald-300">
                              Call outcome: {a.result.outcome.replaceAll("_", " ")}
                              {a.result.outcome_note ? `. ${a.result.outcome_note}` : ""}
                            </p>
                          )}
                          {a.result?.note && <p className="mt-3 text-zinc-400">{a.result.note}</p>}
                          {a.result?.reason && <p className="mt-3 text-violet-300">Not sent: {a.result.reason} (demo data).</p>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
