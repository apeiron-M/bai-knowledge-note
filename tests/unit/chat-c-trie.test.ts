import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderLfm2Legacy } from "../../editors/knowledge-vault/chat/core/lfm2-template.js";
import {
  ANSWER_TABLE_TOKENIZER,
  answersFor,
  answerTableMismatch,
  trieScore,
  trieShape,
  type TrieAnswer,
} from "../../editors/knowledge-vault/chat/core/lora-trie.js";
import { C_ARTIFACTS } from "../../editors/knowledge-vault/chat/core/model-manifest.js";
import {
  forcedOpsText,
  NONE_KEY,
  scoringMessages,
  toOptions,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import { VAULT_ARTIFACTS } from "../../editors/knowledge-vault/chat/vault-artifacts.js";
import type { WllamaChatMessage } from "../../editors/knowledge-vault/chat/core/wllama-types.js";
import { trieScore as rigTrieScore } from "../../training/eval-rig/lib/lib.js";

const FX = new URL("../fixtures/chat-c/", import.meta.url);
const catalog = v1Catalog();
const global = catalog.filter((e) => e.scope === "global");
const models = [...new Set(global.map((e) => e.docType))];
const keysOf = (docType: string) =>
  global.filter((e) => e.docType === docType).map((e) => e.key);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

describe("answer-token table", () => {
  it("covers every global op plus none, each ending in <|im_end|>", () => {
    const all = answersFor(global.map((e) => e.key));
    expect(all).toHaveLength(100);
    for (const a of all) {
      expect(a.ids.at(-1), a.key).toBe(ANSWER_TABLE_TOKENIZER.imEnd);
      expect(a.pieces).toHaveLength(a.ids.length);
      expect(a.pieces.slice(0, -1).join(""), a.key).toBe(
        forcedOpsText(a.key === NONE_KEY ? [] : [a.key]),
      );
    }
  });

  it("ships m2bv's table, keyed to its GGUF, equal to the X5 table on the vault's answers", () => {
    const shipped = VAULT_ARTIFACTS.artifacts.lora.answerTable;
    if (!shipped) throw new Error("no answer table");
    expect(shipped.tokenizer).toMatchObject({
      ggufFile: C_ARTIFACTS.lora.fileName,
      ggufSha256: C_ARTIFACTS.lora.sha256,
      pre: "lfm2",
      nVocab: 65536,
      bos: 1,
      imEnd: 7,
    });
    // Same tokenizer, so the default (X5) table's 100 answers are m2bv's too.
    expect(shipped.tokenizer.tokenizerSha).toBe(ANSWER_TABLE_TOKENIZER.tokenizerSha);
    const keys = global.map((e) => e.key);
    expect(answersFor(keys, shipped)).toEqual(answersFor(keys));
    expect(Object.keys(shipped.answers)).toHaveLength(109);
    expect(answerTableMismatch({ pre: "lfm2", nVocab: 65536, bos: 1, eos: 7 })).toBeNull();
    expect(answerTableMismatch({ pre: "qwen35" })).toMatch(/tokenizer/);
    expect(answerTableMismatch({ eos: 2 })).toMatch(/EOS/);
  });

  it("passed the native string-prompt retokenisation check", () => {
    const r: unknown = JSON.parse(readFileSync(new URL("retok-check.json", FX), "utf8"));
    expect(r).toEqual({ models: 12, answers: 100, checks: 1685, bad: [] });
  });

  it("rejects an unknown key", () => {
    expect(() => answersFor(["nope:NOPE"])).toThrow(/no answer tokens/);
  });
});

describe("renderLfm2Legacy", () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("template-goldens.json", FX), "utf8"),
  );
  const goldens = (Array.isArray(raw) ? raw : []).filter(isRecord);
  const items = new Map(
    readFileSync(new URL("items.jsonl", FX), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l): unknown => JSON.parse(l))
      .filter(isRecord)
      .map((it) => [String(it.id), it]),
  );

  it("has one golden per model", () => {
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect(goldens.map((g) => String(g.docType)).sort(byName)).toEqual(
      [...models].sort(byName),
    );
  });

  it.each(goldens.map((g) => [String(g.id), g] as const))(
    "equals llama-server /apply-template (--no-jinja) for %s",
    (id, g) => {
      const it = items.get(id);
      if (!it) throw new Error(id);
      const docType = String(g.docType);
      const messages: WllamaChatMessage[] = scoringMessages(
        String(it.utterance),
        toOptions(
          global.filter((e) => e.docType === docType),
          "key",
        ),
        "ops",
      );
      expect(messages).toEqual(g.messages);
      expect(renderLfm2Legacy(messages)).toBe(g.prompt);
    },
  );
});

/* ---------------- trie vs the rig's lib.ts on a replayed mock ---------------- */

const PROMPT_IDS = [1, 1000, 1001];
const PROMPT = "<prompt>";

/** Deterministic pseudo-logprob of `child` after `path`. */
function mockLp(path: readonly number[], child: number): number {
  let h = 2166136261;
  for (const x of [...path, -1, child]) h = Math.imul(h ^ (x & 0xffff), 16777619);
  return -((h >>> 0) % 100_000) / 7919 - 1e-3;
}

/** The top-n of a mock distribution: every child id seen, plus fillers. */
function mockTop(
  path: readonly number[],
  children: readonly number[],
  nProbs: number,
  hide: ReadonlySet<number>,
): { id: number; logprob: number }[] {
  const ids = [...children, 90001, 90002, 90003];
  const all = ids.map((id) => ({ id, logprob: mockLp(path, id) }));
  return all.filter((t) => nProbs > 64 || !hide.has(t.id)).slice(0, nProbs);
}

function childrenIndex(answers: readonly TrieAnswer[]) {
  const shape = trieShape(answers, "exact");
  const byText = new Map<string, number[]>();
  for (const [k, t] of shape.text) {
    if (byText.has(t)) throw new Error(`duplicate prefix text ${t}`);
    byText.set(t, k ? k.split(",").map(Number) : []);
  }
  return { shape, byText };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["branch", "exact"] as const)("trieScore (%s) vs lib.ts", (mode) => {
  it.each(models)("gives bit-identical sums for %s", async (docType) => {
    const answers = answersFor(keysOf(docType));
    const { shape, byText } = childrenIndex(answers);
    // hide the second child of every multi-child node from the top-64 list:
    // lib.ts retries at n_probs 8192, the port forces the token
    const hide = new Set<number>();
    for (const ch of shape.kids.values()) if (ch.size >= 2) hide.add([...ch][1]);

    vi.stubGlobal("fetch", (_url: string, init: { body: string }) => {
      const body: unknown = JSON.parse(init.body);
      if (!isRecord(body) || !Array.isArray(body.prompt)) throw new Error("bad body");
      const path = body.prompt.slice(PROMPT_IDS.length).map(Number);
      const ch = [...(shape.kids.get(path.join(",")) ?? [])];
      const top = mockTop(path, ch, Number(body.n_probs), hide);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ completion_probabilities: [{ top_logprobs: top }] }),
      });
    });
    const rig = await rigTrieScore(
      PROMPT_IDS,
      answers.map((a) => ({ key: a.key, ids: a.ids })),
      mode,
    );

    const pathOf = (prompt: string) => {
      const p = byText.get(prompt.slice(PROMPT.length));
      if (!prompt.startsWith(PROMPT) || !p) throw new Error(`unknown prompt ${prompt}`);
      return p;
    };
    const backend = {
      nextDist: (prompt: string, nProbs: number) => {
        const path = pathOf(prompt);
        const ch = [...(shape.kids.get(path.join(",")) ?? [])];
        const lp = new Map<number, number>();
        let minLp = 0;
        for (const t of mockTop(path, ch, nProbs, hide)) {
          lp.set(t.id, t.logprob);
          minLp = Math.min(minLp, t.logprob);
        }
        return Promise.resolve({ lp, minLp });
      },
      forcedLogprob: (prompt: string, id: number) =>
        Promise.resolve(mockLp(pathOf(prompt), id)),
    };
    const ours = await trieScore(backend, PROMPT, answers, mode);

    expect(ours.logprobs).toEqual(rig.logprobs);
    for (const a of answers)
      expect(ours.sums[a.key]).toBe(rig.logprobs[a.key].reduce((x, y) => x + y, 0));
    expect(ours.floored).toBe(0);
    expect(rig.floored).toBe(0);
    expect(ours.forced).toBeGreaterThan(0);
    // one top-n request per queried node (+ forced reads vs lib.ts's retries)
    expect(ours.requests - ours.forced).toBe(trieShape(answers, mode).order.length);
  });
});

describe("trieScore failure handling", () => {
  const answers = answersFor(keysOf("bai/health-report"));

  it("reads every child of a node whose top-n request fails", async () => {
    const r = await trieScore(
      {
        nextDist: () => Promise.reject(new Error("type_error.316")),
        forcedLogprob: () => Promise.resolve(-1),
      },
      PROMPT,
      answers,
      "branch",
    );
    expect(r.dumpErrors).toBe(trieShape(answers, "branch").order.length);
    expect(r.floored).toBe(0);
    for (const a of answers) expect(r.sums[a.key]).toBeLessThan(0);
  });

  it("floors at the node minimum when the forced read fails too", async () => {
    const r = await trieScore(
      {
        nextDist: () => Promise.resolve({ lp: new Map([[90001, -2]]), minLp: -2 }),
        forcedLogprob: () => Promise.reject(new Error("forced token mismatch")),
      },
      PROMPT,
      answers,
      "branch",
    );
    expect(r.floored).toBeGreaterThan(0);
    for (const a of answers)
      expect(r.sums[a.key]).toBe(r.logprobs[a.key].length * -2);
  });
});
