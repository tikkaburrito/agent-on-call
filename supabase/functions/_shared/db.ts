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

export type Site = {
  id: string;
  owner_phone: string;
  name: string;
  slug: string;
  product_name: string;
  price_cents: number;
  landing_url: string | null;
};

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

// Internal function-to-function calls carry the service key.
export function isInternalCall(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return timingSafeEqual(auth, `Bearer ${SERVICE_KEY}`);
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
