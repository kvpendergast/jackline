import { err, ok, type Result } from "neverthrow";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BadRequestError,
  JacklineError,
  type ToolHttpMethod,
} from "@jackline/shared";
import type { Logger } from "pino";
import type { GatewayConnectionContext } from "../auth/types.js";
import {
  formatUpstreamError,
  isInvalidUpstreamTokenError,
  resolveUpstreamAuthHeaders,
  type UpstreamServerRow,
} from "./upstreamClient.js";

function joinUrl(baseUrl: string, pathTemplate: string): Result<URL, JacklineError> {
  try {
    const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const path = pathTemplate.startsWith("/")
      ? pathTemplate.slice(1)
      : pathTemplate;
    return ok(new URL(path, base));
  } catch {
    return err(
      new BadRequestError(
        `Invalid upstream URL from baseUrl=${baseUrl} path=${pathTemplate}`,
      ),
    );
  }
}

function applyPathParams(
  pathTemplate: string,
  args: Record<string, unknown>,
): Result<{ path: string; used: Set<string> }, JacklineError> {
  const used = new Set<string>();
  try {
    const path = pathTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      used.add(name);
      const value = args[name];
      if (value == null) {
        throw new BadRequestError(`Missing path parameter "${name}"`);
      }
      return encodeURIComponent(String(value));
    });
    return ok({ path, used });
  } catch (cause) {
    if (cause instanceof JacklineError) return err(cause);
    return err(new BadRequestError("Failed to expand path template"));
  }
}

function remainingArgs(
  args: Record<string, unknown>,
  used: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!used.has(key)) out[key] = value;
  }
  return out;
}

async function executeHttpUpstream(
  log: Logger,
  url: URL,
  method: ToolHttpMethod,
  headers: Record<string, string>,
  body: string | undefined,
  binding: { toolId: string; pathTemplate: string },
  serverId: string,
): Promise<Result<{ status: number; pretty: string }, JacklineError>> {
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    const res = await fetch(url, init);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let pretty = text;
    if (contentType.includes("application/json") && text) {
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // keep raw text
      }
    }

    if (!res.ok) {
      log.warn(
        {
          toolId: binding.toolId,
          serverId,
          status: res.status,
          method,
          path: binding.pathTemplate,
        },
        "proxyHttpToolCall upstream error status",
      );
      return err(
        new JacklineError(
          "INTERNAL",
          `Upstream HTTP ${method} ${binding.pathTemplate} → ${res.status}: ${text.slice(0, 500)}`,
        ),
      );
    }

    return ok({ status: res.status, pretty });
  } catch (cause) {
    return err(formatUpstreamError(cause, "call"));
  }
}

/**
 * Proxy a Jackline tool invocation to a custom HTTP API using the tool's binding.
 */
export async function proxyHttpToolCall(
  ctx: GatewayConnectionContext,
  server: UpstreamServerRow,
  binding: {
    toolId: string;
    toolName: string;
    httpMethod: ToolHttpMethod;
    pathTemplate: string;
  },
  args: Record<string, unknown>,
): Promise<Result<CallToolResult, JacklineError>> {
  const { tenantId, connection, log } = ctx;

  const headersResult = await resolveUpstreamAuthHeaders(
    log,
    tenantId,
    connection.userId,
    server,
  );
  if (headersResult.isErr()) return err(headersResult.error);

  const expanded = applyPathParams(binding.pathTemplate, args);
  if (expanded.isErr()) return err(expanded.error);

  const urlResult = joinUrl(server.baseUrl, expanded.value.path);
  if (urlResult.isErr()) return err(urlResult.error);

  const url = urlResult.value;
  const rest = remainingArgs(args, expanded.value.used);
  const method = binding.httpMethod;
  const headers: Record<string, string> = {
    ...headersResult.value,
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
  };

  let body: string | undefined;
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    for (const [key, value] of Object.entries(rest)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  } else if (Object.keys(rest).length > 0) {
    headers["Content-Type"] = "application/json";
    if ("body" in rest && Object.keys(rest).length === 1) {
      body = JSON.stringify(rest["body"]);
    } else {
      body = JSON.stringify(rest);
    }
  }

  const first = await executeHttpUpstream(
    log,
    url,
    method,
    headers,
    body,
    { toolId: binding.toolId, pathTemplate: expanded.value.path },
    server.id,
  );

  let result = first;
  if (
    first.isErr() &&
    server.authMethod === "oauth" &&
    isInvalidUpstreamTokenError(first.error.message)
  ) {
    log.info(
      { serverId: server.id, toolId: binding.toolId },
      "upstream HTTP 401; force-refreshing OAuth and retrying",
    );
    const refreshed = await resolveUpstreamAuthHeaders(
      log,
      tenantId,
      connection.userId,
      server,
      { forceRefresh: true },
    );
    if (refreshed.isErr()) return err(refreshed.error);

    if (refreshed.value["Authorization"] !== headersResult.value["Authorization"]) {
      const retryHeaders: Record<string, string> = {
        ...headers,
        ...refreshed.value,
      };
      result = await executeHttpUpstream(
        log,
        url,
        method,
        retryHeaders,
        body,
        { toolId: binding.toolId, pathTemplate: expanded.value.path },
        server.id,
      );
    }
  }

  if (result.isErr()) return err(result.error);

  log.info(
    {
      toolId: binding.toolId,
      serverId: server.id,
      method,
      path: expanded.value.path,
      status: result.value.status,
    },
    "proxyHttpToolCall ok",
  );

  return ok({
    content: [
      {
        type: "text",
        text: result.value.pretty || `(empty ${result.value.status} response)`,
      },
    ],
  });
}

export function assertHttpBinding(
  log: Logger,
  row: {
    httpMethod: string | null;
    pathTemplate: string | null;
    toolName: string;
  },
): Result<{ httpMethod: ToolHttpMethod; pathTemplate: string }, JacklineError> {
  if (!row.httpMethod || !row.pathTemplate) {
    log.warn({ toolName: row.toolName }, "API tool missing HTTP binding");
    return err(
      new BadRequestError(
        `Tool "${row.toolName}" is on an API server but has no httpMethod/pathTemplate`,
      ),
    );
  }
  return ok({
    httpMethod: row.httpMethod as ToolHttpMethod,
    pathTemplate: row.pathTemplate,
  });
}
