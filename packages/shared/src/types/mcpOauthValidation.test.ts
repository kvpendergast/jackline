import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCimdClientId,
  validateCimdMetadata,
  validateDcrRegistrationBody,
} from "./mcpOauthValidation.js";

describe("isCimdClientId", () => {
  it("accepts https metadata URLs", () => {
    assert.equal(isCimdClientId("https://example.com/client.json"), true);
    assert.equal(isCimdClientId("https://app.example.com/.well-known/oauth-client"), true);
  });

  it("rejects non-https and non-URLs", () => {
    assert.equal(isCimdClientId("http://example.com/client.json"), false);
    assert.equal(isCimdClientId("00000000-0000-4000-8000-000000000001"), false);
    assert.equal(isCimdClientId("not-a-url"), false);
    assert.equal(isCimdClientId(""), false);
  });
});

describe("validateCimdMetadata", () => {
  const url = "https://example.com/oauth/client.json";

  it("accepts valid public-client metadata", () => {
    const result = validateCimdMetadata(url, {
      client_id: url,
      client_name: "Example",
      redirect_uris: ["http://127.0.0.1:54321/callback"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.metadata.client_name, "Example");
    }
  });

  it("rejects client_id mismatch", () => {
    const result = validateCimdMetadata(url, {
      client_id: "https://other.example.com/client.json",
      redirect_uris: ["http://127.0.0.1/cb"],
    });
    assert.equal(result.ok, false);
  });

  it("rejects confidential auth methods", () => {
    const result = validateCimdMetadata(url, {
      client_id: url,
      redirect_uris: ["http://127.0.0.1/cb"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    assert.equal(result.ok, false);
  });
});

describe("validateDcrRegistrationBody", () => {
  it("accepts minimal public native client", () => {
    const result = validateDcrRegistrationBody({
      redirect_uris: ["http://127.0.0.1:54321/callback"],
      application_type: "native",
    });
    assert.equal(result.ok, true);
  });

  it("rejects empty redirect_uris", () => {
    const result = validateDcrRegistrationBody({
      redirect_uris: [],
    });
    assert.equal(result.ok, false);
  });

  it("rejects confidential clients", () => {
    const result = validateDcrRegistrationBody({
      redirect_uris: ["https://app.example.com/cb"],
      token_endpoint_auth_method: "client_secret_post",
    });
    assert.equal(result.ok, false);
  });

  it("rejects unsupported grant types", () => {
    const result = validateDcrRegistrationBody({
      redirect_uris: ["https://app.example.com/cb"],
      grant_types: ["client_credentials"],
    });
    assert.equal(result.ok, false);
  });
});
