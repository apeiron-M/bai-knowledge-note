import { describe, expect, it, vi } from "vitest";
import {
  decideOp,
  fillArgs,
  type CDeps,
} from "../../editors/knowledge-vault/chat/core/c-pipeline.js";
import type {
  KevBackend,
  LoraBackend,
} from "../../editors/knowledge-vault/chat/core/decision-backend.js";
import type { SystemOneBody } from "../../editors/knowledge-vault/chat/core/kev-request.js";
import type {
  CompleteJson,
  ScoreText,
} from "../../editors/knowledge-vault/chat/core/llm-client.js";
import { answersFor } from "../../editors/knowledge-vault/chat/core/lora-trie.js";
import {
  forcedOpsText,
  STEP1_SYSTEM,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";

const catalog = v1Catalog();
const DOC = "bai/knowledge-note";
const keys = catalog
  .filter((e) => e.docType === DOC && e.scope === "global")
  .map((e) => e.key);
const ADD_TOPIC = "knowledge-note:ADD_TOPIC";
const REMOVE_TOPIC = "knowledge-note:REMOVE_TOPIC";
const SET_TITLE = "knowledge-note:SET_TITLE";

/** A LoRA whose step 1 answers `pick` and whose trie favours `favour`. */
function mockLora(
  pick: string | null,
  favour: Record<string, number> = {},
): LoraBackend & { calls: { nextDist: number } } {
  const calls = { nextDist: 0 };
  // every token of an answer scores its weight (default -5); a token shared
  // by several answers takes the best weight among them
  const answers = answersFor(keys).sort(
    (a, b) => (favour[b.key] ?? -5) - (favour[a.key] ?? -5),
  );
  const completeJson: CompleteJson = (messages) => {
    const text = messages[0].content.startsWith(STEP1_SYSTEM.ops)
      ? forcedOpsText(pick ? [pick] : [])
      : JSON.stringify({ topic: "eventual consistency" });
    return Promise.resolve({
      text,
      parsed: JSON.parse(text) as unknown,
      chunks: 1,
      finishReason: "stop",
      timingsOnLastChunk: true,
      wallMs: 1,
    });
  };
  const scoreText: ScoreText = () =>
    Promise.resolve({ text: "", tokens: [], finishReason: "stop", wallMs: 1 });
  return {
    calls,
    completeJson,
    scoreText,
    nextDist: (prompt) => {
      calls.nextDist++;
      const lp = new Map<number, number>();
      for (const a of answers) {
        const w = favour[a.key] ?? -5;
        for (let i = 0; i < a.ids.length; i++)
          if (
            prompt.endsWith(`<|im_start|>assistant\n${a.pieces.slice(0, i).join("")}`) &&
            !lp.has(a.ids[i])
          )
            lp.set(a.ids[i], w);
      }
      return Promise.resolve({ lp, minLp: -20 });
    },
    forcedLogprob: () => Promise.resolve(-20),
  };
}

/** Kev answering with probabilities proportional to `weights` by name. */
function mockKev(weights: Record<string, number>): KevBackend & { bodies: SystemOneBody[] } {
  const bodies: SystemOneBody[] = [];
  return {
    bodies,
    systemOne: (body) => {
      bodies.push(body);
      const names = Object.keys(body.questions.q0.criteria);
      const raw = names.map((n) => weights[n] ?? 1e-4);
      const z = raw.reduce((s, x) => s + x, 0);
      return Promise.resolve({
        answers: {
          q0: { probabilities: Object.fromEntries(names.map((n, i) => [n, raw[i] / z])) },
        },
      });
    },
  };
}

function deps(lora: LoraBackend, kev: KevBackend | null | Error): CDeps {
  return {
    catalog,
    lora,
    kev:
      kev === null
        ? null
        : kev instanceof Error
          ? () => Promise.reject(kev)
          : () => Promise.resolve(kev),
  };
}

describe("decideOp", () => {
  it("decides no-action on a step-1 none: no trie, no Kev call", async () => {
    const lora = mockLora(null);
    const kev = mockKev({});
    let loads = 0;
    const r = await decideOp("what is this note about?", DOC, {
      catalog,
      lora,
      kev: () => {
        loads++;
        return Promise.resolve(kev);
      },
    });
    expect(r.kind).toBe("none");
    if (r.kind !== "none") return;
    expect(r.kevCalled).toBe(false);
    expect(kev.bodies).toHaveLength(0);
    // the load still starts at send time (first need)
    expect(loads).toBe(1);
    expect(lora.calls.nextDist).toBe(0);
  });

  it("skips Kev for a request longer than its context allows", async () => {
    const kev = mockKev({});
    const r = await decideOp("x".repeat(1001), DOC, deps(mockLora(ADD_TOPIC), kev));
    expect(r).toMatchObject({
      kind: "op",
      config: "A",
      fallback: { reason: "unavailable", detail: "request too long for the decision model" },
    });
    expect(kev.bodies).toHaveLength(0);
  });

  it("does not surface a Kev load failure on a no-action turn", async () => {
    const r = await decideOp("what is this note about?", DOC, deps(mockLora(null), new Error("404")));
    expect(r.kind).toBe("none");
  });

  it("runs arm A with no Kev: the LoRA pick, never asks, no trie", async () => {
    const lora = mockLora(ADD_TOPIC);
    const r = await decideOp("tag this", DOC, deps(lora, null));
    expect(r).toMatchObject({ kind: "op", config: "A", asked: false, fallback: { reason: "off" } });
    if (r.kind !== "op") return;
    expect(r.pick.key).toBe(ADD_TOPIC);
    expect(lora.calls.nextDist).toBe(0);
  });

  it("falls back to arm A when Kev fails to load or errors", async () => {
    const a = await decideOp("tag this", DOC, deps(mockLora(ADD_TOPIC), new Error("404")));
    expect(a).toMatchObject({
      kind: "op",
      config: "A",
      fallback: { reason: "unavailable", detail: "404" },
    });
    const broken: KevBackend = { systemOne: () => Promise.reject(new Error("GLUE")) };
    const b = await decideOp("tag this", DOC, deps(mockLora(ADD_TOPIC), broken));
    expect(b).toMatchObject({ kind: "op", config: "A", fallback: { reason: "failed" } });
    if (b.kind === "op") expect(b.pick.key).toBe(ADD_TOPIC);
  });

  it("falls back when the user skips waiting for Kev", async () => {
    const never: KevBackend = { systemOne: () => new Promise(() => {}) };
    const r = await decideOp("tag this", DOC, deps(mockLora(ADD_TOPIC), never), {
      skipKev: Promise.resolve(),
    });
    expect(r).toMatchObject({ kind: "op", config: "A", fallback: { reason: "skipped" } });
  });

  it("does not ask when LoRA and Kev agree strongly", async () => {
    const lora = mockLora(ADD_TOPIC, { [ADD_TOPIC]: -0.01 });
    const kev = mockKev({ "add topic": 1 });
    const onStage = vi.fn();
    const r = await decideOp("tag this note with x", DOC, deps(lora, kev), { onStage });
    expect(r).toMatchObject({ kind: "op", config: "C", asked: false, offered: [] });
    if (r.kind !== "op") return;
    expect(r.pick.key).toBe(ADD_TOPIC);
    expect(r.p?.[ADD_TOPIC]).toBeGreaterThan(0.85); // 0.884 at m2bv's T_lora 1.887
    expect(r.trie?.requests).toBeGreaterThan(0);
    expect(kev.bodies[0].state).toBe("Request: tag this note with x");
    expect(onStage.mock.calls.map((c) => String(c[0]))).toEqual(["choose", "score", "wait-kev"]);
  });

  it("asks with the fused top 3 when the margin is small, and may overrule the LoRA", async () => {
    const lora = mockLora(SET_TITLE, {
      [SET_TITLE]: -1,
      [ADD_TOPIC]: -1,
      [REMOVE_TOPIC]: -1.2,
    });
    const kev = mockKev({ "add topic": 1, "remove topic": 0.9, "set title": 0.2 });
    const r = await decideOp("topics", DOC, deps(lora, kev));
    expect(r).toMatchObject({ kind: "op", config: "C", asked: true });
    if (r.kind !== "op") return;
    expect(r.loraPick.key).toBe(SET_TITLE);
    expect(r.pick.key).toBe(ADD_TOPIC);
    expect(r.offered.map((e) => e.key)).toEqual([ADD_TOPIC, REMOVE_TOPIC, SET_TITLE]);
    expect(r.margin).toBeLessThan(0.5);
  });

  it("can score with the exact trie (more requests)", async () => {
    const kev = mockKev({ "add topic": 1 });
    const branch = mockLora(ADD_TOPIC, { [ADD_TOPIC]: -0.01 });
    const exact = mockLora(ADD_TOPIC, { [ADD_TOPIC]: -0.01 });
    await decideOp("x", DOC, deps(branch, kev));
    await decideOp("x", DOC, deps(exact, kev), { trieMode: "exact" });
    expect(exact.calls.nextDist).toBeGreaterThan(branch.calls.nextDist);
  });
});

describe("fillArgs", () => {
  it("runs step 2 on the chosen op with today and current lists", async () => {
    const entry = catalog.find((e) => e.key === ADD_TOPIC);
    if (!entry) throw new Error("catalog");
    const r = await fillArgs("tag this note with eventual consistency", entry, mockLora(null), {
      refCandidates: {},
      today: "2026-10-27",
      currentLists: {},
    });
    expect(r.args).toEqual({ topic: "eventual consistency" });
  });
});
