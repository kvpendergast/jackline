# Jackline on GCP (Pulumi)

Hobbyist-first deploy paths for Jackline on Google Cloud.

| Path | Who it's for | Cost shape |
| --- | --- | --- |
| **[`vm/`](vm/)** (default) | Weekend demos, personal instances | One small VM + **Cloud SQL `db-f1-micro`** (~$10/mo DB + ~$12–15/mo VM). Fixed sizes = **compute bill stays flat** under bot traffic. |
| **[`gke/`](gke/)** (advanced) | Learning Kubernetes / Autopilot | Autopilot + global HTTP LB keep burning while up. **Not** the overnight hobbyist default. |

GCP spend caps do not cover Compute Engine or Cloud SQL, and unlinking billing can delete the Cloud SQL instance (the only copy of prod data). The VM path deploys a **budget shutoff** that stops the VM and the database when spend hits the budget. Disks, the static IP, and database data stay. See [Budget shutoff](#budget-shutoff-circuit-breaker).

## Quick start (VM — recommended)

```bash
cd deploy/pulumi/vm
npm install
pulumi login gs://YOUR_PULUMI_STATE_BUCKET   # or pulumi login for Pulumi Cloud
pulumi stack init prod                       # once
cp Pulumi.prod.example.yaml Pulumi.prod.yaml # then edit; file is gitignored
pulumi config set gcp:project YOUR_PROJECT
pulumi config set domain jackline.example.com
pulumi config set gitRepo https://github.com/YOUR_ORG_OR_USER/jackline.git
pulumi config set --secret jacklineMasterKey "$(openssl rand -base64 32)"
pulumi config set --secret betterAuthSecret "$(openssl rand -base64 32)"
# optional: pulumi config set machineType e2-medium
# optional: pulumi config set caddyEmail you@example.com
pulumi up
```

Point DNS A/AAAA for your domain (and `docs.<domain>` unless you set `docsDomain`) at the **`publicIp`** stack output **before** (or immediately after) the first HTTPS deploy so Caddy can finish Let’s Encrypt. Pulumi creates a **regional** static external IP (`jackline-vm-ip` by default in `gcp:region`) and attaches it to the VM — do **not** reuse a global GKE address like `jackline-ip`. First boot installs Docker, clones the repo, and runs [`compose.prod.yml`](../compose.prod.yml) + [`compose.otel.yml`](../compose.otel.yml) with Caddy TLS. Postgres runs on **Cloud SQL** (`jackline-db`, private IP only); the VM connects over the default VPC. If the browser shows `ERR_SSL_PROTOCOL_ERROR` after a DNS cutover, re-run **Deploy prod** — remote-deploy reloads Caddy, and **recreates** it only when TLS is not serving a certificate (so ACME retries).

### Logs (Cloud Logging)

Apps always emit structured JSON to **stdout**. On the VM path, [OpenTelemetry Collector Contrib](../compose.otel.yml) tails Docker `json-file` logs and exports them to **Cloud Logging** (and receives OTLP traces on `:4318` for Cloud Trace).

**One-time IAM** (CI cannot bind these — grant once as a project owner):

```bash
PROJECT="$(gcloud config get-value project)"
VM_SA="jackline-vm@${PROJECT}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${VM_SA}" --role="roles/logging.logWriter"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${VM_SA}" --role="roles/cloudtrace.agent"
```

**Logs Explorer** (project that owns the VM):

```text
resource.type="gce_instance"
jsonPayload.service="jackline-api"
```

Gateway: `jsonPayload.service="jackline-gateway"`. Broader: `jsonPayload.msg!=""` or log name `projects/YOUR_PROJECT/logs/jackline`.

Self-host / non-GCP: omit `-f deploy/compose.otel.yml`, or edit [`logging/otel-collector-config.yaml`](../logging/otel-collector-config.yaml) exporters (Loki, OTLP, Jaeger, …). Jackline does not depend on a cloud logging SDK.

**Later app updates** (and CI) use [`../scripts/remote-deploy.sh`](../scripts/remote-deploy.sh) — startup scripts do **not** re-run on every deploy. Do **not** run `docker compose up --build -d` on a live VM: that replaces containers in place. remote-deploy builds new images first, starts a second replica (`--scale 2 --no-recreate`), waits until Docker health is green, and only then stops the old replica. If the new replica fails health, it is removed and the old one keeps serving. The script re-execs under `systemd-run` so a cancelled CI SSH session does not SIGKILL the build.

```bash
# after pulumi up
gcloud compute ssh jackline --zone=ZONE --command='sudo GIT_SHA=main bash -s' \
  < ../scripts/remote-deploy.sh
```

**VM rebuilds are explicit.** The instance ignores boot disk changes (`ignoreChanges: ["bootDisk"]` in [`vm/index.ts`](vm/index.ts)), so a newly published Ubuntu image (or a changed disk size/type) no longer makes `pulumi up` delete and recreate the VM on every deploy. The existing VM keeps its current image and patches in place. To rebuild it on purpose, pick a quiet window (replacement is delete-first: fixed name + static IP, roughly 20 minutes of downtime while the new VM bootstraps) and run:

```bash
cd vm
pulumi stack --show-urns | grep 'gcp:compute/instance:Instance'
pulumi up --replace '<that URN>'
```

## GKE (advanced)

```bash
cd deploy/pulumi/gke
npm install
# Local Docker required (image builds during pulumi up)
pulumi login gs://YOUR_PULUMI_STATE_BUCKET
pulumi stack select prod   # or init
cp Pulumi.prod.example.yaml Pulumi.prod.yaml
# configure domain + secrets; reserved global IP name jackline-ip by default
pulumi up
```

Expect higher idle cost (Autopilot + LB). Destroy when not demoing publicly.

If you previously used project name `jackline-infra`, config keys in `Pulumi.prod.yaml` must use the `jackline-gke:` prefix (matching [`Pulumi.yaml`](gke/Pulumi.yaml)). Create a fresh `prod` stack under the new project name after destroy, or migrate state carefully.

## Budget shutoff (circuit breaker)

Billing notifications are estimates and can lag by many hours (sometimes up to about two days), so this is a backstop, not a realtime cap. While the VM and database are stopped, **disk, Cloud SQL storage, and the reserved static IP keep billing**.

```text
Cloud Billing budget
  -> Pub/Sub topic jackline-budget
  -> Eventarc push as jackline-budget-invoker (OIDC, not public)
  -> Cloud Run function jackline-budget-shutoff (ingress internal only)
  -> stop VM jackline (if it is not already stopping / stopped)
  -> Cloud SQL jackline-db settings.activationPolicy = NEVER (if it is not already)
```

The function compares `costAmount` and `budgetAmount` on the [budget notification JSON](https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications). Under budget it logs and returns. At or over budget it stops both targets. A forecast-only alert (`forecastThresholdExceeded` while cost is still under the budget) does not stop anything. Pub/Sub delivery is at-least-once: if the VM is already `TERMINATED` / `STOPPING` / `SUSPENDED` the stop is skipped, and if Cloud SQL is already `NEVER` the patch is skipped. If one call fails, the invocation returns an error so Pub/Sub retries; the side that already succeeded is left alone.

The runtime service account can `get` and `stop` the VM, and `get` / `patch` that one Cloud SQL instance (`projects/PROJECT_ID/instances/jackline-db` only). It cannot delete instances, release the static IP, or change billing. The function is not invokable anonymously. If a shutoff log shows 403 from Cloud SQL, the condition did not match the instance resource name.

`pulumi up` does not undo a shutoff: the VM resource does not set `desiredStatus`, and the Cloud SQL resource ignores `settings.activationPolicy`. The next Deploy prod will still fail at SSH until you start the VM.

Stack outputs: `budgetTopicName`, `budgetTopicId`, `budgetShutoffFunctionName`.

### Wiring the budget

The topic and function are created on every VM `pulumi up`. The `gcp.billing.Budget` resource is created **only** when Pulumi config `billingAccountId` is set, so a deploy SA without billing-account permission does not fail the apply.

**Before the first apply**, the deploy SA also needs to create the new resources (it already has Compute, Cloud SQL, and service-account admin). Grant once as a project owner:

```bash
# PROJECT and DEPLOY_SA are the CI deploy service account's project and email.
for role in \
  roles/pubsub.admin \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/eventarc.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.admin \
  roles/storage.admin \
  roles/iam.roleAdmin \
  roles/resourcemanager.projectIamAdmin \
  roles/serviceusage.serviceUsageAdmin
do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${DEPLOY_SA}" --role="$role"
done
```

`serviceusage.serviceUsageAdmin` is only needed if this SA cannot already enable APIs (the stack already enables Compute and Cloud SQL).

**Option A — Pulumi creates the $35 budget.** The deploy SA (or you, locally) also needs `billing.budgets.create` on the billing account and `pubsub.topics.setIamPolicy` on the project. Cloud Billing then grants itself `roles/pubsub.publisher` on the topic. Connecting the topic requires permission to grant that publisher role; an organization policy that blocks `iam.allowedPolicyMemberDomains` must exempt the project or the grant fails.

```bash
cd deploy/pulumi/vm
pulumi config set billingAccountId 012345-6789AB-CDEF01   # or billingAccounts/012345-6789AB-CDEF01
# optional: pulumi config set budgetAmountUsd 35
pulumi up
```

Thresholds are 50%, 80%, 90%, and 100% of current spend (not forecast). Billing account admins still get the usual emails. The budget is filtered to this project, monthly, USD, credits included.

**Option B — create the budget yourself** and point it at the topic (use this when the deploy SA must not touch the billing account). Leave `billingAccountId` unset. After `pulumi up`, `budgetTopicId` looks like `projects/PROJECT/topics/jackline-budget`.

Console: Billing → Budgets & alerts → create a $35 / month budget for this project, thresholds 50 / 80 / 90 / 100, then **Connect a Pub/Sub topic** and select `jackline-budget`.

gcloud (billing-account admin):

```bash
BILLING_ACCOUNT=012345-6789AB-CDEF01
PROJECT=your-gcp-project-id
TOPIC="projects/${PROJECT}/topics/jackline-budget"
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="Jackline monthly budget" \
  --budget-amount=35USD \
  --calendar-period=month \
  --filter-projects="projects/${PROJECT}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.8 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic="$TOPIC"
```

`--filter-projects` takes `projects/PROJECT_ID`. The Pulumi budget resource uses the project **number** (`projects/123…`), which is what the Billing API stores.

### Safe test, then start things again

Pub/Sub messages are delivered several times a day once a budget is connected, including when spend is under the cap. To rehearse without stopping prod, turn dry run on (the function logs the stop it would perform and does not call Compute or Cloud SQL):

```bash
cd deploy/pulumi/vm
pulumi config set budgetShutoffDryRun true
pulumi up
```

Publish a synthetic over-budget payload (dry run must be on, or this **stops production**):

```bash
gcloud pubsub topics publish jackline-budget --project="$PROJECT" \
  --message='{"budgetDisplayName":"Jackline monthly budget","alertThresholdExceeded":1.0,"costAmount":35,"costIntervalStart":"2026-11-01T00:00:00Z","budgetAmount":35,"budgetAmountType":"SPECIFIED_AMOUNT","currencyCode":"USD"}'
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="jackline-budget-shutoff"' \
  --project="$PROJECT" --limit=20 --freshness=1h --format='value(textPayload,jsonPayload.message)'
```

Logs Explorer:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="jackline-budget-shutoff"
```

An under-budget message (`"costAmount":1`) should log and return. A malformed message is logged and acknowledged so Pub/Sub does not retry it forever.

When you are satisfied, set `budgetShutoffDryRun` to `false` and `pulumi up` again.

**Start prod after a real shutoff** (disks and data are still there; this does not restore from backup):

```bash
gcloud compute instances start jackline --zone=us-central1-a --project="$PROJECT"
gcloud sql instances patch jackline-db --activation-policy=ALWAYS --project="$PROJECT"
```

Use the real zone if it is not `us-central1-a`. Cloud SQL can take several minutes to become `RUNNABLE`. Then re-run Deploy prod or `remote-deploy.sh` if the app containers are not up.

From the repo root, `pnpm install` once before a local `pulumi up`. The Pulumi program packages the function (compiled JavaScript plus a lockfile, no `node_modules`) so Cloud Build installs real dependencies and does not see pnpm symlinks.

## Cost / abuse notes

- **VM:** bot traffic saturates CPU/RAM; bill stays roughly machine-sized (egress can still grow if scraped). Primary safety: fixed size, the [budget shutoff](#budget-shutoff-circuit-breaker), and destroy/stop when idle. Stopped disks and the static IP still cost money.
- **GKE:** day-scale bills are often dominated by Autopilot, then load balancing. Removing the Ingress alone does not stop Autopilot burn.
- Illustration only (one partial day on Autopilot): ~72% GKE / ~10% LB of ~$1.22 — not a guarantee for your project.

## Secrets hygiene

- Personal `Pulumi.*.yaml` stack files are **gitignored**. Commit only `Pulumi.*.example.yaml`.
- Prefer secrets in Pulumi config (`--secret`), GitHub Actions secrets, or GCP Secret Manager — never in git.
- VM startup script embeds app secrets in **instance metadata** (readable with `compute.instances.get`). Restrict who can read instances; rotate keys if metadata leaked.

## CI/CD (merge to `main`)

Workflows:

- [`.github/workflows/deploy-prod.yml`](../../.github/workflows/deploy-prod.yml) — `pulumi up` on push to `main`; VM path then SSH-runs `remote-deploy.sh`
- [`.github/workflows/pulumi-preview.yml`](../../.github/workflows/pulumi-preview.yml) — `pulumi preview` on PRs that touch deploy paths

Isolation is **per-repo configuration**: forks do not inherit your GitHub secrets, so their merges cannot deploy to your GCP.

### How CI authenticates to GCP (WIF)

CI does **not** use your personal `gcloud` login or a long-lived JSON key.

1. In **GCP Console** → **IAM & Admin → Workload Identity Federation**: create a pool + **OIDC provider** for GitHub (`https://token.actions.githubusercontent.com`), restricted to your repo.
2. Create a **deploy service account**; grant the WIF principal `roles/iam.workloadIdentityUser` on that SA.
3. Grant the SA: Compute (`instanceAdmin`, `securityAdmin`, `osAdminLogin`, **`publicIpAdmin`** for the regional static address), IAP tunnel, **`roles/iam.serviceAccountAdmin`** (create the dedicated `jackline-vm` SA), **`roles/cloudsql.admin`** (provision Cloud SQL + VPC peering), **`roles/servicenetworking.networksAdmin`** (private services connection on `default`), Pulumi state bucket R/W, KMS decrypt if used, Secret Manager list/access.

   ```bash
   # Regional static IP (jackline-vm-ip) — required after #29
   gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
     --member="serviceAccount:$GCP_SERVICE_ACCOUNT" \
     --role="roles/compute.publicIpAdmin"
   ```

4. Enable **`iap.googleapis.com`** and **`oslogin.googleapis.com`** (IAP tunnel + OS Login SSH).
5. The VM path creates a dedicated **`jackline-vm@…`** runtime SA (not the default Compute Engine SA) and attaches it to the instance. Set Pulumi config `deployServiceAccount` to your CI deploy SA email (CI does this automatically from `GCP_SERVICE_ACCOUNT`) so Pulumi grants `roles/iam.serviceAccountUser` on `jackline-vm` — required for OS Login and for attaching the SA at create/update time. The [budget shutoff](#budget-shutoff-circuit-breaker) needs extra project roles on this same deploy SA before its first apply (Pub/Sub, Cloud Functions, Cloud Run, Eventarc, Cloud Build, Artifact Registry, Storage, custom roles, project IAM).
6. Put secrets and variables on the GitHub **`production` Environment** (both workflows set `environment: production`):
   **Settings → Environments → production**.

   **Public repo:** GitHub prints Environment *variables* in every step’s `env:` block. Keep hostnames and ACME email as **secrets** so Actions masks them. Workflows still accept the old variable names as a fallback.

| Secret / variable | Purpose |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/…/locations/global/workloadIdentityPools/…/providers/…` |
| `GCP_SERVICE_ACCOUNT` | Deploy SA email |
| `GCP_PROJECT_ID` | GCP project id |
| `PULUMI_STATE_BUCKET` | e.g. `gs://your-pulumi-state` |
| `PULUMI_CONFIG_PASSPHRASE` | Only if the stack uses passphrase encryption |
| `JACKLINE_DOMAIN` (**secret**) | App hostname (variable fallback still works, but leaks in logs) |
| `JACKLINE_DOCS_DOMAIN` (**secret**, optional) | Docs hostname |
| `JACKLINE_CADDY_EMAIL` (**secret**, optional) | Let’s Encrypt contact |
| `JACKLINE_GIT_REPO` (variable) | Git URL the VM clones (required for `vm`) |
| `JACKLINE_DEPLOY_PATH` (variable) | `vm` (default) or `gke` |
| `JACKLINE_VM_ZONE` / `JACKLINE_VM_NAME` (**secrets**) | Zone / instance name (variable fallback still works, but leaks in logs) |
| `JACKLINE_SECRET_PREFIX` (variable) | Default `jackline-pulumi-` |

Forks do not inherit your `production` Environment secrets, so their runs cannot deploy to your GCP.

Enable **IAP** tunnel access for the deploy SA (`roles/iap.tunnelResourceAccessor`) so Actions can `gcloud compute ssh --tunnel-through-iap` without opening SSH to the world.

### App / Pulumi secrets (Secret Manager prefix)

Do **not** put rotating secrets in GitHub. Create Secret Manager secrets whose IDs start with the prefix (default `jackline-pulumi-`). CI runs [`deploy/scripts/ci-pulumi-apply-config.sh`](../scripts/ci-pulumi-apply-config.sh), which lists that prefix and runs `pulumi config set --secret <key>` for each.

| Secret Manager ID | Pulumi config key |
| --- | --- |
| `jackline-pulumi-jacklineMasterKey` | `jacklineMasterKey` |
| `jackline-pulumi-betterAuthSecret` | `betterAuthSecret` |
| `jackline-pulumi-postgresPassword` | `postgresPassword` (Cloud SQL user `jackline`) |
| `jackline-pulumi-cloudSqlPrivateIp` | optional fallback for `ci-render-env-prod.sh` if not using pulumi outputs |
| `jackline-pulumi-cloudSqlConnectionName` | optional fallback (`project:region:jackline-db`) |
| `jackline-pulumi-tenancy` | `tenancy` (`single` or `multi`) |
| `jackline-pulumi-githubDeployToken` | `githubDeployToken` (PAT with repo read — first-boot clone on private repos) |
| `jackline-pulumi-googleClientId` | `googleClientId` (optional — platform Google login; rendered to `GOOGLE_CLIENT_ID` on deploy) |
| `jackline-pulumi-googleClientSecret` | `googleClientSecret` (optional — pair with `googleClientId`) |
| `jackline-pulumi-emailConnector` | `emailConnector` (optional — `resend`, `smtp`, or `console`; defaults from other email secrets) |
| `jackline-pulumi-resendApiKey` | `resendApiKey` (optional — Resend API key; pair with `emailFrom`) |
| `jackline-pulumi-emailFrom` | `emailFrom` (optional — platform from address) |
| `jackline-pulumi-smtpHost` | `smtpHost` (optional — SMTP connector host; pair with `emailFrom`) |
| `jackline-pulumi-smtpPort` | `smtpPort` (optional — defaults to `587` when host/from are set) |
| `jackline-pulumi-smtpUser` | `smtpUser` (optional — SMTP auth) |
| `jackline-pulumi-smtpPass` | `smtpPass` (optional — pair with `smtpUser`) |

```bash
# example
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create jackline-pulumi-jacklineMasterKey \
    --data-file=- --replication-policy=automatic
# rotate later: gcloud secrets versions add jackline-pulumi-jacklineMasterKey --data-file=-
```

Add a new required Pulumi secret later by creating another `jackline-pulumi-<key>` in GCP — **no workflow edit**. Plain knobs (`domain`, `gitRepo`, …) stay GitHub **variables**.

### Cloud SQL (managed Postgres)

The VM path provisions **`jackline-db`** (`db-f1-micro`, 10 GB HDD by default, zonal, private IP on the `default` VPC). Stack outputs:

| Output | Purpose |
| --- | --- |
| `cloudSqlPrivateIp` | `DATABASE_URL` host (CI reads this each deploy) |
| `cloudSqlConnectionName` | `project:region:jackline-db` — for `gcloud sql connect` / proxy |
| `cloudSqlInstanceName` | Instance id |

**Run SQL manually** — the instance has **private IP only** (not reachable from the public internet). SSH to the VM, then use `psql`:

```bash
gcloud compute ssh jackline --project=YOUR_PROJECT --zone=us-central1-a --tunnel-through-iap
sudo apt-get install -y postgresql-client   # once
psql "$(grep ^DATABASE_URL= /opt/jackline/.env.prod | cut -d= -f2-)"
```

From a machine on the same VPC you can also use `gcloud sql connect jackline-db --user=jackline`.

Optional Pulumi config: `cloudSqlTier` (default `db-f1-micro`), `cloudSqlDiskSize` (default `10`), `cloudSqlDiskType` (`PD_HDD` or `PD_SSD`).

### Pre-deploy backup

Each prod deploy creates a **Cloud SQL on-demand backup** in CI (`gcloud sql backups create`) before the app is updated. If backup fails, deploy aborts. Backups are stored by Google and survive VM loss.

**Retention (cost control):**

| Backup type | Limit | How |
| --- | --- | --- |
| **Automated** (daily 04:00 UTC) | **7** (default) | Pulumi `backupRetentionSettings.retainedBackups` |
| **On-demand** (pre-deploy) | **7** (default) | CI deletes oldest after each new backup |

Tune via Pulumi config `cloudSqlAutomatedBackupRetain` / `cloudSqlOnDemandBackupKeep`, or env `JACKLINE_CLOUDSQL_ON_DEMAND_KEEP` in CI.

Backup storage is billed at ~$0.08/GB-month beyond the free allowance (backups up to DB size are often free). With a small DB and capped retention, expect **well under $1/mo** for backup storage.

**Restore** after a bad deploy:

```bash
gcloud sql backups list --instance=jackline-db --project=YOUR_PROJECT
gcloud sql backups restore BACKUP_ID --restore-instance=jackline-db --project=YOUR_PROJECT
```

**Private GitHub repos / incomplete first boot:** Deploy CI renders `.env.prod` from Secret Manager (`ci-render-env-prod.sh`), scp’s it over IAP, and runs `remote-deploy.sh` with a short-lived `GITHUB_TOKEN` file (not persisted in git remotes). First-boot startup can still embed `jackline-pulumi-githubDeployToken` for an unattended private clone, but CI no longer depends on startup having succeeded.

## Layout

```text
deploy/pulumi/
  README.md          ← you are here
  vm/                ← hobbyist default (includes the budget shutoff)
  gke/               ← advanced Autopilot path
deploy/functions/
  budget-shutoff/    ← Pub/Sub Cloud Run function packaged by the VM stack
deploy/scripts/
  remote-deploy.sh              ← VM app update (CI + manual)
  ci-pulumi-apply-config.sh     ← vars + SM prefix → pulumi config
```
