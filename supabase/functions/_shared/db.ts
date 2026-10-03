import { createClient } from "jsr:@supabase/supabase-js@2";

// Service-role client. Edge functions are the only place besides the Next.js
// server route that holds this key.
export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export const FUNCTIONS_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ATTENTION_MINUTES = Number(Deno.env.get("ATTENTION_MINUTES") ?? "2") || 2;

// A project: one offer with its own landing page, customers and orders.
export type Site = {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  product_name: string;
  price_cents: number;
  landing_url: string | null;
  subhead?: string | null;
  discount_percent?: number;
};

// What a customer pays today: the list price less the project's discount.
export const salePrice = (site: { price_cents: number; discount_percent?: number }) =>
  Math.round((site.price_cents * (100 - (site.discount_percent ?? 0))) / 100);

// A percent-off offer the owner stated, e.g. "50 percent off" -> 50.
export function statedDiscount(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*(?:%|percent|per cent)/i);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 90 ? n : null;
}

export const SITE_COLUMNS = "id, business_id, name, slug, product_name, price_cents, discount_percent, landing_url, subhead";

export type Owner = { id: string; username: string; full_name: string | null; phone: string | null };

// Who is calling: the user, their business, and the projects under it.
export type CallerContext = {
  callId?: string;
  owner: Owner | null;
  business: { id: string; name: string };
  sites: Site[];
};

async function contextForBusiness(businessId: string, owner: Owner | null): Promise<CallerContext | null> {
  const { data: business } = await db
    .from("businesses")
    .select(`id, name, owner_id, sites(${SITE_COLUMNS}, created_at)`)
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return null;
  if (!owner && business.owner_id) {
    const { data } = await db.from("profiles").select("id, username, full_name, phone").eq("id", business.owner_id).maybeSingle();
    owner = (data as Owner) ?? null;
  }
  const sites = ((business.sites ?? []) as (Site & { created_at: string })[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { owner, business: { id: business.id, name: business.name }, sites };
}

// Caller ID -> user profile -> their business -> its projects.
export async function contextForPhone(phone: string): Promise<CallerContext | null> {
  const { data: owner } = await db.from("profiles").select("id, username, full_name, phone").eq("phone", phone).maybeSingle();
  if (!owner) return null;
  const { data: business } = await db
    .from("businesses")
    .select("id")
    .eq("owner_id", owner.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (!business?.length) return null;
  return contextForBusiness(business[0].id, owner as Owner);
}

// Web calls have no caller ID: use the demo project's business.
export async function contextForSite(siteId: string): Promise<CallerContext | null> {
  const { data: site } = await db.from("sites").select("business_id").eq("id", siteId).maybeSingle();
  return site ? contextForBusiness(site.business_id, null) : null;
}

export type Customer = {
  id: string;
  site_id: string;
  name: string;
  email: string;
  phone: string | null;
  consent: boolean;
  welcomed_at: string | null;
};

export type ActionRow = {
  id: string;
  site_id: string;
  batch_id: string;
  type: "email" | "sms" | "invoice";
  customer_id: string;
  payload: {
    subject?: string;
    body?: string;
    amount_cents?: number;
    description?: string;
    welcome?: boolean;
    intent?: string;
  };
  status: string;
};

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// Internal calls carry a service-role key. Function-to-function calls send the
// runtime's own key. A caller outside the runtime (the test scripts) may hold a
// different string for the same role, so that one has to prove itself by
// reading a table only the service role can read.
export async function isInternalCall(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (timingSafeEqual(token, SERVICE_KEY)) return true;
  try {
    const probe = createClient(Deno.env.get("SUPABASE_URL")!, token, { auth: { persistSession: false } });
    const { error } = await probe.from("stripe_events").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export const dollars = (cents: number) =>
  cents % 100 === 0 ? `${cents / 100} dollars` : `${(cents / 100).toFixed(2)} dollars`;

export const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// Lets work continue after the HTTP response has been sent.
export function keepAlive(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("background task failed:", e?.message ?? e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(guarded);
}
