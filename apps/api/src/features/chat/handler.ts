import { chat, chatParamsFromRequestBody, toServerSentEventsResponse } from "@tanstack/ai";
import type { RouteHandler } from "@hono/zod-openapi";
import { BadRequestError, SetupError } from "@jackline/shared";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { createChatAdapter } from "./adapter.js";
import { connectJacklineMcpTools } from "./mcpTools.js";
import { chatRoutes } from "./route.js";
import { chatServices } from "./service.js";
import { chatThreadServices } from "./threads.js";

const getSession: RouteHandler<typeof chatRoutes.getSession, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const result = await chatServices.getSession(log, auth.tenantId, auth.userId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const getSettings: RouteHandler<typeof chatRoutes.getSettings, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const result = await chatServices.getSettings(log, auth.tenantId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const updateSettings: RouteHandler<
  typeof chatRoutes.updateSettings,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await chatServices.updateSettings(
    log,
    auth.tenantId,
    { userId: auth.userId, role: auth.membership.role },
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listThreads: RouteHandler<
  typeof chatRoutes.listThreads,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await chatThreadServices.list(
    log,
    auth.tenantId,
    auth.userId,
    query,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const createThread: RouteHandler<
  typeof chatRoutes.createThread,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const result = await chatThreadServices.create(
    log,
    auth.tenantId,
    auth.userId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const getThread: RouteHandler<typeof chatRoutes.getThread, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await chatThreadServices.get(
    log,
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const updateThread: RouteHandler<
  typeof chatRoutes.updateThread,
  JacklineEnv
> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await chatThreadServices.update(
    log,
    auth.tenantId,
    auth.userId,
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const run: RouteHandler<typeof chatRoutes.run, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const rawBody = c.req.valid("json");

  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(rawBody);
  } catch (cause) {
    if (cause instanceof Response) {
      throw new BadRequestError("Invalid chat request");
    }
    const message =
      cause instanceof Error ? cause.message : "Invalid chat request";
    throw new BadRequestError(message);
  }

  const resolved = await chatServices.resolveRun(
    log,
    auth.tenantId,
    auth.userId,
  );
  if (resolved.isErr()) throw resolved.error;

  const adapterResult = createChatAdapter(resolved.value.adapterInput);
  if (adapterResult.isErr()) throw adapterResult.error;

  const mcp = await connectJacklineMcpTools(
    resolved.value.mcpUrl,
    resolved.value.gatewayToken,
  );
  if (mcp.isErr()) throw mcp.error;

  const { reasoningEffort, reasoningSummary, ...adapterFields } =
    resolved.value.adapterInput;
  void adapterFields;

  const modelOptions: Record<string, unknown> = {};
  if (reasoningEffort && reasoningEffort !== "none") {
    modelOptions["reasoning"] = {
      effort: reasoningEffort,
      ...(reasoningSummary ? { summary: reasoningSummary } : {}),
    };
  }

  try {
    const stream = chat({
      adapter: adapterResult.value as never,
      messages: params.messages as never,
      threadId: params.threadId,
      runId: params.runId,
      tools: mcp.value.tools as never,
      ...(Object.keys(modelOptions).length > 0
        ? { modelOptions: modelOptions as never }
        : {}),
    });

    const abortController = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => {
      abortController.abort();
      void mcp.value.close();
    });
    const sse = toServerSentEventsResponse(stream, { abortController });
    if (!sse.body) {
      void mcp.value.close();
      return sse;
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    void sse.body
      .pipeTo(writable)
      .catch(() => undefined)
      .finally(() => {
        void mcp.value.close();
      });
    return new Response(readable, sse);
  } catch (cause) {
    await mcp.value.close().catch(() => undefined);
    const message =
      cause instanceof Error ? cause.message : "Chat run failed";
    throw new SetupError(message);
  }
};

export const chatHandlers = {
  getSession,
  getSettings,
  updateSettings,
  listThreads,
  createThread,
  getThread,
  updateThread,
  run,
} as const;
