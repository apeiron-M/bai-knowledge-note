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
import {
  runV1,
  v1Action,
  type V1Deps,
} from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";

const catalog = buildRuntimeCatalog();
const NOTE = "bai/knowledge-note";

/** An index over the committed asset and a query embedder that returns `key`'s own vector. */
async function runtimeFor(key: string): Promise<V1Deps["runtime"]> {
  const asset = await loadOpEmbeddingAsset();
  const v = decodeVectors(asset.ops.vectors, asset.dims)[
    asset.ops.keys.indexOf(key)
  ];
  return {
    index: createOpEmbeddingIndex(catalog, asset),
    embedQuery: () => Promise.resolve(v),
  };
}

const never = () => Promise.reject(new Error("no model call expected"));

describe("v1 pipeline", () => {
  it("answers a question without any model call", async () => {
    const r = await runV1("what does this note say?", NOTE, () => ({}), {
      runtime: await runtimeFor("knowledge-note:SET_TITLE"),
      completeJson: never,
      scoreText: never,
    });
    expect(r.kind).toBe("no-action");
    expect(r.gate.question).toBe(true);
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
