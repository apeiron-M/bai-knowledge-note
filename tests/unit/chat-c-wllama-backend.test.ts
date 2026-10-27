import { describe, expect, it } from "vitest";
import {
  asSystemOneResponse,
  gpuOffload,
  NativeLog,
  withNativeLog,
  wllamaForcedLogprob,
  wllamaNextDist,
} from "../../editors/knowledge-vault/chat/core/wllama-backend.js";
import type {
  WllamaCompletionParams,
  WllamaCompletionResponse,
  WllamaInstance,
} from "../../editors/knowledge-vault/chat/core/wllama-types.js";

/** A wllama stand-in whose createCompletion answers from `respond`. */
function fakeWllama(
  respond: (p: WllamaCompletionParams) => WllamaCompletionResponse,
): { w: WllamaInstance; seen: WllamaCompletionParams[] } {
  const seen: WllamaCompletionParams[] = [];
  const unused = () => {
    throw new Error("unused");
  };
  const w: WllamaInstance = {
    cacheManager: { clear: unused, list: unused },
    loadModelFromHF: unused,
    loadModelFromUrl: unused,
    createChatCompletion: unused,
    createCompletion: (p) => {
      seen.push(p);
      return Promise.resolve(respond(p));
    },
    createSystemOne: unused,
    getModelMetadata: unused,
    getLoadedContextInfo: unused,
    isSupportWebGPU: () => true,
    isMultithread: () => false,
    getNumThreads: () => 1,
    getChatTemplate: () => null,
    exit: () => Promise.resolve(),
  };
  return { w, seen };
}

const tok = (id: number, logprob: number) => ({ id, token: `t${id}`, bytes: null, logprob });

describe("wllama next-token logprobs", () => {
  it("reads choices[0].logprobs.content[0].top_logprobs (Phase 0 shape)", async () => {
    const { w, seen } = fakeWllama(() => ({
      choices: [
        {
          text: "",
          finish_reason: "length",
          logprobs: { content: [{ ...tok(5, -0.1), top_logprobs: [tok(5, -0.1), tok(9, -3)] }] },
        },
      ],
    }));
    const d = await wllamaNextDist(w, "p", 64);
    expect([...d.lp]).toEqual([
      [5, -0.1],
      [9, -3],
    ]);
    expect(d.minLp).toBe(-3);
    expect(seen[0]).toMatchObject({ prompt: "p", n_predict: 1, n_probs: 64, temperature: 0, cache_prompt: true });
  });

  it("forces one token with logit_bias and checks it was sampled", async () => {
    const ok = fakeWllama((p) => ({
      choices: [{ text: "", finish_reason: "length", logprobs: { content: [tok(p.logit_bias?.[0][0] ?? 0, -7.5)] } }],
    }));
    expect(await wllamaForcedLogprob(ok.w, "p", 42)).toBe(-7.5);
    expect(ok.seen[0].logit_bias).toEqual([[42, 100]]);
    const bad = fakeWllama(() => ({
      choices: [{ text: "", finish_reason: "length", logprobs: { content: [tok(1, -1)] } }],
    }));
    await expect(wllamaForcedLogprob(bad.w, "p", 42)).rejects.toThrow(/sampled 1/);
  });
});

describe("NativeLog", () => {
  it("attaches the native error lines to a failure", async () => {
    const log = new NativeLog(5);
    log.push("log", ["before"]);
    await expect(
      withNativeLog(log, "trie", () => {
        log.push("error", ["[json.exception.type_error.316] invalid UTF-8 byte"]);
        return Promise.reject(new RangeError("Invalid typed array length: 1163217991"));
      }),
    ).rejects.toThrow(/trie: Invalid typed array length.*type_error\.316/);
  });

  it("keeps the GPU offload line past the ring", () => {
    const log = new NativeLog(2);
    log.push("log", ["load_tensors: offloaded 25/25 layers to GPU"]);
    for (let i = 0; i < 10; i++) log.push("log", [`line ${i}`]);
    expect(gpuOffload(log.offloadLine)).toEqual({ offloaded: 25, total: 25 });
    expect(gpuOffload(null)).toBeNull();
  });
});

describe("asSystemOneResponse", () => {
  it("keeps the numeric probabilities of each answer", () => {
    const r = asSystemOneResponse({
      model: "m",
      answers: { q0: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1, c: "x" } } },
      usage: { input_tokens: 700, output_tokens: 0 },
    });
    expect(r.answers.q0?.probabilities).toEqual({ a: 0.9, b: 0.1 });
    expect(r.usage?.input_tokens).toBe(700);
  });

  it("rejects a response without answers", () => {
    expect(() => asSystemOneResponse({ error: "boom" })).toThrow(/no answers/);
  });
});
