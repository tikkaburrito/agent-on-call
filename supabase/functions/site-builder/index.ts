// Builds and deploys a landing page for a site, then sends the owner the link.
// Called by the build_landing_page tool with the service key. Answers 202 at
// once and finishes in the background so the phone call never waits on it.
import { isAllowed } from "../_shared/allowlist.ts";
import { db, isInternalCall, keepAlive, type Site } from "../_shared/db.ts";
import { draftLanding, renderLanding } from "../_shared/landing.ts";
import { sendEmail, sendSms } from "../_shared/send.ts";
import { deployStatic } from "../_shared/vercel.ts";

async function notifyOwner(site: Site & { owner_id: string | null }, url: string) {
  const notified: Record<string, unknown> = {};
  const text = `${site.name}: your landing page is live. ${url}`;

  if (isAllowed(site.owner_phone)) {
    try {
      notified.sms_sid = (await sendSms({ to: site.owner_phone, body: text })).sid;
    } catch (e) {
      notified.sms_error = (e as Error).message;
    }
  } else {
    notified.sms = "simulated: owner phone not on allowlist";
  }

  // Email as a second channel, in case the text is filtered by the carrier.
  if (site.owner_id) {
    const { data } = await db.auth.admin.getUserById(site.owner_id);
    const email = data?.user?.email;
    if (email && isAllowed(email)) {
      try {
        const sent = await sendEmail({
          to: email,
          subject: `Your ${site.name} landing page is live`,
          text: `Your landing page is deployed and ready to share:\n\n${url}\n\nSignups from it show up when you call Agent on Call.`,
        });
        notified.email_id = sent.id;
      } catch (e) {
        notified.email_error = (e as Error).message;
      }
    }
  }
  return notified;
}

async function build(buildId: string, intent: string) {
  const fail = (message: string) =>
    db.from("site_builds")
      .update({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", buildId);
  try {
    const { data: row } = await db.from("site_builds").select("id, site_id, status").eq("id", buildId).single();
    if (!row || row.status !== "building") return;
    const { data: site } = await db
      .from("sites")
      .select("id, owner_id, owner_phone, name, slug, product_name, price_cents, landing_url")
      .eq("id", row.site_id)
      .single();
    if (!site) throw new Error("site not found");

    const appUrl = Deno.env.get("NEXT_PUBLIC_SITE_URL");
    if (!appUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not configured");

    const { copy, source } = await draftLanding(site as Site, intent);
    const html = renderLanding(site as Site, copy, appUrl.replace(/\/$/, ""));
    const deployed = await deployStatic({ name: `aoc-${site.slug}`, html });

    await db.from("sites").update({ landing_url: deployed.url }).eq("id", site.id);
    const notified = await notifyOwner(site, deployed.url);
    await db
      .from("site_builds")
      .update({
        status: "live",
        url: deployed.url,
        vercel_deployment_id: deployed.deploymentId,
        copy: { ...copy, source, notified },
        finished_at: new Date().toISOString(),
      })
      .eq("id", buildId);
    console.log(`site-builder build=${buildId} live copy=${source}`);
  } catch (e) {
    console.error(`site-builder build=${buildId} failed:`, (e as Error).message);
    await fail((e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 }); // warm ping
  if (!isInternalCall(req)) return new Response("unauthorized", { status: 401 });

  const { build_id, intent } = await req.json().catch(() => ({}));
  if (typeof build_id !== "string") return Response.json({ error: "build_id required" }, { status: 400 });

  keepAlive(build(build_id, typeof intent === "string" ? intent : ""));
  return Response.json({ accepted: true }, { status: 202 });
});
