import type { Logger } from "pino";

export type AuthContext = {
  userId: string;
  tenantId: string;
  membership: { id: string; role: string; team: string | null };
  /**
   * `oauth_client_credentials`: service client `jackline_at_` token.
   * `oauth_authorization_code`: user `jackline_uat_` token (e.g. `jackline login`).
   */
  method: "session" | "oauth_client_credentials" | "oauth_authorization_code";
  /** Present for both OAuth bearer methods. */
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
