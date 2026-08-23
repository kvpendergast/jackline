import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  clients,
  connections,
  db,
  secrets,
  type Client,
  type Connection,
} from "@jackline/db";
import {
  formatGatewayToken,
  GATEWAY_TOKEN_KIND,
  JACKLINE_CHAT_CLIENT_NAME,
  JACKLINE_CHAT_SYSTEM_KEY,
  JacklineError,
  SetupError,
} from "@jackline/shared";
import { fromDbWriteError as mapDbWrite } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";
import { connectionServices } from "../connections/service.js";

export type JacklineChatBinding = {
  client: Client;
  connection: Connection;
  gatewayToken: string;
};

async function findChatClient(
  tenantId: string,
): Promise<Client | undefined> {
  const [byKey] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        eq(clients.systemKey, JACKLINE_CHAT_SYSTEM_KEY),
      ),
    )
    .limit(1);
  if (byKey) return byKey;

  const [byName] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        eq(clients.name, JACKLINE_CHAT_CLIENT_NAME),
      ),
    )
    .limit(1);
  return byName;
}

export async function ensureJacklineChatClient(
  log: Logger,
  tenantId: string,
): Promise<Result<Client, JacklineError>> {
  const existing = await findChatClient(tenantId);
  if (existing) {
    if (existing.systemKey !== JACKLINE_CHAT_SYSTEM_KEY) {
      const [updated] = await db
        .update(clients)
        .set({
          systemKey: JACKLINE_CHAT_SYSTEM_KEY,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, existing.id))
        .returning();
      return ok(updated ?? existing);
    }
    return ok(existing);
  }

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name: JACKLINE_CHAT_CLIENT_NAME,
        kind: "interactive",
        tenantId,
        ownerUserId: null,
        systemKey: JACKLINE_CHAT_SYSTEM_KEY,
      })
      .returning();
    if (!row) {
      return err(new SetupError("Failed to create Jackline Chat client"));
    }
    log.info({ tenantId, clientId: row.id }, "ensured Jackline Chat client");
    return ok(row);
  } catch (cause) {
    const raced = await findChatClient(tenantId);
    if (raced) return ok(raced);
    return err(mapDbWrite(cause, "A client with this name already exists"));
  }
}

async function loadGatewayToken(
  tenantId: string,
  connectionId: string,
): Promise<Result<string | null, JacklineError>> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.connectionId, connectionId),
        eq(secrets.kind, GATEWAY_TOKEN_KIND),
        isNull(secrets.serverId),
        isNull(secrets.userId),
      ),
    )
    .limit(1);

  if (!row) return ok(null);

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

  const secret = new TextDecoder().decode(decrypted.value);
  return ok(formatGatewayToken(row.id, secret));
}

export async function ensureJacklineChatConnection(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<JacklineChatBinding, JacklineError>> {
  const clientResult = await ensureJacklineChatClient(log, tenantId);
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  let connection: Connection | undefined;
  const [existingConn] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.tenantId, tenantId),
        eq(connections.clientId, client.id),
        eq(connections.userId, userId),
      ),
    )
    .limit(1);
  connection = existingConn;

  if (!connection) {
    try {
      const [inserted] = await db
        .insert(connections)
        .values({
          tenantId,
          clientId: client.id,
          userId,
          status: "active",
        })
        .returning();
      if (!inserted) {
        return err(new SetupError("Failed to create Jackline Chat connection"));
      }
      connection = inserted;
      log.info(
        { tenantId, userId, connectionId: connection.id },
        "created Jackline Chat connection",
      );
    } catch (cause) {
      const [raced] = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.tenantId, tenantId),
            eq(connections.clientId, client.id),
            eq(connections.userId, userId),
          ),
        )
        .limit(1);
      if (!raced) {
        return err(mapDbWrite(cause, "Chat connection already exists"));
      }
      connection = raced;
    }
  }

  const tokenResult = await loadGatewayToken(tenantId, connection.id);
  if (tokenResult.isErr()) return err(tokenResult.error);

  let gatewayToken = tokenResult.value;
  if (!gatewayToken) {
    const minted = await connectionServices.mintCredential(
      log,
      tenantId,
      { userId, role: "member", team: null },
      connection.id,
      { name: "Jackline Chat" },
    );
    if (minted.isErr()) return err(minted.error);
    gatewayToken = minted.value.token;
  }

  return ok({ client, connection, gatewayToken });
}
