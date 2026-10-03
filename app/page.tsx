import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_BUSINESS_ID, dollars } from "@/lib/types";
import { Icon, type IconName } from "./icons";

export const dynamic = "force-dynamic";

type DemoProject = {
  id: string;
  slug: string;
  product_name: string;
  price_cents: number;
  customers: number;
  welcome: number;
  unpaid: number;
  dropped: number;
};

// Live numbers for the demo business. Counts only: no customer names or
// contact details are shown on this public page.
async function loadDemo(): Promise<{ name: string; projects: DemoProject[] } | null> {
  const db = supabaseAdmin();
  const { data: business } = await db
    .from("businesses")
    .select("name, sites(id, slug, product_name, price_cents, created_at)")
    .eq("id", DEMO_BUSINESS_ID)
    .maybeSingle();
  if (!business) return null;
  const sites = [...(business.sites ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const projects = await Promise.all(
    sites.map(async (s) => {
      const [{ count }, { data: attention }] = await Promise.all([
        db.from("customers").select("*", { count: "exact", head: true }).eq("site_id", s.id),
        db.rpc("needs_attention", { p_site_id: s.id, p_minutes: 2 }),
      ]);
      const n = (kind: string) => (attention ?? []).filter((r: { kind: string }) => r.kind === kind).length;
      return {
        id: s.id,
        slug: s.slug,
        product_name: s.product_name,
        price_cents: s.price_cents,
        customers: count ?? 0,
        welcome: n("welcome_pending"),
        unpaid: n("unpaid"),
        dropped: n("dropped_off"),
      };
    }),
  );
  return { name: business.name, projects };
}

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "phone", title: "You call", body: "From your own phone. No app to open, nothing to log in to." },
  { icon: "user", title: "It knows you", body: "Caller ID finds your account, your business and its projects." },
  { icon: "database", title: "It reads your data", body: "New signups, unpaid orders, people who dropped off." },
  { icon: "check", title: "You say yes", body: "It sends the emails, texts and invoices, then tells you what happened." },
];

const OUTCOMES: { icon: IconName; title: string; detail: string; status: string; tone: string }[] = [
  { icon: "mail", title: "Welcome emails", detail: "to 3 new signups", status: "Sent", tone: "bg-sky-400/15 text-sky-300" },
  { icon: "chat", title: "Text messages", detail: "only with consent", status: "Sent", tone: "bg-violet-400/15 text-violet-300" },
  { icon: "receipt", title: "Stripe invoices", detail: "$147 across 3 orders", status: "Sent", tone: "bg-emerald-400/15 text-emerald-300" },
  { icon: "globe", title: "Landing page", detail: "built and deployed", status: "Live", tone: "bg-amber-400/15 text-amber-300" },
];

const SUPABASE: { icon: IconName; title: string; body: string }[] = [
  { icon: "database", title: "Postgres", body: "Users, businesses, projects, customers, orders, and every action the agent takes." },
  { icon: "shield", title: "Row-level security", body: "An owner can only ever read their own business. There are no public policies." },
  { icon: "key", title: "Auth", body: "Owner sign-in for the dashboard." },
  { icon: "radio", title: "Realtime", body: "The dashboard updates while you are still on the call." },
  { icon: "code", title: "Edge Functions", body: "The agent's tools, the sender, the page builder and the Stripe webhook." },
];

const WAVE = [0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.85, 0.55, 1, 0.65, 0.45, 0.9, 0.6, 0.8, 0.5, 0.95, 0.7, 0.45];

// The whole product in one picture: a call on the left, what it sets off on the right.
function CallIllustration() {
  return (
    <div className="relative mx-auto flex w-full max-w-[36rem] flex-col items-center gap-6 sm:flex-row sm:gap-0">
      <div aria-hidden="true" className="absolute -inset-8 -z-10 rounded-full bg-amber-400/10 blur-3xl" />

      <div className="w-[17rem] shrink-0 rounded-[2.4rem] border border-zinc-700 bg-zinc-900 p-2.5 shadow-2xl shadow-black/60">
        <div className="rounded-[1.9rem] bg-zinc-950 px-4 pb-5 pt-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="size-2 rounded-full bg-emerald-400" /> On a call
            </span>
            <span className="tabular-nums">00:42</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-amber-400 text-zinc-950">
              <Icon name="phone" className="size-5" />
            </span>
            <div>
              <p className="text-base font-semibold leading-tight">Agent on Call</p>
              <p className="flex items-center gap-1 text-xs text-zinc-400">
                <Icon name="check" className="size-3.5 text-emerald-400" /> Recognised: Dana
              </p>
            </div>
          </div>

          <div aria-hidden="true" className="mt-4 flex h-9 items-center gap-[3px]">
            {WAVE.map((h, i) => (
              <span
                key={i}
                className="wave-bar w-1 flex-1 rounded-full bg-amber-400/80"
                style={{ height: `${h * 100}%`, animationDelay: `${i * 70}ms` }}
              />
            ))}
          </div>

          <ol className="mt-4 flex flex-col gap-2.5 text-[0.82rem] leading-snug">
            <li className="rise flex justify-end" style={{ animationDelay: "0.2s" }}>
              <p className="max-w-[88%] rounded-2xl rounded-br-md bg-amber-400 px-3 py-2 font-medium text-zinc-950">
                What&rsquo;s going on with my business?
              </p>
            </li>
            <li className="rise flex" style={{ animationDelay: "0.9s" }}>
              <p className="max-w-[92%] rounded-2xl rounded-bl-md bg-zinc-800 px-3 py-2 text-zinc-100">
                Three new signups and three unpaid orders, 147 dollars. Shall I welcome them and send the invoices?
              </p>
            </li>
            <li className="rise flex justify-end" style={{ animationDelay: "1.6s" }}>
              <p className="max-w-[88%] rounded-2xl rounded-br-md bg-amber-400 px-3 py-2 font-medium text-zinc-950">
                Yes, go ahead.
              </p>
            </li>
          </ol>
        </div>
      </div>

      <ul className="flex w-full flex-1 flex-col gap-3">
        {OUTCOMES.map((o, i) => (
          <li key={o.title} className="rise flex items-center" style={{ animationDelay: `${2.1 + i * 0.35}s` }}>
            <svg aria-hidden="true" viewBox="0 0 40 2" className="hidden h-0.5 w-8 shrink-0 text-zinc-600 sm:block lg:w-10">
              <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" className="flow-line" />
            </svg>
            <div className="flex flex-1 items-center gap-3 rounded-2xl bg-zinc-900 px-3.5 py-3 ring-1 ring-zinc-800">
              <span className={`flex size-10 items-center justify-center rounded-xl ${o.tone}`}>
                <Icon name={o.icon} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.95rem] font-semibold leading-tight">{o.title}</p>
                <p className="truncate text-sm text-zinc-400">{o.detail}</p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                <Icon name="check" className="size-3.5" /> {o.status}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function Home() {
  const demo = await loadDemo();
  const phone = process.env.NEXT_PUBLIC_AGENT_PHONE;

  return (
    <main className="flex-1 overflow-x-clip bg-zinc-950 text-white">
      <div className="relative">
        <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />

        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-amber-400">
            <span className="flex size-7 items-center justify-center rounded-lg bg-amber-400 text-zinc-950">
              <Icon name="phone" className="size-4" />
            </span>
            Agent on Call
          </p>
          <nav className="flex items-center gap-6 text-base text-zinc-300">
            <a href="#how" className="hidden underline-offset-4 hover:text-white hover:underline sm:inline">
              How it works
            </a>
            <a href="#demo" className="hidden underline-offset-4 hover:text-white hover:underline sm:inline">
              Live demo
            </a>
            <Link href="/login" className="rounded-lg bg-zinc-800 px-4 py-2 font-medium text-white hover:bg-zinc-700">
              Sign in
            </Link>
          </nav>
        </header>

        <section className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-8 lg:pb-20 lg:pt-10">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800">
              <span className="size-2 rounded-full bg-emerald-400" /> An AI phone agent for small businesses
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.03] tracking-tight text-balance md:text-6xl xl:text-7xl">
              Run your business with a <span className="text-amber-400">phone call.</span>
            </h1>
            <p className="mt-5 max-w-xl text-xl leading-relaxed text-zinc-300">
              Your website collects customers. Agent on Call does the follow-up. Call one number, hear who signed up
              and who hasn&rsquo;t paid, say yes, and the emails, texts and invoices go out.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/login?mode=signup"
                className="rounded-xl bg-amber-400 px-6 py-3.5 text-lg font-semibold text-zinc-950 transition hover:bg-amber-300"
              >
                Set up your business
              </Link>
              <a
                href="#demo"
                className="rounded-xl px-6 py-3.5 text-lg font-semibold text-white ring-1 ring-zinc-700 transition hover:bg-zinc-900"
              >
                See the live demo
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-base text-zinc-400">
              {["No app, no login", "Knows you by your number", "Nothing sent without your yes"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Icon name="check" className="size-4 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
            {phone && (
              <p className="mt-6 text-lg text-zinc-400">
                Already set up? Call{" "}
                <a href={`tel:${phone}`} className="font-semibold text-white">
                  {phone}
                </a>
              </p>
            )}
          </div>

          <CallIllustration />
        </section>
      </div>

      <section id="how" className="scroll-mt-8 border-y border-zinc-800 bg-zinc-900/40">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">How a call works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative rounded-2xl bg-zinc-950 p-6 ring-1 ring-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                    <Icon name={step.icon} className="size-6" />
                  </span>
                  <span className="text-4xl font-semibold tabular-nums text-zinc-700">{i + 1}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-zinc-300">{step.body}</p>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-4 top-1/2 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-4 ring-zinc-950 lg:flex"
                  >
                    <Icon name="arrow" className="size-4" />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">It knows who&rsquo;s calling</h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-zinc-300">
          You sign up once and add your business. Each thing you sell is a project with its own page, customers and
          orders. When your phone rings in, the agent already knows the user, the business and the projects, and it
          only ever touches your data.
        </p>
        <div className="mt-8 flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
          {(
            [
              { icon: "phone", label: "Caller ID", value: "+1 ••• ••• 0142" },
              { icon: "user", label: "User", value: "Dana Brooks" },
              { icon: "building", label: "Business", value: demo?.name ?? "Sunrise Yoga Studio" },
              {
                icon: "folder",
                label: "Projects",
                value: demo?.projects.map((p) => p.product_name).join(" · ") ?? "Intro class pack",
              },
            ] as { icon: IconName; label: string; value: string }[]
          ).map((node, i) => (
            <div key={node.label} className="flex flex-1 flex-col items-stretch gap-3 lg:flex-row lg:items-center">
              {i > 0 && (
                <Icon name="arrow" className="size-5 rotate-90 self-center text-zinc-600 lg:rotate-0" />
              )}
              <div className="flex flex-1 items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-4 ring-1 ring-zinc-800">
                <span className="flex size-11 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                  <Icon name={node.icon} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-zinc-400">{node.label}</p>
                  <p className="text-lg font-semibold leading-tight">{node.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {demo && (
        <section id="demo" className="scroll-mt-8 border-y border-zinc-800 bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-emerald-400">
              <span className="size-2.5 rounded-full bg-emerald-400" /> Live demo business
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{demo.name}</h2>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-zinc-300">
              A demo studio with {demo.projects.length} projects and sample customers. These numbers come straight
              from its database. Sign up on one of its pages, leave the checkout unpaid, and you become something the
              agent reports on the owner&rsquo;s next call.
            </p>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {demo.projects.map((p) => (
                <article key={p.id} className="rounded-3xl bg-zinc-950 p-6 ring-1 ring-zinc-800 md:p-8">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-2xl font-semibold">{p.product_name}</h3>
                    <p className="text-2xl font-semibold tabular-nums text-zinc-300">{dollars(p.price_cents)}</p>
                  </div>
                  <p className="mt-1 text-base text-zinc-400">{p.customers} customers</p>
                  <dl className="mt-6 grid grid-cols-3 gap-3">
                    {[
                      ["Not welcomed", p.welcome],
                      ["Unpaid", p.unpaid],
                      ["Dropped off", p.dropped],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-zinc-900 p-4">
                        <dd className="text-4xl font-semibold tabular-nums leading-none">{value}</dd>
                        <dt className="mt-2 text-sm text-zinc-400">{label}</dt>
                      </div>
                    ))}
                  </dl>
                  <Link
                    href={`/s/${p.slug}`}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-base font-semibold text-zinc-950 transition hover:bg-zinc-200"
                  >
                    Open its signup page <Icon name="arrow" className="size-4" />
                  </Link>
                </article>
              ))}
            </div>
            <p className="mt-6 text-base text-zinc-400">
              Sample customers are fictional. Real messages only go to addresses the owner has put on an allowlist;
              everyone else is marked as simulated.
            </p>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Built on Supabase</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SUPABASE.map((item) => (
            <div key={item.title} className="rounded-2xl bg-zinc-900 p-5 ring-1 ring-zinc-800">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <Icon name={item.icon} />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-base leading-relaxed text-zinc-300">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-lg text-zinc-400">
          With <span className="text-zinc-200">Vapi and Claude</span> for the voice agent,{" "}
          <span className="text-zinc-200">Stripe</span> for checkout and invoices,{" "}
          <span className="text-zinc-200">Resend and Twilio</span> for email and text, and{" "}
          <span className="text-zinc-200">Vercel</span> for this app and every page the agent deploys.
        </p>
      </section>

      <footer className="border-t border-zinc-800 px-5 py-8 text-center text-base text-zinc-500">
        Agent on Call. Built in a day for a hackathon.{" "}
        <a href="https://github.com/tikkaburrito/agent-on-call" className="underline underline-offset-4 hover:text-white">
          Source on GitHub
        </a>
      </footer>
    </main>
  );
}
