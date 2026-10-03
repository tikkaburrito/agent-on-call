// Runs the automations owners have switched on. Called every minute by pg_cron.
// Takes no input: it only acts on enabled rules, creates `approved` actions
// marked source = 'automation', and hands them to the executor, where the send
// allowlist still applies. Each customer gets each automation at most once.
import { type DraftRequest, draftCopy, personalize, withLink } from "../_shared/copy.ts";
import { db, FUNCTIONS_URL, SERVICE_KEY, type Site, SITE_COLUMNS } from "../_shared/db.ts";

type Rule = { id: string; site_id: string; kind: "welcome_new_signups" | "remind_unpaid" | "invoice_unpaid"; delay_minutes: number };
type Target = { id: string; name: string; amount_cents?: number };

const MAX_PER_RUN = 10;

const REQUESTS: Record<Rule["kind"], DraftRequest> = {
  welcome_new_signups: { type: "email", welcome: true, intent: "Welcome a new signup and thank them for signing up." },
  remind_unpaid: {
    type: "email",
    welcome: false,
    intent: "A friendly reminder that they started signing up but have not paid yet. Invite them to finish.",
  },
  invoice_unpaid: { type: "invoice", welcome: false, intent: "The invoice for their unpaid order." },
};

async function targetsFor(rule: Rule): Promise<Target[]> {
  // Customers who already got this automation are skipped for good.
  const { data: done } = await db
    .from("actions")
    .select("customer_id")
    .eq("site_id", rule.site_id)
    .eq("source", "automation")
    .eq("payload->>automation", rule.kind);
  const skip = new Set((done ?? []).map((a) => a.customer_id));

  if (rule.kind === "welcome_new_signups") {
    const { data } = await db
      .from("customers")
      .select("id, name")
      .eq("site_id", rule.site_id)
      .is("welcomed_at", null)
      .order("created_at", { ascending: true })
      .limit(50);
    return (data ?? []).filter((c) => !skip.has(c.id)).slice(0, MAX_PER_RUN);
  }

  const cutoff = new Date(Date.now() - rule.delay_minutes * 60_000).toISOString();
  let query = db
    .from("orders")
    .select("customer_id, amount_cents, customers(name)")
    .eq("site_id", rule.site_id)
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(100);
  if (rule.kind === "invoice_unpaid") query = query.is("stripe_invoice_id", null);
  const { data } = await query;
  const byCustomer = new Map<string, Target>();
  for (const o of data ?? []) {
    if (skip.has(o.customer_id)) continue;
    const current = byCustomer.get(o.customer_id);
    const name = (o.customers as unknown as { name?: string } | null)?.name ?? "there";
    byCustomer.set(o.customer_id, { id: o.customer_id, name, amount_cents: (current?.amount_cents ?? 0) + o.amount_cents });
  }
  return [...byCustomer.values()].slice(0, MAX_PER_RUN);
}

async function runRule(rule: Rule, site: Site) {
  const targets = await targetsFor(rule);
  if (targets.length === 0) return 0;

  const request = REQUESTS[rule.kind];
  const { drafts, source } = await draftCopy(site, [request], 6000);
  const appUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  const pageUrl = site.landing_url || (appUrl ? `${appUrl}/s/${site.slug}` : "");

  const batchId = crypto.randomUUID();
  const rows = targets.map((t) => {
    const personal = personalize(site, request, drafts[0], t.name);
    const copy = rule.kind === "remind_unpaid" ? withLink("email", personal, pageUrl) : personal;
    return {
      site_id: site.id,
      batch_id: batchId,
      type: request.type,
      customer_id: t.id,
      status: "approved",
      source: "automation",
      payload: {
        subject: copy.subject,
        body: copy.body,
        automation: rule.kind,
        intent: `Automation: ${rule.kind.replaceAll("_", " ")}`,
        welcome: request.welcome,
        copy_source: source,
        ...(rule.kind === "invoice_unpaid" ? { amount_cents: t.amount_cents, description: site.product_name } : {}),
      },
    };
  });
  const { error } = await db.from("actions").insert(rows);
  if (error) throw new Error(error.message);

  await fetch(`${FUNCTIONS_URL}/executor`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ batch_id: batchId }),
    signal: AbortSignal.timeout(45_000),
  }).then((r) => r.text());
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const { data: rules, error } = await db.from("automations").select("id, site_id, kind, delay_minutes").eq("enabled", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!rules?.length) return Response.json({ rules: 0, actions: 0 });

  const { data: sites } = await db.from("sites").select(SITE_COLUMNS).in("id", [...new Set(rules.map((r) => r.site_id))]);
  const byId = new Map((sites ?? []).map((s) => [(s as unknown as Site).id, s as unknown as Site]));

  let actions = 0;
  for (const rule of rules as Rule[]) {
    const site = byId.get(rule.site_id);
    if (!site) continue;
    try {
      actions += await runRule(rule, site);
    } catch (e) {
      console.error(`automation ${rule.kind} site=${rule.site_id} failed:`, (e as Error).message);
    }
  }
  if (actions) console.log(`automations: ${rules.length} rules, ${actions} actions`);
  return Response.json({ rules: rules.length, actions });
});
