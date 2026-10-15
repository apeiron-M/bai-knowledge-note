import { describe, expect, it } from "vitest";
import { writeErrorText } from "./use-doc-write.js";

describe("writeErrorText", () => {
  it("says what each model refusal means to the reader", () => {
    expect(writeErrorText([new Error("Tension is not open")])).toMatch(/already closed/);
    expect(writeErrorText([new Error("Only a PENDING observation can be promoted (status is ARCHIVED)")])).toMatch(/already moved on/);
    expect(writeErrorText([new Error("Only a PROMOTED observation can be implemented (status is PENDING)")])).toMatch(/Only a promoted observation/);
    expect(writeErrorText([new Error("Observation is already archived")])).toMatch(/already archived/);
  });
  it("says a missing write grant plainly", () => {
    expect(writeErrorText([new Error('Forbidden: insufficient permissions to execute operation "RESOLVE_TENSION"')])).toMatch(/permission/);
  });
  it("turns a raw network failure into a sentence", () => {
    expect(writeErrorText([new TypeError("Failed to fetch")]).length).toBeGreaterThan(20);
  });
  it("still says something when the failure has no words", () => {
    expect(writeErrorText([])).toBe("The vault did not accept this change.");
  });
});
