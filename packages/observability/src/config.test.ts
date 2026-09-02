import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOtelConfig } from "./config.js";
import { parseTraceIdFromTraceparent } from "./traceContext.js";

describe("resolveOtelConfig", () => {
  it("disables export when endpoint is unset", () => {
    const result = resolveOtelConfig({ serviceName: "jackline-api" });
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.equal(result.value.exportEnabled, false);
      assert.equal(result.value.otlpEndpoint, undefined);
    }
  });

  it("enables export when endpoint URL is set", () => {
    const result = resolveOtelConfig({
      serviceName: "jackline-gateway",
      otlpEndpoint: "http://127.0.0.1:4318/v1/traces",
    });
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.equal(result.value.exportEnabled, true);
      assert.equal(
        result.value.otlpEndpoint,
        "http://127.0.0.1:4318/v1/traces",
      );
    }
  });

  it("rejects invalid sampler ratio", () => {
    const result = resolveOtelConfig({
      serviceName: "jackline-api",
      samplerArg: "2",
    });
    assert.equal(result.isErr(), true);
  });
});

describe("parseTraceIdFromTraceparent", () => {
  it("extracts trace id from valid traceparent", () => {
    const traceId = parseTraceIdFromTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    assert.equal(traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("returns undefined for invalid traceparent", () => {
    assert.equal(parseTraceIdFromTraceparent(undefined), undefined);
    assert.equal(parseTraceIdFromTraceparent("invalid"), undefined);
  });
});
