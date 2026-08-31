import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { chatThreads, db, type ChatThread } from "@jackline/db";
import {
  DEFAULT_CHAT_THREAD_TITLE,
  JacklineError,
  NotFoundError,
  SetupError,
  titleFromChatMessages,
  type CursorPage,
  type PublicChatThread,
  type PublicChatThreadSummary,
  type UpdateChatThreadBody,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

function toSummary(row: ChatThread): PublicChatThreadSummary {
  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublic(row: ChatThread): PublicChatThread {
  return {
    ...toSummary(row),
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}

async function list(
  log: Logger,
  tenantId: string,
  userId: string,
  query: PaginationQuery,
): Promise<Result<CursorPage<PublicChatThreadSummary>, JacklineError>> {
  const conditions = [
    eq(chatThreads.tenantId, tenantId),
    eq(chatThreads.userId, userId),
  ];

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) return err(decoded.error);
    const lastMessageAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(chatThreads.lastMessageAt, lastMessageAt),
        and(eq(chatThreads.lastMessageAt, lastMessageAt), lt(chatThreads.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(chatThreads)
    .where(and(...conditions))
    .orderBy(desc(chatThreads.lastMessageAt), desc(chatThreads.id))
    .limit(query.limit + 1);

  const page = toCursorPage(rows, query.limit, (row) =>
    encodeCreatedAtIdCursor({
      createdAt: row.lastMessageAt.toISOString(),
      id: row.id,
    }),
  );

  log.debug(
    { tenantId, userId, count: page.items.length },
    "Chat.threads.list",
  );

  return ok({
    items: page.items.map(toSummary),
    nextCursor: page.nextCursor,
  });
}

async function create(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<PublicChatThread, JacklineError>> {
  try {
    const [row] = await db
      .insert(chatThreads)
      .values({
        tenantId,
        userId,
        title: DEFAULT_CHAT_THREAD_TITLE,
        messages: [],
      })
      .returning();
    if (!row) {
      return err(new SetupError("Failed to create chat"));
    }
    log.info({ tenantId, userId, threadId: row.id }, "Chat.threads.create");
    return ok(toPublic(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "Failed to create chat"));
  }
}

async function get(
  log: Logger,
  tenantId: string,
  userId: string,
  threadId: string,
): Promise<Result<PublicChatThread, JacklineError>> {
  const [row] = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.tenantId, tenantId),
        eq(chatThreads.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return err(new NotFoundError("Chat not found"));
  log.debug({ tenantId, threadId }, "Chat.threads.get");
  return ok(toPublic(row));
}

async function update(
  log: Logger,
  tenantId: string,
  userId: string,
  threadId: string,
  body: UpdateChatThreadBody,
): Promise<Result<PublicChatThread, JacklineError>> {
  const existing = await get(log, tenantId, userId, threadId);
  if (existing.isErr()) return err(existing.error);

  const now = new Date();
  const values: Partial<ChatThread> = {
    updatedAt: now,
  };

  if (body.messages !== undefined) {
    values.messages = body.messages;
    values.lastMessageAt = now;
    if (
      body.title === undefined &&
      existing.value.title === DEFAULT_CHAT_THREAD_TITLE
    ) {
      const derived = titleFromChatMessages(body.messages);
      if (derived) values.title = derived;
    }
  }
  if (body.title !== undefined) {
    values.title = body.title.trim();
  }

  try {
    const [row] = await db
      .update(chatThreads)
      .set(values)
      .where(
        and(
          eq(chatThreads.id, threadId),
          eq(chatThreads.tenantId, tenantId),
          eq(chatThreads.userId, userId),
        ),
      )
      .returning();
    if (!row) return err(new NotFoundError("Chat not found"));
    log.info({ tenantId, threadId }, "Chat.threads.update");
    return ok(toPublic(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "Failed to update chat"));
  }
}

export const chatThreadServices = {
  list,
  create,
  get,
  update,
} as const;
