#!/usr/bin/env bash
# Update Jackline on a VM (CI via gcloud compute ssh / scp, or manual).
#
# Rolling cutover (app services) — the live container is never replaced in place:
#   1. Build new images first. Running containers keep serving the old image.
#   2. `compose up --scale=2 --no-recreate` starts a *second* replica from the
#      new image. Compose will not recreate the existing replica.
#   3. Wait until Docker health (compose/Dockerfile HEALTHCHECK) is `healthy`
#      on that new replica. Caddy's active checks skip it until /health is OK.
#   4. Only then stop/remove the old replica.
# If the new replica never becomes healthy, it is deleted and the old replica
# keeps serving. A cancelled CI SSH session cannot SIGKILL the deploy: the
# script re-execs under systemd-run (unit=jackline-deploy).
#
# Env:
#   JACKLINE_ROOT       Install directory (default: /opt/jackline)
#   GIT_REPO            Clone URL if ROOT is not yet a git checkout (required then)
#   GIT_SHA             Commit to check out (preferred in CI)
#   GIT_REF             Branch/ref when GIT_SHA is unset (default: main)
#   GITHUB_TOKEN_FILE   Optional path to a token file (read once, then shredded)
#   GITHUB_TOKEN        Optional token in env (prefer TOKEN_FILE — avoids argv leaks)
#   ENV_PROD_SRC        Optional path to a rendered .env.prod to install at ROOT
#   JACKLINE_DEPLOY_INNER  Set by systemd-run re-exec (do not set manually)
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
REF="${GIT_REF:-main}"
TOKEN=""
ASKPASS=""
COMPOSE_FILE="deploy/compose.prod.yml"
HEALTH_TIMEOUT="${JACKLINE_HEALTH_TIMEOUT:-240}"

# Re-exec under systemd so a cancelled CI SSH session does not SIGKILL docker builds.
if [[ -z "${JACKLINE_DEPLOY_INNER:-}" && -d /run/systemd/system ]] && command -v systemd-run >/dev/null 2>&1; then
  if systemctl is-active --quiet jackline-deploy.service 2>/dev/null; then
    echo "Another deploy is running; waiting for jackline-deploy.service to finish…"
    deadline=$((SECONDS + 7200))
    while systemctl is-active --quiet jackline-deploy.service 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        echo "error: timed out waiting for jackline-deploy.service" >&2
        systemctl status jackline-deploy.service --no-pager >&2 || true
        exit 1
      fi
      sleep 10
    done
  fi
  systemctl reset-failed jackline-deploy.service 2>/dev/null || true
  extra=()
  for k in GIT_SHA GIT_REPO GIT_REF ENV_PROD_SRC GITHUB_TOKEN_FILE GITHUB_TOKEN JACKLINE_ROOT JACKLINE_HEALTH_TIMEOUT; do
    if [[ -n "${!k:-}" ]]; then
      extra+=(-E "${k}=${!k}")
    fi
  done
  echo "Re-executing under systemd-run (unit=jackline-deploy)…"
  exec systemd-run --wait --collect --unit=jackline-deploy \
    --property=Type=oneshot \
    --property=TimeoutStartSec=2h \
    --property=KillMode=mixed \
    -E JACKLINE_DEPLOY_INNER=1 \
    "${extra[@]}" \
    /bin/bash "$(readlink -f "$0")"
fi

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
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME")" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
}

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file .env.prod "$@"
}

container_health() {
  local id="$1"
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}" 2>/dev/null || echo "missing"
}

container_number() {
  docker inspect -f '{{index .Config.Labels "com.docker.compose.container-number"}}' "$1" 2>/dev/null || echo ""
}

wait_healthy() {
  local id="$1"
  local timeout="$2"
  local start
  start="$(date +%s)"
  while true; do
    local status
    status="$(container_health "${id}")"
    if [[ "${status}" == "healthy" ]]; then
      return 0
    fi
    # Images without a HEALTHCHECK: inspect returns State.Status ("running").
    # With a HEALTHCHECK it returns starting/healthy/unhealthy — never succeed early.
    if [[ "${status}" == "running" ]]; then
      return 0
    fi
    if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" || "${status}" == "missing" ]]; then
      local now
      now="$(date +%s)"
      if (( now - start > 30 )); then
        echo "container ${id} is ${status}" >&2
        docker logs --tail=40 "${id}" >&2 || true
        return 1
      fi
    fi
    local now
    now="$(date +%s)"
    if (( now - start >= timeout )); then
      echo "timeout waiting for healthy ${id} (last status=${status})" >&2
      docker logs --tail=40 "${id}" >&2 || true
      return 1
    fi
    sleep 2
  done
}

reload_caddy() {
  local cid
  cid="$(compose ps -q caddy 2>/dev/null | head -1 || true)"
  if [[ -z "${cid}" ]]; then
    return 0
  fi
  docker exec "${cid}" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
}

# Keep the live replica until a new replica from the freshly built image is healthy.
roll_service() {
  local svc="$1"
  local timeout="${2:-${HEALTH_TIMEOUT}}"
  local old new replacement number
  local -a existing

  mapfile -t existing < <(compose ps -q "${svc}" 2>/dev/null | sed '/^$/d' || true)

  if [[ ${#existing[@]} -eq 0 ]]; then
    echo "Starting ${svc} (no existing replica)"
    compose up -d --no-deps --wait --wait-timeout "${timeout}" "${svc}"
    return 0
  fi

  old="${existing[0]}"
  if [[ ${#existing[@]} -gt 1 ]]; then
    echo "Found ${#existing[@]} ${svc} replicas; keeping ${old:0:12}, removing extras before roll"
    local id
    for id in "${existing[@]:1}"; do
      docker rm -f "${id}" || true
    done
  fi

  echo "Rolling ${svc}: keeping ${old:0:12} until the new replica is healthy"
  compose up -d --no-deps --no-recreate --scale "${svc}=2" "${svc}"

  new="$(compose ps -q "${svc}" | grep -vx "${old}" | head -1 || true)"
  if [[ -z "${new}" ]]; then
    echo "error: ${svc} did not start a second replica" >&2
    number="$(container_number "${old}")"
    if [[ "${number}" == "1" ]]; then
      compose up -d --no-deps --no-recreate --scale "${svc}=1" "${svc}" || true
    fi
    return 1
  fi

  if ! wait_healthy "${new}" "${timeout}"; then
    echo "error: new ${svc} replica ${new:0:12} failed health; removing it, old replica stays" >&2
    docker rm -f "${new}" || true
    reload_caddy
    # If the survivor is *-1, scale-down is safe. If it is *-2, do not scale to 1:
    # Compose would create a fresh *-1 and delete *-2.
    number="$(container_number "${old}")"
    if [[ "${number}" == "1" ]]; then
      compose up -d --no-deps --no-recreate --scale "${svc}=1" "${svc}" || true
    fi
    return 1
  fi

  echo "New ${svc} ${new:0:12} healthy — draining old ${old:0:12}"
  reload_caddy
  docker stop -t 20 "${old}" || true
  docker rm -f "${old}" || true
  reload_caddy

  # Compose scale-down to 1 always keeps the lowest index (*-1) and deletes *-2.
  # If the healthy replica is already *-1, we are done. If it is *-2, recreate
  # *-1 from the new image *while *-2 still serves*, then scale down.
  number="$(container_number "${new}")"
  if [[ "${number}" == "1" ]]; then
    compose up -d --no-deps --no-recreate --scale "${svc}=1" "${svc}"
    echo "Rolled ${svc}"
    return 0
  fi

  echo "Recreating ${svc}-1 from the new image while ${new:0:12} still serves"
  compose up -d --no-deps --no-recreate --scale "${svc}=2" "${svc}"
  replacement="$(compose ps -q "${svc}" | grep -vx "${new}" | head -1 || true)"
  if [[ -z "${replacement}" ]]; then
    echo "warning: ${svc}-1 was not recreated; leaving healthy replica ${new:0:12}" >&2
    echo "Rolled ${svc}"
    return 0
  fi
  if ! wait_healthy "${replacement}" "${timeout}"; then
    echo "warning: replacement ${svc} ${replacement:0:12} failed health; keeping ${new:0:12}" >&2
    docker rm -f "${replacement}" || true
    reload_caddy
    echo "Rolled ${svc} (survivor may be named *-2 until the next deploy)"
    return 0
  fi
  compose up -d --no-deps --no-recreate --scale "${svc}=1" "${svc}"
  reload_caddy
  echo "Rolled ${svc}"
}

ensure_caddy() {
  local recreate=0
  local cid
  cid="$(compose ps -q caddy 2>/dev/null | head -1 || true)"
  if [[ -z "${cid}" ]]; then
    recreate=1
  elif ! echo | openssl s_client -connect "127.0.0.1:443" -servername "${SITE_HOST:-localhost}" 2>/dev/null \
    | grep -q 'BEGIN CERTIFICATE'; then
    echo "Caddy is up but TLS is not serving a cert — recreating so ACME retries"
    recreate=1
  fi

  if [[ "${recreate}" -eq 1 ]]; then
    compose up -d --no-deps --wait --wait-timeout 60 caddy || compose up -d --no-deps caddy
    return 0
  fi

  echo "Reloading Caddy config (no container recreate)"
  docker exec "${cid}" caddy reload --config /etc/caddy/Caddyfile || {
    echo "caddy reload failed — leaving existing container running" >&2
  }
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

if ! grep -qE '^DATABASE_URL=' .env.prod; then
  echo "error: .env.prod must set DATABASE_URL (Cloud SQL private IP from pulumi output)" >&2
  exit 1
fi

SITE_HOST="$(grep -E '^JACKLINE_SITE_ADDRESS=' .env.prod | head -1 | cut -d= -f2- | tr -d '\r' || true)"

# Serial builds on e2-small — parallel vite/zudoku OOMs and wedges the VM.
export COMPOSE_PARALLEL_LIMIT=1
export BUILDKIT_MAX_PARALLELISM=1

echo "Building images serially (running containers stay up)…"
for svc in migrate api gateway web docs; do
  echo "Building ${svc}…"
  compose build "${svc}"
done

echo "Pre-deploy database backup…"
bash deploy/scripts/pre-deploy-backup.sh

echo "Running migrations (one-shot; does not replace api/gateway)…"
compose run --rm --no-deps migrate

live="$(compose ps -q api 2>/dev/null || true)"
if [[ -z "${live}" ]]; then
  echo "First boot — starting full stack"
  compose up -d --wait --wait-timeout "${HEALTH_TIMEOUT}"
else
  # Load the new Caddyfile (active health checks) before scale=2 so Caddy can
  # skip the new replica until it passes /health. Recreate is still deferred
  # to ensure_caddy so a reload blip does not take TLS down mid-build.
  reload_caddy
  roll_service api
  roll_service gateway
  roll_service web
  roll_service docs
  ensure_caddy
fi

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
    compose logs --tail=80 caddy >&2 || true
  else
    echo "TLS handshake OK for ${SITE_HOST}"
  fi
fi

echo "=== remote-deploy complete ==="
