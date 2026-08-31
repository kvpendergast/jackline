import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicChatSessionSchema,
  PublicChatSettingsSchema,
  PublicChatThreadSchema,
  PublicChatThreadSummarySchema,
  UpdateChatSettingsBodySchema,
  UpdateChatThreadBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const SessionResponseSchema = successEnvelopeSchema(
  PublicChatSessionSchema,
  "ChatSessionResponse",
);

const SettingsResponseSchema = successEnvelopeSchema(
  PublicChatSettingsSchema,
  "ChatSettingsResponse",
);

const ThreadResponseSchema = successEnvelopeSchema(
  PublicChatThreadSchema,
  "ChatThreadResponse",
);

const ThreadListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicChatThreadSummarySchema),
  "ChatThreadListResponse",
);

const ThreadIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
  })
  .openapi("ChatThreadIdParam");

const getSession = createRoute({
  method: "get",
  path: "/chat/session",
  tags: ["Chat"],
  summary: "Get this member's Jackline Chat connection and tool catalog",
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "Chat session",
      content: { "application/json": { schema: SessionResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const getSettings = createRoute({
  method: "get",
  path: "/chat/settings",
  tags: ["Chat"],
  summary: "Get Chat LLM settings",
  middleware: [requireFullAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "Chat settings",
      content: { "application/json": { schema: SettingsResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const updateSettings = createRoute({
  method: "put",
  path: "/chat/settings",
  tags: ["Chat"],
  summary: "Set Chat LLM provider, model, and API key",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: UpdateChatSettingsBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Updated Chat settings",
      content: { "application/json": { schema: SettingsResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const listThreads = createRoute({
  method: "get",
  path: "/chat/threads",
  tags: ["Chat"],
  summary: "List this member's Chat threads",
  request: {
    headers: TenantIdHeaderSchema,
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of Chat threads (newest activity first)",
      content: { "application/json": { schema: ThreadListResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const createThread = createRoute({
  method: "post",
  path: "/chat/threads",
  tags: ["Chat"],
  summary: "Start a new Chat thread",
  request: { headers: TenantIdHeaderSchema },
  responses: {
    201: {
      description: "Created Chat thread",
      content: { "application/json": { schema: ThreadResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const getThread = createRoute({
  method: "get",
  path: "/chat/threads/{id}",
  tags: ["Chat"],
  summary: "Get a Chat thread and its messages",
  request: {
    headers: TenantIdHeaderSchema,
    params: ThreadIdParamSchema,
  },
  responses: {
    200: {
      description: "Chat thread",
      content: { "application/json": { schema: ThreadResponseSchema } },
    },
    ...tenantScopedErrors,
    ...notFoundError("Chat not found"),
  },
});

const updateThread = createRoute({
  method: "patch",
  path: "/chat/threads/{id}",
  tags: ["Chat"],
  summary: "Save Chat thread messages or title",
  request: {
    headers: TenantIdHeaderSchema,
    params: ThreadIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateChatThreadBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Updated Chat thread",
      content: { "application/json": { schema: ThreadResponseSchema } },
    },
    ...tenantScopedErrors,
    ...notFoundError("Chat not found"),
  },
});

const run = createRoute({
  method: "post",
  path: "/chat",
  tags: ["Chat"],
  summary: "Run the in-product Chat agent (SSE AG-UI stream)",
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              messages: z.array(z.unknown()).optional(),
              threadId: z.string().optional(),
              runId: z.string().optional(),
            })
            .passthrough()
            .openapi("ChatRunBody"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "AG-UI server-sent events",
    },
    ...tenantScopedErrors,
  },
});

export const chatRoutes = {
  getSession,
  getSettings,
  updateSettings,
  listThreads,
  createThread,
  getThread,
  updateThread,
  run,
} as const;

