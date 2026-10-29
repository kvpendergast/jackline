import {
  BadRequestError,
  JACKLINE_TOOL_CALL_INTENT,
  JACKLINE_TRUST_REQUEST_INTENT,
  JacklineError,
  UnauthorizedError,
} from "@jackline/shared";
import { err, ok, type Result } from "neverthrow";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type KnockPayload = {
  peerAgentCardUrl: string;
  peerDisplayName?: string;
  message: string;
  intent?: string;
};

export type PeerToolCallRequest = {
  name: string;
  arguments: Record<string, unknown>;
};

function messageParts(
  params: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> | undefined {
  const message = params?.["message"] as Record<string, unknown> | undefined;
  return message?.["parts"] as Array<Record<string, unknown>> | undefined;
}

function messageMetadata(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const message = params?.["message"] as Record<string, unknown> | undefined;
  return message?.["metadata"] as Record<string, unknown> | undefined;
}

export function extractPeerMessageText(
  params: Record<string, unknown> | undefined,
): Result<string, BadRequestError> {
  const parts = messageParts(params);
  const textPart = parts?.find((p) => p["kind"] === "text");
  const text = textPart?.["text"];
  if (typeof text !== "string" || text.trim().length === 0) {
    return err(new BadRequestError("Message text is required"));
  }
  return ok(text);
}

export function extractToolCallRequest(
  params: Record<string, unknown> | undefined,
): Result<PeerToolCallRequest | null, BadRequestError> {
  const metadata = messageMetadata(params);
  const intent =
    typeof metadata?.["intent"] === "string" ? metadata["intent"] : undefined;
  if (intent !== JACKLINE_TOOL_CALL_INTENT) {
    return ok(null);
  }

  const tool = metadata?.["tool"] as Record<string, unknown> | undefined;
  const name = tool?.["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    return err(new BadRequestError("tool.name is required for tool calls"));
  }
  const args = tool?.["arguments"];
  if (args != null && (typeof args !== "object" || Array.isArray(args))) {
    return err(new BadRequestError("tool.arguments must be an object"));
  }
  return ok({
    name: name.trim(),
    arguments: (args as Record<string, unknown> | undefined) ?? {},
  });
}

export function extractKnockPayload(
  params: Record<string, unknown> | undefined,
): Result<KnockPayload, BadRequestError> {
  if (!params) {
    return err(new BadRequestError("Invalid knock payload"));
  }

  const textResult = extractPeerMessageText(params);
  if (textResult.isErr()) {
    return err(new BadRequestError("Invalid knock payload"));
  }

  const metadata = messageMetadata(params);
  const intent =
    typeof metadata?.["intent"] === "string" ? metadata["intent"] : undefined;
  const peerAgentCardUrl =
    typeof params["peerAgentCardUrl"] === "string"
      ? params["peerAgentCardUrl"]
      : typeof metadata?.["peerAgentCardUrl"] === "string"
        ? metadata["peerAgentCardUrl"]
        : null;
  if (!peerAgentCardUrl) {
    return err(new BadRequestError("Invalid knock payload"));
  }

  const peerDisplayName =
    typeof params["peerDisplayName"] === "string"
      ? params["peerDisplayName"]
      : typeof metadata?.["peerDisplayName"] === "string"
        ? metadata["peerDisplayName"]
        : undefined;

  return ok({
    peerAgentCardUrl,
    ...(peerDisplayName !== undefined ? { peerDisplayName } : {}),
    message: textResult.value,
    ...(intent !== undefined ? { intent } : {}),
  });
}

export function isKnockIntent(payload: KnockPayload): boolean {
  return (
    payload.intent === JACKLINE_TRUST_REQUEST_INTENT ||
    payload.intent === undefined
  );
}

export function authDenialToError(reason: string): JacklineError {
  if (reason === "Authentication required") {
    return new UnauthorizedError(reason);
  }
  return new BadRequestError(reason);
}
