import type { Logger } from "pino";
import { db, auditEvents, type AuditOutcome } from "@jackline/db";

const MAX_JSON_CHARS = 32_000;

export type WriteAuditEventInput = {
  tenantId: string;
  connectionId: string;
  clientId: string;
  userId: string;
  toolId: string | null;
  toolName: string;
  serverId: string | null;
  outcome: AuditOutcome;
  reason: string | null;
  requestId: string;
  latencyMs: number;
  requestArgs?: unknown;
  responseBody?: unknown;
};

function truncateJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) return null;
    if (raw.length <= MAX_JSON_CHARS) return JSON.parse(raw) as unknown;
    return {
      truncated: true,
      preview: raw.slice(0, MAX_JSON_CHARS),
      originalBytes: raw.length,
    };
  } catch {
    return { unserializable: true, preview: String(value).slice(0, 500) };
  }
}

/** Best-effort insert — never throws to the tool-call path. */
export async function writeAuditEvent(
  log: Logger,
  input: WriteAuditEventInput,
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      clientId: input.clientId,
      userId: input.userId,
      toolId: input.toolId,
      toolName: input.toolName,
      serverId: input.serverId,
      outcome: input.outcome,
      reason: input.reason,
      requestId: input.requestId,
      latencyMs: input.latencyMs,
      requestArgs: truncateJson(input.requestArgs ?? null),
      responseBody: truncateJson(input.responseBody ?? null),
    });
  } catch (cause) {
    log.error({ err: cause, ...input }, "writeAuditEvent failed");
  }
}
