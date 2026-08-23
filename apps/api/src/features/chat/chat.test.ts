import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestError,
  CHAT_NOT_CONFIGURED,
  ErrorCode,
  maskSecretLast4,
  UpdateChatSettingsBodySchema,
} from "@jackline/shared";
import { createChatAdapter } from "./adapter.js";
import { policyDeniedMessage } from "./mcpTools.js";

describe("maskSecretLast4", () => {
  it("hides short secrets entirely", () => {
    assert.equal(maskSecretLast4("abcd"), "••••");
  });

  it("keeps the last four characters", () => {
    assert.equal(maskSecretLast4("sk-live-1234"), "••••1234");
  });
});

describe("UpdateChatSettingsBodySchema", () => {
  it("requires baseUrl for ollama", () => {
    const parsed = UpdateChatSettingsBodySchema.safeParse({
      provider: "ollama",
      model: "llama3.2",
    });
    assert.equal(parsed.success, false);
  });

  it("accepts openai with an api key", () => {
    const parsed = UpdateChatSettingsBodySchema.safeParse({
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "sk-test",
    });
    assert.equal(parsed.success, true);
  });
});

describe("createChatAdapter", () => {
  it("returns BadRequestError when openai_compatible has no baseUrl", () => {
    const result = createChatAdapter({
      provider: "openai_compatible",
      model: "local",
      apiKey: "x",
      baseUrl: null,
    });
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.equal(result.error.name, "BadRequestError");
      assert.equal(result.error.code, ErrorCode.BAD_REQUEST);
    }
  });
});

describe("policyDeniedMessage", () => {
  it("formats gateway denials for the SSE tool card", () => {
    assert.equal(
      policyDeniedMessage("github__create_issue", "Forbidden"),
      "policy denied `github__create_issue`: Forbidden",
    );
    assert.equal(
      policyDeniedMessage("linear__list_issues", ""),
      "policy denied `linear__list_issues`",
    );
  });
});

describe("CHAT_NOT_CONFIGURED", () => {
  it("is a BadRequestError-shaped operator message", () => {
    const error = new BadRequestError(CHAT_NOT_CONFIGURED);
    assert.equal(error.code, ErrorCode.BAD_REQUEST);
    assert.match(error.message, /Settings/);
  });
});
