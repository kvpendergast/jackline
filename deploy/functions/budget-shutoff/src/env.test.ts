import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingShutoffEnv, parseDryRun, readShutoffEnv } from "./env.js";

describe("parseDryRun", () => {
  it("treats common truthy values as dry run", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      assert.equal(parseDryRun(value), true, value);
    }
  });

  it("treats everything else as live", () => {
    for (const value of [undefined, "", "0", "false", "no", "off", "maybe"]) {
      assert.equal(parseDryRun(value), false, String(value));
    }
  });
});

describe("readShutoffEnv", () => {
  it("reads the function env vars", () => {
    const env = readShutoffEnv({
      GCP_PROJECT: "mesh-505410",
      VM_NAME: "jackline",
      VM_ZONE: "us-central1-a",
      SQL_INSTANCE: "jackline-db",
      DRY_RUN: "true",
    });
    assert.deepEqual(env, {
      project: "mesh-505410",
      vmName: "jackline",
      vmZone: "us-central1-a",
      sqlInstance: "jackline-db",
      dryRun: true,
    });
    assert.deepEqual(missingShutoffEnv(env), []);
  });

  it("falls back to GOOGLE_CLOUD_PROJECT", () => {
    const env = readShutoffEnv({ GOOGLE_CLOUD_PROJECT: "mesh-505410" });
    assert.equal(env.project, "mesh-505410");
    assert.deepEqual(missingShutoffEnv(env), [
      "VM_NAME",
      "VM_ZONE",
      "SQL_INSTANCE",
    ]);
  });
});
