#!/usr/bin/env bash
# Decision tests for remote-deploy.sh. No Docker daemon.
# Exercises the skip rule: same image ID and same effective config hash.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/deploy/scripts/remote-deploy.sh"
LIB="$(mktemp)"
trap 'rm -f "${LIB}"' EXIT

if ! grep -q '^# BEGIN deploy-skip$' "${SCRIPT}" || ! grep -q '^# END deploy-skip$' "${SCRIPT}"; then
  echo "missing deploy-skip markers in ${SCRIPT}" >&2
  exit 1
fi
sed -n '/^# BEGIN deploy-skip$/,/^# END deploy-skip$/p' "${SCRIPT}" >"${LIB}"
# shellcheck source=/dev/null
source "${LIB}"

fail=0
expect() {
  local name="$1"
  local got="$2"
  local want="$3"
  if [[ "${got}" != "${want}" ]]; then
    echo "FAIL ${name}: got [${got}] want [${want}]" >&2
    fail=1
  else
    echo "ok ${name}"
  fi
}

A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

expect "identical" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${A}" h1 h1)" skip
expect "case" "$(skip_reason 1 running "SHA256:${A}" "${A}" h1 h1)" skip
expect "image" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${B}" h1 h1)" image
expect "config" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${A}" h1 h2)" config
expect "starting" "$(skip_reason 1 starting "sha256:${A}" "sha256:${A}" h1 h1)" not-ready
expect "unhealthy" "$(skip_reason 1 unhealthy "sha256:${A}" "sha256:${A}" h1 h1)" not-ready
expect "none" "$(skip_reason 0 healthy "sha256:${A}" "sha256:${A}" h1 h1)" no-container
expect "replicas" "$(skip_reason 2 healthy "sha256:${A}" "sha256:${A}" h1 h1)" replicas
expect "bad-replicas" "$(skip_reason x healthy "sha256:${A}" "sha256:${A}" h1 h1)" no-container
expect "missing-hash" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${A}" "" h1)" missing-identity
expect "unset-label" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${A}" unset h1)" missing-identity
expect "no-value" "$(skip_reason 1 healthy "sha256:${A}" "sha256:${A}" "<no value>" h1)" missing-identity
expect "migrate-skip" "$(migrate_skip_reason "sha256:${A}" "sha256:${A}" h1 h1)" skip
expect "migrate-record" "$(migrate_skip_reason "" "sha256:${A}" "" h1)" no-record
expect "migrate-image" "$(migrate_skip_reason "sha256:${A}" "sha256:${B}" h1 h1)" image

state="$(mktemp)"
rm -f "${state}"
if migrate_state_read "${state}" >/dev/null 2>&1; then
  echo "FAIL missing state should fail" >&2
  fail=1
else
  echo "ok missing-state"
fi
migrate_state_write "${state}" "sha256:${A}" h1
out="$(migrate_state_read "${state}")"
expect "state-image" "${out%%$'\n'*}" "sha256:${A}"
expect "state-hash" "${out#*$'\n'}" "h1"
printf 'image_id=\nconfig_hash=\n' >"${state}"
if migrate_state_read "${state}" >/dev/null 2>&1; then
  echo "FAIL empty state should fail" >&2
  fail=1
else
  echo "ok empty-state"
fi
rm -f "${state}"

base='{"services":{"api":{"image":"ghcr.io/example/jackline-api:sha-aaa1111","build":{"context":"/opt/jackline"},"environment":{"DATABASE_URL":"postgresql://jackline:secret@10.0.0.1/jackline","JACKLINE_API_IMAGE":"ghcr.io/example/jackline-api:sha-aaa1111","NODE_ENV":"production"},"labels":{"dev.jackline.effective-config-sha":"unset"},"command":null}}}'
other='{"services":{"api":{"command":null,"labels":{"dev.jackline.effective-config-sha":"abcdef"},"environment":{"NODE_ENV":"production","JACKLINE_API_IMAGE":"ghcr.io/example/jackline-api:sha-bbb2222","DATABASE_URL":"postgresql://jackline:secret@10.0.0.1/jackline"},"image":"ghcr.io/example/jackline-api:sha-bbb2222","build":{"context":"/somewhere-else"}}}}'
changed='{"services":{"api":{"image":"ghcr.io/example/jackline-api:sha-aaa1111","build":{"context":"/opt/jackline"},"environment":{"DATABASE_URL":"postgresql://jackline:secret@10.0.0.2/jackline","JACKLINE_API_IMAGE":"ghcr.io/example/jackline-api:sha-aaa1111","NODE_ENV":"production"},"labels":{"dev.jackline.effective-config-sha":"unset"},"command":null}}}'
otel_a='{"services":{"otel-collector":{"image":"otel/opentelemetry-collector-contrib:0.128.0","labels":{"dev.jackline.otel-config-sha":"abc","dev.jackline.effective-config-sha":"111"}}}}'
otel_b='{"services":{"otel-collector":{"image":"otel/opentelemetry-collector-contrib:9.9.9","labels":{"dev.jackline.effective-config-sha":"222","dev.jackline.otel-config-sha":"abc"}}}}'
otel_c='{"services":{"otel-collector":{"image":"otel/opentelemetry-collector-contrib:0.128.0","labels":{"dev.jackline.effective-config-sha":"222","dev.jackline.otel-config-sha":"def"}}}}'

h1="$(printf '%s' "${base}" | effective_config_hash api)"
h2="$(printf '%s' "${other}" | effective_config_hash api)"
h3="$(printf '%s' "${changed}" | effective_config_hash api)"
expect "hash-stable" "${h1}" "${h2}"
if [[ "${h1}" == "${h3}" ]]; then
  echo "FAIL hash should change when DATABASE_URL changes" >&2
  fail=1
else
  echo "ok hash-env"
fi
o1="$(printf '%s' "${otel_a}" | effective_config_hash otel-collector)"
o2="$(printf '%s' "${otel_b}" | effective_config_hash otel-collector)"
o3="$(printf '%s' "${otel_c}" | effective_config_hash otel-collector)"
expect "hash-ignores-image-ref" "${o1}" "${o2}"
if [[ "${o1}" == "${o3}" ]]; then
  echo "FAIL otel config sha should change the hash" >&2
  fail=1
else
  echo "ok hash-otel"
fi

ref="$(printf '%s' "${base}" | service_image_ref api)"
expect "image-ref" "${ref}" "ghcr.io/example/jackline-api:sha-aaa1111"

if printf '%s' '{"services":{}}' | effective_config_hash api; then
  echo "FAIL missing service should exit 2" >&2
  fail=1
else
  rc=$?
  expect "missing-service" "${rc}" "2"
fi

images="$(printf '%s' '{"services":{"web":{"image":"web:1"},"api":{"image":"api:1"}}}' | list_compose_images)"
expect "image-list" "${images}" $'api\tapi:1\nweb\tweb:1'

if [[ "${fail}" -ne 0 ]]; then
  echo "deploy-skip tests failed" >&2
  exit 1
fi
echo "deploy-skip tests passed"
