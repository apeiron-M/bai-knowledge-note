import { describe, expect, it } from "vitest";
import {
  argsGrammar,
  gateOptional,
  mapRefLabels,
  mentionsField,
  refEnumValues,
  spanRules,
  wordForms,
} from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildModelSchema } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { accepts } from "./gbnf-recognizer.js";

const catalog = buildVaultCatalog();
const entry = (key: string) => {
  const e = catalog.find((c) => c.key === key);
  if (!e) throw new Error(key);
  return e;
};

const spanOnly = (u: string) =>
  ["root ::= span", ...spanRules("span", u)].join("\n");

describe("copy-span grammar", () => {
  const g = spanOnly("tag this note with distributed systems");

  it("accepts every contiguous span", () => {
    expect(accepts(g, '"distributed systems"')).toBe(true);
    expect(accepts(g, '"tag"')).toBe(true);
    expect(accepts(g, '"tag this note with distributed systems"')).toBe(true);
    expect(accepts(g, '"note with"')).toBe(true);
  });

  it("rejects paraphrase, recasing, gaps and empty", () => {
    expect(accepts(g, '"distributed_systems"')).toBe(false);
    expect(accepts(g, '"Distributed Systems"')).toBe(false);
    expect(accepts(g, '"tag distributed"')).toBe(false);
    expect(accepts(g, '""')).toBe(false);
    expect(accepts(g, '"systems distributed"')).toBe(false);
  });

  it("strips quotes and trailing punctuation only at span edges", () => {
    const q = spanOnly('rename this to "Retrieval beats fine-tuning."');
    expect(accepts(q, '"Retrieval beats fine-tuning"')).toBe(true);
    expect(accepts(q, '"Retrieval beats fine-tuning."')).toBe(true);
    expect(accepts(q, '"\\"Retrieval beats"')).toBe(true);
    expect(accepts(q, '"Retrieval"')).toBe(true);
    const c = spanOnly("set it to a, b and c");
    expect(accepts(c, '"a"')).toBe(true);
    expect(accepts(c, '"a b"')).toBe(false);
    expect(accepts(c, '"a, b"')).toBe(true);
  });

  it("handles single-word and empty utterances", () => {
    expect(accepts(spanOnly("hello"), '"hello"')).toBe(true);
    expect(accepts(spanOnly(""), '""')).toBe(true);
  });

  it("lists word forms without empties", () => {
    expect(wordForms('"')).toEqual({
      full: '"',
      start: ['"'],
      end: ['"'],
      single: ['"'],
    });
    expect(wordForms("(x).").single).toEqual([
      "(x).",
      "(x)",
      "(x",
      "x).",
      "x)",
      "x",
    ]);
    // X6: a closing bracket before a quote survives the quote's removal.
    expect(wordForms('(Mostly)"').end).toEqual([
      '(Mostly)"',
      "(Mostly)",
      "(Mostly",
    ]);
    expect(wordForms('ok."').end).toEqual(['ok."', "ok.", "ok"]);
  });
});

describe("optional-field gating", () => {
  const addMember = entry("project:ADD_MEMBER").modelSchema;

  it("drops unmentioned enum fields in closed mode", () => {
    const g = gateOptional(addMember, "add Alice as designer", "closed");
    expect(Object.keys(g.properties as object)).toEqual(["name", "role"]);
    const k = gateOptional(addMember, "add Alice, she is an agent", "closed");
    expect(Object.keys(k.properties as object)).toContain("kind");
  });

  it("drops every unmentioned optional field in all mode", () => {
    const g = gateOptional(addMember, "add Alice as designer", "all");
    expect(Object.keys(g.properties as object)).toEqual(["name"]);
    const r = gateOptional(addMember, "add Alice with role designer", "all");
    expect(Object.keys(r.properties as object)).toEqual(["name", "role"]);
    expect(gateOptional(addMember, "x", "none")).toEqual(addMember);
  });

  it("never drops kept paths or required fields", () => {
    const g = gateOptional(addMember, "x", "all", new Set(["role"]));
    expect(Object.keys(g.properties as object)).toEqual(["name", "role"]);
    expect(g.required).toEqual(["name"]);
  });

  it("matches stemmed name tokens and whole enum values", () => {
    expect(mentionsField("blockReason", {}, "blocked on review")).toBe(true);
    const status = { type: "string", enum: ["ON_HOLD", "ACTIVE"] };
    expect(mentionsField("state", status, "put it on hold")).toBe(true);
    expect(mentionsField("state", status, "make it active")).toBe(true);
    expect(mentionsField("state", status, "put it on ice")).toBe(false);
  });

  it("recurses into nested objects", () => {
    const g = gateOptional(
      entry("pipeline-queue:ADVANCE_PHASE").modelSchema,
      "advance it",
      "all",
    );
    expect(Object.keys(g.properties as object)).toEqual(["handoff"]);
  });
});

describe("args grammar", () => {
  it("constrains strings to spans and keeps enums", () => {
    const schema = entry("project:ADD_MEMBER").modelSchema;
    const g = argsGrammar(schema, "add Alice to the team as designer", {
      spans: true,
    });
    expect(accepts(g, '{"name": "Alice"}')).toBe(true);
    expect(accepts(g, '{"name": "Alice", "role": "designer"}')).toBe(true);
    expect(accepts(g, '{"name": "Alice", "kind": "HUMAN"}')).toBe(true);
    expect(accepts(g, '{"name": "Bob"}')).toBe(false);
    expect(accepts(g, '{"name": "Alice", "kind": "ROBOT"}')).toBe(false);
    expect(accepts(g, '{"role": "designer"}')).toBe(false);
    expect(accepts(g, '{"name": "Alice", "role": null}')).toBe(false);
    const free = argsGrammar(schema, "add Alice", { spans: false });
    expect(accepts(free, '{"name": "Bob"}')).toBe(true);
  });

  it("needs one member when nothing is required", () => {
    const schema = entry("project:UPDATE_PROJECT_INFO").modelSchema;
    const g = argsGrammar(schema, "rename it to Atlas", { spans: true });
    expect(accepts(g, '{"name": "Atlas"}')).toBe(true);
    expect(accepts(g, '{"description": "Atlas"}')).toBe(true);
    expect(accepts(g, '{"name": "Atlas", "description": "it"}')).toBe(true);
    expect(accepts(g, "{}")).toBe(false);
    expect(accepts(g, '{"description": "it", "name": "Atlas"}')).toBe(false);
  });

  it("emits numbers, booleans, arrays, nested objects and dates", () => {
    const stats = entry("source:RECORD_EXTRACTION_STATS").modelSchema;
    const g = argsGrammar(stats, "x", { spans: true });
    expect(
      accepts(g, '{"claimCount": 12, "skippedCount": 3, "skipRate": 0.2}'),
    ).toBe(true);
    expect(
      accepts(g, '{"claimCount": "12", "skippedCount": 3, "skipRate": 0.2}'),
    ).toBe(false);
    const tog = argsGrammar(
      entry("vault-config:TOGGLE_EXTRACTION_CATEGORY").modelSchema,
      "x",
      { spans: true },
    );
    expect(accepts(tog, '{"active": false}')).toBe(true);
    const adv = argsGrammar(
      entry("pipeline-queue:ADVANCE_PHASE").modelSchema,
      "moved to reflect after editing a.md and b.md",
      { spans: true },
    );
    expect(
      accepts(
        adv,
        '{"handoff": {"phase": "reflect", "workDone": "editing", "filesModified": ["a.md", "b.md"]}}',
      ),
    ).toBe(true);
    expect(
      accepts(
        adv,
        '{"handoff": {"phase": "reflect", "workDone": "editing", "filesModified": []}}',
      ),
    ).toBe(true);
    const date = argsGrammar(
      entry("project:SET_TARGET_DATE").modelSchema,
      "due December 15",
      { spans: true },
    );
    expect(accepts(date, '{"targetDate": "2026-12-15T00:00:00Z"}')).toBe(true);
    expect(accepts(date, '{"targetDate": "December 15"}')).toBe(false);
  });

  it("uses ref labels as an enum and maps them back to ids", () => {
    const refs = {
      targetDocumentId: [
        { id: "doc-a", label: "Grammar decoding" },
        { id: "doc-b", label: "KV cache" },
      ],
    };
    const e = entry("knowledge-note:ADD_LINK");
    const schema = buildModelSchema(e, { refCandidates: refEnumValues(refs) });
    const g = argsGrammar(schema, "link to the KV cache note", {
      spans: true,
    });
    expect(
      accepts(g, '{"targetDocumentId": "KV cache", "linkType": "BUILDS_ON"}'),
    ).toBe(true);
    expect(
      accepts(g, '{"targetDocumentId": "doc-b", "linkType": "BUILDS_ON"}'),
    ).toBe(false);
    expect(
      mapRefLabels({ targetDocumentId: "KV cache", linkType: "X" }, refs),
    ).toEqual({ targetDocumentId: "doc-b", linkType: "X" });
  });

  it("falls back to ids for duplicate labels and maps nested and list paths", () => {
    const refs = {
      ids: [
        { id: "a", label: "same" },
        { id: "b", label: "same" },
      ],
      "x.y": [{ id: "c", label: "C" }],
    };
    expect(refEnumValues(refs)).toEqual({ ids: ["a", "b"], "x.y": ["C"] });
    expect(mapRefLabels({ ids: ["a"], x: { y: "C" } }, refs)).toEqual({
      ids: ["a"],
      x: { y: "c" },
    });
    expect(mapRefLabels({ other: 1 }, refs)).toEqual({ other: 1 });
  });
});
