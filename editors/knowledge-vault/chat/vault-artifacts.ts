/**
 * The vault's artifact manifest for configuration C (nl-runtime
 * `ArtifactManifest`): the LoRA m2bv with its vault + drive answer table
 * (sha256 4799cc52…, from m2bv's export) and prompt format, Kev-FT, and
 * m2bv's fusion. `VAULT_ARTIFACTS_X5` keeps the previous pair for a rollback.
 */
import {
  type AnswerTable,
  type ArtifactManifest,
  LFM2_ANSWER_TABLE,
  PROMPT_FORMAT_VERSION,
} from "nl-runtime";
import m2bvAnswers from "./answer-tokens.m2bv-20261029.json" with { type: "json" };
import { C_ARTIFACTS, C_FUSION, C_LOAD } from "./core/model-manifest.js";

export const VAULT_ARTIFACTS: ArtifactManifest = {
  artifacts: {
    lora: {
      ...C_ARTIFACTS.lora,
      answerTable: m2bvAnswers satisfies AnswerTable,
      promptFormat: PROMPT_FORMAT_VERSION,
    },
    kev: C_ARTIFACTS.kev,
  },
  fusion: C_FUSION,
  load: C_LOAD,
  // No hosted copy yet; "hf-etag" once the release hosts the files.
  integrity: "stream-sha256",
};

/** X5 × Kev-FT as shipped before M5 (X5's GGUF in its own dev path). */
export const VAULT_ARTIFACTS_X5: ArtifactManifest = {
  ...VAULT_ARTIFACTS,
  artifacts: {
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
      answerTable: LFM2_ANSWER_TABLE,
      promptFormat: PROMPT_FORMAT_VERSION,
    },
    kev: C_ARTIFACTS.kev,
  },
  fusion: { ...C_FUSION, tLora: 1.63 },
};
