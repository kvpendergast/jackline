import { createRoute, z } from "@hono/zod-openapi";
import {
  PublicChatSessionSchema,
  PublicChatSettingsSchema,
  UpdateChatSettingsBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import { tenantScopedErrors } from "../../lib/http/errorResponses.js";
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
  run,
} as const;
