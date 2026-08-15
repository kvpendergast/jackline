/**
 * Export the Jackline OpenAPI document for Zudoku (and other docs tooling).
 *
 * Writes apps/docs/apis/openapi.json from the live Hono OpenAPI registry —
 * no running server required.
 *
 *   pnpm --filter @jackline/api openapi:export
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@jackline/shared";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnvFile(path.join(root, ".env"));
const configResult = loadConfig();
if (configResult.isErr()) throw configResult.error;

const { initAuth } = await import("@jackline/auth");
await initAuth();
const { app } = await import("../src/app.js");

const document = app.getOpenAPIDocument({
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Jackline API",
    description:
      "Jackline control-plane API. Authenticate with a browser session cookie (admin UI) or an OAuth2 client_credentials access token (public/machine API).",
  },
  servers: [
    {
      url: "http://127.0.0.1:8080",
      description: "Local development",
    },
  ],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
});

const outDir = path.join(root, "apps/docs/apis");
const outFile = path.join(outDir, "openapi.json");
await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");

const pathCount = Object.keys(document.paths ?? {}).length;
console.log(`Wrote ${outFile} (${pathCount} paths)`);
