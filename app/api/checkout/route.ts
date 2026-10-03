import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/auth";
import { DEMO_SITE_ID, salePrice } from "@/lib/types";

// Public endpoint: the booking page on this app and every landing page the
// agent deploys post here. It is the only public write path, and it only
// creates a customer plus a pending order for an existing site.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const siteId = typeof body.site_id === "string" && body.site_id ? body.site_id : DEMO_SITE_ID;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const phone = toE164(body.phone);
  const consent = body.consent === true;

  if (!UUID.test(siteId)) return json({ error: "Unknown site." }, 400);
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (body.phone && !phone) return json({ error: "Please enter a valid phone number." }, 400);

  const db = supabaseAdmin();
  const { data: site } = await db
    .from("sites")
    .select("id, name, slug, product_name, price_cents, discount_percent, landing_url")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) return json({ error: "Unknown site." }, 404);

  const { data: customer, error: customerError } = await db
    .from("customers")
    .insert({ site_id: site.id, name, email, phone, consent: consent && !!phone })
    .select("id")
    .single();
  if (customerError) return json({ error: "Could not save your details." }, 500);

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({ site_id: site.id, customer_id: customer.id, amount_cents: salePrice(site) })
    .select("id")
    .single();
  if (orderError) return json({ error: "Could not create your order." }, 500);

  // Test mode only: this demo must never take a real card payment. The signup
  // and pending order above still exist, so the agent can follow up.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(stripeKey)) {
    return json({ error: "Payments are not set up in test mode yet. We saved your details." }, 502);
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: salePrice(site),
            product_data: { name: `${site.product_name} — ${site.name}` },
          },
        },
      ],
      metadata: { order_id: order.id, site_id: site.id },
      success_url: `${appUrl}/success?site=${site.id}`,
      cancel_url: site.landing_url || `${appUrl}/s/${site.slug}`,
    });
    await db.from("orders").update({ stripe_checkout_session_id: session.id }).eq("id", order.id);
    return json({ url: session.url });
  } catch {
    // The signup and pending order still exist, so the agent can follow up.
    return json({ error: "Payment page is unavailable right now. We saved your details." }, 502);
  }
}
