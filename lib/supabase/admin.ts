import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client. Server code only: route handlers and server components.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
