# STATUS

## URLs

- Supabase project: https://supabase.com/dashboard/project/ckwsgvgledkgkuwzbrrd (`agent-on-call`, us-east-1, fulsuccessai-spec's Org)
- Functions base: https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1
- Web app (Vercel): _not deployed yet_

## Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Scaffold, Supabase project, env skeleton | done | Next.js 16.3.8, project `ckwsgvgledkgkuwzbrrd` linked |
| 1 | Schema, RLS, Realtime, seed, `health` | done | `scripts/m1-db.ts`: 17/17 pass |
| 2 | Booking site, checkout, Stripe webhook | in progress | |
| 3 | Executor, send helpers, allowlist | pending | |
| 4 | Tools + `vapi-tools` | pending | |
| 5 | Vapi assistant | pending | |
| 6 | Site builder (landing page deploy + SMS) | pending | |
| 7 | Dashboard | pending | |
| 8 | QA, README, production deploy | pending | |

## MANUAL (things only you can do)

- [ ] MANUAL: fill these keys in `.env.local`: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY` (sk_test), `RESEND_API_KEY`, `RESEND_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `VAPI_API_KEY`, `VERCEL_TOKEN` (vercel.com/account/tokens), `OWNER_PHONE` (E.164), `OWNER_EMAIL`, `SEND_ALLOWLIST` (comma-separated emails and E.164 phones).
- [ ] MANUAL: after `vapi/setup.ts` runs, attach your Vapi phone number to the printed assistant in the Vapi dashboard (Phone Numbers → Inbound → Assistant).

## Divergences from the spec (agreed)

- Site builder in scope: `build_landing_page` tool deploys a landing page as its own Vercel project and texts the link.
- Extra segment `welcome_pending` (not yet welcomed) alongside `all | new_today | unpaid | dropped_off`.
- `needs_attention` takes `p_minutes` (from `ATTENTION_MINUTES`) because SQL cannot read edge function env.
- No milestone stop-and-wait; progress is logged here instead.

## QA

_Filled in at M8._
