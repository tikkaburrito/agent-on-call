// Removes a user and everything under them (business, projects, customers,
// orders, actions): npx tsx scripts/delete-user.ts <username>
import { usernameToEmail } from "../lib/auth";
import { admin } from "./_env";

async function main() {
  const username = process.argv[2];
  if (!username) throw new Error("usage: npx tsx scripts/delete-user.ts <username>");
  if (["sunrise", "harbor"].includes(username)) throw new Error("Refusing to delete a demo user.");
  const db = admin();
  const { data: profile } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const userId = profile?.id ?? list?.users.find((u) => u.email === usernameToEmail(username))?.id;
  if (!userId) throw new Error(`No user named ${username}`);

  const { data: businesses } = await db.from("businesses").select("id").eq("owner_id", userId);
  const businessIds = (businesses ?? []).map((b) => b.id);
  const { data: sites } = businessIds.length ? await db.from("sites").select("id").in("business_id", businessIds) : { data: [] };
  const siteIds = (sites ?? []).map((s) => s.id);
  if (siteIds.length) {
    for (const table of ["actions", "site_builds", "orders", "customers"]) await db.from(table).delete().in("site_id", siteIds);
    await db.from("sites").delete().in("id", siteIds);
  }
  if (businessIds.length) await db.from("businesses").delete().in("id", businessIds);
  await db.auth.admin.deleteUser(userId); // profile row cascades
  console.log(`Deleted user ${username}, ${businessIds.length} business(es), ${siteIds.length} project(s).`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
