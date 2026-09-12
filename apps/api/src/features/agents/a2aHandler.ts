import type { Context } from "hono";
import {
  clientIpFromHeaders,
  enforceQuota,
} from "@jackline/quotas";
import { JacklineError, NotFoundError } from "@jackline/shared";
import type { JacklineEnv } from "../../lib/http/env.js";
import { getQuotaLimiter } from "../../lib/quotas.js";
import { requireTenantContext } from "../../lib/request/requireTenantContext.js";
import { agentServices } from "./service.js";
import {
  jsonRpcResult,
  respondA2aError,
  respondA2aParseError,
} from "./a2aBoundary.js";
import {
  extractKnockPayload,
  isKnockIntent,
  type JsonRpcRequest,
} from "./a2aProtocol.js";

function tenantQuotaKeys(
  auth: { tenantId: string; userId: string; clientId?: string },
): string[] {
  const keys = [`tenant:${auth.tenantId}`, `user:${auth.userId}`];
  if (auth.clientId) keys.push(`client:${auth.clientId}`);
  return keys;
}

export async function agentCardHandler(c: Context<JacklineEnv>) {
  const handle = c.req.param("handle");
  if (!handle) throw new NotFoundError("Agent not found");

  await enforceQuota(c, getQuotaLimiter(), "a2a.card", [
    `handle:${handle}`,
    `ip:${clientIpFromHeaders((name) => c.req.header(name))}`,
  ]);

  const result = await agentServices.buildAgentCardForHandle(handle);
  if (result.isErr()) throw result.error;

  c.header("Cache-Control", "public, max-age=60");
  return c.json(result.value);
}

export async function a2aIngressHandler(
  c: Context<JacklineEnv>,
): Promise<Response> {
  const handle = c.req.param("handle");
  if (!handle) {
    return respondA2aError(c, null, new NotFoundError("Agent not found"));
  }

  let body: JsonRpcRequest;
  try {
    body = await c.req.json<JsonRpcRequest>();
  } catch {
    return respondA2aParseError(c, { handle });
  }

  const authResult = await requireTenantContext(c);
  const log = authResult.isOk() ? authResult.value.log : c.get("requestContext").log;

  const authorization = c.req.header("Authorization") ?? "";
  const hasPeerGrant = /^Bearer\s+jka_/i.test(authorization);
  const knockPayloadResult =
    body.method === "message/send" ? extractKnockPayload(body.params) : null;
  const isKnock =
    !hasPeerGrant &&
    Boolean(
      knockPayloadResult?.isOk() && isKnockIntent(knockPayloadResult.value),
    );

  const identityKeys = [
    `handle:${handle}`,
    ...(authResult.isOk()
      ? tenantQuotaKeys(authResult.value.auth)
      : [`ip:${clientIpFromHeaders((name) => c.req.header(name))}`]),
  ];

  try {
    await enforceQuota(
      c,
      getQuotaLimiter(),
      isKnock ? "a2a.knock" : "a2a.message",
      identityKeys,
    );
  } catch (error) {
    if (error instanceof JacklineError) {
      return respondA2aError(c, body.id, error, {
        handle,
        method: body.method,
      });
    }
    throw error;
  }

  const wantsStream =
    (c.req.header("Accept") ?? "").includes("text/event-stream") &&
    body.method === "message/send" &&
    hasPeerGrant;

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, payload: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          );
        };
        send("status", {
          jsonrpc: "2.0",
          id: body.id,
          result: { state: "working" },
        });
        void (async () => {
          const result = await agentServices.processA2aJsonRpc({
            handle,
            authorization: c.req.header("Authorization"),
            body,
            log,
          });
          if (result.isErr()) {
            send("error", {
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32000,
                message: result.error.message,
              },
            });
          } else {
            send("result", jsonRpcResult(result.value.id, result.value.result));
          }
          controller.close();
        })();
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
  }

  const result = await agentServices.processA2aJsonRpc({
    handle,
    authorization: c.req.header("Authorization"),
    body,
    log,
  });

  if (result.isErr()) {
    return respondA2aError(c, body.id, result.error, {
      handle,
      method: body.method,
    });
  }

  return c.json(jsonRpcResult(result.value.id, result.value.result));
}
