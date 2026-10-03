"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  type Action,
  type ActionStatus,
  type AttentionItem,
  type Customer,
  dollars,
  type Order,
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

export default function Dashboard() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [state, setState] = useState<"loading" | "ready" | "no-site">("loading");
  const [site, setSite] = useState<Site | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [actions, setActions] = useState<ActionWithCustomer[]>([]);
  const [customers, setCustomers] = useState<CustomerWithOrders[]>([]);
  const [build, setBuild] = useState<SiteBuild | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const siteId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const id = siteId.current;
    if (!id) return;
    const [att, act, cust, builds] = await Promise.all([
      supabase.rpc("needs_attention", { p_site_id: id, p_minutes: 2 }),
      supabase
        .from("actions")
        .select("*, customers(name, email, phone)")
        .eq("site_id", id)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("customers")
        .select("*, orders(status, amount_cents, hosted_invoice_url)")
        .eq("site_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("site_builds").select("*").eq("site_id", id).order("created_at", { ascending: false }).limit(1),
    ]);
    setAttention((att.data ?? []) as AttentionItem[]);
    setActions((act.data ?? []) as ActionWithCustomer[]);
    setCustomers((cust.data ?? []) as CustomerWithOrders[]);
    setBuild(((builds.data ?? [])[0] as SiteBuild) ?? null);
    const { data: fresh } = await supabase.from("sites").select("*").eq("id", id).maybeSingle();
    if (fresh) setSite(fresh as Site);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return router.replace("/login");
      await fetch("/api/claim", { method: "POST" }).catch(() => null);
      const { data: sites } = await supabase.from("sites").select("*").limit(1);
      if (cancelled) return;
      if (!sites || sites.length === 0) return setState("no-site");

      const mine = sites[0] as Site;
      siteId.current = mine.id;
      setSite(mine);
      await refresh();
      if (cancelled) return;
      setState("ready");

      // Realtime: any change to this site's rows triggers a refetch. RLS
      // applies to the stream, so another owner's rows never arrive.
      const filter = `site_id=eq.${mine.id}`;
      channel = supabase.channel(`site-${mine.id}`);
      for (const table of ["actions", "customers", "orders", "site_builds"]) {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => void refresh());
      }
      channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    })();

    // Attention items are time-based (an order turns "unpaid" after a few minutes).
    const tick = setInterval(() => void refresh(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, router, refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (state === "loading") {
    return <main className="flex flex-1 items-center justify-center bg-zinc-950 text-2xl text-zinc-400">Loading…</main>;
  }
  if (state === "no-site" || !site) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center text-white">
        <h1 className="text-3xl font-semibold">No business is linked to this account.</h1>
        <p className="max-w-md text-lg text-zinc-400">Sign in with the owner email for your site to see its dashboard.</p>
        <button onClick={signOut} className="rounded-xl bg-zinc-800 px-5 py-3 text-lg hover:bg-zinc-700">
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-zinc-950 px-5 py-6 text-white md:px-10 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Agent on Call</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">{site.name}</h1>
        </div>
        <div className="flex items-center gap-5 text-base text-zinc-400">
          <span className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${live ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {live ? "Live" : "Connecting…"}
          </span>
          <button onClick={signOut} className="underline-offset-4 hover:text-white hover:underline">
            Sign out
          </button>
        </div>
      </header>

      {(build || site.landing_url) && (
        <p className="mt-4 text-lg text-zinc-300">
          Landing page:{" "}
          {build?.status === "building" ? (
            <span key="building" className="status-pop inline-block rounded-full bg-sky-400 px-3 py-0.5 font-semibold text-sky-950 animate-pulse">
              building…
            </span>
          ) : build?.status === "failed" ? (
            <span key="failed" className="status-pop inline-block rounded-full bg-red-500 px-3 py-0.5 font-semibold">
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
        </p>
      )}

      <section aria-label="Needs attention" className="mt-8 grid gap-4 md:grid-cols-3">
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
                  <span
                    key={a.status}
                    className={`status-pop shrink-0 rounded-full px-4 py-1.5 text-base font-semibold ${STATUS_STYLE[a.status]}`}
                  >
                    {a.status}
                  </span>
                </button>
                {open === a.id && (
                  <div className="border-t border-zinc-800 px-5 py-4 text-base leading-relaxed text-zinc-300">
                    {a.payload.subject && <p className="font-semibold text-white">{a.payload.subject}</p>}
                    <p className="mt-1 whitespace-pre-wrap">{a.payload.body}</p>
                    {typeof a.result?.hosted_invoice_url === "string" && (
                      <a
                        href={a.result.hosted_invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-emerald-400 underline underline-offset-4"
                      >
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
    </main>
  );
}
