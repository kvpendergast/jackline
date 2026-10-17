import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  discoverMcpOAuthMetadata,
  exchangeAuthorizationCode,
  parseResourceMetadataFromWwwAuthenticate,
  parseScopeFromWwwAuthenticate,
  registerDynamicOAuthClient,
  resolveOAuthAccessToken,
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
      registrationUrl: "https://auth.example.com/oauth/register",
      clientName: "Jackline (Example)",
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
      registrationUrl: "https://auth.example.com/oauth/register",
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
            issuer: "https://auth.example.com",
            authorization_endpoint: "https://auth.example.com/oauth/authorize",
            token_endpoint: "https://auth.example.com/oauth/token",
            registration_endpoint: "https://auth.example.com/oauth/register",
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await discoverMcpOAuthMetadata("https://mcp.example.com");
    assert.ok(result.isOk());
    assert.equal(
      result.value.authorizationEndpoint,
      "https://auth.example.com/oauth/authorize",
    );
    assert.equal(
      result.value.registrationEndpoint,
      "https://auth.example.com/oauth/register",
    );
    assert.equal(
      result.value.tokenEndpoint,
      "https://auth.example.com/oauth/token",
    );
  });
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** Fixture shaped like Dollas: path-bearing MCP resource and path-bearing issuer. */
function dollasFetch(calls: string[], opts?: { header?: boolean }) {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://dollas.vercel.app/api/mcp") {
      return new Response("unauthorized", {
        status: 401,
        headers: opts?.header
          ? {
              "WWW-Authenticate":
                'Bearer resource_metadata="https://dollas.vercel.app/.well-known/oauth-protected-resource/api/mcp"',
            }
          : {},
      });
    }
    if (
      url ===
      "https://dollas.vercel.app/.well-known/oauth-protected-resource/api/mcp"
    ) {
      return json({
        resource: "https://dollas.vercel.app/api/mcp",
        authorization_servers: ["https://dollas.vercel.app/api/auth"],
        scopes_supported: ["openid", "profile", "offline_access"],
      });
    }
    if (
      url ===
      "https://dollas.vercel.app/.well-known/oauth-authorization-server/api/auth"
    ) {
      return json({
        issuer: "https://dollas.vercel.app/api/auth",
        authorization_endpoint: "https://dollas.vercel.app/api/auth/oauth2/authorize",
        token_endpoint: "https://dollas.vercel.app/api/auth/oauth2/token",
        registration_endpoint: "https://dollas.vercel.app/api/auth/oauth2/register",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("discoverMcpOAuthMetadata (path insertion, RFC 9728/8414)", () => {
  it("discovers a Dollas-shaped server via path-inserted PRM and AS metadata", async () => {
    const calls: string[] = [];
    globalThis.fetch = dollasFetch(calls);
    const result = await discoverMcpOAuthMetadata(
      "https://dollas.vercel.app/api/mcp",
    );
    assert.ok(result.isOk());
    assert.equal(result.value.resource, "https://dollas.vercel.app/api/mcp");
    assert.equal(
      result.value.registrationEndpoint,
      "https://dollas.vercel.app/api/auth/oauth2/register",
    );
    assert.equal(
      result.value.tokenEndpoint,
      "https://dollas.vercel.app/api/auth/oauth2/token",
    );
    assert.deepEqual(result.value.scopesSupported, [
      "openid",
      "profile",
      "offline_access",
    ]);
    assert.ok(
      calls.includes(
        "https://dollas.vercel.app/.well-known/oauth-authorization-server/api/auth",
      ),
    );
  });

  it("prefers resource_metadata from the 401 WWW-Authenticate header", async () => {
    const calls: string[] = [];
    globalThis.fetch = dollasFetch(calls, { header: true });
    const result = await discoverMcpOAuthMetadata(
      "https://dollas.vercel.app/api/mcp",
    );
    assert.ok(result.isOk());
    const prmIdx = calls.indexOf(
      "https://dollas.vercel.app/.well-known/oauth-protected-resource/api/mcp",
    );
    assert.ok(prmIdx >= 0);
  });

  it("falls back to OIDC discovery with the issuer path", async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-protected-resource/mcp")) {
        return json({
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://auth.example.com/tenant1"],
        });
      }
      if (url === "https://auth.example.com/tenant1/.well-known/openid-configuration") {
        return json({
          authorization_endpoint: "https://auth.example.com/tenant1/authorize",
          token_endpoint: "https://auth.example.com/tenant1/token",
        });
      }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    const result = await discoverMcpOAuthMetadata("https://mcp.example.com/mcp");
    assert.ok(result.isOk());
    assert.equal(result.value.registrationEndpoint, undefined);
  });

  it("uses an injected guarded fetch for every request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("global fetch must not be used");
    }) as typeof fetch;
    const seen: string[] = [];
    const guarded = dollasFetch(seen);
    const result = await discoverMcpOAuthMetadata(
      "https://dollas.vercel.app/api/mcp",
      { fetch: (u, i) => guarded(u, i) },
    );
    assert.ok(result.isOk());
    assert.ok(seen.length > 0);
  });

  it("errors when nothing is discoverable", async () => {
    globalThis.fetch = (async () => new Response("nf", { status: 404 })) as typeof fetch;
    const result = await discoverMcpOAuthMetadata("https://nothing.example.com/mcp");
    assert.ok(result.isErr());
  });
});

describe("custom-server DCR + resource (RFC 7591 / 8707)", () => {
  it("registers a public web client with the Jackline callback and no secret", async () => {
    globalThis.fetch = (async () => {
      throw new Error("injected fetch expected");
    }) as typeof fetch;
    const result = await registerDynamicOAuthClient({
      registrationUrl: "https://dollas.vercel.app/api/auth/oauth2/register",
      clientName: "Jackline (Dollas)",
      redirectUris: ["https://jackline.example.com/api/v1/oauth/callback"],
      applicationType: "web",
      tokenEndpointAuthMethod: "none",
      scopes: "openid profile",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body["token_endpoint_auth_method"], "none");
        assert.equal(body["application_type"], "web");
        assert.equal(body["scope"], "openid profile");
        return json({ client_id: "dyn_1" }, 201);
      },
    });
    assert.ok(result.isOk());
    assert.equal(result.value.clientId, "dyn_1");
    assert.equal(result.value.clientSecret, undefined);
  });

  it("sends resource on the authorization_code exchange", async () => {
    let sent: URLSearchParams | undefined;
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
      sent = new URLSearchParams(String(init?.body));
      return json({ access_token: "at", refresh_token: "rt", expires_in: 60 });
    }) as typeof fetch;
    const result = await exchangeAuthorizationCode({
      tokenUrl: "https://dollas.vercel.app/api/auth/oauth2/token",
      code: "c",
      redirectUri: "https://jackline.example.com/api/v1/oauth/callback",
      clientId: "dyn_1",
      codeVerifier: "v",
      resource: "https://dollas.vercel.app/api/mcp",
    });
    assert.ok(result.isOk());
    assert.equal(sent?.get("resource"), "https://dollas.vercel.app/api/mcp");
    assert.equal(sent?.get("client_id"), "dyn_1");
  });

  it("replays resource on refresh for a public client", async () => {
    let sent: URLSearchParams | undefined;
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
      sent = new URLSearchParams(String(init?.body));
      return json({ access_token: "at2", expires_in: 60 });
    }) as typeof fetch;
    const plaintext = JSON.stringify({
      refreshToken: "rt",
      tokenUrl: "https://dollas.vercel.app/api/auth/oauth2/token",
      clientId: "dyn_1",
      resource: "https://dollas.vercel.app/api/mcp",
      expiresAt: Date.now() - 1000,
    });
    const result = await resolveOAuthAccessToken(plaintext);
    assert.ok(result.isOk());
    assert.equal(sent?.get("resource"), "https://dollas.vercel.app/api/mcp");
    assert.equal(sent?.get("client_id"), "dyn_1");
    assert.match(result.value.updatedPlaintext ?? "", /"resource"/);
  });
});

describe("parseResourceMetadataFromWwwAuthenticate", () => {
  it("parses quoted and missing values", () => {
    assert.equal(
      parseResourceMetadataFromWwwAuthenticate(
        'Bearer realm="x", resource_metadata="https://a.example/.well-known/oauth-protected-resource"',
      ),
      "https://a.example/.well-known/oauth-protected-resource",
    );
    assert.equal(parseResourceMetadataFromWwwAuthenticate("Bearer"), null);
    assert.equal(parseResourceMetadataFromWwwAuthenticate(null), null);
  });
});

describe("scope hint from WWW-Authenticate", () => {
  it("parses scope and prefers it in discovery", async () => {
    assert.deepEqual(
      parseScopeFromWwwAuthenticate('Bearer resource_metadata="https://a/x", scope="a:read a:write"'),
      ["a:read", "a:write"],
    );
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://mcp.example.com/mcp") {
        return new Response("", {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer scope="x:read"' },
        });
      }
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return json({
          authorization_endpoint: "https://mcp.example.com/a",
          token_endpoint: "https://mcp.example.com/t",
          scopes_supported: ["other"],
        });
      }
      void init;
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    const r = await discoverMcpOAuthMetadata("https://mcp.example.com/mcp");
    assert.ok(r.isOk());
    assert.deepEqual(r.value.scopesSupported, ["x:read"]);
  });
});
