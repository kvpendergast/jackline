import { z } from "zod";
import {
  ServerAuthMethodSchema,
  ServerCredentialModeSchema,
  ServerKindSchema,
} from "../types/server.js";

export const ConnectorPresetSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum([
    "productivity",
    "google",
    "developer",
    "support",
  ]),
  kind: ServerKindSchema,
  authMethod: ServerAuthMethodSchema,
  credentialMode: ServerCredentialModeSchema,
  baseUrl: z.url(),
  docsUrl: z.url().nullable(),
  /** Short hint shown in the create form for credentials. */
  authHint: z.string().min(1),
  /** Human docs (not OpenAPI). */
  learnMoreUrl: z.url().nullable(),
  /** Classic OAuth authorize URL (admin-supplied app / future Connect flow). */
  oauthAuthorizeUrl: z.url().optional(),
  /** OAuth token URL for auth-code / refresh / client_credentials. */
  oauthTokenUrl: z.url().optional(),
  /** Space-delimited default scopes for personal OAuth. */
  oauthScopes: z.string().optional(),
});

export type ConnectorPreset = z.infer<typeof ConnectorPresetSchema>;

/**
 * Curated remote MCP hosts for one-click server create.
 * Browser OAuth Connect is not wired yet — members paste tokens in My Access,
 * or Mesh will use these OAuth endpoints once the authorize/callback flow ships.
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
      "Use an OAuth access token from a Notion integration. Shared org token or per-person token in My Access both work.",
    learnMoreUrl: "https://developers.notion.com/docs/mcp",
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
      "Prefer an Atlassian API token as Bearer, or OAuth access token. Shared or per-person in My Access.",
    learnMoreUrl: "https://www.atlassian.com/platform/remote-mcp-server",
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
      "Each user connects their own Google account in My Access (OAuth access token with Gmail scopes).",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
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
      "Each user connects their own Google account in My Access (OAuth access token with Drive scopes).",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
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
      "Each user connects their own Google account in My Access (OAuth access token with Calendar scopes).",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
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
      "Each user connects their own Google account in My Access (OAuth access token with Docs scopes).",
    learnMoreUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
  },
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
      "Each user connects their own GitHub PAT or OAuth token in My Access.",
    learnMoreUrl:
      "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
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
      "Authorize via Sentry’s MCP OAuth (or paste an access token). Shared org token or per-person in My Access.",
    learnMoreUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
] as const;

export function getConnectorPreset(
  key: string,
): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((p) => p.key === key);
}

export const CONNECTOR_CATEGORIES = [
  { id: "productivity", label: "Productivity" },
  { id: "google", label: "Google Workspace" },
  { id: "developer", label: "Developer" },
  { id: "support", label: "Support" },
] as const;
