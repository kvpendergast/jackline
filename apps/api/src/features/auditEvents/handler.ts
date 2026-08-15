import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { AuditEvent } from "./resource.js";

const list: RouteHandler<typeof AuditEvent.routes.list, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await AuditEvent.services.list(log, auth.tenantId, query);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const get: RouteHandler<typeof AuditEvent.routes.get, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await AuditEvent.services.get(log, auth.tenantId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const auditEventHandlers = {
  list,
  get,
} as const;
