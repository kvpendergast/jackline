import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { myAccessServices } from "../myAccess/service.js";
import { listEffectiveTools as listEffectiveToolsService } from "./effectiveTools.js";
import { Connection } from "./resource.js";

function actorFrom(auth: MeshEnv["Variables"]["tenantContext"]["auth"]) {
  return {
    userId: auth.userId,
    role: auth.membership.role,
    team: auth.membership.team,
  };
}

const list: RouteHandler<typeof Connection.routes.list, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await Connection.services.list(
    log,
    auth.tenantId,
    actorFrom(auth),
    query,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof Connection.routes.create, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await Connection.services.create(
    log,
    auth.tenantId,
    actorFrom(auth),
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof Connection.routes.get, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Connection.services.get(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listEffectiveTools: RouteHandler<
  typeof Connection.routes.listEffectiveTools,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await listEffectiveToolsService(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope({ items: result.value }), 200);
};

const listUpstreamCredentials: RouteHandler<
  typeof Connection.routes.listUpstreamCredentials,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const connection = await Connection.services.get(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (connection.isErr()) throw connection.error;

  const result = await myAccessServices.listUpstreamCredentialsForSubject(
    log,
    auth.tenantId,
    connection.value.userId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof Connection.routes.update, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Connection.services.update(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const remove: RouteHandler<typeof Connection.routes.delete, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Connection.services.delete(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
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
    actorFrom(auth),
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
    actorFrom(auth),
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
    actorFrom(auth),
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
    actorFrom(auth),
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
    actorFrom(auth),
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
    actorFrom(auth),
    id,
    toolId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const mintCredential: RouteHandler<
  typeof Connection.routes.mintCredential,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await Connection.services.mintCredential(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const listCredentials: RouteHandler<
  typeof Connection.routes.listCredentials,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await Connection.services.listCredentials(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const revokeCredential: RouteHandler<
  typeof Connection.routes.revokeCredential,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, secretId } = c.req.valid("param");
  const result = await Connection.services.revokeCredential(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    secretId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const setMemberToolEnabled: RouteHandler<
  typeof Connection.routes.setMemberToolEnabled,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, toolId } = c.req.valid("param");
  const { enabled } = c.req.valid("json");
  const result = await Connection.services.setMemberToolEnabled(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    toolId,
    enabled,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const connectionHandlers = {
  list,
  create,
  get,
  listEffectiveTools,
  listUpstreamCredentials,
  update,
  delete: remove,
  attachRole,
  setRoles,
  detachRole,
  attachToolOverride,
  setToolOverrides,
  detachToolOverride,
  mintCredential,
  listCredentials,
  revokeCredential,
  setMemberToolEnabled,
} as const;
