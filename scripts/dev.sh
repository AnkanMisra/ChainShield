#!/usr/bin/env bash
# dev.sh — run the Fastify risk-gate (8787) and the Astro web (4321) in parallel.
# Either Ctrl+C in this terminal stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[chainshield] starting risk-gate on http://127.0.0.1:8787"
echo "[chainshield] starting web on      http://127.0.0.1:4321"
echo "[chainshield] press Ctrl+C to stop both"
echo ""

# kill all children on exit
cleanup() {
  trap '' INT TERM
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# server: prefix output for clarity
( bun run --watch src/risk-gate/server.ts 2>&1 | sed -u 's/^/[server] /' ) &
SERVER_PID=$!

# web: prefix output too
( cd web && bun run dev 2>&1 | sed -u 's/^/[web]    /' ) &
WEB_PID=$!

# wait until either child exits
wait -n "$SERVER_PID" "$WEB_PID" 2>/dev/null || true
