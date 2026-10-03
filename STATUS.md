# STATUS

## URLs

- Supabase project: https://supabase.com/dashboard/project/ckwsgvgledkgkuwzbrrd (`agent-on-call`, us-east-1, fulsuccessai-spec's Org)
- Functions base: https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1
- Agent phone number: +1 341 218 4552 (Vapi assistant "Agent On Call", persona Agent Seven)
- Emails are sent from `agentseven@tikkaburrito.com`
- Web app (Vercel, production): https://agent-on-call.vercel.app (project `agent-on-call`, team `tikka-burrito`; pushes to `main` auto-deploy)
- Dashboard: https://agent-on-call.vercel.app/dashboard · Login: https://agent-on-call.vercel.app/login
- GitHub (public): https://github.com/tikkaburrito/agent-on-call

## Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Scaffold, Supabase project, env skeleton | done | Next.js 16.3.8, project `ckwsgvgledkgkuwzbrrd` linked |
| 1 | Schema, RLS, Realtime, seed, `health` | done | `scripts/m1-db.ts`: all pass; 2 demo businesses, 3 projects, 23 customers seeded |
| 2 | Signup pages, checkout, Stripe webhook | signup works; **payment off: Vercel holds a LIVE Stripe key** | checkout refuses non-test keys; `scripts/m2-webhook.ts` needs the test key locally |
| 3 | Executor, send helpers, allowlist | email verified; **texts and invoices need 2 keys** | `scripts/m3-executor.ts`: real email sent to the allowlisted address, seeded customers simulated, idempotent; fails only on missing `TWILIO_AUTH_TOKEN` and `STRIPE_SECRET_KEY` |
| 4 | Tools + `vapi-tools` | done | `scripts/m4-tools.sh`: 28/28 pass, slowest call under 3 s |
| 5 | Vapi assistant | configured; **waiting for your test call** | assistant "Agent On Call" (Agent Seven) has 6 tools, each with the `x-vapi-secret` header; +1 341 218 4552 rings it |
| 6 | Site builder (landing page deploy + SMS) | done | `scripts/m6-builder.ts`: live in 9 s at https://aoc-sunrise-yoga.vercel.app with Claude-written copy |
| 7 | Dashboard | deployed | signup → add business → dashboard → new project verified; `scripts/m7-realtime.ts`: 10/10 pass |
| 8 | QA, README, production deploy | deployed; live-call QA (14.4, 14.6) not run | |

## MANUAL (things only you can do)

1. **Call +1 341 218 4552 from your phone ending 5585** and ask "What's going on with my business?" It should greet you by name and report the Tikka Burrito AI project.
2. **Stripe: switch to a test key.** The `STRIPE_SECRET_KEY` you added in Vercel is a live key (it created `cs_live_` sessions). The site now refuses live keys, so checkout shows "Payments are not set up in test mode yet". In Stripe, turn on Test mode → Developers → API keys → copy the `sk_test_...` secret key, then:
   - replace `STRIPE_SECRET_KEY` in Vercel (Project → Settings → Environment Variables), and
   - paste the same `sk_test_...` into `.env.local`.
3. **Twilio auth token:** paste `TWILIO_AUTH_TOKEN=...` into `.env.local` (Vercel hides it, so it could not be copied). Needed for texts.
4. Then run `bash scripts/go-live.sh`. It pushes both to Supabase, creates the Stripe webhook, redeploys and reruns the checks.

About Vapi and Supabase: Vapi's own "Supabase" integration is for storing call recordings, and the Resend ↔ Supabase integration only covers Supabase's login emails. Neither gives the agent database access. The agent reads data only by calling our `vapi-tools` function with the `x-vapi-secret` header, which `vapi/setup.ts` sets on every tool.

Keys live in two places: Vercel (the website) and Supabase function secrets (the agent, sender and page builder). `.env.local` is the source for both; `scripts/push-secrets.sh` and `scripts/deploy-vercel.sh` copy from it.

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
