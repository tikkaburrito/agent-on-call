# STATUS

## URLs

- Supabase project: https://supabase.com/dashboard/project/ckwsgvgledkgkuwzbrrd (`agent-on-call`, us-east-1, fulsuccessai-spec's Org)
- Functions base: https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1
- Web app (Vercel, production): https://agent-on-call.vercel.app (project `agent-on-call`, team `tikka-burrito`; pushes to `main` auto-deploy)
- Dashboard: https://agent-on-call.vercel.app/dashboard · Login: https://agent-on-call.vercel.app/login
- GitHub (public): https://github.com/tikkaburrito/agent-on-call

## Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Scaffold, Supabase project, env skeleton | done | Next.js 16.3.8, project `ckwsgvgledkgkuwzbrrd` linked |
| 1 | Schema, RLS, Realtime, seed, `health` | done | `scripts/m1-db.ts`: all pass; 2 businesses, 3 projects, 23 customers, 18 orders seeded |
| 2 | Booking site, checkout, Stripe webhook | deployed; **checkout blocked on Stripe key** | https://agent-on-call.vercel.app renders the seeded site; `scripts/m2-webhook.ts` ready |
| 3 | Executor, send helpers, allowlist | code deployed, **real-send test blocked on keys** | simulated path verified through `m4-tools.sh` (9 simulated, 0 external calls) |
| 4 | Tools + `vapi-tools` | done | `scripts/m4-tools.sh`: 28/28 pass (incl. caller → user → business → projects), slowest call 2.5 s |
| 5 | Vapi assistant | code done, **blocked on VAPI_API_KEY** | `vapi/assistant.json`, `vapi/setup.ts` |
| 6 | Site builder (landing page deploy + SMS) | code deployed, **blocked on VERCEL_TOKEN** | `scripts/m6-builder.ts` ready |
| 7 | Dashboard | deployed | signup → add business → dashboard → new project verified in browser; `scripts/m7-realtime.ts`: 10/10 pass |
| 8 | QA, README, production deploy | README done; rest blocked on keys | |

## MANUAL (things only you can do)

Everything below is "paste a value into `.env.local`", then run `bash scripts/go-live.sh` once.
Nothing in Vapi, Stripe, Twilio or Resend needs to be configured by hand beyond getting the key.

| Line in `.env.local` | Where to get it | What it turns on |
|---|---|---|
| `STRIPE_SECRET_KEY=sk_test_...` | dashboard.stripe.com → switch to **Test mode** → Developers → API keys → Secret key | Checkout on every signup page, invoices from the agent |
| `VAPI_API_KEY=...` | dashboard.vapi.ai → your org → API Keys → **Private** key | The voice agent: `go-live.sh` creates the 6 tools and the assistant and attaches your number |
| (in Vapi) one phone number | dashboard.vapi.ai → Phone Numbers → Create (a free Vapi number is fine) | The number you call |
| `ANTHROPIC_API_KEY=sk-ant-...` | console.anthropic.com → API keys | Drafted email/text copy and landing page copy (templates are used without it) |
| `RESEND_API_KEY=re_...` and `RESEND_FROM=Agent on Call <agent@tikkaburrito.com>` | resend.com → API Keys (`tikkaburrito.com` is already verified there) | Real emails |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM=+1...` | console.twilio.com → Account info; Phone Numbers → your number | Real texts |
| `VERCEL_TOKEN=...` | vercel.com/account/tokens → Create | The agent's landing-page builder (`VERCEL_TEAM_ID` is already filled in) |
| `SEND_ALLOWLIST=you@example.com,+1XXXXXXXXXX` | your own email and mobile, comma-separated | Who may receive real sends; everyone else is "simulated" |
| `NEXT_PUBLIC_AGENT_PHONE=+1...` (optional) | the Vapi number | Shows "Call ..." on the home page |

About Vapi and Supabase: Vapi's own "Supabase" integration is for storing call recordings. It does not let the assistant read the database. The assistant reads data only by calling our `vapi-tools` function with the `x-vapi-secret` header, which `vapi/setup.ts` configures. Tools created by hand in the Vapi dashboard without that header get `401` and see nothing.

## Notes

- The Supabase project is on the free tier, so it is not billed.
- Login is username + password. Demo users: `sunrise` (Sunrise Yoga Studio, 2 projects) and `harbor` (Harbor Coffee Roasters). Their password is `DEMO_PASSWORD` in `.env.local`.
- The demo owner's caller ID is `OWNER_PHONE` if set (re-run `bash scripts/seed.sh` after setting it), otherwise a placeholder. Or sign up with your own number and business.
- Google login is not built: it needs OAuth client credentials from Google Cloud added to Supabase Auth.

## Divergences from the spec (agreed)

- Site builder in scope: `build_landing_page` tool deploys a landing page as its own Vercel project and texts the link.
- Extra segment `welcome_pending` (not yet welcomed) alongside `all | new_today | unpaid | dropped_off`.
- `needs_attention` takes `p_minutes` (from `ATTENTION_MINUTES`) because SQL cannot read edge function env.
- No milestone stop-and-wait; progress is logged here instead.
- Users → businesses → projects: `profiles` and `businesses` tables added; `sites` rows are the projects under a business. The caller is recognised by `profiles.phone`, not a phone on the site.
- Login is username + password instead of email OTP; the `OWNER_EMAIL` claim step is gone. New users sign up and add their own business.
- `/` is now the product home page with the live demo business; each project's signup page is at `/s/<slug>`.

## QA

_Filled in at M8._
