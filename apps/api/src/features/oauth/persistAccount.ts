import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import {
  db,
  secrets,
  upstreamAccounts,
  type UpstreamAccount,
} from "@jackline/db";
import {
  BadRequestError,
  decideOAuthAccountWrite,
  JacklineError,
  SetupError,
  upstreamSecretKind,
  type OAuthAccountIdentity,
  type OAuthAccountMode,
  type UpstreamAccountRef,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";

export type PersistedOAuthAccount = {
  status: "created" | "refreshed";
  accountId: string;
  label: string;
  email: string | null;
};

function toRef(row: UpstreamAccount): UpstreamAccountRef {
  return {
    id: row.id,
    label: row.label,
    externalEmail: row.externalEmail,
    externalSubject: row.externalSubject,
    isDefault: row.isDefault,
  };
}

/**
 * Write the new token onto exactly one upstream account.
 * AAD stays tenant|kind|server|user| so previously encrypted tokens still decrypt.
 */
export async function persistOAuthAccount(input: {
  tenantId: string;
  userId: string;
  serverId: string;
  serverName: string;
  plaintext: string;
  mode: OAuthAccountMode;
  reconnectAccountId?: string | null;
  expectedEmail?: string | null;
  requestedLabel?: string | null;
  identity: OAuthAccountIdentity;
}): Promise<Result<PersistedOAuthAccount, JacklineError>> {
  const kind = upstreamSecretKind("oauth");
  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId: input.tenantId,
    kind,
    serverId: input.serverId,
    userId: input.userId,
    connectionId: null,
  });
  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(input.plaintext),
    aad,
  );
  if (encrypted.isErr()) return err(encrypted.error);

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(upstreamAccounts)
        .where(
          and(
            eq(upstreamAccounts.tenantId, input.tenantId),
            eq(upstreamAccounts.serverId, input.serverId),
            eq(upstreamAccounts.userId, input.userId),
          ),
        );

      const decision = decideOAuthAccountWrite({
        accounts: rows.map(toRef),
        mode: input.mode,
        reconnectAccountId: input.reconnectAccountId,
        expectedEmail: input.expectedEmail,
        requestedLabel: input.requestedLabel,
        identity: input.identity,
      });
      if (decision.type === "reject") {
        return err(new BadRequestError(decision.message));
      }

      let accountId: string;
      let label: string;
      let email: string | null;
      let status: "created" | "refreshed";

      if (decision.type === "create") {
        const [created] = await tx
          .insert(upstreamAccounts)
          .values({
            label: decision.label,
            externalEmail: decision.email,
            externalSubject: decision.subject,
            isDefault: decision.isDefault,
            serverId: input.serverId,
            userId: input.userId,
            tenantId: input.tenantId,
          })
          .returning();
        if (!created) return err(new SetupError("Failed to store upstream account"));
        accountId = created.id;
        label = created.label;
        email = created.externalEmail;
        status = "created";
      } else {
        const [updated] = await tx
          .update(upstreamAccounts)
          .set({
            externalEmail: decision.email,
            externalSubject: decision.subject,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(upstreamAccounts.id, decision.accountId),
              eq(upstreamAccounts.tenantId, input.tenantId),
              eq(upstreamAccounts.userId, input.userId),
            ),
          )
          .returning();
        if (!updated) {
          return err(new BadRequestError("That account is no longer connected. No account was changed."));
        }
        accountId = updated.id;
        label = updated.label;
        email = updated.externalEmail;
        status = decision.refreshed ? "refreshed" : "created";
      }

      const secretName = `${input.serverName} ${label} oauth`;
      const [existing] = await tx
        .select({ id: secrets.id })
        .from(secrets)
        .where(
          and(
            eq(secrets.tenantId, input.tenantId),
            eq(secrets.upstreamAccountId, accountId),
            eq(secrets.kind, kind),
            isNull(secrets.connectionId),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(secrets)
          .set({
            name: secretName,
            ciphertext: encrypted.value.ciphertext,
            nonce: encrypted.value.nonce,
            keyVersion: encrypted.value.keyVersion,
            updatedAt: new Date(),
          })
          .where(eq(secrets.id, existing.id));
      } else {
        await tx.insert(secrets).values({
          kind,
          name: secretName,
          ciphertext: encrypted.value.ciphertext,
          nonce: encrypted.value.nonce,
          keyVersion: encrypted.value.keyVersion,
          serverId: input.serverId,
          userId: input.userId,
          connectionId: null,
          upstreamAccountId: accountId,
          tenantId: input.tenantId,
        });
      }

      return ok({ status, accountId, label, email });
    });
  } catch (cause) {
    return err(fromDbWriteError(cause, "Could not save that account. Try a different label."));
  }
}
