/**
 * Kev-FT's System One request for configuration C. Moved to nl-runtime
 * (core/kev-request) in M1, where the option texts are an input; the
 * vault's `kevRequest` binds `OP_DESCRIPTIONS` (= the rig's catalog.json
 * `override`).
 */
import {
  type CatalogEntry,
  kevRequest as coreKevRequest,
  type KevRequest,
} from "nl-runtime";
import { OP_DESCRIPTIONS } from "./op-descriptions.js";

export {
  KEV_NONE_DESC,
  KEV_NONE_NAME,
  kevHuman,
  kevOptionProbs,
  type KevRequest,
  type SystemOneBody,
  type SystemOneChoice,
  type SystemOneResponse,
} from "nl-runtime";

export function kevRequest(
  utterance: string,
  cands: readonly CatalogEntry[],
): KevRequest {
  return coreKevRequest(utterance, cands, OP_DESCRIPTIONS);
}
