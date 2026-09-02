import type { Context } from "hono";
import { NotFoundError } from "@jackline/shared";
import type { JacklineEnv } from "../../lib/http/env.js";
import { requireTenantContext } from "../../lib/request/requireTenantContext.js";
import { agentServices } from "./service.js";
import {
  jsonRpcError,
  jsonRpcResult,
  respondA2aError,
} from "./a2aBoundary.js";
import type { JsonRpcRequest } from "./a2aProtocol.js";

export async function agentCardHandler(c: Context<JacklineEnv>) {
  const handle = c.req.param("handle");
  if (!handle) throw new NotFoundError("Agent not found");

  const authResult = await requireTenantContext(c);
  if (authResult.isErr()) throw authResult.error;

  const result = await agentServices.buildAgentCardForHandle(handle);
  if (result.isErr()) throw result.error;

  c.header("Cache-Control", "public, max-age=60");
  return c.json(result.value);
}

export async function a2aIngressHandler(c: Context<JacklineEnv>) {
  const handle = c.req.param("handle");
  if (!handle) {
    return respondA2aError(c, null, new NotFoundError("Agent not found"));
  }

  let body: JsonRpcRequest;
  try {
    body = await c.req.json<JsonRpcRequest>();
  } catch {
    return c.json(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  const { log } = c.get("requestContext");
  const authResult = await requireTenantContext(c);
  const hasApiCredential = authResult.isOk();
  const result = await agentServices.processA2aJsonRpc({
    handle,
    authorization: c.req.header("Authorization"),
    body,
    log,
    hasApiCredential,
  });

  if (result.isErr()) {
    return respondA2aError(c, body.id, result.error);
  }

  return c.json(jsonRpcResult(result.value.id, result.value.result));
}
