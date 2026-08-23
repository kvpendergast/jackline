import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { mcpOauthRoutes } from "./route.js";
import { mcpOauthServices } from "./service.js";

function actorFrom(auth: JacklineEnv["Variables"]["tenantContext"]["auth"]) {
  return {
    userId: auth.userId,
    role: auth.membership.role,
    team: auth.membership.team,
  };
}

const createClient: RouteHandler<
  typeof mcpOauthRoutes.createClient,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await mcpOauthServices.createClient(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const listClients: RouteHandler<
  typeof mcpOauthRoutes.listClients,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await mcpOauthServices.listClients(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const getClient: RouteHandler<
  typeof mcpOauthRoutes.getClient,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, clientId } = c.req.valid("param");
  const result = await mcpOauthServices.getClient(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    clientId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const updateRedirects: RouteHandler<
  typeof mcpOauthRoutes.updateRedirects,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, clientId } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await mcpOauthServices.updateRedirects(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    clientId,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const rotateSecret: RouteHandler<
  typeof mcpOauthRoutes.rotateSecret,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, clientId } = c.req.valid("param");
  const result = await mcpOauthServices.rotateClientSecret(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    clientId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const revokeClient: RouteHandler<
  typeof mcpOauthRoutes.revokeClient,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, clientId } = c.req.valid("param");
  const result = await mcpOauthServices.revokeClient(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    clientId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const revokeSessions: RouteHandler<
  typeof mcpOauthRoutes.revokeSessions,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id, clientId } = c.req.valid("param");
  const result = await mcpOauthServices.revokeClientSessions(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    clientId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const mcpOauthHandlers = {
  createClient,
  listClients,
  getClient,
  updateRedirects,
  rotateSecret,
  revokeClient,
  revokeSessions,
};
