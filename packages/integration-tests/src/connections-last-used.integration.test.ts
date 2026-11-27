import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { auditEvents, db } from "@jackline/db";
import type {
  PublicConnection,
  PublicConnectionDetail,
} from "@jackline/shared";
import { createApiClient } from "./helpers/fixtures.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

function event(
  tenantId: string,
  connectionId: string,
  createdAt: Date,
  outcome: "allow" | "deny" | "allow_upstream_error",
) {
  return {
    tenantId,
    connectionId,
    createdAt,
    outcome,
    toolName: "last_used_probe",
    requestId: randomUUID(),
    latencyMs: 1,
  };
}

describe("connection lastUsedAt", () => {
  it("reports max audit time, null when unused, and is tenant-scoped", async () => {
    const clientA = await createApiClient();
    const { tenantId: tenantA } = await createAuthenticatedAdmin(
      clientA,
      "last-used-a",
    );
    const used = await provisionInteractiveMcpAccess(
      clientA,
      tenantA,
      "last-used-a1",
    );
    const unused = await provisionInteractiveMcpAccess(
      clientA,
      tenantA,
      "last-used-a2",
    );

    const clientB = await createApiClient();
    const { tenantId: tenantB } = await createAuthenticatedAdmin(
      clientB,
      "last-used-b",
    );

    const allowAt = new Date("2026-01-01T10:00:00.000Z");
    const denyAt = new Date("2026-01-02T10:00:00.000Z");
    const older = new Date("2025-12-01T10:00:00.000Z");
    await db.insert(auditEvents).values([
      event(tenantA, used.connectionId, older, "allow"),
      event(tenantA, used.connectionId, allowAt, "allow"),
      event(tenantA, used.connectionId, denyAt, "deny"),
      // Another tenant's row pointing at the same connection id must not leak.
      event(tenantB, used.connectionId, new Date("2026-06-01T00:00:00Z"), "allow"),
      event(tenantB, unused.connectionId, new Date("2026-06-01T00:00:00Z"), "allow"),
    ]);

    const detail = await clientA.api<PublicConnectionDetail>(
      `/api/v1/connections/${used.connectionId}`,
      { tenantId: tenantA },
    );
    assert.equal(detail.data.lastUsedAt, denyAt.toISOString());
    assert.equal(detail.data.lastAllowedAt, allowAt.toISOString());

    const unusedDetail = await clientA.api<PublicConnectionDetail>(
      `/api/v1/connections/${unused.connectionId}`,
      { tenantId: tenantA },
    );
    assert.equal(unusedDetail.data.lastUsedAt, null);
    assert.equal(unusedDetail.data.lastAllowedAt, null);

    const list = await clientA.api<PublicConnection[]>(
      "/api/v1/connections?limit=100",
      { tenantId: tenantA },
    );
    const items = Array.isArray(list.data)
      ? list.data
      : (list.data as unknown as { items: PublicConnection[] }).items;
    const byId = new Map(items.map((c) => [c.id, c]));
    assert.equal(byId.get(used.connectionId)?.lastUsedAt, denyAt.toISOString());
    assert.equal(
      byId.get(used.connectionId)?.lastAllowedAt,
      allowAt.toISOString(),
    );
    assert.equal(byId.get(unused.connectionId)?.lastUsedAt, null);

    await assert.rejects(
      clientB.api(`/api/v1/connections/${used.connectionId}`, {
        tenantId: tenantB,
      }),
      /404/,
    );
  });
});
