import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const mask = (phone: string | null) => (phone ? `•••${phone.slice(-4)}` : null);

// Everything the admin console shows: recent calls with their transcript, tool
// calls and resulting actions, plus every user, business and project.
// Signed-in admins only; phone numbers are masked to the last four digits.
export async function GET() {
  const { data } = await (await supabaseServer()).auth.getUser();
  if (!data.user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const db = supabaseAdmin();
  const { data: me } = await db.from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  if (!me?.is_admin) return Response.json({ error: "Admins only." }, { status: 403 });

  const { data: calls } = await db
    .from("calls")
    .select("id, business_id, caller_phone, type, status, ended_reason, summary, recording_url, started_at, ended_at")
    .order("started_at", { ascending: false })
    .limit(30);
  const callIds = (calls ?? []).map((c) => c.id);

  const [events, actions, builds, businesses, profiles] = await Promise.all([
    callIds.length
      ? db.from("call_events").select("id, call_id, at, kind, role, text, data").in("call_id", callIds).order("at").order("id")
      : Promise.resolve({ data: [] }),
    callIds.length
      ? db
          .from("actions")
          .select("id, call_id, batch_id, type, status, payload, result, created_at, executed_at, customers(name, email)")
          .in("call_id", callIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    callIds.length
      ? db.from("site_builds").select("id, call_id, status, url, error, created_at, finished_at").in("call_id", callIds).order("created_at")
      : Promise.resolve({ data: [] }),
    db
      .from("businesses")
      .select("id, name, owner_id, created_at, sites(id, slug, product_name, price_cents, discount_percent, landing_url, created_at)")
      .order("created_at"),
    db.from("profiles").select("id, username, full_name, phone, is_admin"),
  ]);

  const owners = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const names = new Map((businesses.data ?? []).map((b) => [b.id, b.name]));

  const siteIds = (businesses.data ?? []).flatMap((b) => (b.sites ?? []).map((s) => s.id));
  const { data: customerRows } = siteIds.length
    ? await db.from("customers").select("site_id").in("site_id", siteIds)
    : { data: [] };
  const customerCount = new Map<string, number>();
  for (const row of customerRows ?? []) customerCount.set(row.site_id, (customerCount.get(row.site_id) ?? 0) + 1);

  return Response.json({
    calls: (calls ?? []).map((c) => ({
      ...c,
      caller_phone: mask(c.caller_phone),
      business: c.business_id ? names.get(c.business_id) ?? null : null,
      events: (events.data ?? []).filter((e) => e.call_id === c.id),
      actions: (actions.data ?? []).filter((a) => a.call_id === c.id),
      builds: (builds.data ?? []).filter((b) => b.call_id === c.id),
    })),
    businesses: (businesses.data ?? []).map((b) => {
      const owner = b.owner_id ? owners.get(b.owner_id) : null;
      return {
        id: b.id,
        name: b.name,
        owner: owner ? { username: owner.username, full_name: owner.full_name, phone: mask(owner.phone), is_admin: owner.is_admin } : null,
        projects: [...(b.sites ?? [])]
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
          .map((s) => ({ ...s, customers: customerCount.get(s.id) ?? 0 })),
      };
    }),
  });
}
