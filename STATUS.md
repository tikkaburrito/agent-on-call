# STATUS

## URLs

- Supabase project: https://supabase.com/dashboard/project/ckwsgvgledkgkuwzbrrd (`agent-on-call`, us-east-1, fulsuccessai-spec's Org)
- Functions base: https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1
- Agent phone number: +1 341 218 4552 (Vapi assistant "Agent On Call", persona Agent Seven)
- Emails are sent from `agentseven@tikkaburrito.com`
- Web app (Vercel, production): https://agent-on-call.vercel.app (project `agent-on-call`, team `tikka-burrito`; pushes to `main` auto-deploy)
- Admin console (live call transcripts, tool calls, resulting actions): https://agent-on-call.vercel.app/admin (admins only; `krishnan_meetup` is an admin)
- Dashboard: https://agent-on-call.vercel.app/dashboard · Login: https://agent-on-call.vercel.app/login
- GitHub (public): https://github.com/tikkaburrito/agent-on-call

## Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| 0 | Scaffold, Supabase project, env skeleton | done | Next.js 16.3.8, project `ckwsgvgledkgkuwzbrrd` linked |
| 1 | Schema, RLS, Realtime, seed, `health` | done | `scripts/m1-db.ts`: all pass; 2 demo businesses, 3 projects, 23 customers seeded |
| 2 | Signup pages, checkout, Stripe webhook | done | production checkout returns a `cs_test_` Stripe session; `scripts/m2-webhook.ts`: 8/8 pass; a real `invoice.paid` event flipped an order to paid in ~2 s (`scripts/qa-live.ts`) |
| 3 | Executor, send helpers, allowlist | done, **texts blocked by carrier** | `scripts/m3-executor.ts`: 12/12 pass; real email and Stripe test invoice delivered to the allowlisted address; seeded customers simulated; idempotent |
| 4 | Tools + `vapi-tools` | done | `scripts/m4-tools.sh`: 28/28 pass, slowest call under 3 s |
| 5 | Vapi assistant | configured; **waiting for your test call** | assistant "Agent On Call" (Agent Seven) has 6 tools, each with the `x-vapi-secret` header; +1 341 218 4552 rings it |
| 6 | Site builder (landing page deploy) | done | `scripts/m6-builder.ts`: 8/8 pass; live in 9 s at https://aoc-sunrise-yoga.vercel.app with Claude-written copy; checkout from the page works |
| 7 | Dashboard | deployed | signup → add business → dashboard → new project verified; `scripts/m7-realtime.ts`: 10/10 pass |
| 8 | QA, README, production deploy | deployed; live-call QA (14.4, 14.6) is yours to run | see QA below |

## MANUAL (things only you can do)

1. **Call +1 341 218 4552 from your phone ending 5585** and ask "What's going on with my business?" Then try "Welcome the new signup and send the invoice", say "yes", and check your email.
2. **Texts do not arrive.** Twilio accepts them, but US carriers reject them with error 30034: the Twilio number +1 341 218 4552 is not registered for business texting (A2P 10DLC). Registration is done in the Twilio console (Messaging → Regulatory compliance → A2P 10DLC) and takes days, so plan the demo around email. The system reports these texts as failed with that reason, invoices still go out by email, and landing page links are also emailed to owners who signed up with a real email address.
3. For the judge demo: add the judge's email to `SEND_ALLOWLIST` in `.env.local`, then run `bash scripts/push-secrets.sh`.

Keys live in two places: Vercel (the website) and Supabase function secrets (the agent, sender and page builder). `.env.local` is the source for both; `bash scripts/go-live.sh` copies from it and reruns the checks.

## Fixed after the first real calls

- **Offers were dropped from drafted copy.** The drafter was told never to mention discounts, so "50 percent off" was left out, and the agent then said it was included. Now the owner's stated offer must appear in the copy (enforced in code, not only in the prompt), `propose_actions` returns the drafted wording, and `get_recent_actions` lets the agent read back what was actually sent.
- **A percent-off offer on a landing page is real.** `build_landing_page` stores it as the project's `discount_percent`; the page, the signup page and Stripe Checkout all use the discounted price. Say "remove the discount" (or pass 0) to clear it.
- **Offer emails link to the page.** Offer and follow-up emails and texts now include the project's page link (the landing page the agent built, otherwise the hosted signup page). When the owner approves a percent-off message, that discount is applied to the project and its landing page is rebuilt, so the link always shows the price the email promised.
- **Call log.** Calls made before this change were imported from Vapi; new ones are logged live, with transcript lines synced from the conversation on every turn.

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

Scripted checks, last run with all keys in place:

| Area (spec §14) | Result | Script |
|---|---|---|
| 14.1 Anonymous reads nothing; owner A cannot read owner B | pass | `scripts/m1-db.ts`, `scripts/m7-realtime.ts` |
| 14.1 `vapi-tools` wrong or missing secret → 401 | pass | `scripts/m4-tools.sh` |
| 14.1 `stripe-webhook` bad signature → 400, no row changes | pass | `scripts/m2-webhook.ts` |
| 14.1 Cross-business batch cannot be confirmed; foreign customer ids dropped | pass | `scripts/m4-tools.sh` |
| 14.1 Service role key absent from the client bundle | pass | `scripts/qa-bundle.sh` |
| 14.2 Executor idempotent; `welcomed_at` set once; invoice stored on the right order | pass | `scripts/m3-executor.ts` |
| 14.2 Stripe webhook replay is a no-op; one failed action leaves the rest executed | pass | `scripts/m2-webhook.ts`, `scripts/m3-executor.ts` |
| 14.3 No consent or no phone → no SMS row; non-allowlisted → simulated, no external call | pass | `scripts/m4-tools.sh`, `scripts/m3-executor.ts` |
| 14.4 Every tool call under 5 s; confirm returns within 5 s | pass | `scripts/m4-tools.sh` |
| 14.4 Agent behaviour on a live call (no invention, ambiguous reply, "wait, no") | **not run** | needs your phone call |
| 14.5 Failure drills (invalid Anthropic key, invalid Twilio token, 500, unknown caller) | partly: unknown caller and Twilio failure verified; the others **not run** | |
| 14.6 Three rehearsals | **not run** | needs your phone call |
