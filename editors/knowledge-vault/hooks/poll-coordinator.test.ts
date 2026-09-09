import { afterEach, describe, expect, it, vi } from "vitest";
import { createPollCoordinator } from "./poll-coordinator.js";

function make(overrides: Parameters<typeof createPollCoordinator>[0] = {}) {
  return createPollCoordinator({ isVisible: () => true, ...overrides });
}

describe("createPollCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs ONE timer for the three readers of the same id set", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const explorer = vi.fn();
    const projects = vi.fn();
    const scopeOfWork = vi.fn();

    coordinator.register("sow-ids", 60_000, explorer);
    coordinator.register("sow-ids", 30_000, projects);
    coordinator.register("sow-ids", 30_000, scopeOfWork);

    expect(coordinator.activeGroups()).toBe(1);
    vi.advanceTimersByTime(30_000);
    // All three fire in the SAME tick, so their fetches overlap and dedupe.
    expect(explorer).toHaveBeenCalledTimes(1);
    expect(projects).toHaveBeenCalledTimes(1);
    expect(scopeOfWork).toHaveBeenCalledTimes(1);
  });

  it("runs at the shortest period any member asked for", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const slow = vi.fn();
    coordinator.register("k", 60_000, slow);
    coordinator.register("k", 10_000, vi.fn());
    vi.advanceTimersByTime(10_000);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("keeps separate groups for different id sets", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const a = vi.fn();
    const b = vi.fn();
    coordinator.register("sources", 10_000, a);
    coordinator.register("projects", 10_000, b);
    expect(coordinator.activeGroups()).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("slows back down when the fast member leaves", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const slow = vi.fn();
    coordinator.register("k", 60_000, slow);
    const leaveFast = coordinator.register("k", 10_000, vi.fn());
    leaveFast();
    vi.advanceTimersByTime(10_000);
    expect(slow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50_000);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("stops the timer when the last member leaves", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const fn = vi.fn();
    const leave = coordinator.register("k", 10_000, fn);
    leave();
    expect(coordinator.activeGroups()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not poll a hidden tab", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const coordinator = make({ isVisible: () => false });
    coordinator.register("k", 10_000, fn);
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("backs off to the safety net while the change feed is live", () => {
    vi.useFakeTimers();
    let t = 0;
    const fn = vi.fn();
    const coordinator = make({
      isLive: () => true,
      now: () => t,
      liveSafetyNetMs: 300_000,
    });
    coordinator.register("k", 30_000, fn);
    for (let i = 0; i < 9; i++) {
      t += 30_000;
      vi.advanceTimersByTime(30_000);
    }
    expect(fn).not.toHaveBeenCalled(); // 270s < 300s safety net
    t += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("polls at its own cadence when the feed is not live", () => {
    vi.useFakeTimers();
    let t = 0;
    const fn = vi.fn();
    const coordinator = make({ isLive: () => false, now: () => t });
    coordinator.register("k", 30_000, fn);
    for (let i = 0; i < 3; i++) {
      t += 30_000;
      vi.advanceTimersByTime(30_000);
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("survives a member that leaves from inside its own callback", () => {
    vi.useFakeTimers();
    const coordinator = make();
    const other = vi.fn();
    const leave = coordinator.register("k", 10_000, () => leave());
    coordinator.register("k", 10_000, other);
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
