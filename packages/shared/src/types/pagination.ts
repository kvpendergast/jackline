import z from "zod";

export function cursorPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.strictObject({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
