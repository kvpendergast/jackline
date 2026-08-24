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
ASKPASS=""

cleanup() {
  if [[ -n "${ASKPASS}" && -f "${ASKPASS}" ]]; then
    shred -u "${ASKPASS}" 2>/dev/null || rm -f "${ASKPASS}"
  fi
  unset TOKEN GITHUB_TOKEN GIT_ASKPASS GIT_TERMINAL_PROMPT || true
  if [[ -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
    shred -u "${GITHUB_TOKEN_FILE}" 2>/dev/null || rm -f "${GITHUB_TOKEN_FILE}"
  fi
}
trap cleanup EXIT

load_token() {
  if [[ -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
    TOKEN="$(tr -d '\r\n' <"${GITHUB_TOKEN_FILE}")"
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    TOKEN="$(printf '%s' "${GITHUB_TOKEN}" | tr -d '\r\n')"
  fi
  if [[ -n "${TOKEN}" ]]; then
    echo "GitHub token loaded (${#TOKEN} chars)"
  else
    echo "warning: no GitHub token available for private repo fetch" >&2
  fi
}

# Remove leftover credential rewrites from earlier deploys (expired tokens → "invalid credentials").
sanitize_git_config() {
  local key
  while IFS= read -r key; do
    [[ -z "${key}" ]] && continue
    git config --global --unset-all "${key}" 2>/dev/null || true
  done < <(git config --global --get-regexp '^url\..*\.insteadof$' 2>/dev/null | awk '{print $1}' || true)

  # Drop any helper that might inject stale creds.
  git config --global --unset-all credential.helper 2>/dev/null || true
}

# Prefer GIT_ASKPASS so the token never lands in remotes or insteadOf config.
setup_askpass() {
  if [[ -z "${TOKEN}" ]]; then
    return 0
  fi
  ASKPASS="$(mktemp)"
  chmod 700 "${ASKPASS}"
  cat >"${ASKPASS}" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' "x-access-token" ;;
  *Password*) printf '%s\n' "${JACKLINE_GIT_PASSWORD}" ;;
  *) printf '%s\n' "${JACKLINE_GIT_PASSWORD}" ;;
esac
EOF
  chmod 700 "${ASKPASS}"
  export JACKLINE_GIT_PASSWORD="${TOKEN}"
  export GIT_ASKPASS="${ASKPASS}"
  export GIT_TERMINAL_PROMPT=0
}

git_auth() {
  if [[ -n "${TOKEN}" ]]; then
    # Disable interactive prompts; ASKPASS supplies x-access-token + token.
    GIT_ASKPASS="${ASKPASS}" GIT_TERMINAL_PROMPT=0 git -c credential.helper= "$@"
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
sanitize_git_config
setup_askpass
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
  git_auth clone "${GIT_REPO}" "${ROOT}"
fi

cd "${ROOT}"

# Always pin a clean origin URL (no embedded credentials from prior runs).
if [[ -n "${GIT_REPO:-}" ]]; then
  git remote set-url origin "${GIT_REPO}"
elif git remote get-url origin >/dev/null 2>&1; then
  clean="$(git remote get-url origin | sed -E 's#https://[^@]+@github.com/#https://github.com/#')"
  git remote set-url origin "${clean}"
fi

if [[ -n "${ENV_PROD_SRC:-}" ]]; then
  if [[ ! -f "${ENV_PROD_SRC}" ]]; then
    echo "error: ENV_PROD_SRC=${ENV_PROD_SRC} not found" >&2
    exit 1
  fi
  install -m 600 "${ENV_PROD_SRC}" "${ROOT}/.env.prod"
  shred -u "${ENV_PROD_SRC}" 2>/dev/null || rm -f "${ENV_PROD_SRC}"
  echo "Installed .env.prod from CI-rendered file"
fi

echo "origin=$(git remote get-url origin)"
git_auth fetch --prune origin

if [[ -n "${GIT_SHA:-}" ]]; then
  echo "Checking out ${GIT_SHA}"
  git_auth fetch --depth 1 origin "${GIT_SHA}" 2>/dev/null \
    || git_auth fetch origin "${GIT_SHA}" 2>/dev/null \
    || true
  git checkout -f "${GIT_SHA}"
else
  echo "Checking out origin/${REF}"
  git_auth fetch origin "${REF}"
  git checkout -f "origin/${REF}"
fi

if [[ ! -f .env.prod ]]; then
  echo "error: missing ${ROOT}/.env.prod" >&2
  echo "CI should scp a rendered env via ENV_PROD_SRC, or first-boot startup must write it." >&2
  exit 1
fi

# e2-small OOMs / wedges sshd when compose builds api+web+docs+gateway in parallel.
# Prefer slower sequential builds over a hung guest that later deploys cannot SSH into.
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"

docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d

# Force Caddy to retry Let's Encrypt after DNS/IP changes. A plain `up` leaves a
# running caddy container alone, which can stick with a failed cert obtain from
# when the A record still pointed elsewhere (TLS then fails with ERR_SSL_PROTOCOL_ERROR).
echo "Restarting Caddy to refresh ACME certificates…"
docker compose -f deploy/compose.prod.yml --env-file .env.prod up -d --force-recreate --no-deps caddy

SITE_HOST="$(grep -E '^JACKLINE_SITE_ADDRESS=' .env.prod | head -1 | cut -d= -f2- | tr -d '\r' || true)"
if [[ -n "${SITE_HOST}" && "${SITE_HOST}" != http* ]]; then
  echo "Waiting for TLS on ${SITE_HOST}…"
  ok=0
  for _ in $(seq 1 30); do
    if echo | openssl s_client -connect "127.0.0.1:443" -servername "${SITE_HOST}" 2>/dev/null \
      | grep -q 'BEGIN CERTIFICATE'; then
      ok=1
      break
    fi
    sleep 2
  done
  if [[ "${ok}" -ne 1 ]]; then
    echo "warning: TLS not ready for ${SITE_HOST} after ~60s — dumping Caddy logs" >&2
    docker compose -f deploy/compose.prod.yml --env-file .env.prod logs --tail=80 caddy >&2 || true
  else
    echo "TLS handshake OK for ${SITE_HOST}"
  fi
fi

echo "=== remote-deploy complete ==="
