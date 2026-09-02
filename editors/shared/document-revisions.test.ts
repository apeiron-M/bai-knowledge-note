import { describe, expect, it, vi } from "vitest";
import {
  effectiveOperations,
  fetchDocumentOperations,
  humanizeOperationType,
  lastSignature,
  replayDocumentOperations,
  str,
  type DocumentOperation,
} from "./document-revisions.js";

const T = "2026-09-02T10:00:00.000Z";

function op(index: number): DocumentOperation {
  return {
    index,
    skip: 0,
    timestampUtcMs: T,
    hash: `h${index}`,
    error: null,
    action: {
      id: `a${index}`,
      type: "SET_TITLE",
      scope: "global",
      timestampUtcMs: T,
      input: { title: `t${index}` },
      context: null,
    },
  };
}

/** A fetch that serves `pages` of operations, recording the cursors asked for. */
function pagedFetch(pages: DocumentOperation[][], cursors: (string | null)[]) {
  let call = 0;
  return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    // `body` is typed as a union of stream-ish things; only the string case
    // is reachable here, and stringifying the others would silently yield
    // "[object Object]".
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as { variables?: { cursor: string | null } };
    cursors.push(body.variables?.cursor ?? null);
    const items = pages[call] ?? [];
    const hasNextPage = call < pages.length - 1;
    call++;
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            document: {
              document: {
                operations: {
                  items,
                  hasNextPage,
                  cursor: hasNextPage ? `c${call}` : null,
                },
              },
            },
          },
        }),
    } as unknown as Response);
  });
}

describe("fetchDocumentOperations", () => {
  it("follows the cursor past the 200-per-page limit", async () => {
    // A document with hundreds of operations arrives in several pages;
    // nothing may be dropped and the order must survive the concatenation.
    const pages = [
      Array.from({ length: 200 }, (_, i) => op(i)),
      Array.from({ length: 200 }, (_, i) => op(200 + i)),
      Array.from({ length: 47 }, (_, i) => op(400 + i)),
    ];
    const cursors: (string | null)[] = [];
    const ops = await fetchDocumentOperations(
      "/graphql",
      "doc-1",
      pagedFetch(pages, cursors),
    );
    expect(ops).toHaveLength(447);
    expect(ops.map((o) => o.index)).toEqual(
      Array.from({ length: 447 }, (_, i) => i),
    );
    // First request unpaged, then each server cursor echoed back in turn.
    expect(cursors).toEqual([null, "c1", "c2"]);
  });

  it("stops at the page bound when a server never says it is done", async () => {
    const runaway = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              document: {
                document: {
                  operations: {
                    items: [op(0)],
                    hasNextPage: true,
                    cursor: "always-more",
                  },
                },
              },
            },
          }),
      } as unknown as Response),
    );
    const ops = await fetchDocumentOperations("/graphql", "doc-1", runaway, 5);
    expect(runaway).toHaveBeenCalledTimes(5);
    expect(ops).toHaveLength(5);
  });

  it("reports transport and GraphQL failures", async () => {
    const http500 = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as unknown as Response),
    );
    await expect(
      fetchDocumentOperations("/graphql", "doc-1", http500),
    ).rejects.toThrow("HTTP 500");

    const graphqlError = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ errors: [{ message: "no such document" }] }),
      } as unknown as Response),
    );
    await expect(
      fetchDocumentOperations("/graphql", "doc-1", graphqlError),
    ).rejects.toThrow("no such document");
  });

  it("returns nothing for a document the reactor does not hold", async () => {
    const empty = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { document: null } }),
      } as unknown as Response),
    );
    await expect(
      fetchDocumentOperations("/graphql", "doc-1", empty),
    ).resolves.toEqual([]);
  });
});

describe("replayDocumentOperations", () => {
  type Doc = { state: { n: number }; operations: { global: { error?: string }[] } };
  const model = {
    createDocument: (): Doc => ({ state: { n: 0 }, operations: { global: [] } }),
    reducer: (doc: Doc): Doc => ({
      state: { n: doc.state.n + 1 },
      operations: { global: [...doc.operations.global, {}] },
    }),
  };

  it("applies only operations up to the requested index", () => {
    const ops = [op(0), op(1), op(2), op(3)];
    expect(replayDocumentOperations(ops, 1, model).document.state.n).toBe(2);
    expect(replayDocumentOperations(ops, 3, model).document.state.n).toBe(4);
  });

  it("survives a reducer that throws", () => {
    const boom = {
      createDocument: model.createDocument,
      reducer: (): Doc => {
        throw new Error("reducer exploded");
      },
    };
    const r = replayDocumentOperations([op(0)], 0, boom);
    expect(r.failures).toEqual([
      { index: 0, type: "SET_TITLE", reason: "reducer exploded" },
    ]);
  });
});

describe("helpers", () => {
  it("clips long strings and ignores non-strings", () => {
    expect(str("short")).toBe("short");
    expect(str("x".repeat(70))).toBe(`${"x".repeat(60)}…`);
    expect(str(42)).toBe("");
    expect(str(undefined)).toBe("");
  });

  it("humanizes an unknown operation type", () => {
    expect(humanizeOperationType("SET_SOME_FIELD")).toBe("Set some field");
  });

  it("takes the last signature, or null when unsigned", () => {
    const o = op(0);
    expect(lastSignature(o)).toBeNull();
    o.action.context = {
      signer: { user: null, app: null, signatures: ["first", "second"] },
    };
    expect(lastSignature(o)).toBe("second");
  });

  it("orders operations regardless of arrival order", () => {
    expect(effectiveOperations([op(2), op(0), op(1)]).map((o) => o.index)).toEqual([
      0, 1, 2,
    ]);
  });
});
