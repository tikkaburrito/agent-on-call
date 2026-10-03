// M1 acceptance + QA 14.1 (RLS): npx tsx scripts/m1-db.ts
import { admin, anon, check, finish, SITE_A, SITE_B } from "./_env";

const TABLES = ["profiles", "businesses", "sites", "customers", "orders", "actions", "site_builds", "calls", "call_events", "stripe_events"];

async function main() {
  const db = admin();

  // 1. needs_attention returns all three kinds for the seeded site.
  const { data: items, error } = await db.rpc("needs_attention", { p_site_id: SITE_A, p_minutes: 2 });
  const kinds = new Set((items ?? []).map((r: { kind: string }) => r.kind));
  check("needs_attention returns welcome_pending", kinds.has("welcome_pending"), error?.message);
  check("needs_attention returns unpaid", kinds.has("unpaid"));
  check("needs_attention returns dropped_off", kinds.has("dropped_off"));

  const { data: found } = await db.rpc("find_customers", { p_site_id: SITE_A, p_query: "sofia", p_segment: "all" });
  check("find_customers matches by name", found?.length === 1 && found[0].state === "unpaid");

  // 2. Anonymous client reads nothing from any table.
  for (const t of TABLES) {
    const { data, error } = await anon().from(t).select("*").limit(5);
    check(`anon reads 0 rows from ${t}`, (data ?? []).length === 0, error ? "denied" : "empty");
  }
  const anonRpc = await anon().rpc("needs_attention", { p_site_id: SITE_A });
  check("anon cannot call needs_attention", (anonRpc.data ?? []).length === 0, anonRpc.error ? "denied" : "empty");

  // 3. Owner-scoped select: owner A sees site A only, owner B sees site B only.
  const stamp = Date.now();
  const password = `Test-${stamp}-${Math.random().toString(36).slice(2)}`;
  const users: string[] = [];
  const { data: before } = await db.from("businesses").select("id, owner_id").in("id", [SITE_A, SITE_B]);
  try {
    const mk = async (label: string, siteId: string) => {
      const email = `qa-${label}-${stamp}@example.com`;
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      users.push(data.user.id);
      await db.from("businesses").update({ owner_id: data.user.id }).eq("id", siteId);
      const client = anon();
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
      return client;
    };
    const a = await mk("a", SITE_A);
    const b = await mk("b", SITE_B);

    const aSites = await a.from("sites").select("id");
    check(
      "owner A sees exactly their business's projects",
      aSites.data?.length === 2 && aSites.data.every((r) => r.id !== SITE_B),
      `${aSites.data?.length} projects`,
    );
    const aBusinesses = await a.from("businesses").select("id");
    check("owner A sees exactly their business", aBusinesses.data?.length === 1 && aBusinesses.data[0].id === SITE_A);
    const aCustomers = await a.from("customers").select("site_id");
    check(
      "owner A reads own customers only",
      (aCustomers.data?.length ?? 0) >= 19 && aCustomers.data!.every((r) => r.site_id !== SITE_B),
      `${aCustomers.data?.length} rows`,
    );
    const aOrdersB = await a.from("orders").select("id").eq("site_id", SITE_B);
    check("owner A reads 0 of owner B's orders", (aOrdersB.data ?? []).length === 0);
    const aRpcB = await a.rpc("needs_attention", { p_site_id: SITE_B });
    check("owner A gets nothing from needs_attention(site B)", (aRpcB.data ?? []).length === 0);
    const aWrite = await a.from("customers").update({ name: "hacked" }).eq("site_id", SITE_A).select("id");
    check("owner A cannot write customers", (aWrite.data ?? []).length === 0);

    const bCustomers = await b.from("customers").select("site_id");
    check(
      "owner B reads own customers only",
      (bCustomers.data?.length ?? 0) >= 2 && bCustomers.data!.every((r) => r.site_id === SITE_B),
      `${bCustomers.data?.length} rows`,
    );
  } finally {
    for (const row of before ?? []) await db.from("businesses").update({ owner_id: row.owner_id }).eq("id", row.id);
    for (const id of users) await db.auth.admin.deleteUser(id);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
