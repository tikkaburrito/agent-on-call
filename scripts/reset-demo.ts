// Resets the demo to its seeded state before a rehearsal:
//   npx tsx scripts/reset-demo.ts
// Removes all actions and landing-page builds, removes customers and orders
// that are not part of the seed, and restores the seeded welcome/paid states.
import { admin, SITE_A, SITE_B } from "./_env";

const SITE_C = "33333333-3333-4333-8333-333333333333"; // Sunrise / Monthly membership

const NOT_WELCOMED = ["a0000000-0000-4000-8000-000000000003", "a0000000-0000-4000-8000-000000000005", "a0000000-0000-4000-8000-000000000007", "a3000000-0000-4000-8000-000000000003", "a3000000-0000-4000-8000-000000000005", "b0000000-0000-4000-8000-000000000001"];
const PENDING_ORDERS = ["c0000000-0000-4000-8000-000000000003", "c0000000-0000-4000-8000-000000000004", "c0000000-0000-4000-8000-000000000007", "c3000000-0000-4000-8000-000000000002", "d0000000-0000-4000-8000-000000000001"];
const isSeed = (id: string) => /^[a-d][03]000000-0000-4000-8000-/.test(id);

async function main() {
  const db = admin();
  const sites = [SITE_A, SITE_B, SITE_C];
  await db.from("actions").delete().in("site_id", sites);
  await db.from("site_builds").delete().in("site_id", sites);
  // Call log entries created by the test scripts (real Vapi call ids are UUIDs).
  const { data: calls } = await db.from("calls").select("id");
  const testCalls = (calls ?? []).map((c) => c.id).filter((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id));
  if (testCalls.length) {
    await db.from("actions").delete().in("call_id", testCalls);
    await db.from("calls").delete().in("id", testCalls);
  }

  const { data: orders } = await db.from("orders").select("id").in("site_id", sites);
  const extraOrders = (orders ?? []).map((o) => o.id).filter((id) => !isSeed(id));
  if (extraOrders.length) await db.from("orders").delete().in("id", extraOrders);
  const { data: customers } = await db.from("customers").select("id").in("site_id", sites);
  const extraCustomers = (customers ?? []).map((c) => c.id).filter((id) => !isSeed(id));
  if (extraCustomers.length) await db.from("customers").delete().in("id", extraCustomers);

  await db.from("customers").update({ welcomed_at: null }).in("id", NOT_WELCOMED);
  await db.from("orders").update({ status: "pending", paid_at: null, stripe_invoice_id: null, hosted_invoice_url: null }).in("id", PENDING_ORDERS);
  console.log(`Reset done: removed ${extraCustomers.length} non-seed customers and ${extraOrders.length} orders, cleared actions and builds.`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
