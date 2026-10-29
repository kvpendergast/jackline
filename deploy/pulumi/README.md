# Jackline on GCP (Pulumi)

Hobbyist-first deploy paths for Jackline on Google Cloud.

| Path | Who it's for | Cost shape |
| --- | --- | --- |
| **[`vm/`](vm/)** (default) | Weekend demos, personal instances | One small VM + **Cloud SQL `db-f1-micro`** (~$10/mo DB + ~$12–15/mo VM). Fixed sizes = **compute bill stays flat** under bot traffic. |
| **[`gke/`](gke/)** (advanced) | Learning Kubernetes / Autopilot | Autopilot + global HTTP LB keep burning while up. **Not** the overnight hobbyist default. |

Budgets only **alert** — they do not hard-cap spend. Prefer architecture that bounds cost (`vm/`), and `pulumi destroy` (or stop the VM) when idle.

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

## Cost / abuse notes

- **VM:** bot traffic saturates CPU/RAM; bill stays roughly machine-sized (egress can still grow if scraped). Primary safety: fixed size + destroy/stop when idle.
- **GKE:** day-scale bills are often dominated by Autopilot, then load balancing. Removing the Ingress alone does not stop Autopilot burn.
- Illustration only (one partial day on Autopilot): ~72% GKE / ~10% LB of ~$1.22 — not a guarantee for your project.

## Spot VM (optional, off by default)

Set `spot=true` (CI: repository/Environment variable `JACKLINE_SPOT=true`) to run the `vm` path on a
[Spot VM](https://cloud.google.com/compute/docs/instances/spot). With it unset or `false` nothing changes:
no scheduling block, no shutdown script, no extra resources.

**Savings.** Spot pricing is typically ~60–70% below on-demand for the VM's vCPU/RAM (e2-small: roughly
$12/mo → $4–5/mo, so ~$7–8/mo saved; check current Spot prices for your region). Boot disk, static IP,
Cloud SQL and egress are billed the same. The autoheal below adds about **$1.30/mo** at the default
2-minute cadence (Cloud Workflows: ~4 internal + 1 external step per run past the free tier; one Cloud
Scheduler job, free if the billing account has fewer than 3). `spotAutohealSchedule: "*/5 * * * *"`
cuts that to ~$0.50/mo at the cost of slower recovery.

**What `spot=true` creates.**

- Instance `scheduling`: `provisioningModel=SPOT`, `instanceTerminationAction=STOP` (preemption *stops*
  the VM, keeping name, boot disk and static IP), `automaticRestart=false`, `onHostMaintenance=TERMINATE`.
- `shutdown-script` metadata: `docker compose stop -t 20` (GCE gives Spot VMs ~30s after preemption notice).
- A boot fast path in `startup-script`: on reboot of an already-bootstrapped VM it just restarts the
  existing containers instead of re-running the first-boot bootstrap (which would reset the checkout).
- Autoheal: service account `jackline-autoheal`, Cloud Workflow `jackline-autoheal`, Cloud Scheduler job
  `jackline-autoheal` (APIs `workflows` + `cloudscheduler` enabled). Every run it reads the instance:
  - `TERMINATED` (preempted, or stopped >90s ago) → `instances.start`.
  - `RUNNING` and older than 1h, last started >15 min ago → `GET https://<domain>/health` (4 tries, 15s
    apart). If all fail → stop, wait for `TERMINATED`, start. So a hung VM or app is power-cycled at most
    about once per ~17 min.

**Downtime per preemption.** Up to one schedule interval to notice (≤2 min) + ~1–2 min to boot and
start containers ≈ **2–4 min**. Spot VMs can be preempted at any time (often rarely, sometimes several
times a day; no SLA), and capacity may be unavailable, in which case `start` fails and is retried
every interval until it succeeds.

**Enable (one-time).**

1. The CI deploy SA needs to create Workflows / Scheduler jobs / service accounts and set instance IAM
   (e.g. `roles/workflows.admin`, `roles/cloudscheduler.admin`, `compute.instances.setIamPolicy`).
2. Workflows has no per-resource IAM, so grant the invoker role at project level (the deploy SA can't):
   ```bash
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member=serviceAccount:jackline-autoheal@PROJECT_ID.iam.gserviceaccount.com \
     --role=roles/workflows.invoker
   ```
   (Run after the first apply creates the SA, or pre-create it; until then the scheduler calls 403.)
3. Set the variable `JACKLINE_SPOT=true` on the `production` Environment and run Deploy prod.

> **The first enable REPLACES the VM.** `provisioningModel`/`preemptible` are ForceNew in the GCP
> provider, so Pulumi deletes and recreates `jackline` (same name and static IP, **new boot disk**):
> expect ~20 min downtime while it bootstraps, and on-VM Docker volumes (e.g. Caddy certificates) are
> recreated. Data in Cloud SQL is unaffected. Do it in a quiet window and check `pulumi preview` first.

**Pause for maintenance.** If you stop the VM on purpose, autoheal will start it again after 90s. Pause it:
`gcloud scheduler jobs pause jackline-autoheal --location=REGION` (and `resume` afterwards).

**Revert.** Unset `JACKLINE_SPOT` (or set `false`) and deploy. This removes the autoheal resources and the
shutdown script, and **also replaces the VM** back to on-demand (same ~20 min). Optionally remove the
`roles/workflows.invoker` binding.

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
5. The VM path creates a dedicated **`jackline-vm@…`** runtime SA (not the default Compute Engine SA) and attaches it to the instance. Set Pulumi config `deployServiceAccount` to your CI deploy SA email (CI does this automatically from `GCP_SERVICE_ACCOUNT`) so Pulumi grants `roles/iam.serviceAccountUser` on `jackline-vm` — required for OS Login and for attaching the SA at create/update time.
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
  vm/                ← hobbyist default
  gke/               ← advanced Autopilot path
deploy/scripts/
  remote-deploy.sh              ← VM app update (CI + manual)
  ci-pulumi-apply-config.sh     ← vars + SM prefix → pulumi config
```
