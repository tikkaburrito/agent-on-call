#!/usr/bin/env bash
# Pushes edge function secrets from .env.local to Supabase without printing values.
# Only the names listed here are sent; anything else in .env.local stays local.
# Usage: bash scripts/push-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
NAMES="ANTHROPIC_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY RESEND_FROM TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM VAPI_SERVER_SECRET VERCEL_TOKEN VERCEL_TEAM_ID SEND_ALLOWLIST ATTENTION_MINUTES DEMO_FALLBACK_SITE_ID NEXT_PUBLIC_SITE_URL"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
for name in $NAMES; do
  line="$(grep -E "^$name=.+" .env.local | head -1 || true)"
  [ -n "$line" ] && echo "$line" >> "$tmp"
done
echo "Setting: $(cut -d= -f1 "$tmp" | tr '\n' ' ')"
supabase secrets set --env-file "$tmp" >/dev/null 2>&1
echo "Secrets updated."
