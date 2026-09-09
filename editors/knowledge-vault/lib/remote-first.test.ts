import { describe, expect, it } from "vitest";
import { batchKeyContains } from "./remote-first.js";

describe("batchKeyContains", () => {
  it("finds an id at any position in the key", () => {
    const key = "aaa,bbb,ccc";
    expect(batchKeyContains(key, "aaa")).toBe(true);
    expect(batchKeyContains(key, "bbb")).toBe(true);
    expect(batchKeyContains(key, "ccc")).toBe(true);
  });

  it("is false for an id the batch does not contain", () => {
    expect(batchKeyContains("aaa,bbb", "ccc")).toBe(false);
  });

  it("does NOT match on a substring — the trap this function exists for", () => {
    // A naive `key.includes(id)` would return true for all three.
    expect(batchKeyContains("abc-1,abc-2", "abc")).toBe(false);
    expect(batchKeyContains("note-100", "note-10")).toBe(false);
    expect(batchKeyContains("xy", "x")).toBe(false);
  });

  it("handles a single-member key", () => {
    expect(batchKeyContains("only", "only")).toBe(true);
  });

  it("is false for an empty key", () => {
    expect(batchKeyContains("", "anything")).toBe(false);
  });
});
