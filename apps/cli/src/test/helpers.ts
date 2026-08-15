import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { mintGatewayToken } from "../lib/gatewayAuth.js";
import { storeMasterKey } from "../lib/masterKey.js";
import { defaultConfigYaml, getMeshPaths, type MeshPaths } from "../lib/paths.js";

/** Isolated ~/.mesh-style tree using file-backed master key (no OS keychain). */
export async function createTempMeshHome(): Promise<{
  paths: MeshPaths;
  masterKey: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mesh-cli-test-"));
  const paths = getMeshPaths(root);
  const masterKey = randomBytes(32).toString("base64");

  await writeFile(
    paths.secrets,
    `${JSON.stringify({ version: 1, secrets: {} }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await storeMasterKey(masterKey, paths, {
    keyStorage: "file",
    warnOnFile: false,
  });
  await writeFile(paths.config, defaultConfigYaml("file"), {
    encoding: "utf8",
    mode: 0o600,
  });

  return { paths, masterKey };
}

export async function createTempMeshHomeWithGatewayToken(): Promise<{
  paths: MeshPaths;
  token: string;
}> {
  const { paths } = await createTempMeshHome();
  const token = await mintGatewayToken(paths);
  return { paths, token };
}
