import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBearer,
  verifyGatewayAuthorization,
} from "./gatewayAuth.js";
import { createApp } from "../server/app.js";
import { createTempMeshHomeWithGatewayToken } from "../test/helpers.js";

describe("extractBearer", () => {
  it("parses Bearer tokens case-insensitively", () => {
    assert.equal(extractBearer("Bearer abc.def"), "abc.def");
    assert.equal(extractBearer("bearer abc.def"), "abc.def");
  });

  it("rejects missing or malformed Authorization headers", () => {
    assert.equal(extractBearer(undefined), null);
    assert.equal(extractBearer(""), null);
    assert.equal(extractBearer("Basic abc"), null);
    assert.equal(extractBearer("Bearer"), null);
  });
});

describe("gateway /mcp auth", () => {
  it("allows /health without a bearer token", async () => {
    const { paths } = await createTempMeshHomeWithGatewayToken();
    const app = createApp(paths);
    try {
      const res = await app.request("http://127.0.0.1/health");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, mode: "personal" });
    } finally {
      app.close();
    }
  });

  it("rejects /mcp without Authorization", async () => {
    const { paths } = await createTempMeshHomeWithGatewayToken();
    const app = createApp(paths);
    try {
      const res = await app.request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      assert.equal(res.status, 401);
      const body = (await res.json()) as {
        error: { code: string };
      };
      assert.equal(body.error.code, "UNAUTHORIZED");
    } finally {
      app.close();
    }
  });

  it("rejects /mcp with a wrong bearer token", async () => {
    const { paths } = await createTempMeshHomeWithGatewayToken();
    const app = createApp(paths);
    try {
      const res = await app.request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          authorization:
            "Bearer msh_00000000-0000-4000-8000-000000000000.not-the-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
        }),
      });
      assert.equal(res.status, 401);
    } finally {
      app.close();
    }
  });

  it("accepts /mcp with the minted gateway bearer", async () => {
    const { paths, token } = await createTempMeshHomeWithGatewayToken();
    assert.equal(
      await verifyGatewayAuthorization(`Bearer ${token}`, paths),
      true,
    );

    const app = createApp(paths);
    try {
      const res = await app.request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        result?: { serverInfo?: { name?: string } };
      };
      assert.equal(body.result?.serverInfo?.name, "mesh");
    } finally {
      app.close();
    }
  });
});
