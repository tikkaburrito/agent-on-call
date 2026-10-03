// Builds and deploys a landing page for a site, then sends the owner the link.
// Called by the build_landing_page tool with the service key. Answers 202 at
// once and finishes in the background so the phone call never waits on it.
import { isAllowed } from "../_shared/allowlist.ts";
import { db, isInternalCall, keepAlive, type Site, SITE_COLUMNS } from "../_shared/db.ts";
import { draftLanding, renderLanding } from "../_shared/landing.ts";
import { sendSms } from "../_shared/send.ts";
import { deployStatic } from "../_shared/vercel.ts";

// Texts the link to the business owner's phone (from their profile).
async function notifyOwner(site: Site, url: string) {
  const notified: Record<string, unknown> = {};
  const { data: business } = await db.from("businesses").select("owner_id").eq("id", site.business_id).maybeSingle();
  const { data: owner } = business?.owner_id
    ? await db.from("profiles").select("phone").eq("id", business.owner_id).maybeSingle()
    : { data: null };
  const phone: string | null = owner?.phone ?? null;
  if (!phone) {
    notified.sms = "skipped: the owner has no phone on their profile";
  } else if (!isAllowed(phone)) {
    notified.sms = "simulated: owner phone not on allowlist";
  } else {
    try {
      notified.sms_sid = (await sendSms({ to: phone, body: `${site.name}: your landing page is live. ${url}` })).sid;
    } catch (e) {
      notified.sms_error = (e as Error).message;
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
    const { data } = await db.from("sites").select(SITE_COLUMNS).eq("id", row.site_id).single();
    if (!data) throw new Error("site not found");
    const site = data as unknown as Site;

    const appUrl = Deno.env.get("NEXT_PUBLIC_SITE_URL");
    if (!appUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not configured");

    const { copy, source } = await draftLanding(site, intent);
    const html = renderLanding(site, copy, appUrl.replace(/\/$/, ""));
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
