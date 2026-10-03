// Live checks after scripts/m3-executor.ts: Twilio delivery status of the test
// texts, and a real Stripe (test mode) invoice.paid event flipping the order.
//   npx tsx scripts/qa-live.ts
import Stripe from "stripe";
import { admin, env } from "./_env";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const db = admin();
  // 1. What the invoice action recorded, and Twilio's delivery status for the texts.
  const { data: acts } = await db.from("actions").select("type, status, result").eq("source", "test").eq("status", "executed").order("created_at", { ascending: false }).limit(6);
  const sids: string[] = [];
  for (const a of acts ?? []) {
    const r = a.result as Record<string, any>;
    if (r?.sms_sid) sids.push(r.sms_sid);
    console.log(`action ${a.type}: ${Object.keys(r ?? {}).filter((k) => !["to", "hosted_invoice_url"].includes(k)).map((k) => `${k}=${k.endsWith("error") ? r[k] : "ok"}`).join(" ")}`);
  }
  const auth = "Basic " + Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
  await sleep(4000);
  for (const sid of sids) {
    const m = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Messages/${sid}.json`, { headers: { Authorization: auth } })).json();
    console.log(`twilio message: status=${m.status} error_code=${m.error_code ?? "none"} ${m.error_message ?? ""}`);
  }
  // 2. Real Stripe event: mark the test invoice paid and watch the webhook flip the order.
  const { data: order } = await db.from("orders").select("id, status, stripe_invoice_id").not("stripe_invoice_id", "is", null).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return console.log("no pending invoiced order found");
  const stripe = new Stripe(env("STRIPE_SECRET_KEY"));
  const paid = await stripe.invoices.pay(order.stripe_invoice_id!, { paid_out_of_band: true });
  console.log(`stripe invoice ${paid.livemode ? "LIVE" : "test"} marked paid: status=${paid.status}`);
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const { data } = await db.from("orders").select("status, paid_at").eq("id", order.id).single();
    if (data?.status === "paid") return console.log(`webhook flipped the order to paid after ~${(i + 1) * 2}s`);
  }
  console.log("order still pending after 30s: invoice.paid webhook did not arrive");
})();
