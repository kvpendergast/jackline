import { api, apiPage } from "@/lib/api";
import type {
  ClientKind,
  MeData,
  MintedGatewayCredential,
  MyAccessServer,
  PublicAuditEvent,
  PublicClient,
  PublicConnection,
  PublicConnectionDetail,
  PublicGatewayCredential,
  PublicRole,
  PublicRoleDetail,
  PublicSecret,
  PublicServer,
  PublicTool,
  PublicUser,
  RoleType,
  ServerAuthMethod,
  ServerCredentialMode,
  ServerKind,
  ToolStatus,
  ToolHttpMethod,
  UpstreamCredentialStatus,
} from "@jackline/shared";

export type SignupInput = {
  email: string;
  password: string;
  name: string;
  organizationName: string;
};

export type SignupResult = {
  user: PublicUser;
  tenant: { id: string; name: string; slug: string };
  membership: { id: string; role: string; userId: string; tenantId: string };
};

export const jacklineApi = {
  signup: (body: SignupInput) =>
    api<SignupResult>("/api/v1/signup", { method: "POST", body }),

  me: () => api<MeData>("/api/v1/me"),

  listServers: (tenantId: string) =>
    apiPage<PublicServer>("/api/v1/servers", {
      tenantId,
      searchParams: { limit: "100" },
    }),

  createServer: (
    tenantId: string,
    body: {
      name: string;
      baseUrl: string;
      authMethod: ServerAuthMethod;
      kind: ServerKind;
      source?: "custom" | "catalog";
      credentialMode?: ServerCredentialMode;
      connectorKey?: string | null;
      docsUrl?: string | null;
      oauthAuthorizeUrl?: string | null;
      oauthTokenUrl?: string | null;
      oauthScopes?: string | null;
      oauthClientId?: string | null;
    },
  ) => api<PublicServer>("/api/v1/servers", { tenantId, method: "POST", body }),

  updateServer: (
    tenantId: string,
    id: string,
    body: {
      name?: string;
      baseUrl?: string;
      authMethod?: ServerAuthMethod;
      kind?: ServerKind;
      status?: PublicServer["status"];
      credentialMode?: ServerCredentialMode;
      docsUrl?: string | null;
      connectorKey?: string | null;
      source?: "custom" | "catalog";
      oauthAuthorizeUrl?: string | null;
      oauthTokenUrl?: string | null;
      oauthScopes?: string | null;
      oauthClientId?: string | null;
      requiresApproval?: boolean;
    },
  ) =>
    api<PublicServer>(`/api/v1/servers/${id}`, {
      tenantId,
      method: "PATCH",
      body,
    }),

  syncServerTools: (tenantId: string, id: string) =>
    api<{
      discovered: number;
      created: number;
      updated: number;
      tools: PublicTool[];
    }>(`/api/v1/servers/${id}/sync-tools`, {
      tenantId,
      method: "POST",
      body: {},
    }),

  listTools: (tenantId: string, serverId?: string) =>
    apiPage<PublicTool>("/api/v1/tools", {
      tenantId,
      searchParams: { limit: "100", serverId },
    }),

  createTool: (
    tenantId: string,
    body: {
      name: string;
      serverId: string;
      status?: ToolStatus;
      description?: string | null;
      httpMethod?: ToolHttpMethod | null;
      pathTemplate?: string | null;
    },
  ) => api<PublicTool>("/api/v1/tools", { tenantId, method: "POST", body }),

  updateTool: (
    tenantId: string,
    id: string,
    body: { status?: ToolStatus; name?: string; requiresApproval?: boolean },
  ) =>
    api<PublicTool>(`/api/v1/tools/${id}`, {
      tenantId,
      method: "PATCH",
      body,
    }),

  listRoles: (tenantId: string) =>
    apiPage<PublicRole>("/api/v1/roles", {
      tenantId,
      searchParams: { limit: "100" },
    }),

  getRole: (tenantId: string, id: string) =>
    api<PublicRoleDetail>(`/api/v1/roles/${id}`, { tenantId }),

  createRole: (
    tenantId: string,
    body: { name: string; type: RoleType; description?: string | null },
  ) =>
    api<PublicRoleDetail>("/api/v1/roles", { tenantId, method: "POST", body }),

  updateRole: (
    tenantId: string,
    id: string,
    body: {
      name?: string;
      type?: RoleType;
      description?: string | null;
    },
  ) =>
    api<PublicRoleDetail>(`/api/v1/roles/${id}`, {
      tenantId,
      method: "PATCH",
      body,
    }),

  setRoleTools: (tenantId: string, id: string, toolIds: string[]) =>
    api<PublicRoleDetail>(`/api/v1/roles/${id}/tools`, {
      tenantId,
      method: "PUT",
      body: { toolIds },
    }),

  listClients: (tenantId: string) =>
    apiPage<PublicClient>("/api/v1/clients", {
      tenantId,
      searchParams: { limit: "100" },
    }),

  createClient: (
    tenantId: string,
    body: {
      name: string;
      kind: ClientKind;
      ownerUserId?: string | null;
    },
  ) => api<PublicClient>("/api/v1/clients", { tenantId, method: "POST", body }),

  rotateClientCredentials: (
    tenantId: string,
    clientId: string,
    body: { apiRole?: string; apiTeam?: string | null } = {},
  ) =>
    api<{
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
      apiRole: string;
      apiTeam: string | null;
    }>(`/api/v1/clients/${clientId}/credentials`, {
      tenantId,
      method: "POST",
      body,
    }),

  revokeClientCredentials: (tenantId: string, clientId: string) =>
    api<PublicClient>(`/api/v1/clients/${clientId}/credentials`, {
      tenantId,
      method: "DELETE",
    }),

  listUsers: (tenantId: string, kind?: string) =>
    apiPage<PublicUser>("/api/v1/users", {
      tenantId,
      searchParams: { limit: "100", kind },
    }),

  createServiceUser: (
    tenantId: string,
    body: { kind: "service"; name: string; email?: string },
  ) => api<PublicUser>("/api/v1/users", { tenantId, method: "POST", body }),

  listSecrets: (tenantId: string) =>
    apiPage<PublicSecret>("/api/v1/secrets", {
      tenantId,
      searchParams: { limit: "100" },
    }),

  createSecret: (
    tenantId: string,
    body: {
      kind: string;
      name: string;
      value: string;
      serverId?: string | null;
      userId?: string | null;
      connectionId?: string | null;
    },
  ) => api<PublicSecret>("/api/v1/secrets", { tenantId, method: "POST", body }),

  updateSecret: (
    tenantId: string,
    id: string,
    body: { name?: string; value?: string },
  ) =>
    api<PublicSecret>(`/api/v1/secrets/${id}`, {
      tenantId,
      method: "PATCH",
      body,
    }),

  deleteSecret: (tenantId: string, id: string) =>
    api<PublicSecret>(`/api/v1/secrets/${id}`, {
      tenantId,
      method: "DELETE",
    }),

  listConnections: (tenantId: string) =>
    apiPage<PublicConnection>("/api/v1/connections", {
      tenantId,
      searchParams: { limit: "50" },
    }),

  createConnection: (
    tenantId: string,
    body: { clientId: string; userId: string },
  ) =>
    api<PublicConnectionDetail>("/api/v1/connections", {
      tenantId,
      method: "POST",
      body,
    }),

  getConnection: (tenantId: string, id: string) =>
    api<PublicConnectionDetail>(`/api/v1/connections/${id}`, { tenantId }),

  listEffectiveTools: (tenantId: string, connectionId: string) =>
    api<{ items: import("@jackline/shared").PublicEffectiveTool[] }>(
      `/api/v1/connections/${connectionId}/effective-tools`,
      { tenantId },
    ),

  updateConnection: (
    tenantId: string,
    id: string,
    body: { status: PublicConnection["status"] },
  ) =>
    api<PublicConnectionDetail>(`/api/v1/connections/${id}`, {
      tenantId,
      method: "PATCH",
      body,
    }),

  attachConnectionRole: (tenantId: string, id: string, roleId: string) =>
    api<PublicConnectionDetail>(`/api/v1/connections/${id}/roles`, {
      tenantId,
      method: "POST",
      body: { roleId },
    }),

  attachToolOverride: (
    tenantId: string,
    id: string,
    body: { toolId: string; type: "allow" | "deny" },
  ) =>
    api<PublicConnectionDetail>(`/api/v1/connections/${id}/tool-overrides`, {
      tenantId,
      method: "POST",
      body,
    }),

  removeToolOverride: (tenantId: string, id: string, toolId: string) =>
    api<PublicConnectionDetail>(
      `/api/v1/connections/${id}/tool-overrides/${toolId}`,
      { tenantId, method: "DELETE" },
    ),

  listCredentials: (tenantId: string, connectionId: string) =>
    api<PublicGatewayCredential[]>(
      `/api/v1/connections/${connectionId}/credentials`,
      { tenantId },
    ),

  mintCredential: (tenantId: string, connectionId: string) =>
    api<MintedGatewayCredential>(
      `/api/v1/connections/${connectionId}/credentials`,
      { tenantId, method: "POST", body: {} },
    ),

  setMemberToolEnabled: (
    tenantId: string,
    connectionId: string,
    toolId: string,
    enabled: boolean,
  ) =>
    api<PublicConnectionDetail>(
      `/api/v1/connections/${connectionId}/member-tools/${toolId}`,
      { tenantId, method: "POST", body: { enabled } },
    ),

  listAccessRequests: (tenantId: string, status?: string) =>
    api<{ items: import("@jackline/shared").PublicAccessRequest[] }>(
      "/api/v1/access-requests",
      { tenantId, searchParams: { status } },
    ),

  createAccessRequest: (
    tenantId: string,
    body: { connectionId: string; serverId: string },
  ) =>
    api<import("@jackline/shared").PublicAccessRequest>("/api/v1/access-requests", {
      tenantId,
      method: "POST",
      body,
    }),

  attachAutoAllowedTools: (
    tenantId: string,
    body: { connectionId: string; serverId: string },
  ) =>
    api<{ attachedToolIds: string[] }>("/api/v1/access-requests/attach-auto", {
      tenantId,
      method: "POST",
      body,
    }),

  approveAccessRequest: (
    tenantId: string,
    id: string,
    body: { toolIds?: string[] | null; note?: string | null } = {},
  ) =>
    api<import("@jackline/shared").PublicAccessRequest>(
      `/api/v1/access-requests/${id}/approve`,
      { tenantId, method: "POST", body },
    ),

  denyAccessRequest: (
    tenantId: string,
    id: string,
    body: { note?: string | null } = {},
  ) =>
    api<import("@jackline/shared").PublicAccessRequest>(
      `/api/v1/access-requests/${id}/deny`,
      { tenantId, method: "POST", body },
    ),

  cancelAccessRequest: (tenantId: string, id: string) =>
    api<import("@jackline/shared").PublicAccessRequest>(
      `/api/v1/access-requests/${id}/cancel`,
      { tenantId, method: "POST" },
    ),

  listNotifications: (tenantId: string) =>
    api<{
      items: import("@jackline/shared").PublicNotification[];
      unreadCount: number;
    }>("/api/v1/notifications", { tenantId }),

  markNotificationRead: (tenantId: string, id: string) =>
    api<import("@jackline/shared").PublicNotification>(
      `/api/v1/notifications/${id}/read`,
      { tenantId, method: "POST", body: {} },
    ),

  markAllNotificationsRead: (tenantId: string) =>
    api<{ updated: number }>("/api/v1/notifications/read-all", {
      tenantId,
      method: "POST",
      body: {},
    }),

  revokeCredential: (
    tenantId: string,
    connectionId: string,
    secretId: string,
  ) =>
    api<PublicGatewayCredential>(
      `/api/v1/connections/${connectionId}/credentials/${secretId}`,
      { tenantId, method: "DELETE" },
    ),

  listAuditEvents: (
    tenantId: string,
    searchParams?: Record<string, string | undefined>,
  ) =>
    apiPage<PublicAuditEvent>("/api/v1/audit-events", {
      tenantId,
      searchParams: { limit: "50", ...searchParams },
    }),

  getSsoConfig: (tenantId: string) =>
    api<import("@jackline/shared").PublicSsoConfig>("/api/v1/settings/sso", {
      tenantId,
    }),

  updateSsoConfig: (
    tenantId: string,
    body: import("@jackline/shared").UpdateSsoConfigBody,
  ) =>
    api<import("@jackline/shared").PublicSsoConfig>("/api/v1/settings/sso", {
      tenantId,
      method: "PATCH",
      body,
    }),

  rotateScimToken: (tenantId: string) =>
    api<import("@jackline/shared").RotateScimTokenResult>(
      "/api/v1/settings/scim/token",
      { tenantId, method: "POST", body: {} },
    ),

  listInvites: (tenantId: string) =>
    api<{ items: import("@jackline/shared").PublicInvite[] }>(
      "/api/v1/settings/invites",
      { tenantId },
    ),

  createInvite: (
    tenantId: string,
    body: import("@jackline/shared").CreateInviteBody,
  ) =>
    api<{ invite: import("@jackline/shared").PublicInvite; token: string }>(
      "/api/v1/settings/invites",
      { tenantId, method: "POST", body },
    ),

  listAdmins: (tenantId: string) =>
    api<{
      items: Array<{
        membershipId: string;
        userId: string;
        email: string;
        name: string;
        role: string;
        team: string | null;
      }>;
    }>("/api/v1/settings/admins", { tenantId }),

  acceptInvite: (token: string) =>
    api<import("@jackline/shared").PublicInvite>("/api/v1/invites/accept", {
      method: "POST",
      body: { token },
    }),

  listSsoProviders: () =>
    api<{ items: Array<{ providerId: string; label: string }> }>(
      "/api/v1/sso/providers",
    ),

  listMyAccessServers: (tenantId: string) =>
    api<{ items: MyAccessServer[] }>("/api/v1/me/servers", { tenantId }),

  startOauthConnect: (tenantId: string, serverId: string) =>
    api<{ authorizeUrl: string; redirectUri: string }>("/api/v1/oauth/start", {
      tenantId,
      method: "POST",
      body: { serverId },
    }),

  upsertMyAccessCredential: (
    tenantId: string,
    serverId: string,
    body: { name?: string; value: string },
  ) =>
    api<PublicSecret>(`/api/v1/me/servers/${serverId}/credential`, {
      tenantId,
      method: "PUT",
      body,
    }),

  deleteMyAccessCredential: (tenantId: string, serverId: string) =>
    api<{ deleted: true }>(`/api/v1/me/servers/${serverId}/credential`, {
      tenantId,
      method: "DELETE",
    }),

  listUpstreamCredentials: (tenantId: string, connectionId: string) =>
    api<{ items: UpstreamCredentialStatus[] }>(
      `/api/v1/connections/${connectionId}/upstream-credentials`,
      { tenantId },
    ),

  getChatSession: (tenantId: string) =>
    api<import("@jackline/shared").PublicChatSession>("/api/v1/chat/session", {
      tenantId,
    }),

  getChatSettings: (tenantId: string) =>
    api<import("@jackline/shared").PublicChatSettings>("/api/v1/chat/settings", {
      tenantId,
    }),

  updateChatSettings: (
    tenantId: string,
    body: import("@jackline/shared").UpdateChatSettingsBody,
  ) =>
    api<import("@jackline/shared").PublicChatSettings>("/api/v1/chat/settings", {
      tenantId,
      method: "PUT",
      body,
    }),
};
