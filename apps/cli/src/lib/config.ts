import { access, readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { getMeshPaths, type MeshConfig, type MeshPaths } from "./paths.js";

const MeshConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
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

export async function loadConfig(paths?: MeshPaths): Promise<MeshConfig> {
  const p = paths ?? getMeshPaths();
  if (!(await pathExists(p.config))) {
    throw new Error(
      `No Mesh config at ${p.config}. Run \`mesh init\` first.`,
    );
  }
  const raw = await readFile(p.config, "utf8");
  const parsed = MeshConfigSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    throw new Error(`Invalid config at ${p.config}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function saveConfig(
  config: MeshConfig,
  paths?: MeshPaths,
): Promise<void> {
  const p = paths ?? getMeshPaths();
  const body = stringifyYaml(config);
  await writeFile(p.config, body.endsWith("\n") ? body : `${body}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
