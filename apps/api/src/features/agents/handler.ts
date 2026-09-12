import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { agentRoutes } from "./route.js";
import { agentServices } from "./service.js";

const list: RouteHandler<typeof agentRoutes.list, JacklineEnv> = async (c) => {
  const { auth } = c.get("tenantContext");
  const result = await agentServices.listAgents(auth.tenantId, auth.userId);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof agentRoutes.create, JacklineEnv> = async (
  c,
) => {
  const { auth } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await agentServices.createAgent(
    auth.tenantId,
    auth.userId,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof agentRoutes.get, JacklineEnv> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await agentServices.getAgent(auth.tenantId, auth.userId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<typeof agentRoutes.update, JacklineEnv> = async (
  c,
) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await agentServices.updateAgent(
    auth.tenantId,
    auth.userId,
    id,
    body,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const setTools: RouteHandler<typeof agentRoutes.setTools, JacklineEnv> = async (
  c,
) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const { toolIds } = c.req.valid("json");
  const result = await agentServices.setTools(
    log,
    auth.tenantId,
    auth.userId,
    id,
    toolIds,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const publish: RouteHandler<typeof agentRoutes.publish, JacklineEnv> = async (
  c,
) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await agentServices.publishAgent(
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const pause: RouteHandler<typeof agentRoutes.pause, JacklineEnv> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await agentServices.pauseAgent(auth.tenantId, auth.userId, id);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listKnocks: RouteHandler<typeof agentRoutes.listKnocks, JacklineEnv> =
  async (c) => {
    const { auth } = c.get("tenantContext");
    const { id } = c.req.valid("param");
    const result = await agentServices.listKnocks(
      auth.tenantId,
      auth.userId,
      id,
    );
    if (result.isErr()) throw result.error;
    return c.json(okEnvelope(result.value), 200);
  };

const approveKnock: RouteHandler<typeof agentRoutes.approveKnock, JacklineEnv> =
  async (c) => {
    const { auth } = c.get("tenantContext");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await agentServices.approveKnock(
      auth.tenantId,
      auth.userId,
      id,
      body,
    );
    if (result.isErr()) throw result.error;
    return c.json(okEnvelope(result.value), 200);
  };

const denyKnock: RouteHandler<typeof agentRoutes.denyKnock, JacklineEnv> =
  async (c) => {
    const { auth } = c.get("tenantContext");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await agentServices.denyKnock(
      auth.tenantId,
      auth.userId,
      id,
      body,
    );
    if (result.isErr()) throw result.error;
    return c.json(okEnvelope(result.value), 200);
  };

const listTrustGrants: RouteHandler<
  typeof agentRoutes.listTrustGrants,
  JacklineEnv
> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await agentServices.listTrustGrants(
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const listTranscript: RouteHandler<
  typeof agentRoutes.listTranscript,
  JacklineEnv
> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const query = c.req.valid("query");
  const result = await agentServices.listTranscript(
    auth.tenantId,
    auth.userId,
    id,
    query.peerAgentCardUrl,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const streamTranscript: RouteHandler<
  typeof agentRoutes.streamTranscript,
  JacklineEnv
> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const query = c.req.valid("query");
  const peerAgentCardUrl = query.peerAgentCardUrl;

  // Ownership check up front so we fail before opening the stream.
  const initial = await agentServices.listTranscript(
    auth.tenantId,
    auth.userId,
    id,
    peerAgentCardUrl,
  );
  if (initial.isErr()) throw initial.error;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("snapshot", initial.value);
      let lastFingerprint = JSON.stringify(
        initial.value.entries.map((e) => `${e.id}:${e.status}:${e.decisionNote}`),
      );

      const timer = setInterval(() => {
        void (async () => {
          if (closed) return;
          const next = await agentServices.listTranscript(
            auth.tenantId,
            auth.userId,
            id,
            peerAgentCardUrl,
          );
          if (next.isErr()) {
            send("error", { message: next.error.message });
            return;
          }
          const fingerprint = JSON.stringify(
            next.value.entries.map((e) => `${e.id}:${e.status}:${e.decisionNote}`),
          );
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            send("snapshot", next.value);
          } else {
            send("ping", { at: new Date().toISOString() });
          }
        })();
      }, 2000);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      c.req.raw.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};

const revokeTrustGrant: RouteHandler<
  typeof agentRoutes.revokeTrustGrant,
  JacklineEnv
> = async (c) => {
  const { auth } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await agentServices.revokeTrustGrant(
    auth.tenantId,
    auth.userId,
    id,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const directory: RouteHandler<typeof agentRoutes.directory, JacklineEnv> = async (
  c,
) => {
  const query = c.req.valid("query");
  const result = await agentServices.searchDirectory({
    ...(query.q !== undefined ? { q: query.q } : {}),
    ...(query.handle !== undefined ? { handle: query.handle } : {}),
    ...(query.skill !== undefined ? { skill: query.skill } : {}),
  });
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const agentRegistry: RouteHandler<typeof agentRoutes.agentRegistry, JacklineEnv> =
  async (c) => {
    const query = c.req.valid("query");
    const result = await agentServices.searchDirectory({
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.handle !== undefined ? { handle: query.handle } : {}),
      ...(query.skill !== undefined ? { skill: query.skill } : {}),
    });
    if (result.isErr()) throw result.error;
    return c.json(okEnvelope(result.value), 200);
  };

const exchangeTrustGrant: RouteHandler<
  typeof agentRoutes.exchangeTrustGrant,
  JacklineEnv
> = async (c) => {
  const body = c.req.valid("json");
  const result = await agentServices.exchangeTrustGrant(body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const agentHandlers = {
  list,
  create,
  get,
  update,
  setTools,
  publish,
  pause,
  listKnocks,
  approveKnock,
  denyKnock,
  listTrustGrants,
  listTranscript,
  streamTranscript,
  revokeTrustGrant,
  directory,
  agentRegistry,
  exchangeTrustGrant,
} as const;
