import type { PublicServer, PublicTool, ToolStatus } from "@jackline/shared";

export const ALL_SERVERS = "all";

export type RoleToolRow = {
  id: string;
  name: string;
  serverId: string;
  status: ToolStatus | "unknown";
  placeholder: boolean;
};

/** Server dropdown options: every server, sorted by name, including those with no tools. */
export function serversForPicker(servers: PublicServer[]): PublicServer[] {
  return [...servers].sort((a, b) => a.name.localeCompare(b.name));
}

export function indexToolsById(
  known: ReadonlyMap<string, PublicTool>,
  tools: readonly PublicTool[],
): Map<string, PublicTool> {
  const next = new Map(known);
  for (const tool of tools) next.set(tool.id, tool);
  return next;
}

export function splitToolsByServer(
  tools: readonly PublicTool[],
): Map<string, PublicTool[]> {
  const byServer = new Map<string, PublicTool[]>();
  for (const tool of tools) {
    const list = byServer.get(tool.serverId) ?? [];
    list.push(tool);
    byServer.set(tool.serverId, list);
  }
  return byServer;
}

export function visibleRoleTools(args: {
  loadedTools: readonly PublicTool[];
  selectedIds: ReadonlySet<string>;
  serverFilter: string;
  knownTools: ReadonlyMap<string, PublicTool>;
  serverNameById: ReadonlyMap<string, string>;
}): RoleToolRow[] {
  const { loadedTools, selectedIds, serverFilter, knownTools, serverNameById } =
    args;
  const rows = new Map<string, RoleToolRow>();

  for (const tool of loadedTools) {
    if (serverFilter !== ALL_SERVERS && tool.serverId !== serverFilter) continue;
    if (tool.status !== "active" && !selectedIds.has(tool.id)) continue;
    rows.set(tool.id, toRow(tool));
  }

  for (const id of selectedIds) {
    if (rows.has(id)) continue;
    const known = knownTools.get(id);
    if (serverFilter === ALL_SERVERS) {
      rows.set(id, known ? toRow(known) : placeholderRow(id));
      continue;
    }
    if (known && known.serverId === serverFilter) {
      rows.set(id, toRow(known));
    }
  }

  return [...rows.values()].sort((a, b) => {
    const serverCmp = (
      serverNameById.get(a.serverId) ?? a.serverId
    ).localeCompare(serverNameById.get(b.serverId) ?? b.serverId);
    if (serverCmp !== 0) return serverCmp;
    return a.name.localeCompare(b.name);
  });
}

export function applyVisibleSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
  action: "selectAll" | "clear",
): Set<string> {
  const next = new Set(selected);
  if (action === "selectAll") {
    for (const id of visibleIds) next.add(id);
  } else {
    for (const id of visibleIds) next.delete(id);
  }
  return next;
}

/** Save payload is the full selection, including ids that were never loaded in the UI. */
export function selectedIdsForSave(selected: ReadonlySet<string>): string[] {
  return [...selected];
}

export function roleToolsEmptyState(args: {
  serverFilter: string;
  loadedCount: number;
  visibleCount: number;
  loading: boolean;
}): string | null {
  if (args.loading || args.visibleCount > 0) return null;
  if (args.serverFilter !== ALL_SERVERS && args.loadedCount === 0) {
    return "No tools synced for this server yet";
  }
  return "No tools available.";
}

function toRow(tool: PublicTool): RoleToolRow {
  return {
    id: tool.id,
    name: tool.name,
    serverId: tool.serverId,
    status: tool.status,
    placeholder: false,
  };
}

function placeholderRow(id: string): RoleToolRow {
  return {
    id,
    name: `${id.slice(0, 8)}…`,
    serverId: "",
    status: "unknown",
    placeholder: true,
  };
}
