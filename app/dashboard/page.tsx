"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  type Action,
  type ActionStatus,
  type AttentionItem,
  type Business,
  type Customer,
  dollars,
  type Order,
  type Profile,
  type Site,
  type SiteBuild,
} from "@/lib/types";

type ActionWithCustomer = Action & { customers: Pick<Customer, "name" | "email" | "phone"> | null };
type CustomerWithOrders = Customer & { orders: Pick<Order, "status" | "amount_cents" | "hosted_invoice_url">[] };

const KINDS: { kind: AttentionItem["kind"]; label: string }[] = [
  { kind: "welcome_pending", label: "Not welcomed" },
  { kind: "unpaid", label: "Unpaid orders" },
  { kind: "dropped_off", label: "Dropped off" },
];

const STATUS_STYLE: Record<ActionStatus, string> = {
  proposed: "bg-zinc-700 text-zinc-100",
  approved: "bg-sky-500 text-sky-950",
  executing: "bg-sky-400 text-sky-950 animate-pulse",
  executed: "bg-emerald-400 text-emerald-950",
  simulated: "bg-violet-400 text-violet-950",
  failed: "bg-red-500 text-white",
  cancelled: "bg-zinc-800 text-zinc-400 line-through",
};

const TYPE_LABEL: Record<Action["type"], string> = { email: "Email", sms: "Text", invoice: "Invoice" };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const field =
  "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg text-white placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30";
const primary =
  "rounded-xl bg-amber-400 px-5 py-3 text-lg font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-60";

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
    <main className="flex flex-1 items-center justify-center bg-zinc-950 px-5 py-16 text-white">
      <form onSubmit={submit} className="flex w-full max-w-lg flex-col gap-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Agent on Call</p>
        <h1 className="text-4xl font-semibold tracking-tight">
          {profile?.full_name ? `Welcome, ${profile.full_name.split(" ")[0]}.` : "Welcome."} Add your business.
        </h1>
        <p className="text-lg text-zinc-400">
          This creates your business and its first project. You can add more projects later.
        </p>
        <label className="mt-2 flex flex-col gap-2 text-base text-zinc-300">
          Business name
          <input name="business_name" required maxLength={80} placeholder="Sunrise Yoga Studio" className={field} />
        </label>
        <label className="flex flex-col gap-2 text-base text-zinc-300">
          What do you sell first?
          <input name="product_name" required maxLength={80} placeholder="Intro class pack" className={field} />
        </label>
        <label className="flex flex-col gap-2 text-base text-zinc-300">
          Price in dollars
          <input name="price" type="number" required min={1} max={10000} step="0.01" placeholder="49" className={field} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-950 px-4 py-3 text-base text-red-200">{error}</p>}
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
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-zinc-900 p-5 ring-1 ring-zinc-800">
      <label className="flex min-w-56 flex-1 flex-col gap-2 text-base text-zinc-300">
        What does this project sell?
        <input name="product_name" required maxLength={80} autoFocus placeholder="Monthly membership" className={field} />
      </label>
      <label className="flex w-40 flex-col gap-2 text-base text-zinc-300">
        Price in dollars
        <input name="price" type="number" required min={1} max={10000} step="0.01" placeholder="89" className={field} />
      </label>
      <button type="submit" disabled={busy} className={primary}>
        {busy ? "Adding…" : "Add project"}
      </button>
      <button type="button" onClick={onCancel} className="px-3 py-3 text-lg text-zinc-400 hover:text-white">
        Cancel
      </button>
      {error && <p role="alert" className="w-full text-base text-red-300">{error}</p>}
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
    for (const table of ["actions", "customers", "orders", "site_builds"]) {
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
    return <main className="flex flex-1 items-center justify-center bg-zinc-950 text-2xl text-zinc-400">Loading…</main>;
  }
  if (state === "onboarding") return <Onboarding profile={profile} onDone={() => void loadAccount()} />;

  const site = sites.find((s) => s.id === selected) ?? null;

  return (
    <main className="flex-1 bg-zinc-950 px-5 py-6 text-white md:px-10 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-semibold uppercase tracking-widest text-amber-400">
            Agent on Call
          </Link>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">{business?.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-base text-zinc-400">
          {profile && (
            <span>
              {profile.full_name ?? profile.username}
              {profile.phone ? ` · calls from •••${profile.phone.slice(-4)}` : ""}
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${live ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {live ? "Live" : "Connecting…"}
          </span>
          <button onClick={signOut} className="underline-offset-4 hover:text-white hover:underline">
            Sign out
          </button>
        </div>
      </header>

      <nav aria-label="Projects" className="mt-6 flex flex-wrap items-center gap-2">
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            aria-current={s.id === selected}
            className={`rounded-full px-5 py-2.5 text-lg font-semibold transition ${
              s.id === selected ? "bg-amber-400 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800"
            }`}
          >
            {s.product_name}
          </button>
        ))}
        {!adding && (
          <button onClick={() => setAdding(true)} className="rounded-full px-4 py-2.5 text-lg text-zinc-400 hover:text-white">
            + New project
          </button>
        )}
      </nav>
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
        <p className="mt-10 text-xl text-zinc-400">This business has no projects yet. Add one to get started.</p>
      ) : (
        <>
          <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-lg text-zinc-300">
            <span>
              {site.product_name} · {dollars(site.price_cents)}
            </span>
            <a href={`/s/${site.slug}`} target="_blank" rel="noreferrer" className="text-amber-400 underline underline-offset-4">
              Signup page
            </a>
            {(build || site.landing_url) && (
              <span>
                Landing page:{" "}
                {build?.status === "building" ? (
                  <span key="building" className="status-pop inline-block animate-pulse rounded-full bg-sky-400 px-3 py-0.5 font-semibold text-sky-950">
                    building…
                  </span>
                ) : build?.status === "failed" ? (
                  <span key="failed" className="status-pop inline-block rounded-full bg-red-500 px-3 py-0.5 font-semibold text-white">
                    build failed
                  </span>
                ) : (
                  <a
                    key="live"
                    href={build?.url ?? site.landing_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="status-pop inline-block font-semibold text-emerald-400 underline underline-offset-4"
                  >
                    {(build?.url ?? site.landing_url ?? "").replace("https://", "")}
                  </a>
                )}
              </span>
            )}
          </p>

          <section aria-label="Needs attention" className="mt-6 grid gap-4 md:grid-cols-3">
            {KINDS.map(({ kind, label }) => {
              const rows = attention.filter((a) => a.kind === kind);
              return (
                <div key={kind} className="rounded-3xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
                  <p className="text-lg font-medium text-zinc-400">{label}</p>
                  <p key={rows.length} className="status-pop mt-2 text-7xl font-semibold tabular-nums leading-none">
                    {rows.length}
                  </p>
                  <p className="mt-4 min-h-14 text-lg leading-snug text-zinc-300">
                    {rows.length === 0
                      ? "All clear"
                      : rows.slice(0, 3).map((r) => r.name).join(", ") + (rows.length > 3 ? ` +${rows.length - 3}` : "")}
                  </p>
                </div>
              );
            })}
          </section>

          <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_1fr]">
            <section aria-label="Actions feed">
              <h2 className="text-2xl font-semibold">Actions</h2>
              <ul className="mt-4 flex flex-col gap-2">
                {actions.length === 0 && (
                  <li className="rounded-2xl bg-zinc-900 p-6 text-lg text-zinc-400 ring-1 ring-zinc-800">
                    Nothing yet. Call the agent and ask what needs your attention.
                  </li>
                )}
                {actions.map((a) => (
                  <li key={a.id} className="row-in rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
                    <button
                      onClick={() => setOpen(open === a.id ? null : a.id)}
                      aria-expanded={open === a.id}
                      className="flex w-full items-center gap-4 px-5 py-4 text-left"
                    >
                      <span className="w-20 shrink-0 text-lg font-semibold text-amber-400">{TYPE_LABEL[a.type]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xl font-medium">{a.customers?.name ?? "Customer"}</span>
                        <span className="block truncate text-base text-zinc-400">
                          {a.type === "sms" ? a.customers?.phone : a.customers?.email}
                          {a.type === "invoice" && a.payload.amount_cents ? ` · ${dollars(a.payload.amount_cents)}` : ""}
                          {` · ${time(a.created_at)}`}
                        </span>
                      </span>
                      <span key={a.status} className={`status-pop shrink-0 rounded-full px-4 py-1.5 text-base font-semibold ${STATUS_STYLE[a.status]}`}>
                        {a.status}
                      </span>
                    </button>
                    {open === a.id && (
                      <div className="border-t border-zinc-800 px-5 py-4 text-base leading-relaxed text-zinc-300">
                        {a.payload.subject && <p className="font-semibold text-white">{a.payload.subject}</p>}
                        <p className="mt-1 whitespace-pre-wrap">{a.payload.body}</p>
                        {typeof a.result?.hosted_invoice_url === "string" && (
                          <a href={a.result.hosted_invoice_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-emerald-400 underline underline-offset-4">
                            View Stripe invoice
                          </a>
                        )}
                        {typeof a.result?.error === "string" && <p className="mt-3 text-red-300">Error: {a.result.error}</p>}
                        {typeof a.result?.reason === "string" && (
                          <p className="mt-3 text-violet-300">Not sent: {a.result.reason} (demo data).</p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Customers and orders">
              <h2 className="text-2xl font-semibold">Customers</h2>
              <div className="mt-4 overflow-x-auto rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
                <table className="w-full text-left text-lg">
                  <thead className="text-base text-zinc-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Welcomed</th>
                      <th className="px-5 py-3 font-medium">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-5 py-6 text-zinc-400">
                          No customers yet. Share this project&rsquo;s signup page to get your first one.
                        </td>
                      </tr>
                    )}
                    {customers.map((c) => {
                      const paid = c.orders.some((o) => o.status === "paid");
                      const pending = c.orders.filter((o) => o.status === "pending");
                      const order = pending.length
                        ? { text: `Unpaid ${dollars(pending.reduce((s, o) => s + o.amount_cents, 0))}`, style: "text-amber-400" }
                        : paid
                          ? { text: "Paid", style: "text-emerald-400" }
                          : { text: "No order", style: "text-zinc-500" };
                      return (
                        <tr key={c.id} className="row-in border-t border-zinc-800">
                          <td className="px-5 py-3">
                            <span className="block font-medium">{c.name}</span>
                            <span className="block text-base text-zinc-400">{c.email}</span>
                          </td>
                          <td className="px-5 py-3">
                            <span key={String(!!c.welcomed_at)} className={`status-pop inline-block ${c.welcomed_at ? "text-emerald-400" : "text-zinc-500"}`}>
                              {c.welcomed_at ? "Yes" : "Not yet"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span key={order.text} className={`status-pop inline-block font-semibold ${order.style}`}>
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
    </main>
  );
}
