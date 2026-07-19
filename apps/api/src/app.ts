import { cors } from "hono/cors";
import { auth } from "@mesh/auth";
import { getConfig } from "@mesh/shared";
import { createMeshApp } from "./lib/http/createApp.js";
import { requestMiddleware } from "./lib/request/index.js";
import { rootFeatures, v1Features } from "./registry.js";

const configResult = getConfig();
if (configResult.isErr()) throw configResult.error;
const config = configResult.value;

export const app = createMeshApp();

app.use(
  "*",
  cors({
    origin: config.WEB_ORIGIN,
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

const v1 = createMeshApp();
for (const feature of v1Features) {
  for (const { route, handler } of feature.routes) {
    v1.openapi(route, handler);
  }
}
app.route("/api/v1", v1);

app.doc("/docs", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Mesh API",
  },
});
