import { err, ok, type Result } from "neverthrow";
import { ForbiddenError, type MeshError } from "@mesh/shared";

/** Caller membership used for team-scoped authz. */
export type ActorAuthz = {
  role: string;
  team: string | null;
};

/**
 * Returns a team name to filter by for `delegated_admin`, or `null` for
 * `full_admin` (no filter). Errors if delegated without a team.
 */
export function resolveTeamFilter(
  actor: ActorAuthz,
): Result<string | null, MeshError> {
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
