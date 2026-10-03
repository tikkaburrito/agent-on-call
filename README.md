# Agent on Call

**Your website collects customers. Agent on Call does the follow-up. Don't log in, just call.**

A small-business owner calls a phone number and talks to an AI agent that:

1. Recognises the caller from their phone number: which user they are, which business is theirs, and which projects sit under it.
2. Reads that business's database and walks them through what needs attention, project by project: new signups, unpaid orders, people who dropped off.
3. Proposes actions (emails, texts, Stripe invoices), drafts the copy, and reads the plan back.
4. On a spoken "yes", executes them for real and reports the results.
5. On request, builds a landing page, deploys it to Vercel as its own project, and texts the owner the link.

**Live:** https://agent-on-call.vercel.app (home page with the demo business) · **Dashboard:** https://agent-on-call.vercel.app/dashboard

Built in one day for a hackathon. Everything runs for real: real auth, real rows, real sends, real deployments.

## Architecture

```
Phone ─▶ Vapi assistant (Claude Haiku 4.5)
            │  tool calls, x-vapi-secret header
            ▼
   vapi-tools (Supabase Edge Function) ── caller ID ─▶ user ─▶ business ─▶ projects
            │
            ├─ _shared/tools.ts ──▶ Postgres: needs_attention(), find_customers(), actions
            ├─ executor ──────────▶ Resend (email) · Twilio (SMS) · Stripe (invoices)
            └─ site-builder ──────▶ Claude copy ─▶ Vercel REST API deploy ─▶ SMS link

Landing page (static, own Vercel project) ─▶ POST /api/checkout (Next.js on Vercel)
            └─▶ customers + pending order ─▶ Stripe Checkout
Stripe ─▶ stripe-webhook (Edge Function) ─▶ order paid (idempotent via stripe_events)

Owner dashboard (Next.js) ◀─ Supabase Auth (username + password) + RLS + Realtime
```

### Data model: user → business → projects

| Table | What it is |
|---|---|
| `profiles` | One row per user: username, name, and the phone they call from (caller ID) |
| `businesses` | Owned by a user. One per user today; the schema allows more |
| `sites` | The **projects** under a business: one offer, one price, one signup page |
| `customers`, `orders` | People who signed up on a project's page, and what they owe or paid |
| `actions` | Every email, text and invoice the agent proposed, with its status and result |
| `site_builds` | Landing pages the agent built and deployed for a project |
| `calls`, `call_events` | The call log: every call with its live transcript, tool calls and results |

A user signs up with a username, a password and their mobile number, then adds their business and first project. When they call, `vapi-tools` looks up `profiles.phone`, loads their business and its projects, and every tool is limited to those project ids. With several projects, the agent reports on all of them and asks which one before it acts.

### How Supabase is used

| Feature | Use |
|---|---|
| Postgres | `profiles`, `businesses`, `sites` (projects), `customers`, `orders`, `actions`, `site_builds`, `stripe_events`; project-scoped SQL functions `needs_attention` and `find_customers` are the only way the agent reads data |
| RLS | Every table has RLS. A user can only `select` their own profile, their business, and rows of projects under it. There are no public policies; writes go through the service key on the server |
| Auth | Username and password for the owner dashboard (usernames map to synthetic addresses, so no email is ever sent) |
| Realtime | The dashboard subscribes to `actions`, `customers`, `orders`, `site_builds`; RLS applies to the stream |
| Edge Functions | `vapi-tools`, `executor`, `site-builder`, `stripe-webhook`, `health` |
| pg_cron + pg_net | Pings the functions every minute so tool calls stay fast during a call |

### Safety rails

- **Nothing is sent without a spoken yes.** `propose_actions` only writes `proposed` rows. `confirm_actions` runs them, and the assistant is instructed to call it only after a clear yes.
- **Send allowlist.** Real email, SMS and Stripe calls go only to addresses in `SEND_ALLOWLIST`. Everyone else ends as `simulated`, with the would-be payload stored and no external call made. Seed data is fake (`@example.com`, 555 numbers).
- **Tenant isolation.** Every tool is limited to the caller's own project ids. Customer ids or batch ids from another business never match.
- **SMS consent.** No text is proposed for a customer without consent or a phone number, and the executor checks again.
- **Idempotency.** The executor claims rows with one atomic `update ... where status = 'approved'`; a second run claims nothing. Stripe events are recorded by id before processing, so replays are no-ops.
- **Stripe test mode only.** The Stripe helper refuses any key that is not `sk_test_`.
- **Model output is data.** Claude writes words (message copy, landing page copy as JSON). It never writes HTML or SQL; the landing page template escapes every value.

## Automations

An owner can switch on three standing rules per project by voice. The agent describes the rule and gets a yes before turning it on; that yes is the standing approval, and after it the rule sends without a call.

| Rule | What it sends |
|---|---|
| `welcome_new_signups` | A welcome email to every new signup |
| `remind_unpaid` | One reminder email with the page link once an order has been unpaid for the delay |
| `invoice_unpaid` | One Stripe invoice by email once an order has been unpaid for the delay |

`pg_cron` calls the `automations` edge function every minute. It creates `approved` actions marked `source = 'automation'` and hands them to the same executor as spoken batches, so the allowlist, idempotency and logging are identical. Each customer gets each rule at most once.

## Outbound calls

The owner can also have the agent phone customers: "call my new signups about the one month free offer". It is a `call` item in `propose_actions`, so it goes through the same read-back and spoken yes as any other batch.

- **A separate assistant makes the call.** "Agent On Call Outreach" knows only what each call is given (business, product, price, the owner's message). Its one tool reports how the call went. The owner's tools are refused on any outbound call, whoever answers.
- **It says it is an AI** in its first sentence, keeps the call under a minute, and is told not to invent anything.
- **Call consent is separate.** Signup forms have a "You may call me, including calls from an AI assistant" checkbox (`customers.call_consent`). People without it are skipped, and the agent says how many. "Don't call me again" on a call withdraws it at once.
- **Allowlist.** Only allowlisted numbers are actually dialed; everyone else is simulated.
- A follow-up email with the page link goes out with each call, and the call itself appears in the admin console with its transcript and outcome.

## The phone side

- **Greeting by name.** The phone number asks `vapi-tools` who should answer (`assistant-request`). The function looks up the caller and returns the assistant with a personal first message; unknown numbers are told the number isn't registered.
- **The repo is the source of truth.** `vapi/assistant.json` holds the prompt, tools, greeting and call settings; `npx tsx vapi/setup.ts` applies them. Editing the assistant in the Vapi dashboard from a tab opened earlier overwrites tools and prompt; re-run the script to restore them.
- **Quiet callers are not dropped.** The silence timeout is 3 minutes, with a spoken "still here" check-in after 15 seconds.

## Admin console (`/admin`)

For the operator of the platform (a profile with `is_admin`; grant it with `npx tsx scripts/make-admin.ts <username>`).

- **Calls**: every call, live. The assistant reports final transcript lines, status changes and the end-of-call report to `vapi-tools`, which stores them in `calls` and `call_events`; the page updates over Realtime while the call is still going.
- **Per call**: the transcript, each tool call with its arguments, result and duration, and then what came out of it: the emails, texts and invoices with their exact wording and delivery status, and any landing page that was built.
- **Automations**: which rules are on, and everything they have sent.
- **Users and businesses**: who owns what, which phone they call from (last four digits), their projects, prices and pages.

`npx tsx scripts/backfill-calls.ts` imports earlier calls from Vapi.

## Agent tools

| Tool | What it does |
|---|---|
| `get_attention_items` | The caller's name and business, then per project: counts and up to 5 names for not welcomed, unpaid, dropped off |
| `find_customers` | Lookup by name/email and segment (`all`, `new_today`, `welcome_pending`, `unpaid`, `dropped_off`) |
| `propose_actions` | Resolves recipients, drafts copy with Claude (templates as fallback) including any offer the owner stated, inserts `proposed` actions under one `batch_id`, returns counts and the drafted wording |
| `confirm_actions` | Approves the batch, runs the executor, waits up to ~3.5 s, reports sent / simulated / failed / still running |
| `cancel_actions` | Cancels a proposed batch |
| `build_landing_page` | Starts a landing page build and deploy; a stated percent-off offer becomes the project's discount, so the page and checkout charge the reduced price; the link is sent by text and email |
| `get_recent_actions` | Reads back the last batch: recipients, status and exact wording, so the agent answers "what did you send?" from the record |
| `get_project` | "Look at my landing page": price and discount, customers and revenue, the page's address and its current headline, text, points and button, and which automations are on |
| `create_project` | A new offer under the business with its own signup page, and a landing page built straight away |
| `set_automation` | Turns a standing rule on or off: auto-welcome new signups, auto-remind unpaid orders, auto-invoice unpaid orders |
| `add_customer`, `mark_paid` | Add a customer by voice; record a payment made outside Stripe |

## Repo layout

```
app/                      Next.js: home (/), project signup pages (/s/[slug]), /success, /login, /dashboard, /admin,
                          /api/checkout, /api/signup, /api/onboard, /api/projects, /api/admin/data
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
bash scripts/seed.sh              # sample data + demo users "sunrise" and "harbor" (password: DEMO_PASSWORD in .env.local)
```

```bash
# Stripe webhook (test mode)
npx tsx scripts/setup-stripe-webhook.ts && bash scripts/push-secrets.sh
```

```bash
# Web app
npm run dev                       # local
bash scripts/deploy-vercel.sh     # production; copies the env vars the app needs
```

```bash
# Voice agent
npx tsx vapi/setup.ts --attach    # creates/updates tools + assistant, attaches the phone number
```

```bash
# Or all of the key-dependent steps in one go (skips what is still missing)
bash scripts/go-live.sh
```

Then create an account at `/login` with the mobile you will call from, add your business, call the Vapi number and say "What's going on?" To call as the demo owner instead, set `OWNER_PHONE` and re-run `bash scripts/seed.sh`.

### Tests

```bash
npx tsx scripts/m1-db.ts          # schema, RLS, owner scoping
npx tsx scripts/m2-webhook.ts     # Stripe signature, paid flip, replay
npx tsx scripts/m3-executor.ts    # real sends to the allowlist, simulated for seed data, idempotency
bash scripts/m4-tools.sh          # every tool over HTTP: caller recognition, projects, auth, isolation, timing
npx tsx scripts/m6-builder.ts     # landing page build, public URL, checkout from the page
npx tsx scripts/m7-realtime.ts    # realtime to the owner, nothing to a second user
npx tsx scripts/m8-automations.ts # rules off do nothing; on: one action per customer, no duplicates
npx tsx scripts/m9-outbound.ts    # outbound calls: consent, allowlist, outcome, owner-tool guard (--live rings your own phone)
bash scripts/qa-bundle.sh         # no server secrets in the client bundle
npx tsx scripts/reset-demo.ts     # back to the seeded state before a rehearsal
```

### Before a demo

- The warm pinger (`warm-functions` cron job) is on by default. Check with `select * from cron.job;`. Turn off with `select cron.unschedule('warm-functions');`.
- Add the judge's email and phone to `SEND_ALLOWLIST`, then `bash scripts/push-secrets.sh`.
- Open `/dashboard` on the big screen, signed in as `sunrise` (password: `DEMO_PASSWORD` in `.env.local`) or as your own account.

## Next steps (out of scope today)

- Google sign-in, and verifying the caller's phone with a text code at signup (today the number is taken on trust).
- Several businesses per user (the schema already allows it), and onboarding by phone.
- Stripe Connect so each business is paid into its own account.
- Outbound calls from the agent to the owner.
- Freeform questions over the data, beyond the fixed read functions.
- Richer site builder: multiple pages, custom domains, edits by voice.
