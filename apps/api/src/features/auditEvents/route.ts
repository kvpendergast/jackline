import { createRoute, z } from "@hono/zod-openapi";
import {
  AuditOutcomeSchema,
  cursorPageSchema,
  PublicAuditEventSchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const AuditEventIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
  })
  .openapi("AuditEventIdParam");

const ListAuditEventsQuerySchema = PaginationQuerySchema.extend({
  connectionId: z.uuid().optional().openapi({
    param: { name: "connectionId", in: "query" },
  }),
  clientId: z.uuid().optional().openapi({
    param: { name: "clientId", in: "query" },
  }),
  userId: z.string().min(1).optional().openapi({
    param: { name: "userId", in: "query" },
  }),
  toolId: z.uuid().optional().openapi({
    param: { name: "toolId", in: "query" },
  }),
  serverId: z.uuid().optional().openapi({
    param: { name: "serverId", in: "query" },
  }),
  outcome: AuditOutcomeSchema.optional().openapi({
    param: { name: "outcome", in: "query" },
  }),
}).openapi("ListAuditEventsQuery");

const AuditEventResponseSchema = successEnvelopeSchema(
  PublicAuditEventSchema,
  "AuditEventResponse",
);

const AuditEventListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicAuditEventSchema),
  "AuditEventListResponse",
);

const list = createRoute({
  method: "get",
  path: "/audit-events",
  tags: ["Audit"],
  summary: "List gateway audit events for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListAuditEventsQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of audit events (newest first)",
      content: {
        "application/json": { schema: AuditEventListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/audit-events/{id}",
  tags: ["Audit"],
  summary: "Get an audit event",
  request: {
    headers: TenantIdHeaderSchema,
    params: AuditEventIdParamSchema,
  },
  responses: {
    200: {
      description: "Audit event",
      content: {
        "application/json": { schema: AuditEventResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Audit event not found"),
  },
});

export const auditEventRoutes = {
  list,
  get,
} as const;
