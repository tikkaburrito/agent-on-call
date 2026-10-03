#!/usr/bin/env bash
# Deploys the web app to Vercel production. Copies the env vars the app needs
# from .env.local (values are piped, never printed). Needs `vercel login` or
# VERCEL_TOKEN in the environment.
# Usage: bash scripts/deploy-vercel.sh [team-slug]
set -uo pipefail
cd "$(dirname "$0")/.."
SCOPE="${1:-tikka-burrito}"
PROJECT="agent-on-call"
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }

vercel project add "$PROJECT" --scope "$SCOPE" >/dev/null 2>&1 || true
vercel link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null 2>&1 || { echo "FAIL  could not link project"; exit 1; }
echo "Linked project $PROJECT ($SCOPE)."

add() { # name, extra flags
  local value; value="$(val "$1")"
  if [ -z "$value" ]; then echo "skip  $1 (empty in .env.local)"; return; fi
  if printf '%s' "$value" | vercel env add "$1" production --force $2 >/dev/null 2>&1; then
    echo "set   $1"
  else
    echo "FAIL  $1"
  fi
}
add NEXT_PUBLIC_SUPABASE_URL "--no-sensitive"
add NEXT_PUBLIC_SUPABASE_ANON_KEY "--no-sensitive"
add NEXT_PUBLIC_SITE_URL "--no-sensitive"
add NEXT_PUBLIC_AGENT_PHONE "--no-sensitive"
add SUPABASE_SERVICE_ROLE_KEY "--sensitive"
add STRIPE_SECRET_KEY "--sensitive"

echo "Deploying to production..."
vercel deploy --prod --yes --scope "$SCOPE" 2>/dev/null | tail -1
