// Gives a user access to the admin console (/admin):
//   npx tsx scripts/make-admin.ts <username> [--revoke]
import { admin } from "./_env";

async function main() {
  const username = process.argv[2];
  if (!username) throw new Error("usage: npx tsx scripts/make-admin.ts <username> [--revoke]");
  const isAdmin = !process.argv.includes("--revoke");
  const { data, error } = await admin().from("profiles").update({ is_admin: isAdmin }).eq("username", username).select("username");
  if (error) throw error;
  if (!data?.length) throw new Error(`No user named ${username}`);
  console.log(`${username} is ${isAdmin ? "now" : "no longer"} an admin.`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
