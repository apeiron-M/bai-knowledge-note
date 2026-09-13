import { describe, expect, it } from "vitest";
import { lintActions } from "./index.js";

const state = { global: {} };

describe("lintActions — generic rules", () => {
  it("rejects an action type the model does not define", () => {
    const findings = lintActions("bai/source", state, [
      { type: "NOT_A_REAL_ACTION", input: {} },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        path: "actions[0].type",
        rule: "UNKNOWN_ACTION",
        class: "REACTOR_REJECTS",
      }),
    ]);
  });

  it("rejects an input the model's zod schema refuses", () => {
    const findings = lintActions("bai/source", state, [
      { type: "INGEST_SOURCE", input: { title: "x", sourceType: "MANUAL_ENTRY" } },
    ]);
    expect(
      findings.some(
        (f) => f.rule === "INVALID_INPUT" && f.path.startsWith("actions[0].input"),
      ),
    ).toBe(true);
  });

  it("accepts a valid action", () => {
    const findings = lintActions("bai/source", state, [
      {
        type: "INGEST_SOURCE",
        input: {
          title: "x",
          content: "body",
          sourceType: "MANUAL_ENTRY",
          createdAt: "2026-09-13T12:00:00.000Z",
        },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("rejects literal \\n escapes and honours allowLiteralEscapes", () => {
    const action = {
      type: "INGEST_SOURCE",
      input: {
        title: "x",
        content: "line\\nline",
        sourceType: "MANUAL_ENTRY",
        createdAt: "2026-09-13T12:00:00.000Z",
      },
    };
    expect(
      lintActions("bai/source", state, [action]).some(
        (f) => f.rule === "LITERAL_ESCAPE",
      ),
    ).toBe(true);
    expect(
      lintActions("bai/source", state, [action], {
        allowLiteralEscapes: true,
      }),
    ).toEqual([]);
  });

  it("rejects an unknown document type", () => {
    const findings = lintActions("bai/nope", state, [
      { type: "SET_TITLE", input: {} },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: "UNKNOWN_DOCUMENT_TYPE",
        class: "REACTOR_REJECTS",
      }),
    ]);
  });
});
