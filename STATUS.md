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
| 2 | Booking site, checkout, Stripe webhook | code done, **blocked on Stripe key + Vercel token** | page renders locally; `scripts/m2-webhook.ts` ready |
| 3 | Executor, send helpers, allowlist | code deployed, **real-send test blocked on keys** | simulated path verified through `m4-tools.sh` (9 simulated, 0 external calls) |
| 4 | Tools + `vapi-tools` | done | `scripts/m4-tools.sh`: 23/23 pass, slowest call 2.7 s |
| 5 | Vapi assistant | code done, **blocked on VAPI_API_KEY** | `vapi/assistant.json`, `vapi/setup.ts` |
| 6 | Site builder (landing page deploy + SMS) | code deployed, **blocked on VERCEL_TOKEN** | `scripts/m6-builder.ts` ready |
| 7 | Dashboard | done locally | OTP login + dashboard verified in browser; `scripts/m7-realtime.ts`: 8/8 pass |
| 8 | QA, README, production deploy | README done; rest blocked on keys | |

## MANUAL (things only you can do)

- [ ] MANUAL: fill these in `.env.local` (nothing external can be tested until they exist):
  - `ANTHROPIC_API_KEY`
  - `STRIPE_SECRET_KEY` (test mode, `sk_test_...`)
  - `RESEND_API_KEY`, `RESEND_FROM` (your Resend account has `tikkaburrito.com` verified, so e.g. `Agent on Call <agent@tikkaburrito.com>`)
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (E.164)
  - `VAPI_API_KEY` (private key)
  - `VERCEL_TOKEN` (vercel.com/account/tokens, full account scope); `VERCEL_TEAM_ID` only if the token should deploy into a team
  - `OWNER_PHONE` (E.164, the phone you will call from), `OWNER_EMAIL`
  - `SEND_ALLOWLIST` (comma-separated emails and E.164 phones that may receive real sends; include your own)
- [ ] MANUAL: make sure a phone number exists in your Vapi account. `npx tsx vapi/setup.ts --attach` attaches it if there is exactly one.
- [ ] MANUAL: confirm your Twilio number can text US mobiles (trial accounts only reach verified numbers).

## Notes

- The Supabase project is on the free tier (template changes were refused without custom SMTP), so it is not billed.
- Supabase's built-in mailer cannot send the 6-digit code template. `scripts/push-auth-config.sh` switches auth email to Resend SMTP once the Resend key is in place. Until then, `npx tsx scripts/dev-login-code.ts <email>` prints a sign-in code.
- A QA user (`qa-dashboard@example.com`) currently owns the seeded site for dashboard testing. The real owner takes over on first login as `OWNER_EMAIL`.

## Divergences from the spec (agreed)

- Site builder in scope: `build_landing_page` tool deploys a landing page as its own Vercel project and texts the link.
- Extra segment `welcome_pending` (not yet welcomed) alongside `all | new_today | unpaid | dropped_off`.
- `needs_attention` takes `p_minutes` (from `ATTENTION_MINUTES`) because SQL cannot read edge function env.
- No milestone stop-and-wait; progress is logged here instead.

## QA

_Filled in at M8._
