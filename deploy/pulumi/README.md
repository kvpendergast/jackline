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

Point DNS A/AAAA for your domain (and `docs.<domain>` unless you set `docsDomain`) at the **`publicIp`** stack output **before** (or immediately after) the first HTTPS deploy so Caddy can finish Let’s Encrypt. Pulumi creates a **regional** static external IP (`jackline-vm-ip` by default in `gcp:region`) and attaches it to the VM — do **not** reuse a global GKE address like `jackline-ip`. First boot installs Docker, clones the repo, and runs [`compose.prod.yml`](../compose.prod.yml) with Caddy TLS. Postgres runs on **Cloud SQL** (`jackline-db`, private IP only); the VM connects over the default VPC. If the browser shows `ERR_SSL_PROTOCOL_ERROR` after a DNS cutover, re-run **Deploy prod** — remote-deploy reloads Caddy, and **recreates** it only when TLS is not serving a certificate (so ACME retries).

**Later app updates** (and CI) use [`../scripts/remote-deploy.sh`](../scripts/remote-deploy.sh) — startup scripts do **not** re-run on every deploy. Do **not** run `docker compose up --build -d` on a live VM: that replaces containers in place. remote-deploy builds new images first, starts a second replica (`--scale 2 --no-recreate`), waits until Docker health is green, and only then stops the old replica. If the new replica fails health, it is removed and the old one keeps serving. The script re-execs under `systemd-run` so a cancelled CI SSH session does not SIGKILL the build.

```bash
# after pulumi up
gcloud compute ssh jackline --zone=ZONE --command='sudo GIT_SHA=main bash -s' \
  < ../scripts/remote-deploy.sh
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

| Secret / variable | Purpose |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/…/locations/global/workloadIdentityPools/…/providers/…` |
| `GCP_SERVICE_ACCOUNT` | Deploy SA email |
| `GCP_PROJECT_ID` | GCP project id |
| `PULUMI_STATE_BUCKET` | e.g. `gs://your-pulumi-state` |
| `PULUMI_CONFIG_PASSPHRASE` | Only if the stack uses passphrase encryption |
| `JACKLINE_DOMAIN` (variable) | App hostname |
| `JACKLINE_GIT_REPO` (variable) | Git URL the VM clones (required for `vm`) |
| `JACKLINE_DEPLOY_PATH` (variable) | `vm` (default) or `gke` |
| `JACKLINE_VM_ZONE` / `JACKLINE_VM_NAME` (variables) | Defaults `us-central1-a` / `jackline` |
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
