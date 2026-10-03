# Agent on Call

**Your website collects customers. Agent on Call does the follow-up. Don't log in, just call.**

A small-business owner calls a phone number and talks to an AI agent that:

1. Identifies the owner's business from caller ID.
2. Reads that business's database and says what needs attention: new signups, unpaid orders, people who dropped off.
3. Proposes actions (emails, texts, Stripe invoices), drafts the copy, and reads the plan back.
4. On a spoken "yes", executes them for real and reports the results.
5. On request, builds a landing page, deploys it to Vercel as its own project, and texts the owner the link.

Built in one day for a hackathon. Everything runs for real: real auth, real rows, real sends, real deployments.

## Architecture

```
Phone ─▶ Vapi assistant (Claude Haiku 4.5)
            │  tool calls, x-vapi-secret header
            ▼
   vapi-tools (Supabase Edge Function) ── resolves the site from caller ID
            │
            ├─ _shared/tools.ts ──▶ Postgres: needs_attention(), find_customers(), actions
            ├─ executor ──────────▶ Resend (email) · Twilio (SMS) · Stripe (invoices)
            └─ site-builder ──────▶ Claude copy ─▶ Vercel REST API deploy ─▶ SMS link

Landing page (static, own Vercel project) ─▶ POST /api/checkout (Next.js on Vercel)
            └─▶ customers + pending order ─▶ Stripe Checkout
Stripe ─▶ stripe-webhook (Edge Function) ─▶ order paid (idempotent via stripe_events)

Owner dashboard (Next.js) ◀─ Supabase Auth (email code) + RLS + Realtime
```

### How Supabase is used

| Feature | Use |
|---|---|
| Postgres | `sites`, `customers`, `orders`, `actions`, `site_builds`, `stripe_events`; site-scoped SQL functions `needs_attention` and `find_customers` are the only way the agent reads data |
| RLS | Every table has RLS. Owners can only `select` rows of sites they own. There are no public policies; writes go through the service key on the server |
| Auth | Email one-time code for the owner dashboard |
| Realtime | The dashboard subscribes to `actions`, `customers`, `orders`, `site_builds`; RLS applies to the stream |
| Edge Functions | `vapi-tools`, `executor`, `site-builder`, `stripe-webhook`, `health` |
| pg_cron + pg_net | Pings the functions every minute so tool calls stay fast during a call |

### Safety rails

- **Nothing is sent without a spoken yes.** `propose_actions` only writes `proposed` rows. `confirm_actions` runs them, and the assistant is instructed to call it only after a clear yes.
- **Send allowlist.** Real email, SMS and Stripe calls go only to addresses in `SEND_ALLOWLIST`. Everyone else ends as `simulated`, with the would-be payload stored and no external call made. Seed data is fake (`@example.com`, 555 numbers).
- **Tenant isolation.** Every tool is scoped to the caller's `site_id`. Customer ids or batch ids from another site never match.
- **SMS consent.** No text is proposed for a customer without consent or a phone number, and the executor checks again.
- **Idempotency.** The executor claims rows with one atomic `update ... where status = 'approved'`; a second run claims nothing. Stripe events are recorded by id before processing, so replays are no-ops.
- **Stripe test mode only.** The Stripe helper refuses any key that is not `sk_test_`.
- **Model output is data.** Claude writes words (message copy, landing page copy as JSON). It never writes HTML or SQL; the landing page template escapes every value.

## Agent tools

| Tool | What it does |
|---|---|
| `get_attention_items` | Counts and up to 5 names per kind: not welcomed, unpaid, dropped off |
| `find_customers` | Lookup by name/email and segment (`all`, `new_today`, `welcome_pending`, `unpaid`, `dropped_off`) |
| `propose_actions` | Resolves recipients, drafts copy with Claude (templates as fallback), inserts `proposed` actions under one `batch_id`, returns a spoken summary |
| `confirm_actions` | Approves the batch, runs the executor, waits up to ~3.5 s, reports sent / simulated / failed / still running |
| `cancel_actions` | Cancels a proposed batch |
| `build_landing_page` | Starts a landing page build and deploy; the link is texted when it is live |

## Repo layout

```
app/                      Next.js: booking site (/), /success, /login, /dashboard, /api/checkout, /api/claim
lib/                      Supabase clients, types
supabase/migrations/      schema, RLS, realtime, SQL functions, warm pinger
supabase/seed.sql         fake demo data
supabase/functions/       vapi-tools, executor, site-builder, stripe-webhook, health, _shared
vapi/                     assistant.json (prompt, model, tools) + setup.ts
scripts/                  acceptance and QA scripts
STATUS.md                 milestone status, URLs, QA results, manual steps
```

## Run it

Prerequisites: Node 22+, Supabase CLI (logged in), accounts for Vapi, Stripe (test mode), Resend, Twilio, Anthropic, Vercel.

```bash
npm install
cp .env.example .env.local        # then fill in the keys
```

```bash
# Database, seed data, edge functions
supabase link --project-ref <ref>
supabase db push --include-seed
bash scripts/push-secrets.sh
supabase functions deploy vapi-tools executor site-builder stripe-webhook health --no-verify-jwt
npx tsx scripts/set-owner.ts      # seeded site answers to OWNER_PHONE
```

```bash
# Stripe webhook (test mode) and auth email (Resend SMTP + code template)
npx tsx scripts/setup-stripe-webhook.ts && bash scripts/push-secrets.sh
bash scripts/push-auth-config.sh
```

```bash
# Web app
npm run dev                       # local
vercel deploy --prod              # production; set the same env vars in Vercel
```

```bash
# Voice agent
npx tsx vapi/setup.ts --attach    # creates/updates tools + assistant, attaches the phone number
```

Then call the Vapi number from `OWNER_PHONE` and say "What needs my attention?"

### Tests

```bash
npx tsx scripts/m1-db.ts          # schema, RLS, owner scoping
npx tsx scripts/m2-webhook.ts     # Stripe signature, paid flip, replay
npx tsx scripts/m3-executor.ts    # real sends to the allowlist, simulated for seed data, idempotency
bash scripts/m4-tools.sh          # every tool over HTTP, auth, isolation, timing
npx tsx scripts/m6-builder.ts     # landing page build, public URL, checkout from the page
npx tsx scripts/m7-realtime.ts    # realtime to the owner, nothing to a second user
bash scripts/qa-bundle.sh         # no server secrets in the client bundle
npx tsx scripts/reset-demo.ts     # back to the seeded state before a rehearsal
```

### Before a demo

- The warm pinger (`warm-functions` cron job) is on by default. Check with `select * from cron.job;`. Turn off with `select cron.unschedule('warm-functions');`.
- Add the judge's email and phone to `SEND_ALLOWLIST`, then `bash scripts/push-secrets.sh`.
- Open `/dashboard` on the big screen, signed in as `OWNER_EMAIL`.
- If the sign-in email is slow: `npx tsx scripts/dev-login-code.ts <owner email>` prints a one-time code.

## Next steps (out of scope today)

- Self-serve onboarding for new businesses, including by phone.
- Stripe Connect so each business is paid into its own account.
- Standing rules ("always welcome new signups within five minutes").
- Outbound calls from the agent to the owner.
- Freeform questions over the data, beyond the fixed read functions.
- Richer site builder: multiple pages, custom domains, edits by voice.
