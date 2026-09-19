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
});
