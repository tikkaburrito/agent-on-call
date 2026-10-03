// Runs an approved batch. Called by confirm_actions with the service key.
import { isAllowed } from "../_shared/allowlist.ts";
import { invoiceSms } from "../_shared/copy.ts";
import { type ActionRow, type Customer, db, isInternalCall, type Site, SITE_COLUMNS } from "../_shared/db.ts";
import { sendEmail, sendSms, smsRejection } from "../_shared/send.ts";
import { createInvoice } from "../_shared/stripe.ts";

type Outcome = { status: "executed" | "simulated" | "failed"; result: Record<string, unknown> };

async function runEmail(action: ActionRow, customer: Customer): Promise<Outcome> {
  const message = {
    to: customer.email,
    subject: action.payload.subject ?? "",
    text: action.payload.body ?? "",
  };
  if (!isAllowed(customer.email)) {
    return { status: "simulated", result: { reason: "recipient not on allowlist", would_send: { channel: "email", ...message } } };
  }
  const sent = await sendEmail(message);
  if (action.payload.welcome) {
    // Set once: a later welcome never overwrites the first timestamp.
    await db
      .from("customers")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", customer.id)
      .is("welcomed_at", null);
  }
  return { status: "executed", result: { channel: "email", to: customer.email, email_id: sent.id } };
}

async function runSms(action: ActionRow, customer: Customer): Promise<Outcome> {
  if (!customer.consent || !customer.phone) {
    return { status: "failed", result: { error: "no SMS consent or no phone on file" } };
  }
  const message = { to: customer.phone, body: action.payload.body ?? "" };
  if (!isAllowed(customer.phone)) {
    return { status: "simulated", result: { reason: "recipient not on allowlist", would_send: { channel: "sms", ...message } } };
  }
  const sent = await sendSms(message);
  const rejected = await smsRejection(sent.sid);
  if (rejected) return { status: "failed", result: { channel: "sms", to: customer.phone, sms_sid: sent.sid, error: rejected } };
  return { status: "executed", result: { channel: "sms", to: customer.phone, sms_sid: sent.sid } };
}

async function runInvoice(action: ActionRow, customer: Customer, site: Site): Promise<Outcome> {
  const amount = action.payload.amount_cents ?? site.price_cents;
  const description = action.payload.description ?? site.product_name;
  const email = { to: customer.email, subject: action.payload.subject ?? "", text: action.payload.body ?? "" };

  if (!isAllowed(customer.email)) {
    return {
      status: "simulated",
      result: {
        reason: "recipient not on allowlist",
        would_send: { channel: "invoice", amount_cents: amount, description, email },
      },
    };
  }

  // The invoice belongs to the customer's oldest pending order, or a new one.
  const { data: pending } = await db
    .from("orders")
    .select("id")
    .eq("site_id", site.id)
    .eq("customer_id", customer.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  let orderId = pending?.[0]?.id as string | undefined;
  if (!orderId) {
    const { data: created, error } = await db
      .from("orders")
      .insert({ site_id: site.id, customer_id: customer.id, amount_cents: amount })
      .select("id")
      .single();
    if (error) throw new Error(`could not create order: ${error.message}`);
    orderId = created.id;
  }

  const invoice = await createInvoice({
    email: customer.email,
    name: customer.name,
    amount_cents: amount,
    description: `${description} — ${site.name}`,
    metadata: { order_id: orderId!, site_id: site.id, action_id: action.id },
  });
  await db
    .from("orders")
    .update({ stripe_invoice_id: invoice.invoice_id, hosted_invoice_url: invoice.hosted_invoice_url })
    .eq("id", orderId);

  const result: Record<string, unknown> = {
    channel: "invoice",
    order_id: orderId,
    amount_cents: amount,
    stripe_invoice_id: invoice.invoice_id,
    hosted_invoice_url: invoice.hosted_invoice_url,
  };

  // Stripe does not email in test mode, so we deliver the link ourselves.
  const sent = await sendEmail({ ...email, text: `${email.text}\n\nPay your invoice here: ${invoice.hosted_invoice_url}` });
  result.email_id = sent.id;

  if (customer.consent && customer.phone && isAllowed(customer.phone)) {
    try {
      const sms = await sendSms({ to: customer.phone, body: invoiceSms(site, amount, invoice.hosted_invoice_url) });
      result.sms_sid = sms.sid;
      const rejected = await smsRejection(sms.sid);
      if (rejected) result.sms_error = rejected; // the email already carries the link
    } catch (e) {
      result.sms_error = (e as Error).message; // the email already carries the link
    }
  } else {
    result.sms_skipped = !customer.consent || !customer.phone ? "no consent or phone" : "phone not on allowlist";
  }
  return { status: "executed", result };
}

async function runBatch(batchId: string) {
  // Atomic claim: only rows still `approved` move to `executing`, so a second
  // run of the same batch claims nothing and sends nothing.
  const { data: claimed, error } = await db
    .from("actions")
    .update({ status: "executing" })
    .eq("batch_id", batchId)
    .eq("status", "approved")
    .select("id, site_id, batch_id, type, customer_id, payload, status");
  if (error) throw new Error(error.message);
  const actions = (claimed ?? []) as ActionRow[];
  const counts = { claimed: actions.length, executed: 0, simulated: 0, failed: 0 };
  if (actions.length === 0) return counts;

  const siteId = actions[0].site_id;
  const [{ data: site }, { data: customers }] = await Promise.all([
    db.from("sites").select(SITE_COLUMNS).eq("id", siteId).single(),
    db.from("customers").select("id, site_id, name, email, phone, consent, welcomed_at").eq("site_id", siteId)
      .in("id", [...new Set(actions.map((a) => a.customer_id))]),
  ]);
  const byId = new Map((customers ?? []).map((c) => [c.id, c as Customer]));

  const runOne = async (action: ActionRow) => {
    let outcome: Outcome;
    try {
      const customer = byId.get(action.customer_id);
      if (!site || !customer) throw new Error("customer not found for this site");
      if (action.type === "email") outcome = await runEmail(action, customer);
      else if (action.type === "sms") outcome = await runSms(action, customer);
      else outcome = await runInvoice(action, customer, site as unknown as Site);
    } catch (e) {
      // One failure never stops the rest of the batch.
      outcome = { status: "failed", result: { error: (e as Error).message } };
    }
    counts[outcome.status]++;
    await db
      .from("actions")
      .update({ status: outcome.status, result: outcome.result, executed_at: new Date().toISOString() })
      .eq("id", action.id);
  };

  // Small worker pool: fast enough for a call, gentle on provider rate limits.
  const queue = [...actions];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await runOne(next);
    }),
  );
  return counts;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 }); // warm ping
  if (!(await isInternalCall(req))) return new Response("unauthorized", { status: 401 });

  const { batch_id } = await req.json().catch(() => ({}));
  if (typeof batch_id !== "string") return Response.json({ error: "batch_id required" }, { status: 400 });

  const started = Date.now();
  try {
    const counts = await runBatch(batch_id);
    console.log(`executor batch=${batch_id} ${JSON.stringify(counts)} ${Date.now() - started}ms`);
    return Response.json(counts);
  } catch (e) {
    console.error("executor failed:", (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
