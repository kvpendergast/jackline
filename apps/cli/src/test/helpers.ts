import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { mintGatewayToken } from "../lib/gatewayAuth.js";
import { storeMasterKey } from "../lib/masterKey.js";
import { defaultConfigYaml, getJacklinePaths, type JacklinePaths } from "../lib/paths.js";

/** Isolated ~/.jackline-style tree using file-backed master key (no OS keychain). */
export async function createTempJacklineHome(): Promise<{
  paths: JacklinePaths;
  masterKey: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "jackline-cli-test-"));
  const paths = getJacklinePaths(root);
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

export async function createTempJacklineHomeWithGatewayToken(): Promise<{
  paths: JacklinePaths;
  token: string;
}> {
  const { paths } = await createTempJacklineHome();
  const token = await mintGatewayToken(paths);
  return { paths, token };
}
