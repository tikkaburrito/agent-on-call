import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dollars } from "@/lib/types";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

// Public page for one project: signup form plus Stripe Checkout.
export default async function ProjectPage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const { data: site } = await supabaseAdmin()
    .from("sites")
    .select("id, name, product_name, price_cents, headline, subhead")
    .eq("slug", slug)
    .maybeSingle();
  if (!site) notFound();

  const price = dollars(site.price_cents);

  return (
    <main className="flex-1 bg-amber-50 text-stone-900">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-24">
        <section>
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-800">{site.name}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-balance md:text-5xl">
            {site.headline ?? `${site.product_name} at ${site.name}`}
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-stone-700">
            {site.subhead ?? "Sign up below in under a minute. We'll take it from there."}
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-base text-stone-700">
            <li>Book online in under a minute</li>
            <li>Secure checkout by Stripe</li>
            <li>Questions? Just reply to our emails</li>
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
      <p className="pb-8 text-center text-xs text-stone-500">
        Follow-up handled by{" "}
        <Link href="/" className="underline underline-offset-2">
          Agent on Call
        </Link>
      </p>
    </main>
  );
}
