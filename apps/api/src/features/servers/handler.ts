import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireTenantContext } from "../../lib/request/index.js";
import {
  createServerRoute,
  deleteServerRoute,
  getServerRoute,
  listServersRoute,
  updateServerRoute,
} from "./route.js";
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  updateServer,
} from "./service.js";

export const listServersRouteHandler: RouteHandler<
  typeof listServersRoute,
  MeshEnv
> = async (c) => {
  const ctxResult = await requireTenantContext(c);
  if (ctxResult.isErr()) {
    throw ctxResult.error;
  }

  const { auth, log } = ctxResult.value;
  const query = c.req.valid("query");
  const result = await listServers(log, auth.tenantId, query);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const createServerRouteHandler: RouteHandler<
  typeof createServerRoute,
  MeshEnv
> = async (c) => {
  const ctxResult = await requireTenantContext(c, { requireFullAdmin: true });
  if (ctxResult.isErr()) {
    throw ctxResult.error;
  }

  const { auth, log } = ctxResult.value;
  const body = c.req.valid("json");
  const result = await createServer(log, auth.tenantId, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

export const getServerRouteHandler: RouteHandler<
  typeof getServerRoute,
  MeshEnv
> = async (c) => {
  const ctxResult = await requireTenantContext(c);
  if (ctxResult.isErr()) {
    throw ctxResult.error;
  }

  const { auth, log } = ctxResult.value;
  const { id } = c.req.valid("param");
  const result = await getServer(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const updateServerRouteHandler: RouteHandler<
  typeof updateServerRoute,
  MeshEnv
> = async (c) => {
  const ctxResult = await requireTenantContext(c, { requireFullAdmin: true });
  if (ctxResult.isErr()) {
    throw ctxResult.error;
  }

  const { auth, log } = ctxResult.value;
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await updateServer(log, auth.tenantId, id, body);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const deleteServerRouteHandler: RouteHandler<
  typeof deleteServerRoute,
  MeshEnv
> = async (c) => {
  const ctxResult = await requireTenantContext(c, { requireFullAdmin: true });
  if (ctxResult.isErr()) {
    throw ctxResult.error;
  }

  const { auth, log } = ctxResult.value;
  const { id } = c.req.valid("param");
  const result = await deleteServer(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};
