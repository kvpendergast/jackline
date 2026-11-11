import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicServer, PublicTool } from "@jackline/shared";
import {
  ALL_SERVERS,
  applyVisibleSelection,
  roleToolsEmptyState,
  selectedIdsForSave,
  serversForPicker,
  visibleRoleTools,
} from "./roleToolPicker";

const TENANT = "00000000-0000-4000-8000-000000000001";
const GMAIL = "00000000-0000-4000-8000-000000000010";
const COMPUTE = "00000000-0000-4000-8000-000000000011";
const DOLLAS = "00000000-0000-4000-8000-000000000012";

function server(
  id: string,
  name: string,
): PublicServer {
  return {
    id,
    name,
    baseUrl: "https://example.test",
    authMethod: "oauth",
    kind: "mcp",
    status: "active",
    health: "unknown",
    source: "custom",
    credentialMode: "shared",
    connectorKey: null,
    docsUrl: null,
    oauthAuthorizeUrl: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthRegistrationUrl: null,
    oauthResource: null,
    oauthClientId: null,
    hasOauthClientSecret: false,
    oauthAppId: null,
    requiresApproval: false,
    tenantId: TENANT,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function tool(
  overrides: Partial<PublicTool> & Pick<PublicTool, "id" | "name" | "serverId">,
): PublicTool {
  return {
    description: null,
    inputSchema: null,
    httpMethod: null,
    pathTemplate: null,
    status: "active",
    requiresApproval: false,
    tenantId: TENANT,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const names = new Map([
  [GMAIL, "Gmail"],
  [COMPUTE, "Compute Engine"],
  [DOLLAS, "Dollas"],
]);

describe("serversForPicker", () => {
  it("lists every server by name, including ones with no tools", () => {
    const servers = [
      server(COMPUTE, "Compute Engine"),
      server(GMAIL, "Gmail"),
      server(DOLLAS, "Dollas"),
    ];
    const tools = [
      tool({
        id: "00000000-0000-4000-8000-000000000101",
        name: "list_instances",
        serverId: COMPUTE,
      }),
    ];
    const listed = serversForPicker(servers);
    assert.deepEqual(
      listed.map((s) => s.name),
      ["Compute Engine", "Dollas", "Gmail"],
    );
    assert.ok(listed.some((s) => s.id === GMAIL));
    // Zero-tool servers are not filtered out even when a tools list is present.
    const toolServerIds = new Set(tools.map((t) => t.serverId));
    assert.equal(toolServerIds.has(GMAIL), false);
    assert.equal(listed.length, servers.length);
  });
});

describe("visibleRoleTools", () => {
  it("keeps already-selected tools visible before they have loaded", () => {
    const selectedId = "00000000-0000-4000-8000-000000000201";
    const rows = visibleRoleTools({
      loadedTools: [],
      selectedIds: new Set([selectedId]),
      serverFilter: ALL_SERVERS,
      knownTools: new Map(),
      serverNameById: names,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, selectedId);
    assert.equal(rows[0]?.placeholder, true);
    assert.equal(rows[0]?.status, "unknown");
  });

  it("does not drop a selected tool that is not in the loaded page", () => {
    const loaded = tool({
      id: "00000000-0000-4000-8000-000000000202",
      name: "list_instances",
      serverId: COMPUTE,
    });
    const selectedOnly = "00000000-0000-4000-8000-000000000203";
    const rows = visibleRoleTools({
      loadedTools: [loaded],
      selectedIds: new Set([loaded.id, selectedOnly]),
      serverFilter: ALL_SERVERS,
      knownTools: new Map([[loaded.id, loaded]]),
      serverNameById: names,
    });
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(loaded.id));
    assert.ok(ids.includes(selectedOnly));
  });

  it("hides selected tools that belong to a different server", () => {
    const gmailTool = tool({
      id: "00000000-0000-4000-8000-000000000204",
      name: "create_draft",
      serverId: GMAIL,
    });
    const rows = visibleRoleTools({
      loadedTools: [],
      selectedIds: new Set([gmailTool.id]),
      serverFilter: COMPUTE,
      knownTools: new Map([[gmailTool.id, gmailTool]]),
      serverNameById: names,
    });
    assert.deepEqual(rows, []);
  });
});

describe("applyVisibleSelection / selectedIdsForSave", () => {
  it("preserves unloaded selections when clearing or saving the visible set", () => {
    const hidden = "00000000-0000-4000-8000-000000000301";
    const visible = "00000000-0000-4000-8000-000000000302";
    const selected = new Set([hidden, visible]);

    const cleared = applyVisibleSelection(selected, [visible], "clear");
    assert.deepEqual(selectedIdsForSave(cleared).sort(), [hidden]);

    const restored = applyVisibleSelection(cleared, [visible], "selectAll");
    assert.deepEqual(
      selectedIdsForSave(restored).sort(),
      [hidden, visible].sort(),
    );
  });
});

describe("roleToolsEmptyState", () => {
  it("tells the admin when a server has no synced tools", () => {
    assert.equal(
      roleToolsEmptyState({
        serverFilter: GMAIL,
        loadedCount: 0,
        visibleCount: 0,
        loading: false,
      }),
      "No tools synced for this server yet",
    );
  });

  it("stays quiet while tools are loading", () => {
    assert.equal(
      roleToolsEmptyState({
        serverFilter: GMAIL,
        loadedCount: 0,
        visibleCount: 0,
        loading: true,
      }),
      null,
    );
  });
});
