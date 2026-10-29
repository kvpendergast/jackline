import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Writable } from "node:stream";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("includes service on every JSON log line", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }) as unknown as import("pino").DestinationStream;

    const logger = createLogger({
      logLevel: "info",
      nodeEnv: "test",
      service: "jackline-api",
      destination,
    });
    logger.info("hello");

    await new Promise((r) => setImmediate(r));
    const line = chunks.find((c) => c.includes("hello"));
    assert.ok(line, "expected a log line");
    const parsed = JSON.parse(line) as { service?: string; msg?: string };
    assert.equal(parsed.service, "jackline-api");
    assert.equal(parsed.msg, "hello");
  });
  it("promotes error stacks to stack_trace with serviceContext", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }) as unknown as import("pino").DestinationStream;

    const logger = createLogger({
      logLevel: "info",
      nodeEnv: "test",
      service: "jackline-api",
      destination,
    });
    const err = new Error("boom");
    logger.error({ err, requestId: "req-1" }, "unhandled error");
    logger.info({ requestId: "req-2" }, "no error here");

    await new Promise((r) => setImmediate(r));
    const errLine = chunks.find((c) => c.includes("unhandled error"));
    assert.ok(errLine, "expected an error log line");
    const parsed = JSON.parse(errLine) as {
      level?: number;
      stack_trace?: string;
      serviceContext?: { service?: string };
      err?: { type?: string; message?: string; stack?: string };
      requestId?: string;
    };
    assert.equal(parsed.level, 50);
    assert.equal(parsed.stack_trace, err.stack);
    assert.match(parsed.stack_trace ?? "", /^Error: boom\n\s+at /);
    assert.deepEqual(parsed.serviceContext, { service: "jackline-api" });
    assert.equal(parsed.err?.type, "Error");
    assert.equal(parsed.err?.message, "boom");
    assert.equal(parsed.err?.stack, err.stack);
    assert.equal(parsed.requestId, "req-1");

    const infoLine = chunks.find((c) => c.includes("no error here"));
    assert.ok(infoLine, "expected an info log line");
    const info = JSON.parse(infoLine) as Record<string, unknown>;
    assert.equal(info["stack_trace"], undefined);
    assert.equal(info["serviceContext"], undefined);
  });
});
