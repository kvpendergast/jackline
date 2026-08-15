import type { Logger } from "pino";
import type { JacklineError } from "@jackline/shared";
import {
  connectUpstream,
  formatUpstreamError,
  loadUpstreamServer,
} from "./upstreamClient.js";

export type UpstreamToolMeta = {
  description?: string | undefined;
  inputSchema: unknown;
};

type CacheEntry = {
  expiresAt: number;
  byName: Map<string, UpstreamToolMeta>;
};

const CACHE_TTL_MS = 60_000;
const schemaCache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, serverId: string): string {
  return `${tenantId}:${serverId}`;
}

/**
 * Fetch upstream tools/list schemas for a server (cached ~60s).
 * Failures return empty map so Jackline can still advertise allowed tools.
 */
export async function fetchUpstreamToolMeta(
  log: Logger,
  tenantId: string,
  userId: string,
  serverId: string,
): Promise<Map<string, UpstreamToolMeta>> {
  const key = cacheKey(tenantId, serverId);
  const cached = schemaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.byName;
  }

  const server = await loadUpstreamServer(tenantId, serverId);
  if (server.isErr()) {
    log.warn(
      { err: server.error, serverId },
      "fetchUpstreamToolMeta: server lookup failed",
    );
    return new Map();
  }

  const connected = await connectUpstream(log, tenantId, userId, server.value);
  if (connected.isErr()) {
    log.warn(
      { err: connected.error, serverId },
      "fetchUpstreamToolMeta: connect failed (using empty schemas)",
    );
    return new Map();
  }

  try {
    const listed = await connected.value.client.listTools();
    const byName = new Map<string, UpstreamToolMeta>();
    for (const tool of listed.tools) {
      byName.set(tool.name, {
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }

    schemaCache.set(key, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      byName,
    });

    log.debug(
      { serverId, toolCount: byName.size },
      "fetchUpstreamToolMeta ok",
    );
    return byName;
  } catch (cause) {
    const jacklineErr: JacklineError = formatUpstreamError(cause, "list");
    log.warn({ err: jacklineErr, serverId }, "fetchUpstreamToolMeta: listTools failed");
    return new Map();
  } finally {
    await connected.value.close();
  }
}

/** Prefetch meta for many servers in parallel. */
export async function fetchUpstreamToolMetaByServer(
  log: Logger,
  tenantId: string,
  userId: string,
  serverIds: string[],
): Promise<Map<string, Map<string, UpstreamToolMeta>>> {
  const unique = [...new Set(serverIds)];
  const entries = await Promise.all(
    unique.map(async (serverId) => {
      const meta = await fetchUpstreamToolMeta(log, tenantId, userId, serverId);
      return [serverId, meta] as const;
    }),
  );
  return new Map(entries);
}
