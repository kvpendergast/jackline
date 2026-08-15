import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Server } from "./resource.js";

const list: RouteHandler<typeof Server.routes.list, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Server.services.list(log, auth.tenantId, query);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Server.routes.create, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Server.services.create(log, auth.tenantId, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Server.routes.get, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Server.services.get(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Server.routes.update, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Server.services.update(log, auth.tenantId, id, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Server.routes.delete, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Server.services.delete(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const syncTools: RouteHandler<typeof Server.routes.syncTools, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Server.services.syncTools(
    log,
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const serverHandlers = {
  list,
  create,
  get,
  update,
  syncTools,
  delete: remove,
} as const;
