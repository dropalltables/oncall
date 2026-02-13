#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"

: "${ONCALL_URL:?Set ONCALL_URL in .env or environment}"
: "${ONCALL_KEY:?Set ONCALL_KEY in .env or environment}"

cmd="${1:-help}"
shift || true

api() {
  curl -sf -H "Authorization: Bearer $ONCALL_KEY" -H "Content-Type: application/json" "$@"
}

case "$cmd" in
  notify|n)
    title="${1:?usage: oncall notify <title> <body> [ui_json]}"
    body="${2:?usage: oncall notify <title> <body> [ui_json]}"
    ui="${3:-}"
    if [ -n "$ui" ]; then
      api -X POST "$ONCALL_URL/api/notify" -d "$(jq -nc --arg t "$title" --arg b "$body" --argjson u "$ui" '{title:$t,body:$b,ui:$u}')"
    else
      api -X POST "$ONCALL_URL/api/notify" -d "$(jq -nc --arg t "$title" --arg b "$body" '{title:$t,body:$b}')"
    fi
    ;;
  respond|r)
    text="${1:?usage: oncall respond <text> [messageId]}"
    mid="${2:-}"
    if [ -n "$mid" ]; then
      api -X POST "$ONCALL_URL/api/respond" -d "$(jq -nc --arg t "$text" --arg m "$mid" '{text:$t,messageId:$m}')"
    else
      api -X POST "$ONCALL_URL/api/respond" -d "$(jq -nc --arg t "$text" '{text:$t}')"
    fi
    ;;
  messages|m)
    api "$ONCALL_URL/api/messages" | jq .
    ;;
  subs|s)
    api "$ONCALL_URL/api/subscriptions" | jq .
    ;;
  purge|p)
    api -X POST "$ONCALL_URL/api/purge" | jq .
    ;;
  webhooks|w)
    api "$ONCALL_URL/api/webhooks" | jq .
    ;;
  webhook-add|wa)
    url="${1:?usage: oncall webhook-add <url> [events]}"
    events="${2:-response}"
    api -X POST "$ONCALL_URL/api/webhooks" -d "$(jq -nc --arg u "$url" --arg e "$events" '{url:$u,events:$e}')"
    ;;
  webhook-rm|wr)
    url="${1:?usage: oncall webhook-rm <url>}"
    api -X DELETE "$ONCALL_URL/api/webhooks" -d "$(jq -nc --arg u "$url" '{url:$u}')"
    ;;
  wait)
    mid="${1:?usage: oncall wait <messageId> [timeout_seconds]}"
    timeout="${2:-300}"
    end=$((SECONDS + timeout))
    while [ $SECONDS -lt $end ]; do
      reply=$(api "$ONCALL_URL/api/messages" | jq -r --arg mid "$mid" '.messages[] | select(.parentId == $mid and .type == "response") | .body' 2>/dev/null || true)
      if [ -n "$reply" ]; then
        echo "$reply"
        exit 0
      fi
      sleep 3
    done
    echo "timeout" >&2
    exit 1
    ;;
  *)
    cat <<EOF
oncall - push notification CLI

Commands:
  notify|n  <title> <body> [ui_json]   Send a push notification
  respond|r <text> [messageId]         Reply to latest (or specific) notification
  messages|m                           List message history
  subs|s                               List subscriptions
  purge|p                              Remove stale subscriptions
  webhooks|w                           List webhooks
  webhook-add|wa <url> [events]        Add webhook (events: response,notification,*)
  webhook-rm|wr <url>                  Remove webhook
  wait <messageId> [timeout]           Wait for a response (default 300s)

Environment:
  ONCALL_URL   Base URL (e.g. https://oncall.viruus.zip)
  ONCALL_KEY   API key
EOF
    ;;
esac
