import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  formatGatewayToken,
  GATEWAY_TOKEN_KIND,
  parseGatewayToken,
} from "@mesh/shared";
import { loadConfig, saveConfig } from "./config.js";
import { getMeshPaths, type MeshPaths } from "./paths.js";
import { getSecretPlaintext, putSecret } from "./secrets.js";

export type PersonalMcpClientConfig = {
  url: string;
  headers: {
    Authorization: string;
  };
};

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function extractBearer(
  authorization: string | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function personalMcpClientConfig(
  host: string,
  port: number,
  token: string,
): PersonalMcpClientConfig {
  return {
    url: `http://${host}:${port}/mcp`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

export function cursorMcpSettingsSnippet(
  host: string,
  port: number,
  token: string,
): string {
  return JSON.stringify(
    {
      mcpServers: {
        mesh: personalMcpClientConfig(host, port, token),
      },
    },
    null,
    2,
  );
}

/**
 * Mint a new long-lived local gateway token (`msh_<id>.<secret>`), store the
 * secret encrypted in secrets.json, and persist the secret id in config.yaml.
 */
export async function mintGatewayToken(
  paths?: MeshPaths,
): Promise<string> {
  const p = paths ?? getMeshPaths();
  const config = await loadConfig(p);
  const secretId = randomUUID();
  const secret = randomBytes(32).toString("base64url");

  await putSecret(
    {
      secretId,
      kind: GATEWAY_TOKEN_KIND,
      plaintext: secret,
    },
    p,
  );

  await saveConfig(
    {
      ...config,
      gatewayTokenSecretId: secretId,
    },
    p,
  );

  return formatGatewayToken(secretId, secret);
}

/**
 * Return the existing gateway token, or mint one if this ~/.mesh predates auth.
 */
export async function ensureGatewayToken(
  paths?: MeshPaths,
): Promise<{ token: string; created: boolean }> {
  const p = paths ?? getMeshPaths();
  const config = await loadConfig(p);
  const secretId = config.gatewayTokenSecretId;

  if (secretId) {
    try {
      const stored = await getSecretPlaintext(secretId, p);
      if (stored.kind === GATEWAY_TOKEN_KIND) {
        return {
          token: formatGatewayToken(secretId, stored.value),
          created: false,
        };
      }
    } catch {
      // Missing/corrupt secret — mint a replacement below.
    }
  }

  const token = await mintGatewayToken(p);
  return { token, created: true };
}

export async function loadGatewayToken(
  paths?: MeshPaths,
): Promise<string> {
  const p = paths ?? getMeshPaths();
  const config = await loadConfig(p);
  const secretId = config.gatewayTokenSecretId;
  if (!secretId) {
    throw new Error(
      `No gateway token in ${p.config}. Run \`mesh serve\` or \`mesh init\` first.`,
    );
  }
  const stored = await getSecretPlaintext(secretId, p);
  if (stored.kind !== GATEWAY_TOKEN_KIND) {
    throw new Error(
      `Secret ${secretId} is not a gateway token. Re-run \`mesh serve\` to mint one.`,
    );
  }
  return formatGatewayToken(secretId, stored.value);
}

/**
 * Validate Authorization against the local gateway token.
 * Invalid/missing → false (callers map to 401; no existence leak).
 */
export async function verifyGatewayAuthorization(
  authorization: string | undefined,
  paths?: MeshPaths,
): Promise<boolean> {
  const p = paths ?? getMeshPaths();
  const bearer = extractBearer(authorization);
  if (!bearer) return false;

  const parsed = parseGatewayToken(bearer);
  if (parsed.isErr()) return false;

  let expected: string;
  try {
    expected = await loadGatewayToken(p);
  } catch {
    return false;
  }

  const expectedParsed = parseGatewayToken(expected);
  if (expectedParsed.isErr()) return false;

  if (parsed.value.secretId !== expectedParsed.value.secretId) {
    return false;
  }

  return safeEqualString(parsed.value.secret, expectedParsed.value.secret);
}
