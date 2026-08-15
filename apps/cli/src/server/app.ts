import { Hono } from "hono";
import { verifyGatewayAuthorization } from "../lib/gatewayAuth.js";
import { getJacklinePaths, type JacklinePaths } from "../lib/paths.js";
import { createSessionHub } from "../lib/mcp/sessionHub.js";

export type JacklineCliApp = Hono & { close: () => void };

export function createApp(paths?: JacklinePaths): JacklineCliApp {
  const app = new Hono();
  const jacklinePaths = paths ?? getJacklinePaths();
  const hub = createSessionHub(jacklinePaths);

  app.get("/health", (c) => c.json({ ok: true, mode: "personal" }));

  app.use("/mcp", async (c, next) => {
    const ok = await verifyGatewayAuthorization(
      c.req.header("Authorization"),
      jacklinePaths,
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

  return Object.assign(app, {
    close(): void {
      hub.close();
    },
  });
}
