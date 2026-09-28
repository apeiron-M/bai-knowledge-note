import { describe, expect, it } from "vitest";
import { resolveSource } from "../lib/common/props.js";
import { newPipelineTaskTrigger, pollTasks, toItem } from "../lib/triggers/new-pipeline-task.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, taskType: "claim", status: "PENDING", documentRef: `src-${id}`, target: `Source ${id}`, currentPhase: "create", createdAt: "2026-09-28T10:00:00Z", ...extra });
function vault(tasks: unknown[], queue = true) {
  const requests: RequestOptions[] = [];
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      if (o.path === "notes/d") return { state: { global: { nodes: queue ? [{ id: "q1", documentType: "bai/pipeline-queue" }] : [] } } };
      if (o.path === "notes/q1") return { state: { global: { tasks } } };
      throw new Error(`no route ${o.path}`);
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
function memoryStore(initial?: unknown) {
  let value = initial;
  return { get: async () => value, put: async (_k: string, v: unknown) => { value = v; return v; }, peek: () => value };
}

describe("the new-pipeline-task trigger", () => {
  it("fires once per task at the phase, a few per poll, and again when the task reaches it later", async () => {
    const tasks = [task("t1"), task("t2"), task("t3"), task("t4", { status: "DONE" }), task("t5", { currentPhase: "reflect" }), task("t6", { taskType: "enrichment" }), task("t7", { documentRef: null })];
    const store = memoryStore();
    const v = vault(tasks);
    const first = await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 2 });
    expect(first.map((i) => i.task_id)).toEqual(["t1", "t2"]);
    expect(first[0]).toEqual({ task_id: "t1", source_id: "src-t1", source_title: "Source t1", phase: "create", queued_at: "2026-09-28T10:00:00Z", _dedupe_key: "t1@create" });
    expect((await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 2 })).map((i) => i.task_id)).toEqual(["t3"]);
    expect(await pollTasks(v.client, store, { drive: "d", phase: "create", per_poll: 2 })).toEqual([]);
    const reflect = await pollTasks(v.client, store, { drive: "d", phase: "reflect", per_poll: 5 });
    expect(reflect.map((i) => i._dedupe_key)).toEqual(["t5@reflect"]);
    expect(await pollTasks(vault([], false).client, memoryStore("junk"), { drive: "d", phase: "create", per_poll: 3 })).toEqual([]);
    expect(toItem({ id: "x", taskType: "claim", status: "PENDING" })).toMatchObject({ source_id: "", source_title: "", phase: "", queued_at: null });
  });

  const hooks = newPipelineTaskTrigger as unknown as Record<"onEnable" | "onDisable" | "run" | "test", (c: unknown) => Promise<unknown>>;
  const ctx = (store: ReturnType<typeof memoryStore>, props: Record<string, unknown>) => ({ auth: { props: { base_url: "http://127.0.0.1:1", token: "t" } }, store, propsValue: { drive: "d", phase: "create", ...props } });
  const withFetch = async (tasks: unknown[], body: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      const payload = u.includes("/notes/q1") ? { state: { global: { tasks } } } : { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } };
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

describe("choosing the source", () => {
  it("prefers the id a trigger mapped, else the dropdown, else says what to do", () => {
    expect(resolveSource({ source: "picked", source_id: " mapped " })).toBe("mapped");
    expect(resolveSource({ source: "picked", source_id: "" })).toBe("picked");
    expect(() => resolveSource({})).toThrow(/Choose a Source, or map one into Source id/);
  });
});
