import type { Connection } from "@mesh/db";
import type { Logger } from "pino";

export type GatewayConnectionContext = {
  requestId: string;
  connection: Connection;
  tenantId: string;
  secretId: string;
  log: Logger;
};

export type GatewayEnv = {
  Variables: {
    gatewayContext: GatewayConnectionContext;
  };
};
