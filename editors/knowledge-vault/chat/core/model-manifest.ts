/**
 * Configuration C: the two measured GGUFs and the fusion / gate constants.
 * The Chat tab loads the vault LoRA m2bv (step 1, trie scores, step 2,
 * answers) and Kev-FT (System One option probabilities); `fusion.ts`
 * combines them. Values from m2bv's export ArtifactManifest (powerhouse-nl
 * docs/notes/m2b/vault-lora.md); Kev-FT is the file C shipped with X5.
 */
import type { ModelArtifact, ModelRole } from "nl-runtime";

// The types and artifactMismatch moved to nl-runtime (core/artifact-manifest)
// in M1; the values stay here. chat/vault-artifacts.ts builds the vault's
// ArtifactManifest from them.
export {
  artifactMismatch,
  type FusionParams,
  type GgufMeta,
  type ModelArtifact,
  type ModelRole,
} from "nl-runtime";

/** Equal-weight product of tempered log-softmaxes, margin gate (X7 C3). */
export const C_FUSION = {
  wLora: 0.5,
  wKev: 0.5,
  /** LoRA trie-score temperature (m2bv x Kev-FT dev-cv fit; X5's was 1.63). */
  tLora: 1.887,
  /** Kev log-probability temperature (dev-cv refit). */
  tKev: 4.0,
  /** Ask when p1 - p2 < tau (p over every option including none). */
  tau: 0.5,
  /** Options offered when asking ("none of these" is added by the UI). */
  kOffer: 3,
} as const;

/** `devPath` is optional in nl-runtime (a hosted manifest has a base URL); the vault's are set. */
export const C_ARTIFACTS: Record<ModelRole, ModelArtifact & { devPath: string }> = {
  lora: {
    role: "lora",
    fileName: "LFM2.5-350M-vault-m2bv-20261029-Q4_K_M.gguf",
    bytes: 229_312_224,
    sha256: "852cd58e5365ba4fcaa27d69e8e7f412c1d59459c9a62c0e42eb3b4dcf90d70d",
    arch: "lfm2",
    label: "vault LoRA m2bv",
    devPath:
      "/training/artifacts/m2bv-350m/gguf/LFM2.5-350M-vault-m2bv-20261029-Q4_K_M.gguf",
    generalName: "Merged",
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

/**
 * m2bv x Kev-FT on vault dev (held-out-3 + 4; gate op 181/196, asked
 * 32/216, LoRA alone 173/196), shown in the configuration label until the
 * held-out-7 confirmatory run replaces them. X5's held-out-6: 0.935 / 0.159 / 0.845.
 */
export const C_MEASURED = {
  set: "vault dev",
  opOneShot: 0.923,
  asked: 0.148,
  loraAloneOp: 0.883,
} as const;
