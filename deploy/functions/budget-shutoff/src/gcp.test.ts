import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createRestInfraClient,
  GcpHttpError,
  type HttpCaller,
  type HttpResponse,
} from "./gcp.js";

function scripted(responses: HttpResponse[]): {
  caller: HttpCaller;
  calls: Array<{ url: string; method: string; body?: unknown }>;
} {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const caller: HttpCaller = (request) => {
    calls.push(request);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected ${request.method} ${request.url}`);
    return Promise.resolve(next);
  };
  return { caller, calls };
}

describe("createRestInfraClient", () => {
  it("reads instance status and Cloud SQL activationPolicy", async () => {
    const { caller, calls } = scripted([
      { status: 200, body: { status: "RUNNING" } },
      { status: 200, body: { settings: { activationPolicy: "ALWAYS" } } },
    ]);
    const client = createRestInfraClient(caller);
    assert.equal(await client.getVmStatus("mesh", "us-central1-a", "jackline"), "RUNNING");
    assert.equal(await client.getSqlActivationPolicy("mesh", "jackline-db"), "ALWAYS");
    assert.equal(calls[0]?.method, "GET");
    assert.match(calls[0]?.url ?? "", /\/compute\/v1\/projects\/mesh\/zones\/us-central1-a\/instances\/jackline$/);
    assert.match(calls[1]?.url ?? "", /\/sql\/v1\/projects\/mesh\/instances\/jackline-db$/);
  });

  it("stops the VM and patches Cloud SQL with an updateMask", async () => {
    const { caller, calls } = scripted([
      { status: 200, body: { status: "RUNNING" } },
      { status: 200, body: { name: "operation-1" } },
    ]);
    const client = createRestInfraClient(caller);
    await client.stopVm("mesh", "us-central1-a", "jackline");
    await client.stopSql("mesh", "jackline-db");
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url ?? "", /\/instances\/jackline\/stop$/);
    assert.equal(calls[1]?.method, "PATCH");
    assert.match(calls[1]?.url ?? "", /updateMask=settings\.activationPolicy/);
    assert.deepEqual(calls[1]?.body, { settings: { activationPolicy: "NEVER" } });
  });

  it("treats an already-stopped VM error as success", async () => {
    const { caller } = scripted([
      {
        status: 400,
        body: { error: { message: "The instance is already stopped." } },
      },
    ]);
    await createRestInfraClient(caller).stopVm("mesh", "us-central1-a", "jackline");
  });

  it("throws on other HTTP errors", async () => {
    const { caller } = scripted([
      { status: 403, body: { error: { message: "permission denied" } } },
    ]);
    await assert.rejects(
      () => createRestInfraClient(caller).stopVm("mesh", "us-central1-a", "jackline"),
      (err: unknown) => err instanceof GcpHttpError && err.status === 403,
    );
  });

  it("does not reference billing unlink or instance delete URLs", () => {
    const src = readFileSync(new URL("./gcp.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /billingAccounts/);
    assert.doesNotMatch(src, /\/delete/);
    assert.doesNotMatch(src, /\/addresses/);
  });
});
