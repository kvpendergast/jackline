#!/usr/bin/env bash
# Update Jackline on a VM that was bootstrapped by deploy/pulumi/vm.
# Intended for CI (gcloud compute ssh … < remote-deploy.sh) or manual use.
#
# Env:
#   JACKLINE_ROOT  Install directory (default: /opt/jackline)
#   GIT_SHA        Commit to check out (default: origin/main tip after fetch)
#   GIT_REF        Branch/ref to fetch when GIT_SHA is unset (default: main)
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
REF="${GIT_REF:-main}"

if [[ ! -d "${ROOT}/.git" ]]; then
  echo "error: ${ROOT} is not a git checkout (run pulumi up for vm/ first)" >&2
  exit 1
fi

cd "${ROOT}"

echo "=== remote-deploy $(date -u) root=${ROOT} ==="

git remote -v
git fetch --prune origin

if [[ -n "${GIT_SHA:-}" ]]; then
  echo "Checking out ${GIT_SHA}"
  git checkout -f "${GIT_SHA}"
else
  echo "Checking out origin/${REF}"
  git checkout -f "origin/${REF}"
fi

if [[ ! -f .env.prod ]]; then
  echo "error: missing ${ROOT}/.env.prod (bootstrap via pulumi up)" >&2
  exit 1
fi

docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d

echo "=== remote-deploy complete ==="
