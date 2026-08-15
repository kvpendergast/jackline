import { access, readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { getJacklinePaths, type JacklineConfig, type JacklinePaths } from "./paths.js";

const JacklineConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
  keyStorage: z.enum(["keychain", "file"]).optional(),
  gatewayTokenSecretId: z.string().uuid().optional(),
  servers: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      baseUrl: z.string().url(),
      authMethod: z.enum(["api_key", "oauth", "mtls"]),
      secretId: z.string().min(1),
      connectorKey: z.string().nullable(),
      disabledTools: z.array(z.string().min(1)).optional(),
    }),
  ),
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(paths?: JacklinePaths): Promise<JacklineConfig> {
  const p = paths ?? getJacklinePaths();
  if (!(await pathExists(p.config))) {
    throw new Error(
      `No Jackline config at ${p.config}. Run \`jackline init\` first.`,
    );
  }
  const raw = await readFile(p.config, "utf8");
  const parsed = JacklineConfigSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    throw new Error(`Invalid config at ${p.config}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function saveConfig(
  config: JacklineConfig,
  paths?: JacklinePaths,
): Promise<void> {
  const p = paths ?? getJacklinePaths();
  const body = stringifyYaml(config);
  await writeFile(p.config, body.endsWith("\n") ? body : `${body}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
