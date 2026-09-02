import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode } from "@jackline/shared";

import {
  a2aErrorLogLevel,
  buildA2aErrorLogFields,
} from "./a2aBoundaryLog.js";

describe("buildA2aErrorLogFields", () => {
  it("includes handle, method, and error metadata", () => {
    assert.deepEqual(
      buildA2aErrorLogFields({
        status: 401,
        jsonRpcCode: -32000,
        errorCode: ErrorCode.UNAUTHORIZED,
        context: { handle: "demo", method: "message/send" },
      }),
      {
        errorCode: ErrorCode.UNAUTHORIZED,
        status: 401,
        jsonRpcCode: -32000,
        handle: "demo",
        a2aMethod: "message/send",
      },
    );
  });
});

describe("a2aErrorLogLevel", () => {
  it("uses warn for client errors and error for server errors", () => {
    assert.equal(a2aErrorLogLevel(401), "warn");
    assert.equal(a2aErrorLogLevel(503), "error");
  });
});
