import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { DEMO_SITE_ID } from "@/lib/types";

// First login: if the signed-in user's email is OWNER_EMAIL, link the seeded
// site to that user. The user is verified with Supabase Auth, and the write
// uses the service key on the server.
export async function POST() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) return Response.json({ claimed: false }, { status: 401 });

  const ownerEmail = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!ownerEmail || user.email.toLowerCase() !== ownerEmail) return Response.json({ claimed: false });

  const { error } = await supabaseAdmin().from("sites").update({ owner_id: user.id }).eq("id", DEMO_SITE_ID);
  return Response.json({ claimed: !error });
}
