#!/usr/bin/env bash
# Create a Cloud SQL on-demand backup before app deploy (survives VM loss).
#
# Required env:
#   GCP_PROJECT_ID
#   CLOUD_SQL_INSTANCE_NAME   e.g. jackline-db (from pulumi stack output)
#
# Optional:
#   GIT_SHA                     included in backup description
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${CLOUD_SQL_INSTANCE_NAME:?CLOUD_SQL_INSTANCE_NAME is required}"

DESC="pre-deploy"
if [[ -n "${GIT_SHA:-}" ]]; then
  DESC="pre-deploy ${GIT_SHA}"
fi

echo "Cloud SQL on-demand backup: ${CLOUD_SQL_INSTANCE_NAME} (${DESC})"
gcloud sql backups create \
  --project="${GCP_PROJECT_ID}" \
  --instance="${CLOUD_SQL_INSTANCE_NAME}" \
  --description="${DESC}"

echo "Cloud SQL backup complete"
