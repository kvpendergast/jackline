import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIN_PROVIDER_COOKIE,
  loginProviderCookieHeader,
  signLoginProvider,
  verifyLoginProvider,
} from "./loginProviderCookie.js";

describe("loginProviderCookie", () => {
  const secret = "test-secret-for-login-provider-cookie";

  it("round-trips a signed provider id", () => {
    const signed = signLoginProvider("google", secret);
    assert.equal(verifyLoginProvider(signed, secret), "google");
    assert.equal(verifyLoginProvider("tampered", secret), null);
  });

  it("omits Secure on http and sets Secure on https deployments", () => {
    const httpHeader = loginProviderCookieHeader("google", secret);
    assert.match(httpHeader, new RegExp(`^${LOGIN_PROVIDER_COOKIE}=`));
    assert.doesNotMatch(httpHeader, /;\s*Secure(?:;|$)/);
    assert.match(httpHeader, /SameSite=Lax/);

    const httpsHeader = loginProviderCookieHeader("google", secret, {
      secure: true,
    });
    assert.match(httpsHeader, /;\s*Secure(?:;|$)/);
  });
});
