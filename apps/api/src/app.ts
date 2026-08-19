import { cors } from "hono/cors";
import { auth } from "@jackline/auth";
import { getConfig, webTrustedOrigins } from "@jackline/shared";
import { createJacklineApp } from "./lib/http/createApp.js";
import {
  requestMiddleware,
  tenantContextMiddleware,
} from "./lib/request/index.js";
import { scimApp } from "./features/identity/scim.js";
import { oauthCallbackHandler } from "./features/oauth/handler.js";
import { oauthTokenHandler } from "./features/clients/tokenHandler.js";
import {
  mcpOauthAsMetadataHandler,
  mcpOauthAuthorizeGetHandler,
  mcpOauthAuthorizePostHandler,
  mcpOauthProtectedResourceHandler,
  mcpOauthTokenHandler,
} from "./features/mcpOauth/asHandlers.js";
import { oauthTokenRoute } from "./features/clients/tokenRoute.js";
import {
  publicV1Features,
  rootFeatures,
  tenantV1Features,
} from "./registry.js";

const configResult = getConfig();
if (configResult.isErr()) throw configResult.error;
const config = configResult.value;
const trustedWebOrigins = webTrustedOrigins(config);

export const app = createJacklineApp();

app.use(
  "*",
  cors({
    origin: trustedWebOrigins,
    credentials: true,
  }),
);

app.use("*", requestMiddleware);

app.get("/.well-known/oauth-authorization-server", mcpOauthAsMetadataHandler);
app.get("/.well-known/oauth-protected-resource", mcpOauthProtectedResourceHandler);

for (const feature of rootFeatures) {
  for (const { route, handler } of feature.routes) {
    app.openapi(route, handler);
  }
}

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.route("/scim/v2", scimApp);

const v1 = createJacklineApp();

/** Browser OAuth redirect — must stay outside tenant middleware. */
v1.get("/oauth/callback", oauthCallbackHandler);

/**
 * OAuth2 client_credentials token endpoint — public (client secret auth).
 * Registered with plain post so form-urlencoded + Basic auth are not run
 * through the JSON OpenAPI validation hook; path is registered for /docs.
 */
v1.post("/oauth/token", oauthTokenHandler);
v1.openAPIRegistry.registerPath(oauthTokenRoute);

/** MCP Authorization Server (Cursor/Claude) — distinct from Admin API token. */
v1.get("/mcp/oauth/authorize", mcpOauthAuthorizeGetHandler);
v1.post("/mcp/oauth/authorize", mcpOauthAuthorizePostHandler);
v1.post("/mcp/oauth/token", mcpOauthTokenHandler);

for (const feature of publicV1Features) {
  for (const { route, handler } of feature.routes) {
    v1.openapi(route, handler);
  }
}

const tenantV1 = createJacklineApp();
tenantV1.use("*", tenantContextMiddleware);
for (const feature of tenantV1Features) {
  for (const { route, handler } of feature.routes) {
    tenantV1.openapi(route, handler);
  }
}
v1.route("/", tenantV1);

app.route("/api/v1", v1);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Opaque",
  description:
    "OAuth2 access token from POST /api/v1/oauth/token (client_credentials).",
});

app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "Browser session cookie from Better Auth (admin UI).",
});

app.doc("/docs", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Jackline API",
    description:
      "Jackline control-plane API. Authenticate with a browser session cookie (admin UI) or an OAuth2 client_credentials access token (public/machine API).",
  },
  servers: [
    {
      url: "http://127.0.0.1:8080",
      description: "Local development",
    },
  ],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
});
