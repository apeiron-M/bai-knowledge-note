import "../../editors/shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSavedProviders } from "../../editors/knowledge-vault/lib/chat/provider.js";
import type { PipelinePhase } from "../../pieces/knowledge-vault/lib/agent/pipeline.js";
import type { KnowledgeVaultClient, RequestOptions } from "../../pieces/knowledge-vault/lib/common/client.js";
import { KnowledgeVaultApiError } from "../../pieces/knowledge-vault/lib/common/errors.js";
import type { FlushGate } from "../engine.js";
import { AiRefusedError, AiUnreachableError, CallBudgetError, type PipelineAi } from "./ai.js";
import type { PhaseContext, PhaseOutcome } from "./phases.js";
import { failureReason, nextTask, PICKUP_MS, startPipelineRunner, UNREACHABLE_RETRY_MS, type RunnerDeps, type RunnerTask } from "./runner.js";

/** Every fake answers at once, so one macrotask lets a pass run to its end. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

type Task = RunnerTask & { handoffs: { phase: string; workDone: string; completedBy: string | null }[] };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskType: "claim", status: "PENDING", documentRef: `src-${id}`, currentPhase: "create", assignedTo: null, handoffs: [], ...extra });
const NEXT: Record<string, string | null> = { create: "reflect", reflect: "reweave", reweave: "verify", verify: null };

type VaultHooks = {
  /** No pipeline queue in the drive. */
  noQueue?: boolean;
  /** Awaited before the queue is read: a stop can land there. */
  beforeQueueRead?: () => Promise<void>;
  /** Called as each handoff is written. */
  onAdvance?: (phase: string) => void;
  /** Sources with no title yet. */
  untitled?: string[];
};

/** The vault's queue, as the runner reads and writes it through the REST routes. */
function queueVault(tasks: Task[], log: string[] = [], hooks: VaultHooks = {}) {
  const requests: RequestOptions[] = [];
  const failures: { taskId: string; reason: string }[] = [];
  const state = { down: false, refuseAdvance: false };
  const nodes = () => [
    ...(hooks.noQueue ? [] : [{ id: "q1", kind: "file", name: "queue", documentType: "bai/pipeline-queue", parentFolder: "ops" }]),
    { id: "ops", kind: "folder", name: "ops", parentFolder: null },
    { id: "sources", kind: "folder", name: "sources", parentFolder: null },
    { id: "pdf", kind: "folder", name: "report.pdf", parentFolder: "sources" },
    ...tasks.map((t) => ({ id: t.documentRef, kind: "file", name: t.documentRef, documentType: "bai/source", parentFolder: t.id.startsWith("pdf") ? "pdf" : "sources" })),
  ];
  const respond = (o: RequestOptions): unknown => {
    if (state.down) throw new KnowledgeVaultApiError("The vault is not answering", { category: "server", status: 503 });
    const method = o.method ?? "GET";
    const body = (o.json ?? {}) as Record<string, unknown>;
    if (o.path === "ping") return { ok: true, user: "browser-visitor" };
    if (o.path === "stats") return { noteCount: 42 };
    if (method === "GET" && o.path === "notes/d1") return { state: { global: { nodes: nodes() } } };
    if (method === "GET" && o.path === "notes/q1") return { state: { global: { tasks: structuredClone(tasks) } } };
    if (method === "GET" && o.path.startsWith("notes/")) {
      const id = decodeURIComponent(o.path.slice("notes/".length));
      return { name: id, state: { global: hooks.untitled?.includes(id) ? {} : { title: `Title of ${id}` } } };
    }
    const claim = /^tasks\/(.+)\/claim$/.exec(o.path);
    if (method === "POST" && claim) {
      const t = tasks.find((x) => x.id === decodeURIComponent(claim[1]));
      if (!t || t.assignedTo || t.status !== "PENDING") throw new KnowledgeVaultApiError("Task is already assigned", { category: "conflict", status: 409 });
      Object.assign(t, { assignedTo: "browser-visitor", status: "IN_PROGRESS" });
      log.push("claim");
      return { taskId: t.id, assignedTo: t.assignedTo };
    }
    if (method === "POST" && o.path === "actions") {
      const actions = body.actions as { type: string; input: Record<string, unknown> }[];
      return {
        operations: actions.map((a) => {
          const t = tasks.find((x) => x.id === a.input.taskId);
          if (!t) return { type: a.type, error: "Task not found" };
          if (a.type === "ADVANCE_PHASE") {
            const h = a.input.handoff as { phase: string; workDone: string; completedBy?: string };
            if (state.refuseAdvance || h.phase !== t.currentPhase) return { type: a.type, error: "Phase mismatch" };
            log.push("advance");
            hooks.onAdvance?.(h.phase);
            t.handoffs.push({ phase: h.phase, workDone: h.workDone, completedBy: h.completedBy ?? null });
            const next = NEXT[h.phase];
            Object.assign(t, next ? { currentPhase: next, status: "PENDING" } : { currentPhase: null, status: "DONE" }, { assignedTo: null });
          } else if (a.type === "FAIL_TASK") {
            log.push("fail");
            t.status = "FAILED";
            failures.push({ taskId: t.id, reason: String(a.input.reason) });
          }
          return { type: a.type, error: null };
        }),
      };
    }
    throw new Error(`no route ${method} ${o.path}`);
  };
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      if (o.path === "notes/q1" && hooks.beforeQueueRead) await hooks.beforeQueueRead();
      return respond(o);
    },
  } as unknown as KnowledgeVaultClient;
  return { client, tasks, failures, state, requests, writes: () => requests.filter((r) => (r.method ?? "GET") !== "GET"), claims: () => requests.filter((r) => r.path.endsWith("/claim")) };
}

function aiNamed(model = "model-a", reach: () => Promise<void> = () => Promise.resolve()): PipelineAi {
  const fetchImpl = (() => Promise.reject(new Error("the runner makes no model calls itself"))) as unknown as typeof fetch;
  return { llm: {} as PipelineAi["llm"], model, local: false, label: model, fetchImpl, calls: () => 0, reach };
}

type Script = (phase: PipelinePhase, ctx: PhaseContext) => Promise<PhaseOutcome> | PhaseOutcome;
const ok = (phase: PipelinePhase, ctx: PhaseContext): PhaseOutcome => {
  ctx.beforeWrites?.();
  return { workDone: `${phase} done.`, filesModified: [] };
};

/** Every runner a test starts, stopped after it: one test's runner never acts in the next. */
const started: { stop(): Promise<void> }[] = [];
const startRunner = (deps: RunnerDeps) => {
  const runner = startPipelineRunner(deps);
  started.push(runner);
  return runner;
};

function start(v: ReturnType<typeof queueVault>, opts: { script?: Script; ai?: RunnerDeps["ai"]; log?: string[]; storage?: Map<string, string>; onEvent?: RunnerDeps["onEvent"] } = {}) {
  const log = opts.log ?? [];
  let held = false;
  const flushes: FlushGate = {
    get held() {
      return held;
    },
    hold: () => {
      held = true;
      log.push("hold");
    },
    release: () => {
      held = false;
      log.push("release");
      return Promise.resolve();
    },
  };
  const ran: { phase: PipelinePhase; sourceId: string; model: string; mapTitle: string }[] = [];
  let listener: (() => void) | null = null;
  const afterTask = vi.fn(() => Promise.resolve());
  const storage = opts.storage ?? new Map<string, string>();
  let signal: AbortSignal | null = null;
  const deps: RunnerDeps = {
    client: v.client,
    driveId: "d1",
    flushes,
    ready: Promise.resolve(),
    onChange: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    afterTask,
    ai: (s) => {
      signal = s;
      return opts.ai ? opts.ai(s) : Promise.resolve(aiNamed());
    },
    runPhase: async (phase, ctx) => {
      ran.push({ phase, sourceId: ctx.sourceId, model: ctx.ai.model, mapTitle: ctx.mapTitle });
      log.push(`phase:${phase}`);
      return (opts.script ?? ok)(phase, ctx);
    },
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, value) => void storage.set(k, value) },
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  };
  const runner = startRunner(deps);
  return { runner, deps, log, ran, afterTask, storage, change: () => listener?.(), signal: () => signal };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(async () => {
  await Promise.all(started.splice(0).map((r) => r.stop()));
  vi.useRealTimers();
});

describe("the browser pipeline runner", () => {
  it("picks the waiting task and takes it through the four phases, one handoff each", async () => {
    const v = queueVault([task("old", { status: "DONE", currentPhase: null }), task("t1")]);
    const r = start(v);
    await settle();
    expect(r.ran.map((x) => x.phase)).toEqual(["create", "reflect", "reweave", "verify"]);
    expect(v.tasks[1].status).toBe("DONE");
    expect(v.tasks[1].handoffs).toEqual(
      (["create", "reflect", "reweave", "verify"] as const).map((phase) => ({ phase, workDone: `${phase} done.`, completedBy: "knowledge-vault-web · model-a" })),
    );
    expect(r.afterTask).toHaveBeenCalledTimes(1);
    expect(r.runner.state()).toEqual({ kind: "ready" });
  });

  it("tells the page about sources added after its first look, and how each one ended", async () => {
    const v = queueVault([task("old", { status: "DONE", currentPhase: null }), task("waiting", { currentPhase: "verify" })]);
    const events: unknown[] = [];
    const r = start(v, {
      onEvent: (e) => events.push(e),
      script: (phase, ctx) => {
        if (ctx.sourceId === "src-t2" && phase === "reflect") throw new CallBudgetError();
        if (ctx.sourceId === "src-t1" && phase === "create") return { workDone: "Extracted 3 notes (read the first 24,000 of 60,000 characters).", filesModified: [], partial: true };
        return ok(phase, ctx);
      },
    });
    await settle();
    // What was in the queue at the first look was not added now: only its end is told.
    expect(events).toEqual([{ type: "source-processed", notes: 42, partial: false }]);
    v.tasks.push(task("t1"), task("t2"));
    r.change();
    await settle();
    expect(events.slice(1)).toEqual([
      { type: "source-added", count: 2 },
      { type: "source-processed", notes: 42, partial: true },
      { type: "source-failed", reason: "Your AI's answer could not be used" },
    ]);
  });

  it("keeps working when the page's event handler throws", async () => {
    const v = queueVault([]);
    const r = start(v, {
      onEvent: () => {
        throw new Error("the page's handler broke");
      },
    });
    await settle();
    v.tasks.push(task("t1"));
    r.change();
    await settle();
    expect(v.tasks[0].status).toBe("DONE");
  });

  it("says which task it is working on, and tells its listeners", async () => {
    const v = queueVault([task("t1")]);
    const seen: string[] = [];
    const r = start(v, {
      script: (phase, ctx) => {
        const s = r.runner.state();
        seen.push(s.kind === "working" ? `working ${s.taskId}` : s.kind);
        return ok(phase, ctx);
      },
    });
    const heard = vi.fn();
    const unsubscribe = r.runner.subscribe(heard);
    await settle();
    expect(seen).toEqual(["working t1", "working t1", "working t1", "working t1"]);
    expect(heard).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("holds the store's writes once per phase: after the claim, until the handoff is written", async () => {
    const log: string[] = [];
    const v = queueVault([task("t1")], log);
    const r = start(v, {
      log,
      script: (phase, ctx) => {
        if (phase === "verify") return { workDone: "Checked.", filesModified: [] };
        return ok(phase, ctx);
      },
    });
    await settle();
    const perPhase = ["claim", "hold", "advance", "release"];
    expect(log.filter((e) => !e.startsWith("phase:"))).toEqual([...perPhase, ...perPhase, ...perPhase, ...perPhase]);
    expect(log.slice(0, 5)).toEqual(["claim", "phase:create", "hold", "advance", "release"]);
    expect(r.ran).toHaveLength(4);
    expect(v.tasks[0].status).toBe("DONE");
  });

  it("with no AI connected, claims nothing and waits; an AI connected later starts it within 10 s", async () => {
    const v = queueVault([task("t1")]);
    let connected: PipelineAi | null = null;
    const r = start(v, { ai: () => Promise.resolve(connected) });
    await settle();
    expect(r.runner.state()).toEqual({ kind: "no-ai" });
    expect(v.writes()).toEqual([]);
    connected = aiNamed();
    await vi.advanceTimersByTimeAsync(PICKUP_MS);
    await settle();
    expect(v.tasks[0].status).toBe("DONE");
  });

  it("leaves the task alone while the AI cannot be reached, and tries again after 30 s", async () => {
    const v = queueVault([task("t1")]);
    let up = false;
    let attempts = 0;
    const reach = () => {
      attempts++;
      return up ? Promise.resolve() : Promise.reject(new AiUnreachableError(new TypeError("Failed to fetch")));
    };
    const r = start(v, { ai: () => Promise.resolve(aiNamed("model-a", reach)) });
    await settle();
    expect(r.runner.state()).toEqual({ kind: "unreachable" });
    expect(v.writes()).toEqual([]);
    r.change();
    await vi.advanceTimersByTimeAsync(2 * PICKUP_MS);
    await settle();
    expect(attempts).toBe(1);
    up = true;
    await vi.advanceTimersByTimeAsync(UNREACHABLE_RETRY_MS - 2 * PICKUP_MS);
    await settle();
    expect(attempts).toBe(2);
    expect(v.tasks[0].status).toBe("DONE");
    expect(v.failures).toEqual([]);
  });

  it("an AI lost in the middle of a phase is waited for too, and the phase is done again", async () => {
    const v = queueVault([task("t1")]);
    let lost = true;
    const r = start(v, {
      script: (phase, ctx) => {
        if (phase === "reflect" && lost) {
          lost = false;
          throw new AiUnreachableError(new TypeError("Failed to fetch"));
        }
        return ok(phase, ctx);
      },
    });
    await settle();
    expect(r.runner.state()).toEqual({ kind: "unreachable" });
    expect(v.tasks[0]).toMatchObject({ status: "IN_PROGRESS", currentPhase: "reflect", assignedTo: "browser-visitor" });
    await vi.advanceTimersByTimeAsync(UNREACHABLE_RETRY_MS);
    await settle();
    expect(r.ran.map((x) => x.phase)).toEqual(["create", "reflect", "reflect", "reweave", "verify"]);
    expect(v.tasks[0].status).toBe("DONE");
    expect(v.failures).toEqual([]);
  });

  it("fails the task with a plain reason when the AI's answers cannot be used, and remembers why", async () => {
    const v = queueVault([task("t1"), task("t2")]);
    const storage = new Map<string, string>();
    const r = start(v, {
      storage,
      script: (phase, ctx) => {
        if (ctx.sourceId === "src-t1" && phase === "reflect") throw new CallBudgetError();
        return ok(phase, ctx);
      },
    });
    await settle();
    expect(v.failures).toEqual([{ taskId: "t1", reason: "Your AI's answer could not be used" }]);
    expect(v.tasks[0].status).toBe("FAILED");
    expect(r.runner.failureReason("t1")).toBe("Your AI's answer could not be used");
    expect(r.runner.failureReason("t2")).toBeNull();
    expect(r.afterTask).toHaveBeenCalledTimes(1);
    // A failure that is the AI's holds the next source back a while: one bad key, or a free model's
    // rate limit, does not fail a whole file's sections in a row.
    expect(v.tasks[1].status).toBe("PENDING");
    r.change();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_RETRY_MS - 1);
    await settle();
    expect(v.tasks[1].status).toBe("PENDING");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(v.tasks[1].status).toBe("DONE");
    expect(r.afterTask).toHaveBeenCalledTimes(2);
    await r.runner.stop();
    expect(start(queueVault([]), { storage }).runner.failureReason("t1")).toBe("Your AI's answer could not be used");
  });

  it("goes straight on to the next source when a failure was the source's, not the AI's", async () => {
    const v = queueVault([task("t1"), task("t2")]);
    start(v, {
      script: (phase, ctx) => {
        if (ctx.sourceId === "src-t1") throw new KnowledgeVaultApiError('The source "Empty" has no text to extract from', { category: "validation" });
        return ok(phase, ctx);
      },
    });
    await settle();
    expect(v.failures).toEqual([{ taskId: "t1", reason: "This source has no text" }]);
    expect(v.tasks[1].status).toBe("DONE");
  });

  it("fails a task whose key is refused before touching it, and holds the next one back", async () => {
    const v = queueVault([task("t1"), task("t2")]);
    const r = start(v, { ai: () => Promise.resolve(aiNamed("model-a", () => Promise.reject(new AiRefusedError()))) });
    await settle();
    expect(v.failures).toEqual([{ taskId: "t1", reason: "Your AI refused the key" }]);
    expect(v.claims()).toEqual([]);
    expect(v.tasks[1].status).toBe("PENDING");
    expect(r.ran).toEqual([]);
  });

  it("fails the task, not the runner, when the advance is refused, so the phase is never redone in a loop", async () => {
    const v = queueVault([task("t1")]);
    v.state.refuseAdvance = true;
    const r = start(v);
    await settle();
    expect(v.failures).toEqual([{ taskId: "t1", reason: "Something went wrong — try again" }]);
    await vi.advanceTimersByTimeAsync(3 * PICKUP_MS);
    await settle();
    expect(r.ran.map((x) => x.phase)).toEqual(["create"]);
  });

  it("resumes a task where a closed tab left it: between phases, or in one this browser holds", async () => {
    const v = queueVault([
      task("theirs", { status: "IN_PROGRESS", assignedTo: "0xsomeone-else" }),
      task("t1", { currentPhase: "reflect" }),
      task("t2", { status: "IN_PROGRESS", currentPhase: "reweave", assignedTo: "browser-visitor" }),
    ]);
    const r = start(v);
    await settle();
    expect(r.ran.map((x) => `${x.sourceId}:${x.phase}`)).toEqual(["src-t1:reflect", "src-t1:reweave", "src-t1:verify", "src-t2:reweave", "src-t2:verify"]);
    expect(v.tasks[0].status).toBe("IN_PROGRESS");
    expect(v.claims()).toHaveLength(4);
  });

  it("stopped during a phase, claims and writes nothing more, and stops the AI's calls", async () => {
    const v = queueVault([task("t1")]);
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => (unblock = resolve));
    const r = start(v, {
      script: async (phase, ctx) => {
        if (phase === "reflect") await blocked;
        return ok(phase, ctx);
      },
    });
    await settle();
    expect(r.ran.map((x) => x.phase)).toEqual(["create", "reflect"]);
    const writes = v.writes().length;
    const stopping = r.runner.stop();
    expect(r.signal()?.aborted).toBe(true);
    unblock();
    await stopping;
    await vi.advanceTimersByTimeAsync(3 * PICKUP_MS);
    await settle();
    expect(v.writes()).toHaveLength(writes);
    expect(v.tasks[0]).toMatchObject({ status: "IN_PROGRESS", currentPhase: "reflect" });
    expect(r.ran).toHaveLength(2);
    expect(r.afterTask).not.toHaveBeenCalled();
  });

  it("asks for the AI again for each task, so a provider changed between two sources is used for the second", async () => {
    const v = queueVault([task("t1"), task("t2")]);
    let current = aiNamed("model-a");
    const r = start(v, {
      ai: () => Promise.resolve(current),
      script: (phase, ctx) => {
        if (ctx.sourceId === "src-t1" && phase === "verify") current = aiNamed("model-b");
        return ok(phase, ctx);
      },
    });
    await settle();
    const four = (s: string) => Array.from({ length: 4 }, () => s);
    expect(r.ran.map((x) => `${x.sourceId}:${x.model}`)).toEqual([...four("src-t1:model-a"), ...four("src-t2:model-b")]);
    expect(v.tasks[1].handoffs.map((h) => h.completedBy)).toEqual(four("knowledge-vault-web · model-b"));
  });

  it("advances a phase whose writes partly landed, saying what did not in its handoff", async () => {
    const v = queueVault([task("t1")]);
    start(v, {
      script: (phase, ctx) => {
        ctx.beforeWrites?.();
        return phase === "reflect"
          ? { workDone: "Connected 3 notes with 1 link, each with its reason.", filesModified: ["n1"], incomplete: "2 links did not land" }
          : { workDone: `${phase} done.`, filesModified: [] };
      },
    });
    await settle();
    expect(v.tasks[0].handoffs[1].workDone).toBe("Connected 3 notes with 1 link, each with its reason — 2 links did not land.");
    expect(v.tasks[0].status).toBe("DONE");
  });

  it("names the map after the file a source's sections came from, else after the source", async () => {
    const v = queueVault([task("pdf-1"), task("t1"), task("bare")], [], { untitled: ["src-bare"] });
    const r = start(v);
    await settle();
    expect([...new Set(r.ran.map((x) => `${x.sourceId} → ${x.mapTitle}`))]).toEqual(["src-pdf-1 → report.pdf", "src-t1 → Title of src-t1", "src-bare → src-bare"]);
  });

  it("waits quietly in a vault with no queue", async () => {
    const v = queueVault([task("t1")], [], { noQueue: true });
    const r = start(v);
    await settle();
    await vi.advanceTimersByTimeAsync(PICKUP_MS);
    await settle();
    expect(r.runner.state()).toEqual({ kind: "ready" });
    expect(v.writes()).toEqual([]);
  });

  it("uses the chat's AI and keeps failure reasons in localStorage when given neither", async () => {
    localStorage.clear();
    const v = queueVault([task("t1"), task("t2")]);
    const deps = start(queueVault([])).deps;
    const runner = startRunner({ client: v.client, driveId: "d1", flushes: deps.flushes, ready: Promise.resolve(), onChange: () => () => undefined, afterTask: () => Promise.resolve() });
    await settle();
    expect(runner.state()).toEqual({ kind: "no-ai" });
    writeSavedProviders({ active: "custom", openrouter: null, custom: { baseUrl: "http://localhost:11434/v1", apiKey: "k", model: "llama3", extraBody: null }, connect: false });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await vi.advanceTimersByTimeAsync(PICKUP_MS);
    await settle();
    expect(v.failures).toEqual([{ taskId: "t1", reason: "Your AI refused the key" }]);
    expect(localStorage.getItem("knowledge-vault-web:pipeline-failures")).toBe(JSON.stringify([["t1", "Your AI refused the key"]]));
    await runner.stop();
    vi.unstubAllGlobals();
    warn.mockRestore();
    localStorage.clear();
  });

  it("keeps failure reasons in memory when the page has no storage, and reads past a stored list it cannot use", async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "localStorage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const v = queueVault([task("t1")]);
      const deps = start(queueVault([])).deps;
      const runner = startRunner({ ...deps, client: v.client, storage: undefined, ai: () => Promise.resolve(aiNamed("m", () => Promise.reject(new AiRefusedError()))) });
      await settle();
      expect(runner.failureReason("t1")).toBe("Your AI refused the key");
      await runner.stop();
    } finally {
      if (saved) Object.defineProperty(globalThis, "localStorage", saved);
      warn.mockRestore();
    }
    for (const stored of ["{}", "not json", JSON.stringify([["t1", 2], "x", ["t2", "Kept"]])]) {
      const storage = new Map([["knowledge-vault-web:pipeline-failures", stored]]);
      const r = start(queueVault([]), { storage });
      expect([r.runner.failureReason("t1"), r.runner.failureReason("t2")]).toEqual([null, stored.includes("Kept") ? "Kept" : null]);
      await r.runner.stop();
    }
  });

  it("carries on when the vault cannot record a failure, the health report fails, or storage refuses access", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const v = queueVault([task("t1"), task("t2")]);
    const r = start(v, {
      script: (phase, ctx) => {
        if (ctx.sourceId === "src-t1") {
          v.state.down = true;
          throw new KnowledgeVaultApiError('The source "x" has no text to extract from', { category: "validation" });
        }
        return ok(phase, ctx);
      },
    });
    r.afterTask.mockImplementationOnce(() => {
      v.state.down = false;
      return Promise.reject(new Error("the report could not be written"));
    });
    await settle();
    expect(r.runner.failureReason("t1")).toBe("This source has no text");
    expect(v.tasks[1].status).toBe("DONE");
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(
      expect.arrayContaining([expect.stringMatching(/could not be marked failed/), expect.stringMatching(/health report was not written/)]),
    );

    const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new DOMException("denied", "SecurityError"); } });
    try {
      const sealed = startRunner({ ...start(queueVault([])).deps, storage: undefined });
      expect(sealed.failureReason("t1")).toBeNull();
      await sealed.stop();
    } finally {
      if (saved) Object.defineProperty(globalThis, "localStorage", saved);
      warn.mockRestore();
    }
  });

  it("never starts in a vault that did not become ready", async () => {
    const v = queueVault([task("t1")]);
    startRunner({ ...start(queueVault([])).deps, client: v.client, ready: Promise.reject(new Error("the guide could not be written")) });
    await settle();
    await vi.advanceTimersByTimeAsync(PICKUP_MS);
    expect(v.requests).toEqual([]);
  });

  it("writes nothing after a stop, wherever it lands: reading the queue, asking for the AI or checking it, between phases, after the last", async () => {
    const deferred = () => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Reading the queue, which then answers, or fails.
    for (const outcome of ["answers", "fails"] as const) {
      const read = deferred();
      const v = queueVault([task("t1")], [], { beforeQueueRead: () => read.promise });
      const r = start(v);
      await settle();
      const stopping = r.runner.stop();
      if (outcome === "answers") read.resolve();
      else read.reject(new Error("the store closed"));
      await stopping;
      expect(v.writes()).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalled();

    // Asking for the AI, and checking it is there.
    for (const where of ["ai", "reach"] as const) {
      const asked = deferred();
      const v = queueVault([task("t1")]);
      const r = start(v, {
        ai: async () => {
          if (where === "ai") await asked.promise;
          return aiNamed("m", where === "reach" ? () => asked.promise.then(() => Promise.reject(new AiUnreachableError())) : undefined);
        },
      });
      await settle();
      const stopping = r.runner.stop();
      asked.resolve();
      await stopping;
      expect(v.writes()).toEqual([]);
      expect(r.runner.state()).toEqual({ kind: "ready" });
    }

    // Between two phases, and after the last one.
    for (const [at, ran] of [["create", ["create"]], ["verify", ["create", "reflect", "reweave", "verify"]]] as const) {
      const stopped: { promise?: Promise<void> } = {};
      const hooks: VaultHooks = {
        onAdvance: (phase) => {
          if (phase === at) stopped.promise = r.runner.stop();
        },
      };
      const v = queueVault([task("t1")], [], hooks);
      const r = start(v);
      await settle();
      await stopped.promise;
      expect(r.ran.map((x) => x.phase)).toEqual(ran);
      expect(v.claims()).toHaveLength(ran.length);
      expect(r.afterTask).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it("starts work at once when the vault changes, without waiting for the next look", async () => {
    const v = queueVault([]);
    const r = start(v);
    await settle();
    v.tasks.push(task("t1"));
    r.change();
    await settle();
    expect(v.tasks[0].status).toBe("DONE");
  });

  it("keeps looking when the vault fails to answer", async () => {
    const v = queueVault([task("t1")]);
    v.state.down = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    start(v);
    await settle();
    v.state.down = false;
    await vi.advanceTimersByTimeAsync(PICKUP_MS);
    await settle();
    expect(v.tasks[0].status).toBe("DONE");
    warn.mockRestore();
  });

  it("starts only once the vault is ready, and not at all when stopped first", async () => {
    const v = queueVault([task("t1")]);
    let open!: () => void;
    const ready = new Promise<void>((resolve) => (open = resolve));
    const early = startRunner({ ...start(queueVault([])).deps, client: v.client, ready });
    await settle();
    expect(v.writes()).toEqual([]);
    await early.stop();
    open();
    await settle();
    expect(v.writes()).toEqual([]);
  });
});

describe("the task the runner takes", () => {
  it("is the first claim task waiting at a phase, or one this browser holds", () => {
    const tasks = [
      task("done", { status: "DONE", currentPhase: null }),
      task("failed", { status: "FAILED" }),
      task("enrich", { taskType: "enrichment", currentPhase: "enrich" }),
      task("theirs", { status: "IN_PROGRESS", assignedTo: "0xother" }),
      task("orphan", { documentRef: null }),
      task("mine", { status: "IN_PROGRESS", currentPhase: "verify", assignedTo: "BROWSER-VISITOR" }),
      task("next"),
    ];
    expect(nextTask(tasks)?.id).toBe("mine");
    expect(nextTask(tasks.slice(0, 5))).toBeUndefined();
  });
});

describe("the reason a failed source shows", () => {
  it("is said in a few plain words", () => {
    expect(failureReason(new AiRefusedError())).toBe("Your AI refused the key");
    expect(failureReason(new CallBudgetError())).toBe("Your AI's answer could not be used");
    expect(failureReason(new KnowledgeVaultApiError("m did not answer within 120 s, twice. Run the step again.", { category: "server" }))).toBe("Your AI did not answer in time");
    expect(failureReason(new DOMException("The operation timed out.", "TimeoutError"))).toBe("Your AI did not answer in time");
    expect(failureReason(new KnowledgeVaultApiError("The model did not answer with JSON", { category: "server" }))).toBe("Your AI's answer could not be used");
    expect(failureReason(new KnowledgeVaultApiError("m gave no answer twice: it returned an empty answer", { category: "server" }))).toBe("Your AI's answer could not be used");
    expect(failureReason(new KnowledgeVaultApiError("The model provider refused to ask m (429): slow down", { category: "rate_limit", status: 429 }))).toBe("Your AI is busy — try again in a minute");
    expect(failureReason(new KnowledgeVaultApiError("The model provider refused to ask m (400): no such model", { category: "validation", status: 400 }))).toBe("Your AI's answer could not be used");
    expect(failureReason(new KnowledgeVaultApiError('The source "Notes" has no text to extract from', { category: "validation" }))).toBe("This source has no text");
    expect(failureReason(new Error("boom"))).toBe("Something went wrong — try again");
    expect(failureReason("boom")).toBe("Something went wrong — try again");
  });
});
