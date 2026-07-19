import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Role } from "./resource.js";

const list: RouteHandler<typeof Role.routes.list, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Role.services.list(log, auth.tenantId, query);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Role.routes.create, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Role.services.create(log, auth.tenantId, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Role.routes.get, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Role.services.get(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Role.routes.update, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Role.services.update(log, auth.tenantId, id, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Role.routes.delete, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Role.services.delete(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const attachTool: RouteHandler<typeof Role.routes.attachTool, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { toolId } = c.req.valid("json");
  const result = await Role.services.attachTool(log, auth.tenantId, id, toolId);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const setTools: RouteHandler<typeof Role.routes.setTools, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { toolIds } = c.req.valid("json");
  const result = await Role.services.setTools(log, auth.tenantId, id, toolIds);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const detachTool: RouteHandler<typeof Role.routes.detachTool, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id, toolId } = c.req.valid("param");
  const result = await Role.services.detachTool(log, auth.tenantId, id, toolId);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const roleHandlers = {
  list,
  create,
  get,
  update,
  delete: remove,
  attachTool,
  setTools,
  detachTool,
} as const;
