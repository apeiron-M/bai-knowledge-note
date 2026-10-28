/**
 * Configuration C fusion and margin gate. Moved to nl-runtime (core/fusion)
 * in M1, where the fusion parameters are a required argument; the vault's
 * `fuseAndGate` keeps `C_FUSION` as the default.
 */
import {
  fuseAndGate as coreFuseAndGate,
  type FusionParams,
  type GateDecision,
  type OptionScores,
} from "nl-runtime";
import { C_FUSION } from "./model-manifest.js";

export {
  type GateDecision,
  kevScores,
  logT1,
  lsm,
  type OptionScores,
} from "nl-runtime";

export function fuseAndGate(
  keys: readonly string[],
  lora: OptionScores,
  kev: OptionScores,
  params: FusionParams = C_FUSION,
): GateDecision {
  return coreFuseAndGate(keys, lora, kev, params);
}
