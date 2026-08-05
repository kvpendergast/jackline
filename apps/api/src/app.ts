import { cors } from "hono/cors";
import { auth } from "@mesh/auth";
import { getConfig, webTrustedOrigins } from "@mesh/shared";
import { createMeshApp } from "./lib/http/createApp.js";
import {
  requestMiddleware,
  tenantContextMiddleware,
} from "./lib/request/index.js";
import { scimApp } from "./features/identity/scim.js";
import { oauthCallbackHandler } from "./features/oauth/handler.js";
import {
  publicV1Features,
  rootFeatures,
  tenantV1Features,
} from "./registry.js";

const configResult = getConfig();
if (configResult.isErr()) throw configResult.error;
const config = configResult.value;
const trustedWebOrigins = webTrustedOrigins(config);

export const app = createMeshApp();

app.use(
  "*",
  cors({
    origin: trustedWebOrigins,
    credentials: true,
  }),
);

app.use("*", requestMiddleware);

for (const feature of rootFeatures) {
  for (const { route, handler } of feature.routes) {
    app.openapi(route, handler);
  }
}

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.route("/scim/v2", scimApp);

const v1 = createMeshApp();

/** Browser OAuth redirect — must stay outside tenant middleware. */
v1.get("/oauth/callback", oauthCallbackHandler);

for (const feature of publicV1Features) {
  for (const { route, handler } of feature.routes) {
    v1.openapi(route, handler);
  }
}

const tenantV1 = createMeshApp();
tenantV1.use("*", tenantContextMiddleware);
for (const feature of tenantV1Features) {
  for (const { route, handler } of feature.routes) {
    tenantV1.openapi(route, handler);
  }
}
v1.route("/", tenantV1);

app.route("/api/v1", v1);

app.doc("/docs", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Mesh API",
  },
});
