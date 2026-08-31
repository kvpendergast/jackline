#!/usr/bin/env bash
# Logical Postgres backup before migrations / rolling deploy.
# Fails if a backup cannot be written — do not deploy without a recoverable dump.
#
# Env:
#   JACKLINE_ROOT              Install dir (default: /opt/jackline)
#   JACKLINE_COMPOSE_FILE      Compose file (default: deploy/compose.prod.yml)
#   GIT_SHA                    Optional commit id for the backup filename
#   JACKLINE_BACKUP_KEEP       Local dumps to retain (default: 7)
#   JACKLINE_BACKUP_GCS_PREFIX Optional gs://bucket/prefix/ for off-VM copy
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
COMPOSE_FILE="${JACKLINE_COMPOSE_FILE:-deploy/compose.prod.yml}"
KEEP="${JACKLINE_BACKUP_KEEP:-7}"
SHA="${GIT_SHA:-manual}"
BACKUP_DIR="${ROOT}/backups"

if [[ ! -f "${ROOT}/.env.prod" ]]; then
  echo "error: ${ROOT}/.env.prod missing — cannot backup" >&2
  exit 1
fi

DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ROOT}/.env.prod" | head -1 | cut -d= -f2- | tr -d '\r' || true)"

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ROOT}/.env.prod" "$@"
}

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/pre-deploy-${SHA}-${STAMP}.sql.gz"

echo "Pre-deploy backup → ${BACKUP_FILE}"

if [[ -n "${DATABASE_URL}" ]]; then
  if [[ "${DATABASE_URL}" == *"@postgres:"* || "${DATABASE_URL}" == *"@postgres/"* ]]; then
    cd "${ROOT}"
    if ! compose ps -q postgres 2>/dev/null | grep -q .; then
      echo "error: DATABASE_URL targets compose postgres but container is not running" >&2
      exit 1
    fi
    compose exec -T postgres pg_dump -U jackline -d jackline --no-owner --no-acl | gzip >"${BACKUP_FILE}"
  else
    docker run --rm -e DATABASE_URL postgres:16-alpine \
      sh -c 'pg_dump "$DATABASE_URL" --no-owner --no-acl' | gzip >"${BACKUP_FILE}"
  fi
elif cd "${ROOT}" && compose ps -q postgres 2>/dev/null | grep -q .; then
  compose exec -T postgres pg_dump -U jackline -d jackline --no-owner --no-acl | gzip >"${BACKUP_FILE}"
else
  echo "error: no DATABASE_URL in .env.prod and no postgres container — refusing to deploy without backup" >&2
  exit 1
fi

if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo "error: backup file is empty" >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

SIZE="$(du -h "${BACKUP_FILE}" | awk '{print $1}')"
echo "Backup OK (${SIZE})"

if [[ -n "${JACKLINE_BACKUP_GCS_PREFIX:-}" ]]; then
  if ! command -v gsutil >/dev/null 2>&1; then
    echo "error: JACKLINE_BACKUP_GCS_PREFIX set but gsutil not available" >&2
    exit 1
  fi
  dest="${JACKLINE_BACKUP_GCS_PREFIX%/}/$(basename "${BACKUP_FILE}")"
  echo "Uploading backup to ${dest}…"
  gsutil -q cp "${BACKUP_FILE}" "${dest}"
  echo "Uploaded to GCS"
fi

# Drop oldest local dumps beyond KEEP (newest first).
mapfile -t OLD < <(ls -1t "${BACKUP_DIR}"/pre-deploy-*.sql.gz 2>/dev/null || true)
if ((${#OLD[@]} > KEEP)); then
  for f in "${OLD[@]:KEEP}"; do
    rm -f "${f}"
    echo "Pruned old backup ${f}"
  done
fi
