// M3 acceptance + QA 14.2 / 14.3: npx tsx scripts/m3-executor.ts
// Inserts approved actions for one allowlisted recipient and one seeded
// recipient, runs the executor twice, and checks the results.
//
// The allowlisted recipient is the first email and first phone in
// SEND_ALLOWLIST, so this sends ONE real email, ONE real text and ONE real
// invoice (email + text) to addresses you put on the allowlist yourself.
import { admin, check, env, finish, FUNCTIONS_URL, SITE_A } from "./_env";

const SEEDED = "a0000000-0000-4000-8000-000000000003"; // Sofia Rossi, @example.com

async function runExecutor(batchId: string) {
  const res = await fetch(`${FUNCTIONS_URL}/executor`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ batch_id: batchId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  const db = admin();
  const allow = env("SEND_ALLOWLIST").split(",").map((s) => s.trim()).filter(Boolean);
  const email = allow.find((s) => s.includes("@"));
  const phone = allow.find((s) => s.startsWith("+"));
  if (!email) throw new Error("SEND_ALLOWLIST needs at least one email");

  // Auth: the executor only accepts the service key.
  const unauth = await fetch(`${FUNCTIONS_URL}/executor`, { method: "POST", body: "{}" });
  check("executor rejects calls without the service key", unauth.status === 401, `http ${unauth.status}`);

  // An allowlisted test customer with a pending order.
  const { data: customer, error } = await db
    .from("customers")
    .insert({ site_id: SITE_A, name: "QA Allowlisted", email, phone: phone ?? null, consent: !!phone, welcomed_at: null })
    .select("id")
    .single();
  if (error) throw error;
  const { data: order } = await db
    .from("orders")
    .insert({ site_id: SITE_A, customer_id: customer.id, amount_cents: 4900 })
    .select("id")
    .single();

  const batchId = crypto.randomUUID();
  const base = { site_id: SITE_A, batch_id: batchId, status: "approved", source: "test" };
  const rows = [
    { ...base, type: "email", customer_id: customer.id, payload: { subject: "Welcome to Sunrise Yoga Studio", body: "Hi QA,\n\nThis is the M3 executor test welcome email.", welcome: true } },
    { ...base, type: "invoice", customer_id: customer.id, payload: { subject: "Your invoice from Sunrise Yoga Studio", body: "Hi QA,\n\nThis is the M3 executor test invoice.", amount_cents: 4900, description: "Intro class pack" } },
    { ...base, type: "email", customer_id: SEEDED, payload: { subject: "Welcome", body: "Hi Sofia, welcome.", welcome: true } },
    { ...base, type: "sms", customer_id: SEEDED, payload: { body: "Sunrise Yoga Studio: Hi Sofia, welcome!" } },
    { ...base, type: "invoice", customer_id: SEEDED, payload: { subject: "Your invoice", body: "Hi Sofia.", amount_cents: 4900, description: "Intro class pack" } },
    // A customer id from another site: must fail alone and not stop the batch.
    { ...base, type: "email", customer_id: "b0000000-0000-4000-8000-000000000001", site_id: SITE_A, payload: { subject: "x", body: "should fail: wrong site" } },
    ...(phone ? [{ ...base, type: "sms", customer_id: customer.id, payload: { body: "Sunrise Yoga Studio: M3 executor test text." } }] : []),
  ];
  const { error: insertError } = await db.from("actions").insert(rows);
  if (insertError) throw insertError;

  const first = await runExecutor(batchId);
  console.log("      first run:", JSON.stringify(first.body));
  const second = await runExecutor(batchId);
  console.log("      second run:", JSON.stringify(second.body));
  check("second run claims nothing (idempotent)", second.body.claimed === 0);

  const { data: actions } = await db.from("actions").select("type, customer_id, status, result").eq("batch_id", batchId);
  const mine = (type: string) => actions!.find((a) => a.customer_id === customer.id && a.type === type);
  const seeded = actions!.filter((a) => a.customer_id === SEEDED);

  check("allowlisted email executed", mine("email")?.status === "executed", JSON.stringify(mine("email")?.result?.error ?? ""));
  check("allowlisted invoice executed", mine("invoice")?.status === "executed", JSON.stringify(mine("invoice")?.result?.error ?? ""));
  if (phone) check("allowlisted text executed", mine("sms")?.status === "executed", JSON.stringify(mine("sms")?.result?.error ?? ""));
  check("seeded recipient: all 3 actions simulated", seeded.length === 3 && seeded.every((a) => a.status === "simulated"));
  check(
    "simulated rows keep the would-be payload and made no external call",
    seeded.every((a) => a.result?.would_send && !a.result?.email_id && !a.result?.stripe_invoice_id),
  );
  const foreign = actions!.find((a) => a.customer_id.startsWith("b0000000"));
  check("one failed action does not stop the batch", foreign?.status === "failed" && mine("email")?.status === "executed");

  const { data: after } = await db.from("customers").select("welcomed_at").eq("id", customer.id).single();
  check("welcome email sets welcomed_at", !!after?.welcomed_at);
  const { data: sofia } = await db.from("customers").select("welcomed_at").eq("id", SEEDED).single();
  check("simulated welcome leaves welcomed_at empty", sofia?.welcomed_at === null);

  const { data: paidOrder } = await db.from("orders").select("stripe_invoice_id, hosted_invoice_url").eq("id", order!.id).single();
  check("invoice id and hosted url stored on the right order", !!paidOrder?.stripe_invoice_id && !!paidOrder?.hosted_invoice_url);

  // welcomed_at is set once: a second welcome must not overwrite it.
  const batch2 = crypto.randomUUID();
  await db.from("actions").insert({ ...base, batch_id: batch2, type: "email", customer_id: customer.id, payload: { subject: "Welcome again", body: "Second welcome (M3 test).", welcome: true } });
  await runExecutor(batch2);
  const { data: again } = await db.from("customers").select("welcomed_at").eq("id", customer.id).single();
  check("second welcome does not overwrite welcomed_at", again?.welcomed_at === after?.welcomed_at);

  console.log(`\nCheck ${email}${phone ? ` and ${phone}` : ""} for the email, text and invoice link.`);
  console.log(`Test customer ${customer.id} is left in place so its invoice can be paid (test card 4242...).`);
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
