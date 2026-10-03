// Outbound calls: npx tsx scripts/m9-outbound.ts
// Default run places NO real call: it checks consent, the allowlist, the
// outcome report, and that the owner's tools are unavailable on an outbound call.
//
//   npx tsx scripts/m9-outbound.ts --live
// also places ONE real call to the first phone number on SEND_ALLOWLIST.
import { admin, check, env, finish, FUNCTIONS_URL, SITE_B } from "./_env";

const live = process.argv.includes("--live");
const post = (url: string, headers: Record<string, string>, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const runExecutor = async (batchId: string) =>
  (await post(`${FUNCTIONS_URL}/executor`, { Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` }, { batch_id: batchId })).json();
const vapi = async (message: Record<string, unknown>) =>
  (await post(`${FUNCTIONS_URL}/vapi-tools`, { "x-vapi-secret": env("VAPI_SERVER_SECRET") }, { message })).json();

async function main() {
  const db = admin();
  const made: string[] = [];
  const customer = async (name: string, phone: string | null, call_consent: boolean, email = `qa-call-${Date.now()}-${made.length}@example.com`) => {
    const { data, error } = await db.from("customers").insert({ site_id: SITE_B, name, email, phone, call_consent, welcomed_at: new Date().toISOString() }).select("id").single();
    if (error) throw error;
    made.push(data.id);
    return data.id as string;
  };
  const action = (batch: string, customerId: string) => ({
    site_id: SITE_B, batch_id: batch, type: "call", customer_id: customerId, status: "approved", source: "test",
    payload: { intent: "We have a new tasting flight this week.", subject: "A note from Harbor Coffee Roasters", body: "Hi,\n\nThis is the follow-up email for the outbound call test." },
  });

  try {
    // 1. Consent and allowlist.
    const agreed = await customer("QA Callable", "+14155550171", true);
    const refused = await customer("QA No Consent", "+14155550172", false);
    const batch = crypto.randomUUID();
    await db.from("actions").insert([action(batch, agreed), action(batch, refused)]);
    console.log("      executor:", JSON.stringify(await runExecutor(batch)));
    const { data: rows } = await db.from("actions").select("customer_id, status, result").eq("batch_id", batch);
    const of = (id: string) => rows!.find((r) => r.customer_id === id)!;
    check("no call consent -> the call is refused", of(refused).status === "failed" && /not agreed/.test(String((of(refused).result as any)?.error)));
    check("number not on the allowlist -> simulated, nobody is called", of(agreed).status === "simulated" && (of(agreed).result as any)?.would_send?.channel === "call");

    // 2. The customer-facing assistant's outcome report, and "do not call".
    const callId = `qa-out-${Date.now()}`;
    await db.from("calls").insert({ id: callId, business_id: SITE_B, type: "outboundPhoneCall", caller_phone: "+14155550171" });
    await db.from("actions").update({ status: "executed", result: { channel: "call", vapi_call_id: callId } }).eq("batch_id", batch).eq("customer_id", agreed);
    const outboundCall = { id: callId, type: "outboundPhoneCall", customer: { number: "+14155550171" } };
    const outcome = await vapi({ type: "tool-calls", call: outboundCall, toolCallList: [{ id: "t1", type: "function", function: { name: "record_call_outcome", arguments: { outcome: "do_not_call", note: "Asked not to be called." } } }] });
    check("outcome is recorded", /will not be called again/.test(outcome.results?.[0]?.result ?? ""));
    const { data: after } = await db.from("customers").select("call_consent").eq("id", agreed).single();
    check("'do not call' withdraws call consent", after?.call_consent === false);
    const { data: act } = await db.from("actions").select("result").eq("batch_id", batch).eq("customer_id", agreed).single();
    check("outcome is stored on the action", (act?.result as any)?.outcome === "do_not_call");

    // 3. Owner tools must not work on a call we placed, even to an owner's number.
    const guarded = await vapi({ type: "tool-calls", call: { id: callId, type: "outboundPhoneCall", customer: { number: "+15555550001" } }, toolCallList: [{ id: "t2", type: "function", function: { name: "get_attention_items", arguments: {} } }] });
    check("owner tools are unavailable on outbound calls", !!guarded.results?.[0]?.error && !guarded.results?.[0]?.result);
    await db.from("calls").delete().eq("id", callId);

    // 4. Optional: one real call to your own allowlisted phone.
    if (live) {
      const phone = env("SEND_ALLOWLIST").split(",").map((s) => s.trim()).find((s) => s.startsWith("+"));
      if (!phone) throw new Error("SEND_ALLOWLIST has no phone number");
      const me = await customer("there", phone, true);
      const liveBatch = crypto.randomUUID();
      await db.from("actions").insert(action(liveBatch, me));
      console.log("      live executor:", JSON.stringify(await runExecutor(liveBatch)));
      const { data: liveRow } = await db.from("actions").select("status, result").eq("batch_id", liveBatch).single();
      check("real call placed through Vapi", liveRow?.status === "executed" && !!(liveRow.result as any)?.vapi_call_id, String((liveRow?.result as any)?.error ?? ""));
      console.log(`      Your phone ending ${phone.slice(-4)} should ring now. The call appears in /admin.`);
    }
  } finally {
    await db.from("actions").delete().in("customer_id", made);
    await db.from("customers").delete().in("id", made);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
