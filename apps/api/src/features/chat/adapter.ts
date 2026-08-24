import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { err, ok, type Result } from "neverthrow";
import {
  BadRequestError,
  JacklineError,
  type ChatLlmProvider,
} from "@jackline/shared";

export type LlmRuntime = {
  provider: ChatLlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string | null;
};

export function createChatAdapter(
  runtime: LlmRuntime,
): Result<unknown, JacklineError> {
  try {
    const model = runtime.model as never;
    switch (runtime.provider) {
      case "openrouter":
        return ok(createOpenRouterText(model, runtime.apiKey));
      case "openai":
        return ok(createOpenaiChat(model, runtime.apiKey));
      case "anthropic":
        return ok(createAnthropicChat(model, runtime.apiKey));
      case "ollama":
      case "openai_compatible": {
        if (!runtime.baseUrl) {
          return err(
            new BadRequestError("baseUrl is required for this provider"),
          );
        }
        return ok(
          openaiCompatibleText(runtime.model, {
            name: runtime.provider,
            baseURL: runtime.baseUrl,
            apiKey: runtime.apiKey || "not-required",
          }),
        );
      }
      default:
        return err(new BadRequestError("Unknown Chat provider"));
    }
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Failed to create LLM adapter";
    return err(new BadRequestError(message));
  }
}
