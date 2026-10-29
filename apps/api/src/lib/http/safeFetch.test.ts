import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPublicHttpsUrl, isPrivateAddress } from "./safeFetch.js";

describe("safeFetch guards", () => {
  it("flags private, loopback, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "76.76.21.21", "2606:4700::1111"]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it("rejects non-https, credentials, localhost and private literals", async () => {
    for (const u of [
      "http://example.com/mcp",
      "https://user:pw@example.com/",
      "https://localhost/mcp",
      "https://127.0.0.1/mcp",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "not a url",
    ]) {
      await assert.rejects(() => assertPublicHttpsUrl(u), u);
    }
  });

  it("accepts a public https literal", async () => {
    const url = await assertPublicHttpsUrl("https://8.8.8.8/x");
    assert.equal(url.hostname, "8.8.8.8");
  });
});
