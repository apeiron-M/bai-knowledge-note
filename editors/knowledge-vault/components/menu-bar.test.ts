import { describe, expect, it } from "vitest";
import { COMPACT_BELOW_PX, compactTabs } from "./menu-bar.js";

describe("compactTabs", () => {
  it("shows icons only below the threshold, labels from it up; an unmeasured bar keeps the labels", () => {
    expect(COMPACT_BELOW_PX).toBe(760);
    expect(compactTabs(759)).toBe(true);
    expect(compactTabs(760)).toBe(false);
    expect(compactTabs(0)).toBe(false);
  });
});
