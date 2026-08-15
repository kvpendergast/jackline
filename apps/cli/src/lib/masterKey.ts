import { access, readFile, rename, writeFile } from "node:fs/promises";
import { consola } from "consola";
import { loadConfig, saveConfig } from "./config.js";
import {
  fileKeyOptOutWarning,
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainSet,
  type KeyStorage,
} from "./keychain.js";
import { getJacklinePaths, type JacklinePaths } from "./paths.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileMasterKey(paths: JacklinePaths): Promise<string> {
  if (!(await pathExists(paths.masterKey))) {
    throw new Error(
      `No master key at ${paths.masterKey}. Run \`jackline init\` first.`,
    );
  }
  const key = (await readFile(paths.masterKey, "utf8")).trim();
  if (!key) {
    throw new Error(`Master key file is empty: ${paths.masterKey}`);
  }
  return key;
}

async function writeFileMasterKey(
  paths: JacklinePaths,
  masterKey: string,
): Promise<void> {
  await writeFile(paths.masterKey, `${masterKey}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function resolveKeyStorage(paths: JacklinePaths): Promise<KeyStorage> {
  try {
    const config = await loadConfig(paths);
    if (config.keyStorage === "file" || config.keyStorage === "keychain") {
      return config.keyStorage;
    }
  } catch {
    // Config may not exist yet during init.
  }
  // Legacy installs: plaintext master.key without keyStorage field.
  if (await pathExists(paths.masterKey)) return "file";
  return "keychain";
}

/**
 * Persist a newly minted master key. Default is OS keychain.
 * `--file-key` / keyStorage file writes ~/.jackline/master.key (with warning).
 */
export async function storeMasterKey(
  masterKey: string,
  paths: JacklinePaths,
  options: { keyStorage: KeyStorage; warnOnFile?: boolean },
): Promise<KeyStorage> {
  if (options.keyStorage === "file") {
    if (options.warnOnFile !== false) {
      consola.warn(fileKeyOptOutWarning(paths.masterKey));
    }
    await writeFileMasterKey(paths, masterKey);
    return "file";
  }

  if (!(await isKeychainAvailable())) {
    throw new Error(
      "OS keychain is unavailable on this system. " +
        "Install the platform credential helper, or re-run with `--file-key` " +
        "to store the master key on disk (less secure).",
    );
  }

  await keychainSet(paths, masterKey);
  // Remove any leftover plaintext file from a previous install.
  if (await pathExists(paths.masterKey)) {
    await rename(paths.masterKey, `${paths.masterKey}.migrated`);
    consola.info(
      `Moved plaintext master key aside to ${paths.masterKey}.migrated (safe to delete).`,
    );
  }
  return "keychain";
}

/**
 * Load the master key, migrating legacy plaintext files into the keychain
 * when keyStorage is keychain (or unset and keychain is available).
 */
export async function readMasterKey(paths?: JacklinePaths): Promise<string> {
  const p = paths ?? getJacklinePaths();
  const storage = await resolveKeyStorage(p);

  if (storage === "file") {
    return readFileMasterKey(p);
  }

  // Preferred: keychain
  if (await isKeychainAvailable()) {
    const fromChain = await keychainGet(p);
    if (fromChain) return fromChain;

    // Migrate legacy plaintext master.key → keychain.
    if (await pathExists(p.masterKey)) {
      const legacy = await readFileMasterKey(p);
      await keychainSet(p, legacy);
      try {
        const config = await loadConfig(p);
        if (config.keyStorage !== "keychain") {
          await saveConfig({ ...config, keyStorage: "keychain" }, p);
        }
      } catch {
        // Config update is best-effort during migration.
      }
      await rename(p.masterKey, `${p.masterKey}.migrated`);
      consola.success(
        `Migrated master key from ${p.masterKey} into the OS keychain.`,
      );
      consola.info(
        `Plaintext copy kept at ${p.masterKey}.migrated — delete it after confirming Jackline works.`,
      );
      return legacy;
    }

    throw new Error(
      `No master key in the OS keychain for ${p.root}. Run \`jackline init\` first.`,
    );
  }

  // Keychain configured/expected but unavailable — fall back to file if present.
  if (await pathExists(p.masterKey)) {
    consola.warn(
      "OS keychain unavailable; using plaintext master.key on disk. " +
        "Restore keychain access or re-init with `--file-key` deliberately.",
    );
    return readFileMasterKey(p);
  }

  throw new Error(
    "OS keychain is unavailable and no master.key file was found. " +
      "Run `jackline init` (or `jackline init --file-key` on systems without a keychain).",
  );
}

export async function masterKeyExists(paths: JacklinePaths): Promise<boolean> {
  if (await pathExists(paths.masterKey)) return true;
  if (!(await isKeychainAvailable())) return false;
  try {
    return (await keychainGet(paths)) !== null;
  } catch {
    return false;
  }
}

export async function clearStoredMasterKey(paths: JacklinePaths): Promise<void> {
  if (await isKeychainAvailable()) {
    try {
      await keychainDelete(paths);
    } catch {
      // Best-effort on re-init --force.
    }
  }
  if (await pathExists(paths.masterKey)) {
    await rename(paths.masterKey, `${paths.masterKey}.bak`);
  }
}
