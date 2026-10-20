/**
 * Exhaustive relationship reads.
 *
 * `IReactorClient.getOutgoingRelationships` caps at 100 targets and
 * offers no way past it: the client calls `documentIndexer.getOutgoing`
 * with `paging: void 0` (which defaults to a limit of 100) and discards
 * the `next`/`nextCursor` that call returns. Reindex deletes a
 * document's edges before writing back what it read, so a truncated read
 * is a truncated write — a MoC with 430 core ideas was reduced to 100.
 */
import { describe, expect, it, vi } from "vitest";

import {
  collectRelationshipIds,
  RELATIONSHIP_PAGE_LIMIT,
  type FetchRelationshipPage,
  type RelationshipPage,
} from "../../subgraphs/knowledge-graph/helpers/relationship-paging.js";

const ids = (n: number, prefix = "doc") =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** Serves `all` through the cursor contract, `size` rows at a time. */
function cursorPaged(all: string[], size = RELATIONSHIP_PAGE_LIMIT) {
  const fetch: FetchRelationshipPage = (paging) => {
    const start = paging?.cursor ? parseInt(paging.cursor, 10) : 0;
    const slice = all.slice(start, start + size);
    return Promise.resolve({
      results: slice.map((id) => ({ header: { id } })),
      nextCursor: start + size < all.length ? String(start + size) : undefined,
    });
  };
  return fetch;
}

/** Serves `all` through the `next()` contract instead of cursors. */
function nextPaged(all: string[], size = RELATIONSHIP_PAGE_LIMIT) {
  const build = (offset: number): RelationshipPage => {
    const slice = all.slice(offset, offset + size);
    return {
      results: slice.map((id) => ({ header: { id } })),
      next:
        offset + size < all.length
          ? () => Promise.resolve(build(offset + size))
          : undefined,
    };
  };
  return () => Promise.resolve(build(0));
}

/** The real reactor: one capped page, no cursor, no next. */
function cappedOnce(all: string[]) {
  return () =>
    Promise.resolve({
      results: all
        .slice(0, RELATIONSHIP_PAGE_LIMIT)
        .map((id) => ({ header: { id } })),
    });
}

describe("collectRelationshipIds", () => {
  it("returns a short set in one read", async () => {
    const r = await collectRelationshipIds(cursorPaged(ids(7)));
    expect(r.ids).toEqual(ids(7));
    expect(r).toMatchObject({ pages: 1, saturated: false, truncated: false });
  });

  it("follows nextCursor past the page cap", async () => {
    const r = await collectRelationshipIds(cursorPaged(ids(430)));
    expect(r.ids).toHaveLength(430);
    expect(r.ids).toEqual(ids(430));
    expect(r).toMatchObject({ pages: 5, saturated: false, truncated: false });
  });

  it("follows next() when the layer offers that instead of a cursor", async () => {
    // The indexer populates next(); findByIds populates nextCursor.
    const r = await collectRelationshipIds(nextPaged(ids(250)));
    expect(r.ids).toHaveLength(250);
    expect(r.saturated).toBe(false);
  });

  it("flags saturation when the reactor caps and offers no way onward", async () => {
    // This is the live failure: 430 core ideas, 100 returned, no cursor,
    // no next, no error. Detecting it is what triggers the reverse read.
    const r = await collectRelationshipIds(cappedOnce(ids(430)));
    expect(r.ids).toHaveLength(RELATIONSHIP_PAGE_LIMIT);
    expect(r.saturated).toBe(true);
    expect(r.truncated).toBe(false);
  });

  it("does not flag saturation for a set just under the cap", async () => {
    const r = await collectRelationshipIds(cappedOnce(ids(99)));
    expect(r.saturated).toBe(false);
  });

  it("de-duplicates rows repeated across a page boundary", async () => {
    // Postgres rejects ON CONFLICT DO UPDATE whose VALUES repeat a key,
    // failing the entire insert batch rather than one row.
    let call = 0;
    const fetch: FetchRelationshipPage = () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? {
              results: [{ header: { id: "a" } }, { header: { id: "b" } }],
              nextCursor: "2",
            }
          : { results: [{ header: { id: "b" } }, { header: { id: "c" } }] },
      );
    };
    const r = await collectRelationshipIds(fetch);
    expect(r.ids).toEqual(["a", "b", "c"]);
  });

  it("accepts a bare id when a row carries no header", async () => {
    const r = await collectRelationshipIds(() =>
      Promise.resolve({ results: [{ id: "bare" }, { header: { id: "wrapped" } }] }),
    );
    expect(r.ids).toEqual(["bare", "wrapped"]);
  });

  it("skips rows with no identifier", async () => {
    const r = await collectRelationshipIds(() =>
      Promise.resolve({ results: [{}, { header: {} }, { header: { id: "kept" } }] }),
    );
    expect(r.ids).toEqual(["kept"]);
  });

  it("treats no relationships as empty rather than an error", async () => {
    const r = await collectRelationshipIds(() => Promise.resolve({ results: [] }));
    expect(r).toEqual({ ids: [], saturated: false, truncated: false, pages: 0 });
  });

  it("tolerates the API returning nothing at all", async () => {
    const r = await collectRelationshipIds(() => Promise.resolve(undefined));
    expect(r.ids).toEqual([]);
  });

  it("stops when a cursor stops advancing instead of looping on the same rows", async () => {
    // The reactor's GraphQL layer ignores offset and re-serves page one.
    const fetch = vi.fn(() =>
      Promise.resolve({
        results: [{ header: { id: "same" } }],
        nextCursor: "1",
      }),
    );
    const r = await collectRelationshipIds(fetch);
    expect(r.ids).toEqual(["same"]);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("reports truncation rather than hanging on an endless page stream", async () => {
    let n = 0;
    const fetch: FetchRelationshipPage = () =>
      Promise.resolve({
        results: [{ header: { id: `u-${n++}` } }],
        nextCursor: String(n),
      });
    const r = await collectRelationshipIds(fetch, { maxPages: 5 });
    expect(r.truncated).toBe(true);
    expect(r.pages).toBe(5);
  });

  it("honours a caller-supplied page size when re-fetching by cursor", async () => {
    const seen: Array<number | undefined> = [];
    const fetch: FetchRelationshipPage = (paging) => {
      seen.push(paging?.limit);
      const start = paging?.cursor ? parseInt(paging.cursor, 10) : 0;
      const slice = ids(25).slice(start, start + 10);
      return Promise.resolve({
        results: slice.map((id) => ({ header: { id } })),
        nextCursor: start + 10 < 25 ? String(start + 10) : undefined,
      });
    };
    const r = await collectRelationshipIds(fetch, { pageLimit: 10 });
    expect(r.ids).toHaveLength(25);
    expect(seen.slice(1)).toEqual([10, 10]);
  });
});
