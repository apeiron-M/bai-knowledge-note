import { describe, expect, it } from "vitest";
import { lintActions } from "./index.js";

const note = (
  input: Record<string, unknown>,
  type: string,
  state: Record<string, unknown> = { status: "DRAFT" },
) => lintActions("bai/knowledge-note", { global: state }, [{ type, input }]);

describe("knowledge-note rules", () => {
  it("rejects a description longer than 200 UTF-16 units", () => {
    expect(
      note(
        { description: "x".repeat(201), updatedAt: "2026-01-01T00:00:00.000Z" },
        "SET_DESCRIPTION",
      ).map((f) => f.rule),
    ).toContain("DESCRIPTION_TOO_LONG");
  });

  it("accepts exactly 200 units", () => {
    expect(
      note({ description: "x".repeat(200), updatedAt: "2026-01-01T00:00:00.000Z" }, "SET_DESCRIPTION"),
    ).toEqual([]);
  });

  it("rejects a metadata field outside the whitelist", () => {
    expect(
      note(
        { field: "nope", value: "v", updatedAt: "2026-01-01T00:00:00.000Z" },
        "SET_METADATA_FIELD",
      ).map((f) => f.rule),
    ).toContain("INVALID_METADATA_FIELD");
  });

  it("rejects a list field outside the whitelist", () => {
    expect(
      note(
        { field: "nope", values: [], updatedAt: "2026-01-01T00:00:00.000Z" },
        "SET_METADATA_LIST_FIELD",
      ).map((f) => f.rule),
    ).toContain("INVALID_METADATA_LIST_FIELD");
  });

  it("flags a noteType outside the enum as a reactor rejection", () => {
    // `concept` was the accepted spelling while noteType was a free String;
    // as a NoteType enum it fails the generated input schema, which is the
    // same check the reducer applies.
    const found = note(
      { noteType: "concept", updatedAt: "2026-01-01T00:00:00.000Z" },
      "SET_NOTE_TYPE",
    );
    expect(found).toEqual([
      expect.objectContaining({
        path: "actions[0].input.noteType",
        rule: "INVALID_INPUT",
        class: "REACTOR_REJECTS",
      }),
    ]);
  });

  it("treats a state without a status as DRAFT for lifecycle checks", () => {
    expect(
      note(
        { id: "e1", actor: "a", timestamp: "2026-01-01T00:00:00.000Z" },
        "SUBMIT_FOR_REVIEW",
        {},
      ),
    ).toEqual([]);
  });

  it("accepts every NoteType enum value", () => {
    for (const noteType of ["CONCEPT", "BUG_PATTERN", "REFERENCE"]) {
      expect(
        note({ noteType, updatedAt: "2026-01-01T00:00:00.000Z" }, "SET_NOTE_TYPE"),
      ).toEqual([]);
    }
  });

  it("rejects a negative PATCH_CONTENT offset", () => {
    expect(
      note(
        { offset: -1, removeCount: 0, insert: "", updatedAt: "2026-01-01T00:00:00.000Z" },
        "PATCH_CONTENT",
      ).map((f) => f.rule),
    ).toContain("PATCH_OFFSET");
  });

  it("rejects a lifecycle step from the wrong status", () => {
    expect(
      note(
        { id: "x", actor: "0x1", timestamp: "2026-01-01T00:00:00.000Z" },
        "APPROVE_NOTE",
        { status: "DRAFT" },
      ).map((f) => f.rule),
    ).toContain("INVALID_STATUS_TRANSITION");
  });

  it("rejects self-approval", () => {
    const found = note({ id: "x", actor: "0x1", timestamp: "2026-01-01T00:00:00.000Z" }, "APPROVE_NOTE", {
      status: "IN_REVIEW",
      provenance: { author: "0x1" },
    });
    expect(found.map((f) => f.rule)).toContain("SELF_APPROVAL");
  });
});

describe("moc rules", () => {
  it("allows only version on SET_METADATA_FIELD", () => {
    const bad = lintActions("bai/moc", { global: {} }, [
      {
        type: "SET_METADATA_FIELD",
        input: { field: "owner", value: "v", updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    ]);
    expect(bad.map((f) => f.rule)).toEqual(["INVALID_METADATA_FIELD"]);
    const good = lintActions("bai/moc", { global: {} }, [
      {
        type: "SET_METADATA_FIELD",
        input: { field: "version", value: "v", updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    ]);
    expect(good).toEqual([]);
  });
});

describe("pipeline-queue rules", () => {
  it("accepts claim and enrichment, rejects anything else", () => {
    const base = { id: "t1", target: "doc", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(
      lintActions("bai/pipeline-queue", { global: {} }, [
        { type: "ADD_TASK", input: { ...base, taskType: "claim" } },
      ]),
    ).toEqual([]);
    expect(
      lintActions("bai/pipeline-queue", { global: {} }, [
        { type: "ADD_TASK", input: { ...base, taskType: "other" } },
      ]).map((f) => f.rule),
    ).toContain("TASK_TYPE_CONVENTION");
  });
});

describe("wbs rules", () => {
  it("requires a blockReason when BLOCKED", () => {
    const blocked = lintActions("bai/wbs", { global: {} }, [
      { type: "SET_GOAL_STATUS", input: { id: "g", status: "BLOCKED" } },
    ]);
    expect(blocked.map((f) => f.rule)).toContain("MISSING_BLOCK_REASON");
  });
});

describe("scope-of-work rules", () => {
  it("bounds progress percentage and story points", () => {
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        {
          type: "SET_DELIVERABLE_PROGRESS",
          input: { id: "d", workProgress: { percentage: 120 } },
        },
      ]).map((f) => f.rule),
    ).toContain("PROGRESS_OUT_OF_RANGE");
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        {
          type: "SET_DELIVERABLE_PROGRESS",
          input: { id: "d", workProgress: { storyPoints: { total: 3, completed: 5 } } },
        },
      ]).map((f) => f.rule),
    ).toContain("STORY_POINTS_INVALID");
  });

  it("rejects negative money", () => {
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        {
          type: "SET_PROJECT_TOTAL_BUDGET",
          input: { projectId: "p", totalBudget: -1 },
        },
      ]).map((f) => f.rule),
    ).toContain("NEGATIVE_AMOUNT");
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        { type: "SET_PROJECT_EXPENDITURE", input: { projectId: "p", actuals: -1 } },
      ]).map((f) => f.rule),
    ).toContain("NEGATIVE_AMOUNT");
  });

  it("requires exactly one of milestoneId or projectId on ADD_DELIVERABLE_IN_SET", () => {
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        { type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId: "d" } },
      ]).map((f) => f.rule),
    ).toContain("DELIVERABLE_SET_AMBIGUOUS");
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        {
          type: "ADD_DELIVERABLE_IN_SET",
          input: { deliverableId: "d", milestoneId: "m", projectId: "p" },
        },
      ]).map((f) => f.rule),
    ).toContain("DELIVERABLE_SET_AMBIGUOUS");
    expect(
      lintActions("powerhouse/scopeofwork", { global: {} }, [
        {
          type: "ADD_DELIVERABLE_IN_SET",
          input: { deliverableId: "d", projectId: "p" },
        },
      ]),
    ).toEqual([]);
  });
});