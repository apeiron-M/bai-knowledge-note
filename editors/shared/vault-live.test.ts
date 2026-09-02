import "./test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceVaultRemoteChange,
  debounced,
  isStructuralChange,
  isVaultLive,
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
});
