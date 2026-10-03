#!/usr/bin/env bash
# Pushes edge function secrets from .env.local to Supabase without printing values.
# Usage: bash scripts/push-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
# SUPABASE_* names are reserved (the platform injects them); skip empty values.
grep -E '^[A-Z_]+=.+' .env.local | grep -vE '^(SUPABASE_|NEXT_PUBLIC_SUPABASE_)' > "$tmp"
echo "Setting: $(cut -d= -f1 "$tmp" | tr '\n' ' ')"
supabase secrets set --env-file "$tmp" >/dev/null
echo "Secrets updated."
