// Points the seeded site at the real owner phone: npx tsx scripts/set-owner.ts
import { admin, env, SITE_A } from "./_env";

async function main() {
  const phone = env("OWNER_PHONE");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("OWNER_PHONE must be E.164, e.g. +14155551234");
  const { error } = await admin().from("sites").update({ owner_phone: phone }).eq("id", SITE_A);
  if (error) throw error;
  console.log(`Seeded site now answers to OWNER_PHONE (ends in ${phone.slice(-4)}).`);
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
