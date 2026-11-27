import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShutoffEnv } from "./env.js";
import type { InfraClient } from "./gcp.js";
import { handleBudgetEvent, type HandlerDeps } from "./handle.js";
import type { Logger } from "./log.js";

const liveEnv: ShutoffEnv = {
  project: "mesh-505410",
  vmName: "jackline",
  vmZone: "us-central1-a",
  sqlInstance: "jackline-db",
  dryRun: false,
};

function budgetEvent(overrides: Record<string, unknown> = {}): unknown {
  const payload = {
    budgetDisplayName: "Jackline monthly budget",
    costAmount: 10,
    budgetAmount: 35,
    currencyCode: "USD",
    budgetAmountType: "SPECIFIED_AMOUNT",
    costIntervalStart: "2026-11-01T00:00:00Z",
    ...overrides,
  };
  return {
    specversion: "1.0",
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    data: {
      message: {
        data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
        messageId: "m1",
      },
    },
  };
}

function recordingClient(initial: {
  vmStatus?: string;
  sqlPolicy?: string;
  stopVm?: () => Promise<void>;
  stopSql?: () => Promise<void>;
  getVmStatus?: () => Promise<string>;
  getSqlActivationPolicy?: () => Promise<string>;
}): {
  client: InfraClient;
  calls: string[];
} {
  const calls: string[] = [];
  const client: InfraClient = {
    getVmStatus: () => {
      calls.push("getVm");
      if (initial.getVmStatus) return initial.getVmStatus();
      return Promise.resolve(initial.vmStatus ?? "RUNNING");
    },
    stopVm: () => {
      calls.push("stopVm");
      return initial.stopVm ? initial.stopVm() : Promise.resolve();
    },
    getSqlActivationPolicy: () => {
      calls.push("getSql");
      if (initial.getSqlActivationPolicy) return initial.getSqlActivationPolicy();
      return Promise.resolve(initial.sqlPolicy ?? "ALWAYS");
    },
    stopSql: () => {
      calls.push("stopSql");
      return initial.stopSql ? initial.stopSql() : Promise.resolve();
    },
  };
  return { client, calls };
}

function silentLog(): Logger {
  return { info() {}, warn() {}, error() {} };
}

function deps(env: ShutoffEnv, client: InfraClient): HandlerDeps {
  return { env, log: silentLog(), client };
}

describe("handleBudgetEvent", () => {
  it("does nothing under budget, including forecast-only alerts", async () => {
    const { client, calls } = recordingClient({});
    const under = await handleBudgetEvent(budgetEvent({ costAmount: 34.99 }), deps(liveEnv, client));
    assert.equal(under.action, "under-budget");
    const forecast = await handleBudgetEvent(
      budgetEvent({ costAmount: 10, forecastThresholdExceeded: 1, alertThresholdExceeded: undefined }),
      deps(liveEnv, client),
    );
    assert.equal(forecast.action, "under-budget");
    assert.deepEqual(calls, []);
  });

  it("stops the VM and Cloud SQL at and over the budget", async () => {
    const at = recordingClient({});
    const atResult = await handleBudgetEvent(
      budgetEvent({ costAmount: 35, budgetAmount: 35, alertThresholdExceeded: 1 }),
      deps(liveEnv, at.client),
    );
    assert.equal(atResult.action, "stopped");
    assert.deepEqual(at.calls, ["getVm", "stopVm", "getSql", "stopSql"]);

    const over = recordingClient({});
    const overResult = await handleBudgetEvent(
      budgetEvent({ costAmount: 40.5, budgetAmount: 35 }),
      deps(liveEnv, over.client),
    );
    assert.equal(overResult.action, "stopped");
    assert.deepEqual(over.calls, ["getVm", "stopVm", "getSql", "stopSql"]);
  });

  it("skips resources that are already stopped", async () => {
    for (const vmStatus of ["TERMINATED", "STOPPING", "SUSPENDED", "SUSPENDING"]) {
      const { client, calls } = recordingClient({ vmStatus, sqlPolicy: "NEVER" });
      const result = await handleBudgetEvent(
        budgetEvent({ costAmount: 35, budgetAmount: 35 }),
        deps(liveEnv, client),
      );
      assert.equal(result.action, "stopped");
      assert.deepEqual(calls, ["getVm", "getSql"], vmStatus);
    }
  });

  it("stops only the side that is still running", async () => {
    const vmOnly = recordingClient({ vmStatus: "RUNNING", sqlPolicy: "NEVER" });
    await handleBudgetEvent(budgetEvent({ costAmount: 36, budgetAmount: 35 }), deps(liveEnv, vmOnly.client));
    assert.deepEqual(vmOnly.calls, ["getVm", "stopVm", "getSql"]);

    const sqlOnly = recordingClient({ vmStatus: "TERMINATED", sqlPolicy: "ALWAYS" });
    await handleBudgetEvent(budgetEvent({ costAmount: 36, budgetAmount: 35 }), deps(liveEnv, sqlOnly.client));
    assert.deepEqual(sqlOnly.calls, ["getVm", "getSql", "stopSql"]);
  });

  it("logs the intended stop in dry-run mode and does not call GCP", async () => {
    const lines: string[] = [];
    const { client, calls } = recordingClient({});
    const result = await handleBudgetEvent(budgetEvent({ costAmount: 50, budgetAmount: 35 }), {
      env: { ...liveEnv, dryRun: true },
      log: {
        info(message) {
          lines.push(message);
        },
        warn(message) {
          lines.push(message);
        },
        error(message) {
          lines.push(message);
        },
      },
      client,
    });
    assert.equal(result.action, "dry-run");
    assert.deepEqual(calls, []);
    assert.match(lines.join("\n"), /DRY_RUN/);
  });

  it("acks malformed messages without stopping anything", async () => {
    const { client, calls } = recordingClient({});
    const result = await handleBudgetEvent({ data: { message: { data: "%%%" } } }, deps(liveEnv, client));
    assert.equal(result.action, "ignored");
    assert.deepEqual(calls, []);
  });

  it("still stops Cloud SQL when the VM stop fails, then throws so Pub/Sub retries", async () => {
    const { client, calls } = recordingClient({
      stopVm: () => Promise.reject(new Error("vm api down")),
    });
    await assert.rejects(
      () => handleBudgetEvent(budgetEvent({ costAmount: 35, budgetAmount: 35 }), deps(liveEnv, client)),
      /Budget shutoff incomplete: Compute Engine: vm api down/,
    );
    assert.deepEqual(calls, ["getVm", "stopVm", "getSql", "stopSql"]);
  });

  it("retries cleanly after a partial stop", async () => {
    let vmStatus = "RUNNING";
    let sqlFailed = true;
    const { client, calls } = recordingClient({
      getVmStatus: () => Promise.resolve(vmStatus),
      stopVm: () => {
        vmStatus = "TERMINATED";
        return Promise.resolve();
      },
      stopSql: () => {
        if (sqlFailed) return Promise.reject(new Error("sql patch failed"));
        return Promise.resolve();
      },
    });
    await assert.rejects(
      () => handleBudgetEvent(budgetEvent({ costAmount: 35, budgetAmount: 35 }), deps(liveEnv, client)),
      /Cloud SQL: sql patch failed/,
    );
    sqlFailed = false;
    const retried = await handleBudgetEvent(
      budgetEvent({ costAmount: 35, budgetAmount: 35 }),
      deps(liveEnv, client),
    );
    assert.equal(retried.action, "stopped");
    assert.deepEqual(calls, [
      "getVm",
      "stopVm",
      "getSql",
      "stopSql",
      "getVm",
      "getSql",
      "stopSql",
    ]);
  });

  it("throws when the budget is exhausted but target env vars are missing", async () => {
    const { client, calls } = recordingClient({});
    const env: ShutoffEnv = { ...liveEnv, vmName: "", sqlInstance: "" };
    await assert.rejects(
      () => handleBudgetEvent(budgetEvent({ costAmount: 35, budgetAmount: 35 }), deps(env, client)),
      /VM_NAME, SQL_INSTANCE/,
    );
    assert.deepEqual(calls, []);
  });
});
