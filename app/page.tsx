import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_SITE_ID, dollars } from "@/lib/types";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data: site } = await supabaseAdmin()
    .from("sites")
    .select("id, name, product_name, price_cents")
    .eq("id", DEMO_SITE_ID)
    .maybeSingle();

  if (!site) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-stone-600">
        This site is not set up yet.
      </main>
    );
  }

  const price = dollars(site.price_cents);

  return (
    <main className="flex-1 bg-amber-50 text-stone-900">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-24">
        <section>
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-800">{site.name}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-balance md:text-5xl">
            Start your mornings on the mat.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-stone-700">
            The {site.product_name.toLowerCase()} gets you three beginner-friendly classes with our
            teachers. Come as you are; mats are provided.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-base text-stone-700">
            <li>Three classes, any time in your first month</li>
            <li>Small groups, never more than twelve</li>
            <li>Full refund if the first class isn&rsquo;t for you</li>
          </ul>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200 md:p-8">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold">{site.product_name}</h2>
            <p className="text-3xl font-semibold tabular-nums">{price}</p>
          </div>
          <BookingForm siteId={site.id} cta={`Book for ${price}`} />
          <p className="mt-4 text-center text-xs text-stone-500">
            Secure checkout by Stripe. Demo site: payments run in test mode.
          </p>
        </section>
      </div>
    </main>
  );
}
