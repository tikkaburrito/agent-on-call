# M2 manual check: booking → Stripe Checkout → paid

Automated half: `npx tsx scripts/m2-webhook.ts` (signature, paid flip, replay).

Manual half, on the deployed site:

1. Open the booking site (`NEXT_PUBLIC_SITE_URL`). Fill in name, email, phone, tick consent, submit.
2. You land on Stripe Checkout (test mode). In Supabase → Table editor:
   - `customers` has a new row for you.
   - `orders` has a new row with `status = pending` and a `stripe_checkout_session_id`.
3. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. You land on `/success`. Within a few seconds the order row shows `status = paid` and `paid_at` set
   (the `stripe-webhook` function handled `checkout.session.completed`).
5. Replay: Stripe Dashboard (test mode) → Developers → Webhooks → the endpoint → the event → **Resend**.
   The function answers `{"received":true,"duplicate":true}` and `paid_at` does not change.
6. Abandon path (the demo path): submit the form again and close the Stripe page.
   After `ATTENTION_MINUTES` the customer shows up as `unpaid` when you call the agent.
