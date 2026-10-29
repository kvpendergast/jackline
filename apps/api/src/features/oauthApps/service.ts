import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, oauthApps, secrets, servers } from "@jackline/db";
import {
  BadRequestError,
  JacklineError,
  NotFoundError,
  OAUTH_CLIENT_SECRET_KIND,
  SetupError,
  type CreateOAuthAppBody,
  type CreateOAuthAppFromServerBody,
  type PublicOAuthApp,
  type UpdateOAuthAppBody,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";
import { encryptOAuthAppSecret, loadOAuthAppRow } from "./credentials.js";
import {
  decideOAuthAppDelete,
  planOAuthAppPatch,
  toPublicOAuthApp,
} from "./logic.js";

const DUPLICATE_NAME = "An OAuth app with this name already exists";

async function linkedCounts(
  tenantId: string,
  appIds: string[],
): Promise<Map<string, number>> {
  if (appIds.length === 0) return new Map();
  const rows = await db
    .select({ appId: servers.oauthAppId, n: count() })
    .from(servers)
    .where(and(eq(servers.tenantId, tenantId), inArray(servers.oauthAppId, appIds)))
    .groupBy(servers.oauthAppId);
  return new Map(
    rows
      .filter((r): r is { appId: string; n: number } => r.appId != null)
      .map((r) => [r.appId, Number(r.n)]),
  );
}

async function toPublic(
  tenantId: string,
  row: typeof oauthApps.$inferSelect,
): Promise<PublicOAuthApp> {
  const counts = await linkedCounts(tenantId, [row.id]);
  return toPublicOAuthApp(row, counts.get(row.id) ?? 0);
}

async function list(
  log: Logger,
  tenantId: string,
): Promise<Result<{ items: PublicOAuthApp[] }, JacklineError>> {
  const rows = await db
    .select()
    .from(oauthApps)
    .where(eq(oauthApps.tenantId, tenantId))
    .orderBy(asc(oauthApps.name));
  const counts = await linkedCounts(
    tenantId,
    rows.map((r) => r.id),
  );
  log.debug({ tenantId, count: rows.length }, "OAuthApp.services.list");
  return ok({
    items: rows.map((r) => toPublicOAuthApp(r, counts.get(r.id) ?? 0)),
  });
}

async function get(
  log: Logger,
  tenantId: string,
  appId: string,
): Promise<Result<PublicOAuthApp, JacklineError>> {
  const row = await loadOAuthAppRow(tenantId, appId);
  if (!row) return err(new NotFoundError("OAuth app not found"));
  log.debug({ tenantId, appId }, "OAuthApp.services.get");
  return ok(await toPublic(tenantId, row));
}

async function insertApp(
  tenantId: string,
  input: CreateOAuthAppBody,
): Promise<Result<typeof oauthApps.$inferSelect, JacklineError>> {
  // Id is generated up-front so the secret's AAD can bind to it.
  const id = randomUUID();
  let encrypted = null;
  if (input.clientSecret) {
    const enc = encryptOAuthAppSecret(tenantId, id, input.clientSecret);
    if (enc.isErr()) return err(enc.error);
    encrypted = enc.value;
  }
  try {
    const [row] = await db
      .insert(oauthApps)
      .values({
        id,
        tenantId,
        name: input.name,
        clientId: input.clientId,
        authorizeUrl: input.authorizeUrl ?? null,
        tokenUrl: input.tokenUrl ?? null,
        registrationUrl: input.registrationUrl ?? null,
        ...(encrypted ?? {}),
      })
      .returning();
    if (!row) return err(new SetupError("Failed to create OAuth app"));
    return ok(row);
  } catch (cause) {
    return err(fromDbWriteError(cause, DUPLICATE_NAME));
  }
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateOAuthAppBody,
): Promise<Result<PublicOAuthApp, JacklineError>> {
  const row = await insertApp(tenantId, input);
  if (row.isErr()) return err(row.error);
  log.info(
    { tenantId, appId: row.value.id, hasSecret: Boolean(input.clientSecret) },
    "OAuthApp.services.create",
  );
  return ok(toPublicOAuthApp(row.value, 0));
}

async function update(
  log: Logger,
  tenantId: string,
  appId: string,
  input: UpdateOAuthAppBody,
): Promise<Result<PublicOAuthApp, JacklineError>> {
  const plan = planOAuthAppPatch(input);
  const patch: Partial<typeof oauthApps.$inferInsert> & { updatedAt: Date } = {
    ...plan.columns,
    updatedAt: new Date(),
  };
  if (plan.secret.action === "rotate") {
    const enc = encryptOAuthAppSecret(tenantId, appId, plan.secret.clientSecret);
    if (enc.isErr()) return err(enc.error);
    Object.assign(patch, enc.value);
  } else if (plan.secret.action === "clear") {
    patch.clientSecretCiphertext = null;
    patch.clientSecretNonce = null;
    patch.clientSecretKeyVersion = null;
  }

  try {
    const [row] = await db
      .update(oauthApps)
      .set(patch)
      .where(and(eq(oauthApps.id, appId), eq(oauthApps.tenantId, tenantId)))
      .returning();
    if (!row) return err(new NotFoundError("OAuth app not found"));
    log.info(
      { tenantId, appId, secret: plan.secret.action },
      "OAuthApp.services.update",
    );
    return ok(await toPublic(tenantId, row));
  } catch (cause) {
    return err(fromDbWriteError(cause, DUPLICATE_NAME));
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  appId: string,
  options: { detach: boolean },
): Promise<Result<PublicOAuthApp, JacklineError>> {
  const row = await loadOAuthAppRow(tenantId, appId);
  if (!row) return err(new NotFoundError("OAuth app not found"));

  const linked = await db
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .where(and(eq(servers.tenantId, tenantId), eq(servers.oauthAppId, appId)));

  const decision = decideOAuthAppDelete(linked, options.detach);
  if (decision.action === "refuse") {
    return err(new BadRequestError(decision.message));
  }

  await db.transaction(async (tx) => {
    if (decision.action === "detach_and_delete") {
      await tx
        .update(servers)
        .set({ oauthAppId: null, updatedAt: new Date() })
        .where(
          and(eq(servers.tenantId, tenantId), eq(servers.oauthAppId, appId)),
        );
    }
    await tx
      .delete(oauthApps)
      .where(and(eq(oauthApps.id, appId), eq(oauthApps.tenantId, tenantId)));
  });

  log.info(
    { tenantId, appId, detached: linked.length },
    "OAuthApp.services.delete",
  );
  return ok(toPublicOAuthApp(row, 0));
}

/**
 * "Save as shared app": copy an existing server's own client id + secret into
 * a new app (decrypt + re-encrypt server-side, never exposed) and link the
 * server to it. The server's per-server fields are left in place as fallback.
 */
async function createFromServer(
  log: Logger,
  tenantId: string,
  input: CreateOAuthAppFromServerBody,
): Promise<Result<PublicOAuthApp, JacklineError>> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, input.serverId), eq(servers.tenantId, tenantId)))
    .limit(1);
  if (!server) return err(new NotFoundError("Server not found"));
  if (server.authMethod !== "oauth") {
    return err(new BadRequestError("Server does not use OAuth"));
  }
  const clientId = server.oauthClientId?.trim();
  if (!clientId) {
    return err(new BadRequestError("Server has no OAuth client id to save"));
  }

  const [secretRow] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, server.id),
        eq(secrets.kind, OAUTH_CLIENT_SECRET_KIND),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  let clientSecret: string | undefined;
  if (secretRow) {
    const box = getSecretBox();
    if (box.isErr()) return err(box.error);
    const decrypted = box.value.decrypt(
      {
        ciphertext: secretRow.ciphertext,
        nonce: secretRow.nonce,
        keyVersion: secretRow.keyVersion,
      },
      secretAad({
        tenantId,
        kind: OAUTH_CLIENT_SECRET_KIND,
        serverId: server.id,
        userId: null,
        connectionId: null,
      }),
    );
    if (decrypted.isErr()) return err(decrypted.error);
    clientSecret = new TextDecoder().decode(decrypted.value);
  }

  const created = await insertApp(tenantId, {
    name: input.name,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    authorizeUrl: server.oauthAuthorizeUrl,
    tokenUrl: server.oauthTokenUrl,
    registrationUrl: null,
  });
  if (created.isErr()) return err(created.error);

  await db
    .update(servers)
    .set({ oauthAppId: created.value.id, updatedAt: new Date() })
    .where(and(eq(servers.id, server.id), eq(servers.tenantId, tenantId)));

  log.info(
    { tenantId, appId: created.value.id, serverId: server.id },
    "OAuthApp.services.createFromServer",
  );
  return ok(toPublicOAuthApp(created.value, 1));
}

export const oauthAppServices = {
  list,
  get,
  create,
  update,
  delete: remove,
  createFromServer,
} as const;
