/**
 * The seam between configuration C's pure pipeline and a model runtime:
 * wllama in the browser (`wllama-backend.ts`), native llama-server in the
 * node parity check (`server-backend.ts`, never bundled for the browser).
 */
import type { SystemOneBody, SystemOneResponse } from "./kev-request.js";
import type { CompleteJson, ScoreText } from "./llm-client.js";

/** Top-n next-token log-probabilities (full-vocabulary raw softmax). */
export interface NextDist {
  lp: Map<number, number>;
  /** The smallest reported logprob (lib.ts's floor), 0 when empty. */
  minLp: number;
}

/** The LoRA: step 1, the trie, step 2 and answers. */
export interface LoraBackend {
  completeJson: CompleteJson;
  scoreText: ScoreText;
  /**
   * One-token completion of a string prompt (the server adds BOS and parses
   * special tokens), temperature 0, `n_probs` = `nProbs`, prompt cache on.
   * May throw: wllama cannot serialise partial-UTF-8 byte tokens.
   */
  nextDist(prompt: string, nProbs: number): Promise<NextDist>;
  /**
   * The unconstrained logprob of next token `id`: a one-token completion
   * with `logit_bias [[id, 100]]` whose sampled-token logprob comes from the
   * raw pre-sampler softmax. Throws if the sampled token is not `id`.
   */
  forcedLogprob(prompt: string, id: number): Promise<number>;
}

/** Kev-FT's System One head. */
export interface KevBackend {
  systemOne(body: SystemOneBody): Promise<SystemOneResponse>;
}
