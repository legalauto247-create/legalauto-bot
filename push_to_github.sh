#!/bin/bash
# ================================================================
# LegalAuto — Push Jarvis files to GitHub
# Запустить: bash push_to_github.sh
# ================================================================

TOKEN="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"
REPO="legalauto247-create/legalauto-bot"
BASE="$(cd "$(dirname "$0")/legalauto-node-bot" && pwd)"

echo "🤖 LegalAuto Jarvis — Push to GitHub"
echo "📁 Base: $BASE"
echo ""

push_file() {
  local FPATH="$1"
  local LOCAL="$2"
  local SHA="$3"

  if [ ! -f "$LOCAL" ]; then
    echo "❌ File not found: $LOCAL"
    return 1
  fi

  local B64
  B64=$(base64 -i "$LOCAL" | tr -d '\n')

  local PAYLOAD
  if [ -n "$SHA" ]; then
    PAYLOAD=$(printf '{"message":"feat: %s — Jarvis 🤖","content":"%s","sha":"%s"}' "$FPATH" "$B64" "$SHA")
  else
    PAYLOAD=$(printf '{"message":"feat: %s — Jarvis 🤖","content":"%s"}' "$FPATH" "$B64")
  fi

  local STATUS
  STATUS=$(curl -s -o /tmp/gh_resp.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: token $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "https://api.github.com/repos/$REPO/contents/$FPATH")

  if [ "$STATUS" = "200" ] || [ "$STATUS" = "201" ]; then
    echo "✅ $FPATH → $STATUS"
  else
    local MSG
    MSG=$(python3 -c "import json,sys; d=json.load(open('/tmp/gh_resp.json')); print(d.get('message','?'))")
    echo "❌ $FPATH → $STATUS: $MSG"
  fi
}

get_sha() {
  local FPATH="$1"
  curl -s \
    -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/$REPO/contents/$FPATH" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sha',''))"
}

echo "━━━ 1/5: carDocAgent.js ━━━"
push_file "agents/carDocAgent.js" "$BASE/agents/carDocAgent.js"

echo "━━━ 2/5: marketIntelAgent.js ━━━"
push_file "agents/marketIntelAgent.js" "$BASE/agents/marketIntelAgent.js"

echo "━━━ 3/5: knowledgeBase.js ━━━"
push_file "agents/knowledgeBase.js" "$BASE/agents/knowledgeBase.js"

echo "━━━ 4/5: masterAgent.js ━━━"
SHA_MASTER=$(get_sha "agents/masterAgent.js")
echo "  SHA: ${SHA_MASTER:0:8}..."
push_file "agents/masterAgent.js" "$BASE/agents/masterAgent.js" "$SHA_MASTER"

echo "━━━ 5/5: bots/edoBot.js ━━━"
SHA_EDO=$(get_sha "bots/edoBot.js")
echo "  SHA: ${SHA_EDO:0:8}..."
push_file "bots/edoBot.js" "$BASE/bots/edoBot.js" "$SHA_EDO"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Done! Railway auto-deploys from main branch."
echo "   Check: https://railway.com (auto-deploy triggered)"
