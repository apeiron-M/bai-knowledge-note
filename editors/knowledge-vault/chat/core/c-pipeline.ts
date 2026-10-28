/**
 * Configuration C: X5 LoRA step 1 + trie scores, fused with Kev-FT's
 * option probabilities, margin-gated (ask with the top 3), then X9 step 2
 * on the chosen op. Moved to nl-runtime (core/c-pipeline) in M1, where the
 * artifact manifest and Kev's option texts are inputs; the vault's
 * `decideOp` binds `VAULT_ARTIFACTS` and `OP_DESCRIPTIONS`.
 */
import {
  type CDeps as CoreCDeps,
  decideOp as coreDecideOp,
  type DecideOptions,
  type DecideResult,
} from "nl-runtime";
import { VAULT_ARTIFACTS } from "../vault-artifacts.js";
import { OP_DESCRIPTIONS } from "./op-descriptions.js";

export {
  type CConfig,
  type DecideOptions,
  type DecideResult,
  type DecideTimings,
  fillArgs,
  type FillArgsContext,
  type KevFallback,
  scopedCandidates,
  type TrieStats,
} from "nl-runtime";

export type CDeps = Omit<CoreCDeps, "manifest" | "kevOptionText">;

export function decideOp(
  utterance: string,
  docType: string,
  deps: CDeps,
  opts: DecideOptions = {},
): Promise<DecideResult> {
  return coreDecideOp(
    utterance,
    docType,
    { manifest: VAULT_ARTIFACTS, kevOptionText: OP_DESCRIPTIONS, ...deps },
    opts,
  );
}
