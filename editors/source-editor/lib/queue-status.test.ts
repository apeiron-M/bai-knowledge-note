import { describe, expect, it } from "vitest";
import { failedLine, ingestAndQueue, latestTaskFor, openTaskFor, pasteLede, processAgainOffered, queueStatusLine, STUCK_AFTER_MS, type QueueTask } from "./queue-status.js";

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
    expect(queueStatusLine(undefined, { host: "desktop", ...at(0) })).toBeNull();
  });
  it("says a queued source is processed in the background on the desktop, and just queued on the web", () => {
    expect(queueStatusLine(task(), { host: "desktop", ...at(1000) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task(), { host: "server", ...at(1000) })).toBe("Queued for processing");
    expect(queueStatusLine(task({ currentPhase: null }), { host: "server", ...at(1000) })).toBe("Queued for processing");
  });
  it("on the web, says nothing has started it after 10 minutes with no handoff", () => {
    const stuck = "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code.";
    expect(queueStatusLine(task(), { host: "server", ...at(STUCK_AFTER_MS - 1) })).toBe("Queued for processing");
    expect(queueStatusLine(task(), { host: "server", ...at(STUCK_AFTER_MS) })).toBe(stuck);
    expect(queueStatusLine(task(), { host: "desktop", ...at(STUCK_AFTER_MS * 3) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task({ handoffs: [handoff] }), { host: "server", ...at(STUCK_AFTER_MS * 3) })).toBe("Queued for processing");
  });
  it("names the phase of a task that is working or past create", () => {
    const words: Record<string, string> = { create: "extracting notes", reflect: "connecting notes", reweave: "placing notes in topics", verify: "checking notes" };
    for (const [phase, w] of Object.entries(words)) {
      expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: phase }), { host: "desktop", ...at(0) })).toBe(`Processing — ${w}`);
    }
    expect(queueStatusLine(task({ status: "PENDING", currentPhase: "reflect" }), { host: "server", ...at(STUCK_AFTER_MS * 3) })).toBe("Processing — connecting notes");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: null }), { host: "desktop", ...at(0) })).toBe("Processing");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: "enrich" }), { host: "desktop", ...at(0) })).toBe("Processing");
  });
  it("points to the Processing queue when blocked, on every host", () => {
    for (const host of ["desktop", "browser", "server"] as const) {
      expect(queueStatusLine(task({ status: "BLOCKED" }), { host, ...at(0) })).toBe("Processing is blocked — see Processing queue");
    }
  });
});

describe("the status line in the browser vault", () => {
  const at = (ms: number) => ({ now: T0 + ms });
  it("says why a queued source waits, and what to do", () => {
    expect(queueStatusLine(task(), { host: "browser", ai: "no-ai", ...at(0) })).toBe("Waiting for your AI — connect one in Ask");
    expect(queueStatusLine(task(), { host: "browser", ai: "unreachable", ...at(0) })).toBe("Can't reach your AI — check it is running and allows this page");
    expect(queueStatusLine(task(), { host: "browser", ai: "ready", ...at(0) })).toBe("Queued — your AI starts in a moment");
    expect(queueStatusLine(task(), { host: "browser", ai: "working", ...at(0) })).toBe("Queued — your AI starts in a moment");
    expect(queueStatusLine(task(), { host: "browser", ...at(0) })).toBe("Queued — your AI starts in a moment");
  });
  it("never sends the visitor to Claude Code, however long it waits", () => {
    expect(queueStatusLine(task(), { host: "browser", ai: "ready", ...at(STUCK_AFTER_MS * 3) })).toBe("Queued — your AI starts in a moment");
  });
  it("names the phase while the AI works", () => {
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: "reflect" }), { host: "browser", ai: "working", ...at(0) })).toBe("Processing — connecting notes");
  });
});

describe("a source whose processing failed", () => {
  it("offers to process it again when its latest task failed and none is open", () => {
    const failed = task({ status: "FAILED", createdAt: "2026-10-16T11:00:00Z" });
    expect(latestTaskFor([task({ status: "DONE" }), failed], "s1")).toBe(failed);
    expect(processAgainOffered([task({ status: "DONE" }), failed], "s1")).toBe(true);
    expect(processAgainOffered([failed, task({ status: "DONE", createdAt: "2026-10-16T12:00:00Z" })], "s1")).toBe(false);
    expect(processAgainOffered([failed, task({ status: "PENDING", createdAt: "2026-10-16T12:00:00Z" })], "s1")).toBe(false);
    expect(processAgainOffered([task({ status: "FAILED", documentRef: "s2" })], "s1")).toBe(false);
    expect(processAgainOffered([], "s1")).toBe(false);
  });
  it("says it was not processed, and why when known", () => {
    expect(failedLine("Your AI did not answer in time")).toBe("Not processed — Your AI did not answer in time");
    expect(failedLine(null)).toBe("Not processed");
  });
});

describe("the paste form", () => {
  it("words the lede for the desktop, the browser vault and a server", () => {
    expect(pasteLede("desktop")).toBe("Paste the text. Once added, the app turns it into notes in the background.");
    expect(pasteLede("browser")).toBe("Paste the text. Once added, your AI turns it into notes.");
    expect(pasteLede("server")).toBe("Paste the text. Once added, it is queued to be turned into notes.");
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
