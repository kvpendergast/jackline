#!/usr/bin/env bash
set -euo pipefail

HOST="${WEB_SMOKE_HOST:-127.0.0.1}"
PORT="${WEB_SMOKE_PORT:-4173}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "${ROOT_DIR}/dist" ]]; then
  echo "web smoke: dist/ missing — run pnpm build first" >&2
  exit 1
fi

pnpm exec vite preview --host "${HOST}" --port "${PORT}" &
PID=$!

cleanup() {
  kill "${PID}" 2>/dev/null || true
  wait "${PID}" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "http://${HOST}:${PORT}/" 2>/dev/null | grep -q 'id="root"'; then
    echo "web preview smoke ok"
    exit 0
  fi
  sleep 1
done

echo "web preview did not become ready at http://${HOST}:${PORT}/" >&2
exit 1
