import type { Logger } from "pino";

export type AuthContext = {
  userId: string;
  tenantId: string;
  membership: { id: string; role: string; team: string | null };
  method: "session" | "oauth_client_credentials";
  /** Present when method is oauth_client_credentials. */
  clientId?: string;
};

export type AnonymousRequestContext = {
  requestId: string;
  traceId?: string;
  log: Logger;
};

export type RequestContext = AnonymousRequestContext & {
  auth: AuthContext;
};
