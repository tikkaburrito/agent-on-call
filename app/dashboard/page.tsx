"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  type Action,
  type ActionStatus,
  type AttentionItem,
  type Automation,
  AUTOMATION_LABEL,
  type Business,
  type Customer,
  dollars,
  type Order,
  type Profile,
  type Site,
  type SiteBuild,
} from "@/lib/types";
import { Icon, type IconName } from "../icons";

type ActionWithCustomer = Action & { customers: Pick<Customer, "name" | "email" | "phone"> | null };
type CustomerWithOrders = Customer & { orders: Pick<Order, "status" | "amount_cents" | "hosted_invoice_url">[] };

const KINDS: { kind: AttentionItem["kind"]; label: string; icon: IconName; tone: string }[] = [
  { kind: "welcome_pending", label: "Not welcomed", icon: "mail", tone: "bg-amber-100 text-amber-600" },
  { kind: "unpaid", label: "Unpaid orders", icon: "receipt", tone: "bg-rose-100 text-rose-600" },
  { kind: "dropped_off", label: "Dropped off", icon: "user", tone: "bg-sky-100 text-sky-600" },
];

const STATUS_STYLE: Record<ActionStatus, string> = {
  proposed: "bg-slate-100 text-slate-700",
  approved: "bg-sky-100 text-sky-700",
  executing: "bg-sky-100 text-sky-700 animate-pulse",
  executed: "bg-emerald-100 text-emerald-700",
  simulated: "bg-violet-100 text-violet-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500 line-through",
};

const TYPE: Record<Action["type"], { label: string; icon: IconName; tone: string }> = {
  email: { label: "Email", icon: "mail", tone: "bg-sky-100 text-sky-600" },
  sms: { label: "Text", icon: "chat", tone: "bg-violet-100 text-violet-600" },
  invoice: { label: "Invoice", icon: "receipt", tone: "bg-emerald-100 text-emerald-600" },
  call: { label: "Call", icon: "phone", tone: "bg-indigo-100 text-indigo-600" },
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Same brand gradient and card finish as the home page.
const BRAND = "bg-linear-to-r from-indigo-500 via-fuchsia-500 to-rose-500";
const CARD = "rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_6px_20px_-12px] shadow-indigo-500/20";

const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const primary = `rounded-full px-5 py-2.5 text-base font-semibold text-white shadow-md shadow-fuchsia-500/25 transition hover:brightness-110 disabled:opacity-60 ${BRAND}`;

// Posts a small form to an API route and reports the error, if any.
function useSubmit(url: string, onDone: (result: Record<string, string>) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    onDone(data);
  }
  return { busy, error, submit };
}

function Onboarding({ profile, onDone }: { profile: Profile | null; onDone: () => void }) {
  const { busy, error, submit } = useSubmit("/api/onboard", onDone);
  return (
    <main className="flex flex-1 items-center justify-center bg-slate-50 px-5 py-16 text-slate-900">
      <form onSubmit={submit} className={`flex w-full max-w-lg flex-col gap-4 p-7 ${CARD}`}>
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Agent on Call</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {profile?.full_name ? `Welcome, ${profile.full_name.split(" ")[0]}.` : "Welcome."} Add your business.
        </h1>
        <p className="text-base text-slate-600">
          This creates your business and its first project. You can add more projects later.
        </p>
        <label className="mt-1 flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Business name
          <input name="business_name" required maxLength={80} placeholder="Sunrise Yoga Studio" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          What do you sell first?
          <input name="product_name" required maxLength={80} placeholder="Intro class pack" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Price in dollars
          <input name="price" type="number" required min={1} max={10000} step="0.01" placeholder="49" className={field} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Creating…" : "Create my business"}
        </button>
      </form>
    </main>
  );
}

function NewProject({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit("/api/projects", (r) => onDone(r.project_id));
  return (
    <form onSubmit={submit} className={`mt-3 flex flex-wrap items-end gap-3 p-4 ${CARD}`}>
      <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium text-slate-700">
        What does this project sell?
        <input name="product_name" required maxLength={80} autoFocus placeholder="Monthly membership" className={field} />
      </label>
      <label className="flex w-40 flex-col gap-1.5 text-sm font-medium text-slate-700">
        Price in dollars
        <input name="price" type="number" required min={1} max={10000} step="0.01" placeholder="89" className={field} />
      </label>
      <button type="submit" disabled={busy} className={primary}>
        {busy ? "Adding…" : "Add project"}
      </button>
      <button type="button" onClick={onCancel} className="px-3 py-2.5 text-base text-slate-500 hover:text-slate-900">
        Cancel
      </button>
      {error && <p role="alert" className="w-full text-base text-red-600">{error}</p>}
    </form>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [state, setState] = useState<"loading" | "onboarding" | "ready">("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [actions, setActions] = useState<ActionWithCustomer[]>([]);
  const [customers, setCustomers] = useState<CustomerWithOrders[]>([]);
  const [build, setBuild] = useState<SiteBuild | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Who is signed in, their business, and the projects under it (all via RLS).
  const loadAccount = useCallback(
    async (select?: string) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return router.replace("/login");
      const [{ data: prof }, { data: biz }] = await Promise.all([
        supabase.from("profiles").select("*").maybeSingle(),
        supabase.from("businesses").select("*").order("created_at").limit(1),
      ]);
      setProfile((prof as Profile) ?? null);
      if (!biz || biz.length === 0) return setState("onboarding");
      const { data: projects } = await supabase.from("sites").select("*").eq("business_id", biz[0].id).order("created_at");
      const list = (projects ?? []) as Site[];
      setBusiness(biz[0] as Business);
      setSites(list);
      setSelected((current) => select ?? (list.some((s) => s.id === current) ? current : list[0]?.id ?? null));
      setState("ready");
    },
    [supabase, router],
  );

  const refresh = useCallback(
    async (id: string) => {
      const [att, act, cust, builds, fresh] = await Promise.all([
        supabase.rpc("needs_attention", { p_site_id: id, p_minutes: 2 }),
        supabase.from("actions").select("*, customers(name, email, phone)").eq("site_id", id).order("created_at", { ascending: false }).limit(40),
        supabase.from("customers").select("*, orders(status, amount_cents, hosted_invoice_url)").eq("site_id", id).order("created_at", { ascending: false }).limit(30),
        supabase.from("site_builds").select("*").eq("site_id", id).order("created_at", { ascending: false }).limit(1),
        supabase.from("sites").select("*").eq("id", id).maybeSingle(),
      ]);
      const autos = await supabase.from("automations").select("*").eq("site_id", id).eq("enabled", true);
      setAutomations((autos.data ?? []) as Automation[]);
      setAttention((att.data ?? []) as AttentionItem[]);
      setActions((act.data ?? []) as ActionWithCustomer[]);
      setCustomers((cust.data ?? []) as CustomerWithOrders[]);
      setBuild(((builds.data ?? [])[0] as SiteBuild) ?? null);
      if (fresh.data) setSites((list) => list.map((s) => (s.id === id ? (fresh.data as Site) : s)));
    },
    [supabase],
  );

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  // Realtime for the selected project. RLS applies to the stream, so another
  // owner's rows never arrive.
  useEffect(() => {
    if (!selected) return;
    setOpen(null);
    void refresh(selected);
    const filter = `site_id=eq.${selected}`;
    const channel = supabase.channel(`project-${selected}`);
    for (const table of ["actions", "customers", "orders", "site_builds", "automations"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => void refresh(selected));
    }
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    // Attention items are time-based (an order turns "unpaid" after a few minutes).
    const tick = setInterval(() => void refresh(selected), 20_000);
    return () => {
      clearInterval(tick);
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [selected, supabase, refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (state === "loading") {
    return <main className="flex flex-1 items-center justify-center bg-slate-50 text-xl text-slate-500">Loading…</main>;
  }
  if (state === "onboarding") return <Onboarding profile={profile} onDone={() => void loadAccount()} />;

  const site = sites.find((s) => s.id === selected) ?? null;
  const landing = build?.url ?? site?.landing_url ?? "";

  return (
    <main className="flex-1 bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-900">
            <span className={`flex size-7 items-center justify-center rounded-lg text-white ${BRAND}`}>
              <Icon name="phone" className="size-4" />
            </span>
            Agent on Call
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.95rem] text-slate-600">
            {profile && (
              <span>
                <span className="font-medium text-slate-900">{profile.full_name ?? profile.username}</span>
                {profile.phone ? ` · calls from •••${profile.phone.slice(-4)}` : ""}
              </span>
            )}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${
                live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className={`size-2 rounded-full ${live ? "bg-emerald-500" : "bg-slate-400"}`} />
              {live ? "Live" : "Connecting…"}
            </span>
            {profile?.is_admin && (
              <Link href="/admin" className="font-semibold text-indigo-600 hover:text-indigo-800">
                Admin console
              </Link>
            )}
            <button
              onClick={signOut}
              className="rounded-full px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[90rem] px-5 py-5 md:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{business?.name}</h1>
          <nav aria-label="Projects" className="flex flex-wrap items-center gap-2">
            {sites.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                aria-current={s.id === selected}
                className={`rounded-full px-4 py-1.5 text-[0.95rem] font-semibold transition ${
                  s.id === selected
                    ? `text-white shadow-md shadow-fuchsia-500/25 ${BRAND}`
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {s.product_name}
              </button>
            ))}
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-full px-3 py-1.5 text-[0.95rem] font-medium text-indigo-600 hover:bg-indigo-50"
              >
                + New project
              </button>
            )}
          </nav>
        </div>
        {adding && (
          <NewProject
            onCancel={() => setAdding(false)}
            onDone={(id) => {
              setAdding(false);
              void loadAccount(id);
            }}
          />
        )}

        {!site ? (
          <p className="mt-8 text-lg text-slate-600">This business has no projects yet. Add one to get started.</p>
        ) : (
          <>
            <section aria-label="Project" className={`mt-4 flex flex-col gap-2.5 px-5 py-4 ${CARD}`}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-base">
                <span className="font-semibold">{site.product_name}</span>
                <span className="text-slate-700">
                  {dollars(site.price_cents)}
                  {site.discount_percent > 0 && (
                    <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-sm font-semibold text-rose-600">
                      {site.discount_percent}% off now
                    </span>
                  )}
                </span>
                <a
                  href={`/s/${site.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Signup page <Icon name="arrow" className="size-4" />
                </a>
                {(build || site.landing_url) && (
                  <span className="flex min-w-0 items-center gap-2 text-slate-600">
                    <Icon name="globe" className="size-4 text-slate-400" />
                    Landing page:
                    {build?.status === "building" ? (
                      <span key="building" className="status-pop inline-block animate-pulse rounded-full bg-sky-100 px-2.5 py-0.5 text-sm font-semibold text-sky-700">
                        building…
                      </span>
                    ) : build?.status === "failed" ? (
                      <span key="failed" className="status-pop inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">
                        build failed
                      </span>
                    ) : (
                      <a
                        key="live"
                        href={landing || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="status-pop inline-block truncate font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900"
                      >
                        {landing.replace("https://", "")}
                      </a>
                    )}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[0.95rem] text-slate-600">
                <span className="font-medium text-slate-700">Automations:</span>
                {automations.length === 0 ? (
                  <span>none on. Ask the agent to turn on automatic welcomes, reminders or invoices.</span>
                ) : (
                  automations.map((a) => (
                    <span key={a.id} className="status-pop rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      {AUTOMATION_LABEL[a.kind]}
                      {a.kind !== "welcome_new_signups" ? ` after ${a.delay_minutes >= 60 ? `${Math.round(a.delay_minutes / 60)}h` : `${a.delay_minutes}m`}` : ""}
                    </span>
                  ))
                )}
              </div>
            </section>

            <section aria-label="Needs attention" className="mt-4 grid gap-4 md:grid-cols-3">
              {KINDS.map(({ kind, label, icon, tone }) => {
                const rows = attention.filter((a) => a.kind === kind);
                return (
                  <div key={kind} className={`flex items-start gap-4 p-5 ${CARD}`}>
                    <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                      <Icon name={icon} className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-base font-medium text-slate-600">{label}</p>
                        <p key={rows.length} className="status-pop text-4xl font-semibold tabular-nums leading-none">
                          {rows.length}
                        </p>
                      </div>
                      <p className="mt-2 truncate text-[0.95rem] text-slate-700">
                        {rows.length === 0
                          ? "All clear"
                          : rows.slice(0, 3).map((r) => r.name).join(", ") + (rows.length > 3 ? ` +${rows.length - 3}` : "")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_1fr]">
              <section aria-label="Actions feed">
                <h2 className="text-xl font-semibold">Actions</h2>
                <ul className={`mt-3 divide-y divide-slate-100 overflow-hidden ${CARD}`}>
                  {actions.length === 0 && (
                    <li className="px-5 py-5 text-base text-slate-600">
                      Nothing yet. Call the agent and ask what needs your attention.
                    </li>
                  )}
                  {actions.map((a) => (
                    <li key={a.id} className="row-in">
                      <button
                        onClick={() => setOpen(open === a.id ? null : a.id)}
                        aria-expanded={open === a.id}
                        className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-slate-50"
                      >
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${TYPE[a.type].tone}`} title={TYPE[a.type].label}>
                          <Icon name={TYPE[a.type].icon} className="size-[1.1rem]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-semibold">
                            {a.customers?.name ?? "Customer"}
                            <span className="ml-2 text-sm font-medium text-slate-500">{TYPE[a.type].label}</span>
                            {a.source === "automation" && (
                              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-xs font-semibold text-emerald-700">auto</span>
                            )}
                          </span>
                          <span className="block truncate text-sm text-slate-600">
                            {a.type === "sms" || a.type === "call" ? a.customers?.phone : a.customers?.email}
                            {a.type === "invoice" && a.payload.amount_cents ? ` · ${dollars(a.payload.amount_cents)}` : ""}
                            {` · ${time(a.created_at)}`}
                          </span>
                        </span>
                        <span key={a.status} className={`status-pop shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[a.status]}`}>
                          {a.status}
                        </span>
                      </button>
                      {open === a.id && (
                        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-[0.95rem] leading-relaxed text-slate-700">
                          {a.payload.subject && <p className="font-semibold text-slate-900">{a.payload.subject}</p>}
                          <p className="mt-1 whitespace-pre-wrap">{a.payload.body}</p>
                          {typeof a.result?.hosted_invoice_url === "string" && (
                            <a href={a.result.hosted_invoice_url} target="_blank" rel="noreferrer" className="mt-3 inline-block font-medium text-emerald-700 underline underline-offset-4">
                              View Stripe invoice
                            </a>
                          )}
                          {typeof a.result?.error === "string" && <p className="mt-3 text-red-600">Error: {a.result.error}</p>}
                          {typeof a.result?.note === "string" && <p className="mt-3 text-slate-500">{a.result.note}</p>}
                          {typeof a.result?.reason === "string" && (
                            <p className="mt-3 text-violet-700">Not sent: {a.result.reason} (demo data).</p>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Customers and orders">
                <h2 className="text-xl font-semibold">Customers</h2>
                <div className={`mt-3 overflow-x-auto ${CARD}`}>
                  <table className="w-full text-left text-base">
                    <thead className="bg-slate-50 text-sm text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Name</th>
                        <th className="px-4 py-2.5 font-semibold">Welcomed</th>
                        <th className="px-4 py-2.5 font-semibold">Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-5 text-slate-600">
                            No customers yet. Share this project&rsquo;s signup page to get your first one.
                          </td>
                        </tr>
                      )}
                      {customers.map((c) => {
                        const paid = c.orders.some((o) => o.status === "paid");
                        const pending = c.orders.filter((o) => o.status === "pending");
                        const order = pending.length
                          ? { text: `Unpaid ${dollars(pending.reduce((s, o) => s + o.amount_cents, 0))}`, style: "bg-amber-50 text-amber-700" }
                          : paid
                            ? { text: "Paid", style: "bg-emerald-50 text-emerald-700" }
                            : { text: "No order", style: "bg-slate-100 text-slate-600" };
                        return (
                          <tr key={c.id} className="row-in border-t border-slate-100">
                            <td className="px-4 py-2.5">
                              <span className="block font-semibold">{c.name}</span>
                              <span className="block text-sm text-slate-600">{c.email}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                key={String(!!c.welcomed_at)}
                                className={`status-pop inline-flex items-center gap-1 text-[0.95rem] font-medium ${c.welcomed_at ? "text-emerald-700" : "text-slate-500"}`}
                              >
                                {c.welcomed_at && <Icon name="check" className="size-4" />}
                                {c.welcomed_at ? "Yes" : "Not yet"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span key={order.text} className={`status-pop inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${order.style}`}>
                                {order.text}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
