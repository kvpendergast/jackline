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

const masterKey = cfg.requireSecret("jacklineMasterKey");
const betterAuthSecret = cfg.requireSecret("betterAuthSecret");
const postgresPassword = cfg.getSecret("postgresPassword") ?? pulumi.output("jackline");
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
  .all([masterKey, betterAuthSecret, postgresPassword])
  .apply(([mk, bas, pg]) => {
    const caddyGlobal = caddyEmail ? `email ${caddyEmail}` : "";
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
      JACKLINE_SITE_ADDRESS: domain,
      JACKLINE_DOCS_SITE_ADDRESS: docsDomain,
      JACKLINE_HTTP_PORT: "80",
      JACKLINE_HTTPS_PORT: "443",
      JACKLINE_CADDY_GLOBAL_OPTIONS: caddyGlobal,
      WEB_ORIGIN: publicBaseUrl,
      BETTER_AUTH_URL: publicBaseUrl,
      JACKLINE_PUBLIC_API_URL: publicBaseUrl,
      JACKLINE_PUBLIC_MCP_URL: `${publicBaseUrl}/mcp`,
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
  git clone --depth 1 --branch "${gitRef}" "${gitRepo}" ${installRoot}
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
        size: 30,
        type: "pd-balanced",
      },
    },
    networkInterfaces: [
      {
        network: "default",
        accessConfigs: [{}], // ephemeral external IP
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
  { dependsOn: [computeApi, firewall, iapSsh, vmSa] },
);

const publicIp = instance.networkInterfaces.apply((nis) => {
  const ac = nis[0]?.accessConfigs?.[0];
  return ac?.natIp ?? "";
});

export const instanceName = instance.name;
export const instanceZone = zone;
export const vmServiceAccount = vmSa.email;
export { publicIp };
export const appUrl = publicBaseUrl;
export const sshHint = pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone} --project=${project}`;
