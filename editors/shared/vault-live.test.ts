import "./test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceVaultRemoteChange,
  debounced,
  isStructuralChange,
  isVaultLive,
  LIVE_EVENT_TTL_MS,
  onVaultLiveChange,
  onVaultRemoteChange,
  setVaultLive,
  type VaultRemoteChange,
} from "./vault-live.js";

const change = (over: Partial<VaultRemoteChange> = {}): VaultRemoteChange => ({
  driveId: "drive-1",
  type: "UPDATED",
  documents: [{ id: "n1", documentType: "bai/knowledge-note" }],
  structural: false,
  at: 0,
  ...over,
});

afterEach(() => {
  setVaultLive(false);
  vi.useRealTimers();
});

describe("vault-live bus", () => {
  it("delivers announced changes to subscribers and stops after unsubscribe", () => {
    const seen: VaultRemoteChange[] = [];
    const off = onVaultRemoteChange((c) => seen.push(c));
    announceVaultRemoteChange(change());
    expect(seen).toHaveLength(1);
    expect(seen[0].documents[0].id).toBe("n1");
    off();
    announceVaultRemoteChange(change({ type: "DELETED" }));
    expect(seen).toHaveLength(1);
  });

  it("classifies structural event types", () => {
    for (const t of ["CREATED", "DELETED", "PARENT_ADDED", "PARENT_REMOVED", "CHILD_ADDED", "CHILD_REMOVED"]) {
      expect(isStructuralChange(t)).toBe(true);
    }
    expect(isStructuralChange("UPDATED")).toBe(false);
  });

  it("tracks the live flag and notifies only on transitions", () => {
    const transitions: boolean[] = [];
    const off = onVaultLiveChange((v) => transitions.push(v));
    expect(isVaultLive()).toBe(false);
    setVaultLive(true);
    setVaultLive(true); // no-op
    setVaultLive(false);
    expect(transitions).toEqual([true, false]);
    off();
  });

  it("debounced() coalesces a burst into one call after the last event", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = debounced(fn, 1_500);
    run();
    vi.advanceTimersByTime(1_000);
    run(); // resets the window
    vi.advanceTimersByTime(1_000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("debounced() fires at the ceiling under a sustained firehose", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    // The observed bulk-import rate: an event every 166ms for 60s.
    const run = debounced(fn, 1_500, 6_000);
    for (let i = 0; i < 360; i++) {
      run();
      vi.advanceTimersByTime(166);
    }
    // A pure trailing-edge debounce would still be at zero here.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(9);
    const duringFirehose = fn.mock.calls.length;
    // And it still settles once the writes stop.
    vi.advanceTimersByTime(1_500);
    expect(fn.mock.calls.length).toBeGreaterThan(duringFirehose);
  });

  it("debounced() still fully coalesces a burst shorter than the ceiling", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = debounced(fn, 1_500, 6_000);
    run();
    vi.advanceTimersByTime(500);
    run();
    vi.advanceTimersByTime(500);
    run();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("liveness expires unless events renew it", () => {
    vi.useFakeTimers();
    setVaultLive(true);
    expect(isVaultLive()).toBe(true);
    vi.advanceTimersByTime(LIVE_EVENT_TTL_MS - 1);
    expect(isVaultLive()).toBe(true);
    vi.advanceTimersByTime(2);
    // Socket never said "closed" — the vouch simply ran out.
    expect(isVaultLive()).toBe(false);
  });

  it("each event renews the vouch, so a delivering feed stays live", () => {
    vi.useFakeTimers();
    setVaultLive(true);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(LIVE_EVENT_TTL_MS - 1_000);
      setVaultLive(true); // renews even though already live
      expect(isVaultLive()).toBe(true);
    }
    vi.advanceTimersByTime(LIVE_EVENT_TTL_MS + 1);
    expect(isVaultLive()).toBe(false);
  });
});
