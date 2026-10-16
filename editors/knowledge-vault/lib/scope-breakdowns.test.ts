/**
 * The work breakdowns around a scope of work: which deliver it, which are
 * left outside any scope, what each has done — and the order a scope is
 * deleted in: its breakdowns deleted or unlinked first, then the scope.
 */
import { describe, expect, it } from "vitest";
import {
  breakdownProgress,
  breakdownRow,
  breakdownsOfScope,
  breakdownsOutsideScopes,
  deleteScopeOfWork,
  recordedWorkLine,
  unlinkBreakdownAction,
  type ScopeDeleteDeps,
} from "./scope-breakdowns.js";

/** Goals as [status, notes] pairs. */
const goals = (...specs: [string, number?][]) =>
  specs.map(([status, notes = 0], i) => ({
    id: `g${i}`,
    description: `Goal ${i}`,
    status,
    notes: Array.from({ length: notes }, (_, k) => ({ id: `n${i}-${k}`, note: "done the thing" })),
  }));
const row = (id: string, name: string, sowRef: string | null, gs = goals()) => breakdownRow(id, name, { goals: gs, sowRef });

describe("a work breakdown's row", () => {
  it("counts its goals — done, in progress, dropped — and its notes", () => {
    expect(row("w", "W", "s", goals(["TODO"], ["COMPLETED", 2], ["IN_PROGRESS", 1], ["IN_REVIEW"], ["BLOCKED"], ["WONT_DO"]))).toEqual({
      id: "w", name: "W", sowRef: "s", goals: 6, done: 1, active: 3, dropped: 1, notes: 3,
    });
  });

  it("reads an unlinked breakdown, and a state with nothing in it", () => {
    expect(breakdownRow("w", "W", { goals: [], sowRef: null }).sowRef).toBeNull();
    expect(breakdownRow("w", "W", { sowRef: "" }).sowRef).toBeNull();
    expect(breakdownRow("w", "W", null)).toEqual({ id: "w", name: "W", sowRef: null, goals: 0, done: 0, active: 0, dropped: 0, notes: 0 });
  });

  it("says its progress in words", () => {
    const plan = row("w", "Knowledge Vault Go-to-Market Plan", "s", goals(["TODO"], ["TODO"], ["TODO"]));
    expect(`${plan.name} — ${breakdownProgress(plan)}`).toBe("Knowledge Vault Go-to-Market Plan — 3 goals, none done");
    expect(breakdownProgress(row("w", "W", null, goals(["COMPLETED"], ["TODO"])))).toBe("2 goals, 1 done");
    expect(breakdownProgress(row("w", "W", null, goals(["COMPLETED"])))).toBe("1 goal, all done");
    expect(breakdownProgress(row("w", "W", null))).toBe("No goals yet");
  });
});

describe("the breakdowns that deliver a scope", () => {
  const a = row("wbs-a", "A", "scope-1");
  const b = row("wbs-b", "B", null);
  const c = row("wbs-c", "C", "scope-2");

  it("takes each project's breakdown, then any that names the scope — once each", () => {
    expect(breakdownsOfScope("scope-1", ["wbs-b", null, "wbs-a", undefined], [a, b, c]).map((x) => x.id)).toEqual(["wbs-b", "wbs-a"]);
    expect(breakdownsOfScope("scope-1", [], [a, b, c]).map((x) => x.id)).toEqual(["wbs-a"]);
  });

  it("leaves out a project's breakdown that is no longer in the vault", () => {
    expect(breakdownsOfScope("scope-1", ["wbs-gone"], [b, c])).toEqual([]);
  });
});

describe("breakdowns outside any scope", () => {
  it("lists those with no scope or a scope not in this vault, by name — not one a scope's project holds", () => {
    const rows = [row("w1", "Zeta", null), row("w2", "Alpha", "scope-deleted"), row("w3", "Kept", "scope-1"), row("w4", "Held", null)];
    expect(breakdownsOutsideScopes(rows, new Set(["scope-1"]), new Set(["w4"])).map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("what deleting breakdowns takes with them", () => {
  it("says nothing when every goal is still to do and none has a note", () => {
    expect(recordedWorkLine([row("w", "A", "s", goals(["TODO"], ["TODO"]))], "them")).toBeNull();
    expect(recordedWorkLine([], "them")).toBeNull();
  });

  it("names goals done and notes", () => {
    const rows = [
      row("w1", "A", "s", goals(["COMPLETED", 4], ["COMPLETED", 5], ["COMPLETED"])),
      row("w2", "B", "s", goals(["COMPLETED"], ["COMPLETED"], ["TODO"])),
    ];
    expect(recordedWorkLine(rows, "them")).toBe("5 goals done and 9 notes would be deleted with them.");
  });

  it("names goals in progress and dropped, for one breakdown", () => {
    const one = row("w", "A", "s", goals(["IN_PROGRESS"], ["BLOCKED"], ["WONT_DO"], ["COMPLETED", 1]));
    expect(recordedWorkLine([one], "it")).toBe("1 goal done, 2 goals in progress, 1 goal dropped and 1 note would be deleted with it.");
  });
});

describe("deleting a scope with its breakdowns", () => {
  const recorder = () => {
    const log: string[] = [];
    const deps: ScopeDeleteDeps = {
      deleteDocument: (id) => {
        log.push(`delete ${id}`);
        return Promise.resolve();
      },
      unlinkBreakdown: (id) => {
        log.push(`unlink ${id}`);
        return Promise.resolve();
      },
      onDeleted: (id) => {
        log.push(`gone ${id}`);
      },
    };
    return { log, deps };
  };

  it("deletes the breakdowns, then the scope, when the box is checked", async () => {
    const { log, deps } = recorder();
    await deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], true, deps);
    expect(log).toEqual(["delete wbs-a", "gone wbs-a", "delete wbs-b", "gone wbs-b", "delete scope-1", "gone scope-1"]);
  });

  it("unlinks each breakdown first, then deletes the scope, when it is not", async () => {
    const { log, deps } = recorder();
    await deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], false, deps);
    expect(log).toEqual(["unlink wbs-a", "unlink wbs-b", "delete scope-1", "gone scope-1"]);
  });

  it("stops at the first failure and keeps the scope", async () => {
    const { log, deps } = recorder();
    const failing: ScopeDeleteDeps = {
      ...deps,
      deleteDocument: (id) => (id === "wbs-b" ? Promise.reject(new Error("refused")) : deps.deleteDocument(id)),
    };
    await expect(deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], true, failing)).rejects.toThrow("refused");
    expect(log).toEqual(["delete wbs-a", "gone wbs-a"]);
  });

  it("unlinks with SET_SOW_PROJECT_REF and both fields null — the model's 'not yet compiled into a scope'", () => {
    expect(unlinkBreakdownAction()).toEqual({ type: "SET_SOW_PROJECT_REF", scope: "global", input: { sowRef: null, sowProjectId: null } });
  });
});
