import type { RouteHandler } from "@hono/zod-openapi";
import type { MembershipRole } from "@mesh/shared";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/requireSession.js";
import { identityServices } from "./service.js";
import { identityRoutes } from "./route.js";

const getSso: RouteHandler<typeof identityRoutes.getSso, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await identityServices.getSso(log, auth.tenantId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const updateSso: RouteHandler<typeof identityRoutes.updateSso, MeshEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await identityServices.updateSso(log, auth.tenantId, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const rotateScim: RouteHandler<
  typeof identityRoutes.rotateScim,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await identityServices.rotateScimToken(log, auth.tenantId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listInvites: RouteHandler<
  typeof identityRoutes.listInvites,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await identityServices.listInvites(
    log,
    auth.tenantId,
    auth.membership.role as MembershipRole,
    auth.membership.team,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope({ items: result.value }), 200);
};

const createInvite: RouteHandler<
  typeof identityRoutes.createInvite,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await identityServices.createInvite(
    log,
    auth.tenantId,
    auth.userId,
    auth.membership.role as MembershipRole,
    auth.membership.team,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const listAdmins: RouteHandler<
  typeof identityRoutes.listAdmins,
  MeshEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await identityServices.listAdmins(
    log,
    auth.tenantId,
    auth.membership.role as MembershipRole,
    auth.membership.team,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope({ items: result.value }), 200);
};

const acceptInvite: RouteHandler<
  typeof identityRoutes.acceptInvite,
  MeshEnv
> = async (c) => {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) throw sessionResult.error;
  const { ctx, user } = sessionResult.value;
  const body = c.req.valid("json");
  const result = await identityServices.acceptInvite(
    ctx.log,
    user.id,
    user.email,
    body.token,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listLoginProviders: RouteHandler<
  typeof identityRoutes.listLoginProviders,
  MeshEnv
> = async (c) => {
  const log = c.get("requestContext").log;
  const result = await identityServices.listLoginProviders(log);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope({ items: result.value }), 200);
};

export const identityHandlers = {
  getSso,
  updateSso,
  rotateScim,
  listInvites,
  createInvite,
  listAdmins,
  acceptInvite,
  listLoginProviders,
} as const;
