import { and, eq, inArray } from "drizzle-orm";
import { db, upstreamAccounts } from "@jackline/db";
import type { UpstreamAccountRef } from "@jackline/shared";

export async function listUpstreamAccountsByServer(
  tenantId: string,
  userId: string,
  serverIds: string[],
): Promise<Map<string, UpstreamAccountRef[]>> {
  const map = new Map<string, UpstreamAccountRef[]>();
  if (serverIds.length === 0) return map;
  const rows = await db
    .select({
      id: upstreamAccounts.id,
      label: upstreamAccounts.label,
      externalEmail: upstreamAccounts.externalEmail,
      externalSubject: upstreamAccounts.externalSubject,
      isDefault: upstreamAccounts.isDefault,
      serverId: upstreamAccounts.serverId,
    })
    .from(upstreamAccounts)
    .where(
      and(
        eq(upstreamAccounts.tenantId, tenantId),
        eq(upstreamAccounts.userId, userId),
        inArray(upstreamAccounts.serverId, serverIds),
      ),
    );
  for (const row of rows) {
    const list = map.get(row.serverId) ?? [];
    list.push({
      id: row.id,
      label: row.label,
      externalEmail: row.externalEmail,
      externalSubject: row.externalSubject,
      isDefault: row.isDefault,
    });
    map.set(row.serverId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }
  return map;
}

export async function touchUpstreamAccountUsed(accountId: string): Promise<void> {
  try {
    await db
      .update(upstreamAccounts)
      .set({ lastUsedAt: new Date() })
      .where(eq(upstreamAccounts.id, accountId));
  } catch {
    // best-effort
  }
}
