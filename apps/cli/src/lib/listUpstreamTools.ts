import { formatMcpToolName } from "@jackline/shared";
import type { JacklineConfigServer, JacklinePaths } from "./paths.js";
import { connectUpstream } from "./mcp/upstream.js";
import { isToolEnabled } from "./toolPolicy.js";

export type UpstreamToolRow = {
  upstreamName: string;
  jacklineName: string;
  description: string | null;
  enabled: boolean;
};

export async function listUpstreamTools(
  server: JacklineConfigServer,
  paths?: JacklinePaths,
): Promise<UpstreamToolRow[]> {
  if (server.authMethod === "mtls") {
    throw new Error(`Server "${server.name}" uses mTLS, which is not supported yet`);
  }

  const connected = await connectUpstream(server, paths);
  try {
    const listed = await connected.client.listTools();
    return listed.tools
      .map((tool) => ({
        upstreamName: tool.name,
        jacklineName: formatMcpToolName(server.name, tool.name),
        description: tool.description ?? null,
        enabled: isToolEnabled(server, tool.name),
      }))
      .sort((a, b) => a.upstreamName.localeCompare(b.upstreamName));
  } finally {
    await connected.close();
  }
}
