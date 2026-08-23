#!/usr/bin/env bash
# Update Jackline on a VM (CI via gcloud compute ssh / scp, or manual).
#
# Env:
#   JACKLINE_ROOT       Install directory (default: /opt/jackline)
#   GIT_REPO            Clone URL if ROOT is not yet a git checkout (required then)
#   GIT_SHA             Commit to check out (preferred in CI)
#   GIT_REF             Branch/ref when GIT_SHA is unset (default: main)
#   GITHUB_TOKEN_FILE   Optional path to a token file (read once, then shredded)
#   GITHUB_TOKEN        Optional token in env (prefer TOKEN_FILE — avoids argv leaks)
#   ENV_PROD_SRC        Optional path to a rendered .env.prod to install at ROOT
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
REF="${GIT_REF:-main}"
TOKEN=""

cleanup() {
  if [[ -n "${TOKEN}" ]]; then
    unset TOKEN GITHUB_TOKEN || true
  fi
  if [[ -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
    shred -u "${GITHUB_TOKEN_FILE}" 2>/dev/null || rm -f "${GITHUB_TOKEN_FILE}"
  fi
}
trap cleanup EXIT

load_token() {
  if [[ -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
    TOKEN="$(tr -d '\n' <"${GITHUB_TOKEN_FILE}")"
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    TOKEN="${GITHUB_TOKEN}"
  fi
}

# Authenticated github.com URL for a single git invocation (token not stored in remotes).
auth_github_url() {
  local url="$1"
  if [[ -n "${TOKEN}" && "${url}" == https://github.com/* ]]; then
    printf '%s\n' "${url/https:\/\/github.com\//https:\/\/x-access-token:${TOKEN}@github.com\/}"
  else
    printf '%s\n' "${url}"
  fi
}

git_fetch_auth() {
  if [[ -n "${TOKEN}" ]]; then
    git -c "http.extraHeader=Authorization: Bearer ${TOKEN}" "$@"
  else
    git "$@"
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi
  echo "Docker missing — installing (startup bootstrap incomplete)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
}

echo "=== remote-deploy $(date -u) root=${ROOT} ==="

load_token
ensure_docker

if [[ ! -d "${ROOT}/.git" ]]; then
  if [[ -z "${GIT_REPO:-}" ]]; then
    echo "error: ${ROOT} is not a git checkout and GIT_REPO is unset" >&2
    exit 1
  fi
  if [[ -z "${TOKEN}" && "${GIT_REPO}" == https://github.com/* ]]; then
    echo "error: private github.com clone needs GITHUB_TOKEN_FILE or GITHUB_TOKEN" >&2
    exit 1
  fi
  echo "Bootstrapping ${ROOT} from ${GIT_REPO}"
  mkdir -p "$(dirname "${ROOT}")"
  rm -rf "${ROOT}"
  git clone "$(auth_github_url "${GIT_REPO}")" "${ROOT}"
  # Never leave credentials in the remote URL.
  git -C "${ROOT}" remote set-url origin "${GIT_REPO}"
fi

cd "${ROOT}"

if [[ -n "${ENV_PROD_SRC:-}" ]]; then
  if [[ ! -f "${ENV_PROD_SRC}" ]]; then
    echo "error: ENV_PROD_SRC=${ENV_PROD_SRC} not found" >&2
    exit 1
  fi
  install -m 600 "${ENV_PROD_SRC}" "${ROOT}/.env.prod"
  shred -u "${ENV_PROD_SRC}" 2>/dev/null || rm -f "${ENV_PROD_SRC}"
  echo "Installed .env.prod from CI-rendered file"
fi

git remote -v
git_fetch_auth fetch --prune origin

if [[ -n "${GIT_SHA:-}" ]]; then
  echo "Checking out ${GIT_SHA}"
  git_fetch_auth fetch --depth 1 origin "${GIT_SHA}" 2>/dev/null \
    || git_fetch_auth fetch origin "${GIT_SHA}" 2>/dev/null \
    || true
  git checkout -f "${GIT_SHA}"
else
  echo "Checking out origin/${REF}"
  git_fetch_auth fetch origin "${REF}"
  git checkout -f "origin/${REF}"
fi

if [[ ! -f .env.prod ]]; then
  echo "error: missing ${ROOT}/.env.prod" >&2
  echo "CI should scp a rendered env via ENV_PROD_SRC, or first-boot startup must write it." >&2
  exit 1
fi

docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d

echo "=== remote-deploy complete ==="
