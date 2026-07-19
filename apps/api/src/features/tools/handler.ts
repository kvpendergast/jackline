import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import {
  createToolRoute,
  deleteToolRoute,
  getToolRoute,
  listToolsRoute,
  updateToolRoute,
} from "./route.js";
import {
  createTool,
  deleteTool,
  getTool,
  listTools,
  updateTool,
} from "./service.js";

export const listToolsRouteHandler: RouteHandler<
  typeof listToolsRoute,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await listTools(log, auth.tenantId, query);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const createToolRouteHandler: RouteHandler<
  typeof createToolRoute,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await createTool(log, auth.tenantId, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

export const getToolRouteHandler: RouteHandler<
  typeof getToolRoute,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await getTool(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const updateToolRouteHandler: RouteHandler<
  typeof updateToolRoute,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await updateTool(log, auth.tenantId, id, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const deleteToolRouteHandler: RouteHandler<
  typeof deleteToolRoute,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await deleteTool(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};
