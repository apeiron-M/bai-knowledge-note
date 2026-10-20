import { describe, expect, it } from "vitest";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import {
  argsSignature,
  generateAction,
} from "../../editors/knowledge-vault/chat/core/generator.js";
import type {
  CompleteJson,
  JsonConstraint,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";

const catalog = buildVaultCatalog();
const pick = (...keys: string[]) =>
  keys.map((k) => {
    const e = catalog.find((c) => c.key === k);
    if (!e) throw new Error(k);
    return e;
  });

function fake(outputs: string[]) {
  const seen: JsonConstraint[] = [];
  const completeJson: CompleteJson = (_messages, constraint) => {
    seen.push(constraint);
    const text = outputs.shift() ?? "";
    let parsed: unknown;
    let parseError: string | undefined;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parseError = String(e);
    }
    return Promise.resolve({
      text,
      parsed,
      parseError,
      chunks: 1,
      finishReason: "stop",
      timingsOnLastChunk: false,
      wallMs: 1,
    });
  };
  return { completeJson, seen };
}

describe("two-step generator", () => {
  it("renders a compact argument signature", () => {
    const [member] = pick("project:ADD_MEMBER");
    expect(argsSignature(member.modelSchema)).toBe(
      '{"name": string, "role"?: string | null, "kind"?: "AGENT" | "HUMAN" | null}',
    );
  });

  it("selects among candidates, then fills args under the op schema", async () => {
    const candidates = pick(
      "knowledge-note:ADD_TOPIC",
      "knowledge-note:SET_TITLE",
    );
    const { completeJson, seen } = fake([
      '{"op": "knowledge-note:ADD_TOPIC"}',
      '{"name": "distributed systems"}',
    ]);
    const r = await generateAction("tag it", candidates, { completeJson });
    expect(r.key).toBe("knowledge-note:ADD_TOPIC");
    expect(r.args).toEqual({ name: "distributed systems" });
    expect(seen[0]).toMatchObject({ kind: "json_schema", name: "select_op" });
    expect(seen[1]).toMatchObject({ schema: candidates[0].modelSchema });
  });

  it("skips step 2 for ops with no semantic fields", async () => {
    const candidates = pick("knowledge-note:REMOVE_TOPIC");
    const { completeJson, seen } = fake([
      '{"op": "knowledge-note:REMOVE_TOPIC"}',
    ]);
    const r = await generateAction("untag", candidates, { completeJson });
    expect(r.args).toEqual({});
    expect(r.timings.step2).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("reports an op outside the candidate set as no selection", async () => {
    const { completeJson } = fake(['{"op": "wbs:DELETE_GOAL"}']);
    const r = await generateAction("x", pick("knowledge-note:ADD_TOPIC"), {
      completeJson,
    });
    expect(r.key).toBeNull();
    expect(r.error).toBe("no candidate selected");
  });
});
