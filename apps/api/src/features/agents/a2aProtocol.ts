import {
  BadRequestError,
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

export function extractKnockPayload(
  params: Record<string, unknown> | undefined,
): Result<KnockPayload, BadRequestError> {
  if (!params) {
    return err(new BadRequestError("Invalid knock payload"));
  }

  const message = params["message"] as Record<string, unknown> | undefined;
  const parts = message?.["parts"] as Array<Record<string, unknown>> | undefined;
  const textPart = parts?.find((p) => p["kind"] === "text");
  const text = textPart?.["text"];
  if (typeof text !== "string") {
    return err(new BadRequestError("Invalid knock payload"));
  }

  const metadata = message?.["metadata"] as Record<string, unknown> | undefined;
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
    message: text,
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
