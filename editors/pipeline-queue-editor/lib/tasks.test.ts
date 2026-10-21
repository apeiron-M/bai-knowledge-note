import { describe, expect, it } from "vitest";
import { claimPhases, countGroups, DEFAULT_PHASES, filterTasks, GROUP_LABEL, groupOf, inView, isOpen, openByPhase, phaseStates, relativeTime, sortTasks, type View, VIEW_LABEL, statusLabel } from "./tasks.js";

type T = { id: string; status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "FAILED"; currentPhase: string | null; completedPhases: string[]; target: string; assignedTo: string | null; createdAt: string; updatedAt: string | null };
const task = (id: string, status: T["status"], currentPhase: string | null, extra: Partial<T> = {}): T => ({ id, status, currentPhase, completedPhases: [], target: `Source ${id}`, assignedTo: null, createdAt: "2026-09-28T10:00:00Z", updatedAt: null, ...extra });

const QUEUE = [
  task("q", "PENDING", "create"),
  task("w", "IN_PROGRESS", "reflect", { assignedTo: "0xadba", updatedAt: "2026-09-28T12:00:00Z" }),
  task("r", "PENDING", "verify", { completedPhases: ["create", "reflect", "reweave"] }),
  task("b", "BLOCKED", "reweave"),
  task("d", "DONE", null, { completedPhases: ["create", "reflect", "reweave", "verify"] }),
  task("f", "FAILED", "create", { target: "Deleted source" }),
];

describe("reading a task", () => {
  it("puts each task in the group a person would name it by", () => {
    expect(QUEUE.map(groupOf)).toEqual(["queued", "working", "queued", "blocked", "done", "failed"]);
    expect(groupOf({ status: "IN_PROGRESS", currentPhase: "verify" })).toBe("working");
    expect(groupOf({ status: "PENDING", currentPhase: "verify" })).toBe("queued");
    expect(QUEUE.filter(isOpen).map((t) => t.id)).toEqual(["q", "w", "r", "b"]);
  });
  it("counts groups and open tasks per phase", () => {
    expect(countGroups(QUEUE)).toEqual({ blocked: 1, working: 1, queued: 2, done: 1, failed: 1 });
    expect(openByPhase([...QUEUE, task("x", "PENDING", "enrich"), task("y", "PENDING", null)], DEFAULT_PHASES)).toEqual({ create: 1, reflect: 1, reweave: 1, verify: 1 });
  });
  it("shows each phase as done, current, to do, or where it stopped", () => {
    expect(phaseStates(QUEUE[1], DEFAULT_PHASES)).toEqual(["upcoming", "current", "upcoming", "upcoming"]);
    expect(phaseStates({ ...QUEUE[1], completedPhases: ["create"] }, DEFAULT_PHASES)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(phaseStates(QUEUE[3], DEFAULT_PHASES)).toEqual(["upcoming", "upcoming", "stopped", "upcoming"]);
    expect(phaseStates(QUEUE[4], DEFAULT_PHASES)).toEqual(["done", "done", "done", "done"]);
    expect(phaseStates(task("legacy", "DONE", null), DEFAULT_PHASES)).toEqual(["done", "done", "done", "done"]);
    expect(phaseStates(QUEUE[5], DEFAULT_PHASES)[0]).toBe("stopped");
  });
});

describe("the views", () => {
  const ids = (v: View) => QUEUE.filter((t) => inView(t, v)).map((t) => t.id);
  it("hide what is finished by default, and show it on request", () => {
    expect(ids("open")).toEqual(["q", "w", "r", "b"]);
    expect(VIEW_LABEL).not.toHaveProperty("review");
    expect(ids("problems")).toEqual(["b", "f"]);
    expect(ids("finished")).toEqual(["d", "f"]);
    expect(ids("all")).toHaveLength(6);
  });
  it("filter by phase and by what you type, in the source or the assignee", () => {
    expect(filterTasks(QUEUE, { view: "all", phase: "create", query: "" }).map((t) => t.id)).toEqual(["q", "f"]);
    expect(filterTasks(QUEUE, { view: "all", phase: null, query: "  deleted " }).map((t) => t.id)).toEqual(["f"]);
    expect(filterTasks(QUEUE, { view: "open", phase: null, query: "0XADBA" }).map((t) => t.id)).toEqual(["w"]);
    expect(filterTasks(QUEUE, { view: "open", phase: "verify", query: "nothing" })).toEqual([]);
  });
  it("put what is stuck first, then routine work by most recently touched", () => {
    const later = task("q2", "PENDING", "create", { updatedAt: "2026-09-28T13:00:00Z" });
    const tie = task("q3", "PENDING", "create");
    const bad = task("q4", "PENDING", "create", { createdAt: "not a date" });
    expect(sortTasks([...QUEUE, later, tie, bad]).map((t) => t.id)).toEqual(["b", "w", "q2", "q", "r", "q3", "q4", "f", "d"]);
  });
});

describe("groups", () => {
  it("has no review group or label", () => {
    expect(Object.keys(GROUP_LABEL)).toEqual(["blocked", "working", "queued", "done", "failed"]);
  });
});

describe("helpers", () => {
  it("read the claim phases from the queue, with a default", () => {
    expect(claimPhases([{ taskType: "enrichment", phases: ["enrich"] }, { taskType: "claim", phases: ["a", "b"] }])).toEqual(["a", "b"]);
    expect(claimPhases([{ taskType: "claim", phases: [] }])).toEqual(DEFAULT_PHASES);
    expect(claimPhases(null)).toEqual(DEFAULT_PHASES);
  });
  it("say how long ago in plain words", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect([ago(10), ago(300), ago(7200), ago(100_000), ago(5 * 86_400), ago(40 * 86_400)].map((t) => relativeTime(t, now))).toEqual(["just now", "5 min ago", "2 h ago", "yesterday", "5 d ago", "2026-08-19"]);
    expect(relativeTime(null, now)).toBe("—");
    expect(relativeTime("nope", now)).toBe("—");
    expect(relativeTime(ago(-60), now)).toBe("just now");
  });
});

describe("a task's status in the browser vault", () => {
  it("says why an open task waits when the AI does not answer, and nothing else changes", () => {
    expect(statusLabel("queued", "no-ai")).toBe("Waiting for AI");
    expect(statusLabel("working", "unreachable")).toBe("Can't reach AI");
    expect(statusLabel("queued", "refused")).toBe("Key refused");
    expect(statusLabel("working", "working")).toBe("Working");
    expect(statusLabel("done", "no-ai")).toBe("Done");
    expect(statusLabel("failed", "unreachable")).toBe("Failed");
    expect(statusLabel("queued", undefined)).toBe("Queued");
  });
});
