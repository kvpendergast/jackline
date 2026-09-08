import { z } from "zod";
import {
  ServerAuthMethodSchema,
  ServerCredentialModeSchema,
  ServerKindSchema,
} from "../types/server.js";

export const ConnectorCategorySchema = z.enum([
  "productivity",
  "google",
  "gcp",
  "google_apis",
  "developer",
  "support",
  "finance",
  "commerce",
]);

export const ConnectorPresetSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: ConnectorCategorySchema,
  kind: ServerKindSchema,
  authMethod: ServerAuthMethodSchema,
  credentialMode: ServerCredentialModeSchema,
  baseUrl: z.url(),
  docsUrl: z.url().nullable(),
  /** Short hint shown in the create form for credentials. */
  authHint: z.string().min(1),
  /** Human docs (not OpenAPI). */
  learnMoreUrl: z.url().nullable(),
  /**
   * Optional brand mark key under `/connectors/{logoKey}.svg`.
   * Defaults to `key` when omitted.
   */
  logoKey: z.string().min(1).optional(),
  /** Classic OAuth authorize URL (BYO OAuth app / Connect flow). */
  oauthAuthorizeUrl: z.url().optional(),
  /** OAuth token URL for auth-code / refresh / client_credentials. */
  oauthTokenUrl: z.url().optional(),
  /** Space- or comma-delimited default scopes for personal OAuth. */
  oauthScopes: z.string().optional(),
  /**
   * Extra authorize query params required by some providers
   * (Google access_type, Notion owner, Atlassian audience, …).
   */
  oauthAuthorizeExtraParams: z.record(z.string(), z.string()).optional(),
  /**
   * MCP OAuth resource indicator (RFC 8707). When set, passed as `resource`
   * on authorize and token requests (Robinhood, …).
   */
  oauthResource: z.url().optional(),
  /**
   * Public OAuth client (PKCE only; no client secret). Admins register a
   * client id via the provider's dynamic registration endpoint.
   */
  oauthPublicClient: z.boolean().optional(),
});

export type ConnectorPreset = z.infer<typeof ConnectorPresetSchema>;
export type ConnectorCategory = z.infer<typeof ConnectorCategorySchema>;

const GOOGLE_OAUTH = {
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthTokenUrl: "https://oauth2.googleapis.com/token",
  oauthAuthorizeExtraParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
} as const;

const GCP_LEARN_MORE =
  "https://docs.cloud.google.com/mcp/supported-products" as const;

const GCP_AUTH_HINT =
  "Enable the product API (and MCP, if separate) in your Google Cloud project and grant roles/mcp.toolUser. BYO Google OAuth client with cloud-platform (or product) scopes, or paste a short-lived access token from `gcloud auth print-access-token` as a shared Bearer. Prefer personal Connect in My Access for user-scoped access.";

function gcpMcp(input: {
  key: string;
  name: string;
  description: string;
  baseUrl: string;
  learnMoreUrl?: string;
  oauthScopes?: string;
}): ConnectorPreset {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    category: "gcp",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "either",
    baseUrl: input.baseUrl,
    docsUrl: null,
    authHint: GCP_AUTH_HINT,
    learnMoreUrl: input.learnMoreUrl ?? GCP_LEARN_MORE,
    logoKey: "google_cloud",
    ...GOOGLE_OAUTH,
    oauthScopes:
      input.oauthScopes ?? "https://www.googleapis.com/auth/cloud-platform",
  };
}

function googleApiMcp(input: {
  key: string;
  name: string;
  description: string;
  baseUrl: string;
  learnMoreUrl?: string;
  authMethod?: "oauth" | "api_key";
  authHint?: string;
  oauthScopes?: string;
  logoKey?: string;
}): ConnectorPreset {
  const authMethod = input.authMethod ?? "oauth";
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    category: "google_apis",
    kind: "mcp",
    authMethod,
    credentialMode: authMethod === "api_key" ? "shared" : "either",
    baseUrl: input.baseUrl,
    docsUrl: null,
    authHint:
      input.authHint ??
      "BYO Google OAuth client (Web) for this Google API MCP, or paste a Bearer access token. Enable the API in your Google Cloud project.",
    learnMoreUrl: input.learnMoreUrl ?? GCP_LEARN_MORE,
    logoKey: input.logoKey ?? "google_cloud",
    ...(authMethod === "oauth"
      ? {
          ...GOOGLE_OAUTH,
          oauthScopes:
            input.oauthScopes ??
            "https://www.googleapis.com/auth/cloud-platform",
        }
      : {}),
  };
}

const GCP_PRESETS: ConnectorPreset[] = [
  gcpMcp({
    key: "gcp_agent_registry",
    name: "Agent Registry",
    description: "Discover and manage agents in Agent Registry.",
    baseUrl: "https://agentregistry.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_alloydb",
    name: "AlloyDB for PostgreSQL",
    description: "Manage AlloyDB clusters and instances (global endpoint).",
    baseUrl: "https://alloydb.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_apigee_api_hub",
    name: "Apigee API hub",
    description: "Apigee API hub catalog and governance (global endpoint).",
    baseUrl: "https://apihub.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_app_lifecycle_manager",
    name: "App Lifecycle Manager",
    description: "SaaS App Lifecycle Manager (Preview).",
    baseUrl: "https://saasservicemgmt.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_audit_manager",
    name: "Audit Manager",
    description:
      "Audit Manager regional MCP (default us-central1 — change region in URL if needed).",
    baseUrl: "https://auditmanager.us-central1.rep.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_backup_dr",
    name: "Backup and DR Service",
    description: "Backup and disaster recovery for Google Cloud workloads.",
    baseUrl: "https://backupdr.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_bigquery",
    name: "BigQuery",
    description: "Query and manage BigQuery datasets, jobs, and tables.",
    baseUrl: "https://bigquery.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_bigquery_data_transfer",
    name: "BigQuery Data Transfer",
    description: "BigQuery Data Transfer Service (Preview).",
    baseUrl: "https://bigquerydatatransfer.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_bigquery_migration",
    name: "BigQuery Migration",
    description: "BigQuery Migration Service tools.",
    baseUrl: "https://bigquerymigration.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_bigtable",
    name: "Bigtable",
    description: "Bigtable Admin API via remote MCP.",
    baseUrl: "https://bigtableadmin.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_asset",
    name: "Cloud Asset Inventory",
    description: "Search and analyze Cloud Asset Inventory (Preview).",
    baseUrl: "https://cloudasset.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_billing",
    name: "Cloud Billing",
    description: "Cloud Billing and Pricing APIs (Preview).",
    baseUrl: "https://cloudbilling.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_data_lineage",
    name: "Data lineage",
    description: "Data lineage global endpoint (locational URLs available).",
    baseUrl: "https://datalineage.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_filestore",
    name: "Filestore",
    description: "Manage Filestore instances and backups.",
    baseUrl: "https://file.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_run",
    name: "Cloud Run",
    description: "Deploy and manage Cloud Run services and jobs.",
    baseUrl: "https://run.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_storage",
    name: "Cloud Storage",
    description: "Buckets and objects in Cloud Storage.",
    baseUrl: "https://storage.googleapis.com/storage/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_support",
    name: "Cloud Support API",
    description: "Google Cloud Support cases (Preview).",
    baseUrl: "https://cloudsupport.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cx_agent_studio",
    name: "Customer Experience Agent Studio",
    description: "CX Agent Studio (US multi-region).",
    baseUrl: "https://ces.us.rep.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_sql",
    name: "Cloud SQL",
    description: "Cloud SQL Admin for MySQL, PostgreSQL, and SQL Server.",
    baseUrl: "https://sqladmin.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_location_finder",
    name: "Cloud Location Finder",
    description: "Find Google Cloud locations (Preview).",
    baseUrl: "https://cloudlocationfinder.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_logging",
    name: "Cloud Logging",
    description: "Query and manage Cloud Logging.",
    baseUrl: "https://logging.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_monitoring",
    name: "Cloud Monitoring",
    description: "Metrics and monitoring in Google Cloud.",
    baseUrl: "https://monitoring.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_product_registry",
    name: "Cloud Product Registry",
    description: "Cloud Product Registry (Preview).",
    baseUrl: "https://cloudproductregistry.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_quotas",
    name: "Cloud Quotas",
    description: "View and manage Cloud Quotas.",
    baseUrl: "https://cloudquotas.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_trace",
    name: "Cloud Trace",
    description: "Distributed tracing with Cloud Trace.",
    baseUrl: "https://cloudtrace.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_compute_engine",
    name: "Compute Engine",
    description: "VMs, disks, and networking on Compute Engine.",
    baseUrl: "https://compute.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_database_insights",
    name: "Database Insights",
    description: "Database Insights MCP server.",
    baseUrl: "https://databaseinsights.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_datastream",
    name: "Datastream",
    description: "Datastream CDC pipelines (Preview).",
    baseUrl: "https://datastream.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_database_center",
    name: "Database Center",
    description: "Fleet-wide database posture with Database Center.",
    baseUrl: "https://databasecenter.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_database_migration",
    name: "Database Migration Service",
    description: "Database Migration Service (Preview).",
    baseUrl: "https://datamigration.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_dataproc_spark",
    name: "Managed Service for Apache Spark",
    description: "Dataproc / Managed Spark workloads.",
    baseUrl: "https://dataproc.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_knowledge_catalog",
    name: "Knowledge Catalog",
    description: "Dataplex Knowledge Catalog (Preview).",
    baseUrl: "https://dataplex.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_dataform",
    name: "Dataform",
    description: "Dataform repositories and workflows.",
    baseUrl: "https://dataform.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_error_reporting",
    name: "Error Reporting",
    description: "Application error groups and events.",
    baseUrl: "https://clouderrorreporting.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_firestore",
    name: "Firestore",
    description: "Firestore databases and documents.",
    baseUrl: "https://firestore.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_cloud_cli",
    name: "Cloud CLI Execution",
    description: "Run gcloud via the Cloud CLI remote MCP (Preview).",
    baseUrl: "https://cloudcli.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_gke",
    name: "GKE",
    description: "Google Kubernetes Engine clusters and workloads.",
    baseUrl: "https://container.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_security_operations",
    name: "Google Security Operations",
    description:
      "Chronicle / SecOps regional MCP (default us — change region in URL if needed).",
    baseUrl: "https://chronicle.us.rep.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_composer_airflow",
    name: "Managed Service for Apache Airflow",
    description:
      "Cloud Composer regional MCP (default us-central1 — change region in URL if needed).",
    baseUrl: "https://composer.us-central1.rep.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_managed_kafka",
    name: "Managed Service for Apache Kafka",
    description: "Managed Kafka clusters and topics.",
    baseUrl: "https://managedkafka.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_memorystore_redis",
    name: "Memorystore for Redis",
    description: "Memorystore for Redis and Redis Cluster.",
    baseUrl: "https://redis.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_memorystore_valkey",
    name: "Memorystore for Valkey",
    description: "Memorystore for Valkey instances.",
    baseUrl: "https://memorystore.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_netapp_volumes",
    name: "Google Cloud NetApp Volumes",
    description: "NetApp Volumes storage in Google Cloud.",
    baseUrl: "https://netapp.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_network_intelligence",
    name: "Network Intelligence Center",
    description: "Network connectivity tests and insights.",
    baseUrl: "https://networkmanagement.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_oracle_database",
    name: "Oracle Database@Google Cloud",
    description: "Oracle Database@Google Cloud (Preview).",
    baseUrl: "https://oracledatabase.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_service_health",
    name: "Personalized Service Health",
    description: "Personalized Service Health events.",
    baseUrl: "https://servicehealth.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_pubsub",
    name: "Pub/Sub",
    description: "Topics, subscriptions, and Pub/Sub messaging.",
    baseUrl: "https://pubsub.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_recommender",
    name: "Recommender",
    description: "Google Cloud Recommender insights.",
    baseUrl: "https://recommender.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_resource_manager",
    name: "Resource Manager",
    description: "Projects, folders, and organizations.",
    baseUrl: "https://cloudresourcemanager.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_spanner",
    name: "Spanner",
    description: "Cloud Spanner instances and databases.",
    baseUrl: "https://spanner.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_ssm_code_review",
    name: "Secure Source Manager — Code review",
    description: "SSM code review tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/code_review",
  }),
  gcpMcp({
    key: "gcp_ssm_pull_request",
    name: "Secure Source Manager — Pull requests",
    description: "SSM pull request tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/pull_request",
  }),
  gcpMcp({
    key: "gcp_ssm_branch_rule",
    name: "Secure Source Manager — Branch rules",
    description: "SSM branch rule tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/branch_rule",
  }),
  gcpMcp({
    key: "gcp_ssm_repository",
    name: "Secure Source Manager — Repositories",
    description: "SSM repository tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/repository",
  }),
  gcpMcp({
    key: "gcp_ssm_instance",
    name: "Secure Source Manager — Instances",
    description: "SSM instance tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/instance",
  }),
  gcpMcp({
    key: "gcp_ssm_hook",
    name: "Secure Source Manager — Hooks",
    description: "SSM hook tools (us-central1).",
    baseUrl:
      "https://securesourcemanager.us-central1.rep.googleapis.com/mcp/hook",
  }),
  gcpMcp({
    key: "gcp_unified_maintenance",
    name: "Unified Maintenance",
    description: "Unified Maintenance (Preview).",
    baseUrl: "https://maintenance.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_gemini_cloud_assist",
    name: "Gemini Cloud Assist",
    description: "Gemini Cloud Assist (Preview).",
    baseUrl: "https://geminicloudassist.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_aiplatform_generate",
    name: "Gemini Enterprise Agent Platform — Generate",
    description: "Vertex AI / GEAP generate toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/generate",
  }),
  gcpMcp({
    key: "gcp_aiplatform_predict",
    name: "Gemini Enterprise Agent Platform — Predict",
    description: "Vertex AI / GEAP predict toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/predict",
  }),
  gcpMcp({
    key: "gcp_aiplatform_notebook",
    name: "Gemini Enterprise Agent Platform — Notebook",
    description: "Vertex AI / GEAP notebook toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/notebook",
  }),
  gcpMcp({
    key: "gcp_aiplatform_endpoints",
    name: "Gemini Enterprise Agent Platform — Endpoints",
    description: "Vertex AI / GEAP endpoints toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/endpoints",
  }),
  gcpMcp({
    key: "gcp_aiplatform_models",
    name: "Gemini Enterprise Agent Platform — Models",
    description: "Vertex AI / GEAP models toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/models",
  }),
  gcpMcp({
    key: "gcp_aiplatform_tuning",
    name: "Gemini Enterprise Agent Platform — Tuning",
    description: "Vertex AI / GEAP tuning toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/tuning",
  }),
  gcpMcp({
    key: "gcp_aiplatform_retrieval",
    name: "Gemini Enterprise Agent Platform — Retrieval",
    description: "Vertex AI / GEAP retrieval toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/retrieval",
  }),
  gcpMcp({
    key: "gcp_aiplatform_evaluation",
    name: "Gemini Enterprise Agent Platform — Evaluation",
    description: "Vertex AI / GEAP evaluation toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/evaluation",
  }),
  gcpMcp({
    key: "gcp_aiplatform_prompts",
    name: "Gemini Enterprise Agent Platform — Prompts",
    description: "Vertex AI / GEAP prompts toolset (global).",
    baseUrl: "https://aiplatform.googleapis.com/mcp/prompts",
  }),
  gcpMcp({
    key: "gcp_agent_search",
    name: "Agent Search",
    description: "Discovery Engine Agent Search.",
    baseUrl: "https://discoveryengine.googleapis.com/mcp",
  }),
  gcpMcp({
    key: "gcp_policy_troubleshooter",
    name: "Policy Troubleshooter",
    description: "Troubleshoot IAM policies.",
    baseUrl: "https://policytroubleshooter.googleapis.com/mcp",
  }),
];

const GOOGLE_API_PRESETS: ConnectorPreset[] = [
  googleApiMcp({
    key: "google_android_management",
    name: "Android Management API",
    description: "Manage Android enterprise devices and policies.",
    baseUrl: "https://androidmanagement.googleapis.com/mcp",
  }),
  googleApiMcp({
    key: "google_design",
    name: "Design MCP",
    description: "Google Design MCP (Preview).",
    baseUrl: "https://design.googleapis.com/mcp",
  }),
  googleApiMcp({
    key: "google_developer_knowledge",
    name: "Developer Knowledge API",
    description: "Search Google developer documentation knowledge.",
    baseUrl: "https://developerknowledge.googleapis.com/mcp",
  }),
  googleApiMcp({
    key: "google_home_developer",
    name: "Google Home Developer",
    description: "Google Home developer MCP server.",
    baseUrl: "https://homedevelopers.googleapis.com/mcp",
  }),
  googleApiMcp({
    key: "google_maps_code_assist",
    name: "Maps Code Assist",
    description: "Maps Platform code assistance (Preview).",
    baseUrl: "https://mapscodeassist.googleapis.com/mcp",
    logoKey: "google_maps",
  }),
  googleApiMcp({
    key: "google_maps_grounding_lite",
    name: "Maps Grounding Lite",
    description: "Maps Grounding Lite — typically authenticated with an API key.",
    baseUrl: "https://mapstools.googleapis.com/mcp",
    authMethod: "api_key",
    logoKey: "google_maps",
    authHint:
      "Create a Google Cloud API key with Maps Grounding Lite enabled. Store it as the shared server credential (X-Goog-Api-Key / Bearer depending on client).",
    learnMoreUrl: "https://docs.cloud.google.com/mcp/supported-products",
  }),
  googleApiMcp({
    key: "google_pay_wallet",
    name: "Google Pay and Wallet",
    description: "Google Pay & Wallet developer MCP (Preview).",
    baseUrl: "https://paydeveloper.googleapis.com/mcp",
  }),
  googleApiMcp({
    key: "google_stitch",
    name: "Stitch",
    description: "Google Stitch MCP (Beta).",
    baseUrl: "https://stitch.googleapis.com/mcp",
  }),
];

/**
 * Curated remote MCP hosts for one-click server create (enterprise web)
 * and `jackline add <key>` / `--connect` (personal CLI).
 */
export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  {
    key: "linear",
    name: "Linear",
    description: "Issues, projects, and comments in Linear.",
    category: "productivity",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "either",
    baseUrl: "https://mcp.linear.app/mcp",
    docsUrl: null,
    authHint:
      "Linear accepts OAuth access tokens or API keys as Bearer. Use a shared org credential on the server, and/or let each person connect their own in My Access (OAuth token or API key). For OAuth apps: authorize at linear.app/oauth/authorize, token at api.linear.app/oauth/token.",
    learnMoreUrl: "https://linear.app/docs/mcp",
    oauthAuthorizeUrl: "https://linear.app/oauth/authorize",
    oauthTokenUrl: "https://api.linear.app/oauth/token",
    oauthScopes: "read,write",
  },
  {
    key: "notion",
    name: "Notion",
    description: "Search and edit pages in your Notion workspace.",
    category: "productivity",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "either",
    baseUrl: "https://mcp.notion.com/mcp",
    docsUrl: null,
    authHint:
      "Create a Notion public integration (OAuth) and Connect with the client id/secret, or paste an access token. Capabilities are chosen in the Notion integration settings (no OAuth scopes string).",
    learnMoreUrl: "https://developers.notion.com/docs/mcp",
    oauthAuthorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    oauthTokenUrl: "https://api.notion.com/v1/oauth/token",
    oauthAuthorizeExtraParams: {
      owner: "user",
    },
  },
  {
    key: "atlassian",
    name: "Atlassian",
    description: "Jira, Confluence, and related Atlassian Cloud tools.",
    category: "productivity",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "either",
    baseUrl: "https://mcp.atlassian.com/v1/mcp",
    docsUrl: null,
    authHint:
      "Prefer an Atlassian API token as Bearer, or OAuth 3LO (BYO app at developer.atlassian.com). Shared or per-person in My Access.",
    learnMoreUrl: "https://www.atlassian.com/platform/remote-mcp-server",
    oauthAuthorizeUrl: "https://auth.atlassian.com/authorize",
    oauthTokenUrl: "https://auth.atlassian.com/oauth/token",
    oauthScopes:
      "read:jira-work write:jira-work read:jira-user read:confluence-content.all write:confluence-content offline_access",
    oauthAuthorizeExtraParams: {
      audience: "api.atlassian.com",
      prompt: "consent",
    },
  },
  {
    key: "gmail",
    name: "Gmail",
    description: "Official Google Workspace Gmail MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://gmailmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client (Desktop or Web) with Gmail scopes. Enable gmail.googleapis.com + gmailmcp.googleapis.com. Each user Connects their own Google account.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
  },
  {
    key: "google_drive",
    name: "Google Drive",
    description: "Official Google Workspace Drive MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://drivemcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Drive scopes. Enable drive.googleapis.com + drivemcp.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
  },
  {
    key: "google_calendar",
    name: "Google Calendar",
    description: "Official Google Workspace Calendar MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://calendarmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Calendar scopes. Enable calendar-json.googleapis.com + calendarmcp.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly",
  },
  {
    key: "google_docs",
    name: "Google Docs",
    description: "Official Google Workspace Docs MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://docsmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Docs + Drive scopes. Enable docs.googleapis.com + docsmcp.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents.readonly https://www.googleapis.com/auth/documents",
  },
  {
    key: "google_sheets",
    name: "Google Sheets",
    description: "Official Google Workspace Sheets MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://sheetsmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Sheets + Drive scopes. Enable sheets.googleapis.com + sheetsmcp.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/spreadsheets",
  },
  {
    key: "google_slides",
    name: "Google Slides",
    description: "Official Google Workspace Slides MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://slidesmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Slides + Drive scopes. Enable slides.googleapis.com + slidesmcp.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations.readonly https://www.googleapis.com/auth/presentations",
  },
  {
    key: "google_chat",
    name: "Google Chat",
    description: "Official Google Workspace Chat MCP (Developer Preview).",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://chatmcp.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with Chat scopes. Enable chat.googleapis.com + chatmcp.googleapis.com and configure a Chat app.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/chat.spaces.readonly https://www.googleapis.com/auth/chat.memberships.readonly https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.messages.create https://www.googleapis.com/auth/chat.users.readstate.readonly",
  },
  {
    key: "google_people",
    name: "Google People",
    description: "Official Google Workspace People / contacts MCP.",
    category: "google",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://people.googleapis.com/mcp/v1",
    docsUrl: null,
    authHint:
      "BYO Google Cloud OAuth client with People / Contacts scopes. Enable people.googleapis.com.",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    ...GOOGLE_OAUTH,
    oauthScopes:
      "https://www.googleapis.com/auth/directory.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly",
  },
  ...GCP_PRESETS,
  ...GOOGLE_API_PRESETS,
  {
    key: "github",
    name: "GitHub",
    description: "Repos, issues, PRs, and Actions via GitHub’s remote MCP.",
    category: "developer",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://api.githubcopilot.com/mcp/",
    docsUrl: null,
    authHint:
      "Each user Connects with a GitHub OAuth App (or pastes a classic PAT / fine-grained token) in My Access.",
    learnMoreUrl:
      "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    oauthAuthorizeUrl: "https://github.com/login/oauth/authorize",
    oauthTokenUrl: "https://github.com/login/oauth/access_token",
    oauthScopes: "repo read:org read:user project",
  },
  {
    key: "vercel",
    name: "Vercel",
    description:
      "Docs search, projects, deployments, logs, and Web Analytics via Vercel’s official remote MCP.",
    category: "developer",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://mcp.vercel.com",
    docsUrl: null,
    authHint:
      "Vercel MCP uses a public OAuth client (PKCE, no secret). Register a client at https://vercel.com/api/login/oauth/register, set the returned client id on this server (leave client secret empty), then each user Connects in My Access on desktop. Official endpoint: https://mcp.vercel.com — Vercel only allows reviewed MCP clients.",
    learnMoreUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
    oauthAuthorizeUrl: "https://vercel.com/oauth/authorize",
    oauthTokenUrl: "https://vercel.com/api/login/oauth/token",
    oauthScopes: "openid offline_access",
    oauthResource: "https://mcp.vercel.com/",
    oauthPublicClient: true,
  },
  {
    key: "sentry",
    name: "Sentry",
    description: "Error tracking and issue context from Sentry.",
    category: "support",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "either",
    baseUrl: "https://mcp.sentry.dev/mcp",
    docsUrl: null,
    authHint:
      "Paste a Sentry user auth token (Bearer). Hosted MCP OAuth at mcp.sentry.dev is client-driven; classic BYO OAuth is not required for personal jackline add.",
    learnMoreUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    key: "robinhood_trading",
    name: "Robinhood Trading",
    description:
      "Read portfolio data and place equity trades in a dedicated agentic account.",
    category: "finance",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://agent.robinhood.com/mcp/trading",
    docsUrl: null,
    authHint:
      "Robinhood MCP uses a public OAuth client (PKCE, no secret). Register a client at https://agent.robinhood.com/oauth/trading/register, set the returned client id on this server (leave client secret empty), then each user Connects in My Access on desktop. Fund and authenticate the agentic trading account in Robinhood first.",
    learnMoreUrl:
      "https://robinhood.com/us/en/support/articles/agentic-trading",
    oauthAuthorizeUrl: "https://robinhood.com/oauth",
    oauthTokenUrl: "https://api.robinhood.com/oauth2/token/",
    oauthScopes: "internal",
    oauthResource: "https://agent.robinhood.com/mcp/trading",
    oauthPublicClient: true,
  },
  {
    key: "robinhood_banking",
    name: "Robinhood Banking",
    description:
      "Agentic virtual credit card — fetch card details at checkout, view spending and policies.",
    category: "finance",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://banking-agent.robinhood.com/mcp/banking",
    docsUrl: null,
    authHint:
      "Robinhood MCP uses a public OAuth client (PKCE, no secret). Register a client at https://banking-agent.robinhood.com/oauth/banking/register, set the returned client id on this server (leave client secret empty), then each user Connects in My Access on desktop and completes agentic card onboarding in Robinhood.",
    learnMoreUrl:
      "https://robinhood.com/us/en/support/articles/agentic-credit-card",
    oauthAuthorizeUrl: "https://robinhood.com/oauth",
    oauthTokenUrl: "https://api.robinhood.com/oauth2/token/",
    oauthScopes: "credit-card",
    oauthResource: "https://banking-agent.robinhood.com/mcp/banking",
    oauthPublicClient: true,
  },
  {
    key: "instacart",
    name: "Instacart",
    description:
      "Shopping workflows: store availability, recipe ingredients, and orders.",
    category: "commerce",
    kind: "mcp",
    authMethod: "oauth",
    credentialMode: "subject_required",
    baseUrl: "https://mcp.instacart.com/mcp",
    docsUrl: null,
    authHint:
      "OAuth through the MCP client: each person signs in to Instacart (no classic BYO authorize/token URLs). Partners may get a custom endpoint from their Instacart representative; default is mcp.instacart.com.",
    learnMoreUrl:
      "https://docs.instacart.com/mcp_servers/get-started/use-instacarts-mcp-server",
  },
] as const;

export function getConnectorPreset(
  key: string,
): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((p) => p.key === key);
}

export function connectorLogoKey(
  connectorKey: string | null | undefined,
): string | null {
  if (!connectorKey) return null;
  const preset = getConnectorPreset(connectorKey);
  return preset?.logoKey ?? connectorKey;
}

export const CONNECTOR_CATEGORIES = [
  { id: "productivity", label: "Productivity" },
  { id: "google", label: "Google Workspace" },
  { id: "gcp", label: "Google Cloud" },
  { id: "google_apis", label: "Google APIs" },
  { id: "developer", label: "Developer" },
  { id: "support", label: "Support" },
  { id: "finance", label: "Finance" },
  { id: "commerce", label: "Commerce" },
] as const;

export function connectorUsesPublicOAuthClient(
  connectorKey: string | null | undefined,
): boolean {
  if (!connectorKey) return false;
  return getConnectorPreset(connectorKey)?.oauthPublicClient === true;
}
