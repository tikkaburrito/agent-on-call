// M2 / QA 14.1 + 14.2: Stripe webhook signature, paid flip, replay no-op.
//   npx tsx scripts/m2-webhook.ts
// Signs a synthetic checkout.session.completed event with STRIPE_WEBHOOK_SECRET
// (the same scheme Stripe uses), so it needs no card and no Stripe API call.
import { createHmac } from "node:crypto";
import { admin, check, env, finish, FUNCTIONS_URL, SITE_A } from "./_env";

const URL_ = `${FUNCTIONS_URL}/stripe-webhook`;

function post(body: string, signature: string) {
  return fetch(URL_, { method: "POST", headers: { "stripe-signature": signature, "Content-Type": "application/json" }, body });
}

function sign(body: string, secret: string) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

async function main() {
  const db = admin();
  const secret = env("STRIPE_WEBHOOK_SECRET");

  const { data: customer } = await db
    .from("customers")
    .insert({ site_id: SITE_A, name: "QA Webhook", email: "qa-webhook@example.com", welcomed_at: new Date().toISOString() })
    .select("id")
    .single();
  const { data: order } = await db
    .from("orders")
    .insert({ site_id: SITE_A, customer_id: customer!.id, amount_cents: 4900 })
    .select("id")
    .single();
  const status = async () => (await db.from("orders").select("status, paid_at").eq("id", order!.id).single()).data!;

  const eventId = `evt_test_${Date.now()}`;
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_qa", payment_status: "paid", metadata: { order_id: order!.id, site_id: SITE_A } } },
  });

  try {
    const bad = await post(body, "t=1,v1=deadbeef");
    check("bad signature -> 400", bad.status === 400, `http ${bad.status}`);
    const wrongKey = await post(body, sign(body, "whsec_wrong"));
    check("signature from the wrong secret -> 400", wrongKey.status === 400, `http ${wrongKey.status}`);
    check("order unchanged after rejected events", (await status()).status === "pending");
    const { count } = await db.from("stripe_events").select("*", { count: "exact", head: true }).eq("id", eventId);
    check("rejected event not recorded", count === 0);

    const first = await post(body, sign(body, secret));
    check("valid event -> 200", first.status === 200, `http ${first.status}`);
    const paid = await status();
    check("order flipped to paid", paid.status === "paid" && !!paid.paid_at);

    const replay = await post(body, sign(body, secret));
    const replayBody = await replay.json().catch(() => ({}));
    check("replay -> 200 duplicate", replay.status === 200 && replayBody.duplicate === true);
    check("replay changed nothing", (await status()).paid_at === paid.paid_at);
  } finally {
    await db.from("orders").delete().eq("id", order!.id);
    await db.from("customers").delete().eq("id", customer!.id);
    await db.from("stripe_events").delete().eq("id", eventId);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
