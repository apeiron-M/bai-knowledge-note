/**
 * Kev-FT's System One request for configuration C: byte-equal to the eval
 * rig's decide.mjs body (`--runtime server --variant desc --wording W3`,
 * descField `override`, one-stage call only). Option names are the op names
 * in words; option texts are `OP_DESCRIPTIONS` (= the rig's catalog.json
 * `override`), not the runtime catalog's `description`. The none option,
 * "answer a question", goes last.
 */
import type { CatalogEntry } from "./op-catalog.js";
import { OP_DESCRIPTIONS } from "./op-descriptions.js";

/** decide.mjs `human`: `SET_NOTE_TYPE` -> `set note type`. */
export function kevHuman(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ");
}

/** W3's none option. */
export const KEV_NONE_NAME = "answer a question";
export const KEV_NONE_DESC =
  "The user only asks a question about the document or wants information; no operation is applied.";

export interface SystemOneChoice {
  type: "choice";
  instructions: string;
  /** Option name -> description, in option order. */
  criteria: Record<string, string>;
}

export interface SystemOneBody {
  state: string;
  questions: { q0: SystemOneChoice };
}

/** The part of llama.cpp's System One response C reads. */
export interface SystemOneResponse {
  answers: Record<
    string,
    | { type?: string; choice?: string; probabilities?: Record<string, number> }
    | undefined
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface KevRequest {
  body: SystemOneBody;
  /** Option names in order: one per op key, then `KEV_NONE_NAME`. */
  names: string[];
  /** The op keys the names stand for (none excluded). */
  keys: string[];
}

/**
 * The one-stage choice over `cands` (the step-1 list: the document model's
 * global ops in catalog order) plus none.
 */
export function kevRequest(
  utterance: string,
  cands: readonly CatalogEntry[],
): KevRequest {
  if (cands.length === 0) throw new Error("kevRequest needs at least one op");
  const model = cands[0].model;
  const criteria: Record<string, string> = {};
  const names: string[] = [];
  for (const c of cands) {
    if (c.model !== model)
      throw new Error(`kevRequest: ${c.key} is not a ${model} op`);
    const name = kevHuman(c.opName);
    const desc = OP_DESCRIPTIONS[c.key];
    if (typeof desc !== "string" || !desc)
      throw new Error(`no Kev option text for ${c.key}`);
    if (name in criteria || name === KEV_NONE_NAME)
      throw new Error(`Kev option name "${name}" is not unique`);
    criteria[name] = desc;
    names.push(name);
  }
  criteria[KEV_NONE_NAME] = KEV_NONE_DESC;
  names.push(KEV_NONE_NAME);
  return {
    body: {
      state: `Request: ${utterance}`,
      questions: {
        q0: {
          type: "choice",
          instructions: `Which operation should be applied to this ${kevHuman(model)} document to carry out the request?`,
          criteria,
        },
      },
    },
    names,
    keys: cands.map((c) => c.key),
  };
}

/** Option probabilities in `req.names` order; throws on a missing option. */
export function kevOptionProbs(
  req: KevRequest,
  res: SystemOneResponse,
): number[] {
  const probs = res.answers.q0?.probabilities;
  if (!probs) throw new Error("Kev response has no q0 probabilities");
  return req.names.map((n) => {
    const p = probs[n];
    if (typeof p !== "number" || !Number.isFinite(p))
      throw new Error(`Kev response has no probability for "${n}"`);
    return p;
  });
}
