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
    };
    const envJson = JSON.stringify(envPayload);

    return `#!/bin/bash
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
docker compose -f deploy/compose.prod.yml --env-file .env.prod up --build -d
echo "=== Jackline bootstrap complete ==="
`;
  });

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
// Compute Engine instance
// ---------------------------------------------------------------------------
const image = gcp.compute.getImageOutput({
  family: "ubuntu-2404-lts-amd64",
  project: "ubuntu-os-cloud",
});

const instance = new gcp.compute.Instance(
  "jackline",
  {
    name: "jackline",
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
    },
    serviceAccount: {
      email: vmSa.email,
      // Compose does not call GCP APIs; keep scopes minimal for logging/monitoring agents.
      scopes: [
        "https://www.googleapis.com/auth/logging.write",
        "https://www.googleapis.com/auth/monitoring.write",
      ],
    },
    allowStoppingForUpdate: true,
    labels: {
      app: "jackline",
      path: "vm",
    },
  },
  { dependsOn: [computeApi, firewall, iapSsh, vmSa, staticIp] },
);

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
