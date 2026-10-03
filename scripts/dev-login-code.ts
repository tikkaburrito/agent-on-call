// Dev/demo fallback: prints a one-time sign-in code for an email, without
// sending mail. With --own, also links the seeded site to that user.
//   npx tsx scripts/dev-login-code.ts owner@example.com [--own]
import { admin, SITE_A } from "./_env";

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: npx tsx scripts/dev-login-code.ts <email> [--own]");
  const db = admin();
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  if (process.argv.includes("--own")) {
    await db.from("sites").update({ owner_id: data.user.id }).eq("id", SITE_A);
    console.log("Seeded site linked to this user.");
  }
  console.log(`One-time code for ${email}: ${data.properties.email_otp}`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
