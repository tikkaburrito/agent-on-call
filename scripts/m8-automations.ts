// Automations: npx tsx scripts/m8-automations.ts
// Uses the Harbor Coffee demo project (fake customers, so sends are simulated).
// Checks: nothing happens while rules are off; a rule that is on creates one
// action per matching customer; a second run creates no duplicates.
import { admin, check, finish, FUNCTIONS_URL, SITE_A, SITE_B } from "./_env";

const run = async () => (await fetch(`${FUNCTIONS_URL}/automations`, { method: "POST", body: "{}" })).json();

async function main() {
  const db = admin();
  const autoActions = async (siteId: string) =>
    (await db.from("actions").select("id, type, status, customer_id, payload, result").eq("site_id", siteId).eq("source", "automation")).data ?? [];
  const setRule = (kind: string, enabled: boolean, delay = 60) =>
    db.from("automations").upsert({ site_id: SITE_B, kind, enabled, delay_minutes: delay }, { onConflict: "site_id,kind" });

  try {
    await db.from("actions").delete().eq("site_id", SITE_B).eq("source", "automation");
    await db.from("automations").delete().eq("site_id", SITE_B);

    await run();
    check("no rules on -> nothing is sent", (await autoActions(SITE_B)).length === 0);

    await setRule("welcome_new_signups", true);
    await setRule("remind_unpaid", true, 60);
    const first = await run();
    console.log("      first run:", JSON.stringify(first));
    const afterFirst = await autoActions(SITE_B);
    const welcomes = afterFirst.filter((a) => (a.payload as any).automation === "welcome_new_signups");
    const reminders = afterFirst.filter((a) => (a.payload as any).automation === "remind_unpaid");
    check("auto-welcome: one email per signup not yet welcomed", welcomes.length === 1 && welcomes[0].type === "email", `${welcomes.length} actions`);
    check("auto-remind: one email per customer with an old unpaid order", reminders.length === 1, `${reminders.length} actions`);
    check("reminder carries the page link", /https?:\/\//.test(String((reminders[0]?.payload as any)?.body ?? "")));
    check(
      "demo customers are simulated, nothing really sent",
      afterFirst.length > 0 && afterFirst.every((a) => a.status === "simulated" && (a.result as any)?.would_send),
      afterFirst.map((a) => a.status).join(","),
    );

    await run();
    check("second run creates no duplicates", (await autoActions(SITE_B)).length === afterFirst.length);
    check("a project with automations off is untouched", (await autoActions(SITE_A)).length === 0);

    await setRule("welcome_new_signups", false);
    await db.from("actions").delete().eq("site_id", SITE_B).eq("source", "automation");
    await run();
    const afterOff = await autoActions(SITE_B);
    check("switching a rule off stops it", afterOff.every((a) => (a.payload as any).automation !== "welcome_new_signups"));
  } finally {
    await db.from("actions").delete().eq("site_id", SITE_B).eq("source", "automation");
    await db.from("automations").delete().eq("site_id", SITE_B);
  }
  finish();
}

main().catch((e) => {
  console.error("ERROR", e.message ?? e);
  process.exit(1);
});
