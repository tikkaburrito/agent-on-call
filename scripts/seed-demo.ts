// Creates the demo users and links them to the seeded businesses:
//   npx tsx scripts/seed-demo.ts
//   sunrise -> Sunrise Yoga Studio (2 projects), phone = OWNER_PHONE if set
//   harbor  -> Harbor Coffee Roasters (1 project)
// Both sign in with the password stored as DEMO_PASSWORD in .env.local
// (generated on first run, never printed). Safe to re-run.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { usernameToEmail } from "../lib/auth";
import { admin, SITE_A, SITE_B } from "./_env";

const DEMO = [
  { username: "sunrise", full_name: "Dana Brooks", phone: process.env.OWNER_PHONE || "+15555550001", business: SITE_A },
  { username: "harbor", full_name: "Sam Ortiz", phone: "+15555550002", business: SITE_B },
];

async function main() {
  const db = admin();
  let password = process.env.DEMO_PASSWORD;
  if (!password) {
    password = randomBytes(9).toString("base64url");
    appendFileSync(".env.local", `\n# Password for the demo users (sunrise, harbor)\nDEMO_PASSWORD=${password}\n`);
    console.log("Generated DEMO_PASSWORD and saved it to .env.local.");
  }

  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  // Leftover test users from earlier QA runs.
  for (const u of list.users.filter((u) => /^qa-/.test(u.email ?? ""))) await db.auth.admin.deleteUser(u.id);

  for (const demo of DEMO) {
    const email = usernameToEmail(demo.username);
    let user = list.users.find((u) => u.email === email);
    if (user) {
      await db.auth.admin.updateUserById(user.id, { password });
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: demo.username, full_name: demo.full_name },
      });
      if (error) throw error;
      user = data.user;
    }
    // Free the phone if another profile holds it, then upsert this profile.
    await db.from("profiles").update({ phone: null }).eq("phone", demo.phone).neq("id", user.id);
    const { error: profileError } = await db
      .from("profiles")
      .upsert({ id: user.id, username: demo.username, full_name: demo.full_name, phone: demo.phone });
    if (profileError) throw profileError;
    const { error: ownerError } = await db.from("businesses").update({ owner_id: user.id }).eq("id", demo.business);
    if (ownerError) throw ownerError;
    console.log(`user "${demo.username}" (${demo.full_name}) owns business ${demo.business}, caller ID ends ${demo.phone.slice(-4)}`);
  }

  const count = async (table: string) => (await db.from(table).select("*", { count: "exact", head: true })).count;
  console.log(
    `Data: ${await count("businesses")} businesses, ${await count("sites")} projects, ${await count("customers")} customers, ${await count("orders")} orders.`,
  );
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
