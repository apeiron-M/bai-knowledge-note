import { describe, expect, it } from "vitest";
import { ingestAndQueue, openTaskFor, pasteLede, queueStatusLine, STUCK_AFTER_MS, type QueueTask } from "./queue-status.js";

const T0 = Date.parse("2026-10-16T10:00:00Z");
const task = (extra: Partial<QueueTask> = {}): QueueTask => ({
  taskType: "claim", status: "PENDING", currentPhase: "create", documentRef: "s1",
  createdAt: "2026-10-16T10:00:00Z", handoffs: [], ...extra,
});
const handoff = { phase: "create" } as unknown as QueueTask["handoffs"][number];

describe("the open task for a source", () => {
  it("takes the newest open claim task, not the first or a failed one", () => {
    const failed = task({ status: "FAILED", createdAt: "2026-10-16T09:00:00Z" });
    const old = task({ status: "IN_PROGRESS", createdAt: "2026-10-16T09:30:00Z" });
    const fresh = task({ status: "PENDING", createdAt: "2026-10-16T09:45:00Z" });
    expect(openTaskFor([failed, old, fresh], "s1")).toBe(fresh);
    expect(openTaskFor([failed, fresh, old], "s1")).toBe(fresh);
  });
  it("ignores other sources, other task types, and finished tasks", () => {
    expect(openTaskFor([task({ documentRef: "s2" }), task({ taskType: "enrichment" }), task({ status: "DONE" }), task({ status: "FAILED" })], "s1")).toBeUndefined();
    expect(openTaskFor([], "s1")).toBeUndefined();
  });
  it("counts a blocked task as open", () => {
    const blocked = task({ status: "BLOCKED" });
    expect(openTaskFor([blocked], "s1")).toBe(blocked);
  });
});

describe("the status line", () => {
  const at = (ms: number) => ({ now: T0 + ms });
  it("says nothing without an open task", () => {
    expect(queueStatusLine(undefined, { desktop: true, ...at(0) })).toBeNull();
  });
  it("says a queued source is processed in the background on the desktop, and just queued on the web", () => {
    expect(queueStatusLine(task(), { desktop: true, ...at(1000) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task(), { desktop: false, ...at(1000) })).toBe("Queued for processing");
    expect(queueStatusLine(task({ currentPhase: null }), { desktop: false, ...at(1000) })).toBe("Queued for processing");
  });
  it("on the web, says nothing has started it after 10 minutes with no handoff", () => {
    const stuck = "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code.";
    expect(queueStatusLine(task(), { desktop: false, ...at(STUCK_AFTER_MS - 1) })).toBe("Queued for processing");
    expect(queueStatusLine(task(), { desktop: false, ...at(STUCK_AFTER_MS) })).toBe(stuck);
    expect(queueStatusLine(task(), { desktop: true, ...at(STUCK_AFTER_MS * 3) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task({ handoffs: [handoff] }), { desktop: false, ...at(STUCK_AFTER_MS * 3) })).toBe("Queued for processing");
  });
  it("names the phase of a task that is working or past create", () => {
    const words: Record<string, string> = { create: "extracting notes", reflect: "connecting notes", reweave: "placing notes in topics", verify: "checking notes" };
    for (const [phase, w] of Object.entries(words)) {
      expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: phase }), { desktop: true, ...at(0) })).toBe(`Processing — ${w}`);
    }
    expect(queueStatusLine(task({ status: "PENDING", currentPhase: "reflect" }), { desktop: false, ...at(STUCK_AFTER_MS * 3) })).toBe("Processing — connecting notes");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: null }), { desktop: true, ...at(0) })).toBe("Processing");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: "enrich" }), { desktop: true, ...at(0) })).toBe("Processing");
  });
  it("points to the Processing queue when blocked, on both hosts", () => {
    for (const desktop of [true, false]) {
      expect(queueStatusLine(task({ status: "BLOCKED" }), { desktop, ...at(0) })).toBe("Processing is blocked — see Processing queue");
    }
  });
});

describe("the paste form", () => {
  it("words the lede for the desktop and the web", () => {
    expect(pasteLede(true)).toBe("Paste the text. Once added, the app turns it into notes in the background.");
    expect(pasteLede(false)).toBe("Paste the text. Once added, it is queued to be turned into notes.");
  });
  it("adds the source first, then the queue task, then moves the source to extracting", () => {
    const log: string[] = [];
    ingestAndQueue({ ingest: () => log.push("ingest"), queue: { addTask: () => log.push("addTask"), markQueued: () => log.push("markQueued") } });
    expect(log).toEqual(["ingest", "addTask", "markQueued"]);
  });
  it("only adds the source when the vault has no processing queue", () => {
    const log: string[] = [];
    ingestAndQueue({ ingest: () => log.push("ingest") });
    expect(log).toEqual(["ingest"]);
  });
});
