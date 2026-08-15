import { err, ok, type Result } from "neverthrow";
import { ForbiddenError, type JacklineError } from "@jackline/shared";

/** Caller membership used for team-scoped and ownership authz. */
export type ActorAuthz = {
  userId: string;
  role: string;
  team: string | null;
};

export function isAdminRole(role: string): boolean {
  return role === "full_admin" || role === "delegated_admin";
}

/**
 * Returns a team name to filter by for `delegated_admin`, or `null` for
 * `full_admin` (no filter). Errors if delegated without a team.
 * Members get `null` here — callers should apply self-ownership filters.
 */
export function resolveTeamFilter(
  actor: ActorAuthz,
): Result<string | null, JacklineError> {
  if (actor.role === "full_admin") {
    return ok(null);
  }
  if (actor.role === "delegated_admin") {
    if (!actor.team) {
      return err(
        new ForbiddenError("delegated_admin must belong to a team"),
      );
    }
    return ok(actor.team);
  }
  return ok(null);
}
