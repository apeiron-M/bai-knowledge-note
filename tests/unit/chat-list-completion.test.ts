import { describe, expect, it } from "vitest";
import { prepareArgsStep } from "../../editors/knowledge-vault/chat/core/args-step.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import {
  addsToList,
  completeLists,
} from "../../editors/knowledge-vault/chat/core/list-completion.js";
import {
  currentListsFor,
  refCandidatesFor,
} from "../../editors/knowledge-vault/chat/core/ref-candidates.js";

describe("completeLists", () => {
  const order = { mode: "order" as const, values: ["a", "b", "c", "d"] };

  it("appends the items a reorder left out, in their current order", () => {
    const r = completeLists(
      { ids: ["b", "a", "b"] },
      { ids: order },
      "b first",
    );
    expect(r.args.ids).toEqual(["b", "a", "c", "d"]);
    expect(r.changed).toEqual(["ids"]);
  });

  it("leaves a full reorder alone", () => {
    const r = completeLists({ ids: ["d", "c", "b", "a"] }, { ids: order }, "x");
    expect(r.args.ids).toEqual(["d", "c", "b", "a"]);
    expect(r.changed).toEqual([]);
  });

  const keep = { mode: "keep" as const, values: ["https://a.example"] };
  it("keeps the current entries when the request adds to the list", () => {
    const r = completeLists(
      { references: ["https://b.example"] },
      { references: keep },
      "also cite https://b.example alongside the plan",
    );
    expect(r.args.references).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("replaces the list when the request swaps it", () => {
    const r = completeLists(
      { references: ["https://b.example"] },
      { references: keep },
      "swap the brief's address for https://b.example",
    );
    expect(r.args.references).toEqual(["https://b.example"]);
    expect(r.changed).toEqual([]);
  });
});

describe("addsToList", () => {
  it("reads additive and replacing cues", () => {
    expect(
      addsToList("belongs in the web sources too; don't lose the plan"),
    ).toBe(true);
    expect(addsToList("update the references to just https://x.example")).toBe(
      false,
    );
    expect(addsToList("set the references to https://x.example")).toBe(false);
    expect(addsToList("also add it, don't drop the old one")).toBe(true);
    expect(addsToList("set it to https://x.example/add/also-this")).toBe(false);
  });
});

describe("state-derived candidates and lists", () => {
  it("offers a map's open questions and child maps as choices", () => {
    const state = {
      openQuestions: ["Is a 48h retard worth it?"],
      childRefs: ["moc/rye"],
    };
    const ctx = [{ id: "moc/rye", title: "Rye baking", kind: "moc" }];
    expect(refCandidatesFor("moc:REMOVE_OPEN_QUESTION", state, ctx)).toEqual({
      question: [
        { id: "Is a 48h retard worth it?", label: "Is a 48h retard worth it?" },
      ],
    });
    expect(refCandidatesFor("moc:REMOVE_CHILD_MOC", state, ctx)).toEqual({
      childRef: [{ id: "moc/rye", label: "Rye baking" }],
    });
  });

  it("offers nothing for an empty list (the field stays a free span)", () => {
    expect(refCandidatesFor("moc:REMOVE_OPEN_QUESTION", {}, [])).toEqual({});
  });

  it("lists the current order and references", () => {
    expect(
      currentListsFor("moc:REORDER_CORE_IDEAS", {
        coreIdeas: [{ id: "ci-1" }, { id: "ci-2" }],
      }),
    ).toEqual({ ids: { mode: "order", values: ["ci-1", "ci-2"] } });
    expect(
      currentListsFor("project:SET_REFERENCES", { references: [] }),
    ).toEqual({});
  });
});

describe("step 2 with state choices", () => {
  const entry = buildRuntimeCatalog().find(
    (e) => e.key === "moc:REMOVE_OPEN_QUESTION",
  );
  it("renders a semantic field with candidates as a choice", () => {
    if (!entry) throw new Error("no entry");
    const q = "Is a 48h retard worth it?";
    const p = prepareArgsStep(
      "drop the cold retard question",
      entry,
      {
        question: [{ id: q, label: q }],
      },
      "safe",
    );
    expect(p.messages?.[1].content).toContain(`Choices for question: "${q}"`);
    expect(p.ordered.properties).toEqual({
      question: { type: "string", enum: [q] },
    });
    const free = prepareArgsStep(
      "drop the cold retard question",
      entry,
      {},
      "safe",
    );
    expect(free.ordered.properties).toEqual({ question: { type: "string" } });
  });
});
