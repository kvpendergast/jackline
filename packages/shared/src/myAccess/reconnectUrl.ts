import { ForbiddenError } from "../errors/index.js";

/** Deep link into the My Access page for a specific server. */
export function myAccessReconnectUrl(webOrigin: string, serverId: string): string {
  const base = webOrigin.replace(/\/$/, "");
  const url = new URL("/my-access", `${base}/`);
  url.searchParams.set("server", serverId);
  return url.toString();
}

export type UpstreamCredentialFailureKind =
  | "missing_personal"
  | "expired_personal"
  | "missing_shared"
  | "expired_shared";

/**
 * User-facing message when upstream credentials are missing or OAuth refresh fails.
 * Personal failures include a My Access reconnect link.
 *
 * Messages deliberately say not to wipe / re-auth the Jackline gateway credential —
 * harnesses (Grok, Cursor, …) often confuse upstream expiry with MCP `needsAuth`.
 */
export function formatUpstreamCredentialFailure(input: {
  webOrigin: string;
  serverId: string;
  serverName: string;
  kind: UpstreamCredentialFailureKind;
}): string {
  const { serverName, serverId, webOrigin, kind } = input;
  const reconnectUrl = myAccessReconnectUrl(webOrigin, serverId);
  const notGateway =
    "Do not wipe or re-authenticate the Jackline MCP gateway credential — that will not refresh upstream tokens.";

  switch (kind) {
    case "missing_personal":
      return `Connect your ${serverName} account in My Access before calling this server: ${reconnectUrl}. ${notGateway}`;
    case "expired_personal":
      return `${serverName} upstream access expired or was revoked. Open My Access to reconnect: ${reconnectUrl}. ${notGateway}`;
    case "missing_shared":
      return `No shared credential configured for ${serverName}. Ask an admin to add one in Servers. ${notGateway}`;
    case "expired_shared":
      return `Shared credential for ${serverName} expired or was revoked. Ask an admin to rotate it in Servers. ${notGateway}`;
  }
}

export function isPersonalUpstreamCredentialFailure(
  kind: UpstreamCredentialFailureKind,
): boolean {
  return kind === "missing_personal" || kind === "expired_personal";
}

/** Detect upstream OAuth / HTTP auth failures that warrant a force-refresh retry. */
export function isInvalidUpstreamTokenError(cause: unknown): boolean {
  if (typeof cause === "number") {
    return cause === 401;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return /invalid_token|invalid access token|invalid authentication credentials|expected oauth|authentication_required|unauthorized|www-authenticate|401\b/i.test(
    message,
  );
}

/**
 * Upstream MCP/API credential missing or OAuth refresh failed.
 * Personal kinds carry a My Access reconnect URL for URL elicitation.
 */
export class UpstreamCredentialFailureError extends ForbiddenError {
  readonly kind: UpstreamCredentialFailureKind;
  readonly serverId: string;
  readonly serverName: string;
  readonly reconnectUrl: string | null;

  constructor(input: {
    webOrigin: string;
    serverId: string;
    serverName: string;
    kind: UpstreamCredentialFailureKind;
  }) {
    const message = formatUpstreamCredentialFailure(input);
    super(message);
    this.name = "UpstreamCredentialFailureError";
    this.kind = input.kind;
    this.serverId = input.serverId;
    this.serverName = input.serverName;
    this.reconnectUrl = isPersonalUpstreamCredentialFailure(input.kind)
      ? myAccessReconnectUrl(input.webOrigin, input.serverId)
      : null;
  }

  /** True when a harness should open My Access via URL elicitation. */
  get requiresUrlElicitation(): boolean {
    return this.reconnectUrl != null;
  }
}

export function upstreamCredentialFailure(input: {
  webOrigin: string;
  serverId: string;
  serverName: string;
  kind: UpstreamCredentialFailureKind;
}): UpstreamCredentialFailureError {
  return new UpstreamCredentialFailureError(input);
}
