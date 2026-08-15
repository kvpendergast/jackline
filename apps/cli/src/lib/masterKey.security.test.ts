import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import {
  fileKeyOptOutWarning,
  isKeychainAvailable,
  masterKeyAccount,
} from "./keychain.js";
import {
  readMasterKey,
  storeMasterKey,
} from "./masterKey.js";
import { getSecretPlaintext, putSecret } from "./secrets.js";
import { loadConfig, saveConfig } from "./config.js";
import { createTempJacklineHome } from "../test/helpers.js";
import { defaultConfigYaml, getJacklinePaths } from "./paths.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("file-key master key storage", () => {
  it("warns clearly when opting out of keychain", () => {
    const message = fileKeyOptOutWarning("/tmp/example/master.key");
    assert.match(message, /plaintext file/i);
    assert.match(message, /master\.key/);
    assert.match(message, /keychain/i);
  });

  it("stores and reads a file-backed master key", async () => {
    const { paths, masterKey } = await createTempJacklineHome();
    await access(paths.masterKey);
    const loaded = await readMasterKey(paths);
    assert.equal(loaded, masterKey);

    const config = await loadConfig(paths);
    assert.equal(config.keyStorage, "file");
  });

  it("encrypts secrets with the file-backed master key", async () => {
    const { paths } = await createTempJacklineHome();
    const secretId = "11111111-1111-4111-8111-111111111111";
    await putSecret(
      {
        secretId,
        kind: "api_key",
        plaintext: "super-secret-value",
      },
      paths,
    );
    const got = await getSecretPlaintext(secretId, paths);
    assert.equal(got.kind, "api_key");
    assert.equal(got.value, "super-secret-value");

    const raw = await readFile(paths.secrets, "utf8");
    assert.equal(raw.includes("super-secret-value"), false);
  });

  it("uses a distinct keychain account per config directory", () => {
    const a = masterKeyAccount(getJacklinePaths("/tmp/jackline-a"));
    const b = masterKeyAccount(getJacklinePaths("/tmp/jackline-b"));
    assert.match(a, /^master-key:[0-9a-f]{16}$/);
    assert.notEqual(a, b);
  });
});

describe("legacy master.key migration", () => {
  it("migrates plaintext master.key into the keychain when available", async (t) => {
    if (!(await isKeychainAvailable())) {
      t.skip("OS keychain / secret-tool not available in this environment");
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "jackline-cli-migrate-"));
    const paths = getJacklinePaths(root);
    const masterKey = randomBytes(32).toString("base64");

    // Legacy layout: master.key on disk, no keyStorage field.
    await writeFile(
      paths.secrets,
      `${JSON.stringify({ version: 1, secrets: {} }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(paths.masterKey, `${masterKey}\n`, { mode: 0o600 });
    await writeFile(
      paths.config,
      `version: 1\nport: 8081\nservers: []\n`,
      { mode: 0o600 },
    );

    const loaded = await readMasterKey(paths);
    assert.equal(loaded, masterKey);

    // After migration the plaintext file should be moved aside.
    await assert.rejects(() => access(paths.masterKey));
    await access(`${paths.masterKey}.migrated`);

    const config = await loadConfig(paths);
    assert.equal(config.keyStorage, "keychain");

    // Subsequent reads come from the keychain.
    assert.equal(await readMasterKey(paths), masterKey);
  });

  it("keeps reading legacy file keys when keyStorage is file", async () => {
    const { paths, masterKey } = await createTempJacklineHome();
    await saveConfig(
      {
        ...(await loadConfig(paths)),
        keyStorage: "file",
      },
      paths,
    );
    assert.equal(await readMasterKey(paths), masterKey);
    await access(paths.masterKey);
  });
});

describe("keychain store path", () => {
  it("stores in the OS keychain when available", async (t) => {
    if (!(await isKeychainAvailable())) {
      t.skip("OS keychain / secret-tool not available in this environment");
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "jackline-cli-kc-"));
    const paths = getJacklinePaths(root);
    const masterKey = randomBytes(32).toString("base64");

    await writeFile(
      paths.secrets,
      `${JSON.stringify({ version: 1, secrets: {} }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await storeMasterKey(masterKey, paths, { keyStorage: "keychain" });
    await writeFile(paths.config, defaultConfigYaml("keychain"), {
      mode: 0o600,
    });

    assert.equal(await readMasterKey(paths), masterKey);
    await assert.rejects(() => access(paths.masterKey));
  });
});
