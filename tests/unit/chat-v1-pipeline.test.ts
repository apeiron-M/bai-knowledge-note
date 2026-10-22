import { describe, expect, it } from "vitest";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type {
  CompleteJson,
  ScoreText,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  createOpEmbeddingIndex,
  decodeVectors,
  loadOpEmbeddingAsset,
} from "../../editors/knowledge-vault/chat/core/op-embedding-index.js";
import { NONE_KEY } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import {
  step1Candidates,
  step1Pick,
  V1_STEP1,
} from "../../editors/knowledge-vault/chat/core/step1-candidates.js";
import {
  runV1,
  v1Action,
  V1_DEFAULT_STEP1,
  V1_EMBEDDING_TOP1,
  v1NeedsEmbedding,
  v1Step1Label,
  type V1Deps,
} from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import type { WllamaChatMessage } from "../../editors/knowledge-vault/chat/core/wllama-types.js";
import {
  scopedCandidates,
  step1Prompt,
} from "../../training/gen/prompt-format.js";

const catalog = buildRuntimeCatalog();
const NOTE = "bai/knowledge-note";

/** An index over the committed asset and a query embedder that returns `key`'s own vector. */
async function runtimeFor(key: string): Promise<V1Deps["runtime"]> {
  const asset = await loadOpEmbeddingAsset();
  const v = decodeVectors(asset.ops.vectors, asset.dims)[
    asset.ops.keys.indexOf(key)
  ];
  return {
    catalog,
    index: createOpEmbeddingIndex(catalog, asset),
    embedQuery: () => Promise.resolve(v),
  };
}

const never = () => Promise.reject(new Error("no model call expected"));

describe("v1 pipeline, round 6/7 option (embedding-top1)", () => {
  it("answers a question without any model call", async () => {
    const r = await runV1("what does this note say?", NOTE, () => ({}), {
      runtime: await runtimeFor("knowledge-note:SET_TITLE"),
      completeJson: never,
      scoreText: never,
    }, { step1: V1_EMBEDDING_TOP1 });
    expect(r.kind).toBe("no-action");
    expect(r.gate?.question).toBe(true);
    expect(r.promptFormat).toBe("r6.1");
  });

  it("takes the embedding's top op and maps the ref label to its id", async () => {
    const scoreText: ScoreText = (_m, grammar) => {
      const label = /\\"id\\": \\"(.*)\\""/.exec(grammar)?.[1] ?? "";
      return Promise.resolve({
        text: `{"id": "${label}"}`,
        tokens: [
          {
            token: `{"id": "${label}"`,
            logprob: -1,
            bytes: null,
            top_logprobs: [],
          },
        ],
        finishReason: "stop",
        wallMs: 1,
      });
    };
    let prompt = "";
    const completeJson: CompleteJson = (m) => {
      prompt = m[1].content;
      return Promise.resolve({
        text: '{"id": "machine learning"}',
        parsed: { id: "machine learning" },
        chunks: 1,
        finishReason: "stop",
        timingsOnLastChunk: false,
        wallMs: 2,
      });
    };
    const refs = {
      id: [
        { id: "t-1", label: "distributed systems" },
        { id: "t-2", label: "machine learning" },
      ],
    };
    const r = await runV1(
      "drop the machine learning tag",
      NOTE,
      (e) => (e.opName === "REMOVE_TOPIC" ? refs : {}),
      {
        runtime: await runtimeFor("knowledge-note:REMOVE_TOPIC"),
        completeJson,
        scoreText,
      },
      { step1: V1_EMBEDDING_TOP1 },
    );
    if (r.kind !== "action") throw new Error("expected an action");
    expect(r.entry.key).toBe("knowledge-note:REMOVE_TOPIC");
    expect(r.hits.every((h) => h.entry.docType === NOTE)).toBe(true);
    expect(prompt).toContain(
      'Choices for id: "distributed systems", "machine learning"',
    );
    expect(r.step2.args).toEqual({ id: "t-2" });
    const built = v1Action(r, {
      generateId: () => "x",
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(built.ok).toBe(true);
  });
});

/** A step-1 / step-2 fake: answers step 1 with `pick`, step 2 with `args`. */
function fakeModel(pick: string | null, args: Record<string, unknown>) {
  const calls: { messages: WllamaChatMessage[]; grammar: string }[] = [];
  const completeJson: CompleteJson = (messages, constraint) => {
    const grammar = constraint.kind === "grammar" ? constraint.grammar : "";
    calls.push({ messages, grammar });
    const step1 = calls.length === 1;
    const parsed = step1 ? { ops: pick ? [pick] : [] } : args;
    return Promise.resolve({
      text: JSON.stringify(parsed),
      parsed,
      chunks: 1,
      finishReason: "stop",
      timingsOnLastChunk: false,
      wallMs: 1,
    });
  };
  return { calls, completeJson };
}

const noEmbedding: V1Deps["runtime"] = { catalog };

describe("v1 default (round 9 R2c)", () => {
  it("is all scoped ops in catalog order with no pre-gate", () => {
    expect(V1_DEFAULT_STEP1).toEqual({
      kind: "model",
      candidates: { mode: "scoped-all", order: "catalog" },
      preGate: false,
    });
    expect(v1Step1Label(V1_DEFAULT_STEP1)).toBe("model:scoped-all-catalog");
    expect(v1NeedsEmbedding(V1_DEFAULT_STEP1)).toBe(false);
    expect(v1NeedsEmbedding(V1_EMBEDDING_TOP1)).toBe(true);
    expect(
      v1NeedsEmbedding({ kind: "model", candidates: V1_STEP1, preGate: true }),
    ).toBe(true);
  });

  it("serves exactly the training renderer's full-list candidates for every model", () => {
    const docTypes = [...new Set(catalog.map((e) => e.docType))];
    expect(docTypes.length).toBe(12);
    for (const docType of docTypes) {
      const served = step1Candidates(V1_STEP1, {
        scopedHits: [],
        catalog,
        docType,
      }).map((e) => e.key);
      expect(served).toEqual(
        scopedCandidates(catalog, docType).map((e) => e.key),
      );
      expect(served.length).toBeGreaterThan(0);
    }
  });

  it("sends the trained step-1 bytes and grammar, without embedding", async () => {
    const { calls, completeJson } = fakeModel("knowledge-note:ADD_TOPIC", {
      name: "eventual consistency",
    });
    const r = await runV1(
      "tag this with eventual consistency",
      NOTE,
      () => ({}),
      { runtime: noEmbedding, completeJson, scoreText: never },
    );
    const trained = step1Prompt(
      "tag this with eventual consistency",
      scopedCandidates(catalog, NOTE),
    );
    expect(calls[0].messages).toEqual(trained.messages);
    expect(calls[0].grammar).toBe(trained.grammar);
    if (r.kind !== "action") throw new Error("expected an action");
    expect(r.pipeline).toBe("model:scoped-all-catalog");
    expect(r.gate).toBeNull();
    expect(r.hits).toEqual([]);
    expect(r.step1?.pick).toBe("knowledge-note:ADD_TOPIC");
    expect(r.step1?.candidates).toEqual(
      scopedCandidates(catalog, NOTE).map((e) => e.key),
    );
    expect(r.entry.key).toBe("knowledge-note:ADD_TOPIC");
    expect(r.step2.args).toEqual({ name: "eventual consistency" });
  });

  it("lets the model's own empty answer decide no-action (questions too)", async () => {
    const { calls, completeJson } = fakeModel(null, {});
    const r = await runV1("what does this note say?", NOTE, () => ({}), {
      runtime: noEmbedding,
      completeJson,
      scoreText: never,
    });
    expect(r.kind).toBe("no-action");
    if (r.kind !== "no-action") return;
    expect(r.reason).toBe("model");
    expect(r.step1?.pick).toBe(NONE_KEY);
    // One step-1 call, no step 2.
    expect(calls).toHaveLength(1);
  });

  it("passes the document's ref candidates to step 2", async () => {
    const goals = {
      id: [
        { id: "g-1", label: "Register the hives" },
        { id: "g-2", label: "Order suits" },
      ],
    };
    let seen: unknown = null;
    const { completeJson } = fakeModel("wbs:SET_GOAL_STATUS", {
      id: "Order suits",
      status: "COMPLETED",
    });
    const scoreText: ScoreText = (_m, grammar) => {
      const label = /\\"id\\": \\"(.*)\\""/.exec(grammar)?.[1] ?? "";
      return Promise.resolve({
        text: `{"id": "${label}"}`,
        tokens: [
          { token: `{"id": "${label}"`, logprob: label === "Order suits" ? -0.1 : -5, bytes: null, top_logprobs: [] },
        ],
        finishReason: "stop",
        wallMs: 1,
      });
    };
    const r = await runV1(
      "the suits one is done",
      "bai/wbs",
      (e) => {
        seen = e.key;
        return e.opName === "SET_GOAL_STATUS" ? goals : {};
      },
      { runtime: noEmbedding, completeJson, scoreText },
    );
    expect(seen).toBe("wbs:SET_GOAL_STATUS");
    if (r.kind !== "action") throw new Error("expected an action");
    expect(r.step2.args?.id).toBe("g-2");
  });

  it("rejects a step-1 answer outside the list", async () => {
    const { completeJson } = fakeModel("wbs:SET_GOAL_STATUS", {});
    await expect(
      runV1("x", NOTE, () => ({}), {
        runtime: noEmbedding,
        completeJson,
        scoreText: never,
      }),
    ).rejects.toThrow(/no listed op/);
  });

  it("step1Pick reads keys, the empty list and junk", () => {
    expect(step1Pick({ ops: ["a:B"] }, ["a:B"])).toBe("a:B");
    expect(step1Pick({ ops: [] }, ["a:B"])).toBe(NONE_KEY);
    expect(step1Pick({ ops: ["a:C"] }, ["a:B"])).toBeNull();
    expect(step1Pick("x", ["a:B"])).toBeNull();
  });
});
