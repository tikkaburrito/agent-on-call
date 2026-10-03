import { supabaseAdmin } from "@/lib/supabase/admin";
import { createProject, parsePriceCents } from "@/lib/projects";
import { supabaseServer } from "@/lib/supabase/server";

// First run after signup: creates the user's business and its first project.
// One business per user for now.
export async function POST(request: Request) {
  const { data } = await (await supabaseServer()).auth.getUser();
  const user = data.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const businessName = typeof body?.business_name === "string" ? body.business_name.trim().slice(0, 80) : "";
  const productName = typeof body?.product_name === "string" ? body.product_name.trim().slice(0, 80) : "";
  const priceCents = parsePriceCents(body?.price);
  if (!businessName) return Response.json({ error: "Enter your business name." }, { status: 400 });
  if (!productName) return Response.json({ error: "Enter what you sell." }, { status: 400 });
  if (!priceCents) return Response.json({ error: "Enter a price between $1 and $10,000." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: existing } = await db.from("businesses").select("id").eq("owner_id", user.id).limit(1);
  if (existing?.length) return Response.json({ error: "You already have a business." }, { status: 409 });

  const { data: business, error } = await db
    .from("businesses")
    .insert({ owner_id: user.id, name: businessName })
    .select("id, name")
    .single();
  if (error) return Response.json({ error: "Could not create the business." }, { status: 500 });

  try {
    const project = await createProject(db, business, productName, priceCents);
    return Response.json({ business_id: business.id, project_id: project.id });
  } catch {
    await db.from("businesses").delete().eq("id", business.id);
    return Response.json({ error: "Could not create the project." }, { status: 500 });
  }
}
