import type { Context } from "hono";
import { escapeHtml } from "./html.js";
import {
  UnauthorizedError,
  getConfig,
  mcpOauthAuthorizeUrl,
  mcpOauthTokenUrl,
  publicApiBaseUrl,
  publicMcpUrl,
} from "@jackline/shared";
import { requireSession } from "../../lib/request/requireSession.js";
import type { JacklineEnv } from "../../lib/http/env.js";
import { mcpOauthServices } from "./service.js";

function parseBasicAuth(
  header: string | undefined,
): { clientId: string; clientSecret: string } | null {
  if (!header?.toLowerCase().startsWith("basic ")) return null;
  const encoded = header.slice(6).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon <= 0) return null;
    return {
      clientId: decoded.slice(0, colon),
      clientSecret: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

/** RFC 8414 Authorization Server Metadata (API origin = issuer). */
export async function mcpOauthAsMetadataHandler(c: Context<JacklineEnv>) {
  const config = getConfig();
  if (config.isErr()) return c.json({ error: "misconfigured" }, 500);
  const api = publicApiBaseUrl(config.value);
  return c.json({
    issuer: api,
    authorization_endpoint: mcpOauthAuthorizeUrl(api),
    token_endpoint: mcpOauthTokenUrl(api),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: ["mcp"],
  });
}

/** RFC 9728 Protected Resource Metadata (same-origin / Caddy). */
export async function mcpOauthProtectedResourceHandler(c: Context<JacklineEnv>) {
  const config = getConfig();
  if (config.isErr()) return c.json({ error: "misconfigured" }, 500);
  const env = config.value;
  return c.json({
    resource: publicMcpUrl(env),
    authorization_servers: [publicApiBaseUrl(env)],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
}

function consentPage(input: {
  clientName: string;
  connectionId: string;
  query: Record<string, string>;
  error?: string;
}): string {
  const hidden = Object.entries(input.query)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join("\n");
  const err = input.error
    ? `<p style="color:#b91c1c">${escapeHtml(input.error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Authorize Jackline MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
    button { margin-right: 0.5rem; padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>Authorize MCP access</h1>
  <p>Client <strong>${escapeHtml(input.clientName)}</strong> wants to use Jackline connection <code>${escapeHtml(input.connectionId)}</code>.</p>
  ${err}
  <form method="post" action="">
    ${hidden}
    <button type="submit" name="decision" value="approve">Approve</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </form>
</body>
</html>`;
}

export async function mcpOauthAuthorizeGetHandler(c: Context<JacklineEnv>) {
  const q = c.req.query();
  const clientId = q["client_id"]?.trim();
  const redirectUri = q["redirect_uri"]?.trim();
  const responseType = q["response_type"]?.trim();
  const codeChallenge = q["code_challenge"]?.trim();
  const codeChallengeMethod = q["code_challenge_method"]?.trim() || "S256";
  const state = q["state"]?.trim();
  const scope = q["scope"]?.trim();

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.html(
      "<p>Missing required OAuth parameters (client_id, redirect_uri, code_challenge).</p>",
      400,
    );
  }
  if (responseType && responseType !== "code") {
    return c.html("<p>Only response_type=code is supported.</p>", 400);
  }

  const session = await requireSession(c);
  if (session.isErr()) {
    const config = getConfig();
    const web =
      config.isOk() ? config.value.WEB_ORIGIN.replace(/\/$/, "") : "";
    const returnTo = encodeURIComponent(c.req.url);
    return c.html(
      `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:32rem;margin:3rem auto">
        <h1>Sign in required</h1>
        <p>Sign in to Jackline, then return to authorize this MCP client.</p>
        ${web ? `<p><a href="${escapeHtml(web)}/login?next=${returnTo}">Sign in</a></p>` : ""}
      </body></html>`,
      401,
    );
  }

  const clientResult = await mcpOauthServices.loadActiveClient(clientId);
  if (clientResult.isErr()) {
    return c.html("<p>Unknown or revoked OAuth client.</p>", 400);
  }

  const query: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  };
  if (state) query["state"] = state;
  if (scope) query["scope"] = scope;

  return c.html(
    consentPage({
      clientName: clientResult.value.name,
      connectionId: clientResult.value.connectionId,
      query,
    }),
  );
}

export async function mcpOauthAuthorizePostHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const session = await requireSession(c);
  if (session.isErr()) {
    return c.html("<p>Sign in required.</p>", 401);
  }

  const form = await c.req.parseBody();
  const get = (key: string) =>
    typeof form[key] === "string" ? (form[key] as string).trim() : "";

  const decision = get("decision");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const codeChallenge = get("code_challenge");
  const codeChallengeMethod = get("code_challenge_method") || "S256";
  const state = get("state") || undefined;
  const scope = get("scope") || undefined;

  if (decision === "deny") {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  }

  const issued = await mcpOauthServices.issueAuthorizationCode(log, {
    clientId,
    userId: session.value.user.id,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    state,
  });

  if (issued.isErr()) {
    const clientResult = await mcpOauthServices.loadActiveClient(clientId);
    return c.html(
      consentPage({
        clientName: clientResult.isOk() ? clientResult.value.name : clientId,
        connectionId: clientResult.isOk()
          ? clientResult.value.connectionId
          : "",
        query: {
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          ...(state ? { state } : {}),
          ...(scope ? { scope } : {}),
        },
        error: issued.error.message,
      }),
      issued.error instanceof UnauthorizedError ? 401 : 400,
    );
  }

  const url = new URL(issued.value.redirectUri);
  url.searchParams.set("code", issued.value.code);
  if (issued.value.state) url.searchParams.set("state", issued.value.state);
  return c.redirect(url.toString(), 302);
}

export async function mcpOauthTokenHandler(c: Context<JacklineEnv>) {
  const log = c.get("requestContext").log;
  const contentType = c.req.header("content-type") ?? "";

  let body: Record<string, string> = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === "string") body[k] = v;
    }
  } else {
    try {
      const json = (await c.req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string") body[k] = v;
      }
    } catch {
      body = {};
    }
  }

  const basic = parseBasicAuth(c.req.header("Authorization"));
  const clientId = basic?.clientId ?? body["client_id"];
  const clientSecret = basic?.clientSecret ?? body["client_secret"];
  const grantType = body["grant_type"];

  if (!clientId || !clientSecret) {
    return c.json(
      {
        error: "invalid_client",
        error_description: "client_id and client_secret are required",
      },
      401,
    );
  }

  if (grantType === "authorization_code") {
    const result = await mcpOauthServices.exchangeAuthorizationCode(log, {
      clientId,
      clientSecret,
      code: body["code"] ?? "",
      redirectUri: body["redirect_uri"] ?? "",
      codeVerifier: body["code_verifier"] ?? "",
    });
    if (result.isErr()) {
      const status = result.error instanceof UnauthorizedError ? 401 : 400;
      return c.json(
        {
          error:
            result.error instanceof UnauthorizedError
              ? "invalid_client"
              : "invalid_grant",
          error_description: result.error.message,
        },
        status,
      );
    }
    return c.json({
      access_token: result.value.accessToken,
      token_type: "Bearer",
      expires_in: result.value.expiresIn,
      refresh_token: result.value.refreshToken,
      ...(result.value.scope ? { scope: result.value.scope } : {}),
    });
  }

  if (grantType === "refresh_token") {
    const result = await mcpOauthServices.refreshAccessToken(log, {
      clientId,
      clientSecret,
      refreshToken: body["refresh_token"] ?? "",
    });
    if (result.isErr()) {
      const status = result.error instanceof UnauthorizedError ? 401 : 400;
      return c.json(
        {
          error:
            result.error instanceof UnauthorizedError
              ? "invalid_client"
              : "invalid_grant",
          error_description: result.error.message,
        },
        status,
      );
    }
    return c.json({
      access_token: result.value.accessToken,
      token_type: "Bearer",
      expires_in: result.value.expiresIn,
      refresh_token: result.value.refreshToken,
      ...(result.value.scope ? { scope: result.value.scope } : {}),
    });
  }

  return c.json(
    {
      error: "unsupported_grant_type",
      error_description:
        "Supported grant_type values: authorization_code, refresh_token",
    },
    400,
  );
}
