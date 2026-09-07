import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  agentNetworks,
  agentToolBindings,
  agents,
  a2aTasks,
  db,
  knocks,
  networks,
  notifications,
  tools,
  trustGrants,
  type Agent as AgentRow,
  type Knock as KnockRow,
  type TrustGrant as TrustGrantRow,
} from "@jackline/db";
import {
  generateExchangeToken,
  generateKnockSecret,
  generatePeerGrantSecret,
  hashToken,
} from "@jackline/auth";
import { timingSafeEqualHex } from "@jackline/crypto";
import {
  a2aEndpointUrl,
  agentCardUrl,
  BadRequestError,
  buildAgentCard,
  decideA2aAuth,
  DEFAULT_PUBLIC_SKILLS,
  ForbiddenError,
  isTrustGrantUsable,
  JacklineError,
  NotFoundError,
  PUBLIC_NETWORK_SLUG,
  publicApiBaseUrl,
  SetupError,
  UnauthorizedError,
  extractBearerToken,
  parsePeerGrantToken,
  formatPeerGrantToken,
  getConfig,
  type AgentDirectoryResponse,
  type ApproveKnockBody,
  type CreateAgentBody,
  type ExchangeTrustGrantBody,
  type MintedPeerGrantCredential,
  type PublicAgent,
  type PublicDirectoryAgent,
  type PublicKnock,
  type PublicTrustGrant,
  type UpdateAgentBody,
  JACKLINE_TRUST_REQUEST_INTENT,
  validateKnockMessage,
} from "@jackline/shared";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  authDenialToError,
  extractKnockPayload,
  isKnockIntent,
  type JsonRpcRequest,
} from "./a2aProtocol.js";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { buildTasksGetResult } from "./tasksGet.js";
import {
  runHostedPeerMessage,
  syncAgentToolsToOwnerChatConnection,
} from "./hostedRuntime.js";

function configPublicBaseUrl(): Result<string, JacklineError> {
  const cfg = getConfig();
  if (cfg.isErr()) return err(cfg.error);
  return ok(publicApiBaseUrl(cfg.value));
}

async function loadToolIds(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ toolId: agentToolBindings.toolId })
    .from(agentToolBindings)
    .where(eq(agentToolBindings.agentId, agentId));
  return rows.map((row) => row.toolId);
}

async function replaceAgentToolBindings(
  tenantId: string,
  agentId: string,
  toolIds: string[],
): Promise<Result<string[], JacklineError>> {
  const uniqueToolIds = [...new Set(toolIds)];

  if (uniqueToolIds.length > 0) {
    const found = await db
      .select({ id: tools.id })
      .from(tools)
      .where(
        and(eq(tools.tenantId, tenantId), inArray(tools.id, uniqueToolIds)),
      );

    if (found.length !== uniqueToolIds.length) {
      return err(
        new BadRequestError(
          "One or more toolIds do not reference tools in this tenant",
        ),
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(agentToolBindings)
      .where(
        and(
          eq(agentToolBindings.agentId, agentId),
          eq(agentToolBindings.tenantId, tenantId),
        ),
      );

    if (uniqueToolIds.length > 0) {
      await tx.insert(agentToolBindings).values(
        uniqueToolIds.map((toolId) => ({
          agentId,
          toolId,
          tenantId,
        })),
      );
    }

    await tx
      .update(agents)
      .set({ updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
  });

  return ok(uniqueToolIds);
}

function toPublicAgent(
  row: AgentRow,
  base: string,
  toolIds: string[],
): PublicAgent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerUserId: row.ownerUserId,
    handle: row.handle,
    displayName: row.displayName,
    description: row.description ?? null,
    runtimeMode: row.runtimeMode,
    upstreamAgentUrl: row.upstreamAgentUrl ?? null,
    status: row.status,
    knocksEnabled: row.knocksEnabled,
    defaultGrantTtlSeconds: row.defaultGrantTtlSeconds,
    instructions: row.instructions ?? null,
    publicSkills: row.publicSkills,
    toolIds,
    agentCardUrl: agentCardUrl(base, row.handle),
    a2aUrl: a2aEndpointUrl(base, row.handle),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicKnock(row: KnockRow): PublicKnock {
  return {
    id: row.id,
    agentId: row.agentId,
    tenantId: row.tenantId,
    peerAgentCardUrl: row.peerAgentCardUrl,
    peerDisplayName: row.peerDisplayName ?? null,
    message: row.message,
    status: row.status,
    trustGrantId: row.trustGrantId ?? null,
    a2aTaskId: row.a2aTaskId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicTrustGrant(row: TrustGrantRow): PublicTrustGrant {
  return {
    id: row.id,
    agentId: row.agentId,
    tenantId: row.tenantId,
    peerAgentCardUrl: row.peerAgentCardUrl,
    peerDisplayName: row.peerDisplayName ?? null,
    status: row.status,
    skillPolicy: row.skillPolicy,
    createdBy: row.createdBy,
    grantedAt: row.grantedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getPublicNetworkId(): Promise<Result<string, JacklineError>> {
  const [network] = await db
    .select({ id: networks.id })
    .from(networks)
    .where(eq(networks.slug, PUBLIC_NETWORK_SLUG))
    .limit(1);
  if (!network) {
    return err(new SetupError("Public network is not seeded"));
  }
  return ok(network.id);
}

async function assertAgentOwner(
  tenantId: string,
  userId: string,
  agentId: string,
): Promise<Result<AgentRow, JacklineError>> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
    .limit(1);
  if (!row) return err(new NotFoundError("Agent not found"));
  if (row.ownerUserId !== userId) {
    return err(
      new ForbiddenError("Only the agent owner may perform this action"),
    );
  }
  return ok(row);
}

async function notifyOwner(input: {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string;
}): Promise<void> {
  await db.insert(notifications).values({
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    href: input.href ?? null,
    meta: null,
  });
}

export const agentServices = {
  async listAgents(
    tenantId: string,
    userId: string,
  ): Promise<Result<{ items: PublicAgent[] }, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.ownerUserId, userId)))
      .orderBy(agents.createdAt);

    const items: PublicAgent[] = [];
    for (const row of rows) {
      const toolIds = await loadToolIds(row.id);
      items.push(toPublicAgent(row, baseResult.value, toolIds));
    }
    return ok({ items });
  },

  async createAgent(
    tenantId: string,
    userId: string,
    body: CreateAgentBody,
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    try {
      const [row] = await db
        .insert(agents)
        .values({
          tenantId,
          ownerUserId: userId,
          handle: body.handle,
          displayName: body.displayName,
          description: body.description ?? null,
          knocksEnabled: body.knocksEnabled ?? true,
          defaultGrantTtlSeconds: body.defaultGrantTtlSeconds ?? 86400,
          instructions: body.instructions ?? null,
          publicSkills: body.publicSkills ?? DEFAULT_PUBLIC_SKILLS,
        })
        .returning();
      if (!row) return err(new SetupError("Failed to create agent"));

      let toolIds: string[] = [];
      if (body.toolIds && body.toolIds.length > 0) {
        const bindResult = await replaceAgentToolBindings(
          tenantId,
          row.id,
          body.toolIds,
        );
        if (bindResult.isErr()) return err(bindResult.error);
        toolIds = bindResult.value;
      }

      return ok(toPublicAgent(row, baseResult.value, toolIds));
    } catch (e) {
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async getAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);
    const toolIds = await loadToolIds(agentId);
    return ok(toPublicAgent(ownerResult.value, baseResult.value, toolIds));
  },

  async updateAgent(
    tenantId: string,
    userId: string,
    agentId: string,
    body: UpdateAgentBody,
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    try {
      const [row] = await db
        .update(agents)
        .set({
          ...(body.displayName !== undefined
            ? { displayName: body.displayName }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.knocksEnabled !== undefined
            ? { knocksEnabled: body.knocksEnabled }
            : {}),
          ...(body.defaultGrantTtlSeconds !== undefined
            ? { defaultGrantTtlSeconds: body.defaultGrantTtlSeconds }
            : {}),
          ...(body.instructions !== undefined
            ? { instructions: body.instructions }
            : {}),
          ...(body.publicSkills !== undefined
            ? { publicSkills: body.publicSkills }
            : {}),
          ...(body.runtimeMode !== undefined
            ? { runtimeMode: body.runtimeMode }
            : {}),
          ...(body.upstreamAgentUrl !== undefined
            ? { upstreamAgentUrl: body.upstreamAgentUrl }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId))
        .returning();
      if (!row) return err(new NotFoundError("Agent not found"));
      const toolIds = await loadToolIds(agentId);
      return ok(toPublicAgent(row, baseResult.value, toolIds));
    } catch (e) {
      return err(fromDbWriteError(e, "Failed to update agent"));
    }
  },

  async setTools(
    log: Logger,
    tenantId: string,
    userId: string,
    agentId: string,
    toolIds: string[],
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const bindResult = await replaceAgentToolBindings(
      tenantId,
      agentId,
      toolIds,
    );
    if (bindResult.isErr()) return err(bindResult.error);

    const sync = await syncAgentToolsToOwnerChatConnection(
      log,
      tenantId,
      ownerResult.value.ownerUserId,
      bindResult.value,
    );
    if (sync.isErr()) return err(sync.error);

    const [row] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
      .limit(1);
    if (!row) return err(new NotFoundError("Agent not found"));

    return ok(toPublicAgent(row, baseResult.value, bindResult.value));
  },

  async listBoundTools(
    agentId: string,
  ): Promise<
    Result<
      Array<{
        toolId: string;
        name: string;
        description: string | null;
        serverId: string;
        inputSchema: Record<string, unknown> | null;
      }>,
      JacklineError
    >
  > {
    const rows = await db
      .select({
        toolId: tools.id,
        name: tools.name,
        description: tools.description,
        serverId: tools.serverId,
        inputSchema: tools.inputSchema,
      })
      .from(agentToolBindings)
      .innerJoin(tools, eq(agentToolBindings.toolId, tools.id))
      .where(eq(agentToolBindings.agentId, agentId));

    return ok(
      rows.map((row) => ({
        toolId: row.toolId,
        name: row.name,
        description: row.description ?? null,
        serverId: row.serverId,
        inputSchema: row.inputSchema ?? null,
      })),
    );
  },

  async isToolBound(agentId: string, toolId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: agentToolBindings.id })
      .from(agentToolBindings)
      .where(
        and(
          eq(agentToolBindings.agentId, agentId),
          eq(agentToolBindings.toolId, toolId),
        ),
      )
      .limit(1);
    return Boolean(row);
  },

  async publishAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const networkResult = await getPublicNetworkId();
    if (networkResult.isErr()) return err(networkResult.error);

    try {
      const [row] = await db
        .update(agents)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(agents.id, agentId))
        .returning();
      if (!row) return err(new NotFoundError("Agent not found"));

      await db
        .insert(agentNetworks)
        .values({
          agentId: row.id,
          networkId: networkResult.value,
          listed: true,
        })
        .onConflictDoUpdate({
          target: [agentNetworks.agentId, agentNetworks.networkId],
          set: { listed: true, updatedAt: new Date() },
        });

      const toolIds = await loadToolIds(agentId);
      return ok(toPublicAgent(row, baseResult.value, toolIds));
    } catch (e) {
      return err(fromDbWriteError(e, "Failed to publish agent"));
    }
  },

  async pauseAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const networkResult = await getPublicNetworkId();
    if (networkResult.isErr()) return err(networkResult.error);

    try {
      const [row] = await db
        .update(agents)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(agents.id, agentId))
        .returning();
      if (!row) return err(new NotFoundError("Agent not found"));

      await db
        .update(agentNetworks)
        .set({ listed: false, updatedAt: new Date() })
        .where(
          and(
            eq(agentNetworks.agentId, agentId),
            eq(agentNetworks.networkId, networkResult.value),
          ),
        );

      const toolIds = await loadToolIds(agentId);
      return ok(toPublicAgent(row, baseResult.value, toolIds));
    } catch (e) {
      return err(fromDbWriteError(e, "Failed to pause agent"));
    }
  },

  async searchDirectory(input: {
    q?: string;
    handle?: string;
    skill?: string;
  }): Promise<Result<AgentDirectoryResponse, JacklineError>> {
    const networkResult = await getPublicNetworkId();
    if (networkResult.isErr()) return err(networkResult.error);

    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const conditions = [
      eq(agentNetworks.networkId, networkResult.value),
      eq(agentNetworks.listed, true),
      eq(agents.status, "published"),
    ];

    if (input.handle) {
      conditions.push(eq(agents.handle, input.handle));
    }
    if (input.q) {
      const pattern = `%${input.q}%`;
      conditions.push(
        or(
          ilike(agents.handle, pattern),
          ilike(agents.displayName, pattern),
          ilike(agents.description, pattern),
        )!,
      );
    }

    const rows = await db
      .select({
        handle: agents.handle,
        displayName: agents.displayName,
        description: agents.description,
        publicSkills: agents.publicSkills,
        knocksEnabled: agents.knocksEnabled,
      })
      .from(agentNetworks)
      .innerJoin(agents, eq(agentNetworks.agentId, agents.id))
      .where(and(...conditions))
      .limit(50);

    let items: PublicDirectoryAgent[] = rows.map((row) => ({
      handle: row.handle,
      displayName: row.displayName,
      description: row.description ?? null,
      publicSkills: row.publicSkills.map((s) => s.id),
      agentCardUrl: agentCardUrl(baseResult.value, row.handle),
      knocksEnabled: row.knocksEnabled,
    }));

    if (input.skill) {
      items = items.filter((item) => item.publicSkills.includes(input.skill!));
    }

    return ok({ network: PUBLIC_NETWORK_SLUG, agents: items });
  },

  async getAgentByHandle(
    handle: string,
  ): Promise<Result<AgentRow, JacklineError>> {
    const [row] = await db
      .select()
      .from(agents)
      .where(eq(agents.handle, handle))
      .limit(1);
    if (!row) return err(new NotFoundError("Agent not found"));
    return ok(row);
  },

  async buildAgentCardForHandle(
    handle: string,
  ): Promise<Result<Record<string, unknown>, JacklineError>> {
    const agentResult = await agentServices.getAgentByHandle(handle);
    if (agentResult.isErr()) return err(agentResult.error);

    const baseResult = configPublicBaseUrl();
    if (baseResult.isErr()) return err(baseResult.error);

    const agent = agentResult.value;
    return ok(
      buildAgentCard({
        handle: agent.handle,
        displayName: agent.displayName,
        description: agent.description,
        publicSkills: agent.publicSkills,
        knocksEnabled: agent.knocksEnabled,
        publicBaseUrl: baseResult.value,
        status: agent.status,
      }),
    );
  },

  async listKnocks(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<{ items: PublicKnock[] }, JacklineError>> {
    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const rows = await db
      .select()
      .from(knocks)
      .where(and(eq(knocks.agentId, agentId), eq(knocks.tenantId, tenantId)))
      .orderBy(sql`${knocks.createdAt} desc`);
    return ok({ items: rows.map(toPublicKnock) });
  },

  async approveKnock(
    tenantId: string,
    userId: string,
    knockId: string,
    body: ApproveKnockBody,
  ): Promise<Result<PublicTrustGrant, JacklineError>> {
    const [knock] = await db
      .select()
      .from(knocks)
      .where(and(eq(knocks.id, knockId), eq(knocks.tenantId, tenantId)))
      .limit(1);
    if (!knock) return err(new NotFoundError("Knock not found"));
    if (knock.status !== "pending") {
      return err(new BadRequestError("Knock is not pending"));
    }

    const ownerResult = await assertAgentOwner(tenantId, userId, knock.agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);
    const agent = ownerResult.value;

    const ttl = body.grantTtlSeconds ?? agent.defaultGrantTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const skillIds =
      body.skillIds ?? agent.publicSkills.map((skill) => skill.id);
    const exchangeToken = generateExchangeToken();

    try {
      const [grant] = await db
        .insert(trustGrants)
        .values({
          agentId: agent.id,
          tenantId,
          peerAgentCardUrl: knock.peerAgentCardUrl,
          peerDisplayName: knock.peerDisplayName,
          status: "active",
          skillPolicy: { skillIds },
          createdBy: "knock_approval",
          expiresAt,
        })
        .returning();
      if (!grant) return err(new SetupError("Failed to create trust grant"));

      await db
        .update(knocks)
        .set({
          status: "approved",
          trustGrantId: grant.id,
          exchangeTokenHash: hashToken(exchangeToken),
          updatedAt: new Date(),
        })
        .where(eq(knocks.id, knockId));

      if (knock.a2aTaskId) {
        await db
          .update(a2aTasks)
          .set({
            state: "completed",
            result: {
              approved: true,
              grantId: grant.id,
              exchangeToken,
              expiresAt: expiresAt.toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(a2aTasks.id, knock.a2aTaskId));
      }

      return ok(toPublicTrustGrant(grant));
    } catch (e) {
      return err(fromDbWriteError(e, "Failed to approve knock"));
    }
  },

  async denyKnock(
    tenantId: string,
    userId: string,
    knockId: string,
  ): Promise<Result<PublicKnock, JacklineError>> {
    const [knock] = await db
      .select()
      .from(knocks)
      .where(and(eq(knocks.id, knockId), eq(knocks.tenantId, tenantId)))
      .limit(1);
    if (!knock) return err(new NotFoundError("Knock not found"));

    const ownerResult = await assertAgentOwner(tenantId, userId, knock.agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const [row] = await db
      .update(knocks)
      .set({ status: "denied", updatedAt: new Date() })
      .where(eq(knocks.id, knockId))
      .returning();
    if (!row) return err(new NotFoundError("Knock not found"));
    return ok(toPublicKnock(row));
  },

  async listTrustGrants(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<{ items: PublicTrustGrant[] }, JacklineError>> {
    const ownerResult = await assertAgentOwner(tenantId, userId, agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const rows = await db
      .select()
      .from(trustGrants)
      .where(
        and(eq(trustGrants.agentId, agentId), eq(trustGrants.tenantId, tenantId)),
      )
      .orderBy(sql`${trustGrants.createdAt} desc`);
    return ok({ items: rows.map(toPublicTrustGrant) });
  },

  async revokeTrustGrant(
    tenantId: string,
    userId: string,
    grantId: string,
  ): Promise<Result<PublicTrustGrant, JacklineError>> {
    const [grant] = await db
      .select()
      .from(trustGrants)
      .where(and(eq(trustGrants.id, grantId), eq(trustGrants.tenantId, tenantId)))
      .limit(1);
    if (!grant) return err(new NotFoundError("Trust grant not found"));

    const ownerResult = await assertAgentOwner(tenantId, userId, grant.agentId);
    if (ownerResult.isErr()) return err(ownerResult.error);

    const [row] = await db
      .update(trustGrants)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trustGrants.id, grantId))
      .returning();
    if (!row) return err(new NotFoundError("Trust grant not found"));
    return ok(toPublicTrustGrant(row));
  },

  async exchangeTrustGrant(
    body: ExchangeTrustGrantBody,
  ): Promise<Result<MintedPeerGrantCredential, JacklineError>> {
    const knockSecretHash = hashToken(body.knockSecret);
    const exchangeTokenHash = hashToken(body.exchangeToken);

    const [knock] = await db
      .select()
      .from(knocks)
      .where(
        and(
          eq(knocks.knockSecretHash, knockSecretHash),
          eq(knocks.status, "approved"),
        ),
      )
      .limit(1);

    if (!knock || !knock.trustGrantId || !knock.exchangeTokenHash) {
      return err(new BadRequestError("Invalid knock credentials"));
    }

    if (knock.exchangeTokenUsedAt) {
      return err(new BadRequestError("Exchange token already used"));
    }

    if (!timingSafeEqualHex(knock.exchangeTokenHash, exchangeTokenHash)) {
      return err(new BadRequestError("Invalid knock credentials"));
    }

    const [grant] = await db
      .select()
      .from(trustGrants)
      .where(eq(trustGrants.id, knock.trustGrantId))
      .limit(1);

    if (
      !grant ||
      grant.credentialSecretHash ||
      !isTrustGrantUsable(grant.status, grant.expiresAt, grant.revokedAt)
    ) {
      return err(new BadRequestError("Trust grant is not active"));
    }

    await db
      .update(knocks)
      .set({ exchangeTokenUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(knocks.id, knock.id));

    const secret = generatePeerGrantSecret();
    await db
      .update(trustGrants)
      .set({
        credentialSecretHash: hashToken(secret),
        updatedAt: new Date(),
      })
      .where(eq(trustGrants.id, grant.id));

    return ok({
      token: formatPeerGrantToken(grant.id, secret),
      grantId: grant.id,
      expiresAt: grant.expiresAt.toISOString(),
    });
  },

  async createKnock(input: {
    agent: AgentRow;
    peerAgentCardUrl: string;
    peerDisplayName?: string;
    message: string;
  }): Promise<
    Result<
      { knockId: string; taskId: string; knockSecret: string },
      JacklineError
    >
  > {
    if (input.agent.status !== "published") {
      return err(new BadRequestError("Agent is not published"));
    }
    if (!input.agent.knocksEnabled) {
      return err(new BadRequestError("Knocks are disabled for this agent"));
    }

    const messageResult = validateKnockMessage(input.message);
    if (messageResult.isErr()) return err(messageResult.error);

    const knockSecret = generateKnockSecret();
    const knockSecretHash = hashToken(knockSecret);

    const [existing] = await db
      .select()
      .from(knocks)
      .where(
        and(
          eq(knocks.agentId, input.agent.id),
          eq(knocks.peerAgentCardUrl, input.peerAgentCardUrl),
          eq(knocks.status, "pending"),
        ),
      )
      .limit(1);

    if (existing) {
      let taskId = existing.a2aTaskId;
      if (!taskId) {
        const [task] = await db
          .insert(a2aTasks)
          .values({
            agentId: input.agent.id,
            tenantId: input.agent.tenantId,
            knockId: existing.id,
            state: "input_required",
            method: "message/send",
            params: {
              intent: JACKLINE_TRUST_REQUEST_INTENT,
              peerAgentCardUrl: input.peerAgentCardUrl,
            },
          })
          .returning();
        taskId = task?.id ?? null;
      }

      const [updated] = await db
        .update(knocks)
        .set({
          message: input.message,
          peerDisplayName: input.peerDisplayName ?? existing.peerDisplayName,
          knockSecretHash,
          ...(taskId && !existing.a2aTaskId ? { a2aTaskId: taskId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(knocks.id, existing.id))
        .returning();
      if (!updated) return err(new SetupError("Failed to update knock"));
      return ok({
        knockId: updated.id,
        taskId: updated.a2aTaskId ?? taskId ?? updated.id,
        knockSecret,
      });
    }

    const [task] = await db
      .insert(a2aTasks)
      .values({
        agentId: input.agent.id,
        tenantId: input.agent.tenantId,
        state: "input_required",
        method: "message/send",
        params: {
          intent: JACKLINE_TRUST_REQUEST_INTENT,
          peerAgentCardUrl: input.peerAgentCardUrl,
        },
      })
      .returning();

    const [knock] = await db
      .insert(knocks)
      .values({
        agentId: input.agent.id,
        tenantId: input.agent.tenantId,
        peerAgentCardUrl: input.peerAgentCardUrl,
        peerDisplayName: input.peerDisplayName ?? null,
        message: input.message,
        knockSecretHash,
        a2aTaskId: task?.id ?? null,
      })
      .returning();

    if (!knock) return err(new SetupError("Failed to create knock"));

    await notifyOwner({
      tenantId: input.agent.tenantId,
      userId: input.agent.ownerUserId,
      type: "agent.knock.pending",
      title: "New knock",
      body: `Knock from ${input.peerDisplayName ?? input.peerAgentCardUrl}`,
      href: `/my-agents/${input.agent.id}#knocks`,
    });

    return ok({
      knockId: knock.id,
      taskId: task?.id ?? knock.id,
      knockSecret,
    });
  },

  async resolvePeerGrant(
    authorization: string | undefined,
    agentId: string,
    log: Logger,
  ): Promise<Result<{ grantId: string }, JacklineError>> {
    const bearer = extractBearerToken(authorization);
    if (!bearer) return err(new UnauthorizedError("Authentication required"));

    const parsed = parsePeerGrantToken(bearer);
    if (parsed.isErr()) {
      return err(new UnauthorizedError("Invalid peer grant token"));
    }

    const { secretId, secret } = parsed.value;
    const [grant] = await db
      .select()
      .from(trustGrants)
      .where(and(eq(trustGrants.id, secretId), eq(trustGrants.agentId, agentId)))
      .limit(1);

    if (!grant || !grant.credentialSecretHash) {
      log.warn({ secretId }, "peer grant: unknown credential");
      return err(new UnauthorizedError("Invalid peer grant token"));
    }

    if (!timingSafeEqualHex(grant.credentialSecretHash, hashToken(secret))) {
      log.warn({ secretId }, "peer grant: secret mismatch");
      return err(new UnauthorizedError("Invalid peer grant token"));
    }

    if (!isTrustGrantUsable(grant.status, grant.expiresAt, grant.revokedAt)) {
      return err(new UnauthorizedError("Trust grant expired or revoked"));
    }

    return ok({ grantId: grant.id });
  },

  async processA2aJsonRpc(input: {
    handle: string;
    authorization: string | undefined;
    body: JsonRpcRequest;
    log: Logger;
    /** Session or OAuth access token — required for knock path until rate limits ship. */
    hasApiCredential: boolean;
  }): Promise<
    Result<{ id: string | number | null; result: unknown }, JacklineError>
  > {
    const agentResult = await agentServices.getAgentByHandle(input.handle);
    if (agentResult.isErr()) return err(agentResult.error);
    const agent = agentResult.value;

    const grantResult = await agentServices.resolvePeerGrant(
      input.authorization,
      agent.id,
      input.log,
    );
    const hasValidGrant = grantResult.isOk();

    const knockPayloadResult =
      input.body.method === "message/send"
        ? extractKnockPayload(input.body.params)
        : null;

    const decision = decideA2aAuth({
      agentStatus: agent.status,
      knocksEnabled: agent.knocksEnabled,
      method: input.body.method,
      hasValidGrant,
      ...(grantResult.isOk() ? { trustGrantId: grantResult.value.grantId } : {}),
      isKnockIntent: Boolean(
        knockPayloadResult?.isOk() &&
          isKnockIntent(knockPayloadResult.value),
      ),
      hasApiCredential: input.hasApiCredential,
    });

    if (decision.action === "deny") {
      return err(authDenialToError(decision.reason));
    }

    if (decision.action === "knock_only") {
      if (!input.hasApiCredential) {
        return err(new UnauthorizedError("Authentication required"));
      }
      if (!knockPayloadResult || knockPayloadResult.isErr()) {
        return err(knockPayloadResult?.error ?? new BadRequestError("Invalid knock payload"));
      }
      const payload = knockPayloadResult.value;
      const knockResult = await agentServices.createKnock({
        agent,
        peerAgentCardUrl: payload.peerAgentCardUrl,
        ...(payload.peerDisplayName !== undefined
          ? { peerDisplayName: payload.peerDisplayName }
          : {}),
        message: payload.message,
      });
      if (knockResult.isErr()) return err(knockResult.error);

      const { knockId, taskId, knockSecret } = knockResult.value;
      return ok({
        id: input.body.id,
        result: {
          taskId,
          state: "input_required",
          knockId,
          knockSecret,
        },
      });
    }

    if (input.body.method === "tasks/get") {
      const taskId = input.body.params?.["taskId"];
      if (typeof taskId !== "string" || taskId.length === 0) {
        return err(new BadRequestError("taskId is required"));
      }

      const [taskRow] = await db
        .select({
          id: a2aTasks.id,
          agentId: a2aTasks.agentId,
          state: a2aTasks.state,
          result: a2aTasks.result,
          error: a2aTasks.error,
        })
        .from(a2aTasks)
        .where(and(eq(a2aTasks.id, taskId), eq(a2aTasks.agentId, agent.id)))
        .limit(1);

      const shaped = buildTasksGetResult(agent.id, taskId, taskRow);
      if (shaped.isErr()) return err(shaped.error);

      return ok({
        id: input.body.id,
        result: shaped.value,
      });
    }

    if (input.body.method === "message/send" && decision.action === "allow") {
      return runHostedPeerMessage({
        agent,
        trustGrantId: decision.trustGrantId,
        params: input.body.params,
        rpcId: input.body.id,
        log: input.log,
      });
    }

    return ok({
      id: input.body.id,
      result: {
        state: "completed",
        message: "OK",
      },
    });
  },
};
