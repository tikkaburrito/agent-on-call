#!/usr/bin/env bash
# Pushes auth settings (Resend SMTP + 6-digit code email template) to Supabase.
# Needs RESEND_API_KEY and RESEND_FROM in .env.local. Prints no secret values.
set -euo pipefail
cd "$(dirname "$0")/.."
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
export RESEND_API_KEY="$(val RESEND_API_KEY)"
from="$(val RESEND_FROM)"
# RESEND_FROM may be "Name <email@domain>"; SMTP needs the bare address.
export RESEND_FROM_EMAIL="$(echo "$from" | sed -E 's/.*<([^>]+)>.*/\1/' | tr -d '"')"
[ -n "$RESEND_API_KEY" ] && [ -n "$RESEND_FROM_EMAIL" ] || { echo "Set RESEND_API_KEY and RESEND_FROM in .env.local first."; exit 1; }
export SUPABASE_DB_PASSWORD="$(val SUPABASE_DB_PASSWORD)"
supabase config push --yes 2>&1 | grep -E 'Pushing|Finished|unexpected|error|Error' || true
echo "Auth config push finished."
