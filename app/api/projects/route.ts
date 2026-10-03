import { supabaseAdmin } from "@/lib/supabase/admin";
import { createProject, parsePriceCents } from "@/lib/projects";
import { supabaseServer } from "@/lib/supabase/server";

// Adds a project under the signed-in user's business.
export async function POST(request: Request) {
  const { data } = await (await supabaseServer()).auth.getUser();
  const user = data.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const productName = typeof body?.product_name === "string" ? body.product_name.trim().slice(0, 80) : "";
  const priceCents = parsePriceCents(body?.price);
  if (!productName) return Response.json({ error: "Enter what this project sells." }, { status: 400 });
  if (!priceCents) return Response.json({ error: "Enter a price between $1 and $10,000." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: business } = await db
    .from("businesses")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return Response.json({ error: "Create your business first." }, { status: 400 });

  const { count } = await db.from("sites").select("*", { count: "exact", head: true }).eq("business_id", business.id);
  if ((count ?? 0) >= 10) return Response.json({ error: "A business can have up to 10 projects." }, { status: 400 });

  try {
    const project = await createProject(db, business, productName, priceCents);
    return Response.json({ project_id: project.id });
  } catch {
    return Response.json({ error: "Could not create the project." }, { status: 500 });
  }
}
