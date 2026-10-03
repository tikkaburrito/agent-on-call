// Stripe over REST (no SDK, to keep cold starts short). Test mode only.

type Params = Record<string, string | number | boolean | Record<string, string>>;

function encode(params: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v)) out.append(`${k}[${k2}]`, String(v2));
    } else {
      out.append(k, String(v));
    }
  }
  return out;
}

export async function stripe(method: "GET" | "POST", path: string, params: Params = {}) {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("Stripe is not configured with a test-mode key");
  const query = method === "GET" ? `?${encode(params)}` : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? encode(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? "request failed"}`);
  return data;
}

// Find-or-create the customer, then a finalized send_invoice invoice due in 7 days.
export async function createInvoice(input: {
  email: string;
  name: string;
  amount_cents: number;
  description: string;
  metadata: Record<string, string>;
}): Promise<{ invoice_id: string; hosted_invoice_url: string }> {
  const found = await stripe("GET", "/customers", { email: input.email, limit: 1 });
  const customer =
    found.data?.[0] ?? (await stripe("POST", "/customers", { email: input.email, name: input.name }));

  const invoice = await stripe("POST", "/invoices", {
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: 7,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    metadata: input.metadata,
  });
  await stripe("POST", "/invoiceitems", {
    customer: customer.id,
    invoice: invoice.id,
    amount: input.amount_cents,
    currency: "usd",
    description: input.description,
  });
  const finalized = await stripe("POST", `/invoices/${invoice.id}/finalize`);
  return { invoice_id: finalized.id, hosted_invoice_url: finalized.hosted_invoice_url };
}

// Verifies the Stripe-Signature header (HMAC-SHA256 over `${t}.${body}`).
export async function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => {
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}
