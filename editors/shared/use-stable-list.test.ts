import { describe, expect, it, vi } from "vitest";
import { listsEquivalent, sameDriveNode } from "./use-stable-list.js";

const byId = (a: { id: string }, b: { id: string }) => a.id === b.id;

describe("listsEquivalent", () => {
  it("short-circuits on identity without calling the predicate", () => {
    const same = [{ id: "a" }];
    const predicate = vi.fn(byId);
    expect(listsEquivalent(same, same, predicate)).toBe(true);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("is true for a re-filtered array with equivalent contents", () => {
    expect(listsEquivalent([{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "b" }], byId)).toBe(
      true,
    );
  });

  it("is false when an item is added or removed", () => {
    expect(listsEquivalent([{ id: "a" }], [{ id: "a" }, { id: "b" }], byId)).toBe(false);
    expect(listsEquivalent([{ id: "a" }, { id: "b" }], [{ id: "a" }], byId)).toBe(false);
  });

  it("is false when an item is replaced", () => {
    expect(listsEquivalent([{ id: "a" }], [{ id: "z" }], byId)).toBe(false);
  });

  it("is false when order changes", () => {
    expect(listsEquivalent([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }], byId)).toBe(
      false,
    );
  });

  it("treats two empty arrays as equivalent", () => {
    expect(listsEquivalent([], [], byId)).toBe(true);
  });

  it("checks length before the predicate, the cheap discriminator", () => {
    const predicate = vi.fn(byId);
    listsEquivalent([{ id: "a" }], [{ id: "a" }, { id: "b" }], predicate);
    expect(predicate).not.toHaveBeenCalled();
  });
});

describe("sameDriveNode", () => {
  const node = { id: "n1", name: "Note", documentType: "bai/knowledge-note" };

  it("is true for an identical node", () => {
    expect(sameDriveNode(node, { ...node })).toBe(true);
  });

  it("is false on rename — the sidebar renders the name", () => {
    expect(sameDriveNode(node, { ...node, name: "Renamed" })).toBe(false);
  });

  it("is false when the document type changes", () => {
    expect(sameDriveNode(node, { ...node, documentType: "bai/moc" })).toBe(false);
  });

  it("is false for a different id", () => {
    expect(sameDriveNode(node, { ...node, id: "n2" })).toBe(false);
  });

  it("tolerates absent optional fields", () => {
    expect(sameDriveNode({ id: "n1" }, { id: "n1" })).toBe(true);
  });
});
