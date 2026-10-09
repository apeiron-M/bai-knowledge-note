import { describe, expect, it } from "vitest";
import { resolveSource } from "../lib/common/props.js";
import { HELD_TOO_LONG_MS, MAX_ATTEMPTS, newPipelineTaskTrigger, oneAtATimeFor, pollTasks, RESUME_AFTER_MS, toItem } from "../lib/triggers/new-pipeline-task.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, taskType: "claim", status: "PENDING", documentRef: `src-${id}`, target: `Source ${id}`, currentPhase: "create", createdAt: "2026-09-28T10:00:00Z", ...extra });
const sources = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((t) => ({ id: `src-${t}`, documentType: "bai/source" }));
function vault(tasks: unknown[], queue = true) {
  const requests: RequestOptions[] = [];
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      if (o.path === "notes/d") return { state: { global: { nodes: queue ? [{ id: "q1", documentType: "bai/pipeline-queue" }, ...sources] : [] } } };
      if (o.path === "notes/q1") return { state: { global: { tasks } } };
      throw new Error(`no route ${o.path}`);
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
/** A keyed store, like the runtime's; `peek` reads what the trigger has seen. */
function memoryStore(initialSeen?: unknown) {
  const values = new Map<string, unknown>([["knowledge-vault:new-pipeline-task:seen", initialSeen]]);
  return {
    get: async (k: string) => values.get(k),
    put: async (k: string, v: unknown) => { values.set(k, v); return v; },
    peek: () => values.get("knowledge-vault:new-pipeline-task:seen"),
  };
}

describe("the new-pipeline-task trigger", () => {
  it("with a local model, starts one task at a time: the next only once the last one was claimed and nothing is in progress", async () => {
    const tasks = [task("t1"), task("t2"), task("t4", { status: "DONE" }), task("t5", { currentPhase: "reflect" }), task("t6", { taskType: "enrichment" }), task("t7", { documentRef: null })];
    const store = memoryStore();
    let clock = 1_000_000;
    const now = () => clock;
    const v = vault(tasks);
    const first = await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 5, oneAtATime: true }, now);
    expect(first).toEqual([{ task_id: "t1", source_id: "src-t1", source_title: "Source t1", phase: "create", queued_at: "2026-09-28T10:00:00Z", _dedupe_key: "t1@create" }]);
    // started but not claimed yet: nothing else starts
    clock += 60_000;
    expect(await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 5, oneAtATime: true }, now)).toEqual([]);
    // claimed (in progress): still nothing
    tasks[0] = task("t1", { status: "IN_PROGRESS" });
    expect(await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 5, oneAtATime: true }, now)).toEqual([]);
    // done: the next one starts
    tasks[0] = task("t1", { status: "DONE" });
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 5, oneAtATime: true }, now)).map((i) => i.task_id)).toEqual(["t2"]);
    expect(await pollTasks(vault([], false).client, memoryStore("junk"), { drive: "d", phase: "create", per_poll: 3, oneAtATime: true }, now)).toEqual([]);
    expect(toItem({ id: "x", taskType: "claim", status: "PENDING" })).toMatchObject({ source_id: "", source_title: "", phase: "", queued_at: null });
  });

  it("does not let a run that died before claiming hold the queue for ever", async () => {
    const tasks = [task("t1"), task("t2")];
    const store = memoryStore();
    let clock = 1_000_000;
    const v = vault(tasks);
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 1, oneAtATime: true }, () => clock)).map((i) => i.task_id)).toEqual(["t1"]);
    clock += 11 * 60_000; // t1 still pending: its run failed on the way
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 1, oneAtATime: true }, () => clock)).map((i) => i.task_id)).toEqual(["t2"]);
  });

  it("with a hosted model, starts up to per_poll at once, as before", async () => {
    const tasks = [task("t1"), task("t2"), task("t3"), task("t4", { status: "IN_PROGRESS" })];
    const store = memoryStore();
    const v = vault(tasks);
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 2 })).map((i) => i.task_id)).toEqual(["t1", "t2"]);
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 2 })).map((i) => i.task_id)).toEqual(["t3"]);
  });

  it("knows a local model from its connection's address", () => {
    const auth = (llm_base_url: string) => ({ props: { base_url: "http://127.0.0.1:4201", token: "t", llm_api_key: "k", llm_base_url, llm_default_model: "m" } });
    expect(oneAtATimeFor(auth("http://127.0.0.1:8083/v1"))).toBe(true);
    expect(oneAtATimeFor(auth("http://192.168.1.20:11434/v1"))).toBe(true);
    expect(oneAtATimeFor(auth("https://openrouter.ai/api/v1"))).toBe(false);
    expect(oneAtATimeFor({})).toBe(false);
  });

  it("one at a time follows the connection's locality", () => {
    const auth = (locality?: string) => ({ base_url: "http://127.0.0.1:4201", token: "t", llm_api_key: "k", llm_base_url: "http://127.0.0.1:4202/llm/v1", ...(locality ? { llm_locality: locality } : {}) });
    expect(oneAtATimeFor(auth("hosted"))).toBe(false);
    expect(oneAtATimeFor(auth("local"))).toBe(true);
  });

  it("starts a task at a later phase when it reaches it", async () => {
    const tasks = [task("t5", { currentPhase: "reflect" })];
    const out = await pollTasks(vault(tasks).client, memoryStore(), { drive: "d", phase: "reflect", per_poll: 5 });
    expect(out.map((i) => i._dedupe_key)).toEqual(["t5@reflect"]);
  });

  describe("resuming a task that stopped on the way", () => {
    const T0 = Date.parse("2026-10-08T21:00:00Z");
    const at = (ms: number) => new Date(T0 + ms).toISOString();
    const keys = (items: { _dedupe_key: string }[]) => items.map((i) => i._dedupe_key);

    it("starts a task again at a later phase it stopped at, once nothing has touched it for a while", async () => {
      const tasks = [task("t5", { currentPhase: "reflect", updatedAt: at(0) })];
      const store = memoryStore();
      const poll = (ms: number) => pollTasks(vault(tasks).client, store, { drive: "d", phase: "create", per_poll: 5 }, () => T0 + ms);
      expect(await poll(RESUME_AFTER_MS - 1)).toEqual([]); // may still be on its way between two steps
      expect(keys(await poll(RESUME_AFTER_MS))).toEqual(["t5@reflect"]);
      expect(await poll(RESUME_AFTER_MS + 60_000)).toEqual([]); // just started again: give that run its time
      expect(keys(await poll(2 * RESUME_AFTER_MS))).toEqual(["t5@reflect#2"]);
      expect(keys(await poll(3 * RESUME_AFTER_MS))).toEqual(["t5@reflect#3"]);
      expect(await poll(10 * RESUME_AFTER_MS)).toEqual([]); // MAX_ATTEMPTS: a source failing every time stops costing runs
      expect(MAX_ATTEMPTS).toBe(3);
      // moved on to the next phase: a new key, a fresh count
      tasks[0] = task("t5", { currentPhase: "reweave", updatedAt: at(10 * RESUME_AFTER_MS) });
      expect(keys(await poll(11 * RESUME_AFTER_MS))).toEqual(["t5@reweave"]);
    });

    it("starts a task again at its own phase only when this trigger started it there before", async () => {
      const tasks = [task("t1", { updatedAt: at(0) }), task("t2", { updatedAt: at(0) })];
      const store = memoryStore(["t2@create"]); // t2: backlog the trigger was told to skip
      const poll = (ms: number) => pollTasks(vault(tasks).client, store, { drive: "d", phase: "create", per_poll: 5 }, () => T0 + ms);
      expect(keys(await poll(0))).toEqual(["t1@create"]);
      expect(await poll(RESUME_AFTER_MS - 1)).toEqual([]);
      expect(keys(await poll(RESUME_AFTER_MS))).toEqual(["t1@create#2"]); // its run died before it took the task
      tasks[0] = task("t1", { status: "IN_PROGRESS", updatedAt: at(RESUME_AFTER_MS) });
      expect(await poll(3 * RESUME_AFTER_MS)).toEqual([]); // taken: no longer ours to start
    });

    it("leaves the backlog alone when switched on, at every phase", async () => {
      const real = globalThis.fetch;
      const tasks = [task("t1"), task("t5", { currentPhase: "reflect" }), task("t6", { currentPhase: "verify" })];
      globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes("/notes/q1") ? { state: { global: { tasks } } } : { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }, ...sources, { id: "src-t5", documentType: "bai/source" }, { id: "src-t6", documentType: "bai/source" }] } } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      try {
        const store = memoryStore();
        await (newPipelineTaskTrigger as unknown as { onEnable(c: unknown): Promise<void> }).onEnable({ auth: { props: { base_url: "http://127.0.0.1:1", token: "t" } }, store, propsValue: { drive: "d" } });
        expect(store.peek()).toEqual(["t1@create", "t5@reflect", "t6@verify"]);
      } finally {
        globalThis.fetch = real;
      }
    });

    it("one at a time: a task held far longer than any step runs no longer holds the queue", async () => {
      const tasks = [task("t1", { status: "IN_PROGRESS", updatedAt: at(0) }), task("t2", { updatedAt: at(0) })];
      const poll = (ms: number) => pollTasks(vault(tasks).client, memoryStore(), { drive: "d", phase: "create", per_poll: 1, oneAtATime: true }, () => T0 + ms);
      expect(await poll(HELD_TOO_LONG_MS - 1)).toEqual([]);
      expect(keys(await poll(HELD_TOO_LONG_MS))).toEqual(["t2@create"]);
    });

    it("keeps its record to open tasks, and survives a store that holds something else", async () => {
      const store = memoryStore();
      await store.put("knowledge-vault:new-pipeline-task:fired", { "gone@create": { n: 1, at: 0 }, "t1@create": { n: "x" }, junk: null });
      await pollTasks(vault([task("t1", { updatedAt: at(0) })]).client, store, { drive: "d", phase: "create", per_poll: 5 }, () => T0);
      expect(await store.get("knowledge-vault:new-pipeline-task:fired")).toEqual({ "t1@create": { n: 1, at: T0 } });
      await store.put("knowledge-vault:new-pipeline-task:fired", ["not", "a", "record"]);
      expect(keys(await pollTasks(vault([task("t5", { currentPhase: "reweave", updatedAt: at(0) })]).client, store, { drive: "d", phase: "create", per_poll: 5 }, () => T0 + RESUME_AFTER_MS))).toEqual(["t5@reweave"]);
    });
  });

  it("skips a task whose source was deleted: its run would fail on the first read", async () => {
    const v = vault([task("gone", { documentRef: "src-deleted" }), task("t1")]);
    expect((await pollTasks(v.client, memoryStore(), { drive: "d", phase: "create", per_poll: 5 })).map((i) => i.task_id)).toEqual(["t1"]);
  });

  const hooks = newPipelineTaskTrigger as unknown as Record<"onEnable" | "onDisable" | "run" | "test", (c: unknown) => Promise<unknown>>;
  const ctx = (store: ReturnType<typeof memoryStore>, props: Record<string, unknown>) => ({ auth: { props: { base_url: "http://127.0.0.1:1", token: "t" } }, store, propsValue: { drive: "d", ...props } });
  const withFetch = async (tasks: unknown[], body: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      const payload = u.includes("/notes/q1") ? { state: { global: { tasks } } } : { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }, ...sources] } } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await body();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("does not replay the backlog unless asked, and forgets on disable", async () => {
    await withFetch([task("t1"), task("t2")], async () => {
      const store = memoryStore();
      await hooks.onEnable(ctx(store, {}));
      expect(store.peek()).toEqual(["t1@create", "t2@create"]);
      expect(await hooks.run(ctx(store, {}))).toEqual([]);
      const backlog = memoryStore();
      await hooks.onEnable(ctx(backlog, { include_backlog: true }));
      expect(((await hooks.run(ctx(backlog, { per_poll: "x" }))) as unknown[]).length).toBe(2);
      const capped = memoryStore([]);
      expect(((await hooks.run(ctx(capped, { per_poll: 1 }))) as unknown[]).length).toBe(1);
      expect(((await hooks.test(ctx(memoryStore(), {}))) as { task_id: string }[]).map((i) => i.task_id)).toEqual(["t2"]);
      await hooks.onDisable(ctx(store, {}));
      expect(store.peek()).toBeNull();
    });
  });
});

describe("an unsaved default", () => {
  it("falls back to the create phase", async () => {
    const { phaseOf } = await import("../lib/triggers/new-pipeline-task.js");
    expect([phaseOf(undefined), phaseOf(""), phaseOf("reflect")]).toEqual(["create", "create", "reflect"]);
  });
});

describe("choosing the source", () => {
  it("prefers the id a trigger mapped, else the dropdown, else says what to do", () => {
    expect(resolveSource({ source: "picked", source_id: " mapped " })).toBe("mapped");
    expect(resolveSource({ source: "picked", source_id: "" })).toBe("picked");
    expect(() => resolveSource({})).toThrow(/Choose a Source, or map one into Source id/);
  });
});
