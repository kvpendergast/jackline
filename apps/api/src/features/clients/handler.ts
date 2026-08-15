import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Client } from "./resource.js";

function actorFrom(auth: MeshEnv["Variables"]["tenantContext"]["auth"]) {
  return {
    userId: auth.userId,
    role: auth.membership.role,
    team: auth.membership.team,
  };
}

const list: RouteHandler<typeof Client.routes.list, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Client.services.list(
    log,
    auth.tenantId,
    actorFrom(auth),
    query,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Client.routes.create, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Client.services.create(
    log,
    auth.tenantId,
    actorFrom(auth),
    body,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Client.routes.get, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Client.services.get(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Client.routes.update, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Client.services.update(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Client.routes.delete, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Client.services.delete(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const rotateCredentials: RouteHandler<
  typeof Client.routes.rotateCredentials,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Client.services.rotateCredentials(
    log,
    auth.tenantId,
    id,
    body,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

const revokeCredentials: RouteHandler<
  typeof Client.routes.revokeCredentials,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Client.services.revokeCredentials(log, auth.tenantId, id);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const clientHandlers = {
  list,
  create,
  get,
  update,
  delete: remove,
  rotateCredentials,
  revokeCredentials,
} as const;
