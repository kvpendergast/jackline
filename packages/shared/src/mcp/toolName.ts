/**
 * Cap before scanning. Normal server and tool names are far shorter, so
 * their sanitized form is unchanged. A multi-megabyte string of `_` cannot
 * reach a backtracking regex.
 */
const MAX_MCP_NAME_SEGMENT_INPUT = 1024;

function isAllowedMcpNameChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95
  );
}

/**
 * Sanitize a segment for MCP tool names (letters, digits, `_` and `-`).
 * Runs of any other character become a single `_`. Leading and trailing
 * `_` are removed. An empty result is `x`.
 *
 * Linear in the capped length. The previous `/^_+|_+$/` trim was polynomial
 * on a long run of underscores.
 */
export function sanitizeMcpNameSegment(value: string): string {
  const length =
    value.length > MAX_MCP_NAME_SEGMENT_INPUT
      ? MAX_MCP_NAME_SEGMENT_INPUT
      : value.length;
  const chars: string[] = [];
  let collapsing = false;
  for (let i = 0; i < length; i++) {
    const code = value.charCodeAt(i);
    if (isAllowedMcpNameChar(code)) {
      chars.push(value.charAt(i));
      collapsing = false;
    } else if (!collapsing) {
      chars.push("_");
      collapsing = true;
    }
  }

  let start = 0;
  let end = chars.length;
  while (start < end && chars[start] === "_") start += 1;
  while (end > start && chars[end - 1] === "_") end -= 1;
  if (start >= end) return "x";
  return chars.slice(start, end).join("");
}

/**
 * MCP-facing tool name: always `serverName__toolName` so LLMs can tell
 * which upstream a tool belongs to when names collide across servers.
 */
export function formatMcpToolName(serverName: string, toolName: string): string {
  return `${sanitizeMcpNameSegment(serverName)}__${sanitizeMcpNameSegment(toolName)}`;
}
