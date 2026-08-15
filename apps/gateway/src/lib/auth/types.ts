import type { Connection } from "@jackline/db";
import type { Logger } from "pino";

export type GatewayAuthKind = "gateway_token" | "mcp_oauth";

export type GatewayConnectionContext = {
  requestId: string;
  connection: Connection;
  tenantId: string;
  /** Present for static `jkl_…` credentials. */
  secretId: string | null;
  /** Present for MCP OAuth access tokens. */
  mcpOAuthAccessTokenId: string | null;
  mcpOAuthClientId: string | null;
  authKind: GatewayAuthKind;
  log: Logger;
};

export type GatewayEnv = {
  Variables: {
    gatewayContext: GatewayConnectionContext;
  };
};
