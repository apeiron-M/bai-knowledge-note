import { describe, expect, it } from "vitest";
import { documentIndexerOf } from "./edge-metadata-reader.js";

const indexer = {
  getOutgoing: () => Promise.resolve({ results: [] }),
  getIncoming: () => Promise.resolve({ results: [] }),
};

describe("documentIndexerOf", () => {
  it("finds the indexer on a read half", () => {
    expect(documentIndexerOf({ documentIndexer: indexer })).toBe(indexer);
  });

  // The facade over the read and write halves keeps no indexer of its own:
  // reading only its own field made every reindex lose edge reasons.
  it("finds the indexer behind a facade, on its read half", () => {
    expect(documentIndexerOf({ read: { documentIndexer: indexer } })).toBe(indexer);
  });

  it("is null for a client without an in-process indexer", () => {
    expect(documentIndexerOf({ get: () => Promise.resolve({}) })).toBeNull();
    expect(documentIndexerOf({ read: {} })).toBeNull();
    expect(documentIndexerOf({ documentIndexer: { getOutgoing: () => null } })).toBeNull();
    expect(documentIndexerOf(undefined)).toBeNull();
  });
});
