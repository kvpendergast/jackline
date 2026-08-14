import { Hono } from "hono";
import { verifyGatewayAuthorization } from "../lib/gatewayAuth.js";
import { getMeshPaths, type MeshPaths } from "../lib/paths.js";
import { createSessionHub } from "../lib/mcp/sessionHub.js";

export function createApp(paths?: MeshPaths) {
  const app = new Hono();
  const meshPaths = paths ?? getMeshPaths();
  const hub = createSessionHub(meshPaths);

  app.get("/health", (c) => c.json({ ok: true, mode: "personal" }));

  app.use("/mcp", async (c, next) => {
    const ok = await verifyGatewayAuthorization(
      c.req.header("Authorization"),
      meshPaths,
    );
    if (!ok) {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or missing gateway bearer token",
          },
        },
        401,
      );
    }
    return next();
  });

  app.all("/mcp", (c) => hub.handleRequest(c.req.raw));

  return app;
}

/** Default app using ~/.mesh — used by tests and simple imports. */
export const app = createApp();
