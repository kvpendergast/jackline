import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { formatEnvParseError } from "./formatEnvError.js";
import { loadConfig } from "./load.js";

describe("formatEnvParseError", () => {
  it("lists missing fields with setup hints", () => {
    const schema = z.object({
      JACKLINE_MASTER_KEY: z.string().min(1),
      BETTER_AUTH_SECRET: z.string().min(1),
    });
    const parsed = schema.safeParse({
      JACKLINE_MASTER_KEY: "",
      BETTER_AUTH_SECRET: "",
    });
    assert.equal(parsed.success, false);
    if (parsed.success) return;

    const message = formatEnvParseError(parsed.error);
    assert.match(message, /Invalid Jackline environment/);
    assert.match(message, /JACKLINE_MASTER_KEY/);
    assert.match(message, /openssl rand -base64 32/);
  });
});

describe("loadConfig", () => {
  it("fails fast with actionable message when secrets are empty", () => {
    const result = loadConfig({
      JACKLINE_MASTER_KEY: "",
      BETTER_AUTH_SECRET: "",
      DATABASE_URL: "postgresql://jackline:jackline@127.0.0.1:5432/jackline",
      BETTER_AUTH_URL: "http://127.0.0.1:8080",
      WEB_ORIGIN: "http://127.0.0.1:5173",
    });

    assert.equal(result.isErr(), true);
    if (result.isOk()) return;
    assert.match(result.error.message, /JACKLINE_MASTER_KEY/);
    assert.match(result.error.message, /BETTER_AUTH_SECRET/);
  });

  it("accepts a minimal valid local config", () => {
    const result = loadConfig({
      JACKLINE_MASTER_KEY: "dGVzdC1tYXN0ZXIta2V5LTEyMzQ1Njc4OTA=",
      BETTER_AUTH_SECRET: "test-better-auth-secret-32chars!!",
      DATABASE_URL: "postgresql://jackline:jackline@127.0.0.1:5432/jackline",
      BETTER_AUTH_URL: "http://127.0.0.1:8080",
      WEB_ORIGIN: "http://127.0.0.1:5173",
    });

    assert.equal(result.isOk(), true);
  });
});
