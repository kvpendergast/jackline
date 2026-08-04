import { err, ok, type Result } from "neverthrow";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BadRequestError,
  MeshError,
  type ToolHttpMethod,
} from "@mesh/shared";
import type { Logger } from "pino";
import type { GatewayConnectionContext } from "../auth/types.js";
import {
  formatUpstreamError,
  resolveUpstreamAuthHeaders,
  type UpstreamServerRow,
} from "./upstreamClient.js";

function joinUrl(baseUrl: string, pathTemplate: string): Result<URL, MeshError> {
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
): Result<{ path: string; used: Set<string> }, MeshError> {
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
    if (cause instanceof MeshError) return err(cause);
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

/**
 * Proxy a Mesh tool invocation to a custom HTTP API using the tool's binding.
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
): Promise<Result<CallToolResult, MeshError>> {
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
          serverId: server.id,
          status: res.status,
          method,
          path: expanded.value.path,
        },
        "proxyHttpToolCall upstream error status",
      );
      return err(
        new MeshError(
          "INTERNAL",
          `Upstream HTTP ${method} ${expanded.value.path} → ${res.status}: ${text.slice(0, 500)}`,
        ),
      );
    }

    log.info(
      {
        toolId: binding.toolId,
        serverId: server.id,
        method,
        path: expanded.value.path,
        status: res.status,
      },
      "proxyHttpToolCall ok",
    );

    return ok({
      content: [
        {
          type: "text",
          text: pretty || `(empty ${res.status} response)`,
        },
      ],
    });
  } catch (cause) {
    return err(formatUpstreamError(cause, "call"));
  }
}

export function assertHttpBinding(
  log: Logger,
  row: {
    httpMethod: string | null;
    pathTemplate: string | null;
    toolName: string;
  },
): Result<{ httpMethod: ToolHttpMethod; pathTemplate: string }, MeshError> {
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
