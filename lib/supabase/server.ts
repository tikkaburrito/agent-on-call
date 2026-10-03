import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cookie-bound client for the signed-in owner. RLS applies.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component: cookies are read-only there.
          }
        },
      },
    },
  );
}
