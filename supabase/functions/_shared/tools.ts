// Agent tools. Each returns one spoken line. The agent touches data only
// through these, always inside the caller's own business (CallerContext).
import { type DraftRequest, draftCopy, personalize } from "./copy.ts";
import {
  ATTENTION_MINUTES,
  type CallerContext,
  db,
  dollars,
  firstName,
  FUNCTIONS_URL,
  keepAlive,
  SERVICE_KEY,
  type Site,
} from "./db.ts";

type Args = Record<string, unknown>;
type Found = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  consent: boolean;
  state: string;
  pending_cents: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENTS = ["all", "new_today", "welcome_pending", "unpaid", "dropped_off"];
const MAX_ACTIONS = 25;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// One project: always that one. Several: match the spoken project name.
export function pickSite(ctx: CallerContext, project: unknown): Site | null {
  if (ctx.sites.length === 1) return ctx.sites[0];
  if (typeof project !== "string" || !norm(project)) return null;
  const q = norm(project);
  const matches = ctx.sites.filter((s) => {
    const name = norm(s.product_name);
    return name.includes(q) || q.includes(name) || norm(s.slug).includes(q);
  });
  return matches.length === 1 ? matches[0] : null;
}

const whichProject = (ctx: CallerContext) =>
  `${ctx.business.name} has ${ctx.sites.length} projects: ${ctx.sites.map((s) => s.product_name).join(", ")}. ` +
  `Ask the owner which project they mean, then call this tool again with the project argument.`;

async function findCustomers(siteId: string, query: string | null, segment: string): Promise<Found[]> {
  const { data, error } = await db.rpc("find_customers", {
    p_site_id: siteId,
    p_query: query,
    p_segment: SEGMENTS.includes(segment) ? segment : "all",
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Found[];
}

// ---------------------------------------------------------------- get_attention_items

async function attentionFor(siteId: string): Promise<string> {
  const { data, error } = await db.rpc("needs_attention", { p_site_id: siteId, p_minutes: ATTENTION_MINUTES });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { kind: string; name: string; detail: string }[];
  if (rows.length === 0) return "all clear, everyone is welcomed and paid up.";

  const names = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.name);
  const list = (all: string[]) => all.slice(0, 5).join(", ") + (all.length > 5 ? ` and ${all.length - 5} more` : "");

  const parts: string[] = [];
  const welcome = names("welcome_pending");
  if (welcome.length) parts.push(`${plural(welcome.length, "new signup")} not welcomed yet: ${list(welcome)}.`);

  const unpaid = rows.filter((r) => r.kind === "unpaid");
  if (unpaid.length) {
    const cents = unpaid.reduce((sum, r) => sum + Math.round(Number(r.detail.match(/\$([\d.]+)/)?.[1] ?? 0) * 100), 0);
    parts.push(`${plural(unpaid.length, "unpaid order")} totaling ${dollars(cents)}: ${list(unpaid.map((r) => r.name))}.`);
  }

  const dropped = names("dropped_off");
  if (dropped.length) parts.push(`${dropped.length} signed up but never ordered: ${list(dropped)}.`);
  return parts.join(" ");
}

// No project given and several exist: reports every project in the business.
export async function get_attention_items(ctx: CallerContext, args: Args): Promise<string> {
  const picked = pickSite(ctx, args.project);
  const targets = picked ? [picked] : ctx.sites;
  const who = ctx.owner?.full_name ? `Caller: ${firstName(ctx.owner.full_name)}. ` : "";
  if (targets.length === 0) return `${who}Business: ${ctx.business.name}. It has no projects yet.`;
  const summaries = await Promise.all(targets.map((s) => attentionFor(s.id)));
  const body = targets.map((s, i) => `Project ${s.product_name}: ${summaries[i]}`).join(" ");
  return oneLine(`${who}Business: ${ctx.business.name}. ${body}`);
}

// ---------------------------------------------------------------- find_customers

export async function find_customers(ctx: CallerContext, args: Args): Promise<string> {
  const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : null;
  const segment = typeof args.segment === "string" ? args.segment : "all";
  const picked = pickSite(ctx, args.project);
  const targets = picked ? [picked] : ctx.sites;
  const perSite = await Promise.all(targets.map((s) => findCustomers(s.id, query, segment)));
  const found = perSite.flatMap((rows, i) => rows.map((c) => ({ ...c, project: targets[i].product_name })));
  if (found.length === 0) {
    return `No customers found${query ? ` matching "${query}"` : ""}. Do not guess; tell the owner nobody matched.`;
  }
  const shown = found.slice(0, 10).map((c) => {
    const state = c.state === "unpaid" ? `unpaid ${dollars(c.pending_cents)}` : c.state.replace("_", " ");
    const project = targets.length > 1 ? `${c.project}, ` : "";
    return `${c.name} (${project}${state}, id ${c.id})`;
  });
  const more = found.length > 10 ? ` Plus ${found.length - 10} more not listed.` : "";
  return oneLine(`${plural(found.length, "match", "matches")}: ${shown.join("; ")}.${more}`);
}

// ---------------------------------------------------------------- propose_actions

type Item = {
  type: "email" | "sms" | "invoice";
  segment?: string;
  customer_ids?: string[];
  intent: string;
  amount_cents?: number;
  description?: string;
};

function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const items: Item[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Args;
    if (o.type !== "email" && o.type !== "sms" && o.type !== "invoice") continue;
    const ids = Array.isArray(o.customer_ids)
      ? o.customer_ids.filter((x): x is string => typeof x === "string" && UUID.test(x))
      : undefined;
    const amount = Number(o.amount_cents);
    items.push({
      type: o.type,
      segment: typeof o.segment === "string" && SEGMENTS.includes(o.segment) ? o.segment : undefined,
      customer_ids: ids && ids.length ? ids : undefined,
      intent: typeof o.intent === "string" ? o.intent : "",
      amount_cents: Number.isInteger(amount) && amount >= 50 && amount <= 1_000_000 ? amount : undefined,
      description: typeof o.description === "string" ? o.description.slice(0, 120) : undefined,
    });
  }
  return items;
}

export async function propose_actions(ctx: CallerContext, args: Args): Promise<string> {
  const items = parseItems(args.items);
  if (items.length === 0) return "Nothing to propose: I need at least one email, text or invoice item.";
  const site = pickSite(ctx, args.project);
  if (!site) return whichProject(ctx);
  const siteId = site.id;

  // Recipients always come from find_customers(siteId, ...), so ids that
  // belong to another project or business never match and are dropped.
  const pools = await Promise.all(
    items.map((item) => findCustomers(siteId, null, item.customer_ids ? "all" : item.segment ?? "all")),
  );

  let skippedSms = 0;
  const planned: { item: Item; itemIndex: number; customer: Found; amount?: number }[] = [];
  const seen = new Set<string>();
  items.forEach((item, itemIndex) => {
    if (!item.customer_ids && !item.segment) return; // never default to "everyone"
    const ids = item.customer_ids ? new Set(item.customer_ids) : null;
    for (const customer of pools[itemIndex]) {
      if (ids && !ids.has(customer.id)) continue;
      const key = `${item.type}:${customer.id}`;
      if (seen.has(key)) continue;
      if (item.type === "sms" && (!customer.consent || !customer.phone)) {
        skippedSms++;
        continue;
      }
      seen.add(key);
      const amount = item.type === "invoice"
        ? item.amount_cents ?? (customer.pending_cents > 0 ? customer.pending_cents : site.price_cents)
        : undefined;
      planned.push({ item, itemIndex, customer, amount });
    }
  });

  const skipNote = skippedSms
    ? ` ${plural(skippedSms, "person", "people")} skipped for texts: no consent or no phone.`
    : "";
  if (planned.length === 0) return oneLine(`Nothing to propose: no matching customers.${skipNote}`);
  if (planned.length > MAX_ACTIONS) {
    return `That would be ${planned.length} actions, more than the ${MAX_ACTIONS} I can run in one batch. Ask the owner to narrow it down.`;
  }

  const requests: DraftRequest[] = items.map((item) => ({
    type: item.type,
    intent: item.intent,
    welcome: item.type !== "invoice" && (/welcom/i.test(item.intent) || item.segment === "welcome_pending"),
  }));
  const { drafts, source } = await draftCopy(site, requests);

  const batchId = crypto.randomUUID();
  const rows = planned.map(({ item, itemIndex, customer, amount }) => {
    const copy = personalize(site, requests[itemIndex], drafts[itemIndex], customer.name);
    return {
      site_id: siteId,
      batch_id: batchId,
      type: item.type,
      customer_id: customer.id,
      status: "proposed",
      payload: {
        subject: copy.subject,
        body: copy.body,
        intent: item.intent.slice(0, 300),
        welcome: requests[itemIndex].welcome,
        copy_source: source,
        ...(item.type === "invoice"
          ? { amount_cents: amount, description: item.description ?? site.product_name }
          : {}),
      },
    };
  });
  const { error } = await db.from("actions").insert(rows);
  if (error) throw new Error(error.message);

  const count = (type: string, welcome?: boolean) =>
    rows.filter((r) => r.type === type && (welcome === undefined || r.payload.welcome === welcome)).length;
  const parts: string[] = [];
  if (count("email", true)) parts.push(plural(count("email", true), "welcome email"));
  if (count("email", false)) parts.push(plural(count("email", false), "follow-up email"));
  if (count("sms")) parts.push(plural(count("sms"), "text"));
  if (count("invoice")) {
    const total = planned.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    parts.push(`${plural(count("invoice"), "invoice")} totaling ${dollars(total)}`);
  }
  const where = ctx.sites.length > 1 ? ` for ${site.product_name}` : "";
  return oneLine(
    `Proposed${where}: ${parts.join(", ")}.${skipNote} Nothing is sent yet. Read this back and ask "Should I go ahead?" batch_id: ${batchId}`,
  );
}

// ---------------------------------------------------------------- confirm / cancel

// With no batch_id, falls back to this business's most recent open proposal.
// A batch_id that is given but belongs to another business never matches,
// because every query is limited to the caller's own project ids.
async function resolveBatch(siteIds: string[], raw: unknown): Promise<string | null> {
  if (typeof raw === "string" && raw.trim()) return UUID.test(raw.trim()) ? raw.trim() : null;
  const { data } = await db
    .from("actions")
    .select("batch_id")
    .in("site_id", siteIds)
    .eq("status", "proposed")
    .gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.batch_id ?? null;
}

export async function confirm_actions(ctx: CallerContext, args: Args): Promise<string> {
  const siteIds = ctx.sites.map((s) => s.id);
  const batchId = await resolveBatch(siteIds, args.batch_id);
  const none = "No open proposal found for this business with that id. Nothing was sent.";
  if (!batchId) return none;

  const { data: approved, error } = await db
    .from("actions")
    .update({ status: "approved" })
    .eq("batch_id", batchId)
    .in("site_id", siteIds)
    .eq("status", "proposed")
    .select("id");
  if (error) throw new Error(error.message);
  if (!approved || approved.length === 0) return none;

  // The executor keeps running after we answer; we wait at most ~3.5 s.
  const run = fetch(`${FUNCTIONS_URL}/executor`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ batch_id: batchId }),
  }).then((r) => r.text());
  keepAlive(run);
  await Promise.race([run.catch(() => null), sleep(3500)]);

  const { data: rows } = await db.from("actions").select("status").eq("batch_id", batchId).in("site_id", siteIds);
  const n = (s: string) => (rows ?? []).filter((r) => r.status === s).length;
  const running = n("approved") + n("executing");
  const parts = [`${n("executed")} sent`, `${n("simulated")} simulated`, `${n("failed")} failed`];
  if (running) parts.push(`${running} still running`);
  return oneLine(
    `Done. ${parts.join(", ")}. Simulated means the recipient is demo data, so nothing was actually sent to them.`,
  );
}

export async function cancel_actions(ctx: CallerContext, args: Args): Promise<string> {
  const siteIds = ctx.sites.map((s) => s.id);
  const batchId = await resolveBatch(siteIds, args.batch_id);
  if (!batchId) return "There was no open proposal to cancel. Nothing was sent.";
  const { data, error } = await db
    .from("actions")
    .update({ status: "cancelled" })
    .eq("batch_id", batchId)
    .in("site_id", siteIds)
    .eq("status", "proposed")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return "There was no open proposal to cancel. Nothing was sent.";
  return `Cancelled. ${plural(data.length, "action")} dropped and nothing was sent.`;
}

// ---------------------------------------------------------------- build_landing_page

export async function build_landing_page(ctx: CallerContext, args: Args): Promise<string> {
  const site = pickSite(ctx, args.project);
  if (!site) return whichProject(ctx);
  const siteId = site.id;

  const { data: active } = await db
    .from("site_builds")
    .select("id")
    .eq("site_id", siteId)
    .eq("status", "building")
    .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .limit(1);
  if (active?.length) return "A landing page is already being built. The link will be texted in under a minute.";

  // Optional product and price changes spoken by the owner.
  const update: Record<string, unknown> = {};
  if (typeof args.product_name === "string" && args.product_name.trim()) {
    update.product_name = args.product_name.trim().slice(0, 80);
  }
  const price = Number(args.price_cents);
  if (Number.isInteger(price) && price >= 100 && price <= 1_000_000) update.price_cents = price;
  if (Object.keys(update).length) {
    const { error } = await db.from("sites").update(update).eq("id", siteId);
    if (error) throw new Error(error.message);
  }

  const { data: build, error } = await db
    .from("site_builds")
    .insert({ site_id: siteId, status: "building" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // site-builder answers 202 at once and finishes the deploy in the background.
  const kickoff = fetch(`${FUNCTIONS_URL}/site-builder`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      build_id: build.id,
      intent: typeof args.intent === "string" ? args.intent.slice(0, 400) : "",
    }),
  }).then((r) => r.text());
  keepAlive(kickoff);
  await Promise.race([kickoff.catch(() => null), sleep(2500)]);

  const product = (update.product_name as string) ?? site.product_name;
  const cents = (update.price_cents as number) ?? site.price_cents;
  return oneLine(
    `Building a landing page for ${site.name} selling the ${product} at ${dollars(cents)}. It deploys in about a minute and the link will be texted to the owner's phone.`,
  );
}

// ---------------------------------------------------------------- dispatch

export function runTool(name: string, ctx: CallerContext, args: Args): Promise<string> {
  switch (name) {
    case "get_attention_items":
      return get_attention_items(ctx, args);
    case "find_customers":
      return find_customers(ctx, args);
    case "propose_actions":
      return propose_actions(ctx, args);
    case "confirm_actions":
      return confirm_actions(ctx, args);
    case "cancel_actions":
      return cancel_actions(ctx, args);
    case "build_landing_page":
      return build_landing_page(ctx, args);
    default:
      return Promise.reject(new Error(`unknown tool ${name}`));
  }
}
