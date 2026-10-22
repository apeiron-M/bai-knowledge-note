/**
 * Round 9 per-row metrics (pure, unit-tested): the config's pick, why an
 * action item's op is wrong, and whether it is fully right.
 */
import { NONE_KEY } from "../../editors/knowledge-vault/chat/core/op-scorer.js";

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const model = (key: unknown) => String(key).split(":")[0];

/** The config's pick: NONE_KEY when the pre-gate is on and fires. */
export function r9Pick(r: Json, preGate: boolean): unknown {
  const gated = isRecord(r.gate) && r.gate.noAction === true;
  return preGate && gated ? NONE_KEY : r.loraPick;
}

/** Why an action item's op is wrong (round 8's order), or null if right. */
export function r9MissCause(r: Json, preGate: boolean): string | null {
  const pick = r9Pick(r, preGate);
  if (pick === r.expectedOp) return null;
  if (preGate && isRecord(r.gate) && r.gate.noAction === true)
    return "pre-gate no-action";
  if (pick === NONE_KEY) return "LoRA chose no-action";
  if (pick === null || pick === undefined) return "no parse";
  if (r.inList === false) return "gold not in list";
  if (model(pick) !== model(r.expectedOp)) return "other model's op";
  return "sibling in list";
}

/** Right op, plus exact args and refs where scored. */
export function fullyRight(r: Json, preGate: boolean): boolean {
  if (r9Pick(r, preGate) !== r.expectedOp) return false;
  return r.exact !== false && r.refExact !== false;
}

export function count<T>(xs: T[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[String(x)] = (m[String(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
