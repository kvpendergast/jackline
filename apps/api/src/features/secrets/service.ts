import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  connections,
  db,
  memberships,
  secrets,
  servers,
  user,
  type Secret as SecretRow,
} from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  SetupError,
  type CursorPage,
  type PublicSecret,
  type SecretValue,
} from "@mesh/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";

export type CreateSecretInput = {
  kind: string;
  name: string;
  value: string;
  meta?: Record<string, unknown> | undefined;
  serverId?: string | null | undefined;
  userId?: string | null | undefined;
  connectionId?: string | null | undefined;
};

export type UpdateSecretInput = {
  name?: string | undefined;
  value?: string | undefined;
  meta?: Record<string, unknown> | undefined;
};

export type ListSecretsQuery = PaginationQuery & {
  kind?: string | undefined;
  serverId?: string | undefined;
  userId?: string | undefined;
  connectionId?: string | undefined;
};

type Binding = {
  serverId: string | null;
  userId: string | null;
  connectionId: string | null;
};

function toPublicSecret(row: SecretRow): PublicSecret {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    keyVersion: row.keyVersion,
    meta: row.meta,
    serverId: row.serverId,
    userId: row.userId,
    connectionId: row.connectionId,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeBinding(input: {
  serverId?: string | null | undefined;
  userId?: string | null | undefined;
  connectionId?: string | null | undefined;
}): Result<Binding, MeshError> {
  const serverId = input.serverId ?? null;
  const userId = input.userId ?? null;
  const connectionId = input.connectionId ?? null;

  const hasServer = serverId !== null;
  const hasUser = userId !== null;
  const hasConnection = connectionId !== null;

  const serverLevel = hasServer && !hasUser && !hasConnection;
  const userLevel = hasServer && hasUser && !hasConnection;
  const gatewayLevel = hasConnection && !hasServer && !hasUser;

  if (!serverLevel && !userLevel && !gatewayLevel) {
    return err(
      new BadRequestError(
        "Invalid secret binding: use serverId, serverId+userId, or connectionId alone",
      ),
    );
  }

  return ok({ serverId, userId, connectionId });
}

async function assertBindingInTenant(
  tenantId: string,
  binding: Binding,
): Promise<Result<void, MeshError>> {
  if (binding.connectionId) {
    const [connection] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.id, binding.connectionId),
          eq(connections.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!connection) {
      return err(
        new BadRequestError(
          "connectionId does not reference a connection in this tenant",
        ),
      );
    }
    return ok(undefined);
  }

  if (binding.serverId) {
    const [server] = await db
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(eq(servers.id, binding.serverId), eq(servers.tenantId, tenantId)),
      )
      .limit(1);

    if (!server) {
      return err(
        new BadRequestError(
          "serverId does not reference a server in this tenant",
        ),
      );
    }
  }

  if (binding.userId) {
    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, binding.userId))
      .limit(1);

    if (!existingUser) {
      return err(new BadRequestError("userId does not reference a user"));
    }

    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, binding.userId),
          eq(memberships.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      return err(new BadRequestError("userId is not a member of this tenant"));
    }
  }

  return ok(undefined);
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateSecretInput,
): Promise<Result<PublicSecret, MeshError>> {
  const bindingResult = normalizeBinding(input);
  if (bindingResult.isErr()) return err(bindingResult.error);

  const binding = bindingResult.value;
  const scopeCheck = await assertBindingInTenant(tenantId, binding);
  if (scopeCheck.isErr()) return err(scopeCheck.error);

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId,
    kind: input.kind,
    ...binding,
  });

  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(input.value),
    aad,
  );
  if (encrypted.isErr()) return err(encrypted.error);

  try {
    const [row] = await db
      .insert(secrets)
      .values({
        kind: input.kind,
        name: input.name,
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        meta: input.meta ?? {},
        serverId: binding.serverId,
        userId: binding.userId,
        connectionId: binding.connectionId,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create secret"));
    }

    log.info(
      {
        secretId: row.id,
        tenantId,
        kind: row.kind,
        serverId: row.serverId,
        connectionId: row.connectionId,
      },
      "Secret.services.create",
    );
    return ok(toPublicSecret(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A secret with this kind already exists for the binding"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  query: ListSecretsQuery,
): Promise<Result<CursorPage<PublicSecret>, MeshError>> {
  const conditions = [eq(secrets.tenantId, tenantId)];

  if (query.kind) conditions.push(eq(secrets.kind, query.kind));
  if (query.serverId) conditions.push(eq(secrets.serverId, query.serverId));
  if (query.userId) conditions.push(eq(secrets.userId, query.userId));
  if (query.connectionId) {
    conditions.push(eq(secrets.connectionId, query.connectionId));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) return err(decoded.error);

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(secrets.createdAt, createdAt),
        and(eq(secrets.createdAt, createdAt), lt(secrets.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(secrets)
    .where(and(...conditions))
    .orderBy(desc(secrets.createdAt), desc(secrets.id))
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
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    },
    "Secret.services.list",
  );

  return ok({
    items: page.items.map(toPublicSecret),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  secretId: string,
): Promise<Result<PublicSecret, MeshError>> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Secret not found"));
  }

  log.debug({ secretId, tenantId }, "Secret.services.get");
  return ok(toPublicSecret(row));
}

async function reveal(
  log: Logger,
  tenantId: string,
  secretId: string,
): Promise<Result<SecretValue, MeshError>> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Secret not found"));
  }

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId,
    kind: row.kind,
    serverId: row.serverId,
    userId: row.userId,
    connectionId: row.connectionId,
  });

  const decrypted = boxResult.value.decrypt(
    {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.keyVersion,
    },
    aad,
  );
  if (decrypted.isErr()) return err(decrypted.error);

  log.info({ secretId, tenantId }, "Secret.services.reveal");
  return ok({ value: new TextDecoder().decode(decrypted.value) });
}

async function update(
  log: Logger,
  tenantId: string,
  secretId: string,
  input: UpdateSecretInput,
): Promise<Result<PublicSecret, MeshError>> {
  const [existing] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.tenantId, tenantId)))
    .limit(1);

  if (!existing) {
    return err(new NotFoundError("Secret not found"));
  }

  const patch: Partial<typeof secrets.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.meta !== undefined) patch.meta = input.meta;

  if (input.value !== undefined) {
    const boxResult = getSecretBox();
    if (boxResult.isErr()) return err(boxResult.error);

    const aad = secretAad({
      tenantId,
      kind: existing.kind,
      serverId: existing.serverId,
      userId: existing.userId,
      connectionId: existing.connectionId,
    });

    const encrypted = boxResult.value.encrypt(
      new TextEncoder().encode(input.value),
      aad,
    );
    if (encrypted.isErr()) return err(encrypted.error);

    patch.ciphertext = encrypted.value.ciphertext;
    patch.nonce = encrypted.value.nonce;
    patch.keyVersion = encrypted.value.keyVersion;
  }

  const [row] = await db
    .update(secrets)
    .set(patch)
    .where(and(eq(secrets.id, secretId), eq(secrets.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Secret not found"));
  }

  log.info({ secretId, tenantId }, "Secret.services.update");
  return ok(toPublicSecret(row));
}

async function remove(
  log: Logger,
  tenantId: string,
  secretId: string,
): Promise<Result<PublicSecret, MeshError>> {
  const [row] = await db
    .delete(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Secret not found"));
  }

  log.info({ secretId, tenantId }, "Secret.services.delete");
  return ok(toPublicSecret(row));
}

export const secretServices = {
  list,
  create,
  get,
  reveal,
  update,
  delete: remove,
} as const;
