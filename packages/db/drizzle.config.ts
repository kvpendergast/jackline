import { defineConfig } from "drizzle-kit";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/db → repo root
loadEnvFile(path.resolve(__dirname, "../../.env"));

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
});