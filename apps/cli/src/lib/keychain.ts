import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { platform } from "node:os";
import { promisify } from "node:util";
import type { JacklinePaths } from "./paths.js";

const execFileAsync = promisify(execFile);

/** Stable service name in OS credential stores. */
export const JACKLINE_KEYCHAIN_SERVICE = "jackline-cli";

export type KeyStorage = "keychain" | "file";

export function masterKeyAccount(paths: JacklinePaths): string {
  const id = createHash("sha256").update(paths.root).digest("hex").slice(0, 16);
  return `master-key:${id}`;
}

export type KeychainErrorCode =
  | "unsupported"
  | "unavailable"
  | "not_found"
  | "failed";

export class KeychainError extends Error {
  readonly code: KeychainErrorCode;

  constructor(code: KeychainErrorCode, message: string) {
    super(message);
    this.name = "KeychainError";
    this.code = code;
  }
}

function whichHint(): string {
  const os = platform();
  if (os === "linux") {
    return "Install libsecret tools (e.g. `sudo apt install libsecret-tools`) or use `--file-key`.";
  }
  if (os === "darwin") {
    return "macOS Keychain should be available via the `security` tool.";
  }
  if (os === "win32") {
    return "Windows Credential Manager should be available via PowerShell.";
  }
  return "Use `--file-key` to store the master key on disk instead.";
}

async function commandExists(command: string): Promise<boolean> {
  try {
    if (platform() === "win32") {
      await execFileAsync("where", [command]);
    } else {
      await execFileAsync("which", [command]);
    }
    return true;
  } catch {
    return false;
  }
}

async function darwinSet(account: string, secret: string): Promise<void> {
  // -U updates if the item already exists.
  await execFileAsync("security", [
    "add-generic-password",
    "-a",
    account,
    "-s",
    JACKLINE_KEYCHAIN_SERVICE,
    "-w",
    secret,
    "-U",
  ]);
}

async function darwinGet(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      account,
      "-s",
      JACKLINE_KEYCHAIN_SERVICE,
      "-w",
    ]);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function darwinDelete(account: string): Promise<void> {
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-a",
      account,
      "-s",
      JACKLINE_KEYCHAIN_SERVICE,
    ]);
  } catch {
    // Already missing is fine.
  }
}

async function linuxSet(account: string, secret: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "secret-tool",
      [
        "store",
        "--label",
        "Jackline CLI master key",
        "service",
        JACKLINE_KEYCHAIN_SERVICE,
        "account",
        account,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            stderr.trim() || `secret-tool store exited with code ${code}`,
          ),
        );
      }
    });
    child.stdin?.end(secret, "utf8");
  });
}

async function linuxGet(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service",
      JACKLINE_KEYCHAIN_SERVICE,
      "account",
      account,
    ]);
    const value = stdout.replace(/\n$/, "");
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function linuxDelete(account: string): Promise<void> {
  try {
    await execFileAsync("secret-tool", [
      "clear",
      "service",
      JACKLINE_KEYCHAIN_SERVICE,
      "account",
      account,
    ]);
  } catch {
    // Already missing is fine.
  }
}

function windowsTarget(account: string): string {
  return `${JACKLINE_KEYCHAIN_SERVICE}/${account}`;
}

async function windowsRun(
  operation: "set" | "get" | "delete",
  account: string,
  secret?: string,
): Promise<string> {
  const target = windowsTarget(account);
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class JacklineCredNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32", SetLastError = true)]
  public static extern bool CredFree(IntPtr cred);
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, uint type, uint flags);
}
"@
$op = $env:JACKLINE_KC_OP
$target = $env:JACKLINE_KC_TARGET
$user = $env:JACKLINE_KC_USER
if ($op -eq 'set') {
  $secret = $env:JACKLINE_KC_SECRET
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
  $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
    $cred = New-Object JacklineCredNative+CREDENTIAL
    $cred.Type = 1
    $cred.TargetName = $target
    $cred.UserName = $user
    $cred.CredentialBlobSize = [uint32]$bytes.Length
    $cred.CredentialBlob = $ptr
    $cred.Persist = 2
    if (-not [JacklineCredNative]::CredWrite([ref]$cred, 0)) {
      throw "CredWrite failed: $([ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  }
} elseif ($op -eq 'get') {
  $ptr = [IntPtr]::Zero
  if (-not [JacklineCredNative]::CredRead($target, 1, 0, [ref]$ptr)) {
    exit 2
  }
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][JacklineCredNative+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
  } finally {
    [JacklineCredNative]::CredFree($ptr) | Out-Null
  }
} elseif ($op -eq 'delete') {
  [JacklineCredNative]::CredDelete($target, 1, 0) | Out-Null
}
`;

  const env = {
    ...process.env,
    JACKLINE_KC_OP: operation,
    JACKLINE_KC_TARGET: target,
    JACKLINE_KC_USER: account,
    ...(secret !== undefined ? { JACKLINE_KC_SECRET: secret } : {}),
  };

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env },
    );
    return stdout;
  } catch (cause) {
    const err = cause as { code?: number | string; status?: number };
    if (operation === "get" && (err.code === 2 || err.status === 2)) {
      return "";
    }
    throw cause;
  }
}

/**
 * True when the current OS has a usable credential-store backend.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  const os = platform();
  if (os === "darwin") return commandExists("security");
  if (os === "linux") return commandExists("secret-tool");
  if (os === "win32") return commandExists("powershell.exe");
  return false;
}

export async function keychainSet(
  paths: JacklinePaths,
  secret: string,
): Promise<void> {
  const account = masterKeyAccount(paths);
  const os = platform();
  try {
    if (os === "darwin") {
      await darwinSet(account, secret);
      return;
    }
    if (os === "linux") {
      await linuxSet(account, secret);
      return;
    }
    if (os === "win32") {
      await windowsRun("set", account, secret);
      return;
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new KeychainError(
      "failed",
      `Failed to store master key in the OS keychain: ${detail}. ${whichHint()}`,
    );
  }
  throw new KeychainError(
    "unsupported",
    `OS keychain is not supported on this platform (${os}). ${whichHint()}`,
  );
}

export async function keychainGet(paths: JacklinePaths): Promise<string | null> {
  const account = masterKeyAccount(paths);
  const os = platform();
  try {
    if (os === "darwin") return darwinGet(account);
    if (os === "linux") return linuxGet(account);
    if (os === "win32") {
      const value = (await windowsRun("get", account)).trim();
      return value.length > 0 ? value : null;
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new KeychainError(
      "failed",
      `Failed to read master key from the OS keychain: ${detail}. ${whichHint()}`,
    );
  }
  throw new KeychainError(
    "unsupported",
    `OS keychain is not supported on this platform (${os}). ${whichHint()}`,
  );
}

export async function keychainDelete(paths: JacklinePaths): Promise<void> {
  const account = masterKeyAccount(paths);
  const os = platform();
  try {
    if (os === "darwin") {
      await darwinDelete(account);
      return;
    }
    if (os === "linux") {
      await linuxDelete(account);
      return;
    }
    if (os === "win32") {
      await windowsRun("delete", account);
      return;
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new KeychainError(
      "failed",
      `Failed to delete master key from the OS keychain: ${detail}`,
    );
  }
}

export function fileKeyOptOutWarning(masterKeyPath: string): string {
  return (
    `Storing the Jackline master key as a plaintext file at ${masterKeyPath}. ` +
    "Anyone who can read that file can decrypt your Jackline secrets " +
    "(API keys, OAuth tokens, gateway bearer). " +
    "Prefer the default OS keychain storage unless you have a specific reason to opt out."
  );
}
