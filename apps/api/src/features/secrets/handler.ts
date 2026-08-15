import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Secret } from "./resource.js";

const list: RouteHandler<typeof Secret.routes.list, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Secret.services.list(log, auth.tenantId, query);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Secret.routes.create, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Secret.services.create(log, auth.tenantId, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Secret.routes.get, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Secret.services.get(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const reveal: RouteHandler<typeof Secret.routes.reveal, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Secret.services.reveal(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Secret.routes.update, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Secret.services.update(log, auth.tenantId, id, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Secret.routes.delete, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Secret.services.delete(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const secretHandlers = {
  list,
  create,
  get,
  reveal,
  update,
  delete: remove,
} as const;
