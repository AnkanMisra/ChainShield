#!/usr/bin/env bash
# kh.sh — thin wrapper around KeeperHub's REST API for local dev.
# Reads KEEPERHUB_API_KEY (and optional KEEPERHUB_API_URL) from .env.local.
#
# Usage:
#   ./scripts/kh.sh list                               # GET /api/workflows
#   ./scripts/kh.sh get <workflow-id>                  # GET /api/workflows/<id>
#   ./scripts/kh.sh run <workflow-id> [inputs-json]    # POST execute, optional JSON body
#   ./scripts/kh.sh status <execution-id>              # GET /api/executions/<id>
#   ./scripts/kh.sh ping                               # auth sanity check (== list, prints status only)
#
# Notes:
#   - All output goes to stdout, status to stderr.
#   - Pipe through `jq` for pretty-printing: ./scripts/kh.sh list | jq

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"
if [ ! -f "$ENV_FILE" ]; then
  echo "kh.sh: missing $ENV_FILE in $(pwd)" >&2
  exit 1
fi

# Read a single VAR=value line from .env.local, stripping surrounding quotes.
load_var() {
  grep -E "^$1=" "$ENV_FILE" \
    | head -n1 \
    | cut -d= -f2- \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

KEY="$(load_var KEEPERHUB_API_KEY)"
URL_BASE="$(load_var KEEPERHUB_API_URL)"
URL_BASE="${URL_BASE:-https://app.keeperhub.com}"

if [ -z "$KEY" ]; then
  echo "kh.sh: KEEPERHUB_API_KEY is empty in $ENV_FILE" >&2
  exit 1
fi

CMD="${1:-help}"
shift || true

usage() {
  sed -n '2,15p' "$0"
}

case "$CMD" in
  ping)
    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer $KEY" \
      "${URL_BASE}/api/workflows")
    echo "HTTP $code from ${URL_BASE}/api/workflows"
    [ "$code" = "200" ] || exit 1
    ;;
  list)
    curl -sS \
      -H "Authorization: Bearer $KEY" \
      -H "Accept: application/json" \
      "${URL_BASE}/api/workflows"
    ;;
  get)
    [ $# -ge 1 ] || { echo "usage: kh.sh get <workflow-id>" >&2; exit 1; }
    curl -sS \
      -H "Authorization: Bearer $KEY" \
      -H "Accept: application/json" \
      "${URL_BASE}/api/workflows/$1"
    ;;
  run)
    [ $# -ge 1 ] || { echo "usage: kh.sh run <workflow-id> [inputs-json]" >&2; exit 1; }
    INPUTS_JSON="${2:-{\}}"
    curl -sS -X POST \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"inputs\": $INPUTS_JSON}" \
      "${URL_BASE}/api/workflow/$1/execute"
    ;;
  status)
    [ $# -ge 1 ] || { echo "usage: kh.sh status <execution-id>" >&2; exit 1; }
    curl -sS \
      -H "Authorization: Bearer $KEY" \
      -H "Accept: application/json" \
      "${URL_BASE}/api/executions/$1"
    ;;
  help|-h|--help|"")
    usage
    ;;
  *)
    echo "kh.sh: unknown command: $CMD" >&2
    usage
    exit 1
    ;;
esac
