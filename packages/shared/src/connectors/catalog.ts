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
});

export type ConnectorPreset = z.infer<typeof ConnectorPresetSchema>;

const GOOGLE_OAUTH = {
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthTokenUrl: "https://oauth2.googleapis.com/token",
  oauthAuthorizeExtraParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
} as const;

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
