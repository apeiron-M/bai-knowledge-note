import { describe, expect, it } from "vitest";
import { ABANDONED_AFTER_MS, isAbandoned, planReconcile, type ReconcileTask, type SourceEvidence } from "./reconcile.js";

const task = (extra: Partial<ReconcileTask> = {}): ReconcileTask => ({ id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "create", ...extra });
const note = (id: string, extra: Partial<{ indexed: boolean; linked: boolean; placed: boolean }> = {}) => ({ id, indexed: true, linked: false, placed: false, ...extra });
const source = (extra: Partial<SourceEvidence> = {}): SourceEvidence => ({ id: "s1", title: "Tech investment", status: "EXTRACTED", statsRecorded: true, notes: [], unlisted: [], ...extra });
const plan = (tasks: ReconcileTask[], ...sources: SourceEvidence[]) => planReconcile(tasks, new Map(sources.map((s) => [s.id, s])));

describe("catching the queue up with the vault", () => {
  it("moves an extracted source's task past create, and stops where the notes are not connected yet", () => {
    const out = plan([task()], source({ notes: [note("n1"), note("n2")] }));
    expect(out.tasks).toEqual([
      { taskId: "t1", sourceId: "s1", title: "Tech investment", from: "create", to: "reflect", handoffs: [{ phase: "create", workDone: "Found in the vault: 2 notes extracted from the source.", filesModified: ["n1", "n2"] }] },
    ]);
    expect(out.sources).toEqual([]);
    expect(out.left).toEqual([]);
  });

  it("closes a source that yielded nothing: nothing to connect, place or verify", () => {
    const out = plan([task({ currentPhase: "reflect" })], source({ notes: [] }));
    expect(out.tasks[0]).toMatchObject({ from: "reflect", to: "done" });
    expect(out.tasks[0].handoffs.map((h) => [h.phase, h.workDone])).toEqual([
      ["reflect", "The source yielded no notes, so there was nothing to connect."],
      ["reweave", "The source yielded no notes, so there was nothing to place."],
      ["verify", "The source yielded no notes, so there was nothing to verify."],
    ]);
    expect(plan([task()], source({ notes: [] })).tasks[0].handoffs[0].workDone).toBe("Found in the vault: the extraction ran and found no claims in the source.");
  });

  it("follows the evidence through connected and placed notes, and leaves verify to the Verify step", () => {
    const out = plan([task()], source({ notes: [note("n1", { linked: true, placed: true })] }));
    expect(out.tasks[0]).toMatchObject({ from: "create", to: "verify" });
    expect(out.tasks[0].handoffs.map((h) => h.phase)).toEqual(["create", "reflect", "reweave"]);
    expect(out.tasks[0].handoffs[1].workDone).toBe("Found in the vault: the note carries typed links.");
    expect(out.tasks[0].handoffs[2].workDone).toBe("Found in the vault: the note is a core idea of a MoC.");
    const atVerify = plan([task({ currentPhase: "verify" })], source({ notes: [note("n1", { linked: true, placed: true })] }));
    expect(atVerify.tasks).toEqual([]);
    expect(atVerify.left[0].reason).toBe("the Verify step closes the task once it has checked the note");
    const two = plan([task({ currentPhase: "verify" })], source({ notes: [note("n1"), note("n2")] }));
    expect(two.left[0].reason).toMatch(/checked the notes$/);
  });

  it("moves a task at reflect on to reweave when its notes are linked but not placed", () => {
    const out = plan([task({ currentPhase: "reflect" })], source({ notes: [note("n1", { linked: true }), note("n2", { linked: true })] }));
    expect(out.tasks[0]).toMatchObject({ from: "reflect", to: "reweave" });
    expect(out.tasks[0].handoffs[0].workDone).toBe("Found in the vault: all 2 notes carry typed links.");
    const both = plan([task({ currentPhase: "reweave" })], source({ notes: [note("n1", { placed: true }), note("n2", { placed: true })] }));
    expect(both.tasks[0].handoffs[0].workDone).toBe("Found in the vault: all 2 notes are core ideas of a MoC.");
    const placedOnly = plan([task({ currentPhase: "reweave" })], source({ notes: [note("n1", { placed: false })] }));
    expect(placedOnly.left[0].reason).toBe("1 note not in a MoC yet");
  });

  it("repairs a source whose write was cut off: lists its notes and closes it, without inventing stats", () => {
    const out = plan([task()], source({ status: "EXTRACTING", statsRecorded: false, notes: [note("n1"), note("n2")], unlisted: ["n1", "n2"] }));
    expect(out.sources).toEqual([{ sourceId: "s1", title: "Tech investment", addClaims: ["n1", "n2"], close: true }]);
    expect(out.tasks[0].handoffs[0].workDone).toMatch(/never closed\. The source now lists them and reads EXTRACTED; its extraction stats were lost with the run\.$/);
  });

  it("lists notes an extracted source is missing, once for every task on it", () => {
    const out = plan([task(), task({ id: "t2" })], source({ notes: [note("n1")], unlisted: ["n1"] }));
    expect(out.sources).toEqual([{ sourceId: "s1", title: "Tech investment", addClaims: ["n1"], close: false }]);
    expect(out.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("proves nothing from what it cannot see", () => {
    expect(plan([task()], source({ status: "EXTRACTING", statsRecorded: false })).left[0].reason).toBe("the source has not been extracted yet");
    expect(plan([task()], source({ status: "EXTRACTED", statsRecorded: false })).left[0].reason).toBe("the source has not been extracted yet");
    expect(plan([task()], source({ status: "EXTRACTING", notes: [note("n1")] })).left[0].reason).toMatch(/queued again after an extraction/);
    // a note the index has not caught up with counts as not connected and not placed
    const unseen = plan([task({ currentPhase: "reflect" })], source({ notes: [note("n1", { indexed: false, linked: true, placed: true })] }));
    expect(unseen.tasks).toEqual([]);
    expect(unseen.left[0].reason).toBe("1 note not connected yet");
    const unseenPlace = plan([task({ currentPhase: "reweave" })], source({ notes: [note("n1", { indexed: false, placed: true })] }));
    expect(unseenPlace.left[0].reason).toBe("1 note not in a MoC yet");
  });

  it("leaves held, finished and unreadable tasks alone, and says why", () => {
    const out = plan(
      [
        task({ id: "held", status: "IN_PROGRESS", assignedTo: "0xme" }),
        task({ id: "held2", status: "IN_PROGRESS" }),
        task({ id: "done", status: "DONE" }),
        task({ id: "failed", status: "FAILED" }),
        task({ id: "enrich", taskType: "enrichment" }),
        task({ id: "noref", documentRef: null }),
        task({ id: "gone", documentRef: "s-gone" }),
        task({ id: "odd", currentPhase: "enrich" }),
        task({ id: "none", currentPhase: null }),
      ],
      source(),
    );
    expect(out.tasks).toEqual([]);
    expect(out.left.map((l) => [l.taskId, l.reason])).toEqual([
      ["held", "held by 0xme; whoever holds it reports it"],
      ["held2", "held by someone; whoever holds it reports it"],
      ["noref", "the task names no source"],
      ["gone", "the source is not in this vault"],
      ["odd", "the task is at an unknown phase (enrich)"],
      ["none", "the task is at an unknown phase (none)"],
    ]);
  });

  it("takes over a task whose run is gone: held far longer than any step runs", () => {
    const now = Date.parse("2026-10-08T23:00:00.000Z");
    const held = (updatedAt: string | null, extra: Partial<ReconcileTask> = {}) => task({ status: "IN_PROGRESS", assignedTo: "0xme", updatedAt, ...extra });
    const out = planReconcile([held("2026-10-08T20:00:00.000Z")], new Map([["s1", source({ notes: [note("n1")] })]]), { now });
    expect(out.tasks[0]).toMatchObject({ from: "create", to: "reflect" });
    expect(out.tasks[0].handoffs[0].workDone).toBe("Found in the vault: 1 note extracted from the source. (The task had been held by 0xme since 2026-10-08T20:00:00.000Z; that run is gone.)");
    const stuck = planReconcile([held("2026-10-08T20:00:00.000Z")], new Map([["s1", source({ status: "EXTRACTING", statsRecorded: false })]]), { now });
    expect(stuck.left[0].reason).toBe("held by 0xme since 2026-10-08T20:00:00.000Z, and the source has not been extracted yet");
    // recently held, undated, or no clock given: still its holder's
    expect(planReconcile([held("2026-10-08T22:30:00.000Z")], new Map([["s1", source({ notes: [note("n1")] })]]), { now }).left[0].reason).toMatch(/^held by 0xme;/);
    expect(planReconcile([held(null)], new Map([["s1", source({ notes: [note("n1")] })]]), { now }).left[0].reason).toMatch(/^held by 0xme;/);
    expect(planReconcile([held("2026-10-08T20:00:00.000Z")], new Map([["s1", source({ notes: [note("n1")] })]])).left[0].reason).toMatch(/^held by 0xme;/);
    expect(isAbandoned(held(null, { createdAt: "2026-10-08T20:00:00.000Z" }), now)).toBe(true);
    expect(isAbandoned(task({ updatedAt: "2026-10-08T20:00:00.000Z" }), now)).toBe(false);
    expect(isAbandoned(held("2026-10-08T22:00:00.000Z"), now, ABANDONED_AFTER_MS / 4)).toBe(true);
    const unprovable = planReconcile([held("2026-10-08T20:00:00.000Z", { currentPhase: "verify" })], new Map([["s1", source({ notes: [note("n1")] })]]), { now });
    expect(unprovable.left[0].reason).toMatch(/^held by 0xme since .*, and the Verify step closes the task/);
  });
});
