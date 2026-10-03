// M6/M7 acceptance: the owner's Realtime stream receives action changes with
// no refresh, and a second signed-in user receives nothing and reads nothing.
//   npx tsx scripts/m7-realtime.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, anon, check, finish, SITE_A } from "./_env";

const SEEDED = "a0000000-0000-4000-8000-000000000005"; // Ava Johnson
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listen(client: SupabaseClient, label: string) {
  const events: string[] = [];
  const channel = client.channel(`qa-${label}`).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "actions", filter: `site_id=eq.${SITE_A}` },
    (payload) => events.push(`${payload.eventType}:${(payload.new as { status?: string })?.status ?? ""}`),
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: realtime subscribe timed out`)), 15_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return events;
}

async function main() {
  const db = admin();
  const stamp = Date.now();
  const password = `Test-${stamp}-${Math.random().toString(36).slice(2)}`;
  const users: string[] = [];
  const { data: before } = await db.from("businesses").select("owner_id").eq("id", SITE_A).single();
  const batchId = crypto.randomUUID();

  const signIn = async (label: string) => {
    const email = `qa-rt-${label}-${stamp}@example.com`;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const client = anon();
    const res = await client.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error;
    await client.realtime.setAuth(res.data.session!.access_token);
    return { client, id: data.user.id };
  };

  try {
    const owner = await signIn("owner");
    const stranger = await signIn("stranger");
    await db.from("businesses").update({ owner_id: owner.id }).eq("id", SITE_A);

    const ownerEvents = await listen(owner.client, "owner");
    const strangerEvents = await listen(stranger.client, "stranger");
    await sleep(1500);

    const { data: action } = await db
      .from("actions")
      .insert({ site_id: SITE_A, batch_id: batchId, type: "email", customer_id: SEEDED, source: "test", payload: { subject: "QA", body: "Realtime test" } })
      .select("id")
      .single();
    await sleep(1200);
    await db.from("actions").update({ status: "cancelled" }).eq("id", action!.id);
    await sleep(3000);

    console.log("      owner events:", ownerEvents.join(", ") || "none");
    check("owner receives the insert over Realtime", ownerEvents.includes("INSERT:proposed"));
    check("owner receives the status change over Realtime", ownerEvents.includes("UPDATE:cancelled"));
    check("second user receives nothing", strangerEvents.length === 0, `${strangerEvents.length} events`);

    for (const table of ["profiles", "businesses", "sites", "customers", "orders", "actions", "site_builds"]) {
      const { data } = await stranger.client.from(table).select("*").limit(5);
      check(`second user reads 0 rows from ${table}`, (data ?? []).length === 0);
    }
  } finally {
    await db.from("actions").delete().eq("batch_id", batchId);
    await db.from("businesses").update({ owner_id: before?.owner_id ?? null }).eq("id", SITE_A);
    for (const id of users) await db.auth.admin.deleteUser(id);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
