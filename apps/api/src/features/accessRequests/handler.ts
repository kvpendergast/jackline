import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { accessRequestRoutes } from "./route.js";
import {
  accessRequestServices,
  notificationServices,
} from "./service.js";

function actorFrom(auth: JacklineEnv["Variables"]["tenantContext"]["auth"]) {
  return {
    userId: auth.userId,
    role: auth.membership.role,
    team: auth.membership.team,
  };
}

const list: RouteHandler<typeof accessRequestRoutes.list, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await accessRequestServices.list(
    log,
    auth.tenantId,
    actorFrom(auth),
    query,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof accessRequestRoutes.create, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await accessRequestServices.create(
    log,
    auth.tenantId,
    actorFrom(auth),
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const attachAuto: RouteHandler<
  typeof accessRequestRoutes.attachAuto,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await accessRequestServices.attachAutoAllowedTools(
    log,
    auth.tenantId,
    actorFrom(auth),
    body.connectionId,
    body.serverId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const approve: RouteHandler<
  typeof accessRequestRoutes.approve,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await accessRequestServices.approve(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const deny: RouteHandler<typeof accessRequestRoutes.deny, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await accessRequestServices.deny(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const cancel: RouteHandler<typeof accessRequestRoutes.cancel, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await accessRequestServices.cancel(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listNotifications: RouteHandler<
  typeof accessRequestRoutes.listNotifications,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await notificationServices.list(
    log,
    auth.tenantId,
    auth.userId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const markNotificationRead: RouteHandler<
  typeof accessRequestRoutes.markNotificationRead,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await notificationServices.markRead(
    log,
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const markAllNotificationsRead: RouteHandler<
  typeof accessRequestRoutes.markAllNotificationsRead,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await notificationServices.markAllRead(
    log,
    auth.tenantId,
    auth.userId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const accessRequestHandlers = {
  list,
  create,
  attachAuto,
  approve,
  deny,
  cancel,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} as const;
