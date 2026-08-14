import { access, readFile, writeFile } from "node:fs/promises";
import { createSecretBox } from "@mesh/crypto";
import { z } from "zod";
import { readMasterKey } from "./masterKey.js";
import { getMeshPaths, type MeshPaths } from "./paths.js";

const StoredSecretSchema = z.object({
  kind: z.enum(["api_key", "oauth", "gateway_token"]),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  keyVersion: z.number().int().positive(),
});

const SecretsFileSchema = z.object({
  version: z.literal(1),
  secrets: z.record(z.string(), StoredSecretSchema),
});

export type StoredSecretMeta = z.infer<typeof StoredSecretSchema>;
export type SecretsFile = z.infer<typeof SecretsFileSchema>;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getBox(masterKey: string) {
  const box = createSecretBox({
    secretStorageLocation: "local",
    base64MeshMasterKey: masterKey,
    keyVersion: 1,
  });
  if (box.isErr()) {
    throw new Error(box.error.message);
  }
  return box.value;
}

export async function loadSecretsFile(
  paths?: MeshPaths,
): Promise<SecretsFile> {
  const p = paths ?? getMeshPaths();
  if (!(await pathExists(p.secrets))) {
    return { version: 1, secrets: {} };
  }
  const raw = JSON.parse(await readFile(p.secrets, "utf8")) as unknown;
  const parsed = SecretsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid secrets file at ${p.secrets}`);
  }
  return parsed.data;
}

async function saveSecretsFile(
  file: SecretsFile,
  paths: MeshPaths,
): Promise<void> {
  await writeFile(paths.secrets, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function putSecret(
  input: {
    secretId: string;
    kind: "api_key" | "oauth" | "gateway_token";
    plaintext: string;
  },
  paths?: MeshPaths,
): Promise<void> {
  const p = paths ?? getMeshPaths();
  const masterKey = await readMasterKey(p);
  const box = getBox(masterKey);
  const aad = new TextEncoder().encode(`mesh:secret:${input.secretId}`);
  const encrypted = box.encrypt(new TextEncoder().encode(input.plaintext), aad);
  if (encrypted.isErr()) {
    throw new Error(encrypted.error.message);
  }

  const file = await loadSecretsFile(p);
  file.secrets[input.secretId] = {
    kind: input.kind,
    ciphertext: Buffer.from(encrypted.value.ciphertext).toString("base64"),
    nonce: Buffer.from(encrypted.value.nonce).toString("base64"),
    keyVersion: encrypted.value.keyVersion,
  };
  await saveSecretsFile(file, p);
}

export async function getSecretPlaintext(
  secretId: string,
  paths?: MeshPaths,
): Promise<{ kind: "api_key" | "oauth" | "gateway_token"; value: string }> {
  const p = paths ?? getMeshPaths();
  const file = await loadSecretsFile(p);
  const row = file.secrets[secretId];
  if (!row) {
    throw new Error(`Secret not found: ${secretId}`);
  }
  const masterKey = await readMasterKey(p);
  const box = getBox(masterKey);
  const aad = new TextEncoder().encode(`mesh:secret:${secretId}`);
  const decrypted = box.decrypt(
    {
      ciphertext: Buffer.from(row.ciphertext, "base64"),
      nonce: Buffer.from(row.nonce, "base64"),
      keyVersion: row.keyVersion,
    },
    aad,
  );
  if (decrypted.isErr()) {
    throw new Error(decrypted.error.message);
  }
  return {
    kind: row.kind,
    value: new TextDecoder().decode(decrypted.value),
  };
}

export async function deleteSecret(
  secretId: string,
  paths?: MeshPaths,
): Promise<void> {
  const p = paths ?? getMeshPaths();
  const file = await loadSecretsFile(p);
  if (!(secretId in file.secrets)) return;
  delete file.secrets[secretId];
  await saveSecretsFile(file, p);
}
