import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotateToolResultWithAccount,
  chooseAccountLabel,
  decideOAuthAccountWrite,
  googleAuthorizeExtraParams,
  identityFromIdToken,
  injectAccountJsonSchema,
  resolveUpstreamAccount,
  scopesWithOpenIdEmail,
  stripAccountArg,
  type UpstreamAccountRef,
} from "./accounts.js";

const work: UpstreamAccountRef = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "Work",
  externalEmail: "work@example.com",
  externalSubject: "sub-work",
  isDefault: true,
};
const personal: UpstreamAccountRef = {
  id: "00000000-0000-4000-8000-000000000002",
  label: "Personal",
  externalEmail: "personal@example.com",
  externalSubject: "sub-personal",
  isDefault: false,
};

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64url");
}

describe("decideOAuthAccountWrite", () => {
  it("creates the first account", () => {
    const decision = decideOAuthAccountWrite({
      accounts: [],
      mode: "connect",
      identity: { email: "Work@Example.com", subject: "sub-work" },
    });
    assert.equal(decision.type, "create");
    if (decision.type !== "create") return;
    assert.equal(decision.email, "work@example.com");
    assert.equal(decision.isDefault, true);
    assert.equal(decision.label, "work");
  });

  it("uses the requested label, then Account N when that label is taken", () => {
    assert.equal(chooseAccountLabel([], "Work", "a@b.com"), "Work");
    assert.equal(
      chooseAccountLabel([{ label: "Work" }], "Work", null),
      "Account 2",
    );
  });

  it("refreshes the matching email instead of creating a duplicate", () => {
    const decision = decideOAuthAccountWrite({
      accounts: [work, personal],
      mode: "add",
      requestedLabel: "Other",
      identity: { email: "Personal@Example.com", subject: "sub-personal" },
    });
    assert.deepEqual(decision, {
      type: "update",
      accountId: personal.id,
      email: "personal@example.com",
      subject: "sub-personal",
      refreshed: true,
    });
  });

  it("rejects an expected email that does not match", () => {
    const decision = decideOAuthAccountWrite({
      accounts: [personal],
      mode: "add",
      expectedEmail: "work@example.com",
      identity: { email: "personal@example.com", subject: "sub-personal" },
    });
    assert.equal(decision.type, "reject");
    if (decision.type !== "reject") return;
    assert.match(decision.message, /No account was changed/);
    assert.match(decision.message, /work@example.com/);
  });

  it("reconnect does not overwrite a different account", () => {
    const decision = decideOAuthAccountWrite({
      accounts: [work, personal],
      mode: "reconnect",
      reconnectAccountId: work.id,
      identity: {
        email: personal.externalEmail,
        subject: personal.externalSubject ?? null,
      },
    });
    assert.equal(decision.type, "reject");
    if (decision.type !== "reject") return;
    assert.match(decision.message, /did not change "Work"/);
  });

  it("fills email onto a single migrated account on plain connect", () => {
    const migrated: UpstreamAccountRef = {
      id: work.id,
      label: "Default",
      externalEmail: null,
      isDefault: true,
    };
    const decision = decideOAuthAccountWrite({
      accounts: [migrated],
      mode: "connect",
      identity: { email: "personal@example.com", subject: "sub-personal" },
    });
    assert.equal(decision.type, "update");
    if (decision.type !== "update") return;
    assert.equal(decision.accountId, work.id);
    assert.equal(decision.email, "personal@example.com");
    assert.equal(decision.refreshed, false);
  });
});

describe("resolveUpstreamAccount", () => {
  it("uses the only account when none is named", () => {
    const resolved = resolveUpstreamAccount({ accounts: [work] });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.account.id, work.id);
  });

  it("errors when several accounts are connected and none is named", () => {
    const resolved = resolveUpstreamAccount({ accounts: [work, personal] });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.match(resolved.message, /Work/);
    assert.match(resolved.message, /Personal/);
    assert.match(resolved.message, /work@example.com/);
  });

  it("resolves a label, email, or id", () => {
    for (const requested of [personal.label, personal.externalEmail!, personal.id]) {
      const resolved = resolveUpstreamAccount({
        accounts: [work, personal],
        requested,
      });
      assert.equal(resolved.ok, true, requested ?? "");
      if (!resolved.ok) return;
      assert.equal(resolved.account.id, personal.id);
    }
  });

  it("rejects an unknown label and lists accounts", () => {
    const resolved = resolveUpstreamAccount({
      accounts: [work, personal],
      requested: "school",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.match(resolved.message, /Unknown account "school"/);
    assert.match(resolved.message, /personal@example.com/);
  });
});

describe("account argument stripping and schema", () => {
  it("strips account and leaves other arguments", () => {
    const stripped = stripAccountArg({
      account: " work ",
      q: "inbox",
      max: 5,
    });
    assert.equal(stripped.requested, "work");
    assert.deepEqual(stripped.rest, { q: "inbox", max: 5 });
  });

  it("injects an optional account property only when there are several accounts", () => {
    const schema = {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    };
    assert.equal(injectAccountJsonSchema(schema, [work]), schema);
    const injected = injectAccountJsonSchema(schema, [work, personal]) as {
      properties: { account: { type: string }; q: { type: string } };
      required: string[];
    };
    assert.equal(injected.properties.account.type, "string");
    assert.equal(injected.properties.q.type, "string");
    assert.deepEqual(injected.required, ["q"]);
    assert.equal("account" in schema.properties, false);
  });

  it("mentions the account on the tool result", () => {
    const annotated = annotateToolResultWithAccount(
      { content: [{ type: "text", text: "two messages" }] },
      work,
    );
    assert.match(annotated.content[0]?.text ?? "", /Using account Work/);
    assert.equal(annotated.content[1]?.text, "two messages");
    assert.equal(annotated._meta?.["jacklineAccount"] && (annotated._meta["jacklineAccount"] as { id: string }).id, work.id);
  });
});

describe("google identity helpers", () => {
  it("reads email and subject from an id_token payload", () => {
    const token = `x.${b64url({ email: "work@example.com", sub: "abc" })}.y`;
    assert.deepEqual(identityFromIdToken(token), {
      email: "work@example.com",
      subject: "abc",
    });
  });

  it("asks Google for the account chooser and openid email", () => {
    const params = googleAuthorizeExtraParams({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    assert.equal(params["prompt"], "select_account consent");
    assert.equal(params["access_type"], "offline");
    assert.equal(
      scopesWithOpenIdEmail(
        "https://www.googleapis.com/auth/gmail.readonly",
      ),
      "https://www.googleapis.com/auth/gmail.readonly openid email",
    );
  });
});
