import type { Context } from "hono";
import {
  BadRequestError,
  getConfig,
  MCP_OAUTH_AUTHORIZE_CONSENT_PATH,
  mcpOauthIssuerUrl,
  publicApiBaseUrl,
  UnauthorizedError,
} from "@jackline/shared";
import type { JacklineEnv } from "../../lib/http/env.js";
import { requireVerifiedSession } from "../../lib/request/requireSession.js";
import {
  mcpOauthServices,
  type AuthorizeQuery,
} from "./service.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAuthorizeQuery(
  raw: Record<string, string>,
): AuthorizeQuery | { error: string } {
  const response_type = raw["response_type"];
  const client_id = raw["client_id"];
  const redirect_uri = raw["redirect_uri"];
  const code_challenge = raw["code_challenge"];
  const code_challenge_method = raw["code_challenge_method"] ?? "S256";
  if (!response_type || !client_id || !redirect_uri || !code_challenge) {
    return {
      error:
        "response_type, client_id, redirect_uri, and code_challenge are required",
    };
  }
  return {
    response_type,
    client_id,
    redirect_uri,
    state: raw["state"],
    code_challenge,
    code_challenge_method,
    resource: raw["resource"],
    scope: raw["scope"],
    tenant: raw["tenant"],
  };
}

function consentHtml(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
  tenant: string | undefined;
  responseType: string;
}): string {
  const fields: Array<[string, string]> = [
    ["response_type", input.responseType],
    ["client_id", input.clientId],
    ["redirect_uri", input.redirectUri],
    ["code_challenge", input.codeChallenge],
    ["code_challenge_method", input.codeChallengeMethod],
    ["resource", input.resource],
    ["scope", input.scope],
  ];
  if (input.state) fields.push(["state", input.state]);
  if (input.tenant) fields.push(["tenant", input.tenant]);

  const hidden = fields
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize — Jackline</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0c0f12; color: #e8eaed; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    main { max-width: 28rem; width: 100%; padding: 2rem; border: 1px solid #2a3139; background: #141a21; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #9aa3ad; font-size: 0.875rem; line-height: 1.5; margin: 0 0 1.25rem; }
    code { font-family: ui-monospace, monospace; font-size: 0.75rem; word-break: break-all; }
    button { width: 100%; padding: 0.75rem 1rem; background: #e8eaed; color: #0c0f12; border: 0; font-weight: 600; cursor: pointer; }
    button:hover { background: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>Allow MCP access?</h1>
    <p>
      <strong>${escapeHtml(input.clientName)}</strong> wants to connect to your
      Jackline MCP gateway as you.
    </p>
    <p>Resource: <code>${escapeHtml(input.resource)}</code></p>
    <form method="post" action="${escapeHtml(MCP_OAUTH_AUTHORIZE_CONSENT_PATH)}">
      ${hidden}
      <button type="submit">Allow</button>
    </form>
  </main>
</body>
</html>`;
}

/** GET /.well-known/oauth-authorization-server */
export async function asMetadataHandler(c: Context<JacklineEnv>) {
  const result = mcpOauthServices.buildAsMetadata();
  if (result.isErr()) throw result.error;
  return c.json(result.value, 200);
}

/**
 * POST /oauth/register — RFC 7591 DCR.
 * @deprecated Prefer CIMD. Kept for Grok compatibility.
 */
export async function dcrRegisterHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const tenantQuery = c.req.query("tenant");
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const result = await mcpOauthServices.registerDcrClient(
    log,
    body,
    tenantQuery,
  );
  if (result.isErr()) {
    const error = result.error;
    if (error instanceof BadRequestError) {
      return c.json(
        { error: "invalid_client_metadata", error_description: error.message },
        400,
      );
    }
    if (error instanceof UnauthorizedError) {
      return c.json(
        { error: "invalid_client", error_description: error.message },
        401,
      );
    }
    throw error;
  }

  return c.json(result.value, 201);
}

/** GET /oauth/authorize */
export async function authorizeGetHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const raw = c.req.query() as Record<string, string>;
  const parsed = parseAuthorizeQuery(raw);
  if ("error" in parsed) {
    return c.json(
      { error: "invalid_request", error_description: parsed.error },
      400,
    );
  }

  const validated = await mcpOauthServices.validateAuthorizeRequest(
    log,
    parsed,
  );
  if (validated.isErr()) {
    const error = validated.error;
    if (
      error instanceof BadRequestError ||
      error instanceof UnauthorizedError
    ) {
      return c.json(
        {
          error:
            error instanceof UnauthorizedError
              ? "invalid_client"
              : "invalid_request",
          error_description: error.message,
        },
        error instanceof UnauthorizedError ? 401 : 400,
      );
    }
    throw error;
  }

  const session = await requireVerifiedSession(c);
  if (session.isErr()) {
    const config = getConfig();
    const webOrigin = config.isOk()
      ? config.value.WEB_ORIGIN.replace(/\/$/, "")
      : "http://127.0.0.1:5173";
    const returnTo = c.req.url;
    const loginUrl = `${webOrigin}/login?return_to=${encodeURIComponent(returnTo)}`;
    return c.redirect(loginUrl, 302);
  }

  const { client, redirectUri, resource, scopes, codeChallenge } =
    validated.value;

  return c.html(
    consentHtml({
      clientName: client.name,
      clientId: parsed.client_id,
      redirectUri,
      state: parsed.state,
      codeChallenge,
      codeChallengeMethod: parsed.code_challenge_method,
      resource,
      scope: scopes,
      tenant: parsed.tenant,
      responseType: parsed.response_type,
    }),
  );
}

/** POST /oauth/authorize/consent */
export async function authorizeConsentHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const session = await requireVerifiedSession(c);
  if (session.isErr()) {
    return c.json(
      { error: "login_required", error_description: "Sign in required" },
      401,
    );
  }

  const form = await c.req.parseBody();
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "string") raw[key] = value;
  }

  const parsed = parseAuthorizeQuery(raw);
  if ("error" in parsed) {
    return c.json(
      { error: "invalid_request", error_description: parsed.error },
      400,
    );
  }

  const validated = await mcpOauthServices.validateAuthorizeRequest(
    log,
    parsed,
  );
  if (validated.isErr()) {
    const error = validated.error;
    if (
      error instanceof BadRequestError ||
      error instanceof UnauthorizedError
    ) {
      return c.json(
        {
          error: "invalid_request",
          error_description: error.message,
        },
        400,
      );
    }
    throw error;
  }

  const { client, redirectUri, resource, scopes, codeChallenge } =
    validated.value;

  const codeResult = await mcpOauthServices.createAuthorizationCode(log, {
    client,
    userId: session.value.user.id,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: parsed.code_challenge_method,
    resource,
    scopes,
  });

  if (codeResult.isErr()) throw codeResult.error;

  const config = getConfig();
  if (config.isErr()) throw config.error;
  const issuer = mcpOauthIssuerUrl(publicApiBaseUrl(config.value));

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", codeResult.value.code);
  if (parsed.state) redirect.searchParams.set("state", parsed.state);
  redirect.searchParams.set("iss", issuer);

  return c.redirect(redirect.toString(), 302);
}

async function parseTokenBody(
  c: Context<JacklineEnv>,
): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  const out: Record<string, string> = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  try {
    const json = (await c.req.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === "string") out[key] = value;
    }
  } catch {
    // empty
  }
  return out;
}

/**
 * POST /oauth/token — MCP authorization_code + refresh_token.
 * Admin client_credentials remains at POST /api/v1/oauth/token.
 */
export async function mcpTokenHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const body = await parseTokenBody(c);
  const grantType = body["grant_type"];

  if (grantType === "authorization_code") {
    const code = body["code"];
    const clientId = body["client_id"];
    const redirectUri = body["redirect_uri"];
    const codeVerifier = body["code_verifier"];
    if (!code || !clientId || !redirectUri || !codeVerifier) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "code, client_id, redirect_uri, and code_verifier are required",
        },
        400,
      );
    }

    const result = await mcpOauthServices.exchangeAuthorizationCode(log, {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource: body["resource"],
      tenant: body["tenant"],
    });

    if (result.isErr()) {
      return oauthTokenError(c, result.error);
    }
    return c.json(result.value, 200);
  }

  if (grantType === "refresh_token") {
    const refreshToken = body["refresh_token"];
    const clientId = body["client_id"];
    if (!refreshToken || !clientId) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "refresh_token and client_id are required",
        },
        400,
      );
    }

    const result = await mcpOauthServices.exchangeRefreshToken(log, {
      refresh_token: refreshToken,
      client_id: clientId,
      resource: body["resource"],
      tenant: body["tenant"],
    });

    if (result.isErr()) {
      return oauthTokenError(c, result.error);
    }
    return c.json(result.value, 200);
  }

  return c.json(
    {
      error: "unsupported_grant_type",
      error_description:
        "Only grant_type=authorization_code and refresh_token are supported",
    },
    400,
  );
}

function oauthTokenError(c: Context<JacklineEnv>, error: unknown) {
  if (error instanceof UnauthorizedError) {
    return c.json(
      { error: "invalid_grant", error_description: error.message },
      400,
    );
  }
  if (error instanceof BadRequestError) {
    return c.json(
      { error: "invalid_request", error_description: error.message },
      400,
    );
  }
  throw error;
}
