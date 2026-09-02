import { createServer } from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type IntegrationStack = {
  apiUrl: string;
  gatewayUrl: string;
  webOrigin: string;
  databaseUrl: string;
  stop: () => Promise<void>;
};

let sharedStack: IntegrationStack | undefined;
let starting: Promise<IntegrationStack> | undefined;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

function runMigrate(databaseUrl: string): void {
  const result = spawnSync("pnpm", ["--filter", "@jackline/db", "migrate"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `database migrate failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
}

function spawnService(
  packageName: string,
  env: Record<string, string>,
): ChildProcess {
  const child = spawn("pnpm", ["--filter", packageName, "start"], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    if (process.env["INTEGRATION_DEBUG"] === "1") {
      process.stdout.write(chunk);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (process.env["INTEGRATION_DEBUG"] === "1") {
      process.stderr.write(chunk);
    }
  });

  return child;
}

async function startManagedStack(): Promise<IntegrationStack> {
  const databaseUrl =
    process.env["INTEGRATION_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgresql://jackline:jackline@127.0.0.1:5432/jackline";

  process.env["DATABASE_URL"] = databaseUrl;
  runMigrate(databaseUrl);

  const apiPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const webOrigin = "http://127.0.0.1:5173";

  const serviceEnv: Record<string, string> = {
    NODE_ENV: "test",
    LOG_LEVEL: process.env["INTEGRATION_DEBUG"] === "1" ? "info" : "silent",
    JACKLINE_TENANCY: "multi",
    JACKLINE_MASTER_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    DATABASE_URL: databaseUrl,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: String(gatewayPort),
    WEB_ORIGIN: webOrigin,
    BETTER_AUTH_URL: `http://127.0.0.1:${apiPort}`,
    JACKLINE_INTERNAL_MCP_URL: `http://127.0.0.1:${gatewayPort}/mcp`,
    EMAIL_CONNECTOR: "console",
  };

  for (const [key, value] of Object.entries(serviceEnv)) {
    process.env[key] = value;
  }

  const apiProc = spawnService("@jackline/api", serviceEnv);
  const gatewayProc = spawnService("@jackline/gateway", serviceEnv);

  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  try {
    await waitForHealth(`${apiUrl}/health`);
    await waitForHealth(`${gatewayUrl}/health`);
  } catch (err) {
    apiProc.kill("SIGTERM");
    gatewayProc.kill("SIGTERM");
    throw err;
  }

  const stop = async () => {
    for (const proc of [apiProc, gatewayProc]) {
      if (proc.exitCode == null && proc.signalCode == null) {
        proc.kill("SIGTERM");
      }
    }
    await Promise.all(
      [apiProc, gatewayProc].map(
        (proc) =>
          new Promise<void>((resolve) => {
            if (proc.exitCode != null) {
              resolve();
              return;
            }
            proc.once("exit", () => resolve());
            setTimeout(() => {
              if (proc.exitCode == null) proc.kill("SIGKILL");
              resolve();
            }, 5_000);
          }),
      ),
    );
  };

  return { apiUrl, gatewayUrl, webOrigin, databaseUrl, stop };
}

async function startExternalStack(): Promise<IntegrationStack> {
  const apiUrl = process.env["INTEGRATION_API_URL"]!;
  const gatewayUrl = process.env["INTEGRATION_GATEWAY_URL"]!;
  const webOrigin =
    process.env["INTEGRATION_ORIGIN"] ?? "http://127.0.0.1:5173";

  await waitForHealth(`${apiUrl}/health`);
  await waitForHealth(`${gatewayUrl}/health`);

  const databaseUrl =
    process.env["INTEGRATION_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "";
  if (databaseUrl) {
    process.env["DATABASE_URL"] = databaseUrl;
  }

  return {
    apiUrl,
    gatewayUrl,
    webOrigin,
    databaseUrl,
    stop: async () => {},
  };
}

async function startIntegrationStack(): Promise<IntegrationStack> {
  if (
    process.env["INTEGRATION_API_URL"] &&
    process.env["INTEGRATION_GATEWAY_URL"]
  ) {
    return startExternalStack();
  }
  return startManagedStack();
}

/** Shared live stack for all integration test files in one run. */
export async function integrationStack(): Promise<IntegrationStack> {
  if (sharedStack) return sharedStack;
  starting ??= startIntegrationStack().then((stack) => {
    sharedStack = stack;
    return stack;
  });
  return starting;
}

export async function stopIntegrationStack(): Promise<void> {
  if (!sharedStack) return;
  await sharedStack.stop();
  sharedStack = undefined;
  starting = undefined;
}
