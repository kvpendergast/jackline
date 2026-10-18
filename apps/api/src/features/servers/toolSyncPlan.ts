export type ImportedTool = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
};

export type ExistingToolRow = {
  id: string;
  name: string;
  status: "needs_review" | "active" | "disabled";
};

export type ToolSyncPlan<T extends ImportedTool> = {
  toCreate: T[];
  toUpdate: Array<{ id: string; item: T }>;
  /** Existing rows no longer advertised upstream (deactivated, not deleted). */
  toDisable: string[];
};

/**
 * Diff the upstream catalog against stored rows. Existing tools always get
 * their description/schema refreshed; tools missing upstream are disabled.
 * An empty upstream list never disables anything (guards against a bad fetch).
 */
export function planToolSync<T extends ImportedTool>(
  existing: ExistingToolRow[],
  imported: T[],
): ToolSyncPlan<T> {
  const byName = new Map(existing.map((row) => [row.name, row]));
  const seen = new Set<string>();
  const toCreate: T[] = [];
  const toUpdate: Array<{ id: string; item: T }> = [];

  for (const item of imported) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    const found = byName.get(item.name);
    if (found) toUpdate.push({ id: found.id, item });
    else toCreate.push(item);
  }

  const toDisable =
    imported.length === 0
      ? []
      : existing
          .filter((row) => !seen.has(row.name) && row.status !== "disabled")
          .map((row) => row.id);

  return { toCreate, toUpdate, toDisable };
}

export const MAX_TOOL_LIST_PAGES = 50;

/** Follow tools/list `nextCursor` until exhausted (bounded, cycle-safe). */
export async function listAllUpstreamTools<Tool>(
  listPage: (cursor?: string) => Promise<{ tools: Tool[]; nextCursor?: string | undefined }>,
): Promise<Tool[]> {
  const all: Tool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
    const res = await listPage(cursor);
    all.push(...res.tools);
    if (!res.nextCursor || cursors.has(res.nextCursor)) break;
    cursors.add(res.nextCursor);
    cursor = res.nextCursor;
  }
  return all;
}
