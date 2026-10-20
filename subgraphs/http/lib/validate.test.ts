import { describe, expect, it } from "vitest";
import { rejectUnknownFields, validateEnvelopes } from "./validate.js";

const ok = (over = {}) => ({
  type: "SET_TITLE",
  input: { title: "x" },
  ...over,
});

describe("validateEnvelopes", () => {
  it("accepts actions with no envelope fields — those get stamped", () => {
    expect(validateEnvelopes([ok(), ok()])).toEqual([]);
  });

  it("accepts a valid supplied uuid and timestamp", () => {
    expect(
      validateEnvelopes([
        ok({
          id: "3f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6071",
          timestampUtcMs: "2026-09-14T12:00:00.000Z",
          scope: "global",
        }),
      ]),
    ).toEqual([]);
  });

  it("refuses an id that is not a uuid", () => {
    const f = validateEnvelopes([ok({ id: "abc" })]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ path: "actions[0].id", rule: "INVALID_ACTION_ID" });
  });

  it("refuses a duplicate id in one batch — the case that corrupts sync", () => {
    const id = "3f1a2b4c-5d6e-4f80-9a1b-2c3d4e5f6071";
    const f = validateEnvelopes([ok({ id }), ok({ id })]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      path: "actions[1].id",
      rule: "DUPLICATE_ACTION_ID",
    });
    expect(f[0].message).toContain("actions[0].id");
  });

  it("refuses epoch millis in timestampUtcMs", () => {
    // The reactor rejects this AFTER dispatch with a 422; catch it as a 400.
    const f = validateEnvelopes([ok({ timestampUtcMs: "1789393465164" })]);
    expect(f[0]).toMatchObject({ rule: "INVALID_TIMESTAMP" });
  });

  it("accepts an offset timestamp, refuses a nonsense date", () => {
    expect(validateEnvelopes([ok({ timestampUtcMs: "2026-09-14T12:00:00+02:00" })])).toEqual([]);
    expect(validateEnvelopes([ok({ timestampUtcMs: "2026-13-45T99:99:99Z" })])[0]).toMatchObject({
      rule: "INVALID_TIMESTAMP",
    });
  });

  it("refuses an unknown scope", () => {
    const f = validateEnvelopes([ok({ scope: "globl" })]);
    expect(f[0]).toMatchObject({ path: "actions[0].scope", rule: "INVALID_SCOPE" });
  });

  it("refuses a missing type or a non-object input", () => {
    expect(validateEnvelopes([{ type: "", input: {} }])[0]).toMatchObject({
      rule: "MISSING_ACTION_TYPE",
    });
    expect(
      validateEnvelopes([{ type: "SET_TITLE" } as never])[0],
    ).toMatchObject({ rule: "MISSING_ACTION_INPUT" });
    expect(
      validateEnvelopes([{ type: "SET_TITLE", input: [] } as never])[0],
    ).toMatchObject({ rule: "MISSING_ACTION_INPUT" });
  });

  it("reports every bad action, not just the first", () => {
    const f = validateEnvelopes([ok({ id: "nope" }), ok({ scope: "bad" })]);
    expect(f.map((x) => x.path)).toEqual(["actions[0].id", "actions[1].scope"]);
  });
});

describe("rejectUnknownFields", () => {
  it("passes a body with only known fields", () => {
    expect(() => rejectUnknownFields({ a: 1, b: 2 }, ["a", "b", "c"])).not.toThrow();
  });

  it("names the offending key rather than ignoring it", () => {
    // A misspelt optional field used to be silently dropped, so the request
    // succeeded doing something other than what was asked.
    try {
      rejectUnknownFields({ drive: "d", queu: false }, ["drive", "queue"]);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { status: number; code: string; message: string; details: unknown[] };
      expect(err.status).toBe(400);
      expect(err.code).toBe("UNKNOWN_FIELD");
      expect(err.message).toContain("queu");
      expect(err.message).toContain("Allowed:");
      expect(err.details).toEqual([{ path: "body.queu", rule: "UNKNOWN_FIELD" }]);
    }
  });

  it("lists every unknown key", () => {
    try {
      rejectUnknownFields({ x: 1, y: 2 }, ["a"]);
    } catch (e) {
      expect((e as { message: string }).message).toContain("x, y");
    }
  });
});
