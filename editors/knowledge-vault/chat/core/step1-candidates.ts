/**
 * Which ops a LoRA step 1 chooses among (round 9); the r6.1 prompt is
 * unchanged, only the list differs. `scoped-topk` is round 8's C3 (trained
 * at k = 5). `scoped-all` is every global op of the document's model, best
 * first (`rank`) or in catalog order (`catalog`, the round-8 full-list
 * training rows). `unscoped-topk` ranks every model's ops; no training
 * row has that shape.
 */
import type { CatalogEntry } from "./op-catalog.js";
import type { RetrievedOp } from "./op-retriever.js";

export type Step1Candidates =
  | { mode: "scoped-topk"; k: number }
  | { mode: "scoped-all"; order: "rank" | "catalog" }
  | { mode: "unscoped-topk"; k: number };

export interface Step1CandidateInputs {
  /** The scoped model's global ops by similarity, best first. */
  scopedHits: RetrievedOp[];
  /** Every global op by similarity, best first (unscoped modes only). */
  unscopedHits?: () => RetrievedOp[];
  catalog: CatalogEntry[];
  docType: string;
}

export function step1Candidates(
  spec: Step1Candidates,
  inputs: Step1CandidateInputs,
): CatalogEntry[] {
  switch (spec.mode) {
    case "scoped-topk":
      return inputs.scopedHits.slice(0, spec.k).map((h) => h.entry);
    case "scoped-all":
      return spec.order === "rank"
        ? inputs.scopedHits.map((h) => h.entry)
        : inputs.catalog.filter(
            (e) => e.docType === inputs.docType && e.scope === "global",
          );
    case "unscoped-topk": {
      if (!inputs.unscopedHits)
        throw new Error("unscoped-topk needs unscopedHits");
      return inputs
        .unscopedHits()
        .slice(0, spec.k)
        .map((h) => h.entry);
    }
  }
}

/** A short label for results files, e.g. "scoped-all-rank", "unscoped-k10". */
export function step1CandidatesLabel(spec: Step1Candidates): string {
  switch (spec.mode) {
    case "scoped-topk":
      return `scoped-k${spec.k}`;
    case "scoped-all":
      return `scoped-all-${spec.order}`;
    case "unscoped-topk":
      return `unscoped-k${spec.k}`;
  }
}
