import type { CursorPage } from "@jackline/shared";

/** Safety cap so a stuck cursor cannot loop forever (100 items × 200 pages). */
export const MAX_CURSOR_PAGES = 200;

/**
 * Follow `nextCursor` until it is null and return every item.
 * Throws if a cursor is repeated or the page cap is exceeded.
 */
export async function collectCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let pageNum = 0; pageNum < MAX_CURSOR_PAGES; pageNum++) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    const next = page.nextCursor;
    if (!next) return items;
    if (seen.has(next)) {
      throw new Error("Pagination cursor did not advance");
    }
    seen.add(next);
    cursor = next;
  }

  throw new Error(`Exceeded ${MAX_CURSOR_PAGES} pagination pages`);
}
