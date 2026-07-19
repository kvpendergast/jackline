import type { Logger } from "pino";

export type AuthContext = {
  userId: string;
  tenantId: string;
  membership: { id: string; role: string };
  method: "session";
};

export type AnonymousRequestContext = {
  requestId: string;
  traceId?: string;
  log: Logger;
};

export type RequestContext = AnonymousRequestContext & {
  auth: AuthContext;
};
