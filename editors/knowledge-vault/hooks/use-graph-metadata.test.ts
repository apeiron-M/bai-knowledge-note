import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachSharedRefresh,
  getGeneration,
  projectionAffected,
  subscribeGeneration,
} from "./use-graph-metadata.js";

describe("projectionAffected", () => {
  const base = { structural: false, documents: [] };

  it("is true for a structural change", () => {
    expect(projectionAffected({ ...base, structural: true })).toBe(true);
  });

  it("is true for every type the projection indexes", () => {
    for (const documentType of [
      "bai/knowledge-note",
      "bai/moc",
      "bai/tension",
      "bai/observation",
      "bai/research-claim",
    ]) {
      expect(projectionAffected({ ...base, documents: [{ documentType }] })).toBe(true);
    }
  });

  it("is true for an unknown type, which may be a projected one", () => {
    expect(projectionAffected({ ...base, documents: [{ documentType: null }] })).toBe(
      true,
    );
  });

  it("is false for types the projection does not index", () => {
    expect(
      projectionAffected({
        ...base,
        documents: [
          { documentType: "bai/source" },
          { documentType: "powerhouse/scopeofwork" },
        ],
      }),
    ).toBe(false);
  });
});

describe("attachSharedRefresh", () => {
  const detachers: Array<() => void> = [];

  afterEach(() => {
    while (detachers.length > 0) detachers.pop()?.();
    vi.useRealTimers();
  });

  function attach(driveId = "d1") {
    const detach = attachSharedRefresh(driveId);
    detachers.push(detach);
    return detach;
  }

  it("bumps the generation ONCE per poll however many consumers are attached", () => {
    vi.useFakeTimers();
    const bumps = vi.fn();
    const off = subscribeGeneration(bumps);
    try {
      // The three real consumers: useKnowledgeNotes, ...Mocs, ...Tensions.
      attach();
      attach();
      attach();
      vi.advanceTimersByTime(60_000);
      expect(bumps).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(bumps).toHaveBeenCalledTimes(2);
    } finally {
      off();
    }
  });

  it("advances the generation counter so consumers refetch", () => {
    vi.useFakeTimers();
    const before = getGeneration();
    attach();
    vi.advanceTimersByTime(60_000);
    expect(getGeneration()).toBe(before + 1);
  });

  it("keeps polling while any consumer remains", () => {
    vi.useFakeTimers();
    const bumps = vi.fn();
    const off = subscribeGeneration(bumps);
    try {
      const first = attach();
      attach();
      first();
      vi.advanceTimersByTime(60_000);
      expect(bumps).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it("stops polling once the last consumer detaches", () => {
    vi.useFakeTimers();
    const bumps = vi.fn();
    const off = subscribeGeneration(bumps);
    try {
      const a = attach();
      const b = attach();
      a();
      b();
      vi.advanceTimersByTime(180_000);
      expect(bumps).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it("does not notify a listener that unsubscribed", () => {
    vi.useFakeTimers();
    const bumps = vi.fn();
    subscribeGeneration(bumps)();
    attach();
    vi.advanceTimersByTime(60_000);
    expect(bumps).not.toHaveBeenCalled();
  });
});
