#!/usr/bin/env bash
# Update Jackline on a VM (CI via gcloud compute ssh, or manual).
#
# Env:
#   JACKLINE_ROOT  Install directory (default: /opt/jackline)
#   GIT_REPO       Clone URL if ROOT is not yet a git checkout (required then)
#   GIT_SHA        Commit to check out (preferred in CI)
#   GIT_REF        Branch/ref when GIT_SHA is unset (default: main)
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
REF="${GIT_REF:-main}"

echo "=== remote-deploy $(date -u) root=${ROOT} ==="

if [[ ! -d "${ROOT}/.git" ]]; then
  if [[ -z "${GIT_REPO:-}" ]]; then
    echo "error: ${ROOT} is not a git checkout and GIT_REPO is unset" >&2
    echo "Set GIT_REPO (e.g. https://github.com/org/jackline.git) or wait for VM startup bootstrap." >&2
    exit 1
  fi
  echo "Bootstrapping ${ROOT} from ${GIT_REPO}"
  mkdir -p "$(dirname "${ROOT}")"
  rm -rf "${ROOT}"
  git clone "${GIT_REPO}" "${ROOT}"
fi

cd "${ROOT}"

git remote -v
git fetch --prune origin

if [[ -n "${GIT_SHA:-}" ]]; then
  echo "Checking out ${GIT_SHA}"
  # Shallow clones may not have the SHA; fetch it explicitly.
  git fetch --depth 1 origin "${GIT_SHA}" 2>/dev/null \
    || git fetch origin "${GIT_SHA}" 2>/dev/null \
    || true
  git checkout -f "${GIT_SHA}"
else
  echo "Checking out origin/${REF}"
  git fetch origin "${REF}"
  git checkout -f "origin/${REF}"
fi

if [[ ! -f .env.prod ]]; then
  echo "error: missing ${ROOT}/.env.prod" >&2
  echo "First-boot startup script should write this; check: sudo tail -100 /var/log/jackline-startup.log" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not installed yet (startup script still running?)" >&2
  echo "Check: sudo tail -100 /var/log/jackline-startup.log" >&2
  exit 1
fi

docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d

echo "=== remote-deploy complete ==="
