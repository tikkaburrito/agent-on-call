// Marks orders paid from Stripe events. Authenticated by the Stripe signature.
import { db } from "../_shared/db.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const body = await req.text();
  const ok = await verifyStripeSignature(
    body,
    req.headers.get("stripe-signature"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
  );
  if (!ok) return new Response("invalid signature", { status: 400 });

  const event = JSON.parse(body);

  // Record the event id first: a replay hits the primary key and is a no-op.
  const { error: seen } = await db.from("stripe_events").insert({ id: event.id });
  if (seen) {
    if (seen.code === "23505") return Response.json({ received: true, duplicate: true });
    return new Response("could not record event", { status: 500 });
  }

  try {
    const obj = event.data?.object ?? {};
    const paid = { status: "paid", paid_at: new Date().toISOString() };

    if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
      const query = db.from("orders").update(paid).eq("status", "pending");
      const { error } = obj.metadata?.order_id
        ? await query.eq("id", obj.metadata.order_id)
        : await query.eq("stripe_checkout_session_id", obj.id);
      if (error) throw error;
    } else if (event.type === "invoice.paid") {
      const { error } = await db
        .from("orders")
        .update(paid)
        .eq("status", "pending")
        .eq("stripe_invoice_id", obj.id);
      if (error) throw error;
    }
    console.log(`stripe event ${event.type} handled`);
    return Response.json({ received: true });
  } catch (e) {
    // Forget the event so Stripe's retry is processed.
    await db.from("stripe_events").delete().eq("id", event.id);
    console.error("stripe-webhook failed:", (e as Error).message);
    return new Response("processing failed", { status: 500 });
  }
});
