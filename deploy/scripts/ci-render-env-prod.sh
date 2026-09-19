#!/usr/bin/env bash
# Render production Compose .env.prod for the VM from Secret Manager + GitHub vars.
# Writes to path given as $1 (default: stdout). Does not log secret values.
#
# Required env:
#   GCP_PROJECT_ID
#   JACKLINE_DOMAIN
#
# Optional:
#   JACKLINE_SECRET_PREFIX   default jackline-pulumi-
#   JACKLINE_DOCS_DOMAIN
#   JACKLINE_CADDY_EMAIL
#   JACKLINE_TENANCY         default single (overridden by SM secret if present)
#   CLOUD_SQL_PRIVATE_IP     Cloud SQL private IP (CI sets from pulumi stack output)
#   CLOUD_SQL_CONNECTION_NAME  project:region:instance (CI sets from pulumi output)
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${JACKLINE_DOMAIN:?JACKLINE_DOMAIN is required}"

GHCR_OWNER="$(echo "${JACKLINE_GHCR_OWNER:-kvpendergast}" | tr '[:upper:]' '[:lower:]')"
IMAGE_TAG="${JACKLINE_IMAGE_TAG:-latest}"

PREFIX="${JACKLINE_SECRET_PREFIX:-jackline-pulumi-}"
OUT="${1:-}"

read_secret() {
  local key="$1"
  local id="${PREFIX}${key}"
  gcloud secrets versions access latest --secret="${id}" --project="${GCP_PROJECT_ID}" 2>/dev/null || true
}

MASTER_KEY="$(read_secret jacklineMasterKey)"
AUTH_SECRET="$(read_secret betterAuthSecret)"
PG_PASS="$(read_secret postgresPassword)"
TENANCY_SM="$(read_secret tenancy)"
# Trim CR/LF/space — gcloud secret payloads often include a trailing newline,
# and whitespace in client secrets causes Google token exchange to fail with
# invalid_code on the OAuth callback.
GOOGLE_CLIENT_ID_SM="$(read_secret googleClientId | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
GOOGLE_CLIENT_SECRET_SM="$(read_secret googleClientSecret | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
RESEND_API_KEY_SM="$(read_secret resendApiKey)"
EMAIL_CONNECTOR_SM="$(read_secret emailConnector)"
SMTP_HOST_SM="$(read_secret smtpHost)"
SMTP_PORT_SM="$(read_secret smtpPort)"
SMTP_USER_SM="$(read_secret smtpUser)"
SMTP_PASS_SM="$(read_secret smtpPass)"
EMAIL_FROM_SM="$(read_secret emailFrom)"

if [[ -z "${MASTER_KEY}" || -z "${AUTH_SECRET}" ]]; then
  echo "error: missing required Secret Manager secrets ${PREFIX}jacklineMasterKey and/or ${PREFIX}betterAuthSecret" >&2
  exit 1
fi

DOMAIN="${JACKLINE_DOMAIN}"
DOCS_DOMAIN="${JACKLINE_DOCS_DOMAIN:-docs.${DOMAIN}}"
TENANCY="${TENANCY_SM:-${JACKLINE_TENANCY:-single}}"
PG_PASS="${PG_PASS:-jackline}"
PUBLIC="https://${DOMAIN}"
CADDY_GLOBAL=""
if [[ -n "${JACKLINE_CADDY_EMAIL:-}" ]]; then
  CADDY_GLOBAL="email ${JACKLINE_CADDY_EMAIL}"
fi

CLOUD_SQL_IP="${CLOUD_SQL_PRIVATE_IP:-$(read_secret cloudSqlPrivateIp)}"
CLOUD_SQL_CONN="${CLOUD_SQL_CONNECTION_NAME:-$(read_secret cloudSqlConnectionName)}"
if [[ -z "${CLOUD_SQL_IP}" ]]; then
  echo "error: CLOUD_SQL_PRIVATE_IP is required (export from pulumi stack output cloudSqlPrivateIp, or create ${PREFIX}cloudSqlPrivateIp in Secret Manager)" >&2
  exit 1
fi
DATABASE_URL="postgresql://jackline:${PG_PASS}@${CLOUD_SQL_IP}:5432/jackline"

GOOGLE_ENV_BLOCK=""
if [[ -n "${GOOGLE_CLIENT_ID_SM}" && -n "${GOOGLE_CLIENT_SECRET_SM}" ]]; then
  GOOGLE_ENV_BLOCK=$'GOOGLE_CLIENT_ID='"${GOOGLE_CLIENT_ID_SM}"$'\nGOOGLE_CLIENT_SECRET='"${GOOGLE_CLIENT_SECRET_SM}"
elif [[ -n "${GOOGLE_CLIENT_ID_SM}" || -n "${GOOGLE_CLIENT_SECRET_SM}" ]]; then
  echo "warning: ${PREFIX}googleClientId and ${PREFIX}googleClientSecret must both be set; skipping platform Google login" >&2
fi

EMAIL_ENV_BLOCK=""
if [[ -n "${RESEND_API_KEY_SM}" && -n "${EMAIL_FROM_SM}" ]]; then
  CONNECTOR="${EMAIL_CONNECTOR_SM:-resend}"
  # Quote EMAIL_FROM so values like `Jackline <noreply@domain>` survive .env parsing.
  EMAIL_ENV_BLOCK=$'EMAIL_CONNECTOR='"${CONNECTOR}"$'\nEMAIL_FROM="'"${EMAIL_FROM_SM}"$'"\nRESEND_API_KEY='"${RESEND_API_KEY_SM}"
elif [[ -n "${SMTP_HOST_SM}" && -n "${EMAIL_FROM_SM}" ]]; then
  CONNECTOR="${EMAIL_CONNECTOR_SM:-smtp}"
  EMAIL_ENV_BLOCK=$'EMAIL_CONNECTOR='"${CONNECTOR}"$'\nSMTP_HOST='"${SMTP_HOST_SM}"$'\nEMAIL_FROM="'"${EMAIL_FROM_SM}"$'"'
  if [[ -n "${SMTP_PORT_SM}" ]]; then
    EMAIL_ENV_BLOCK+=$'\nSMTP_PORT='"${SMTP_PORT_SM}"
  fi
  if [[ -n "${SMTP_USER_SM}" && -n "${SMTP_PASS_SM}" ]]; then
    EMAIL_ENV_BLOCK+=$'\nSMTP_USER='"${SMTP_USER_SM}"$'\nSMTP_PASS='"${SMTP_PASS_SM}"
  fi
elif [[ -n "${RESEND_API_KEY_SM}" || -n "${SMTP_HOST_SM}" || -n "${EMAIL_FROM_SM}" ]]; then
  echo "warning: email secrets incomplete — set ${PREFIX}resendApiKey+emailFrom or ${PREFIX}smtpHost+emailFrom" >&2
fi

# shellcheck disable=SC2016
render() {
  cat <<EOF
NODE_ENV=production
LOG_LEVEL=info
JACKLINE_TENANCY=${TENANCY}
JACKLINE_MASTER_KEY=${MASTER_KEY}
BETTER_AUTH_SECRET=${AUTH_SECRET}
JACKLINE_SECRET_STORAGE_LOCATION=local
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=${DATABASE_URL}
CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONN}
JACKLINE_SITE_ADDRESS=${DOMAIN}
JACKLINE_DOCS_SITE_ADDRESS=${DOCS_DOMAIN}
JACKLINE_HTTP_PORT=80
JACKLINE_HTTPS_PORT=443
JACKLINE_CADDY_GLOBAL_OPTIONS=${CADDY_GLOBAL}
WEB_ORIGIN=${PUBLIC}
BETTER_AUTH_URL=${PUBLIC}
JACKLINE_PUBLIC_API_URL=${PUBLIC}
JACKLINE_PUBLIC_MCP_URL=${PUBLIC}/mcp
API_HOST=0.0.0.0
API_PORT=8080
GATEWAY_HOST=0.0.0.0
GATEWAY_PORT=8081
JACKLINE_API_IMAGE=ghcr.io/${GHCR_OWNER}/jackline-api:${IMAGE_TAG}
JACKLINE_GATEWAY_IMAGE=ghcr.io/${GHCR_OWNER}/jackline-gateway:${IMAGE_TAG}
JACKLINE_WEB_IMAGE=ghcr.io/${GHCR_OWNER}/jackline-web:${IMAGE_TAG}
JACKLINE_DOCS_IMAGE=ghcr.io/${GHCR_OWNER}/jackline-docs:${IMAGE_TAG}
JACKLINE_MIGRATE_IMAGE=ghcr.io/${GHCR_OWNER}/jackline-migrate:${IMAGE_TAG}
${GOOGLE_ENV_BLOCK}
${EMAIL_ENV_BLOCK}
EOF
}

if [[ -n "${OUT}" ]]; then
  umask 077
  render >"${OUT}"
  chmod 600 "${OUT}"
  echo "Wrote ${OUT}" >&2
else
  render
fi
