import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Connection } from "./resource.js";

const list: RouteHandler<typeof Connection.routes.list, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Connection.services.list(log, auth.tenantId, query);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Connection.routes.create, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Connection.services.create(log, auth.tenantId, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Connection.routes.get, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Connection.services.get(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Connection.routes.update, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Connection.services.update(log, auth.tenantId, id, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Connection.routes.delete, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Connection.services.delete(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const attachRole: RouteHandler<
  typeof Connection.routes.attachRole,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { roleId } = c.req.valid("json");
  const result = await Connection.services.attachRole(
    log,
    auth.tenantId,
    id,
    roleId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const setRoles: RouteHandler<
  typeof Connection.routes.setRoles,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { roleIds } = c.req.valid("json");
  const result = await Connection.services.setRoles(
    log,
    auth.tenantId,
    id,
    roleIds,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const detachRole: RouteHandler<
  typeof Connection.routes.detachRole,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, roleId } = c.req.valid("param");
  const result = await Connection.services.detachRole(
    log,
    auth.tenantId,
    id,
    roleId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const attachToolOverride: RouteHandler<
  typeof Connection.routes.attachToolOverride,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Connection.services.attachToolOverride(
    log,
    auth.tenantId,
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const setToolOverrides: RouteHandler<
  typeof Connection.routes.setToolOverrides,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { overrides } = c.req.valid("json");
  const result = await Connection.services.setToolOverrides(
    log,
    auth.tenantId,
    id,
    overrides,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const detachToolOverride: RouteHandler<
  typeof Connection.routes.detachToolOverride,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, toolId } = c.req.valid("param");
  const result = await Connection.services.detachToolOverride(
    log,
    auth.tenantId,
    id,
    toolId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const connectionHandlers = {
  list,
  create,
  get,
  update,
  delete: remove,
  attachRole,
  setRoles,
  detachRole,
  attachToolOverride,
  setToolOverrides,
  detachToolOverride,
} as const;
