// Creates the Stripe (test mode) webhook endpoint for the stripe-webhook edge
// function and writes its signing secret into .env.local without printing it.
//   npx tsx scripts/setup-stripe-webhook.ts && bash scripts/push-secrets.sh
import { readFileSync, writeFileSync } from "node:fs";
import Stripe from "stripe";
import { env, FUNCTIONS_URL } from "./_env";

async function main() {
  const key = env("STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)");
  }
  const stripe = new Stripe(key);
  const url = `${FUNCTIONS_URL}/stripe-webhook`;

  // The signing secret is only returned at creation, so replace any old endpoint.
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const endpoint of existing.data.filter((e) => e.url === url)) {
    await stripe.webhookEndpoints.del(endpoint.id);
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: ["checkout.session.completed", "invoice.paid"],
    description: "Agent on Call: mark orders and invoices paid",
  });

  const file = readFileSync(".env.local", "utf8");
  writeFileSync(".env.local", file.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET=${endpoint.secret}`));
  console.log(`Webhook endpoint ${endpoint.id} -> ${url}`);
  console.log("STRIPE_WEBHOOK_SECRET saved to .env.local. Now run: bash scripts/push-secrets.sh");
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
