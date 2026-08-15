import { consola } from "consola";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { loadConfig } from "../lib/config.js";
import { getJacklinePaths } from "../lib/paths.js";
import { loadSecretsFile } from "../lib/secrets.js";

export default defineJacklineCommand({
  meta: {
    name: "list",
    description: "List configured upstream MCP servers and their settings",
  },
  args: {
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON (no secret values)",
      default: false,
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    const config = await loadConfig(paths);
    const secrets = await loadSecretsFile(paths);

    const rows = config.servers.map((server) => {
      const secret = secrets.secrets[server.secretId];
      return {
        id: server.id,
        name: server.name,
        baseUrl: server.baseUrl,
        authMethod: server.authMethod,
        connectorKey: server.connectorKey,
        secretId: server.secretId,
        disabledTools: server.disabledTools ?? [],
        credential: secret
          ? { present: true as const, kind: secret.kind }
          : { present: false as const, kind: null },
      };
    });

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            root: paths.root,
            port: config.port,
            version: config.version,
            servers: rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    consola.log(`Config:  ${paths.config}`);
    consola.log(`Port:    ${config.port}`);
    consola.log(`Servers: ${rows.length}`);
    consola.log("");

    if (rows.length === 0) {
      consola.info("No servers configured. Try `jackline add linear --token …`.");
      return;
    }

    for (const row of rows) {
      consola.log(row.name);
      consola.log(`  id:           ${row.id}`);
      consola.log(`  url:          ${row.baseUrl}`);
      consola.log(`  auth:         ${row.authMethod}`);
      consola.log(
        `  catalog:      ${row.connectorKey ?? "(custom)"}`,
      );
      consola.log(
        `  credential:   ${
          row.credential.present
            ? `present (${row.credential.kind})`
            : "MISSING"
        }`,
      );
      const disabled = row.disabledTools.length;
      if (disabled > 0) {
        consola.log(`  tools:        ${disabled} disabled`);
      }
      consola.log("");
    }
  },
});
