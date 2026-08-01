import { ok } from "neverthrow";

export type ToolPermission = {
  id: string;
  status: "needs_review" | "active" | "disabled";
  permission: "allow" | "deny";
  serverStatus: "pending" | "active" | "disabled";
};

export type ToolPermissions = ToolPermission[];

function toolIsAllowed(toolPermission: ToolPermission) {
  if (
    toolPermission.status === "active" &&
    toolPermission.permission === "allow" &&
    toolPermission.serverStatus === "active"
  ) {
    return ok(true);
  }

  return ok(false);
}

/** Deny wins when the same tool appears more than once. Status is taken from the first row. */
function mergeByToolId(toolPermissions: ToolPermissions): ToolPermission[] {
  const byId = new Map<string, ToolPermission>();

  for (const tool of toolPermissions) {
    const existing = byId.get(tool.id);
    if (!existing) {
      byId.set(tool.id, { ...tool });
      continue;
    }
    if (tool.permission === "deny") {
      existing.permission = "deny";
    }
  }

  return [...byId.values()];
}

export function getAllowedTools(toolPermissions: ToolPermissions) {
  const allowedToolIds = mergeByToolId(toolPermissions)
    .filter((tool) => toolIsAllowed(tool).unwrapOr(false))
    .map((tool) => tool.id);

  return ok(allowedToolIds);
}
