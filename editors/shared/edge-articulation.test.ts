import { describe, it, expect } from "vitest";
import {
  EDGE_CONFIDENCE_LEVELS,
  articulationToMetadata,
  isEdgeConfidence,
} from "./edge-articulation.js";
import { EDGE_CONFIDENCE_LEVELS as PROCESSOR_LEVELS } from "../../processors/graph-indexer/edge-metadata.js";

describe("edge articulation (editor side)", () => {
  it("agrees with the processor on the confidence vocabulary", () => {
    expect([...EDGE_CONFIDENCE_LEVELS]).toEqual([...PROCESSOR_LEVELS]);
    expect(isEdgeConfidence("grounded")).toBe(true);
    expect(isEdgeConfidence("certain")).toBe(false);
  });

  it("builds metadata only from what was actually said", () => {
    expect(articulationToMetadata({ reason: "  because B refines A ", confidence: "established" })).toEqual({
      reason: "because B refines A",
      confidence: "established",
    });
    expect(articulationToMetadata({ reason: "why", confidence: null })).toEqual({ reason: "why" });
    expect(articulationToMetadata({ reason: "   ", confidence: null })).toBeUndefined();
    expect(articulationToMetadata(null)).toBeUndefined();
  });
});
