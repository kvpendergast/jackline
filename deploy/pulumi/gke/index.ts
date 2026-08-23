import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as docker from "@pulumi/docker";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cfg = new pulumi.Config();
const gcpCfg = new pulumi.Config("gcp");
const project = gcpCfg.require("project");
const region = gcpCfg.get("region") ?? "us-central1";

const domain = cfg.require("domain"); // e.g. jackline.example.com
const publicBaseUrl = pulumi.interpolate`https://${domain}`;
const tenancy = cfg.get("tenancy") ?? "single";

const masterKey = cfg.requireSecret("jacklineMasterKey");
const betterAuthSecret = cfg.requireSecret("betterAuthSecret");
const postgresPassword = cfg.requireSecret("postgresPassword");
const databaseUrl = pulumi.interpolate`postgresql://jackline:${postgresPassword}@postgres:5432/jackline`;

const repoRoot = "../../.."; // deploy/pulumi/gke -> repo root (Docker build context)

// ---------------------------------------------------------------------------
// 0. Enable the GCP APIs this stack needs (idempotent)
// ---------------------------------------------------------------------------
const apis = [
  "container.googleapis.com",
  "artifactregistry.googleapis.com",
  "compute.googleapis.com",
  "iam.googleapis.com",
].map((svc) => new gcp.projects.Service(svc.split(".")[0], { service: svc, disableOnDestroy: false }));

// ---------------------------------------------------------------------------
// 1. Artifact Registry + build the 5 images from deploy/Dockerfile targets
// ---------------------------------------------------------------------------
const registry = new gcp.artifactregistry.Repository(
  "jackline",
  { location: region, repositoryId: "jackline", format: "DOCKER" },
  { dependsOn: apis },
);
const registryHost = `${region}-docker.pkg.dev`;
const repoUrl = pulumi.interpolate`${registryHost}/${project}/${registry.repositoryId}`;

// Short-lived token so Pulumi's Docker builder can push to Artifact Registry.
const accessToken = pulumi.output(gcp.organizations.getClientConfig({})).accessToken;
const registryAuth = { server: registryHost, username: "oauth2accesstoken", password: accessToken };

function buildImage(target: string): docker.Image {
  return new docker.Image(target, {
    imageName: pulumi.interpolate`${repoUrl}/${target}:latest`,
    build: {
      context: repoRoot,
      dockerfile: `${repoRoot}/deploy/Dockerfile`,
      target,
      platform: "linux/amd64",
    },
    registry: registryAuth,
  });
}
const apiImage = buildImage("api");
const gatewayImage = buildImage("gateway");
const migrateImage = buildImage("migrate");
const webImage = buildImage("web");
const docsImage = buildImage("docs");

// ---------------------------------------------------------------------------
// 2. GKE Autopilot cluster + k8s provider
// ---------------------------------------------------------------------------
// Autopilot nodes use the default Compute Engine SA. Custom node SA via
// clusterAutoscaling is not allowed on Autopilot ("Overriding Autopilot
// autoscaling settings is not allowed"). Grant Artifact Registry read on that SA.
const projectData = gcp.organizations.getProjectOutput({ projectId: project });
const defaultNodeSaMember = pulumi.interpolate`serviceAccount:${projectData.number}-compute@developer.gserviceaccount.com`;

new gcp.projects.IAMMember(
  "gke-default-compute-ar-reader",
  {
    project,
    role: "roles/artifactregistry.reader",
    member: defaultNodeSaMember,
  },
  { dependsOn: [registry] },
);

const cluster = new gcp.container.Cluster(
  "jackline",
  { location: region, enableAutopilot: true, deletionProtection: false },
  { dependsOn: apis },
);

const kubeconfig = pulumi
  .all([cluster.name, cluster.endpoint, cluster.masterAuth])
  .apply(([name, endpoint, auth]) => {
    const ctx = `${project}_${region}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${ctx}
contexts:
- context: {cluster: ${ctx}, user: ${ctx}}
  name: ${ctx}
current-context: ${ctx}
kind: Config
users:
- name: ${ctx}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      provideClusterInfo: true
`;
  });

const k8sProvider = new k8s.Provider("gke", { kubeconfig });
const opts = { provider: k8sProvider };

// ---------------------------------------------------------------------------
// 3. Namespace, config, secret
// ---------------------------------------------------------------------------
const ns = new k8s.core.v1.Namespace("jackline", { metadata: { name: "jackline" } }, opts);
const nsName = ns.metadata.name;

const appConfig = new k8s.core.v1.ConfigMap(
  "jackline-config",
  {
    metadata: { namespace: nsName },
    data: {
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      JACKLINE_TENANCY: tenancy,
      JACKLINE_SECRET_STORAGE_LOCATION: "local",
      WEB_ORIGIN: publicBaseUrl,
      BETTER_AUTH_URL: publicBaseUrl,
      JACKLINE_PUBLIC_API_URL: publicBaseUrl,
      JACKLINE_PUBLIC_MCP_URL: pulumi.interpolate`${publicBaseUrl}/mcp`,
      API_HOST: "0.0.0.0",
      API_PORT: "8080",
      GATEWAY_HOST: "0.0.0.0",
      GATEWAY_PORT: "8081",
    },
  },
  opts,
);

const appSecret = new k8s.core.v1.Secret(
  "jackline-secret",
  {
    metadata: { namespace: nsName },
    stringData: {
      JACKLINE_MASTER_KEY: masterKey,
      BETTER_AUTH_SECRET: betterAuthSecret,
      DATABASE_URL: databaseUrl,
      POSTGRES_PASSWORD: postgresPassword,
    },
  },
  opts,
);

const envFrom = [
  { configMapRef: { name: appConfig.metadata.name } },
  { secretRef: { name: appSecret.metadata.name } },
];

// Reusable initContainer: block until Postgres accepts TCP connections.
const waitForPostgres = {
  name: "wait-for-postgres",
  image: "busybox:1.36",
  command: ["sh", "-c", "until nc -z postgres 5432; do echo waiting for postgres; sleep 2; done"],
};

// ---------------------------------------------------------------------------
// 4. Postgres (StatefulSet + headless Service + PVC)
// ---------------------------------------------------------------------------
const pgLabels = { app: "postgres" };
new k8s.core.v1.Service(
  "postgres",
  {
    metadata: { namespace: nsName, name: "postgres" },
    spec: { clusterIP: "None", selector: pgLabels, ports: [{ port: 5432, targetPort: 5432 }] },
  },
  opts,
);

new k8s.apps.v1.StatefulSet(
  "postgres",
  {
    metadata: { namespace: nsName, name: "postgres" },
    spec: {
      serviceName: "postgres",
      replicas: 1,
      selector: { matchLabels: pgLabels },
      template: {
        metadata: { labels: pgLabels },
        spec: {
          containers: [
            {
              name: "postgres",
              image: "postgres:16",
              ports: [{ containerPort: 5432 }],
              env: [
                { name: "POSTGRES_USER", value: "jackline" },
                { name: "POSTGRES_DB", value: "jackline" },
                {
                  name: "POSTGRES_PASSWORD",
                  valueFrom: { secretKeyRef: { name: appSecret.metadata.name, key: "POSTGRES_PASSWORD" } },
                },
                { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
              ],
              volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data" }],
              readinessProbe: { exec: { command: ["pg_isready", "-U", "jackline"] }, periodSeconds: 10 },
              resources: { requests: { cpu: "250m", memory: "512Mi" } },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "10Gi" } } },
        },
      ],
    },
  },
  opts,
);

// ---------------------------------------------------------------------------
// 5. Migrations Job (runs `pnpm db:migrate` once)
// ---------------------------------------------------------------------------
// Job pod templates are immutable. Put a digest suffix in the Job name so an
// image change is a new Job (create) rather than a doomed in-place update.
const migrateJobName = migrateImage.repoDigest.apply((digest) => {
  const sha = digest.includes("sha256:") ? digest.split("sha256:")[1]!.slice(0, 12) : "latest";
  return `jackline-migrate-${sha}`;
});

const migrateJob = new k8s.batch.v1.Job(
  "jackline-migrate",
  {
    metadata: {
      namespace: nsName,
      name: migrateJobName,
    },
    spec: {
      backoffLimit: 5,
      ttlSecondsAfterFinished: 300,
      template: {
        spec: {
          restartPolicy: "Never",
          initContainers: [waitForPostgres],
          containers: [
            {
              name: "migrate",
              image: migrateImage.repoDigest,
              env: [
                { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: appSecret.metadata.name, key: "DATABASE_URL" } } },
              ],
            },
          ],
        },
      },
    },
  },
  { ...opts, deleteBeforeReplace: true },
);

// ---------------------------------------------------------------------------
// 6. App Deployments + Services (helper)
// ---------------------------------------------------------------------------
function app(
  name: string,
  image: pulumi.Input<string>,
  port: number,
  o: { healthPath: string; useEnvFrom?: boolean; waitDb?: boolean; dependsOn?: pulumi.Resource[] },
) {
  const labels = { app: name };
  new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { namespace: nsName, name },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            initContainers: o.waitDb ? [waitForPostgres] : undefined,
            containers: [
              {
                name,
                image,
                ports: [{ containerPort: port }],
                envFrom: o.useEnvFrom ? envFrom : undefined,
                readinessProbe: { httpGet: { path: o.healthPath, port }, initialDelaySeconds: 10, periodSeconds: 10 },
                livenessProbe: { httpGet: { path: o.healthPath, port }, initialDelaySeconds: 20, periodSeconds: 15 },
                resources: { requests: { cpu: "250m", memory: "256Mi" } },
              },
            ],
          },
        },
      },
    },
    { ...opts, dependsOn: o.dependsOn },
  );

  // GCE Ingress health checks default to GET /. api/gateway return 404 there, so the
  // LB marks backends UNHEALTHY (502) even when kube readiness on /health is green.
  const serviceAnnotations: Record<string, string> = {};
  if (o.healthPath !== "/") {
    const backendConfigName = `${name}-backend-config`;
    new k8s.apiextensions.CustomResource(
      `${name}-backend-config`,
      {
        apiVersion: "cloud.google.com/v1",
        kind: "BackendConfig",
        metadata: { namespace: nsName, name: backendConfigName },
        spec: {
          healthCheck: {
            type: "HTTP",
            requestPath: o.healthPath,
            port,
          },
        },
      },
      opts,
    );
    serviceAnnotations["cloud.google.com/backend-config"] = JSON.stringify({
      default: backendConfigName,
    });
  }

  new k8s.core.v1.Service(
    name,
    {
      metadata: {
        namespace: nsName,
        name,
        annotations: Object.keys(serviceAnnotations).length ? serviceAnnotations : undefined,
      },
      spec: { selector: labels, ports: [{ port, targetPort: port }] },
    },
    opts,
  );
}

app("api", apiImage.repoDigest, 8080, { healthPath: "/health", useEnvFrom: true, waitDb: true, dependsOn: [migrateJob] });
app("gateway", gatewayImage.repoDigest, 8081, { healthPath: "/health", useEnvFrom: true, waitDb: true, dependsOn: [migrateJob] });
app("web", webImage.repoDigest, 80, { healthPath: "/" });
app("docs", docsImage.repoDigest, 80, { healthPath: "/" });

// ---------------------------------------------------------------------------
// 7. Ingress: global static IP + Google-managed cert + path routing (mirrors Caddy)
// ---------------------------------------------------------------------------
const staticIpName = "jackline-ip";
const ip = gcp.compute.getGlobalAddressOutput({ name: staticIpName })

const cert = new k8s.apiextensions.CustomResource(
  "jackline-cert",
  {
    apiVersion: "networking.gke.io/v1",
    kind: "ManagedCertificate",
    metadata: { namespace: nsName, name: "jackline-cert" },
    spec: { domains: [domain] },
  },
  opts,
);

const svcBackend = (name: string, port: number) => ({ service: { name, port: { number: port } } });

new k8s.networking.v1.Ingress(
  "jackline",
  {
    metadata: {
      namespace: nsName,
      name: "jackline",
      annotations: {
        "kubernetes.io/ingress.class": "gce",
        "kubernetes.io/ingress.global-static-ip-name": ip.name,
        "networking.gke.io/managed-certificates": "jackline-cert",
      },
    },
    spec: {
      rules: [
        {
          host: domain,
          http: {
            paths: [
              { path: "/mcp", pathType: "ImplementationSpecific", backend: svcBackend("gateway", 8081) },
              { path: "/mcp/*", pathType: "ImplementationSpecific", backend: svcBackend("gateway", 8081) },
              { path: "/api/*", pathType: "ImplementationSpecific", backend: svcBackend("api", 8080) },
              { path: "/scim/*", pathType: "ImplementationSpecific", backend: svcBackend("api", 8080) },
              { path: "/health", pathType: "ImplementationSpecific", backend: svcBackend("api", 8080) },
              { path: "/*", pathType: "ImplementationSpecific", backend: svcBackend("web", 80) },
            ],
          },
        },
      ],
    },
  },
  { ...opts, dependsOn: [cert] },
);

export const loadBalancerIp = ip.address;
export const appUrl = publicBaseUrl;
export const clusterName = cluster.name;
