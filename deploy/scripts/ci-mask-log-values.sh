#!/usr/bin/env bash
# Register GitHub Actions log masks for deploy identifiers and IPs.
# Does not print the values. Safe to call multiple times.
set -euo pipefail

mask() {
  local v="${1:-}"
  if [[ -z "${v}" ]]; then
    return 0
  fi
  echo "::add-mask::${v}"
}

mask "${JACKLINE_DOMAIN:-}"
mask "${JACKLINE_DOCS_DOMAIN:-}"
mask "${JACKLINE_CADDY_EMAIL:-}"
mask "${CLOUD_SQL_PRIVATE_IP:-}"
mask "${CLOUD_SQL_CONNECTION_NAME:-}"
mask "${CLOUD_SQL_INSTANCE_NAME:-}"

if [[ -n "${JACKLINE_DOMAIN:-}" ]]; then
  mask "https://${JACKLINE_DOMAIN}"
  mask "http://${JACKLINE_DOMAIN}"
  mask "docs.${JACKLINE_DOMAIN}"
  mask "https://docs.${JACKLINE_DOMAIN}"
fi
if [[ -n "${JACKLINE_DOCS_DOMAIN:-}" ]]; then
  mask "https://${JACKLINE_DOCS_DOMAIN}"
fi
