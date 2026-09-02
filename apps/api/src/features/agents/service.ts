import { and, eq, ilike, or, sql } from "drizzle-orm";
import {
  agentNetworks,
  agents,
  a2aTasks,
  db,
  knocks,
  networks,
  notifications,
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
import {
  a2aEndpointUrl,
  agentCardUrl,
  BadRequestError,
  DEFAULT_PUBLIC_SKILLS,
  ForbiddenError,
  isTrustGrantUsable,
  JacklineError,
  NotFoundError,
  PUBLIC_NETWORK_SLUG,
  publicApiBaseUrl,
  SetupError,
  timingSafeEqualHex,
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
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";

function configPublicBaseUrl(): string {
  const cfg = getConfig();
  if (cfg.isErr()) throw cfg.error;
  return publicApiBaseUrl(cfg.value);
}

function toPublicAgent(row: AgentRow): PublicAgent {
  const base = configPublicBaseUrl();
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
    publicSkills: row.publicSkills,
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

async function getPublicNetworkId(): Promise<string> {
  const [network] = await db
    .select({ id: networks.id })
    .from(networks)
    .where(eq(networks.slug, PUBLIC_NETWORK_SLUG))
    .limit(1);
  if (!network) {
    throw new SetupError("Public network is not seeded");
  }
  return network.id;
}

async function assertAgentOwner(
  tenantId: string,
  userId: string,
  agentId: string,
): Promise<AgentRow> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError("Agent not found");
  if (row.ownerUserId !== userId) {
    throw new ForbiddenError("Only the agent owner may perform this action");
  }
  return row;
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
    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.ownerUserId, userId)))
      .orderBy(agents.createdAt);
    return ok({ items: rows.map(toPublicAgent) });
  },

  async createAgent(
    tenantId: string,
    userId: string,
    body: CreateAgentBody,
  ): Promise<Result<PublicAgent, JacklineError>> {
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
          publicSkills: body.publicSkills ?? DEFAULT_PUBLIC_SKILLS,
        })
        .returning();
      if (!row) return err(new SetupError("Failed to create agent"));
      return ok(toPublicAgent(row));
    } catch (e) {
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async getAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    try {
      const row = await assertAgentOwner(tenantId, userId, agentId);
      return ok(toPublicAgent(row));
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      throw e;
    }
  },

  async updateAgent(
    tenantId: string,
    userId: string,
    agentId: string,
    body: UpdateAgentBody,
  ): Promise<Result<PublicAgent, JacklineError>> {
    try {
      await assertAgentOwner(tenantId, userId, agentId);
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
      return ok(toPublicAgent(row));
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async publishAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    try {
      await assertAgentOwner(tenantId, userId, agentId);
      const publicNetworkId = await getPublicNetworkId();
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
          networkId: publicNetworkId,
          listed: true,
        })
        .onConflictDoUpdate({
          target: [agentNetworks.agentId, agentNetworks.networkId],
          set: { listed: true, updatedAt: new Date() },
        });

      return ok(toPublicAgent(row));
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async pauseAgent(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<PublicAgent, JacklineError>> {
    try {
      await assertAgentOwner(tenantId, userId, agentId);
      const publicNetworkId = await getPublicNetworkId();
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
            eq(agentNetworks.networkId, publicNetworkId),
          ),
        );

      return ok(toPublicAgent(row));
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async searchDirectory(input: {
    q?: string;
    handle?: string;
    skill?: string;
  }): Promise<Result<AgentDirectoryResponse, JacklineError>> {
    const publicNetworkId = await getPublicNetworkId();
    const base = configPublicBaseUrl();

    const conditions = [
      eq(agentNetworks.networkId, publicNetworkId),
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

    let query = db
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

    const rows = await query;

    let items: PublicDirectoryAgent[] = rows.map((row) => ({
      handle: row.handle,
      displayName: row.displayName,
      description: row.description ?? null,
      publicSkills: row.publicSkills.map((s) => s.id),
      agentCardUrl: agentCardUrl(base, row.handle),
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

  async listKnocks(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<{ items: PublicKnock[] }, JacklineError>> {
    try {
      await assertAgentOwner(tenantId, userId, agentId);
      const rows = await db
        .select()
        .from(knocks)
        .where(and(eq(knocks.agentId, agentId), eq(knocks.tenantId, tenantId)))
        .orderBy(sql`${knocks.createdAt} desc`);
      return ok({ items: rows.map(toPublicKnock) });
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      throw e;
    }
  },

  async approveKnock(
    tenantId: string,
    userId: string,
    knockId: string,
    body: ApproveKnockBody,
  ): Promise<Result<PublicTrustGrant, JacklineError>> {
    try {
      const [knock] = await db
        .select()
        .from(knocks)
        .where(and(eq(knocks.id, knockId), eq(knocks.tenantId, tenantId)))
        .limit(1);
      if (!knock) return err(new NotFoundError("Knock not found"));
      if (knock.status !== "pending") {
        return err(new BadRequestError("Knock is not pending"));
      }

      const agent = await assertAgentOwner(tenantId, userId, knock.agentId);
      const ttl = body.grantTtlSeconds ?? agent.defaultGrantTtlSeconds;
      const expiresAt = new Date(Date.now() + ttl * 1000);
      const skillIds =
        body.skillIds ?? agent.publicSkills.map((skill) => skill.id);
      const exchangeToken = generateExchangeToken();

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
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async denyKnock(
    tenantId: string,
    userId: string,
    knockId: string,
  ): Promise<Result<PublicKnock, JacklineError>> {
    try {
      const [knock] = await db
        .select()
        .from(knocks)
        .where(and(eq(knocks.id, knockId), eq(knocks.tenantId, tenantId)))
        .limit(1);
      if (!knock) return err(new NotFoundError("Knock not found"));
      await assertAgentOwner(tenantId, userId, knock.agentId);

      const [row] = await db
        .update(knocks)
        .set({ status: "denied", updatedAt: new Date() })
        .where(eq(knocks.id, knockId))
        .returning();
      if (!row) return err(new NotFoundError("Knock not found"));
      return ok(toPublicKnock(row));
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
  },

  async listTrustGrants(
    tenantId: string,
    userId: string,
    agentId: string,
  ): Promise<Result<{ items: PublicTrustGrant[] }, JacklineError>> {
    try {
      await assertAgentOwner(tenantId, userId, agentId);
      const rows = await db
        .select()
        .from(trustGrants)
        .where(
          and(eq(trustGrants.agentId, agentId), eq(trustGrants.tenantId, tenantId)),
        )
        .orderBy(sql`${trustGrants.createdAt} desc`);
      return ok({ items: rows.map(toPublicTrustGrant) });
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      throw e;
    }
  },

  async revokeTrustGrant(
    tenantId: string,
    userId: string,
    grantId: string,
  ): Promise<Result<PublicTrustGrant, JacklineError>> {
    try {
      const [grant] = await db
        .select()
        .from(trustGrants)
        .where(and(eq(trustGrants.id, grantId), eq(trustGrants.tenantId, tenantId)))
        .limit(1);
      if (!grant) return err(new NotFoundError("Trust grant not found"));
      await assertAgentOwner(tenantId, userId, grant.agentId);

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
    } catch (e) {
      if (e instanceof JacklineError) return err(e);
      return err(fromDbWriteError(e, "Handle already exists"));
    }
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

    const messageError = validateKnockMessage(input.message);
    if (messageError) return err(new BadRequestError(messageError));

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

    let knockRow: KnockRow;
    if (existing) {
      const [updated] = await db
        .update(knocks)
        .set({
          message: input.message,
          peerDisplayName: input.peerDisplayName ?? existing.peerDisplayName,
          knockSecretHash,
          updatedAt: new Date(),
        })
        .where(eq(knocks.id, existing.id))
        .returning();
      knockRow = updated!;
      return ok({
        knockId: knockRow.id,
        taskId: knockRow.a2aTaskId ?? knockRow.id,
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
      href: "/my-access/knocks",
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
    if (!bearer) return err(new BadRequestError("Authentication required"));

    const parsed = parsePeerGrantToken(bearer);
    if (parsed.isErr()) return err(parsed.error);

    const { secretId, secret } = parsed.value;
    const [grant] = await db
      .select()
      .from(trustGrants)
      .where(and(eq(trustGrants.id, secretId), eq(trustGrants.agentId, agentId)))
      .limit(1);

    if (!grant || !grant.credentialSecretHash) {
      log.warn({ secretId }, "peer grant: unknown credential");
      return err(new BadRequestError("Invalid peer grant token"));
    }

    if (!timingSafeEqualHex(grant.credentialSecretHash, hashToken(secret))) {
      log.warn({ secretId }, "peer grant: secret mismatch");
      return err(new BadRequestError("Invalid peer grant token"));
    }

    if (!isTrustGrantUsable(grant.status, grant.expiresAt, grant.revokedAt)) {
      return err(new BadRequestError("Trust grant expired or revoked"));
    }

    return ok({ grantId: grant.id });
  },
};
