import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { consola } from "consola";
import { defineMeshCommand } from "./defineMeshCommand.js";
import { cursorMcpSettingsSnippet, mintGatewayToken } from "../lib/gatewayAuth.js";
import {
  clearStoredMasterKey,
  masterKeyExists,
  storeMasterKey,
} from "../lib/masterKey.js";
import { defaultConfigYaml, getMeshPaths } from "../lib/paths.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export default defineMeshCommand({
  meta: {
    name: "init",
    description: "Initialize personal Mesh config under ~/.mesh",
  },
  args: {
    force: {
      type: "boolean",
      description: "Overwrite existing config and master key",
      default: false,
      alias: "f",
    },
    dir: {
      type: "string",
      description: "Config directory (default: ~/.mesh)",
      valueHint: "path",
    },
    fileKey: {
      type: "boolean",
      description:
        "Store the master key as ~/.mesh/master.key instead of the OS keychain (less secure)",
      default: false,
    },
  },
  async run({ args }) {
    const paths = getMeshPaths(args.dir);
    const already =
      (await pathExists(paths.config)) || (await masterKeyExists(paths));

    if (already && !args.force) {
      consola.error(`Already initialized at ${paths.root}`);
      consola.info("Re-run with --force to overwrite.");
      process.exit(1);
    }

    if (args.force) {
      await clearStoredMasterKey(paths);
    }

    await mkdir(paths.root, { recursive: true });

    const keyStorage = args.fileKey ? "file" : "keychain";
    const masterKey = randomBytes(32).toString("base64");

    await writeFile(
      paths.secrets,
      `${JSON.stringify({ version: 1, secrets: {} }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    try {
      await storeMasterKey(masterKey, paths, {
        keyStorage,
        warnOnFile: true,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.error(detail);
      // Avoid leaving a half-initialized tree that blocks retry without --force.
      try {
        await rm(paths.secrets, { force: true });
      } catch {
        // ignore cleanup errors
      }
      process.exit(1);
    }

    await writeFile(paths.config, defaultConfigYaml(keyStorage), {
      encoding: "utf8",
      mode: 0o600,
    });

    const token = await mintGatewayToken(paths);

    consola.success(`Mesh initialized at ${paths.root}`);
    consola.info(`Config:     ${paths.config}`);
    if (keyStorage === "keychain") {
      consola.info("Master key: OS keychain (mesh-cli)");
    } else {
      consola.info(`Master key: ${paths.masterKey}`);
    }
    consola.info(`Secrets:    ${paths.secrets}`);
    consola.info("Gateway bearer token (add to MCP clients):");
    consola.log(token);
    consola.info("Cursor / Claude MCP settings:");
    consola.log(cursorMcpSettingsSnippet("127.0.0.1", 8081, token));
  },
});
