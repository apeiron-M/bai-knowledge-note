import { describe, expect, it } from "vitest";
import { badgeSvg, overallStatusOf } from "./health.js";

describe("badgeSvg", () => {
  it("uses a color per status and includes the word", () => {
    expect(badgeSvg("PASS")).toContain("#2ea44f");
    expect(badgeSvg("WARN")).toContain("#d29922");
    expect(badgeSvg("FAIL")).toContain("#cf222e");
    const unknown = badgeSvg("SOMETHING_ELSE");
    expect(unknown).toContain("#8b949e");
    expect(unknown).toContain("UNKNOWN");
  });
});

describe("overallStatusOf", () => {
  it("reads a valid status and refuses anything else", () => {
    expect(overallStatusOf({ global: { overallStatus: "WARN" } })).toBe("WARN");
    expect(overallStatusOf({ global: { overallStatus: "green" } })).toBe(
      "UNKNOWN",
    );
    expect(overallStatusOf(null)).toBe("UNKNOWN");
  });
});