import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { OAuthApp } from "./resource.js";

const list: RouteHandler<typeof OAuthApp.routes.list, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await OAuthApp.services.list(log, auth.tenantId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof OAuthApp.routes.create, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await OAuthApp.services.create(log, auth.tenantId, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const createFromServer: RouteHandler<
  typeof OAuthApp.routes.createFromServer,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await OAuthApp.services.createFromServer(log, auth.tenantId, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof OAuthApp.routes.get, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await OAuthApp.services.get(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof OAuthApp.routes.update, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await OAuthApp.services.update(log, auth.tenantId, id, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof OAuthApp.routes.delete, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { detach } = c.req.valid("query");
  const result = await OAuthApp.services.delete(log, auth.tenantId, id, {
    detach: detach === "true",
  });
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const oauthAppHandlers = {
  list,
  create,
  createFromServer,
  get,
  update,
  delete: remove,
} as const;
