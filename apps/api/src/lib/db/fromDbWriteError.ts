import { BadRequestError, JacklineError, SetupError } from "@jackline/shared";
import { isUniqueViolation } from "./isUniqueViolation.js";

/** Map a failed DB write to a domain error (never throw). */
export function fromDbWriteError(
  cause: unknown,
  uniqueMessage: string,
): JacklineError {
  if (isUniqueViolation(cause)) {
    return new BadRequestError(uniqueMessage);
  }

  const message =
    cause instanceof Error ? cause.message : "Unexpected database error";
  return new SetupError(message);
}
