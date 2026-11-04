import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/helpers/create-test-db.js";
import { upsertEmbedding } from "../../../processors/graph-indexer/embedding-store.js";
import type * as DbModule from "./db.js";
import type { GraphSubgraph } from "./db.js";
import { mapSimilarities } from "./search.js";

let harness: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("./db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDb: () => harness.db,
}));
const embedQuery = vi.fn();
vi.mock("./query-embedder.js", () => ({ embedQuery: (...args: unknown[]) => embedQuery(...args) as unknown }));

const unit = (i: number) => Array.from({ length: 4 }, (_, j) => (j === i ? 1 : 0));
const subgraph = {} as GraphSubgraph;

describe("mapSimilarities (Addendum C1)", () => {
  beforeEach(async () => {
    harness = await createTestDb();
    await upsertEmbedding(harness.db, "rd", unit(0), "h-rd");
    await upsertEmbedding(harness.db, "rs", [Math.SQRT1_2, Math.SQRT1_2, 0, 0], "h-rs");
    await upsertEmbedding(harness.db, "other", unit(0), "h-o");
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("scores each map that has a vector by cosine to the query, and leaves out the rest", async () => {
    embedQuery.mockResolvedValue(unit(0));
    const out = await mapSimilarities(subgraph, "d", "reactor", ["rd", "rs", "lead"]);
    expect(out?.get("rd")).toBeCloseTo(1);
    expect(out?.get("rs")).toBeCloseTo(Math.SQRT1_2);
    expect(out?.has("lead")).toBe(false);
    expect(out?.has("other")).toBe(false);
  });

  it("is null when the query cannot be embedded, or no map has a vector: the caller falls back to words", async () => {
    embedQuery.mockResolvedValue(null);
    expect(await mapSimilarities(subgraph, "d", "reactor", ["rd"])).toBeNull();
    embedQuery.mockResolvedValue(unit(0));
    expect(await mapSimilarities(subgraph, "d", "reactor", ["lead"])).toBeNull();
  });
});
