import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePostgresUrl } from "@jackline/shared";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type QuotaTestApi = {
  apiUrl: string;
  stop: () => Promise<void>;
};

export type QuotaTestStack = {
  apiUrl: string;
  gatewayUrl: string;
  webOrigin: string;
  stop: () => Promise<void>;
};

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
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
    if (process.env["INTEGRATION_DEBUG"] === "1") process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (process.env["INTEGRATION_DEBUG"] === "1") process.stderr.write(chunk);
  });

  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode == null && child.signalCode == null) {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode != null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    setTimeout(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
  });
}

/**
 * API-only process with tight rate limits for quota integration tests.
 * Kept separate from the shared stack so other suites keep normal defaults.
 */
export async function startQuotaTestApi(
  overrides: Record<string, string> = {},
): Promise<QuotaTestApi> {
  const databaseUrl = resolvePostgresUrl(process.env);
  if (!databaseUrl) {
    throw new Error(
      "Set DATABASE_URL or POSTGRES_* (see .env.example and README)",
    );
  }

  const apiPort = await getFreePort();
  const webOrigin = "http://127.0.0.1:5173";

  const env: Record<string, string> = {
    NODE_ENV: "test",
    LOG_LEVEL: process.env["INTEGRATION_DEBUG"] === "1" ? "info" : "silent",
    JACKLINE_TENANCY: "multi",
    JACKLINE_MASTER_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    DATABASE_URL: databaseUrl,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: "18081",
    WEB_ORIGIN: webOrigin,
    BETTER_AUTH_URL: `http://127.0.0.1:${apiPort}`,
    EMAIL_CONNECTOR: "console",
    JACKLINE_RL_API_AUTH_LIMIT: "3",
    JACKLINE_RL_API_AUTH_WINDOW: "60s",
    ...overrides,
  };

  const child = spawnService("@jackline/api", env);
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  try {
    await waitForHealth(`${apiUrl}/health`);
  } catch (err) {
    await stopChild(child);
    throw err;
  }

  return {
    apiUrl,
    stop: async () => {
      await stopChild(child);
    },
  };
}

/**
 * API + gateway with tight gateway.mcp limits for deny-audit tests.
 */
export async function startQuotaTestStack(
  overrides: Record<string, string> = {},
): Promise<QuotaTestStack> {
  const databaseUrl = resolvePostgresUrl(process.env);
  if (!databaseUrl) {
    throw new Error(
      "Set DATABASE_URL or POSTGRES_* (see .env.example and README)",
    );
  }

  const apiPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const webOrigin = "http://127.0.0.1:5173";

  const env: Record<string, string> = {
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
    JACKLINE_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
    JACKLINE_PUBLIC_MCP_URL: `http://127.0.0.1:${gatewayPort}/mcp`,
    JACKLINE_INTERNAL_MCP_URL: `http://127.0.0.1:${gatewayPort}/mcp`,
    EMAIL_CONNECTOR: "console",
    JACKLINE_RL_GATEWAY_MCP_LIMIT: "3",
    JACKLINE_RL_GATEWAY_MCP_WINDOW: "60s",
    ...overrides,
  };

  const apiProc = spawnService("@jackline/api", env);
  const gatewayProc = spawnService("@jackline/gateway", env);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  try {
    await waitForHealth(`${apiUrl}/health`);
    await waitForHealth(`${gatewayUrl}/health`);
  } catch (err) {
    await stopChild(apiProc);
    await stopChild(gatewayProc);
    throw err;
  }

  return {
    apiUrl,
    gatewayUrl,
    webOrigin,
    stop: async () => {
      await stopChild(apiProc);
      await stopChild(gatewayProc);
    },
  };
}
