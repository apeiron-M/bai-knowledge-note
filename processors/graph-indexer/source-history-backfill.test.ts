import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/create-test-db.js";
import {
  backfillSourceHistory,
  reactorSourceOpReader,
  type SourceOpReader,
} from "./source-history-backfill.js";
import { operationRowOf } from "./operation-row.js";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const LOG: Record<string, { index: number; type: string; input: unknown; timestampUtcMs: string }[]> = {
  s1: [
    { index: 0, type: "INGEST_SOURCE", input: { title: "Guide", content: "a", method: "sha256:1 git:v6.2.2-dev.74" }, timestampUtcMs: "2026-08-01T00:00:00.000Z" },
    { index: 1, type: "SET_SOURCE_STATUS", input: { status: "EXTRACTED" }, timestampUtcMs: "2026-08-01T00:01:00.000Z" },
    { index: 2, type: "ATTACH_ORIGINAL_FILE", input: {}, timestampUtcMs: "2026-08-01T00:02:00.000Z" },
    { index: 3, type: "INGEST_SOURCE", input: { title: "Guide", content: "b", method: "sha256:2 git:v6.2.3-dev.91+e0f277d" }, timestampUtcMs: "2026-11-03T19:00:00.000Z" },
  ],
  s2: [{ index: 0, type: "INGEST_SOURCE", input: { title: "Other", content: "x" }, timestampUtcMs: "2026-09-01T00:00:00.000Z" }],
};

const reader: SourceOpReader = {
  async *operations(documentId) {
    for (const op of LOG[documentId] ?? []) yield op;
  },
};

describe("backfillSourceHistory", () => {
  let harness: TestDb;
  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("inserts one row per recorded source operation, shaped like the live indexer's", async () => {
    const result = await backfillSourceHistory(reader, harness.db, ["s1", "s2"]);
    expect(result).toEqual({ sources: 2, documents: 0, inserted: 4, skipped: 0, errors: [] });

    const rows = await harness.db.selectFrom("graph_operations").selectAll().orderBy("id").execute();
    expect(rows.map((r) => r.id)).toEqual(["s1-0", "s1-1", "s1-3", "s2-0"]);
    const op = LOG.s1[3];
    expect(rows[2]).toEqual(
      operationRowOf({ documentId: "s1", documentType: "bai/source", index: op.index, type: op.type, input: op.input, timestampUtcMs: op.timestampUtcMs }),
    );
    expect(rows[2].summary).toContain("v6.2.3-dev.91+e0f277d");
  });

  it("is idempotent: a second run inserts nothing", async () => {
    await backfillSourceHistory(reader, harness.db, ["s1", "s2"]);
    const again = await backfillSourceHistory(reader, harness.db, ["s1", "s2"]);
    expect(again).toEqual({ sources: 2, documents: 0, inserted: 0, skipped: 4, errors: [] });
    expect(await harness.db.selectFrom("graph_operations").select("id").execute()).toHaveLength(4);
  });

  it("writes a long log in chunks of rows", async () => {
    const long: SourceOpReader = {
      async *operations() {
        for (let i = 0; i < 5100; i++) yield { index: i, type: "SET_SOURCE_STATUS", input: { status: "X" }, timestampUtcMs: "2026-08-01T00:00:00.000Z" };
      },
    };
    const result = await backfillSourceHistory(long, harness.db, ["big"]);
    expect(result.inserted).toBe(5100);
  });

  it("isolates a source whose log cannot be read", async () => {
    const broken: SourceOpReader = {
      async *operations(documentId) {
        if (documentId === "bad") throw new Error("gone");
        yield* reader.operations(documentId);
      },
    };
    const result = await backfillSourceHistory(broken, harness.db, ["bad", "s2"]);
    expect(result.inserted).toBe(1);
    expect(result.errors).toEqual(["bad: gone"]);
  });
});

describe("reactorSourceOpReader", () => {
  it("pages the global operation log of a document, asking for the given actions only", async () => {
    const calls: unknown[][] = [];
    const client = {
      getOperations: async (...args: unknown[]) => {
        calls.push(args);
        const paging = args[3] as { cursor: string };
        if (paging.cursor === "")
          return { results: [{ index: 0, timestampUtcMs: "t0", action: { type: "INGEST_SOURCE", input: { title: "a" }, context: { signer: { user: { address: "0xa" } } } } }], nextCursor: "c1" };
        return { results: [{ index: 1, timestampUtcMs: "t1", action: { type: "SET_SOURCE_STATUS", input: { status: "X" } } }] };
      },
    };
    const out = [];
    for await (const op of reactorSourceOpReader(client).operations("s1", ["INGEST_SOURCE", "SET_SOURCE_STATUS"])) out.push(op);
    expect(out).toEqual([
      { index: 0, type: "INGEST_SOURCE", input: { title: "a" }, timestampUtcMs: "t0", signer: { user: { address: "0xa" } } },
      { index: 1, type: "SET_SOURCE_STATUS", input: { status: "X" }, timestampUtcMs: "t1", signer: undefined },
    ]);
    expect(calls[0][0]).toBe("s1");
    expect(calls[0][1]).toEqual({ branch: "main", scopes: ["global"] });
    expect((calls[0][2] as { actionTypes: string[] }).actionTypes).toContain("INGEST_SOURCE");
    expect(calls[1][3]).toEqual({ cursor: "c1", limit: 200 });
  });

  it("asks for every action when none are given", async () => {
    const calls: unknown[][] = [];
    const client = {
      getOperations: async (...args: unknown[]) => {
        calls.push(args);
        return { results: [] };
      },
    };
    for await (const op of reactorSourceOpReader(client).operations("n1")) void op;
    expect(calls[0][2]).toBeUndefined();
  });
});
