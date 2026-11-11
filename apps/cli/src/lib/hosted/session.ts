import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  keychainDeleteSecret,
  keychainGetSecret,
  keychainSetSecret,
} from "../keychain.js";
import type { JacklinePaths } from "../paths.js";

/**
 * Hosted mode: `jackline login --server <url>` signs the CLI in to a hosted
 * (or self-hosted) Jackline with browser OAuth (authorization_code + PKCE,
 * loopback redirect on a random port, RFC 8252). The server mints a
 * short-lived `jackline_uat_` API access token plus a rotating refresh token;
 * both live in the OS keychain. Only a non-secret pointer is written to disk.
 */

export type FetchLike = typeof fetch;

export type SecretStore = {
  get(account: string): Promise<string | null>;
  set(account: string, value: string, label: string): Promise<void>;
  delete(account: string): Promise<void>;
};

export const keychainSecretStore: SecretStore = {
  get: keychainGetSecret,
  set: keychainSetSecret,
  delete: keychainDeleteSecret,
};

export type ServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  apiResource: string;
  mcpResource: string | null;
  clientId: string;
  tenancy: "single" | "multi";
};

export type HostedSession = {
  version: 1;
  server: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  apiResource: string;
  clientId: string;
  tenant: string | null;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

type SessionPointer = { version: 1; server: string; account: string };

/** Refresh this long before expiry to absorb clock skew / latency. */
export const REFRESH_SKEW_MS = 60_000;

export class HostedAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedAuthError";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/** Normalize `--server`: https required except for loopback dev servers. */
export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new HostedAuthError(`Invalid --server URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new HostedAuthError(
      "--server must use https:// (http:// is only allowed for localhost)",
    );
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function sessionAccount(server: string): string {
  const id = createHash("sha256").update(server).digest("hex").slice(0, 16);
  return `hosted-session:${id}`;
}

function pointerPath(paths: JacklinePaths): string {
  return path.join(paths.root, "hosted.json");
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value) {
    throw new HostedAuthError(
      `Server metadata is missing ${key}; is this a Jackline server with CLI login support?`,
    );
  }
  return value;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Fetch RFC 8414 metadata plus Jackline extensions. */
export async function discoverServer(
  server: string,
  fetchImpl: FetchLike = fetch,
): Promise<ServerMetadata> {
  const url = `${server}/.well-known/oauth-authorization-server`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new HostedAuthError(`Could not reach ${url}: ${detail}`);
  }
  if (!res.ok) {
    throw new HostedAuthError(`${url} returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const issuer = requireString(json, "issuer");
  const meta: ServerMetadata = {
    issuer,
    authorizationEndpoint: requireString(json, "authorization_endpoint"),
    tokenEndpoint: requireString(json, "token_endpoint"),
    revocationEndpoint:
      typeof json["revocation_endpoint"] === "string"
        ? json["revocation_endpoint"]
        : null,
    apiResource: requireString(json, "jackline_api_resource"),
    mcpResource:
      typeof json["jackline_mcp_resource"] === "string"
        ? json["jackline_mcp_resource"]
        : null,
    clientId: requireString(json, "jackline_cli_client_id"),
    tenancy: json["jackline_tenancy"] === "multi" ? "multi" : "single",
  };
  for (const endpoint of [
    meta.authorizationEndpoint,
    meta.tokenEndpoint,
    meta.apiResource,
    ...(meta.revocationEndpoint ? [meta.revocationEndpoint] : []),
  ]) {
    if (!sameOrigin(endpoint, issuer)) {
      throw new HostedAuthError(
        `Server metadata endpoint ${endpoint} is not on the issuer origin ${issuer}`,
      );
    }
  }
  return meta;
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function postToken(
  fetchImpl: FetchLike,
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: TokenResponse }> {
  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(body),
  });
  let json: TokenResponse = {};
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    // keep empty
  }
  return { ok: res.ok, status: res.status, json };
}

function htmlPage(res: ServerResponse, status: number, title: string, body: string): void {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><p>${esc(body)}</p></body></html>`,
  );
}

/**
 * Listen on 127.0.0.1:<random>/callback, open the browser at the authorize
 * URL, and resolve with the authorization code (state-checked).
 */
async function waitForAuthorizationCode(input: {
  buildAuthorizeUrl: (redirectUri: string, state: string) => string;
  openUrl: (url: string) => Promise<void>;
  onListening?: ((authorizeUrl: string) => void) | undefined;
  timeoutMs: number;
}): Promise<{ code: string; redirectUri: string }> {
  const state = randomBytes(16).toString("base64url");
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        htmlPage(res, 400, "Login failed", desc);
        finish(new HostedAuthError(`Login failed: ${desc}`));
        return;
      }
      if (!code || returnedState !== state) {
        htmlPage(res, 400, "Login failed", "Missing code or state mismatch.");
        finish(new HostedAuthError("Invalid OAuth callback (code/state)"));
        return;
      }
      htmlPage(res, 200, "Signed in to Jackline", "You can close this tab and return to the terminal.");
      finish(null, code);
    });

    const timer = setTimeout(() => {
      finish(new HostedAuthError("Timed out waiting for the browser login"));
    }, input.timeoutMs);

    function finish(error: Error | null, code?: string) {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (error) reject(error);
      else resolve({ code: code!, redirectUri });
    }

    server.on("error", (cause) => finish(cause));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl = input.buildAuthorizeUrl(redirectUri, state);
      input.onListening?.(authorizeUrl);
      input.openUrl(authorizeUrl).catch(() => {
        // Caller already printed the URL via onListening.
      });
    });
  });
}

function sessionFromTokens(
  meta: ServerMetadata,
  server: string,
  tenant: string | null,
  json: TokenResponse,
  now: number,
): HostedSession {
  if (!json.access_token || !json.refresh_token) {
    throw new HostedAuthError("Token response is missing access_token or refresh_token");
  }
  return {
    version: 1,
    server,
    issuer: meta.issuer,
    tokenEndpoint: meta.tokenEndpoint,
    revocationEndpoint: meta.revocationEndpoint,
    apiResource: meta.apiResource,
    clientId: meta.clientId,
    tenant,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + (json.expires_in ?? 900) * 1000,
  };
}

export type LoginOptions = {
  server: string;
  tenant?: string | undefined;
  paths: JacklinePaths;
  store?: SecretStore | undefined;
  fetchImpl?: FetchLike | undefined;
  openUrl: (url: string) => Promise<void>;
  onListening?: ((authorizeUrl: string) => void) | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
};

export async function login(options: LoginOptions): Promise<HostedSession> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = options.store ?? keychainSecretStore;
  const now = options.now ?? Date.now;
  const server = normalizeServerUrl(options.server);
  const meta = await discoverServer(server, fetchImpl);
  const tenant = options.tenant?.trim() || null;
  if (meta.tenancy === "multi" && !tenant) {
    throw new HostedAuthError(
      "This Jackline server hosts multiple workspaces; pass --tenant <slug>",
    );
  }

  const { verifier, challenge } = pkcePair();
  const { code, redirectUri } = await waitForAuthorizationCode({
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
    openUrl: options.openUrl,
    onListening: options.onListening,
    buildAuthorizeUrl: (redirect, state) => {
      const url = new URL(meta.authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", meta.clientId);
      url.searchParams.set("redirect_uri", redirect);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("resource", meta.apiResource);
      url.searchParams.set("scope", "api");
      if (tenant) url.searchParams.set("tenant", tenant);
      return url.toString();
    },
  });

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: meta.clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: meta.apiResource,
  };
  if (tenant) body["tenant"] = tenant;
  const token = await postToken(fetchImpl, meta.tokenEndpoint, body);
  if (!token.ok) {
    throw new HostedAuthError(
      `Token exchange failed: ${token.json.error_description ?? token.json.error ?? `HTTP ${token.status}`}`,
    );
  }

  const session = sessionFromTokens(meta, server, tenant, token.json, now());
  await saveSession(options.paths, session, store);
  return session;
}

export async function saveSession(
  paths: JacklinePaths,
  session: HostedSession,
  store: SecretStore = keychainSecretStore,
): Promise<void> {
  const account = sessionAccount(session.server);
  await store.set(account, JSON.stringify(session), `Jackline login (${session.server})`);
  const pointer: SessionPointer = { version: 1, server: session.server, account };
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await writeFile(pointerPath(paths), `${JSON.stringify(pointer, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function loadSession(
  paths: JacklinePaths,
  store: SecretStore = keychainSecretStore,
): Promise<HostedSession | null> {
  let pointer: SessionPointer;
  try {
    pointer = JSON.parse(await readFile(pointerPath(paths), "utf8")) as SessionPointer;
  } catch {
    return null;
  }
  const raw = await store.get(pointer.account);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as HostedSession;
    return session.version === 1 ? session : null;
  } catch {
    return null;
  }
}

/** Return a fresh access token, refreshing (and rotating) when near expiry. */
export async function getAccessToken(
  paths: JacklinePaths,
  options: {
    store?: SecretStore | undefined;
    fetchImpl?: FetchLike | undefined;
    now?: (() => number) | undefined;
    forceRefresh?: boolean | undefined;
  } = {},
): Promise<{ accessToken: string; session: HostedSession }> {
  const store = options.store ?? keychainSecretStore;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const session = await loadSession(paths, store);
  if (!session) {
    throw new HostedAuthError("Not logged in. Run `jackline login --server <url>`.");
  }
  if (!options.forceRefresh && session.expiresAt - REFRESH_SKEW_MS > now()) {
    return { accessToken: session.accessToken, session };
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
    resource: session.apiResource,
  };
  if (session.tenant) body["tenant"] = session.tenant;
  const token = await postToken(fetchImpl, session.tokenEndpoint, body);
  if (!token.ok) {
    if (token.json.error === "invalid_grant") {
      throw new HostedAuthError(
        `Your Jackline login for ${session.server} has expired. Run \`jackline login --server ${session.server}\`.`,
      );
    }
    throw new HostedAuthError(
      `Token refresh failed: ${token.json.error_description ?? token.json.error ?? `HTTP ${token.status}`}`,
    );
  }
  const refreshed: HostedSession = {
    ...session,
    accessToken: token.json.access_token ?? "",
    refreshToken: token.json.refresh_token ?? "",
    expiresAt: now() + (token.json.expires_in ?? 900) * 1000,
  };
  if (!refreshed.accessToken || !refreshed.refreshToken) {
    throw new HostedAuthError("Token refresh response is missing tokens");
  }
  await saveSession(paths, refreshed, store);
  return { accessToken: refreshed.accessToken, session: refreshed };
}

/** Authenticated GET against the hosted API; refreshes once on 401. */
export async function hostedApiGet<T>(
  paths: JacklinePaths,
  apiPath: string,
  options: {
    store?: SecretStore | undefined;
    fetchImpl?: FetchLike | undefined;
    now?: (() => number) | undefined;
  } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const call = async (forceRefresh: boolean) => {
    const { accessToken, session } = await getAccessToken(paths, {
      ...options,
      forceRefresh,
    });
    return fetchImpl(`${session.apiResource}${apiPath}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  };
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: { message?: string } }
    | null;
  if (!res.ok || !json || json.success === false) {
    throw new HostedAuthError(
      `GET ${apiPath} failed: ${json?.error?.message ?? `HTTP ${res.status}`}`,
    );
  }
  return json.data as T;
}

/** Revoke the refresh token (best effort) and forget the local session. */
export async function logout(
  paths: JacklinePaths,
  options: { store?: SecretStore | undefined; fetchImpl?: FetchLike | undefined } = {},
): Promise<{ server: string | null; revoked: boolean }> {
  const store = options.store ?? keychainSecretStore;
  const fetchImpl = options.fetchImpl ?? fetch;
  const session = await loadSession(paths, store);
  let revoked = false;
  if (session?.revocationEndpoint) {
    try {
      const body: Record<string, string> = {
        token: session.refreshToken,
        client_id: session.clientId,
      };
      if (session.tenant) body["tenant"] = session.tenant;
      const res = await fetchImpl(session.revocationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      });
      revoked = res.ok;
    } catch {
      revoked = false;
    }
  }
  if (session) await store.delete(sessionAccount(session.server));
  await rm(pointerPath(paths), { force: true });
  return { server: session?.server ?? null, revoked };
}
