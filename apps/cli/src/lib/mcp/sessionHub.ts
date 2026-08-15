import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import consola from "consola";
import { loadConfig } from "../config.js";
import type { MeshPaths } from "../paths.js";
import { toolPolicyFingerprint } from "../toolPolicy.js";
import {
  createPersonalMcpServer,
  type PersonalMcpHandle,
} from "./createPersonalMcpServer.js";

type LiveSession = {
  handle: PersonalMcpHandle;
  transport: WebStandardStreamableHTTPServerTransport;
};

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function isInitializePayload(body: unknown): boolean {
  if (isInitializeRequest(body)) return true;
  return Array.isArray(body) && body.some((row) => isInitializeRequest(row));
}

/**
 * Stateful Streamable HTTP sessions plus a config.yaml watcher.
 * Cursor's GET SSE stream receives notifications/tools/list_changed when
 * `mesh tools enable|disable` updates disabledTools.
 */
export function createSessionHub(paths: MeshPaths) {
  const sessions = new Map<string, LiveSession>();
  let lastFingerprint = "";
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;

  async function refreshSessions(): Promise<void> {
    let config;
    try {
      config = await loadConfig(paths);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.warn(`Config reload failed: ${detail}`);
      return;
    }

    const fingerprint = toolPolicyFingerprint(config.servers);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;

    if (sessions.size === 0) return;
    consola.info(
      `Tool policy changed; notifying ${sessions.size} MCP session(s)`,
    );
    for (const [id, session] of sessions) {
      try {
        await session.handle.applyServers(config.servers);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        consola.warn(`Failed to refresh MCP session ${id}: ${detail}`);
      }
    }
  }

  function startWatch(): void {
    try {
      watcher = watch(paths.config, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          void refreshSessions();
        }, 250);
        debounce.unref();
      });
      // Do not keep the process alive solely for config watching (tests/CLI exit).
      watcher.unref();
      consola.info(`Watching ${paths.config} for tool policy changes`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.warn(`Could not watch config file: ${detail}`);
    }
  }

  async function handleStateless(
    req: Request,
    parsedBody: unknown,
  ): Promise<Response> {
    const config = await loadConfig(paths);
    const handle = await createPersonalMcpServer(config.servers, paths);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await handle.server.connect(transport);
    try {
      return await transport.handleRequest(req, { parsedBody });
    } finally {
      await handle.server.close().catch(() => undefined);
    }
  }

  async function handleInitialize(
    req: Request,
    parsedBody: unknown,
  ): Promise<Response> {
    const config = await loadConfig(paths);
    lastFingerprint = toolPolicyFingerprint(config.servers);
    const handle = await createPersonalMcpServer(config.servers, paths);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { handle, transport });
        consola.debug(`MCP session ${sessionId} started`);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
        void handle.server.close().catch(() => undefined);
        consola.debug(`MCP session ${sessionId} closed`);
      },
    });
    await handle.server.connect(transport);
    return transport.handleRequest(req, { parsedBody });
  }

  async function handleRequest(req: Request): Promise<Response> {
    const sessionId = req.headers.get("mcp-session-id");
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return jsonRpcError(404, -32001, "Session not found");
      }
      return session.transport.handleRequest(req);
    }

    if (req.method === "GET" || req.method === "DELETE") {
      return jsonRpcError(400, -32000, "Bad Request: Missing mcp-session-id");
    }

    if (req.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed");
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return jsonRpcError(400, -32700, "Parse error");
    }

    if (isInitializePayload(parsedBody)) {
      return handleInitialize(req, parsedBody);
    }
    return handleStateless(req, parsedBody);
  }

  startWatch();
  void loadConfig(paths)
    .then((config) => {
      lastFingerprint = toolPolicyFingerprint(config.servers);
    })
    .catch(() => undefined);

  return {
    handleRequest,
    close(): void {
      watcher?.close();
      clearTimeout(debounce);
      for (const session of sessions.values()) {
        void session.handle.server.close().catch(() => undefined);
        void session.transport.close().catch(() => undefined);
      }
      sessions.clear();
    },
  };
}
