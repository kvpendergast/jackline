import { consola } from "consola";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { hostedApiGet, loadSession } from "../lib/hosted/session.js";
import { getJacklinePaths } from "../lib/paths.js";

type MeResponse = {
  user: { id: string; email: string; name: string };
  memberships: Array<{ role: string; tenant: { id: string; name: string; slug: string } }>;
  mcpUrl?: string;
  current?: { tenantId: string; role: string; authMethod: string };
};

export default defineJacklineCommand({
  meta: {
    name: "whoami",
    description: "Show the user, workspace and role of your hosted Jackline login",
  },
  args: {
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON",
      default: false,
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    try {
      const session = await loadSession(paths);
      if (!session) {
        consola.info("Not logged in. Run `jackline login --server <url>`.");
        process.exit(1);
      }
      const me = await hostedApiGet<MeResponse>(paths, "/me");
      const tenant = me.memberships.find(
        (m) => m.tenant.id === me.current?.tenantId,
      )?.tenant;
      if (args.json) {
        consola.log(
          JSON.stringify(
            {
              server: session.server,
              user: me.user,
              tenant: tenant ?? null,
              role: me.current?.role ?? null,
              mcpUrl: me.mcpUrl ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      consola.log(`Server:    ${session.server}`);
      consola.log(`User:      ${me.user.name} <${me.user.email}>`);
      if (tenant) consola.log(`Workspace: ${tenant.name} (${tenant.slug})`);
      if (me.current) consola.log(`Role:      ${me.current.role}`);
      if (me.mcpUrl) consola.log(`MCP URL:   ${me.mcpUrl}`);
    } catch (cause) {
      consola.error(cause instanceof Error ? cause.message : String(cause));
      process.exit(1);
    }
  },
});
