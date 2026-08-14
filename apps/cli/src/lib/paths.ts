import path from "node:path";
import { homedir } from "node:os";

export type MeshPaths = {
  root: string;
  config: string;
  masterKey: string;
  secrets: string;
};

export function getMeshPaths(rootDir?: string): MeshPaths {
  const root = rootDir ?? path.join(homedir(), ".mesh");
  return {
    root,
    config: path.join(root, "config.yaml"),
    masterKey: path.join(root, "master.key"),
    secrets: path.join(root, "secrets.json"),
  };
}

export const DEFAULT_CONFIG = {
  version: 1 as const,
  port: 8081,
  servers: [] as MeshConfigServer[],
};

export type MeshConfigServer = {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: "api_key" | "oauth" | "mtls";
  secretId: string;
  connectorKey: string | null;
  /** Upstream tool names hidden from the Mesh gateway (opt-out; default all on). */
  disabledTools?: string[] | undefined;
};

export type MeshConfig = {
  version: 1;
  port: number;
  /** Where the AES master key is kept. Default / preferred: OS keychain. */
  keyStorage?: "keychain" | "file" | undefined;
  /** Secret id for the long-lived local MCP gateway bearer token. */
  gatewayTokenSecretId?: string | undefined;
  servers: MeshConfigServer[];
};

export const DEFAULT_CONFIG_YAML = `\
# Personal Mesh configuration
version: 1
port: 8081
keyStorage: keychain
servers: []
# gatewayTokenSecretId is set by mesh init / first mesh serve
`;

export function defaultConfigYaml(keyStorage: "keychain" | "file"): string {
  return `\
# Personal Mesh configuration
version: 1
port: 8081
keyStorage: ${keyStorage}
servers: []
# gatewayTokenSecretId is set by mesh init / first mesh serve
`;
}