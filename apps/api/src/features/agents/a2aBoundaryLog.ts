import { ErrorCode } from "@jackline/shared";

export type A2aBoundaryContext = {
  handle?: string;
  method?: string;
};

export function a2aErrorLogLevel(status: number): "error" | "warn" {
  return status >= 500 ? "error" : "warn";
}

export function buildA2aErrorLogFields(input: {
  status: number;
  jsonRpcCode: number;
  errorCode: ErrorCode;
  context?: A2aBoundaryContext;
}) {
  return {
    errorCode: input.errorCode,
    status: input.status,
    jsonRpcCode: input.jsonRpcCode,
    ...(input.context?.handle ? { handle: input.context.handle } : {}),
    ...(input.context?.method ? { a2aMethod: input.context.method } : {}),
  };
}
