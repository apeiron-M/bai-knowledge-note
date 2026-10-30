import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  argsGrammar,
  gateOptional,
  labelRefCandidates,
  mapRefLabels,
  refEnumValues,
  requireOneOf,
} from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import {
  argsMessages,
  fillArgsStep,
  prefixLogprobs,
  refPrefix,
  scoredEnumField,
  scoredRefField,
} from "../../editors/knowledge-vault/chat/core/args-step.js";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type {
  CompleteJson,
  ScoreText,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";
import { buildModelSchema } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import {
  answerText,
  CONTENT_FREE,
  forcedOpsText,
  NONE_KEY,
  optionLabels,
  scoreOptions,
  scoringMessages,
  STEP1_SYSTEM,
  toOptions,
  type ScoreCache,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { VOCABULARIES } from "../../editors/knowledge-vault/chat/core/vocabularies.js";
import { accepts } from "./gbnf-recognizer.js";

const catalog = buildVaultCatalog({ vocabularies: VOCABULARIES });
const entry = (key: string) => {
  const e = catalog.find((c) => c.key === key);
  if (!e) throw new Error(key);
  return e;
};

const fakeResult = (text: string, lp: number) => ({
  text,
  tokens: [{ token: text, logprob: lp, bytes: null, top_logprobs: [] }],
  finishReason: "stop",
  wallMs: 5,
});

describe("step-1 ops format", () => {
  it("renders compact ops lists, empty for no action", () => {
    expect(forcedOpsText([])).toBe('{"ops": []}');
    expect(forcedOpsText(["ADD_TOPIC"])).toBe('{"ops": ["ADD_TOPIC"]}');
    expect(answerText(null, "ops")).toBe('{"ops": []}');
    expect(answerText(null, "op")).toBe(`{"op": "${NONE_KEY}"}`);
    expect(answerText("x", "op")).toBe('{"op": "x"}');
  });

  it("uses bare op names and keys only for clashes", () => {
    const cands = [
      entry("project:SET_OWNER"),
      entry("wbs:SET_OWNER"),
      entry("wbs:ADD_NOTE"),
    ];
    expect(optionLabels(cands, "op")).toEqual([
      "project:SET_OWNER",
      "wbs:SET_OWNER",
      "ADD_NOTE",
    ]);
  });

  it("states the empty list in the ops system prompt", () => {
    const m = scoringMessages(
      "x",
      toOptions([entry("wbs:ADD_NOTE")], "op"),
      "ops",
    );
    expect(m[0].content).toBe(STEP1_SYSTEM.ops);
    expect(m[0].content).toContain('{"ops": []}');
    expect(m[1].content).toMatch(/^Operations:\n- ADD_NOTE: /);
    expect(m[1].content.endsWith("\n\nRequest: x")).toBe(true);
  });

  it("caches content-free scores across utterances and scores none unlisted", async () => {
    const calls: string[] = [];
    const scoreText: ScoreText = (messages, grammar) => {
      calls.push(`${messages[1].content.split("Request: ")[1]}|${grammar}`);
      return Promise.resolve(fakeResult("x", -1));
    };
    const cands = [entry("wbs:ADD_NOTE"), entry("wbs:DELETE_GOAL")];
    const cache: ScoreCache = new Map();
    const opts = {
      scoreText,
      style: "op" as const,
      offsets: [0],
      contentFree: true,
      includeNone: true,
      format: "ops" as const,
      cache,
    };
    const a = await scoreOptions("one", cands, opts);
    expect(a.map((r) => r.key)).toEqual([
      "wbs:ADD_NOTE",
      "wbs:DELETE_GOAL",
      NONE_KEY,
      "wbs:ADD_NOTE",
      "wbs:DELETE_GOAL",
      NONE_KEY,
    ]);
    expect(a.every((r) => !r.cached)).toBe(true);
    expect(calls).toHaveLength(6);
    const b = await scoreOptions("two", cands, opts);
    expect(calls).toHaveLength(9);
    const cf = b.filter((r) => r.contentFree);
    expect(
      cf.every((r) => r.cached && r.wallMs === 0 && r.computeMs === 5),
    ).toBe(true);
    expect(calls.filter((c) => c.startsWith(`${CONTENT_FREE}|`))).toHaveLength(
      3,
    );
    // The none answer is not a listed option.
    expect(
      scoringMessages("x", toOptions(cands, "op"), "ops")[1].content,
    ).not.toContain("- none");
  });
});

describe("vocabularies", () => {
  it("narrows reducer vocabularies to enums in the model schema", () => {
    const props = entry("knowledge-note:SET_METADATA_FIELD").modelSchema
      .properties as Record<string, { enum?: string[] }>;
    expect(props.field.enum).toContain("rootCause");
    const depth = entry("vault-config:UPDATE_PIPELINE_CONFIG").modelSchema
      .properties as Record<string, { anyOf?: { enum?: string[] }[] }>;
    expect(depth.depth.anyOf?.[0].enum).toEqual(["quick", "standard", "deep"]);
    expect(depth.depth.anyOf?.[1]).toEqual({ type: "null" });
    const phase = entry("pipeline-queue:ADVANCE_PHASE").modelSchema
      .properties as Record<string, { properties: Record<string, unknown> }>;
    expect(phase.handoff.properties.phase).toEqual({
      type: "string",
      enum: ["create", "enrich", "reflect", "reweave", "verify"],
    });
  });

  it("keeps the vocabulary when the schema is rebuilt with refs", () => {
    const s = buildModelSchema(entry("vault-config:UPDATE_VOCABULARY"));
    const p = s.properties as Record<string, { enum?: string[] }>;
    expect(p.key.enum).toContain("topicMap");
    const g = argsGrammar(s, "call the inbox capture", { spans: true });
    expect(accepts(g, '{"key": "inbox", "value": "capture"}')).toBe(true);
    expect(accepts(g, '{"key": "capture", "value": "inbox"}')).toBe(false);
  });

  it("names a source for every vocabulary and each key resolves to a field", () => {
    // The sources are the comment line above each entry in chat.overrides.ts.
    const overrides = readFileSync(
      new URL("../../chat.overrides.ts", import.meta.url),
      "utf8",
    ).split("\n");
    for (const k of Object.keys(VOCABULARIES)) {
      const at = overrides.findIndex((l) => l.trim().startsWith(`"${k}":`));
      expect(at, k).toBeGreaterThan(0);
      expect(overrides[at - 1].trim(), k).toMatch(/^\/\/ .{10,}/);
      const [model, op] = k.split(":");
      expect(catalog.some((c) => c.key === `${model}:${op}`)).toBe(true);
    }
  });

  it("leaves catalogs built without vocabularies unchanged", () => {
    const plain = buildVaultCatalog().find(
      (c) => c.key === "knowledge-note:SET_METADATA_FIELD",
    );
    const p = plain?.modelSchema.properties as Record<string, unknown>;
    expect(p.field).toEqual({ type: "string" });
  });
});

describe("safe gate and at-least-one", () => {
  it("never empties an all-optional op", () => {
    const info = entry("project:UPDATE_PROJECT_INFO").modelSchema;
    expect(
      Object.keys(
        gateOptional(info, "call it Atlas", "all").properties as object,
      ),
    ).toEqual([]);
    expect(
      Object.keys(
        gateOptional(info, "call it Atlas", "safe").properties as object,
      ),
    ).toEqual(["name", "description"]);
    // A mentioned field still gates the others away.
    expect(
      Object.keys(
        gateOptional(info, "rename it, name Atlas", "safe")
          .properties as object,
      ),
    ).toEqual(["name"]);
  });

  it("restores optional fields beside a kept ref field", () => {
    const refs = labelRefCandidates({ id: [{ id: "g-1", label: "Beta" }] });
    const schema = buildModelSchema(entry("wbs:ASSIGN_GOAL"), {
      refCandidates: refEnumValues(refs),
    });
    const g = gateOptional(
      schema,
      "give Beta to Priya",
      "safe",
      new Set(["id"]),
    );
    expect(Object.keys(g.properties as object)).toEqual(["id", "assignee"]);
    expect(requireOneOf(g, ["id"])).toEqual(["assignee"]);
    const gr = argsGrammar(g, "give Beta to Priya", {
      spans: true,
      first: ["id"],
      requireOneOf: ["assignee"],
    });
    expect(accepts(gr, '{"id": "Beta", "assignee": "Priya"}')).toBe(true);
    expect(accepts(gr, '{"id": "Beta"}')).toBe(false);
  });

  it("never forces an annotation such as a lifecycle comment", () => {
    const s = entry("knowledge-note:SUBMIT_FOR_REVIEW").modelSchema;
    expect(
      Object.keys(
        gateOptional(s, "send it to review", "safe").properties as object,
      ),
    ).toEqual([]);
    expect(requireOneOf(s, [])).toEqual([]);
  });

  it("can require exactly one of the fields", () => {
    const info = entry("project:UPDATE_PROJECT_INFO").modelSchema;
    const g = argsGrammar(info, "call it Atlas", {
      spans: true,
      requireOneOf: ["name", "description"],
      exactlyOne: true,
    });
    expect(accepts(g, '{"name": "Atlas"}')).toBe(true);
    expect(accepts(g, '{"description": "Atlas"}')).toBe(true);
    expect(accepts(g, '{"name": "Atlas", "description": "it"}')).toBe(false);
    expect(accepts(g, "{}")).toBe(false);
  });

  it("asks for nothing extra when a semantic field is required", () => {
    const s = entry("wbs:SET_GOAL_STATUS").modelSchema;
    expect(requireOneOf(s, [])).toEqual([]);
    expect(gateOptional(s, "done", "safe").required).toEqual(["status"]);
  });

  it("orders first fields and enforces one of several optional fields", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "integer" },
        r: { type: "string", enum: ["R"] },
        b: { type: "integer" },
        c: { type: "integer" },
      },
      required: ["r"],
    };
    const g = argsGrammar(schema, "x", {
      spans: false,
      first: ["r"],
      requireOneOf: ["b", "c"],
    });
    expect(accepts(g, '{"r": "R", "b": 1}')).toBe(true);
    expect(accepts(g, '{"r": "R", "c": 1}')).toBe(true);
    expect(accepts(g, '{"r": "R", "b": 1, "c": 2, "a": 3}')).toBe(true);
    expect(accepts(g, '{"r": "R", "a": 3}')).toBe(false);
    expect(accepts(g, '{"r": "R"}')).toBe(false);
    expect(accepts(g, '{"b": 1, "r": "R"}')).toBe(false);
    const none = argsGrammar(
      { type: "object", properties: {}, required: [] },
      "x",
      { spans: false },
    );
    expect(accepts(none, "{}")).toBe(true);
  });
});

describe("labeled refs", () => {
  it("suffixes duplicate labels and falls back to ids", () => {
    const l = labelRefCandidates({
      id: [
        { id: "a", label: "Same" },
        { id: "b", label: "Same" },
        { id: "c" },
        { id: "d", label: " " },
      ],
    });
    expect(l.id.map((c) => c.label)).toEqual(["Same", "Same (2)", "c", "d"]);
    expect(mapRefLabels({ id: "Same (2)" }, l)).toEqual({ id: "b" });
    const clash = labelRefCandidates({
      x: [
        { id: "1", label: "A (2)" },
        { id: "2", label: "A" },
        { id: "3", label: "A" },
      ],
    });
    expect(new Set(clash.x.map((c) => c.label)).size).toBe(3);
  });

  it("lists choices and renders ref fields as choice", () => {
    const refs = labelRefCandidates({
      id: [
        { id: "t-1", label: "ml" },
        { id: "t-2", label: "dist sys" },
      ],
    });
    const e = entry("knowledge-note:REMOVE_TOPIC");
    const schema = buildModelSchema(e, { refCandidates: refEnumValues(refs) });
    const m = argsMessages("drop ml", e, schema, { id: ["ml", "dist sys"] });
    expect(m[1].content).toBe(
      `Operation: REMOVE_TOPIC - ${e.description}\nChoices for id: "ml", "dist sys"\nArguments: {"id": choice}\nRequest: drop ml`,
    );
    expect(scoredRefField(schema, ["id"])).toBe("id");
    expect(scoredRefField(schema, [])).toBeNull();
  });

  it("finds the first required enum with three or more values", () => {
    expect(
      scoredEnumField(
        entry("vault-config:UPDATE_MAINTENANCE_THRESHOLD").modelSchema,
      )?.field,
    ).toBe("condition");
    expect(
      scoredEnumField(entry("wbs:SET_GOAL_STATUS").modelSchema)?.values,
    ).toContain("WONT_DO");
    expect(scoredEnumField(entry("project:ADD_MEMBER").modelSchema)).toBeNull();
  });

  it("sums only the tokens covering the prefix", () => {
    const p = refPrefix("id", "ml");
    expect(p).toBe('{"id": "ml"');
    const toks = [
      { token: '{"', logprob: -1 },
      { token: 'id": "', logprob: -2 },
      { token: "ml", logprob: -3 },
      { token: '"}', logprob: -4 },
      { token: "", logprob: -5 },
    ];
    expect(prefixLogprobs(toks, p)).toEqual([-1, -2, -3, -4]);
  });

  it("picks the calibrated label and fixes it in the args grammar", async () => {
    const refs = {
      id: [
        { id: "t-1", label: "ml" },
        { id: "t-2", label: "dist sys" },
      ],
    };
    // Under the request "dist sys" wins raw; but it is also the prior
    // favourite, so calibration picks "ml".
    const lp: Record<string, number> = { ml: -2, "dist sys": -1 };
    const prior: Record<string, number> = { ml: -4, "dist sys": -1 };
    const scoreText: ScoreText = (messages, grammar) => {
      const cf = messages[1].content.endsWith(`Request: ${CONTENT_FREE}`);
      const label = /\\"id\\": \\"(.*)\\""/.exec(grammar)?.[1] ?? "";
      const text = `${refPrefix("id", label)}}`;
      return Promise.resolve(fakeResult(text, (cf ? prior : lp)[label]));
    };
    let seenGrammar = "";
    const completeJson: CompleteJson = (_m, c) => {
      seenGrammar = c.kind === "grammar" ? c.grammar : "";
      return Promise.resolve({
        text: '{"id": "ml"}',
        parsed: { id: "ml" },
        chunks: 1,
        finishReason: "stop",
        timingsOnLastChunk: false,
        wallMs: 7,
      });
    };
    const cache: ScoreCache = new Map();
    const r = await fillArgsStep(
      "remove the topic",
      entry("knowledge-note:REMOVE_TOPIC"),
      refs,
      { completeJson, scoreText, gate: "safe", scoreRefs: true, cache },
    );
    expect(r.refField).toBe("id");
    expect(r.refScores).toEqual({ ml: 2, "dist sys": 0 });
    expect(r.args).toEqual({ id: "t-1" });
    expect(accepts(seenGrammar, '{"id": "ml"}')).toBe(true);
    expect(accepts(seenGrammar, '{"id": "dist sys"}')).toBe(false);
    expect(r.refMs).toBe(10);
    expect(r.refCfMs).toBe(10);
    const again = await fillArgsStep(
      "drop it",
      entry("knowledge-note:REMOVE_TOPIC"),
      refs,
      { completeJson, scoreText, gate: "safe", scoreRefs: true, cache },
    );
    expect(again.refCfMs).toBe(0);
  });

  it("returns empty args when the op has nothing to fill", async () => {
    const never = () => Promise.reject(new Error("no call"));
    const r = await fillArgsStep(
      "x",
      entry("knowledge-note:REMOVE_TOPIC"),
      {},
      {
        completeJson: never,
        scoreText: never,
        gate: "safe",
        scoreRefs: true,
      },
    );
    expect(r.args).toEqual({});
  });
});
