#!/usr/bin/env bash
# M4 acceptance + QA 14.1 / 14.4: curl every tool on the deployed vapi-tools
# function with a sample Vapi `tool-calls` payload.
# Usage: bash scripts/m4-tools.sh        (run it 3 times for the timing check)
set -uo pipefail
cd "$(dirname "$0")/.."

val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
URL="$(val NEXT_PUBLIC_SUPABASE_URL)/functions/v1/vapi-tools"
SECRET="$(val VAPI_SERVER_SECRET)"
SITE_B_PHONE="+15555550002"                               # Harbor Coffee Roasters (seed)
SITE_B_CUSTOMER="b0000000-0000-4000-8000-000000000001"    # belongs to site B
FAILS=0; SLOWEST=0; OUT=""; CODE=""; SECS=""

check() { # name, condition (0 = pass), detail
  if [ "$2" -eq 0 ]; then echo "PASS  $1  ${3:-}"; else echo "FAIL  $1  ${3:-}"; FAILS=$((FAILS + 1)); fi
}

# call <tool> <json args> [caller number] [secret]  -> sets OUT (result text), CODE, SECS
call() {
  local customer="" secret="${4-$SECRET}"
  [ -n "${3:-}" ] && customer=", \"customer\": {\"number\": \"$3\"}"
  local payload="{\"message\": {\"type\": \"tool-calls\", \"call\": {\"id\": \"test-call\", \"type\": \"webCall\"$customer}, \"toolCallList\": [{\"id\": \"tc_1\", \"type\": \"function\", \"function\": {\"name\": \"$1\", \"arguments\": $2}}]}}"
  local raw
  raw="$(curl -s -m 20 -w '\n%{http_code} %{time_total}' -X POST "$URL" \
    -H 'Content-Type: application/json' -H "x-vapi-secret: $secret" -d "$payload")"
  CODE="$(echo "$raw" | tail -1 | cut -d' ' -f1)"
  SECS="$(echo "$raw" | tail -1 | cut -d' ' -f2)"
  OUT="$(echo "$raw" | sed '$d' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).results[0];console.log(r.result??("ERROR: "+r.error))}catch{console.log(s)}})')"
  SLOWEST="$(node -e "console.log(Math.max($SLOWEST, $SECS))")"
  printf '      %-22s %ss  %s\n' "$1" "$SECS" "${OUT:0:300}"
}
has() { echo "$OUT" | grep -qi -- "$1"; }
batch_id() { echo "$OUT" | grep -oE 'batch_id: [0-9a-f-]{36}' | cut -d' ' -f2; }

ITEMS='{"items": [
  {"type": "email", "segment": "welcome_pending", "intent": "welcome everyone who is new"},
  {"type": "sms", "segment": "welcome_pending", "intent": "welcome everyone who is new"},
  {"type": "invoice", "segment": "unpaid", "intent": "send the unpaid ones their invoice"}]}'

echo "== auth"
call get_attention_items '{}' "" "wrong-secret"; check "wrong secret -> 401" "$([ "$CODE" = 401 ]; echo $?)" "http $CODE"
call get_attention_items '{}' "" "";             check "missing secret -> 401" "$([ "$CODE" = 401 ]; echo $?)" "http $CODE"

echo "== read tools"
call get_attention_items '{}'; has "not welcomed"; check "get_attention_items lists welcome_pending" $?
has "unpaid"; check "get_attention_items lists unpaid" $?
call find_customers '{"query": "sofia"}'; has "Sofia Rossi"; check "find_customers finds Sofia" $?
call find_customers '{"query": "zzz-nobody"}'; has "No customers found"; check "find_customers invents nobody" $?
call find_customers '{"segment": "unpaid"}'; has "match"; check "find_customers by segment" $?

echo "== unknown caller"
call get_attention_items '{}' "+15555559999"; has "not registered"; check "unregistered number is refused" $?

echo "== propose + cancel"
call propose_actions "$ITEMS"; B1="$(batch_id)"
check "propose_actions returns a batch_id" "$([ -n "$B1" ]; echo $?)"
has "welcome email"; check "summary counts welcome emails" $?
has "invoice"; check "summary counts invoices and dollars" $?
call cancel_actions "{\"batch_id\": \"$B1\"}"; has "Cancelled"; check "cancel_actions cancels the batch" $?
call confirm_actions "{\"batch_id\": \"$B1\"}"; has "No open proposal"; check "cancelled batch cannot be confirmed" $?

echo "== cross-site isolation"
call propose_actions "$ITEMS"; B2="$(batch_id)"
call confirm_actions "{\"batch_id\": \"$B2\"}" "$SITE_B_PHONE"; has "No open proposal"
check "site B cannot confirm site A's batch" $?
call cancel_actions "{\"batch_id\": \"$B2\"}" "$SITE_B_PHONE"; has "no open proposal"
check "site B cannot cancel site A's batch" $?
call propose_actions "{\"items\": [{\"type\": \"email\", \"customer_ids\": [\"$SITE_B_CUSTOMER\"], \"intent\": \"hello\"}]}"
has "no matching customers"; check "foreign customer_ids are dropped" $?

echo "== confirm"
call confirm_actions "{\"batch_id\": \"$B2\"}"; has "Done"; check "confirm_actions executes the batch" $?
has "simulated"; check "confirm reports simulated count" $?
call confirm_actions "{\"batch_id\": \"$B2\"}"; has "No open proposal"; check "second confirm is a no-op" $?

echo "== consent"
call propose_actions '{"items": [{"type": "sms", "customer_ids": ["a0000000-0000-4000-8000-000000000004", "a0000000-0000-4000-8000-000000000006"], "intent": "say hi"}]}'
has "skipped for texts"; check "no-consent and no-phone customers get no SMS row" $?

echo
check "every call under 5 s" "$(node -e "process.exit($SLOWEST < 5 ? 0 : 1)"; echo $?)" "slowest ${SLOWEST}s"
[ "$FAILS" -eq 0 ] && echo "All checks passed." || echo "$FAILS check(s) FAILED."
exit "$FAILS"
