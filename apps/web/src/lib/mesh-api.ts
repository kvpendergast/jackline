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
    },
  ) => api<PublicServer>("/api/v1/servers", { tenantId, method: "POST", body }),

  updateServer: (
    tenantId: string,
    id: string,
    body: { status?: PublicServer["status"]; name?: string },
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
      searchParams: { limit: "200", serverId },
    }),

  createTool: (
    tenantId: string,
    body: { name: string; serverId: string; status?: ToolStatus },
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
    apiPage<PublicGatewayCredential>(
      `/api/v1/connections/${connectionId}/credentials`,
      { tenantId, searchParams: { limit: "10" } },
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
};
