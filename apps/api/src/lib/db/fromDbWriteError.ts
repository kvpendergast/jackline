import { BadRequestError, MeshError, SetupError } from "@mesh/shared";
import { isUniqueViolation } from "./isUniqueViolation.js";

/** Map a failed DB write to a domain error (never throw). */
export function fromDbWriteError(
  cause: unknown,
  uniqueMessage: string,
): MeshError {
  if (isUniqueViolation(cause)) {
    return new BadRequestError(uniqueMessage);
  }

  const message =
    cause instanceof Error ? cause.message : "Unexpected database error";
  return new SetupError(message);
}
