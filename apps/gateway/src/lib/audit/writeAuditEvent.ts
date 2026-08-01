import type { Logger } from "pino";
import { db, auditEvents, type AuditOutcome } from "@mesh/db";

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
};

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
    });
  } catch (cause) {
    log.error({ err: cause, ...input }, "writeAuditEvent failed");
  }
}
