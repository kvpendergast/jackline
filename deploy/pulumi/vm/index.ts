import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cfg = new pulumi.Config();
const gcpCfg = new pulumi.Config("gcp");
const project = gcpCfg.require("project");
const region = gcpCfg.get("region") ?? "us-central1";
const zone = cfg.get("zone") ?? `${region}-a`;

const domain = cfg.require("domain");
const docsDomain = cfg.get("docsDomain") ?? `docs.${domain}`;
const machineType = cfg.get("machineType") ?? "e2-small";
const gitRepo = cfg.require("gitRepo");
const gitRef = cfg.get("gitRef") ?? "main";
const caddyEmail = cfg.get("caddyEmail") ?? "";
const tenancy = cfg.get("tenancy") ?? "single";
const cloudSqlTier = cfg.get("cloudSqlTier") ?? "db-f1-micro";
const cloudSqlDiskSize = cfg.getNumber("cloudSqlDiskSize") ?? 10;
const cloudSqlDiskType = cfg.get("cloudSqlDiskType") ?? "PD_HDD";
const cloudSqlAutomatedBackupRetain = cfg.getNumber("cloudSqlAutomatedBackupRetain") ?? 7;
const cloudSqlOnDemandBackupKeep = cfg.getNumber("cloudSqlOnDemandBackupKeep") ?? 7;

const masterKey = cfg.requireSecret("jacklineMasterKey");
const betterAuthSecret = cfg.requireSecret("betterAuthSecret");
const postgresPassword = cfg.getSecret("postgresPassword") ?? pulumi.output("jackline");
// PAT for private github.com clone on first boot (optional; CI uses GITHUB_TOKEN via remote-deploy).
const githubDeployToken = cfg.getSecret("githubDeployToken");
// CI deploy SA (WIF). Used to grant actAs on the VM SA for OS Login / instance attach.
const deployServiceAccount = cfg.get("deployServiceAccount");
// Spot VM (opt-in, default off). See deploy/pulumi/README.md § Spot VM.
// NOTE: provisioningModel/preemptible are ForceNew in pulumi-gcp 8.x, so flipping
// this on an existing stack REPLACES the VM (delete-first: fixed name + static IP).
const spot = cfg.getBoolean("spot") ?? false;
// Cloud Scheduler cron for the Spot autoheal workflow (start if preempted,
// stop/start if /health keeps failing). Every 2 min ≈ $1.30/mo of Workflows steps.
const spotAutohealSchedule = cfg.get("spotAutohealSchedule") ?? "*/2 * * * *";

const publicBaseUrl = `https://${domain}`;
const docsBaseUrl = `https://${docsDomain}`;
const networkTag = "jackline-web";
const installRoot = "/opt/jackline";

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------
const computeApi = new gcp.projects.Service("compute", {
  service: "compute.googleapis.com",
  disableOnDestroy: false,
});

const iamApi = new gcp.projects.Service("iam", {
  service: "iam.googleapis.com",
  disableOnDestroy: false,
});

const sqlAdminApi = new gcp.projects.Service("sqladmin", {
  service: "sqladmin.googleapis.com",
  disableOnDestroy: false,
});

const serviceNetworkingApi = new gcp.projects.Service("servicenetworking", {
  service: "servicenetworking.googleapis.com",
  disableOnDestroy: false,
});

// ---------------------------------------------------------------------------
// Cloud SQL (managed Postgres — survives VM replace)
// ---------------------------------------------------------------------------
const defaultNetwork = pulumi.interpolate`projects/${project}/global/networks/default`;

const sqlPrivateRange = new gcp.compute.GlobalAddress(
  "jackline-sql-private-range",
  {
    name: "jackline-sql-private-range",
    purpose: "VPC_PEERING",
    addressType: "INTERNAL",
    prefixLength: 16,
    network: "default",
  },
  { dependsOn: [computeApi] },
);

const sqlPrivateConnection = new gcp.servicenetworking.Connection(
  "jackline-sql-vpc",
  {
    network: defaultNetwork,
    service: "servicenetworking.googleapis.com",
    reservedPeeringRanges: [sqlPrivateRange.name],
  },
  { dependsOn: [serviceNetworkingApi, sqlPrivateRange] },
);

const sqlInstance = new gcp.sql.DatabaseInstance(
  "jackline-db",
  {
    name: "jackline-db",
    databaseVersion: "POSTGRES_16",
    region,
    deletionProtection: true,
    settings: {
      tier: cloudSqlTier,
      edition: "ENTERPRISE",
      diskSize: cloudSqlDiskSize,
      diskType: cloudSqlDiskType,
      ipConfiguration: {
        ipv4Enabled: false,
        privateNetwork: defaultNetwork,
      },
      backupConfiguration: {
        enabled: true,
        startTime: "04:00",
        pointInTimeRecoveryEnabled: false,
        backupRetentionSettings: {
          retainedBackups: cloudSqlAutomatedBackupRetain,
          retentionUnit: "COUNT",
        },
      },
    },
  },
  { dependsOn: [sqlAdminApi, sqlPrivateConnection] },
);

new gcp.sql.Database(
  "jackline-db",
  {
    instance: sqlInstance.name,
    name: "jackline",
  },
  { dependsOn: [sqlInstance] },
);

new gcp.sql.User(
  "jackline-db",
  {
    instance: sqlInstance.name,
    name: "jackline",
    password: postgresPassword,
  },
  { dependsOn: [sqlInstance] },
);

const cloudSqlConnName = pulumi.interpolate`${project}:${region}:${sqlInstance.name}`;
const databaseUrl = pulumi.interpolate`postgresql://jackline:${postgresPassword}@${sqlInstance.privateIpAddress}:5432/jackline`;

// ---------------------------------------------------------------------------
// VM service account (not the default Compute Engine SA)
// ---------------------------------------------------------------------------
const vmSa = new gcp.serviceaccount.Account(
  "jackline-vm",
  {
    accountId: "jackline-vm",
    displayName: "Jackline VM runtime",
    description: "Identity attached to the Jackline Compose VM (least privilege).",
  },
  { dependsOn: [iamApi] },
);

// Allow CI / operator deploy SA to attach this SA to the instance and SSH via OS Login.
if (deployServiceAccount) {
  new gcp.serviceaccount.IAMMember("jackline-vm-deploy-act-as", {
    serviceAccountId: vmSa.name,
    role: "roles/iam.serviceAccountUser",
    member: `serviceAccount:${deployServiceAccount}`,
  });
}

// OTEL Collector on the VM ships stdout logs / OTLP traces to Cloud Logging & Trace.
// Project IAM for jackline-vm (logWriter / cloudtrace.agent) is a one-time operator
// grant — the CI deploy SA typically lacks resourcemanager.projectIamAdmin. See
// deploy/pulumi/README.md § Logs.
new gcp.projects.Service("logging", {
  service: "logging.googleapis.com",
  disableOnDestroy: false,
});
new gcp.projects.Service("cloudtrace", {
  service: "cloudtrace.googleapis.com",
  disableOnDestroy: false,
});

// ---------------------------------------------------------------------------
// Firewall: HTTP/HTTPS to tagged VMs
// ---------------------------------------------------------------------------
const firewall = new gcp.compute.Firewall(
  "jackline-web",
  {
    network: "default",
    allows: [
      { protocol: "tcp", ports: ["80", "443"] },
    ],
    sourceRanges: ["0.0.0.0/0"],
    targetTags: [networkTag],
    description: "Jackline Caddy HTTP/HTTPS",
  },
  { dependsOn: [computeApi] },
);

// IAP TCP forwarding range — required for `gcloud compute ssh --tunnel-through-iap`
const iapSsh = new gcp.compute.Firewall(
  "jackline-iap-ssh",
  {
    network: "default",
    allows: [{ protocol: "tcp", ports: ["22"] }],
    sourceRanges: ["35.235.240.0/20"],
    targetTags: [networkTag],
    description: "SSH via Identity-Aware Proxy for Jackline VM deploys",
  },
  { dependsOn: [computeApi] },
);

// ---------------------------------------------------------------------------
// Startup script: Docker + clone + compose.prod.yml (runs on first boot)
// Ongoing app deploys use deploy/scripts/remote-deploy.sh via CI SSH.
// ---------------------------------------------------------------------------
const startupScript = pulumi
  .all([masterKey, betterAuthSecret, postgresPassword, githubDeployToken, databaseUrl, cloudSqlConnName])
  .apply(([mk, bas, pg, ghToken, dbUrl, sqlConn]) => {
    const caddyGlobal = caddyEmail ? `email ${caddyEmail}` : "";
    const cloneRepo =
      ghToken && gitRepo.startsWith("https://github.com/")
        ? gitRepo.replace("https://github.com/", `https://x-access-token:${ghToken}@github.com/`)
        : gitRepo;
    // Escape values for embedding in a shell single-quoted heredoc via printf %q-ish:
    // we write the env file with a Python one-liner to avoid shell injection.
    const envPayload = {
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      JACKLINE_TENANCY: tenancy,
      JACKLINE_MASTER_KEY: mk,
      BETTER_AUTH_SECRET: bas,
      JACKLINE_SECRET_STORAGE_LOCATION: "local",
      POSTGRES_PASSWORD: pg,
      DATABASE_URL: dbUrl,
      CLOUD_SQL_CONNECTION_NAME: sqlConn,
      JACKLINE_SITE_ADDRESS: domain,
      JACKLINE_DOCS_SITE_ADDRESS: docsDomain,
      JACKLINE_HTTP_PORT: "80",
      JACKLINE_HTTPS_PORT: "443",
      JACKLINE_CADDY_GLOBAL_OPTIONS: caddyGlobal,
      WEB_ORIGIN: publicBaseUrl,
      BETTER_AUTH_URL: publicBaseUrl,
      JACKLINE_PUBLIC_API_URL: publicBaseUrl,
      JACKLINE_PUBLIC_MCP_URL: `${publicBaseUrl}/mcp`,
      JACKLINE_INTERNAL_MCP_URL: "http://gateway:8081/mcp",
      API_HOST: "0.0.0.0",
      API_PORT: "8080",
      GATEWAY_HOST: "0.0.0.0",
      GATEWAY_PORT: "8081",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318/v1/traces",
      GCP_PROJECT_ID: project,
    };
    const envJson = JSON.stringify(envPayload);

    // Spot only: GCE runs startup-script on EVERY boot. Without this fast path a
    // preemption restart would re-clone main, overwrite the CI-rendered .env.prod
    // with the Pulumi-rendered one, and \`compose up --build\` on the VM. Instead,
    // once bootstrapped, just start the containers that were running (same images
    // + env as the last CI deploy). Standard (non-Spot) VMs keep the script
    // byte-identical so Pulumi shows no metadata diff.
    const spotRebootFastPath = spot
      ? `#!/bin/bash
# --- Spot VM restart fast path (deploy/pulumi/vm spot=true) ---
if [ -d ${installRoot}/.git ] && [ -f ${installRoot}/.env.prod ] && command -v docker >/dev/null 2>&1; then
  exec > >(tee -a /var/log/jackline-startup.log) 2>&1
  echo "=== Jackline Spot restart $(date -u): starting existing containers ==="
  systemctl start docker
  # shutdown-script ran \`docker compose stop\`, which marks containers explicitly
  # stopped, so restart: unless-stopped will not bring them back by itself.
  for id in $(docker ps -aq --filter status=exited --filter status=created); do
    policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id" 2>/dev/null || true)"
    if [ "$policy" = "unless-stopped" ] || [ "$policy" = "always" ]; then
      docker start "$id" || true
    fi
  done
  echo "=== Jackline Spot restart complete ==="
  exit 0
fi
`
      : "";

    return `${spotRebootFastPath}#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/jackline-startup.log) 2>&1
echo "=== Jackline VM bootstrap $(date -u) ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

systemctl enable --now docker

mkdir -p ${installRoot}
if [ ! -d ${installRoot}/.git ]; then
  git clone --depth 1 --branch "${gitRef}" "${cloneRepo}" ${installRoot}
else
  cd ${installRoot}
  git fetch --depth 1 origin "${gitRef}"
  git checkout -f FETCH_HEAD
fi

# Write .env.prod without shell-quoting pitfalls (secrets land in instance metadata — restrict IAM).
python3 - <<'PY'
import json, pathlib
env = json.loads(${JSON.stringify(envJson)})
path = pathlib.Path("${installRoot}/.env.prod")
path.write_text("\\n".join(f"{k}={v}" for k, v in env.items()) + "\\n", encoding="utf-8")
path.chmod(0o600)
print("wrote", path)
PY

cd ${installRoot}
docker compose -f deploy/compose.prod.yml -f deploy/compose.otel.yml --env-file .env.prod up --build -d
echo "=== Jackline bootstrap complete ==="
`;
  });

// Spot only: preemption gives ~30s notice (ACPI soft-off). Drain the app so
// in-flight requests finish and Cloud SQL connections close cleanly. Containers
// are started again by the startup-script fast path on the next boot.
const spotShutdownScript = `#!/bin/bash
echo "=== Jackline shutdown $(date -u): preempted=$(curl -fs -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/preempted || echo unknown) ==="
cd ${installRoot} 2>/dev/null || exit 0
[ -f .env.prod ] || exit 0
timeout 27 docker compose -f deploy/compose.prod.yml -f deploy/compose.otel.yml --env-file .env.prod stop -t 20 || true
`;

// ---------------------------------------------------------------------------
// Regional static external IP (DNS-stable; VMs cannot use global LB addresses)
// ---------------------------------------------------------------------------
const addressName = cfg.get("staticIpName") ?? "jackline-vm-ip";
const staticIp = new gcp.compute.Address(
  "jackline-vm-ip",
  {
    name: addressName,
    region,
    addressType: "EXTERNAL",
    description: "Jackline VM public IP — point DNS A/AAAA here",
  },
  { dependsOn: [computeApi] },
);

// ---------------------------------------------------------------------------
// Spot autoheal (spot=true only): Cloud Scheduler -> Cloud Workflows
//
// Spot VMs cannot use automaticRestart, so every few minutes a tiny workflow:
//   - TERMINATED (preempted / stopped) for > 90s  -> instances.start
//   - RUNNING but https://<domain>/health fails 4x over ~1 min
//     (VM up > 15 min, created > 1 h ago)          -> stop, wait, start
// The instance keeps its name, boot disk and static IP (no MIG / recreate).
// No code to build or deploy; ~$1.30/mo of Workflows steps at */2.
// ---------------------------------------------------------------------------
const instanceNameStr = "jackline";
const spotAutohealDeps: pulumi.Resource[] = [];
let autohealSa: gcp.serviceaccount.Account | undefined;
let autohealWorkflow: gcp.workflows.Workflow | undefined;
if (spot) {
  const workflowsApi = new gcp.projects.Service("workflows", {
    service: "workflows.googleapis.com",
    disableOnDestroy: false,
  });
  const schedulerApi = new gcp.projects.Service("cloudscheduler", {
    service: "cloudscheduler.googleapis.com",
    disableOnDestroy: false,
  });

  autohealSa = new gcp.serviceaccount.Account(
    "jackline-autoheal",
    {
      accountId: "jackline-autoheal",
      displayName: "Jackline Spot autoheal",
      description: "Runs the Jackline Spot autoheal workflow (start/stop the jackline VM only).",
    },
    { dependsOn: [iamApi] },
  );

  // CI deploy SA must be able to attach this SA to the workflow + scheduler job.
  const actAs: pulumi.Resource[] = [];
  if (deployServiceAccount) {
    actAs.push(
      new gcp.serviceaccount.IAMMember("jackline-autoheal-deploy-act-as", {
        serviceAccountId: autohealSa.name,
        role: "roles/iam.serviceAccountUser",
        member: `serviceAccount:${deployServiceAccount}`,
      }),
    );
  }

  const q = (v: string) => JSON.stringify(v);
  // Workflows expressions use ${...}; built by concatenation to avoid TS template clashes.
  const e = (expr: string) => "${" + expr + "}";
  const ts = (field: string) => `time.parse(default(map.get(vm, "${field}"), "1970-01-01T00:00:00Z"))`;
  const vmArgs = [
    "        args:",
    `          project: ${e("project")}`,
    `          zone: ${e("zone")}`,
    `          instance: ${e("instance")}`,
  ];
  const noPoll = ["          connector_params:", "            skip_polling: true"];
  // Healthy path = 4 internal steps + 1 external HTTP step per execution.
  const workflowSource = [
    "main:",
    "  steps:",
    "    - init:",
    "        assign:",
    `          - project: ${q(project)}`,
    `          - zone: ${q(zone)}`,
    `          - instance: ${q(instanceNameStr)}`,
    `          - healthUrl: ${q(`${publicBaseUrl}/health`)}`,
    "          - healthy: true",
    "          - polls: 0",
    `          - now: ${e("sys.now()")}`,
    "    - getVm:",
    "        call: googleapis.compute.v1.instances.get",
    ...vmArgs,
    "        result: vm",
    "    - route:",
    "        switch:",
    // Short grace so a Pulumi stop-for-update or an operator stop isn't raced.
    `          - condition: ${e(`vm.status == "TERMINATED" and now - ${ts("lastStopTimestamp")} < 90`)}`,
    "            next: end",
    `          - condition: ${e('vm.status == "TERMINATED"')}`,
    "            next: start",
    // Fresh VM (first boot + CI deploy can take ~25 min) or recent boot: don't probe.
    `          - condition: ${e(`vm.status == "RUNNING" and (now - ${ts("creationTimestamp")} < 3600 or now - ${ts("lastStartTimestamp")} < 900)`)}`,
    "            next: end",
    `          - condition: ${e('vm.status == "RUNNING"')}`,
    "            next: probe",
    "        next: end",
    "    - start:",
    "        call: googleapis.compute.v1.instances.start",
    ...vmArgs,
    ...noPoll,
    "        next: end",
    "    - probe:",
    "        try:",
    "          call: http.get",
    "          args:",
    `            url: ${e("healthUrl")}`,
    "            timeout: 10",
    "        retry:",
    `          predicate: ${e("always_retry")}`,
    "          max_retries: 3",
    "          backoff:",
    "            initial_delay: 15",
    "            max_delay: 15",
    "            multiplier: 1",
    "        except:",
    "          as: err",
    "          steps:",
    "            - markUnhealthy:",
    "                assign:",
    "                  - healthy: false",
    "    - afterProbe:",
    "        switch:",
    `          - condition: ${e("healthy")}`,
    "            next: end",
    "        next: stopVm",
    "    - stopVm:",
    "        call: googleapis.compute.v1.instances.stop",
    ...vmArgs,
    ...noPoll,
    "    - waitStopped:",
    "        call: sys.sleep",
    "        args:",
    "          seconds: 10",
    "    - pollVm:",
    "        call: googleapis.compute.v1.instances.get",
    ...vmArgs,
    "        result: vm",
    "    - countPoll:",
    "        assign:",
    `          - polls: ${e("polls + 1")}`,
    "    - checkStopped:",
    "        switch:",
    `          - condition: ${e('vm.status == "TERMINATED"')}`,
    "            next: restart",
    `          - condition: ${e("polls < 30")}`,
    "            next: waitStopped",
    "        next: stopTimeout",
    "    - stopTimeout:",
    "        raise: \"jackline VM did not stop within 5 minutes\"",
    "    - restart:",
    "        call: googleapis.compute.v1.instances.start",
    ...vmArgs,
    ...noPoll,
    "    - restarted:",
    "        return: \"restarted after failed health checks\"",
    "",
    "always_retry:",
    "  params: [e]",
    "  steps:",
    "    - retryAll:",
    "        return: true",
    "",
  ].join("\n");

  autohealWorkflow = new gcp.workflows.Workflow(
    "jackline-autoheal",
    {
      name: "jackline-autoheal",
      region,
      description: "Restart the Jackline Spot VM after preemption or failed /health checks.",
      serviceAccount: autohealSa.email,
      sourceContents: workflowSource,
      deletionProtection: false,
      labels: { app: "jackline" },
    },
    { dependsOn: [workflowsApi, autohealSa, ...actAs] },
  );

  // Scheduler -> Workflows Executions API (OAuth as the autoheal SA).
  // Requires a one-time project grant: roles/workflows.invoker for this SA
  // (the CI deploy SA usually cannot set project IAM — see README § Spot VM).
  const autohealJob = new gcp.cloudscheduler.Job(
    "jackline-autoheal",
    {
      name: "jackline-autoheal",
      region,
      description: "Trigger jackline-autoheal workflow (Spot VM restart / health).",
      schedule: spotAutohealSchedule,
      timeZone: "Etc/UTC",
      attemptDeadline: "60s",
      httpTarget: {
        httpMethod: "POST",
        uri: pulumi.interpolate`https://workflowexecutions.googleapis.com/v1/projects/${project}/locations/${region}/workflows/${autohealWorkflow.name}/executions`,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from("{}").toString("base64"),
        oauthToken: {
          serviceAccountEmail: autohealSa.email,
          scope: "https://www.googleapis.com/auth/cloud-platform",
        },
      },
    },
    { dependsOn: [schedulerApi, autohealWorkflow, ...actAs] },
  );

  spotAutohealDeps.push(autohealWorkflow, autohealJob);
}

// ---------------------------------------------------------------------------
// Compute Engine instance
// ---------------------------------------------------------------------------
const image = gcp.compute.getImageOutput({
  family: "ubuntu-2404-lts-amd64",
  project: "ubuntu-os-cloud",
});

const instance = new gcp.compute.Instance(
  "jackline",
  {
    name: instanceNameStr,
    zone,
    machineType,
    tags: [networkTag],
    bootDisk: {
      initializeParams: {
        image: image.selfLink,
        // Jackline images + rolling scale=2 leave layers; 30G filled in practice.
        size: 50,
        type: "pd-balanced",
      },
    },
    networkInterfaces: [
      {
        network: "default",
        accessConfigs: [
          {
            natIp: staticIp.address,
            networkTier: "PREMIUM",
          },
        ],
      },
    ],
    metadata: {
      "enable-oslogin": "TRUE",
      "startup-script": startupScript,
      ...(spot ? { "shutdown-script": spotShutdownScript } : {}),
    },
    // Unset when spot=false so the existing standard VM sees no diff (the
    // provider keeps whatever GCE reports: automaticRestart=true, MIGRATE, STANDARD).
    ...(spot
      ? {
          scheduling: {
            provisioningModel: "SPOT",
            preemptible: true,
            // Spot VMs cannot use automaticRestart; the autoheal workflow below
            // restarts the VM after preemption instead.
            automaticRestart: false,
            onHostMaintenance: "TERMINATE",
            // STOP (not DELETE) keeps the boot disk, Docker volumes and Caddy certs.
            instanceTerminationAction: "STOP",
          },
        }
      : {}),
    serviceAccount: {
      email: vmSa.email,
      // Compose does not call GCP APIs; keep scopes minimal for logging/monitoring
      // agents and the OpenTelemetry Collector (Cloud Logging + Cloud Trace).
      scopes: [
        "https://www.googleapis.com/auth/logging.write",
        "https://www.googleapis.com/auth/monitoring.write",
        "https://www.googleapis.com/auth/trace.append",
      ],
    },
    allowStoppingForUpdate: true,
    labels: {
      app: "jackline",
      path: "vm",
    },
  },
  {
    // With spot=true, create the autoheal workflow + scheduler first so a missing
    // IAM permission fails `pulumi up` before the VM is replaced.
    dependsOn: [computeApi, firewall, iapSsh, vmSa, staticIp, ...spotAutohealDeps],
    // `image` above resolves the *newest* image in the ubuntu-2404-lts-amd64
    // family on every run. Boot disk params are ForceNew, so whenever Canonical
    // publishes a new image, `pulumi up` (run by every Deploy prod) planned
    // `replace [diff: ~bootDisk]`. Because the instance name and static IP are
    // fixed, that replacement is delete-first and took prod down ~20 min
    // (Deploy prod runs 39866975615 on Oct 22 and 40106372663 on Oct 24).
    // Ignore boot disk drift so routine deploys keep the existing VM; the OS
    // patches in place via unattended-upgrades. To rebuild the VM on purpose
    // (new image, disk size/type), run
    // `pulumi up --replace <instance URN>` (see deploy/pulumi/README.md) or
    // temporarily remove this ignoreChanges entry.
    ignoreChanges: ["bootDisk"],
  },
);

// Autoheal SA may only get/start/stop this one instance (instance-level IAM).
if (spot && autohealSa) {
  new gcp.compute.InstanceIAMMember("jackline-autoheal-instance-admin", {
    project,
    zone,
    instanceName: instance.name,
    role: "roles/compute.instanceAdmin.v1",
    member: pulumi.interpolate`serviceAccount:${autohealSa.email}`,
  });
}

export const spotEnabled = spot;
export const autohealServiceAccount = autohealSa ? pulumi.secret(autohealSa.email) : undefined;
export const autohealWorkflowName = autohealWorkflow ? autohealWorkflow.name : undefined;
export const instanceName = instance.name;
export const instanceZone = zone;
export const vmServiceAccount = pulumi.secret(vmSa.email);
export const publicIp = pulumi.secret(staticIp.address);
export const staticIpName = staticIp.name;
export const appUrl = pulumi.secret(publicBaseUrl);
export const sshHint = pulumi.secret(
  pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone} --project=${project}`,
);
export const cloudSqlInstanceName = sqlInstance.name;
export const cloudSqlConnectionName = pulumi.secret(cloudSqlConnName);
export const cloudSqlPrivateIp = pulumi.secret(sqlInstance.privateIpAddress);
export const databaseUrlHint = pulumi.secret(databaseUrl);
