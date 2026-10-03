import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_BUSINESS_ID, dollars } from "@/lib/types";

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

const STEPS = [
  {
    title: "Call",
    body: "Call one number from your own phone. The agent recognises you by caller ID and pulls up your business and its projects. No app, no login.",
  },
  {
    title: "Listen",
    body: "It reads your customer database and tells you what needs attention: new signups nobody welcomed, orders nobody paid, people who dropped off.",
  },
  {
    title: "Say yes",
    body: "It drafts the emails, texts and invoices and reads the plan back. Nothing goes out until you say yes. Then it sends them and tells you what happened.",
  },
];

const CALL = [
  { who: "You", line: "What's going on with my business?" },
  {
    who: "Agent",
    line: "Hi Dana. For the intro class pack, three new signups haven't been welcomed and three orders are unpaid, 147 dollars in total. Want me to welcome them and send the invoices?",
  },
  { who: "You", line: "Yes, go ahead." },
  { who: "Agent", line: "Done. Three welcome emails and three invoices are on their way." },
  { who: "You", line: "And build me a landing page for the membership." },
  { who: "Agent", line: "On it. I'll text you the link in about a minute." },
];

const STACK = [
  ["Supabase", "Postgres with row-level security, Auth, Realtime and Edge Functions"],
  ["Vapi + Claude", "the voice agent and the copy it drafts"],
  ["Stripe", "checkout and invoices, in test mode"],
  ["Resend + Twilio", "the emails and texts it sends"],
  ["Vercel", "this app, and every landing page the agent deploys"],
];

export default async function Home() {
  const demo = await loadDemo();
  const phone = process.env.NEXT_PUBLIC_AGENT_PHONE;

  return (
    <main className="flex-1 bg-zinc-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Agent on Call</p>
        <nav className="flex items-center gap-6 text-base text-zinc-300">
          <a href="#demo" className="hidden underline-offset-4 hover:text-white hover:underline sm:inline">
            Demo business
          </a>
          <Link href="/login" className="rounded-lg bg-zinc-800 px-4 py-2 font-medium text-white hover:bg-zinc-700">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-20">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-balance md:text-6xl">
            Your website collects customers. <span className="text-amber-400">Agent on Call</span> does the follow-up.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-zinc-300">
            Call one number. Hear who signed up, who hasn&rsquo;t paid and who dropped off. Say yes, and the welcome
            emails, texts and invoices go out. Don&rsquo;t log in. Just call.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
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
          {phone && (
            <p className="mt-6 text-lg text-zinc-400">
              Already set up? Call <a href={`tel:${phone}`} className="font-semibold text-white">{phone}</a>
            </p>
          )}
        </div>

        <figure className="rounded-3xl bg-zinc-900 p-6 ring-1 ring-zinc-800 md:p-8">
          <figcaption className="text-sm font-medium uppercase tracking-widest text-zinc-500">
            A 60-second call
          </figcaption>
          <ol className="mt-5 flex flex-col gap-4">
            {CALL.map((turn, i) => (
              <li key={i} className={turn.who === "You" ? "flex justify-end" : "flex"}>
                <p
                  className={
                    turn.who === "You"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-amber-400 px-4 py-2.5 text-base font-medium text-zinc-950"
                      : "max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-800 px-4 py-2.5 text-base leading-relaxed text-zinc-100"
                  }
                >
                  {turn.line}
                </p>
              </li>
            ))}
          </ol>
        </figure>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <p className="text-5xl font-semibold tabular-nums text-amber-400">{i + 1}</p>
              <h2 className="mt-4 text-2xl font-semibold">{step.title}</h2>
              <p className="mt-3 text-lg leading-relaxed text-zinc-300">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">One account. Your business. Its projects.</h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-zinc-300">
          You sign up once and add your business. Each thing you sell is a project with its own page, customers and
          orders. When you call, the agent already knows which user you are, which business is yours and which
          projects sit under it, and it only ever touches your data.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["You", "A username, a password, and the phone you call from."],
            ["Your business", "The name your customers know. One per account for now."],
            ["Your projects", "An offer, a price, a page that takes signups and payments. Ask the agent and it builds and deploys the page for you."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
              <h3 className="text-xl font-semibold text-amber-400">{title}</h3>
              <p className="mt-2 text-lg leading-relaxed text-zinc-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {demo && (
        <section id="demo" className="scroll-mt-8 border-t border-zinc-800 bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-5 py-16">
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
                    className="mt-6 inline-block rounded-xl bg-white px-5 py-3 text-base font-semibold text-zinc-950 transition hover:bg-zinc-200"
                  >
                    Open its page
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

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">What it runs on</h2>
        <dl className="mt-6 grid gap-x-10 gap-y-4 md:grid-cols-2">
          {STACK.map(([name, what]) => (
            <div key={name} className="flex gap-3 border-b border-zinc-800 pb-4 text-lg">
              <dt className="w-40 shrink-0 font-semibold">{name}</dt>
              <dd className="text-zinc-300">{what}</dd>
            </div>
          ))}
        </dl>
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
