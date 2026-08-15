import { z } from "@hono/zod-openapi";
import { err, ok, type Result } from "neverthrow";
import { BadRequestError, type JacklineError } from "@jackline/shared";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export const PaginationQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT)
      .optional()
      .default(DEFAULT_PAGE_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Page size (1–${MAX_PAGE_LIMIT})`,
        example: DEFAULT_PAGE_LIMIT,
      }),
    cursor: z
      .string()
      .min(1)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description: "Opaque cursor from a previous page's nextCursor",
      }),
  })
  .openapi("PaginationQuery");

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Stable keyset cursor for createdAt DESC, id DESC lists. */
export type CreatedAtIdCursor = {
  createdAt: string;
  id: string;
};

const CreatedAtIdCursorSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export function encodeCreatedAtIdCursor(cursor: CreatedAtIdCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCreatedAtIdCursor(
  cursor: string,
): Result<CreatedAtIdCursor, JacklineError> {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = CreatedAtIdCursorSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      return err(new BadRequestError("Invalid cursor"));
    }
    return ok(parsed.data);
  } catch {
    return err(new BadRequestError("Invalid cursor"));
  }
}

/** Fetch `limit + 1` rows, return a page + nextCursor when more remain. */
export function toCursorPage<T>(
  rows: T[],
  limit: number,
  encode: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encode(last) : null,
  };
}
