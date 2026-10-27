/**
 * Configuration C (PREREGISTRATION-3, held-out-6): the two measured GGUFs
 * and the registered fusion / gate constants. The Chat tab loads the X5
 * LoRA (step 1, trie scores, step 2, answers) and Kev-FT (System One option
 * probabilities); `fusion.ts` combines them.
 */

/** Equal-weight product of tempered log-softmaxes, margin gate (X7 C3). */
export const C_FUSION = {
  wLora: 0.5,
  wKev: 0.5,
  /** LoRA trie-score temperature (dev-cv refit, PREREG-3 §1). */
  tLora: 1.63,
  /** Kev log-probability temperature (dev-cv refit). */
  tKev: 4.0,
  /** Ask when p1 - p2 < tau (p over every option including none). */
  tau: 0.5,
  /** Options offered when asking ("none of these" is added by the UI). */
  kOffer: 3,
} as const;

export type FusionParams = {
  readonly [K in keyof typeof C_FUSION]: number;
};

export type ModelRole = "lora" | "kev";

export interface ModelArtifact {
  role: ModelRole;
  /** Versioned, immutable by convention: also the OPFS cache key. */
  fileName: string;
  bytes: number;
  sha256: string;
  /** `general.architecture`. */
  arch: string;
  /** Short name for the status line. */
  label: string;
  /** Same-origin dev path (Studio's Vite serves the repo root). */
  devPath: string;
  /** `general.name`, when it identifies the file (X5's is "Merged"). */
  generalName?: string;
  /** Kev only: `<arch>.decision.type`. */
  decisionType?: string;
  /**
   * Kev only: `<arch>.decision.temperature.choice` as f32, which the rig's
   * decide.mjs used to undo the served temperature (logT1). The GGUF
   * metadata string is rounded to 6 dp; it must agree to 1e-6.
   */
  servedT?: number;
  /** LoRA only: the trie's answer table is keyed by this tokenizer. */
  tokenizerPre?: string;
  nVocab?: number;
}

export const C_ARTIFACTS: Record<ModelRole, ModelArtifact> = {
  lora: {
    role: "lora",
    fileName: "LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf",
    bytes: 229_312_224,
    sha256: "062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba",
    arch: "lfm2",
    label: "X5 LoRA 350M",
    devPath:
      "/training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf",
    tokenizerPre: "lfm2",
    nVocab: 65536,
  },
  kev: {
    role: "kev",
    fileName: "Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf",
    bytes: 529_595_072,
    sha256: "30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23",
    arch: "qwen35",
    label: "Kev-FT 0.8B",
    devPath:
      "/training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf",
    generalName: "Kev-0.8B-vault-ft1",
    decisionType: "kev",
    servedT: 2.700699806213379,
  },
};

/**
 * wllama load parameters. The LoRA keeps the rig's n_ctx 4096 (its longest
 * dev prompt is 568 tokens; a smaller context or ubatch saved nothing
 * measurable). Kev is sized for memory: as a decision model llama.cpp runs
 * it in embedding mode, which makes every prompt token an output and
 * computes full-vocabulary logits for each (248,320 x 4 B per token), so
 * the GPU compute buffer and its readback scale with n_ubatch (default
 * 512: ~0.5 GB each). The longest Kev request without the utterance is 675
 * tokens (knowledge-note, 19 options; dev max 710 with one), so
 * n_ctx = n_batch = 1024 leaves ~350 tokens for the request, and
 * n_ubatch 128 cut C's memory from ~5.8 to ~3.6 GB in Chrome (Kev +~100 ms
 * per call; decisions and Kev probabilities unchanged, browser parity).
 */
export const C_LOAD = {
  lora: { nCtx: 4096 },
  kev: { nCtx: 1024, nBatch: 1024, nUbatch: 128 },
  /**
   * Longer requests skip Kev for the turn (LoRA alone) instead of failing:
   * 1,000 characters stay under ~350 tokens for English text.
   */
  kevMaxRequestChars: 1000,
} as const;

/** Held-out-6 headline numbers shown in the configuration label. */
export const C_HELDOUT6 = {
  opOneShot: 0.935,
  asked: 0.159,
  loraAloneOp: 0.845,
} as const;

/** Model GGUF metadata the identity check reads. */
export type GgufMeta = Record<string, string | undefined>;

/**
 * Why a loaded file is not the measured artifact (null when it is). Cheap
 * checks only: a full-file sha256 cannot stream through crypto.subtle.
 */
export function artifactMismatch(
  a: ModelArtifact,
  loaded: { bytes: number; meta: GgufMeta; nVocab?: number },
): string | null {
  const m = loaded.meta;
  if (loaded.bytes && loaded.bytes !== a.bytes)
    return `size ${loaded.bytes} B, expected ${a.bytes} B`;
  if (m["general.architecture"] !== a.arch)
    return `architecture ${m["general.architecture"] ?? "?"}, expected ${a.arch}`;
  if (a.generalName && m["general.name"] !== a.generalName)
    return `name ${m["general.name"] ?? "?"}, expected ${a.generalName}`;
  if (a.decisionType && m[`${a.arch}.decision.type`] !== a.decisionType)
    return `decision type ${m[`${a.arch}.decision.type`] ?? "?"}, expected ${a.decisionType}`;
  if (a.servedT !== undefined) {
    const t = Number(m[`${a.arch}.decision.temperature.choice`]);
    if (!(Math.abs(t - a.servedT) <= 1e-6))
      return `decision temperature ${String(t)}, expected ${a.servedT}`;
  }
  if (a.tokenizerPre && m["tokenizer.ggml.pre"] !== a.tokenizerPre)
    return `tokenizer ${m["tokenizer.ggml.pre"] ?? "?"}, expected ${a.tokenizerPre}`;
  if (a.nVocab && loaded.nVocab !== undefined && loaded.nVocab !== a.nVocab)
    return `vocabulary ${loaded.nVocab}, expected ${a.nVocab}`;
  return null;
}
