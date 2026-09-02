import type { Connection } from "@jackline/db";
import type { HttpObservabilityEnv, HttpRequestContext } from "@jackline/observability";
import type { Logger } from "pino";

export type GatewayConnectionContext = {
  requestId: string;
  connection: Connection;
  tenantId: string;
  secretId: string;
  log: Logger;
};

export type GatewayEnv = HttpObservabilityEnv & {
  Variables: HttpObservabilityEnv["Variables"] & {
    gatewayContext: GatewayConnectionContext;
  };
};

export type { HttpRequestContext };
