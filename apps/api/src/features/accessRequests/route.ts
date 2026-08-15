import { createRoute, z } from "@hono/zod-openapi";
import {
  AccessRequestStatusSchema,
  CreateAccessRequestBodySchema,
  DecideAccessRequestBodySchema,
  DenyAccessRequestBodySchema,
  PublicAccessRequestSchema,
  PublicNotificationSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { requireAdmin } from "../../lib/request/requireAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const AccessRequestIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("AccessRequestIdParam");

const NotificationIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
  })
  .openapi("NotificationIdParam");

const AccessRequestResponseSchema = successEnvelopeSchema(
  PublicAccessRequestSchema,
  "AccessRequestResponse",
);

const AccessRequestListResponseSchema = successEnvelopeSchema(
  z.strictObject({ items: z.array(PublicAccessRequestSchema) }),
  "AccessRequestListResponse",
);

const AttachAutoToolsBodySchema = z
  .strictObject({
    connectionId: z.uuid(),
    serverId: z.uuid(),
  })
  .openapi("AttachAutoToolsBody");

const AttachAutoToolsResponseSchema = successEnvelopeSchema(
  z.strictObject({ attachedToolIds: z.array(z.uuid()) }),
  "AttachAutoToolsResponse",
);

const NotificationListResponseSchema = successEnvelopeSchema(
  z.strictObject({
    items: z.array(PublicNotificationSchema),
    unreadCount: z.number().int().nonnegative(),
  }),
  "NotificationListResponse",
);

const NotificationResponseSchema = successEnvelopeSchema(
  PublicNotificationSchema,
  "NotificationResponse",
);

const list = createRoute({
  method: "get",
  path: "/access-requests",
  tags: ["AccessRequests"],
  summary: "List access requests (own for members; team/tenant for admins)",
  request: {
    headers: TenantIdHeaderSchema,
    query: z
      .object({
        status: AccessRequestStatusSchema.optional().openapi({
          param: { name: "status", in: "query" },
        }),
      })
      .openapi("ListAccessRequestsQuery"),
  },
  responses: {
    200: {
      description: "Access requests",
      content: {
        "application/json": { schema: AccessRequestListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/access-requests",
  tags: ["AccessRequests"],
  summary: "Request access to a gated server for your connection",
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: {
        "application/json": { schema: CreateAccessRequestBodySchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Access request created",
      content: {
        "application/json": { schema: AccessRequestResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const attachAuto = createRoute({
  method: "post",
  path: "/access-requests/attach-auto",
  tags: ["AccessRequests"],
  summary: "Attach auto-allowed tools from a server that does not require approval",
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: AttachAutoToolsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Tools attached",
      content: {
        "application/json": { schema: AttachAutoToolsResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const approve = createRoute({
  method: "post",
  path: "/access-requests/{id}/approve",
  tags: ["AccessRequests"],
  summary: "Approve an access request (all tools or a selected subset)",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: AccessRequestIdParamSchema,
    body: {
      content: {
        "application/json": { schema: DecideAccessRequestBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Request approved",
      content: {
        "application/json": { schema: AccessRequestResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Access request not found"),
  },
});

const deny = createRoute({
  method: "post",
  path: "/access-requests/{id}/deny",
  tags: ["AccessRequests"],
  summary: "Deny an access request",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: AccessRequestIdParamSchema,
    body: {
      content: { "application/json": { schema: DenyAccessRequestBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Request denied",
      content: {
        "application/json": { schema: AccessRequestResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Access request not found"),
  },
});

const cancel = createRoute({
  method: "post",
  path: "/access-requests/{id}/cancel",
  tags: ["AccessRequests"],
  summary: "Cancel your pending access request",
  request: {
    headers: TenantIdHeaderSchema,
    params: AccessRequestIdParamSchema,
  },
  responses: {
    200: {
      description: "Request cancelled",
      content: {
        "application/json": { schema: AccessRequestResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Access request not found"),
  },
});

const listNotifications = createRoute({
  method: "get",
  path: "/notifications",
  tags: ["Notifications"],
  summary: "List in-app notifications for the current user",
  request: {
    headers: TenantIdHeaderSchema,
  },
  responses: {
    200: {
      description: "Notifications",
      content: {
        "application/json": { schema: NotificationListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const markNotificationRead = createRoute({
  method: "post",
  path: "/notifications/{id}/read",
  tags: ["Notifications"],
  summary: "Mark a notification as read",
  request: {
    headers: TenantIdHeaderSchema,
    params: NotificationIdParamSchema,
  },
  responses: {
    200: {
      description: "Notification updated",
      content: {
        "application/json": { schema: NotificationResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Notification not found"),
  },
});

const markAllNotificationsRead = createRoute({
  method: "post",
  path: "/notifications/read-all",
  tags: ["Notifications"],
  summary: "Mark all notifications as read",
  request: {
    headers: TenantIdHeaderSchema,
  },
  responses: {
    200: {
      description: "Updated count",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            z.strictObject({ updated: z.number().int().nonnegative() }),
            "MarkAllNotificationsReadResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
  },
});

export const accessRequestRoutes = {
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
