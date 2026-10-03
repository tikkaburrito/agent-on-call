#!/usr/bin/env bash
# QA 14.1: the service role key (and other server secrets) never reach the
# client bundle. Builds the app, then greps the browser-served output.
set -uo pipefail
cd "$(dirname "$0")/.."
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
npm run build >/dev/null 2>&1 || { echo "FAIL  build failed"; exit 1; }
FAILS=0
for name in SUPABASE_SERVICE_ROLE_KEY STRIPE_SECRET_KEY ANTHROPIC_API_KEY RESEND_API_KEY TWILIO_AUTH_TOKEN VAPI_API_KEY VAPI_SERVER_SECRET VERCEL_TOKEN; do
  value="$(val "$name")"
  [ -z "$value" ] && { echo "SKIP  $name not set"; continue; }
  if grep -rqF -- "$value" .next/static 2>/dev/null; then
    echo "FAIL  $name value found in .next/static"; FAILS=$((FAILS + 1))
  else
    echo "PASS  $name value absent from client bundle"
  fi
done
if grep -rq "SUPABASE_SERVICE_ROLE_KEY" .next/static 2>/dev/null; then
  echo "FAIL  SUPABASE_SERVICE_ROLE_KEY referenced in client code"; FAILS=$((FAILS + 1))
else
  echo "PASS  no client code references SUPABASE_SERVICE_ROLE_KEY"
fi
exit "$FAILS"
