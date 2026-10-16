import { describe, expect, it } from "vitest";
import { createLoadCoalescer } from "./load-coalescer.js";

/** A load the test finishes by hand, counting how many started. */
function loads() {
  const started: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const load = () =>
    new Promise<void>((resolve, reject) => {
      started.push({ resolve, reject });
    });
  return { started, load };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createLoadCoalescer", () => {
  it("runs one load when nothing is running", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const done = c.request("d1", l.load);
    expect(l.started).toHaveLength(1);
    l.started[0].resolve();
    await expect(done).resolves.toBeUndefined();
  });

  it("answers requests made during a load with exactly one more load after it", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const first = c.request("d1", l.load);
    const a = c.request("d1", l.load);
    const b = c.request("d1", l.load);
    expect(l.started).toHaveLength(1);
    let settled = 0;
    void a.then(() => settled++);
    void b.then(() => settled++);
    l.started[0].resolve();
    await first;
    await tick();
    expect(l.started).toHaveLength(2);
    expect(settled).toBe(0);
    l.started[1].resolve();
    await Promise.all([a, b]);
    expect(settled).toBe(2);
    expect(l.started).toHaveLength(2);
  });

  it("still runs the follow-up when the running load failed", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const first = c.request("d1", l.load);
    const again = c.request("d1", l.load);
    l.started[0].reject(new Error("HTTP 502"));
    await expect(first).rejects.toThrow("HTTP 502");
    await tick();
    expect(l.started).toHaveLength(2);
    l.started[1].resolve();
    await expect(again).resolves.toBeUndefined();
  });

  it("keeps vaults apart, and starts fresh once everything has settled", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const one = c.request("d1", l.load);
    const two = c.request("d2", l.load);
    expect(l.started).toHaveLength(2);
    l.started[0].resolve();
    l.started[1].resolve();
    await Promise.all([one, two]);
    const later = c.request("d1", l.load);
    expect(l.started).toHaveLength(3);
    l.started[2].resolve();
    await later;
  });
});

describe("createLoadCoalescer, joining", () => {
  it("lets a view that opens during a load share it instead of waiting for another", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const first = c.request("d1", l.load);
    const opened = c.request("d1", l.load, { join: true });
    l.started[0].resolve();
    await Promise.all([first, opened]);
    expect(l.started).toHaveLength(1);
  });

  it("joins the newest load: the follow-up a refresh already queued", async () => {
    const c = createLoadCoalescer();
    const l = loads();
    const first = c.request("d1", l.load);
    const refreshed = c.request("d1", l.load);
    const opened = c.request("d1", l.load, { join: true });
    expect(opened).toBe(refreshed);
    l.started[0].resolve();
    await first;
    await tick();
    l.started[1].resolve();
    await opened;
    expect(l.started).toHaveLength(2);
  });
});
