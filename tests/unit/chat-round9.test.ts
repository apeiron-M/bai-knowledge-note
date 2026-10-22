import { describe, expect, it } from "vitest";
import {
  offeredFields,
  prepareArgsStep,
  preparedGrammar,
} from "../../editors/knowledge-vault/chat/core/args-step.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type { CatalogEntry } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { NONE_KEY } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import type { RetrievedOp } from "../../editors/knowledge-vault/chat/core/op-retriever.js";
import {
  step1Candidates,
  step1CandidatesLabel,
} from "../../editors/knowledge-vault/chat/core/step1-candidates.js";
import {
  argsByKind,
  count,
  fieldKind,
  fullyRight,
  r9MissCause,
  r9Pick,
} from "../../spike/llm-harness/r9-metrics.js";

const catalog = buildRuntimeCatalog();
const RELAXED = ["owner", "role", "assignee"];

function entry(key: string): CatalogEntry {
  const e = catalog.find((c) => c.key === key);
  if (!e) throw new Error(`missing ${key}`);
  return e;
}

function hits(keys: string[]): RetrievedOp[] {
  return keys.map((k, i) => ({ entry: entry(k), score: 1 - i / 100 }));
}

describe("step1Candidates", () => {
  const scoped = hits([
    "tension:RESOLVE_TENSION",
    "tension:DISSOLVE_TENSION",
    "tension:ADD_INVOLVED_REF",
    "tension:CREATE_TENSION",
  ]);
  const inputs = { scopedHits: scoped, catalog, docType: "bai/tension" };

  it("takes the scoped top k, best first", () => {
    const got = step1Candidates({ mode: "scoped-topk", k: 2 }, inputs);
    expect(got.map((e) => e.key)).toEqual([
      "tension:RESOLVE_TENSION",
      "tension:DISSOLVE_TENSION",
    ]);
  });

  it("takes every scoped op by rank or in catalog order", () => {
    const rank = step1Candidates({ mode: "scoped-all", order: "rank" }, inputs);
    expect(rank.map((e) => e.key)).toEqual(scoped.map((h) => h.entry.key));
    const cat = step1Candidates(
      { mode: "scoped-all", order: "catalog" },
      inputs,
    );
    expect(cat.map((e) => e.key)).toEqual([
      "tension:CREATE_TENSION",
      "tension:RESOLVE_TENSION",
      "tension:DISSOLVE_TENSION",
      "tension:ADD_INVOLVED_REF",
    ]);
  });

  it("takes the unscoped top k", () => {
    const all = hits([
      "moc:ADD_TENSION",
      "tension:RESOLVE_TENSION",
      "wbs:SET_OWNER",
    ]);
    const got = step1Candidates(
      { mode: "unscoped-topk", k: 2 },
      { ...inputs, unscopedHits: () => all },
    );
    expect(got.map((e) => e.key)).toEqual([
      "moc:ADD_TENSION",
      "tension:RESOLVE_TENSION",
    ]);
    expect(() =>
      step1Candidates({ mode: "unscoped-topk", k: 2 }, inputs),
    ).toThrow(/unscopedHits/);
  });

  it("labels each mode", () => {
    expect(step1CandidatesLabel({ mode: "scoped-topk", k: 5 })).toBe(
      "scoped-k5",
    );
    expect(step1CandidatesLabel({ mode: "scoped-all", order: "rank" })).toBe(
      "scoped-all-rank",
    );
    expect(step1CandidatesLabel({ mode: "unscoped-topk", k: 15 })).toBe(
      "unscoped-k15",
    );
  });
});

describe("relaxed safe gate (alwaysOffer)", () => {
  it("names only root properties the op has", () => {
    const schema = prepareArgsStep(
      "x",
      entry("project:CREATE_PROJECT"),
      {},
      "none",
    ).schema;
    expect(offeredFields(schema, RELAXED)).toEqual(["owner"]);
  });

  it("keeps an unnamed owner, without requiring it", () => {
    const u = "start a project called Atlas, Dana runs it";
    const e = entry("project:CREATE_PROJECT");
    const before = prepareArgsStep(u, e, {}, "safe");
    const after = prepareArgsStep(u, e, {}, "safe", RELAXED);
    expect(before.order).toEqual(["name"]);
    expect(after.order).toEqual(["name", "owner"]);
    expect(after.schema.required).toEqual(["name"]);
    expect(after.oneOf).toEqual([]);
    // The optional field stays optional in the grammar.
    expect(preparedGrammar(after, u)).toMatch(/owner/);
  });

  it("does not force the field on an op whose other fields are optional", () => {
    const u = "Sam takes the beta goal";
    const e = entry("wbs:CREATE_GOAL");
    const after = prepareArgsStep(u, e, {}, "safe", RELAXED);
    expect(after.order).toContain("assignee");
    expect(after.schema.required).not.toContain("assignee");
    expect(after.exactlyOne).toBe(false);
  });

  it("changes nothing by default (r6.1 bytes)", () => {
    const u = "add Bob as our designer";
    const e = entry("project:ADD_MEMBER");
    expect(prepareArgsStep(u, e, {}, "safe").messages).toEqual(
      prepareArgsStep(u, e, {}, "safe", []).messages,
    );
    expect(prepareArgsStep(u, e, {}, "safe", RELAXED).order).toEqual([
      "name",
      "role",
    ]);
  });
});

describe("round 9 metrics", () => {
  const row = (over: Record<string, unknown>) => ({
    expectedOp: "wbs:SET_OWNER",
    loraPick: "wbs:SET_OWNER",
    inList: true,
    gate: { noAction: false },
    ...over,
  });

  it("applies the pre-gate only when on", () => {
    const r = row({ gate: { noAction: true } });
    expect(r9Pick(r, true)).toBe(NONE_KEY);
    expect(r9Pick(r, false)).toBe("wbs:SET_OWNER");
    expect(r9MissCause(r, true)).toBe("pre-gate no-action");
    expect(r9MissCause(r, false)).toBeNull();
  });

  it("names each miss cause in round 8's order", () => {
    expect(r9MissCause(row({ loraPick: NONE_KEY, inList: false }), false)).toBe(
      "LoRA chose no-action",
    );
    expect(r9MissCause(row({ loraPick: null }), false)).toBe("no parse");
    expect(
      r9MissCause(row({ loraPick: "wbs:ASSIGN_GOAL", inList: false }), false),
    ).toBe("gold not in list");
    expect(r9MissCause(row({ loraPick: "project:SET_OWNER" }), false)).toBe(
      "other model's op",
    );
    expect(r9MissCause(row({ loraPick: "wbs:ASSIGN_GOAL" }), false)).toBe(
      "sibling in list",
    );
  });

  it("is fully right only with the right op and no scored miss", () => {
    expect(fullyRight(row({}), true)).toBe(true);
    expect(fullyRight(row({ exact: false }), true)).toBe(false);
    expect(fullyRight(row({ exact: true, refExact: false }), true)).toBe(false);
    expect(fullyRight(row({ gate: { noAction: true } }), true)).toBe(false);
  });

  it("counts, most frequent first", () => {
    expect(count(["a", "b", "b"])).toEqual({ b: 2, a: 1 });
  });
});

describe("round 10 args by kind", () => {
  const schema = {
    type: "object",
    properties: {
      status: { anyOf: [{ type: "string", enum: ["A", "B"] }, { type: "null" }] },
      items: { type: "array", items: { type: "string" } },
      note: { type: "string" },
      n: { type: "number" },
      handoff: { type: "object", properties: { phase: { enum: ["x"] } } },
    },
  };

  it("classifies paths, through anyOf and nesting", () => {
    expect(fieldKind(schema, "status")).toBe("enum");
    expect(fieldKind(schema, "items")).toBe("list");
    expect(fieldKind(schema, "note")).toBe("span");
    expect(fieldKind(schema, "n")).toBe("other");
    expect(fieldKind(schema, "handoff.phase")).toBe("enum");
    expect(fieldKind(schema, "missing")).toBe("other");
  });

  it("scores fields and items per kind", () => {
    const rows = [
      { argKinds: { note: "span", items: "list" }, mismatched: ["items"] },
      { argKinds: { note: "span", status: "enum" }, mismatched: [] },
      { mismatched: ["note"] },
    ];
    const s = argsByKind(rows);
    expect(s.span).toEqual({ fields: "2/2", items: "2/2" });
    expect(s.list).toEqual({ fields: "0/1", items: "0/1" });
    expect(s.enum).toEqual({ fields: "1/1", items: "1/1" });
    expect(s.other).toEqual({ fields: "0/0", items: "0/0" });
  });
});
