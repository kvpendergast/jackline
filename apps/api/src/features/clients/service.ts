import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  generateAccessToken,
  generateClientSecret,
  hashToken,
} from "@jackline/auth";
import {
  db,
  clients,
  memberships,
  oauthAccessTokens,
  user,
  type Client as ClientRow,
} from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  getConfig,
  JacklineError,
  MembershipRoleSchema,
  NotFoundError,
  oauthTokenUrl,
  publicApiBaseUrl,
  SetupError,
  UnauthorizedError,
  type ClientKind,
  type CursorPage,
  type MembershipRole,
  type MintedClientCredentials,
  type PublicClient,
  JACKLINE_ACCESS_TOKEN_TTL_SECONDS,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

export type CreateClientInput = {
  name: string;
  kind: ClientKind;
  /** Member owner; admins may set on behalf of a user. */
  ownerUserId?: string | null | undefined;
};

export type UpdateClientInput = {
  name?: string | undefined;
  kind?: ClientKind | undefined;
  apiRole?: MembershipRole | undefined;
  apiTeam?: string | null | undefined;
};

export type ListClientsQuery = PaginationQuery & {
  kind?: ClientKind | undefined;
};

export type RotateClientCredentialsInput = {
  apiRole?: MembershipRole | undefined;
  apiTeam?: string | null | undefined;
};

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function toPublicClient(row: ClientRow): PublicClient {
  const apiRole = MembershipRoleSchema.parse(row.apiRole);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    tenantId: row.tenantId,
    ownerUserId: row.ownerUserId ?? null,
    hasClientSecret: row.clientSecretHash != null,
    apiRole,
    apiTeam: row.apiTeam ?? null,
    clientSecretRotatedAt: row.clientSecretRotatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultServiceEmail(userId: string): string {
  return `oauth-client+${userId.replace(/-/g, "")}@users.jackline.local`;
}

async function ensureServiceActor(
  tenantId: string,
  client: ClientRow,
  apiRole: MembershipRole,
  apiTeam: string | null,
): Promise<Result<{ userId: string; membershipId: string }, JacklineError>> {
  if (client.serviceUserId) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, client.serviceUserId),
          eq(memberships.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      return err(
        new SetupError("OAuth client service user is missing a membership"),
      );
    }

    if (membership.role !== apiRole || (membership.team ?? null) !== apiTeam) {
      const [updated] = await db
        .update(memberships)
        .set({
          role: apiRole,
          team: apiTeam,
          updatedAt: new Date(),
        })
        .where(eq(memberships.id, membership.id))
        .returning();
      if (!updated) {
        return err(new SetupError("Failed to update OAuth client membership"));
      }
      return ok({ userId: client.serviceUserId, membershipId: updated.id });
    }

    return ok({ userId: client.serviceUserId, membershipId: membership.id });
  }

  const id = crypto.randomUUID();
  try {
    const [row] = await db
      .insert(user)
      .values({
        id,
        name: `OAuth client: ${client.name}`,
        email: defaultServiceEmail(id),
        kind: "service",
        emailVerified: true,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create OAuth client service user"));
    }

    const [membership] = await db
      .insert(memberships)
      .values({
        userId: row.id,
        tenantId,
        role: apiRole,
        team: apiTeam,
      })
      .returning();

    if (!membership) {
      await db.delete(user).where(eq(user.id, row.id));
      return err(
        new SetupError("Failed to create OAuth client service membership"),
      );
    }

    const [updatedClient] = await db
      .update(clients)
      .set({ serviceUserId: row.id, updatedAt: new Date() })
      .where(and(eq(clients.id, client.id), eq(clients.tenantId, tenantId)))
      .returning();

    if (!updatedClient) {
      await db.delete(user).where(eq(user.id, row.id));
      return err(new SetupError("Failed to link OAuth client service user"));
    }

    return ok({ userId: row.id, membershipId: membership.id });
  } catch (cause) {
    await db.delete(user).where(eq(user.id, id)).catch(() => undefined);
    return err(fromDbWriteError(cause, "Failed to create OAuth client actor"));
  }
}

async function create(
  log: Logger,
  tenantId: string,
  actor: { userId: string; role: string },
  input: CreateClientInput,
): Promise<Result<PublicClient, JacklineError>> {
  const isAdmin = actor.role === "full_admin" || actor.role === "delegated_admin";
  const isFull = actor.role === "full_admin";

  if (input.kind === "service" && !isFull) {
    return err(new ForbiddenError("Only full_admin can create service clients"));
  }
  if (!isAdmin && input.kind !== "interactive") {
    return err(new ForbiddenError("Members may only create interactive clients"));
  }

  let ownerUserId: string | null = null;
  if (!isAdmin) {
    ownerUserId = actor.userId;
  } else if (input.ownerUserId !== undefined) {
    ownerUserId = input.ownerUserId;
  }

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name: input.name,
        kind: input.kind,
        tenantId,
        ownerUserId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create client"));
    }

    log.info({ clientId: row.id, tenantId }, "Client.services.create");
    return ok(toPublicClient(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A client with this name already exists"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  actor: { userId: string; role: string },
  query: ListClientsQuery,
): Promise<Result<CursorPage<PublicClient>, JacklineError>> {
  const conditions = [eq(clients.tenantId, tenantId)];
  const isAdmin = actor.role === "full_admin" || actor.role === "delegated_admin";

  if (!isAdmin) {
    // Own clients + org-managed (no owner)
    conditions.push(
      or(eq(clients.ownerUserId, actor.userId), isNull(clients.ownerUserId))!,
    );
  }

  if (query.kind) {
    conditions.push(eq(clients.kind, query.kind));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) {
      return err(decoded.error);
    }

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(clients.createdAt, createdAt),
        and(eq(clients.createdAt, createdAt), lt(clients.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(clients)
    .where(and(...conditions))
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .limit(query.limit + 1);

  const page = toCursorPage(rows, query.limit, (row) =>
    encodeCreatedAtIdCursor({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  );

  log.debug(
    {
      tenantId,
      kind: query.kind,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    },
    "Client.services.list",
  );

  return ok({
    items: page.items.map(toPublicClient),
    nextCursor: page.nextCursor,
  });
}

async function assertCanManageClient(
  tenantId: string,
  actor: { userId: string; role: string },
  clientId: string,
): Promise<Result<ClientRow, JacklineError>> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Client not found"));
  }

  const isFull = actor.role === "full_admin";
  const isAdmin =
    actor.role === "full_admin" || actor.role === "delegated_admin";

  if (isFull) return ok(row);
  if (row.ownerUserId === actor.userId) return ok(row);
  if (isAdmin && row.ownerUserId == null) return ok(row);

  return err(new ForbiddenError("You cannot manage this client"));
}

async function get(
  log: Logger,
  tenantId: string,
  actor: { userId: string; role: string },
  clientId: string,
): Promise<Result<PublicClient, JacklineError>> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Client not found"));
  }

  const isAdmin =
    actor.role === "full_admin" || actor.role === "delegated_admin";
  if (
    !isAdmin &&
    row.ownerUserId != null &&
    row.ownerUserId !== actor.userId
  ) {
    return err(new ForbiddenError("You cannot view this client"));
  }

  log.debug({ clientId, tenantId }, "Client.services.get");
  return ok(toPublicClient(row));
}

async function update(
  log: Logger,
  tenantId: string,
  actor: { userId: string; role: string },
  clientId: string,
  input: UpdateClientInput,
): Promise<Result<PublicClient, JacklineError>> {
  const existing = await assertCanManageClient(tenantId, actor, clientId);
  if (existing.isErr()) return err(existing.error);

  if (actor.role !== "full_admin") {
    if (input.kind === "service") {
      return err(new ForbiddenError("Only full_admin can set service clients"));
    }
    if (input.apiRole !== undefined || input.apiTeam !== undefined) {
      return err(new ForbiddenError("Only full_admin can change API roles"));
    }
  }

  const patch: Partial<typeof clients.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.apiRole !== undefined) patch.apiRole = input.apiRole;
  if (input.apiTeam !== undefined) patch.apiTeam = input.apiTeam;

  try {
    const [row] = await db
      .update(clients)
      .set(patch)
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
      .returning();

    if (!row) {
      return err(new NotFoundError("Client not found"));
    }

    if (
      row.serviceUserId &&
      (input.apiRole !== undefined || input.apiTeam !== undefined)
    ) {
      const apiRole = MembershipRoleSchema.parse(row.apiRole);
      await db
        .update(memberships)
        .set({
          role: apiRole,
          team: row.apiTeam,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(memberships.userId, row.serviceUserId),
            eq(memberships.tenantId, tenantId),
          ),
        );
    }

    log.info({ clientId, tenantId }, "Client.services.update");
    return ok(toPublicClient(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A client with this name already exists"));
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  actor: { userId: string; role: string },
  clientId: string,
): Promise<Result<PublicClient, JacklineError>> {
  const existing = await assertCanManageClient(tenantId, actor, clientId);
  if (existing.isErr()) return err(existing.error);

  const [row] = await db
    .delete(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Client not found"));
  }

  if (row.serviceUserId) {
    await db.delete(user).where(eq(user.id, row.serviceUserId)).catch(() => undefined);
  }

  log.info({ clientId, tenantId }, "Client.services.delete");
  return ok(toPublicClient(row));
}

async function rotateCredentials(
  log: Logger,
  tenantId: string,
  clientId: string,
  input: RotateClientCredentialsInput = {},
): Promise<Result<MintedClientCredentials, JacklineError>> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) {
    return err(new NotFoundError("Client not found"));
  }

  if (client.kind !== "service") {
    return err(
      new BadRequestError(
        "OAuth2 client credentials are only available for service clients",
      ),
    );
  }

  const apiRole = input.apiRole ?? MembershipRoleSchema.parse(client.apiRole);
  const apiTeam =
    input.apiTeam !== undefined ? input.apiTeam : (client.apiTeam ?? null);

  if (apiRole === "delegated_admin" && !apiTeam) {
    return err(
      new BadRequestError("apiTeam is required when apiRole is delegated_admin"),
    );
  }

  const actor = await ensureServiceActor(tenantId, client, apiRole, apiTeam);
  if (actor.isErr()) return err(actor.error);

  const config = getConfig();
  if (config.isErr()) return err(config.error);

  const clientSecret = generateClientSecret();
  const now = new Date();

  const [updated] = await db
    .update(clients)
    .set({
      clientSecretHash: hashToken(clientSecret),
      clientSecretRotatedAt: now,
      apiRole,
      apiTeam,
      serviceUserId: actor.value.userId,
      updatedAt: now,
    })
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .returning();

  if (!updated) {
    return err(new SetupError("Failed to rotate client credentials"));
  }

  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAccessTokens.clientId, clientId),
        isNull(oauthAccessTokens.revokedAt),
      ),
    );

  log.info({ clientId, tenantId }, "Client.services.rotateCredentials");
  return ok({
    clientId: updated.id,
    clientSecret,
    tokenUrl: oauthTokenUrl(publicApiBaseUrl(config.value)),
    apiRole,
    apiTeam,
  });
}

async function revokeCredentials(
  log: Logger,
  tenantId: string,
  clientId: string,
): Promise<Result<PublicClient, JacklineError>> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) {
    return err(new NotFoundError("Client not found"));
  }

  if (!client.clientSecretHash) {
    return err(new BadRequestError("Client has no credentials to revoke"));
  }

  const now = new Date();
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAccessTokens.clientId, clientId),
        isNull(oauthAccessTokens.revokedAt),
      ),
    );

  const [updated] = await db
    .update(clients)
    .set({
      clientSecretHash: null,
      clientSecretRotatedAt: null,
      updatedAt: now,
    })
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .returning();

  if (!updated) {
    return err(new SetupError("Failed to revoke client credentials"));
  }

  log.info({ clientId, tenantId }, "Client.services.revokeCredentials");
  return ok(toPublicClient(updated));
}

export type IssueAccessTokenResult = {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
};

/**
 * OAuth2 client_credentials grant. Validates client_id + client_secret.
 */
async function issueClientCredentialsToken(
  log: Logger,
  clientId: string,
  clientSecret: string,
): Promise<Result<IssueAccessTokenResult, JacklineError>> {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!client || !client.clientSecretHash) {
    return err(new UnauthorizedError("Invalid client credentials"));
  }

  if (client.kind !== "service") {
    return err(new UnauthorizedError("Invalid client credentials"));
  }

  if (
    !timingSafeEqualHex(hashToken(clientSecret), client.clientSecretHash)
  ) {
    return err(new UnauthorizedError("Invalid client credentials"));
  }

  if (!client.serviceUserId) {
    return err(
      new SetupError("OAuth client is missing a linked service user"),
    );
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, client.serviceUserId),
        eq(memberships.tenantId, client.tenantId),
      ),
    )
    .limit(1);

  if (!membership) {
    return err(new ForbiddenError("OAuth client actor is not a tenant member"));
  }

  const accessToken = generateAccessToken();
  const expiresIn = JACKLINE_ACCESS_TOKEN_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const [row] = await db
    .insert(oauthAccessTokens)
    .values({
      tokenHash: hashToken(accessToken),
      clientId: client.id,
      tenantId: client.tenantId,
      userId: client.serviceUserId,
      expiresAt,
    })
    .returning();

  if (!row) {
    return err(new SetupError("Failed to issue access token"));
  }

  log.info(
    { clientId: client.id, tenantId: client.tenantId, expiresAt },
    "Client.services.issueClientCredentialsToken",
  );

  return ok({
    accessToken,
    expiresIn,
    tokenType: "Bearer",
  });
}

export const clientServices = {
  list,
  create,
  get,
  update,
  delete: remove,
  rotateCredentials,
  revokeCredentials,
  issueClientCredentialsToken,
} as const;
