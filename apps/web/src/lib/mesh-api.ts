import { api, apiPage } from "@/lib/api";
import type {
  ClientKind,
  MeData,
  MintedGatewayCredential,
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
  ServerKind,
  ToolStatus,
  ToolHttpMethod,
} from "@mesh/shared";

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

export const meshApi = {
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
      connectorKey?: string | null;
      docsUrl?: string | null;
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
      docsUrl?: string | null;
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
    body: { status?: ToolStatus; name?: string },
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

  createClient: (tenantId: string, body: { name: string; kind: ClientKind }) =>
    api<PublicClient>("/api/v1/clients", { tenantId, method: "POST", body }),

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
    api<{ items: import("@mesh/shared").PublicEffectiveTool[] }>(
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
    api<import("@mesh/shared").PublicSsoConfig>("/api/v1/settings/sso", {
      tenantId,
    }),

  updateSsoConfig: (
    tenantId: string,
    body: import("@mesh/shared").UpdateSsoConfigBody,
  ) =>
    api<import("@mesh/shared").PublicSsoConfig>("/api/v1/settings/sso", {
      tenantId,
      method: "PATCH",
      body,
    }),

  rotateScimToken: (tenantId: string) =>
    api<import("@mesh/shared").RotateScimTokenResult>(
      "/api/v1/settings/scim/token",
      { tenantId, method: "POST", body: {} },
    ),

  listInvites: (tenantId: string) =>
    api<{ items: import("@mesh/shared").PublicInvite[] }>(
      "/api/v1/settings/invites",
      { tenantId },
    ),

  createInvite: (
    tenantId: string,
    body: import("@mesh/shared").CreateInviteBody,
  ) =>
    api<{ invite: import("@mesh/shared").PublicInvite; token: string }>(
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
    api<import("@mesh/shared").PublicInvite>("/api/v1/invites/accept", {
      method: "POST",
      body: { token },
    }),

  listSsoProviders: () =>
    api<{ items: Array<{ providerId: string; label: string }> }>(
      "/api/v1/sso/providers",
    ),
};
