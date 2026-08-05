/** Postgres unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    if (
      typeof current === "object" &&
      current !== null &&
      "cause" in current
    ) {
      current = (current as { cause: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}
