import { formatMcpToolName } from "@jackline/shared";

export type BoundAgentTool = {
  toolId: string;
  name: string;
  serverId: string;
  serverName: string;
  mcpName: string;
  description: string | null;
};

/** Resolve a peer-requested tool name against agent bindings (mcp or local name). */
export function resolveBoundToolName(
  bound: BoundAgentTool[],
  requestedName: string,
): BoundAgentTool | undefined {
  return (
    bound.find((tool) => tool.mcpName === requestedName) ??
    bound.find((tool) => tool.name === requestedName)
  );
}

export function toBoundAgentTool(input: {
  toolId: string;
  name: string;
  serverId: string;
  serverName: string;
  description: string | null;
}): BoundAgentTool {
  return {
    ...input,
    mcpName: formatMcpToolName(input.serverName, input.name),
  };
}
