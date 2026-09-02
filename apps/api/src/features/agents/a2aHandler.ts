import type { Context } from "hono";
import {
  buildAgentCard,
  decideA2aAuth,
  getConfig,
  JACKLINE_TRUST_REQUEST_INTENT,
  publicApiBaseUrl,
} from "@jackline/shared";
import type { JacklineEnv } from "../../lib/http/env.js";
import { agentServices } from "./service.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function jsonRpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, data },
  };
}

function extractKnockPayload(params: Record<string, unknown> | undefined): {
  peerAgentCardUrl: string;
  peerDisplayName?: string;
  message: string;
  intent?: string;
} | null {
  if (!params) return null;
  const message = params["message"] as Record<string, unknown> | undefined;
  const parts = message?.["parts"] as Array<Record<string, unknown>> | undefined;
  const textPart = parts?.find((p) => p["kind"] === "text");
  const text = textPart?.["text"];
  if (typeof text !== "string") return null;

  const metadata = message?.["metadata"] as Record<string, unknown> | undefined;
  const intent =
    typeof metadata?.["intent"] === "string" ? metadata["intent"] : undefined;
  const peerAgentCardUrl =
    typeof params["peerAgentCardUrl"] === "string"
      ? params["peerAgentCardUrl"]
      : typeof metadata?.["peerAgentCardUrl"] === "string"
        ? metadata["peerAgentCardUrl"]
        : null;
  if (!peerAgentCardUrl) return null;

  const peerDisplayName =
    typeof params["peerDisplayName"] === "string"
      ? params["peerDisplayName"]
      : typeof metadata?.["peerDisplayName"] === "string"
        ? metadata["peerDisplayName"]
        : undefined;

  return {
    peerAgentCardUrl,
    ...(peerDisplayName !== undefined ? { peerDisplayName } : {}),
    message: text,
    ...(intent !== undefined ? { intent } : {}),
  };
}

export async function agentCardHandler(c: Context<JacklineEnv>) {
  const handle = c.req.param("handle");
  if (!handle) {
    return c.json({ error: "Agent not found" }, 404);
  }
  const result = await agentServices.getAgentByHandle(handle);
  if (result.isErr()) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const agent = result.value;
  const cfg = getConfig();
  if (cfg.isErr()) throw cfg.error;
  const base = publicApiBaseUrl(cfg.value);

  const card = buildAgentCard({
    handle: agent.handle,
    displayName: agent.displayName,
    description: agent.description,
    publicSkills: agent.publicSkills,
    knocksEnabled: agent.knocksEnabled,
    publicBaseUrl: base,
    status: agent.status,
  });

  c.header("Cache-Control", "public, max-age=60");
  return c.json(card);
}

export async function a2aIngressHandler(c: Context<JacklineEnv>) {
  const handle = c.req.param("handle");
  if (!handle) {
    return c.json(jsonRpcError(null, -32001, "Agent not found"), 404);
  }
  const { log } = c.get("requestContext");

  const agentResult = await agentServices.getAgentByHandle(handle);
  if (agentResult.isErr()) {
    return c.json(jsonRpcError(null, -32001, "Agent not found"), 404);
  }
  const agent = agentResult.value;

  let body: JsonRpcRequest;
  try {
    body = await c.req.json<JsonRpcRequest>();
  } catch {
    return c.json(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  const grantResult = await agentServices.resolvePeerGrant(
    c.req.header("Authorization"),
    agent.id,
    log,
  );
  const hasValidGrant = grantResult.isOk();

  const knockPayload =
    body.method === "message/send" ? extractKnockPayload(body.params) : null;
  const isKnockIntent =
    knockPayload?.intent === JACKLINE_TRUST_REQUEST_INTENT ||
    knockPayload?.intent === undefined;

  const decision = decideA2aAuth({
    agentStatus: agent.status,
    knocksEnabled: agent.knocksEnabled,
    method: body.method,
    hasValidGrant,
    ...(grantResult.isOk() ? { trustGrantId: grantResult.value.grantId } : {}),
    isKnockIntent: Boolean(knockPayload && isKnockIntent),
  });

  if (decision.action === "deny") {
    const status = agent.status === "paused" ? 503 : 401;
    return c.json(
      jsonRpcError(body.id, -32000, decision.reason),
      status,
    );
  }

  if (decision.action === "knock_only") {
    if (!knockPayload) {
      return c.json(jsonRpcError(body.id, -32000, "Invalid knock payload"), 400);
    }
    const knockResult = await agentServices.createKnock({
      agent,
      peerAgentCardUrl: knockPayload.peerAgentCardUrl,
      ...(knockPayload.peerDisplayName !== undefined
        ? { peerDisplayName: knockPayload.peerDisplayName }
        : {}),
      message: knockPayload.message,
    });
    if (knockResult.isErr()) {
      return c.json(
        jsonRpcError(body.id, -32000, knockResult.error.message),
        400,
      );
    }
    const { knockId, taskId, knockSecret } = knockResult.value;
    return c.json(
      jsonRpcResult(body.id, {
        taskId,
        state: "input_required",
        knockId,
        knockSecret,
      }),
    );
  }

  if (body.method === "message/send" && knockPayload) {
    return c.json(
      jsonRpcResult(body.id, {
        state: "completed",
        message: "Message received",
        skill: "contact.leave_message",
      }),
    );
  }

  if (body.method === "tasks/get") {
    const taskId = body.params?.["taskId"];
    return c.json(
      jsonRpcResult(body.id, {
        taskId,
        state: "input_required",
      }),
    );
  }

  return c.json(
    jsonRpcResult(body.id, {
      state: "completed",
      message: "OK",
    }),
  );
}
