#!/usr/bin/env bash
# Update Jackline on a VM (CI via gcloud compute ssh / scp, or manual).
#
# Default mode: pull every service image in parallel, then rolling cutover.
# Fallback:     JACKLINE_BUILD_ON_VM=1 builds images locally (slow on small VMs).
#
# Running containers keep serving during the pull. A service is not restarted
# when its image ID (config digest, not the registry manifest digest) matches
# the pulled image AND its effective compose config hash matches the label
# dev.jackline.effective-config-sha on the running container. Manifest digests
# change every build because OCI annotations carry the git SHA; image IDs do
# not, once images are built reproducibly. Compose's own
# com.docker.compose.config-hash cannot be used for this: it includes the
# image tag, and .env.prod injects JACKLINE_*_IMAGE=…:sha-<commit> into
# api/gateway/migrate, so that hash changes on every deploy.
#
# Migrations are one-shot (`compose run --rm` leaves nothing to label). The
# last successful image ID and config hash are stored in
# ${ROOT}/.jackline-migrate-state. Migrations run when that record is missing
# or either value changed.
#
# Rolling cutover (services that did change) — the live container is never
# replaced in place:
#   1. Pull (or build) new images. Running containers keep serving the old image.
#   2. `compose up --scale=2 --no-recreate` starts a *second* replica from the
#      new image. Compose will not recreate the existing replica.
#   3. Wait until Docker health (compose/Dockerfile HEALTHCHECK) is `healthy`
#      on that new replica. Caddy's active checks skip it until /health is OK.
#   4. Only then stop/remove the old replica.
# If the new replica never becomes healthy, it is deleted and the old replica
# keeps serving. A cancelled CI SSH session cannot SIGKILL the deploy: the
# script re-execs under systemd-run (unit=jackline-deploy). Stdout stays on
# the journal — do not add systemd-run --pipe; a dropped SSH session closes
# the pipe and can SIGPIPE the unit.
#
# Skip decision tests (no Docker): bash deploy/scripts/deploy-skip.test.sh
#
# Env:
#   JACKLINE_ROOT       Install directory (default: /opt/jackline)
#   GIT_REPO            Clone URL if ROOT is not yet a git checkout (required then)
#   GIT_SHA             Commit to check out (preferred in CI)
#   GIT_REF             Branch/ref when GIT_SHA is unset (default: main)
#   GITHUB_TOKEN_FILE   Optional path to a token file (read once, then shredded)
#   GITHUB_TOKEN        Optional token in env (prefer TOKEN_FILE — avoids argv leaks)
#   ENV_PROD_SRC        Optional path to a rendered .env.prod to install at ROOT
#   JACKLINE_BUILD_ON_VM  Set to 1 to build images on the VM instead of pulling
#   JACKLINE_FORCE_ROLL Set to 1 to roll every service even when image and config match
#   JACKLINE_DEPLOY_INNER  Set by systemd-run re-exec (do not set manually)
set -euo pipefail

ROOT="${JACKLINE_ROOT:-/opt/jackline}"
REF="${GIT_REF:-main}"
TOKEN=""
ASKPASS=""
COMPOSE_FILE="deploy/compose.prod.yml"
COMPOSE_OTEL_FILE="deploy/compose.otel.yml"
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
        journalctl -u jackline-deploy.service -n 200 --no-pager >&2 || true
        exit 1
      fi
      sleep 10
    done
  fi
  systemctl reset-failed jackline-deploy.service 2>/dev/null || true
  # Stale leftover unit can block a same-named transient start.
  systemctl stop jackline-deploy.service 2>/dev/null || true
  extra=()
  for k in GIT_SHA GIT_REPO GIT_REF ENV_PROD_SRC GITHUB_TOKEN_FILE GITHUB_TOKEN JACKLINE_ROOT JACKLINE_HEALTH_TIMEOUT JACKLINE_BUILD_ON_VM JACKLINE_FORCE_ROLL; do
    if [[ -n "${!k:-}" ]]; then
      extra+=(-E "${k}=${!k}")
    fi
  done
  echo "Re-executing under systemd-run (unit=jackline-deploy)…"
  set +e
  # No --pipe: it would forward stdout to this SSH session, and a cancelled
  # CI job would SIGPIPE the unit. Follow the journal from the parent instead
  # if CI should show these logs (separate change).
  systemd-run --wait --collect --unit=jackline-deploy \
    --property=Type=oneshot \
    --property=TimeoutStartSec=2h \
    --property=KillMode=mixed \
    -E JACKLINE_DEPLOY_INNER=1 \
    "${extra[@]}" \
    /bin/bash "$(readlink -f "$0")"
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    echo "error: jackline-deploy.service failed (exit ${rc})" >&2
    systemctl status jackline-deploy.service --no-pager >&2 || true
    echo "=== jackline-deploy journal (last 200) ===" >&2
    journalctl -u jackline-deploy.service -n 200 --no-pager >&2 || true
    exit "${rc}"
  fi
  exit 0
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
# PHASE_NAME is set only while a timed phase is in progress. On failure,
# set -e exits before phase_end; this trap still records the elapsed time.
PHASE_NAME=""
PHASE_START=0
on_exit() {
  local rc=$?
  if [[ -n "${PHASE_NAME}" ]]; then
    local elapsed=$((SECONDS - PHASE_START))
    echo "=== phase ${PHASE_NAME} end $(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=${elapsed}s exit=${rc} ===" >&2 || true
    PHASE_NAME=""
  fi
  cleanup || true
  exit "$rc"
}
trap on_exit EXIT

phase_begin() {
  PHASE_NAME="$1"
  PHASE_START=$SECONDS
  echo "=== phase ${PHASE_NAME} start $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
}

phase_end() {
  local elapsed=$((SECONDS - PHASE_START))
  echo "=== phase ${PHASE_NAME} end $(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=${elapsed}s exit=0 ==="
  PHASE_NAME=""
  PHASE_START=0
}

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
  local -a files=(-f "${COMPOSE_FILE}")
  if [[ -f "${COMPOSE_OTEL_FILE}" ]]; then
    files+=(-f "${COMPOSE_OTEL_FILE}")
    # Bind-mounted config edits don't trigger a recreate on their own; the
    # hash lands in a container label so `compose up` recreates on change.
    if [[ -f deploy/logging/otel-collector-config.yaml ]]; then
      JACKLINE_OTEL_CONFIG_SHA="$(sha256sum deploy/logging/otel-collector-config.yaml | cut -c1-16)"
      export JACKLINE_OTEL_CONFIG_SHA
    fi
  fi
  docker compose "${files[@]}" --env-file .env.prod "$@"
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

# BEGIN deploy-skip
# Pure helpers (no docker). deploy/scripts/deploy-skip.test.sh sources this block.

normalize_image_id() {
  local id="$1"
  local bare
  bare="$(printf '%s' "${id}" | tr '[:upper:]' '[:lower:]')"
  bare="${bare#sha256:}"
  if [[ "${bare}" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'sha256:%s\n' "${bare}"
    return 0
  fi
  printf '%s\n' "${id}"
}

# skip_reason prints one token: skip, or why the service must be rolled.
# Image IDs are config digests (docker inspect .Image / .Id), not manifest digests.
skip_reason() {
  local replicas="$1"
  local status="$2"
  local running_image="$3"
  local target_image="$4"
  local running_hash="$5"
  local target_hash="$6"

  if [[ ! "${replicas}" =~ ^[0-9]+$ ]] || [[ "${replicas}" -eq 0 ]]; then
    printf '%s\n' "no-container"
    return 0
  fi
  if [[ "${replicas}" -ne 1 ]]; then
    printf '%s\n' "replicas"
    return 0
  fi
  case "${status}" in
    healthy|running) ;;
    *)
      printf '%s\n' "not-ready"
      return 0
      ;;
  esac
  if [[ "${running_hash}" == "unset" || "${running_hash}" == "<no value>" ]]; then
    running_hash=""
  fi
  running_image="$(normalize_image_id "${running_image}")"
  target_image="$(normalize_image_id "${target_image}")"
  if [[ -z "${running_image}" || -z "${target_image}" || -z "${running_hash}" || -z "${target_hash}" ]]; then
    printf '%s\n' "missing-identity"
    return 0
  fi
  if [[ "${running_image}" != "${target_image}" ]]; then
    printf '%s\n' "image"
    return 0
  fi
  if [[ "${running_hash}" != "${target_hash}" ]]; then
    printf '%s\n' "config"
    return 0
  fi
  printf '%s\n' "skip"
}

migrate_skip_reason() {
  local recorded_image="$1"
  local target_image="$2"
  local recorded_hash="$3"
  local target_hash="$4"
  if [[ -z "${recorded_image}" || -z "${recorded_hash}" ]]; then
    printf '%s\n' "no-record"
    return 0
  fi
  skip_reason 1 running "${recorded_image}" "${target_image}" "${recorded_hash}" "${target_hash}"
}

migrate_state_read() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  local line image_id="" config_hash=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    case "${line}" in
      image_id=*) image_id="${line#image_id=}" ;;
      config_hash=*) config_hash="${line#config_hash=}" ;;
    esac
  done <"${file}"
  [[ -n "${image_id}" && -n "${config_hash}" ]] || return 1
  printf '%s\n%s\n' "${image_id}" "${config_hash}"
}

migrate_state_write() {
  local file="$1"
  local image_id="$2"
  local config_hash="$3"
  local tmp
  mkdir -p "$(dirname "${file}")"
  tmp="$(mktemp "${file}.XXXXXX")"
  printf 'image_id=%s\nconfig_hash=%s\n' "${image_id}" "${config_hash}" >"${tmp}"
  mv -f "${tmp}" "${file}"
}

# Reads compose config JSON on stdin. JACKLINE_COMPOSE_PY_MODE=hash|images.
run_compose_py() {
  local mode="$1"
  local svc="${2:-}"
  local py
  py="$(cat <<'PY'
import hashlib
import json
import os
import re
import sys

IMAGE_ENV = re.compile(r"^JACKLINE_[A-Z0-9_]+_IMAGE$")
DROP_KEYS = ("image", "build", "pull_policy", "scale", "profiles")
HASH_LABEL = "dev.jackline.effective-config-sha"


def strip_service(svc):
    for key in DROP_KEYS:
        svc.pop(key, None)
    env = svc.get("environment")
    if isinstance(env, dict):
        svc["environment"] = {
            k: v for k, v in env.items() if not IMAGE_ENV.fullmatch(k)
        }
    elif isinstance(env, list):
        kept = []
        for item in env:
            if (
                isinstance(item, str)
                and "=" in item
                and IMAGE_ENV.fullmatch(item.split("=", 1)[0])
            ):
                continue
            kept.append(item)
        svc["environment"] = kept
    labels = svc.get("labels")
    if isinstance(labels, dict):
        labels.pop(HASH_LABEL, None)
        if not labels:
            svc.pop("labels", None)
    elif isinstance(labels, list):
        labels = [
            item
            for item in labels
            if not str(item).startswith(HASH_LABEL + "=")
        ]
        if labels:
            svc["labels"] = labels
        else:
            svc.pop("labels", None)
    return svc


mode = os.environ["JACKLINE_COMPOSE_PY_MODE"]
doc = json.load(sys.stdin)
services = doc.get("services") or {}
if not isinstance(services, dict):
    sys.exit(1)
if mode == "images":
    for name in sorted(services):
        image = ""
        svc = services.get(name)
        if isinstance(svc, dict) and isinstance(svc.get("image"), str):
            image = svc["image"]
        sys.stdout.write("%s\t%s\n" % (name, image))
    sys.exit(0)
if mode != "hash":
    sys.exit(1)
name = os.environ.get("JACKLINE_HASH_SERVICE", "")
svc = services.get(name)
if not isinstance(svc, dict):
    sys.exit(2)
payload = json.dumps(
    strip_service(svc),
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=True,
)
sys.stdout.write(hashlib.sha256(payload.encode()).hexdigest() + "\n")
PY
)"
  JACKLINE_COMPOSE_PY_MODE="${mode}" JACKLINE_HASH_SERVICE="${svc}" python3 -c "${py}"
}

effective_config_hash() {
  local svc="$1"
  run_compose_py hash "${svc}"
}

list_compose_images() {
  run_compose_py images
}

service_image_ref() {
  local svc="$1"
  local json name ref
  json="$(cat)"
  while IFS=$'\t' read -r name ref; do
    if [[ "${name}" == "${svc}" ]]; then
      printf '%s\n' "${ref}"
      return 0
    fi
  done < <(printf '%s' "${json}" | list_compose_images)
  return 1
}
# END deploy-skip

ensure_python3() {
  if command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  echo "python3 missing — installing"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y python3
}

export_effective_hashes() {
  local json="$1"
  local svc var hash rc
  while read -r svc var; do
    [[ -z "${svc}" ]] && continue
    if hash="$(printf '%s' "${json}" | effective_config_hash "${svc}")"; then
      rc=0
    else
      rc=$?
    fi
    if [[ "${rc}" -eq 2 ]]; then
      echo "No ${svc} service in compose config; not setting ${var}"
      continue
    fi
    if [[ "${rc}" -ne 0 || -z "${hash}" ]]; then
      echo "error: config hash failed for ${svc} (exit ${rc})" >&2
      return 1
    fi
    export "${var}=${hash}"
    echo "effective config ${svc} ${hash:0:12}"
  done <<'EOF'
api JACKLINE_CFG_SHA_API
gateway JACKLINE_CFG_SHA_GATEWAY
web JACKLINE_CFG_SHA_WEB
docs JACKLINE_CFG_SHA_DOCS
caddy JACKLINE_CFG_SHA_CADDY
otel-collector JACKLINE_CFG_SHA_OTEL
EOF
}

pull_images_parallel() {
  local json="$1"
  local -a names=() images=()
  local name image
  while IFS=$'\t' read -r name image; do
    [[ -z "${name}" ]] && continue
    if [[ -z "${image}" ]]; then
      echo "error: service ${name} has no image to pull" >&2
      return 1
    fi
    names+=("${name}")
    images+=("${image}")
  done < <(printf '%s' "${json}" | list_compose_images)
  if [[ ${#names[@]} -eq 0 ]]; then
    echo "error: compose config listed no images to pull" >&2
    return 1
  fi

  local -a pids=() logs=()
  local i log fail=0
  for i in "${!names[@]}"; do
    echo "Pulling ${names[$i]} (${images[$i]})"
    log="$(mktemp)"
    logs+=("${log}")
    docker pull --quiet "${images[$i]}" >"${log}" 2>&1 &
    pids+=("$!")
  done
  for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
      echo "error: docker pull failed for ${names[$i]}" >&2
      cat "${logs[$i]}" >&2 || true
      fail=1
    fi
    rm -f "${logs[$i]}"
  done
  return "${fail}"
}

build_images() {
  local svc
  for svc in migrate api gateway web docs; do
    echo "Building ${svc}…"
    compose build "${svc}"
  done
}

service_skip_reason() {
  local svc="$1"
  local json="$2"
  if [[ "${JACKLINE_FORCE_ROLL:-0}" == "1" ]]; then
    echo "decision ${svc} reason=forced" >&2
    printf '%s\n' "forced"
    return 0
  fi

  local -a ids=()
  mapfile -t ids < <(compose ps -q "${svc}" 2>/dev/null | sed '/^$/d' || true)
  local n="${#ids[@]}"
  if [[ "${n}" -eq 0 ]]; then
    echo "decision ${svc} reason=no-container" >&2
    printf '%s\n' "no-container"
    return 0
  fi
  if [[ "${n}" -ne 1 ]]; then
    echo "decision ${svc} reason=replicas count=${n}" >&2
    printf '%s\n' "replicas"
    return 0
  fi

  local cid="${ids[0]}"
  local status running_image running_hash target_ref target_image target_hash reason
  status="$(container_health "${cid}")"
  running_image="$(docker inspect -f '{{.Image}}' "${cid}" 2>/dev/null || true)"
  running_hash="$(docker inspect -f '{{index .Config.Labels "dev.jackline.effective-config-sha"}}' "${cid}" 2>/dev/null || true)"
  target_ref="$(printf '%s' "${json}" | service_image_ref "${svc}" || true)"
  if [[ -z "${target_ref}" ]]; then
    echo "error: compose config has no image for ${svc}" >&2
    return 1
  fi
  target_image="$(docker image inspect -f '{{.Id}}' "${target_ref}" 2>/dev/null || true)"
  if [[ -z "${target_image}" ]]; then
    echo "decision ${svc} reason=image-not-local ref=${target_ref}" >&2
    printf '%s\n' "image-not-local"
    return 0
  fi
  if ! target_hash="$(printf '%s' "${json}" | effective_config_hash "${svc}")"; then
    echo "error: config hash failed for ${svc}" >&2
    return 1
  fi
  reason="$(skip_reason "${n}" "${status}" "${running_image}" "${target_image}" "${running_hash}" "${target_hash}")"
  echo "decision ${svc} reason=${reason} status=${status} running_image=${running_image:0:19} target_image=${target_image:0:19} running_cfg=${running_hash:0:12} target_cfg=${target_hash:0:12}" >&2
  printf '%s\n' "${reason}"
}

roll_or_skip() {
  local svc="$1"
  local reason
  reason="$(service_skip_reason "${svc}" "${COMPOSE_JSON}")"
  if [[ "${reason}" == "skip" ]]; then
    echo "Skipping ${svc}: image and config unchanged"
    return 0
  fi
  echo "Rolling ${svc} (${reason})"
  roll_service "${svc}"
}

run_migrate() {
  local state="${ROOT}/.jackline-migrate-state"
  local target_ref target_image target_hash reason
  local recorded="" recorded_image="" recorded_hash=""
  target_ref="$(printf '%s' "${COMPOSE_JSON}" | service_image_ref migrate)"
  target_image="$(docker image inspect -f '{{.Id}}' "${target_ref}" 2>/dev/null || true)"
  if [[ -z "${target_image}" ]]; then
    echo "error: migrate image ${target_ref} is not available locally" >&2
    return 1
  fi
  target_hash="$(printf '%s' "${COMPOSE_JSON}" | effective_config_hash migrate)"
  if recorded="$(migrate_state_read "${state}")"; then
    recorded_image="${recorded%%$'\n'*}"
    recorded_hash="${recorded#*$'\n'}"
    reason="$(migrate_skip_reason "${recorded_image}" "${target_image}" "${recorded_hash}" "${target_hash}")"
  else
    reason="no-record"
  fi
  if [[ "${JACKLINE_FORCE_ROLL:-0}" == "1" ]]; then
    reason="forced"
  fi
  echo "decision migrate reason=${reason} running_image=${recorded_image:0:19} target_image=${target_image:0:19} running_cfg=${recorded_hash:0:12} target_cfg=${target_hash:0:12}" >&2
  if [[ "${reason}" == "skip" ]]; then
    echo "Skipping migrate: image and config unchanged"
    return 0
  fi
  echo "Running migrations (${reason})"
  if ! compose run --rm --no-deps migrate; then
    echo "error: migrations failed" >&2
    return 1
  fi
  migrate_state_write "${state}" "$(normalize_image_id "${target_image}")" "${target_hash}"
}

caddy_tls_ready() {
  echo | openssl s_client -connect "127.0.0.1:443" -servername "${SITE_HOST:-localhost}" 2>/dev/null \
    | grep -q 'BEGIN CERTIFICATE'
}

ensure_caddy() {
  local reason cid
  reason="$(service_skip_reason caddy "${COMPOSE_JSON}")"
  cid="$(compose ps -q caddy 2>/dev/null | head -1 || true)"
  if [[ "${reason}" == "skip" ]]; then
    echo "Skipping caddy: image and config unchanged"
    if ! caddy_tls_ready; then
      echo "Caddy is up but TLS is not serving a cert — recreating so ACME retries"
      compose up -d --no-deps --force-recreate --wait --wait-timeout 60 caddy \
        || compose up -d --no-deps --force-recreate caddy
      return 0
    fi
    echo "Reloading Caddy config (no container recreate)"
    docker exec "${cid}" caddy reload --config /etc/caddy/Caddyfile || {
      echo "caddy reload failed — leaving existing container running" >&2
    }
    return 0
  fi

  echo "Updating caddy (${reason})"
  if [[ -z "${cid}" ]]; then
    compose up -d --no-deps --wait --wait-timeout 60 caddy || compose up -d --no-deps caddy
    return 0
  fi
  compose up -d --no-deps --force-recreate --wait --wait-timeout 60 caddy \
    || compose up -d --no-deps --force-recreate caddy
}

ensure_otel() {
  if [[ ! -f "${COMPOSE_OTEL_FILE}" ]]; then
    return 0
  fi
  local reason
  reason="$(service_skip_reason otel-collector "${COMPOSE_JSON}")"
  if [[ "${reason}" == "skip" ]]; then
    echo "Skipping otel-collector: image and config unchanged"
    return 0
  fi
  echo "Updating otel-collector (${reason})"
  compose up -d --no-deps --remove-orphans otel-collector
}

DEPLOY_START=$SECONDS
echo "=== remote-deploy $(date -u +%Y-%m-%dT%H:%M:%SZ) root=${ROOT} ==="

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

ghcr_login() {
  if [[ -z "${TOKEN}" ]]; then
    echo "warning: no GitHub token — GHCR pull may fail for private packages" >&2
    return 0
  fi
  echo "${TOKEN}" | docker login ghcr.io -u x-access-token --password-stdin
}

# Rolling deploys + failed pulls accumulate images/layers; 30G boot disks fill up.
free_disk_for_pull() {
  echo "=== disk before prune ==="
  df -h / /var/lib/docker 2>/dev/null || df -h /
  docker system df 2>/dev/null || true
  # Stopped leftovers from failed scale=2 rolls / one-shots.
  docker container prune -f >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
  # Unused images (running containers' images are kept).
  docker image prune -af >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  # Build cache / unused build layers (BuildKit).
  docker buildx prune -af >/dev/null 2>&1 || true
  echo "=== disk after prune ==="
  df -h / /var/lib/docker 2>/dev/null || df -h /
  docker system df 2>/dev/null || true
  local avail_kb
  avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
  if [[ -n "${avail_kb}" && "${avail_kb}" -lt 2097152 ]]; then
    echo "warning: <2GiB free on / after prune — pull may still fail" >&2
  fi
}

ensure_python3
COMPOSE_JSON="$(compose config --format json)"
if [[ -z "${COMPOSE_JSON}" ]]; then
  echo "error: empty compose config" >&2
  exit 1
fi
echo "Computing effective config hashes"
export_effective_hashes "${COMPOSE_JSON}"

if [[ "${JACKLINE_BUILD_ON_VM:-0}" == "1" ]]; then
  export COMPOSE_PARALLEL_LIMIT=1
  export BUILDKIT_MAX_PARALLELISM=1
  phase_begin build
  echo "Building images serially on VM (running containers stay up)…"
  free_disk_for_pull
  build_images
  phase_end
else
  phase_begin pull
  echo "Pulling prebuilt GHCR images in parallel (running containers stay up)…"
  free_disk_for_pull
  ghcr_login
  pull_images_parallel "${COMPOSE_JSON}"
  phase_end
fi

phase_begin migrate
run_migrate
phase_end

live="$(compose ps -q api 2>/dev/null || true)"
if [[ -z "${live}" ]]; then
  phase_begin first-boot
  echo "First boot — starting full stack"
  compose up -d --wait --wait-timeout "${HEALTH_TIMEOUT}"
  phase_end
else
  # Load the new Caddyfile (active health checks) before scale=2 so Caddy can
  # skip the new replica until it passes /health. Recreate is still deferred
  # to ensure_caddy so a reload blip does not take TLS down mid-roll.
  reload_caddy
  phase_begin roll-api
  roll_or_skip api
  phase_end
  phase_begin roll-gateway
  roll_or_skip gateway
  phase_end
  phase_begin roll-web
  roll_or_skip web
  phase_end
  phase_begin roll-docs
  roll_or_skip docs
  phase_end
  phase_begin roll-otel-collector
  ensure_otel
  phase_end
  phase_begin roll-caddy
  ensure_caddy
  phase_end
fi

if [[ -n "${SITE_HOST}" && "${SITE_HOST}" != http* ]]; then
  echo "Waiting for TLS…"
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
    echo "warning: TLS not ready after ~60s — dumping Caddy logs" >&2
    compose logs --tail=80 caddy >&2 || true
  else
    echo "TLS handshake OK"
  fi
fi

echo "=== remote-deploy complete $(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=$((SECONDS - DEPLOY_START))s ==="
