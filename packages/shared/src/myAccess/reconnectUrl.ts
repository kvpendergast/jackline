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
 */
export function formatUpstreamCredentialFailure(input: {
  webOrigin: string;
  serverId: string;
  serverName: string;
  kind: UpstreamCredentialFailureKind;
}): string {
  const { serverName, serverId, webOrigin, kind } = input;
  const reconnectUrl = myAccessReconnectUrl(webOrigin, serverId);

  switch (kind) {
    case "missing_personal":
      return `Connect your ${serverName} account in My Access before calling this server: ${reconnectUrl}`;
    case "expired_personal":
      return `${serverName} access expired or was revoked. Reconnect here: ${reconnectUrl}`;
    case "missing_shared":
      return `No shared credential configured for ${serverName}. Ask an admin to add one in Servers.`;
    case "expired_shared":
      return `Shared credential for ${serverName} expired or was revoked. Ask an admin to rotate it in Servers.`;
  }
}
