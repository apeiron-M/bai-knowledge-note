import { describe, expect, it } from "vitest";
import {
  createDismissTimer,
  createToastLedger,
  MAX_VISIBLE_NOTICES,
  type Timers,
} from "./toast-lifetime.js";

/** A clock we advance by hand; timeouts fire when the clock reaches them. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
    now: () => now,
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    pendingCount: () => pending.size,
  };
}

describe("createDismissTimer", () => {
  it("fires once after the lifetime", () => {
    const c = fakeTimers();
    let fired = 0;
    createDismissTimer(6000, () => fired++, c.timers);
    c.advance(5999);
    expect(fired).toBe(0);
    c.advance(1);
    expect(fired).toBe(1);
    c.advance(10_000);
    expect(fired).toBe(1);
  });

  it("pausing keeps what is left; resuming spends only that", () => {
    const c = fakeTimers();
    let fired = 0;
    const t = createDismissTimer(6000, () => fired++, c.timers);
    c.advance(2000);
    t.pause();
    expect(t.remainingMs()).toBe(4000);
    c.advance(60_000); // reading the toast for a minute
    expect(fired).toBe(0);
    expect(t.remainingMs()).toBe(4000);
    t.resume();
    c.advance(3999);
    expect(fired).toBe(0);
    c.advance(1);
    expect(fired).toBe(1);
  });

  it("pause and resume are idempotent", () => {
    const c = fakeTimers();
    let fired = 0;
    const t = createDismissTimer(1000, () => fired++, c.timers);
    t.pause();
    t.pause();
    t.resume();
    t.resume();
    expect(c.pendingCount()).toBe(1);
    c.advance(1000);
    expect(fired).toBe(1);
  });

  it("cancel means never", () => {
    const c = fakeTimers();
    let fired = 0;
    const t = createDismissTimer(1000, () => fired++, c.timers);
    t.cancel();
    c.advance(5000);
    t.resume(); // too late to change its mind
    c.advance(5000);
    expect(fired).toBe(0);
    expect(t.remainingMs()).toBe(0);
  });

  it("a non-positive lifetime fires on the next tick, not never", () => {
    const c = fakeTimers();
    let fired = 0;
    createDismissTimer(0, () => fired++, c.timers);
    c.advance(0);
    expect(fired).toBe(1);
  });
});

describe("createToastLedger", () => {
  it("closes the oldest when one more than the maximum appears", () => {
    const ledger = createToastLedger(2);
    const closed: string[] = [];
    ledger.enter(() => closed.push("a"));
    ledger.enter(() => closed.push("b"));
    expect(closed).toEqual([]);
    ledger.enter(() => closed.push("c"));
    expect(closed).toEqual(["a"]);
    expect(ledger.size()).toBe(2);
  });

  it("a closed entry stops counting immediately, before its exit animation ends", () => {
    const ledger = createToastLedger(1);
    let leaveA: () => void = () => {};
    ledger.enter(() => {}); // a
    leaveA = ledger.enter(() => {}); // b closes a
    expect(ledger.size()).toBe(1);
    leaveA(); // b leaves normally
    expect(ledger.size()).toBe(0);
  });

  it("leaving is idempotent and never removes another entry", () => {
    const ledger = createToastLedger(3);
    const leaveA = ledger.enter(() => {});
    ledger.enter(() => {});
    leaveA();
    leaveA();
    expect(ledger.size()).toBe(1);
  });

  it("the shared maximum is small enough to never cover the canvas", () => {
    expect(MAX_VISIBLE_NOTICES).toBeLessThanOrEqual(3);
  });
});
