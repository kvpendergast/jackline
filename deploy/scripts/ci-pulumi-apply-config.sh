#!/usr/bin/env bash
# Apply plain Pulumi config from env vars, then load --secret values from
# GCP Secret Manager secrets whose IDs start with JACKLINE_SECRET_PREFIX.
#
# Run from deploy/pulumi/{vm|gke} after: pulumi login && pulumi stack select prod
#
# Required env:
#   DEPLOY_PATH          vm | gke
#   GCP_PROJECT_ID
#   JACKLINE_DOMAIN
#   JACKLINE_GIT_REPO    (vm only)
#
# Optional env:
#   GCP_REGION                 default us-central1
#   JACKLINE_SECRET_PREFIX     default jackline-pulumi-
#   JACKLINE_GIT_REF           default main (vm)
#   JACKLINE_MACHINE_TYPE      (vm)
#   JACKLINE_VM_ZONE           (vm) → pulumi config zone
#   JACKLINE_DOCS_DOMAIN       (vm)
#   JACKLINE_CADDY_EMAIL       (vm)
#
# Secret Manager naming:
#   ${PREFIX}jacklineMasterKey  →  pulumi config set --secret jacklineMasterKey
#   ${PREFIX}betterAuthSecret   →  pulumi config set --secret betterAuthSecret
# Add/rotate secrets in GCP only; this script does not need workflow edits.
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required (vm|gke)}"
: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${JACKLINE_DOMAIN:?JACKLINE_DOMAIN is required}"

PREFIX="${JACKLINE_SECRET_PREFIX:-jackline-pulumi-}"
REGION="${GCP_REGION:-us-central1}"

case "${DEPLOY_PATH}" in
  vm|gke) ;;
  *)
    echo "error: DEPLOY_PATH must be vm or gke (got ${DEPLOY_PATH})" >&2
    exit 1
    ;;
esac

echo "=== plain Pulumi config (path=${DEPLOY_PATH}) ==="
pulumi config set gcp:project "${GCP_PROJECT_ID}"
pulumi config set gcp:region "${REGION}"
pulumi config set domain "${JACKLINE_DOMAIN}"

if [[ "${DEPLOY_PATH}" == "vm" ]]; then
  : "${JACKLINE_GIT_REPO:?JACKLINE_GIT_REPO is required for vm path}"
  pulumi config set gitRepo "${JACKLINE_GIT_REPO}"
  pulumi config set gitRef "${JACKLINE_GIT_REF:-main}"
  if [[ -n "${JACKLINE_MACHINE_TYPE:-}" ]]; then
    pulumi config set machineType "${JACKLINE_MACHINE_TYPE}"
  fi
  if [[ -n "${JACKLINE_VM_ZONE:-}" ]]; then
    pulumi config set zone "${JACKLINE_VM_ZONE}"
  fi
  if [[ -n "${JACKLINE_DOCS_DOMAIN:-}" ]]; then
    pulumi config set docsDomain "${JACKLINE_DOCS_DOMAIN}"
  fi
  if [[ -n "${JACKLINE_CADDY_EMAIL:-}" ]]; then
    pulumi config set caddyEmail "${JACKLINE_CADDY_EMAIL}"
  fi
fi

echo "=== Secret Manager secrets (prefix=${PREFIX}) ==="
# List secret IDs only (not full resource names).
mapfile -t secret_ids < <(
  gcloud secrets list \
    --project="${GCP_PROJECT_ID}" \
    --format='value(name)' \
    --filter="name~projects/.*/secrets/${PREFIX}.*" \
    2>/dev/null | while read -r full; do
      basename "${full}"
    done
)

# Fallback if filter syntax differs across gcloud versions: list all, prefix-match.
if [[ ${#secret_ids[@]} -eq 0 ]]; then
  mapfile -t secret_ids < <(
    gcloud secrets list --project="${GCP_PROJECT_ID}" --format='value(name)' \
      | while read -r full; do
          id="$(basename "${full}")"
          if [[ "${id}" == "${PREFIX}"* ]]; then
            printf '%s\n' "${id}"
          fi
        done
  )
fi

if [[ ${#secret_ids[@]} -eq 0 ]]; then
  echo "error: no Secret Manager secrets with prefix '${PREFIX}' in project ${GCP_PROJECT_ID}" >&2
  echo "Create secrets named like: ${PREFIX}jacklineMasterKey" >&2
  exit 1
fi

for id in "${secret_ids[@]}"; do
  key="${id#"${PREFIX}"}"
  if [[ -z "${key}" || "${key}" == "${id}" ]]; then
    echo "skip (unexpected id): ${id}" >&2
    continue
  fi
  echo "pulumi config set --secret ${key}  (from secret ${id})"
  val="$(gcloud secrets versions access latest --secret="${id}" --project="${GCP_PROJECT_ID}")"
  pulumi config set --secret "${key}" "${val}"
done

echo "=== config apply complete ==="
