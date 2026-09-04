import {
  addAgent,
  editAgent,
  removeAgent,
  utils,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import { apply, errorAt, errors, state } from "./reducer-test-helpers.js";

describe("contributors reducer", () => {
  it("adds agents with and without optional fields", () => {
    const doc = apply(
      utils.createDocument(),
      addAgent({
        id: "a1",
        name: "Alice",
        icon: "https://example.com/alice.png",
        description: "Lead",
      }),
      addAgent({ id: "a2", name: "Bob" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).contributors).toStrictEqual([
      {
        id: "a1",
        name: "Alice",
        icon: "https://example.com/alice.png",
        description: "Lead",
      },
      { id: "a2", name: "Bob", icon: null, description: null },
    ]);
  });

  it("rejects a duplicate agent id and leaves the original untouched", () => {
    const doc = apply(
      utils.createDocument(),
      addAgent({ id: "a1", name: "Alice" }),
      addAgent({ id: "a1", name: "Impostor" }),
    );

    expect(errorAt(doc, 1)).toBe("Agent with ID a1 already exists");
    expect(state(doc).contributors).toHaveLength(1);
    expect(state(doc).contributors[0].name).toBe("Alice");
  });

  it("edits only the provided fields and accepts explicit nulls", () => {
    const doc = apply(
      utils.createDocument(),
      addAgent({
        id: "a1",
        name: "Alice",
        icon: "https://example.com/a.png",
        description: "Lead",
      }),
      editAgent({
        id: "a1",
        name: "Alicia",
        icon: "https://example.com/b.png",
        description: "Principal",
      }),
      editAgent({ id: "a1" }),
      editAgent({ id: "a1", icon: null, description: null }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).contributors[0]).toStrictEqual({
      id: "a1",
      name: "Alicia",
      icon: null,
      description: null,
    });
  });

  it("records AgentNotFoundError when editing or removing an unknown agent", () => {
    const doc = apply(
      utils.createDocument(),
      editAgent({ id: "ghost", name: "x" }),
      removeAgent({ id: "ghost" }),
    );

    expect(errorAt(doc, 0)).toBe("Agent with ID ghost not found");
    expect(errorAt(doc, 1)).toBe("Agent with ID ghost not found");
    expect(state(doc).contributors).toStrictEqual([]);
  });

  it("removes an existing agent and keeps the others", () => {
    const doc = apply(
      utils.createDocument(),
      addAgent({ id: "a1", name: "A" }),
      addAgent({ id: "a2", name: "B" }),
      removeAgent({ id: "a1" }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc).contributors.map((a) => a.id)).toStrictEqual(["a2"]);
  });
});
