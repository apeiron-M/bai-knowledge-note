import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  EMBEDDER_RETRY_BASE_MS,
  EMBEDDER_RETRY_MAX_MS,
  embedQuery,
  resetQueryEmbedderHealth,
} from "./query-embedder.js";

/**
 * The embedder is imported dynamically, so the mock has to be in place before
 * `embedQuery` reaches its `await import`.
 */
const generateEmbedding = vi.fn();
vi.mock("../../../processors/graph-indexer/embedder.js", () => ({
  generateEmbedding: (t: string) => generateEmbedding(t) as unknown,
}));

beforeEach(() => {
  resetQueryEmbedderHealth();
  generateEmbedding.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("embedQuery", () => {
  it("returns the embedding and does not consult the model twice", async () => {
    generateEmbedding.mockResolvedValue([0.1, 0.2]);
    expect(await embedQuery("q")).toEqual([0.1, 0.2]);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("degrades to null rather than throwing", async () => {
    generateEmbedding.mockRejectedValue(new Error("model files missing"));
    expect(await embedQuery("q")).toBeNull();
  });

  it("skips the model path during the cooldown, then retries after it", async () => {
    let t = 1_000_000;
    const now = () => t;
    generateEmbedding.mockRejectedValue(new Error("boom"));

    expect(await embedQuery("q", now)).toBeNull();
    expect(generateEmbedding).toHaveBeenCalledTimes(1);

    // inside the cooldown: no second timeout is paid
    t += EMBEDDER_RETRY_BASE_MS - 1;
    expect(await embedQuery("q", now)).toBeNull();
    expect(generateEmbedding).toHaveBeenCalledTimes(1);

    // past it: tried again — this is what the permanent latch never did
    t += 2;
    expect(await embedQuery("q", now)).toBeNull();
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it("recovers on its own once the model works again", async () => {
    let t = 0;
    const now = () => t;
    generateEmbedding.mockRejectedValueOnce(new Error("transient"));
    expect(await embedQuery("q", now)).toBeNull();

    generateEmbedding.mockResolvedValue([1, 2, 3]);
    t += EMBEDDER_RETRY_BASE_MS;
    expect(await embedQuery("q", now)).toEqual([1, 2, 3]);
  });

  it("starts the next streak at the shortest cooldown after a recovery", async () => {
    let t = 0;
    const now = () => t;
    // two failures: cooldown has doubled
    generateEmbedding.mockRejectedValue(new Error("x"));
    await embedQuery("q", now);
    t += EMBEDDER_RETRY_BASE_MS;
    await embedQuery("q", now);

    // recover
    generateEmbedding.mockResolvedValue([1]);
    t += EMBEDDER_RETRY_BASE_MS * 2;
    expect(await embedQuery("q", now)).toEqual([1]);

    // fail again — back to the BASE cooldown, not the doubled one
    generateEmbedding.mockRejectedValue(new Error("y"));
    await embedQuery("q", now);
    const calls = generateEmbedding.mock.calls.length;
    t += EMBEDDER_RETRY_BASE_MS + 1;
    await embedQuery("q", now);
    expect(generateEmbedding.mock.calls.length).toBe(calls + 1);
  });

  it("caps the backoff so a permanently missing model still retries", async () => {
    let t = 0;
    const now = () => t;
    generateEmbedding.mockRejectedValue(new Error("gone"));
    // drive the streak well past the cap
    for (let i = 0; i < 12; i++) {
      await embedQuery("q", now);
      t += EMBEDDER_RETRY_MAX_MS;
    }
    const before = generateEmbedding.mock.calls.length;
    t += EMBEDDER_RETRY_MAX_MS + 1;
    await embedQuery("q", now);
    expect(generateEmbedding.mock.calls.length).toBe(before + 1);
  });

  it("logs once per attempt, not once per search", async () => {
    let t = 0;
    const now = () => t;
    generateEmbedding.mockRejectedValue(new Error("boom"));
    await embedQuery("q", now);
    for (let i = 0; i < 20; i++) await embedQuery("q", now); // all inside cooldown
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
