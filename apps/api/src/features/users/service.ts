import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, memberships, user } from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  JacklineError,
  NotFoundError,
  SetupError,
  type CursorPage,
  type PublicUser,
  type UserKind,
} from "@jackline/shared";
import {
  resolveTeamFilter,
  type ActorAuthz,
} from "../../lib/authz/teamScope.js";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

type UserRow = typeof user.$inferSelect;

export type CreateServiceUserInput = {
  name: string;
  email?: string | undefined;
};

export type ListUsersQuery = PaginationQuery & {
  kind?: UserKind | undefined;
};

const SERVICE_MEMBERSHIP_ROLE = "member";

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    kind: row.kind,
    emailVerified: row.emailVerified,
  };
}

function defaultServiceEmail(userId: string): string {
  return `service+${userId.replace(/-/g, "")}@users.jackline.local`;
}

async function createService(
  log: Logger,
  tenantId: string,
  input: CreateServiceUserInput,
): Promise<Result<PublicUser, JacklineError>> {
  const id = crypto.randomUUID();
  const email = input.email?.trim() || defaultServiceEmail(id);
  const name = input.name.trim();
  if (!name) {
    return err(new BadRequestError("name is required"));
  }

  try {
    const [row] = await db
      .insert(user)
      .values({
        id,
        name,
        email,
        kind: "service",
        emailVerified: true,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create service user"));
    }

    const [membership] = await db
      .insert(memberships)
      .values({
        userId: row.id,
        tenantId,
        role: SERVICE_MEMBERSHIP_ROLE,
      })
      .returning();

    if (!membership) {
      await db.delete(user).where(eq(user.id, row.id));
      return err(new SetupError("Failed to create service membership"));
    }

    log.info(
      { userId: row.id, tenantId, membershipId: membership.id },
      "User.services.createService",
    );
    return ok(toPublicUser(row));
  } catch (cause) {
    await db.delete(user).where(eq(user.id, id)).catch(() => undefined);
    return err(fromDbWriteError(cause, "A user with this email already exists"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  query: ListUsersQuery,
): Promise<Result<CursorPage<PublicUser>, JacklineError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);
  const teamFilter = teamResult.value;

  const conditions = [eq(memberships.tenantId, tenantId)];
  if (teamFilter) conditions.push(eq(memberships.team, teamFilter));

  if (query.kind) {
    conditions.push(eq(user.kind, query.kind));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) return err(decoded.error);

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(user.createdAt, createdAt),
        and(eq(user.createdAt, createdAt), lt(user.id, id)),
      )!,
    );
  }

  const rows = await db
    .select({ user })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(...conditions))
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(query.limit + 1);

  const page = toCursorPage(
    rows.map((r) => r.user),
    query.limit,
    (row) =>
      encodeCreatedAtIdCursor({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
      }),
  );

  log.debug(
    {
      tenantId,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
      teamFilter,
    },
    "User.services.list",
  );

  return ok({
    items: page.items.map(toPublicUser),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  userId: string,
): Promise<Result<PublicUser, JacklineError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);
  const teamFilter = teamResult.value;

  const conditions = [
    eq(memberships.tenantId, tenantId),
    eq(memberships.userId, userId),
  ];
  if (teamFilter) conditions.push(eq(memberships.team, teamFilter));

  const [row] = await db
    .select({ user })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    if (teamFilter) {
      return err(new ForbiddenError("user is outside your team scope"));
    }
    return err(new NotFoundError("User not found in this tenant"));
  }

  log.debug({ userId, tenantId }, "User.services.get");
  return ok(toPublicUser(row.user));
}

export const userServices = {
  createService,
  list,
  get,
} as const;
