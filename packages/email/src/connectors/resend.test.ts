import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResendConnector } from "./resend.js";

describe("createResendConnector", () => {
  it("posts to the Resend API", async () => {
    const requests: Array<{ url: string; body: string; authorization: string }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
        authorization: headers.get("Authorization") ?? "",
      });
      return new Response("{}", { status: 200 });
    };

    const connector = createResendConnector({
      apiKey: "re_test",
      fetchImpl,
    });

    await connector.send({
      from: "Jackline <noreply@example.com>",
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
    });

    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.authorization, "Bearer re_test");
    const body = JSON.parse(request.body) as {
      to: string[];
      subject: string;
    };
    assert.equal(body.to[0], "user@example.com");
    assert.equal(body.subject, "Hello");
  });
});
