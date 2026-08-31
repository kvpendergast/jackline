#!/usr/bin/env bash
# Create a Cloud SQL on-demand backup before app deploy, then prune old on-demand
# backups so pre-deploy snapshots do not accumulate without bound.
#
# Required env:
#   GCP_PROJECT_ID
#   CLOUD_SQL_INSTANCE_NAME   e.g. jackline-db (from pulumi stack output)
#
# Optional:
#   GIT_SHA                              included in backup description
#   JACKLINE_CLOUDSQL_ON_DEMAND_KEEP     on-demand backups to retain (default: 7)
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${CLOUD_SQL_INSTANCE_NAME:?CLOUD_SQL_INSTANCE_NAME is required}"

KEEP="${JACKLINE_CLOUDSQL_ON_DEMAND_KEEP:-7}"
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

echo "Pruning on-demand backups (keeping newest ${KEEP})…"
mapfile -t ON_DEMAND < <(
  gcloud sql backups list \
    --project="${GCP_PROJECT_ID}" \
    --instance="${CLOUD_SQL_INSTANCE_NAME}" \
    --filter="type=ON_DEMAND" \
    --sort-by="~endTime" \
    --format="value(id)" 2>/dev/null || true
)

if ((${#ON_DEMAND[@]} > KEEP)); then
  for id in "${ON_DEMAND[@]:KEEP}"; do
    [[ -z "${id}" ]] && continue
    echo "Deleting old on-demand backup ${id}"
    gcloud sql backups delete "${id}" \
      --project="${GCP_PROJECT_ID}" \
      --instance="${CLOUD_SQL_INSTANCE_NAME}" \
      --quiet
  done
else
  echo "On-demand backup count ${#ON_DEMAND[@]} — nothing to prune"
fi
