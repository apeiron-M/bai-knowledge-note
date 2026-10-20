import { describe, expect, it } from "vitest";
import { checkArticulation } from "./articulation.js";

const reason =
  "The note extends the target's claim about operation storage to the write cache.";

describe("checkArticulation", () => {
  it("accepts a long, specific reason on a knowledge edge", () => {
    expect(
      checkArticulation({
        type: "BUILDS_ON",
        reason,
        confidence: "established",
      }),
    ).toBeNull();
  });

  it("rejects a knowledge edge without a reason", () => {
    expect(checkArticulation({ type: "RELATES_TO" })).toMatch(/reason/);
  });

  it("rejects a reason shorter than 20 characters", () => {
    expect(
      checkArticulation({ type: "RELATES_TO", reason: "relates to it" }),
    ).toMatch(/20/);
  });

  it("rejects placeholder reasons", () => {
    for (const r of [
      "because",
      "TODO",
      "tbd",
      "related",
      "RELATES_TO is why this exists here",
    ]) {
      expect(checkArticulation({ type: "RELATES_TO", reason: r })).not.toBeNull();
    }
  });

  it("allows bare CORE_IDEA and CHILD_MOC", () => {
    expect(checkArticulation({ type: "CORE_IDEA" })).toBeNull();
    expect(checkArticulation({ type: "CHILD_MOC" })).toBeNull();
  });

  it("rejects an unknown confidence", () => {
    expect(
      checkArticulation({ type: "RELATES_TO", reason, confidence: "certain" }),
    ).toMatch(/confidence/);
  });

  it("accepts each of the three confidence levels and no confidence", () => {
    for (const c of ["grounded", "established", "speculative", undefined]) {
      expect(
        checkArticulation({ type: "RELATES_TO", reason, confidence: c }),
      ).toBeNull();
    }
  });
});
