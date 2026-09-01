import type { Context } from "hono";
import { err, ok, type Result } from "neverthrow";
import { auth } from "@jackline/auth";
import {
  EmailNotVerifiedError,
  JacklineError,
  UnauthorizedError,
  type PublicUser,
} from "@jackline/shared";
import type { JacklineEnv } from "../http/env.js";
import type { AnonymousRequestContext } from "./types.js";

export async function requireSession(c: Context<JacklineEnv>): Promise<
  Result<{ ctx: AnonymousRequestContext; user: PublicUser }, JacklineError>
> {
  const ctx = c.get("requestContext");
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return err(new UnauthorizedError("No session"));
  }

  const kind =
    "kind" in session.user && session.user.kind === "service"
      ? "service"
      : "human";

  const emailVerified = session.user.emailVerified === true;

  return ok({
    ctx,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      kind,
      emailVerified,
    },
  });
}

export async function requireVerifiedSession(c: Context<JacklineEnv>): Promise<
  Result<{ ctx: AnonymousRequestContext; user: PublicUser }, JacklineError>
> {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) {
    return sessionResult;
  }

  const { ctx, user } = sessionResult.value;
  if (user.kind === "human" && !user.emailVerified) {
    return err(new EmailNotVerifiedError());
  }

  return ok({ ctx, user });
}
