import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  startQuotaTestApi,
  type QuotaTestApi,
} from "./helpers/quotaStack.js";

describe("rate limits", () => {
  let api: QuotaTestApi;

  before(async () => {
    api = await startQuotaTestApi({
      JACKLINE_RL_API_AUTH_LIMIT: "3",
      JACKLINE_RL_API_AUTH_WINDOW: "60s",
    });
  });

  after(async () => {
    await api.stop();
  });

  it("returns 429 with Retry-After when api.auth quota is exceeded", async () => {
    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${api.apiUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json",
          Origin: "http://127.0.0.1:5173",
          // Stable synthetic IP so the limit key is deterministic behind no proxy.
          "X-Forwarded-For": "203.0.113.50",
        },
        body: JSON.stringify({
          email: `rate-limit-${i}@example.com`,
          password: "not-the-password",
        }),
      });
      statuses.push(res.status);
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(
      limited,
      `expected a 429 within 5 auth attempts, got statuses=${statuses.join(",")}`,
    );
    assert.equal(limited.status, 429);

    const retryAfter = limited.headers.get("Retry-After");
    assert.ok(retryAfter, "Retry-After header missing");
    assert.ok(Number(retryAfter) >= 1);

    const limit = limited.headers.get("RateLimit-Limit");
    assert.equal(limit, "3");

    const body = (await limited.json()) as {
      error?: { code?: string };
    };
    assert.equal(body.error?.code, "RATE_LIMITED");
  });
});
