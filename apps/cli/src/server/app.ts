import { Hono } from "hono";
import { getMeshPaths, type MeshPaths } from "../lib/paths.js";
import { createSessionHub } from "../lib/mcp/sessionHub.js";

export function createApp(paths?: MeshPaths) {
  const app = new Hono();
  const meshPaths = paths ?? getMeshPaths();
  const hub = createSessionHub(meshPaths);

  app.get("/health", (c) => c.json({ ok: true, mode: "personal" }));

  app.all("/mcp", (c) => hub.handleRequest(c.req.raw));

  return app;
}

/** Default app using ~/.mesh — used by tests and simple imports. */
export const app = createApp();
