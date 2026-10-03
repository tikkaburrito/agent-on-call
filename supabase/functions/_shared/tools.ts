// Agent tools. Each returns one spoken line. The agent touches data only
// through these, always inside the caller's own business (CallerContext).
import { type DraftRequest, draftCopy, personalize, withLink } from "./copy.ts";
import {
  ATTENTION_MINUTES,
  type CallerContext,
  db,
  dollars,
  firstName,
  FUNCTIONS_URL,
  keepAlive,
  salePrice,
  SERVICE_KEY,
  type Site,
  statedDiscount,
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

const preview = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};
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
  type: "email" | "sms" | "invoice" | "call";
  segment?: string;
  customer_ids?: string[];
  intent: string;
  amount_cents?: number;
  description?: string;
  include_link?: boolean;
};

function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const items: Item[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Args;
    if (o.type !== "email" && o.type !== "sms" && o.type !== "invoice" && o.type !== "call") continue;
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
      include_link: o.include_link === false ? false : undefined,
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

  // Calls need their own consent, which find_customers does not return.
  const callable = new Set<string>();
  if (items.some((i) => i.type === "call")) {
    const { data } = await db.from("customers").select("id").eq("site_id", siteId).eq("call_consent", true).not("phone", "is", null);
    for (const c of data ?? []) callable.add(c.id);
  }
  let skippedCalls = 0;
  let skippedSms = 0;
  const planned: { item: Item; itemIndex: number; customer: Found; amount?: number }[] = [];
  const seen = new Set<string>();
  items.forEach((item, itemIndex) => {
    if (!item.customer_ids && !item.segment) return; // never default to "everyone"
    const ids = item.customer_ids ? new Set(item.customer_ids) : null;
    for (const customer of pools[itemIndex]) {
      if (ids && !ids.has(customer.id)) continue;
      // One message per person: the same address signed up twice still gets one email.
      const who = item.type === "email"
        ? customer.email.toLowerCase()
        : item.type === "sms" || item.type === "call"
          ? customer.phone ?? customer.id
          : customer.id;
      const key = `${item.type}:${who}`;
      if (seen.has(key)) continue;
      if (item.type === "sms" && (!customer.consent || !customer.phone)) {
        skippedSms++;
        continue;
      }
      if (item.type === "call" && !callable.has(customer.id)) {
        skippedCalls++;
        continue;
      }
      seen.add(key);
      const amount = item.type === "invoice"
        ? item.amount_cents ?? (customer.pending_cents > 0 ? customer.pending_cents : site.price_cents)
        : undefined;
      planned.push({ item, itemIndex, customer, amount });
    }
  });

  const skipNote =
    (skippedSms ? ` ${plural(skippedSms, "person", "people")} skipped for texts: no consent or no phone.` : "") +
    (skippedCalls ? ` ${plural(skippedCalls, "person", "people")} skipped for calls: they have not agreed to be called or have no phone.` : "");
  if (planned.length === 0) return oneLine(`Nothing to propose: no matching customers.${skipNote}`);
  if (planned.length > MAX_ACTIONS) {
    return `That would be ${planned.length} actions, more than the ${MAX_ACTIONS} I can run in one batch. Ask the owner to narrow it down.`;
  }

  // A call is followed by an email with the link, so it gets email copy too.
  const requests: DraftRequest[] = items.map((item) => ({
    type: item.type === "call" ? "email" : item.type,
    intent: item.intent,
    welcome: item.type !== "invoice" && (/welcom/i.test(item.intent) || item.segment === "welcome_pending"),
  }));
  const { drafts, source } = await draftCopy(site, requests);

  // Offers and follow-ups link to the project's page: the landing page the
  // agent built if there is one, otherwise the hosted signup page.
  const appUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  const pageUrl = site.landing_url || (appUrl ? `${appUrl}/s/${site.slug}` : "");
  const linked = (i: number) => items[i].type !== "invoice" && !requests[i].welcome && items[i].include_link !== false && !!pageUrl;

  const batchId = crypto.randomUUID();
  const rows = planned.map(({ item, itemIndex, customer, amount }) => {
    const personal = personalize(site, requests[itemIndex], drafts[itemIndex], customer.name);
    const copy = linked(itemIndex) ? withLink(item.type === "call" ? "email" : item.type, personal, pageUrl) : personal;
    return {
      site_id: siteId,
      batch_id: batchId,
      call_id: ctx.callId ?? null,
      type: item.type,
      customer_id: customer.id,
      status: "proposed",
      payload: {
        subject: copy.subject,
        body: copy.body,
        intent: item.intent.slice(0, 300),
        welcome: requests[itemIndex].welcome,
        copy_source: source,
        ...(linked(itemIndex) ? { link: pageUrl } : {}),
        ...(statedDiscount(item.intent) ? { offer_percent: statedDiscount(item.intent) } : {}),
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
  if (count("call")) parts.push(plural(count("call"), "phone call"));
  if (count("invoice")) {
    const total = planned.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    parts.push(`${plural(count("invoice"), "invoice")} totaling ${dollars(total)}`);
  }
  const where = ctx.sites.length > 1 ? ` for ${site.product_name}` : "";
  // The drafted wording, so the agent describes what will really be sent.
  const previews = items
    .map((item, i) => {
      const row = rows.find((r, j) => planned[j].itemIndex === i);
      if (!row) return "";
      if (item.type === "call") {
        return `On each call an AI assistant will say it is calling for ${site.name}, tell them: "${preview(item.intent, 160)}", answer simple questions, and follow up with an email that has the link.`;
      }
      const label = item.type === "sms" ? "Text" : item.type === "invoice" ? "Invoice email" : "Email";
      const subject = row.payload.subject ? ` subject "${row.payload.subject}",` : "";
      return `${label}${subject} says: "${preview(row.payload.body, 190)}"`;
    })
    .filter(Boolean)
    .join(" ");
  const linkNote = items.some((_, i) => linked(i) && rows.some((_, j) => planned[j].itemIndex === i))
    ? ` Each one includes the link to the project's page, ${pageUrl.replace("https://", "")}.`
    : "";
  return oneLine(
    `Proposed${where}: ${parts.join(", ")}.${skipNote} ${previews}${linkNote} Nothing is sent yet. Tell the owner the counts and the gist of the wording, then ask "Should I go ahead?" batch_id: ${batchId}`,
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
    .select("id, site_id, payload");
  if (error) throw new Error(error.message);
  if (!approved || approved.length === 0) return none;

  // A percent-off offer the owner just approved must be true where the link
  // lands: set it as the project's discount and refresh its landing page.
  let offerNote = "";
  for (const site of ctx.sites) {
    const percent = approved.find((a) => a.site_id === site.id && (a.payload as { offer_percent?: number })?.offer_percent)
      ?.payload?.offer_percent as number | undefined;
    if (!percent || percent === (site.discount_percent ?? 0)) continue;
    await db.from("sites").update({ discount_percent: percent }).eq("id", site.id);
    site.discount_percent = percent;
    offerNote = ` The ${site.product_name} page and checkout now show ${percent} percent off.`;
    if (site.landing_url) keepAlive(startBuild(site, ctx.callId, `${percent}% off offer`));
  }

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
  const parts = [`${n("executed")} sent or placed`, `${n("simulated")} simulated`, `${n("failed")} failed`];
  if (running) parts.push(`${running} still running`);
  return oneLine(
    `Done. ${parts.join(", ")}.${offerNote} Simulated means the recipient is demo data, so nothing was actually sent to them.`,
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

// Records a build and hands it to site-builder, which answers 202 at once and
// finishes the deploy in the background.
async function startBuild(site: Site, callId: string | undefined, intent: string) {
  const { data: build, error } = await db
    .from("site_builds")
    .insert({ site_id: site.id, status: "building", call_id: callId ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await fetch(`${FUNCTIONS_URL}/site-builder`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ build_id: build.id, intent }),
  }).then((r) => r.text());
}

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
  if (active?.length) return "A landing page is already being built. The link will arrive by text and email in under a minute.";

  // Optional product and price changes spoken by the owner.
  const update: Record<string, unknown> = {};
  if (typeof args.product_name === "string" && args.product_name.trim()) {
    update.product_name = args.product_name.trim().slice(0, 80);
  }
  const price = Number(args.price_cents);
  if (Number.isInteger(price) && price >= 100 && price <= 1_000_000) update.price_cents = price;
  // A percent-off offer the owner stated becomes the project's discount, so the
  // page and the checkout charge the discounted price.
  const intent = typeof args.intent === "string" ? args.intent : "";
  const given = Number(args.discount_percent);
  const discount = Number.isInteger(given) && given >= 0 && given <= 100 ? given : statedDiscount(intent);
  if (discount !== null && discount !== undefined && !Number.isNaN(discount)) update.discount_percent = discount;
  if (Object.keys(update).length) {
    const { error } = await db.from("sites").update(update).eq("id", siteId);
    if (error) throw new Error(error.message);
  }

  const kickoff = startBuild(site, ctx.callId, intent.slice(0, 400));
  keepAlive(kickoff);
  await Promise.race([kickoff.catch(() => null), sleep(2500)]);

  const product = (update.product_name as string) ?? site.product_name;
  const now = { ...site, ...update } as Site;
  const priceText = now.discount_percent
    ? `${dollars(salePrice(now))}, which is ${now.discount_percent} percent off the regular ${dollars(now.price_cents)}`
    : dollars(now.price_cents);
  return oneLine(
    `Building a landing page for ${site.name} selling the ${product} at ${priceText}. It deploys in about a minute and the link will be sent to the owner by text and email.`,
  );
}

// ---------------------------------------------------------------- get_recent_actions

// What the last batch actually said and what happened to it, so the agent can
// answer "what did you send?" from the record instead of from memory.
export async function get_recent_actions(ctx: CallerContext): Promise<string> {
  const siteIds = ctx.sites.map((s) => s.id);
  const { data: latest } = await db
    .from("actions")
    .select("batch_id")
    .in("site_id", siteIds)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!latest?.length) return "Nothing has been proposed or sent yet for this business.";
  const { data: rows, error } = await db
    .from("actions")
    .select("type, status, payload, result, customers(name)")
    .eq("batch_id", latest[0].batch_id)
    .in("site_id", siteIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const all = rows ?? [];
  const word: Record<string, string> = { executed: "sent", simulated: "simulated", failed: "failed", proposed: "waiting for a yes", cancelled: "cancelled", approved: "sending", executing: "sending" };
  const shown = all.slice(0, 3).map((a) => {
    const payload = a.payload as { subject?: string; body?: string };
    const result = (a.result ?? {}) as { error?: string };
    const to = (a.customers as unknown as { name?: string } | null)?.name ?? "a customer";
    const kind = a.type === "sms" ? "Text" : a.type === "invoice" ? "Invoice" : a.type === "call" ? "Phone call" : "Email";
    const subject = payload.subject ? ` Subject "${payload.subject}".` : "";
    const why = a.status === "failed" && result.error ? ` Reason: ${preview(result.error, 110)}.` : "";
    return `${kind} to ${to}, ${word[a.status] ?? a.status}.${subject} It says: "${preview(payload.body ?? "", 200)}"${why}`;
  });
  const more = all.length > 3 ? ` Plus ${all.length - 3} more in the same batch.` : "";
  return oneLine(`Most recent batch, ${plural(all.length, "action")}. ${shown.join(" ")}${more}`);
}

// ---------------------------------------------------------------- get_project

const AUTOMATION_KINDS = ["welcome_new_signups", "remind_unpaid", "invoice_unpaid"] as const;
type AutomationKind = (typeof AUTOMATION_KINDS)[number];
const hours = (minutes: number) => (minutes % 60 === 0 ? plural(minutes / 60, "hour") : plural(minutes, "minute"));
const describeAutomation = (kind: string, delay: number) =>
  kind === "welcome_new_signups"
    ? "automatic welcome emails to every new signup"
    : kind === "remind_unpaid"
      ? `an automatic reminder email when an order has been unpaid for ${hours(delay)}`
      : `an automatic Stripe invoice by email when an order has been unpaid for ${hours(delay)}`;

async function describeProject(site: Site, detailed: boolean): Promise<string> {
  const [customers, orders, build, autos] = await Promise.all([
    db.from("customers").select("*", { count: "exact", head: true }).eq("site_id", site.id),
    db.from("orders").select("amount_cents, status").eq("site_id", site.id),
    db.from("site_builds").select("copy").eq("site_id", site.id).eq("status", "live").order("created_at", { ascending: false }).limit(1),
    db.from("automations").select("kind, delay_minutes").eq("site_id", site.id).eq("enabled", true),
  ]);
  const paid = (orders.data ?? []).filter((o) => o.status === "paid");
  const unpaid = (orders.data ?? []).filter((o) => o.status === "pending");
  const price = site.discount_percent
    ? `${dollars(salePrice(site))} right now, ${site.discount_percent} percent off the regular ${dollars(site.price_cents)}`
    : dollars(site.price_cents);
  const numbers = `${plural(customers.count ?? 0, "customer")}, ${paid.length} paid for ${dollars(paid.reduce((n, o) => n + o.amount_cents, 0))}, ${unpaid.length} unpaid.`;
  if (!detailed) {
    return `Project ${site.product_name}: ${price}. ${numbers} ${site.landing_url ? "Has a landing page." : "No landing page yet."}`;
  }
  const copy = build.data?.[0]?.copy as { headline?: string; subhead?: string; benefits?: string[]; cta?: string } | undefined;
  const page = site.landing_url
    ? `Landing page at ${site.landing_url.replace("https://", "")}.` +
      (copy?.headline
        ? ` Headline: "${copy.headline}". Under it: "${copy.subhead ?? ""}". Points: ${(copy.benefits ?? []).join("; ")}. Button: "${copy.cta ?? ""}".`
        : "")
    : "No landing page built yet; signups use the hosted signup page. You can build one with build_landing_page.";
  const on = (autos.data ?? []).map((a) => describeAutomation(a.kind, a.delay_minutes));
  const automation = on.length ? `Automations on: ${on.join("; ")}.` : "No automations are on.";
  return `Project ${site.product_name}: ${price}. ${numbers} ${page} ${automation}`;
}

// "Look at my landing page", "how is the project doing": everything about a project.
export async function get_project(ctx: CallerContext, args: Args): Promise<string> {
  const picked = pickSite(ctx, args.project);
  if (ctx.sites.length === 0) return `${ctx.business.name} has no projects yet. Offer to create one with create_project.`;
  const parts = await Promise.all((picked ? [picked] : ctx.sites).map((s) => describeProject(s, !!picked)));
  const hint = picked ? "" : " Ask for one project by name for its landing page wording and automations.";
  return oneLine(`Business: ${ctx.business.name}. ${parts.join(" ")}${hint}`);
}

// ---------------------------------------------------------------- create_project

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

// A new offer under the caller's business, with its own signup page.
export async function create_project(ctx: CallerContext, args: Args): Promise<string> {
  const product = typeof args.product_name === "string" ? args.product_name.trim().slice(0, 80) : "";
  const price = Number(args.price_cents);
  if (!product) return "I need a name for what the new project sells. Ask the owner.";
  if (!Number.isInteger(price) || price < 100 || price > 1_000_000) {
    return "I need the regular price for the new project, between 1 and 10,000 dollars. Ask the owner.";
  }
  if (ctx.sites.some((s) => norm(s.product_name) === norm(product))) {
    return `${ctx.business.name} already has a project called ${product}. Use build_landing_page to change its page.`;
  }
  if (ctx.sites.length >= 10) return "This business already has 10 projects, which is the limit.";

  const base = slugify(`${ctx.business.name} ${product}`);
  let site: Site | null = null;
  for (let attempt = 0; attempt < 4 && !site; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db
      .from("sites")
      .insert({ business_id: ctx.business.id, name: ctx.business.name, slug, product_name: product, price_cents: price })
      .select("id, business_id, name, slug, product_name, price_cents, discount_percent, landing_url, subhead")
      .single();
    if (!error) site = data as unknown as Site;
    else if (error.code !== "23505") throw new Error(error.message);
  }
  if (!site) throw new Error("could not find a free address for the project");
  ctx.sites.push(site);

  const appUrl = (Deno.env.get("NEXT_PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  let page = "";
  if (args.build_page !== false) {
    const intent = typeof args.intent === "string" ? args.intent.slice(0, 400) : "";
    const kickoff = startBuild(site, ctx.callId, intent);
    keepAlive(kickoff);
    await Promise.race([kickoff.catch(() => null), sleep(2500)]);
    page = " A landing page is being built now; the link will arrive by text and email in about a minute.";
  }
  return oneLine(
    `Created the project ${product} at ${dollars(price)} under ${ctx.business.name}. Its signup page is live at ${appUrl.replace("https://", "")}/s/${site.slug}.${page}`,
  );
}

// ---------------------------------------------------------------- set_automation

// Switching one on is the owner's standing approval: after that the rule sends
// without a call. The assistant must describe it and get a clear yes first.
export async function set_automation(ctx: CallerContext, args: Args): Promise<string> {
  const site = pickSite(ctx, args.project);
  if (!site) return whichProject(ctx);
  const kind = args.kind as AutomationKind;
  if (!AUTOMATION_KINDS.includes(kind)) {
    return "There are three automations: welcome_new_signups, remind_unpaid and invoice_unpaid. Ask the owner which one.";
  }
  if (typeof args.enabled !== "boolean") return "Say whether to turn it on or off.";
  const delayHours = Number(args.delay_hours);
  const delay = Number.isFinite(delayHours) && delayHours > 0 ? Math.min(Math.round(delayHours * 60), 43200) : undefined;

  const { data: existing } = await db.from("automations").select("delay_minutes").eq("site_id", site.id).eq("kind", kind).maybeSingle();
  const delay_minutes = delay ?? existing?.delay_minutes ?? 60;
  const { error } = await db
    .from("automations")
    .upsert({ site_id: site.id, kind, enabled: args.enabled, delay_minutes, updated_at: new Date().toISOString() }, { onConflict: "site_id,kind" });
  if (error) throw new Error(error.message);

  const what = describeAutomation(kind, delay_minutes);
  return args.enabled
    ? oneLine(`On for ${site.product_name}: ${what}. It runs every minute without a call, once per customer, and only reaches people on the send allowlist.`)
    : `Off for ${site.product_name}: ${what.replace("automatic ", "")} will no longer be sent automatically.`;
}

// ---------------------------------------------------------------- add_customer / mark_paid

function toE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function add_customer(ctx: CallerContext, args: Args): Promise<string> {
  const site = pickSite(ctx, args.project);
  if (!site) return whichProject(ctx);
  const name = typeof args.name === "string" ? args.name.trim().slice(0, 100) : "";
  const email = typeof args.email === "string" ? args.email.trim().toLowerCase().replace(/\s+/g, "") : "";
  if (!name) return "I need the customer's name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That email address doesn't look right. Ask the owner to spell it out.";
  const phone = toE164(args.phone);

  const { data: dupe } = await db.from("customers").select("id").eq("site_id", site.id).eq("email", email).limit(1);
  if (dupe?.length) return `${email} is already a customer of ${site.product_name}. Nothing was added.`;
  const { error } = await db
    .from("customers")
    .insert({
      site_id: site.id,
      name,
      email,
      phone,
      consent: args.sms_consent === true && !!phone,
      call_consent: args.call_consent === true && !!phone,
    });
  if (error) throw new Error(error.message);
  return oneLine(`Added ${name}, ${email}, to ${site.product_name}. They count as a new signup who has not been welcomed yet.`);
}

// For a customer who paid outside Stripe (cash, bank transfer).
export async function mark_paid(ctx: CallerContext, args: Args): Promise<string> {
  const query = typeof args.customer === "string" ? args.customer.trim() : "";
  if (!query) return "Which customer paid? Ask for their name.";
  const perSite = await Promise.all(ctx.sites.map((s) => findCustomers(s.id, query, "unpaid")));
  const matches = perSite.flat();
  if (matches.length === 0) return `No customer matching "${query}" has an unpaid order. Nothing was changed.`;
  if (matches.length > 1) {
    return `${matches.length} customers match "${query}" with unpaid orders: ${matches.slice(0, 3).map((c) => c.name).join(", ")}. Ask which one.`;
  }
  const customer = matches[0];
  const { data, error } = await db
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("customer_id", customer.id)
    .in("site_id", ctx.sites.map((s) => s.id))
    .eq("status", "pending")
    .select("amount_cents");
  if (error) throw new Error(error.message);
  const total = (data ?? []).reduce((n, o) => n + o.amount_cents, 0);
  return `Marked ${customer.name} as paid: ${plural(data?.length ?? 0, "order")} for ${dollars(total)}.`;
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
    case "get_recent_actions":
      return get_recent_actions(ctx);
    case "get_project":
      return get_project(ctx, args);
    case "create_project":
      return create_project(ctx, args);
    case "set_automation":
      return set_automation(ctx, args);
    case "add_customer":
      return add_customer(ctx, args);
    case "mark_paid":
      return mark_paid(ctx, args);
    default:
      return Promise.reject(new Error(`unknown tool ${name}`));
  }
}
