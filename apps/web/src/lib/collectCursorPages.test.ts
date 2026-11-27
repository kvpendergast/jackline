import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CursorPage } from "@jackline/shared";
import {
  collectCursorPages,
  MAX_CURSOR_PAGES,
} from "./collectCursorPages";

describe("collectCursorPages", () => {
  it("returns a single page when nextCursor is null", async () => {
    const items = await collectCursorPages(async (cursor) => {
      assert.equal(cursor, undefined);
      return { items: [1, 2, 3], nextCursor: null };
    });
    assert.deepEqual(items, [1, 2, 3]);
  });

  it("follows nextCursor across pages and returns more than 100 items", async () => {
    const first: CursorPage<number> = {
      items: Array.from({ length: 100 }, (_, i) => i + 1),
      nextCursor: "page-2",
    };
    const second: CursorPage<number> = {
      items: Array.from({ length: 25 }, (_, i) => i + 101),
      nextCursor: null,
    };
    const cursors: Array<string | undefined> = [];

    const items = await collectCursorPages(async (cursor) => {
      cursors.push(cursor);
      if (cursor === undefined) return first;
      if (cursor === "page-2") return second;
      throw new Error(`unexpected cursor ${cursor}`);
    });

    assert.deepEqual(cursors, [undefined, "page-2"]);
    assert.equal(items.length, 125);
    assert.equal(items[0], 1);
    assert.equal(items[99], 100);
    assert.equal(items[100], 101);
    assert.equal(items[124], 125);
  });

  it("throws if a cursor is repeated", async () => {
    await assert.rejects(
      () =>
        collectCursorPages(async () => ({
          items: [1],
          nextCursor: "same",
        })),
      /did not advance/,
    );
  });

  it("throws if the page cap is exceeded", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        collectCursorPages(async () => ({
          items: [n++],
          nextCursor: `c-${n}`,
        })),
      new RegExp(`Exceeded ${MAX_CURSOR_PAGES} pagination pages`),
    );
  });
});
