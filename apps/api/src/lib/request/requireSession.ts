import type { Context } from "hono";
import { err, ok, type Result } from "neverthrow";
import { auth } from "@mesh/auth";
import { MeshError, UnauthorizedError, type PublicUser } from "@mesh/shared";
import type { MeshEnv } from "../http/env.js";
import type { AnonymousRequestContext } from "./types.js";

export async function requireSession(c: Context<MeshEnv>): Promise<
  Result<{ ctx: AnonymousRequestContext; user: PublicUser }, MeshError>
> {
  const ctx = c.get("requestContext");
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return err(new UnauthorizedError("No session"));
  }

  return ok({
    ctx,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
  });
}
