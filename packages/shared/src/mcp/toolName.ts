/** Sanitize a segment for MCP tool names (letters, digits, _ and -). */
export function sanitizeMcpNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/**
 * MCP-facing tool name: always `serverName__toolName` so LLMs can tell
 * which upstream a tool belongs to when names collide across servers.
 */
export function formatMcpToolName(serverName: string, toolName: string): string {
  return `${sanitizeMcpNameSegment(serverName)}__${sanitizeMcpNameSegment(toolName)}`;
}
