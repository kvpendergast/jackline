import path from "node:path";
import { homedir } from "node:os";

export type JacklinePaths = {
  root: string;
  config: string;
  masterKey: string;
  secrets: string;
};

export function getJacklinePaths(rootDir?: string): JacklinePaths {
  const root = rootDir ?? path.join(homedir(), ".jackline");
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
  servers: [] as JacklineConfigServer[],
};

export type JacklineConfigServer = {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: "api_key" | "oauth" | "mtls";
  secretId: string;
  connectorKey: string | null;
  /** Upstream tool names hidden from the Jackline gateway (opt-out; default all on). */
  disabledTools?: string[] | undefined;
};

export type JacklineConfig = {
  version: 1;
  port: number;
  /** Where the AES master key is kept. Default / preferred: OS keychain. */
  keyStorage?: "keychain" | "file" | undefined;
  /** Secret id for the long-lived local MCP gateway bearer token. */
  gatewayTokenSecretId?: string | undefined;
  servers: JacklineConfigServer[];
};

export const DEFAULT_CONFIG_YAML = `\
# Personal Jackline configuration
version: 1
port: 8081
keyStorage: keychain
servers: []
# gatewayTokenSecretId is set by jackline init / first jackline serve
`;

export function defaultConfigYaml(keyStorage: "keychain" | "file"): string {
  return `\
# Personal Jackline configuration
version: 1
port: 8081
keyStorage: ${keyStorage}
servers: []
# gatewayTokenSecretId is set by jackline init / first jackline serve
`;
}