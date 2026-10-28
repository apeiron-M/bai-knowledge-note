/**
 * The vault's artifact manifest for configuration C (nl-runtime
 * `ArtifactManifest`), built from today's `C_*` constants in
 * core/model-manifest.ts. The LoRA carries the answer table its trie uses
 * and the prompt format it was trained on.
 */
import {
  type ArtifactManifest,
  LFM2_ANSWER_TABLE,
  PROMPT_FORMAT_VERSION,
} from "nl-runtime";
import { C_ARTIFACTS, C_FUSION, C_LOAD } from "./core/model-manifest.js";

export const VAULT_ARTIFACTS: ArtifactManifest = {
  artifacts: {
    lora: {
      ...C_ARTIFACTS.lora,
      answerTable: LFM2_ANSWER_TABLE,
      promptFormat: PROMPT_FORMAT_VERSION,
    },
    kev: C_ARTIFACTS.kev,
  },
  fusion: C_FUSION,
  load: C_LOAD,
  // No hosted copy yet; "hf-etag" once M4 hosts the files.
  integrity: "stream-sha256",
};
