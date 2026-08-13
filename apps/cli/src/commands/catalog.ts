import { consola } from "consola";
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_PRESETS,
  type ConnectorPreset,
} from "@mesh/shared";
import { defineMeshCommand } from "./defineMeshCommand.js";

function supportsConnect(preset: ConnectorPreset): boolean {
  return Boolean(preset.oauthAuthorizeUrl && preset.oauthTokenUrl);
}

export default defineMeshCommand({
  meta: {
    name: "catalog",
    description: "List built-in connector presets you can add with mesh add",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print machine-readable JSON",
      default: false,
    },
  },
  run({ args }) {
    const rows = CONNECTOR_PRESETS.map((preset) => ({
      key: preset.key,
      name: preset.name,
      category: preset.category,
      description: preset.description,
      baseUrl: preset.baseUrl,
      authMethod: preset.authMethod,
      connect: supportsConnect(preset),
      oauthAuthorizeUrl: preset.oauthAuthorizeUrl ?? null,
      oauthTokenUrl: preset.oauthTokenUrl ?? null,
      oauthScopes: preset.oauthScopes ?? null,
      learnMoreUrl: preset.learnMoreUrl,
    }));

    if (args.json) {
      console.log(JSON.stringify({ connectors: rows }, null, 2));
      return;
    }

    consola.log(`Catalog: ${rows.length} connectors`);
    consola.log("Add with: mesh add <key> --connect --client-id … --client-secret …");
    consola.log("");

    for (const category of CONNECTOR_CATEGORIES) {
      const inCategory = rows.filter((row) => row.category === category.id);
      if (inCategory.length === 0) continue;

      consola.log(category.label);
      for (const row of inCategory) {
        consola.log(`  ${row.key}`);
        consola.log(`    ${row.name} — ${row.description}`);
        consola.log(`    url:      ${row.baseUrl}`);
        consola.log(
          `    connect:  ${
            row.connect
              ? "yes (mesh add " + row.key + " --connect …)"
              : "no (paste a token / API key)"
          }`,
        );
      }
      consola.log("");
    }
  },
});
