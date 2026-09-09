import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  discoverMcpOAuthMetadata,
  registerDynamicOAuthClient,
} from "./oauth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("registerDynamicOAuthClient", () => {
  it("registers a public PKCE client and returns client_id", async () => {
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as {
        token_endpoint_auth_method: string;
        application_type: string;
        redirect_uris: string[];
      };
      assert.equal(body.token_endpoint_auth_method, "none");
      assert.equal(body.application_type, "native");
      assert.deepEqual(body.redirect_uris, [
        "http://127.0.0.1:9786/oauth/callback",
      ]);
      return new Response(
        JSON.stringify({
          client_id: "cl_test123",
          token_endpoint_auth_method: "none",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await registerDynamicOAuthClient({
      registrationUrl: "https://vercel.com/api/login/oauth/register",
      clientName: "Jackline (Vercel)",
      redirectUris: ["http://127.0.0.1:9786/oauth/callback"],
      applicationType: "native",
    });
    assert.ok(result.isOk());
    assert.equal(result.value.clientId, "cl_test123");
    assert.equal(result.value.clientSecret, undefined);
  });

  it("maps invalid_redirect_uri to a clear BadRequestError", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "invalid_redirect_uri",
          error_description:
            "The provided redirect URIs are not approved for use by this authorization server.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const result = await registerDynamicOAuthClient({
      registrationUrl: "https://vercel.com/api/login/oauth/register",
      clientName: "Jackline",
      redirectUris: ["https://example.com/api/v1/oauth/callback"],
      applicationType: "web",
    });
    assert.ok(result.isErr());
    assert.equal(result.error.code, "BAD_REQUEST");
    assert.match(result.error.message, /jackline add/i);
    assert.match(result.error.message, /loopback/i);
  });
});

describe("discoverMcpOAuthMetadata", () => {
  it("reads MCP AS metadata from the resource well-known URL", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            issuer: "https://vercel.com",
            authorization_endpoint: "https://vercel.com/oauth/authorize",
            token_endpoint: "https://vercel.com/api/login/oauth/token",
            registration_endpoint:
              "https://vercel.com/api/login/oauth/register",
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await discoverMcpOAuthMetadata("https://mcp.vercel.com");
    assert.ok(result.isOk());
    assert.equal(
      result.value.authorizationEndpoint,
      "https://vercel.com/oauth/authorize",
    );
    assert.equal(
      result.value.registrationEndpoint,
      "https://vercel.com/api/login/oauth/register",
    );
    assert.equal(
      result.value.tokenEndpoint,
      "https://vercel.com/api/login/oauth/token",
    );
  });
});
