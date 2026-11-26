import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { myAccessRoutes } from "./route.js";
import { myAccessServices } from "./service.js";

const listMyServers: RouteHandler<
  typeof myAccessRoutes.listMyServers,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await myAccessServices.listMyServers(
    log,
    auth.tenantId,
    auth.userId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const upsertMyCredential: RouteHandler<
  typeof myAccessRoutes.upsertMyCredential,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { serverId } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await myAccessServices.upsertMyCredential(
    log,
    auth.tenantId,
    auth.userId,
    serverId,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const deleteMyCredential: RouteHandler<
  typeof myAccessRoutes.deleteMyCredential,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { serverId } = c.req.valid("param");
  const result = await myAccessServices.deleteMyCredential(
    log,
    auth.tenantId,
    auth.userId,
    serverId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const renameAccount: RouteHandler<
  typeof myAccessRoutes.renameAccount,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { accountId } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await myAccessServices.renameAccount(
    log,
    auth.tenantId,
    auth.userId,
    accountId,
    body.label,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const makeDefaultAccount: RouteHandler<
  typeof myAccessRoutes.makeDefaultAccount,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { accountId } = c.req.valid("param");
  const result = await myAccessServices.makeDefaultAccount(
    log,
    auth.tenantId,
    auth.userId,
    accountId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const deleteAccount: RouteHandler<
  typeof myAccessRoutes.deleteAccount,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { accountId } = c.req.valid("param");
  const result = await myAccessServices.deleteAccount(
    log,
    auth.tenantId,
    auth.userId,
    accountId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const myAccessHandlers = {
  listMyServers,
  upsertMyCredential,
  deleteMyCredential,
  renameAccount,
  makeDefaultAccount,
  deleteAccount,
} as const;
