#!/usr/bin/env bash
# Run once the keys are in .env.local. Wires up everything that needs them and
# skips whatever is still missing. Safe to re-run. Prints no secret values.
#   bash scripts/go-live.sh
set -uo pipefail
cd "$(dirname "$0")/.."
has() { grep -qE "^$1=.+" .env.local; }
step() { printf '\n== %s\n' "$1"; }

step "Supabase function secrets"
bash scripts/push-secrets.sh

if has STRIPE_SECRET_KEY; then
  step "Stripe webhook (test mode)"
  npx tsx scripts/setup-stripe-webhook.ts && bash scripts/push-secrets.sh
  npx tsx scripts/m2-webhook.ts
else
  echo "skip  Stripe: STRIPE_SECRET_KEY is empty (checkout and invoices stay off)"
fi

step "Web app on Vercel"
bash scripts/deploy-vercel.sh

if has VAPI_API_KEY; then
  step "Vapi tools + assistant"
  npx tsx vapi/setup.ts --attach
else
  echo "skip  Vapi: VAPI_API_KEY is empty (no voice agent yet)"
fi

if has OWNER_PHONE; then
  step "Demo owner caller ID"
  npx tsx scripts/seed-demo.ts
fi

step "Tool checks against the deployed functions"
bash scripts/m4-tools.sh | grep -E '^(FAIL|All|[0-9]+ check)'

for name in ANTHROPIC_API_KEY RESEND_API_KEY RESEND_FROM TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM VERCEL_TOKEN SEND_ALLOWLIST; do
  has "$name" || echo "still empty: $name"
done
