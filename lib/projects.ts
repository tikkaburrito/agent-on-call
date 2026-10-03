import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/auth";

export function parsePriceCents(raw: unknown): number | null {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  return cents >= 100 && cents <= 1_000_000 ? cents : null;
}

// Inserts a project (a `sites` row) under a business with a unique slug.
export async function createProject(
  db: SupabaseClient,
  business: { id: string; name: string },
  productName: string,
  priceCents: number,
) {
  const base = slugify(`${business.name} ${productName}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db
      .from("sites")
      .insert({ business_id: business.id, name: business.name, slug, product_name: productName, price_cents: priceCents })
      .select("id, slug")
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("could not find a free address for the project");
}
