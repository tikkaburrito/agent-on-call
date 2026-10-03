import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Success({ searchParams }: PageProps<"/success">) {
  const { site: siteId } = await searchParams;
  const { data: site } =
    typeof siteId === "string" && /^[0-9a-f-]{36}$/i.test(siteId)
      ? await supabaseAdmin().from("sites").select("name, product_name").eq("id", siteId).maybeSingle()
      : { data: null };

  return (
    <main className="flex flex-1 items-center justify-center bg-amber-50 px-5 py-16 text-stone-900">
      <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-stone-200">
        <h1 className="text-3xl font-semibold tracking-tight">You&rsquo;re booked.</h1>
        <p className="mt-4 text-lg leading-relaxed text-stone-700">
          {site
            ? `Thanks for booking the ${site.product_name.toLowerCase()} with ${site.name}. A confirmation is on its way.`
            : "Thanks for your booking. A confirmation is on its way."}
        </p>
      </div>
    </main>
  );
}
