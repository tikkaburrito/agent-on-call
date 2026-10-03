#!/usr/bin/env bash
# Applies supabase/seed.sql to the linked remote database (idempotent), then
# creates the demo users. `supabase db push --include-seed` only runs a seed
# file once, so use this after editing the seed.
set -euo pipefail
cd "$(dirname "$0")/.."
PW="$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)"
URL="$(cat supabase/.temp/pooler-url)"
PGPASSWORD="$PW" psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
npx tsx scripts/seed-demo.ts
