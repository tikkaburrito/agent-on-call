export type Profile = { id: string; username: string; full_name: string | null; phone: string | null };

export type Business = { id: string; owner_id: string | null; name: string; created_at: string };

// A project under a business: one offer with its own page, customers and orders.
export type Site = {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  product_name: string;
  price_cents: number;
  headline: string | null;
  subhead: string | null;
  landing_url: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  site_id: string;
  name: string;
  email: string;
  phone: string | null;
  consent: boolean;
  welcomed_at: string | null;
  created_at: string;
};

export type Order = {
  id: string;
  site_id: string;
  customer_id: string;
  amount_cents: number;
  status: "pending" | "paid";
  hosted_invoice_url: string | null;
  created_at: string;
  paid_at: string | null;
};

export type ActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "simulated";

export type Action = {
  id: string;
  site_id: string;
  batch_id: string;
  type: "email" | "sms" | "invoice";
  customer_id: string;
  payload: { subject?: string; body?: string; amount_cents?: number; description?: string };
  status: ActionStatus;
  result: Record<string, unknown> | null;
  created_at: string;
  executed_at: string | null;
};

export type SiteBuild = {
  id: string;
  site_id: string;
  status: "building" | "live" | "failed";
  url: string | null;
  error: string | null;
  created_at: string;
};

export type AttentionItem = {
  kind: "welcome_pending" | "unpaid" | "dropped_off";
  customer_id: string;
  name: string;
  email: string;
  phone: string | null;
  detail: string;
};

export const DEMO_SITE_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

export const dollars = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
