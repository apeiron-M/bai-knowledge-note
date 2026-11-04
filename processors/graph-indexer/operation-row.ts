import type { GraphOperation } from "./schema.js";
import { summarizeOperation } from "./summarize.js";

/**
 * The source actions whose operations enter `graph_operations`. A source is
 * still not a graph node; its history is recorded so the change digest can
 * say when it was re-ingested and at which ref. Attachment and other
 * operations stay out — they say nothing about what the source says.
 */
export const RECORDED_SOURCE_ACTIONS: ReadonlySet<string> = new Set([
  "INGEST_SOURCE",
  "SET_SOURCE_STATUS",
  "ADD_EXTRACTED_CLAIM",
  "REMOVE_EXTRACTED_CLAIM",
  "RECORD_EXTRACTION_STATS",
]);

type Signer = {
  user?: { address?: string };
  app?: { name?: string; key?: string };
  signatures?: Array<string | string[]>;
};

/**
 * One `graph_operations` row for an operation. Shared by the live indexer
 * and the source-history backfill, so both write the same row under the
 * same id (`<documentId>-<index>` for global operations) and a backfilled
 * row is indistinguishable from a live one.
 */
export function operationRowOf(o: {
  documentId: string;
  documentType: string;
  index: number;
  type: string;
  input: unknown;
  timestampUtcMs: string | undefined | null;
  scope?: string | null;
  signer?: unknown;
}): GraphOperation {
  const input = (o.input ?? {}) as Record<string, unknown>;
  const signer = o.signer as Signer | undefined;
  // Keep the LAST signature, which is the one the verifier checks
  // (`createSignatureVerifier` reads `signatures[length - 1]`). The
  // reactor stores tuples; the wire carries them joined by ", ".
  const lastSignature = signer?.signatures?.at(-1);
  const signature =
    lastSignature === undefined
      ? null
      : Array.isArray(lastSignature)
        ? lastSignature.join(", ")
        : lastSignature;
  const scope = o.scope ?? "global";
  return {
    // The reactor numbers each scope separately: a document-scope
    // CREATE_DOCUMENT is index 0, like the first global operation. The
    // scope in the id keeps them apart (the same scheme link rows use).
    id: scope === "global" ? `${o.documentId}-${o.index}` : `${o.documentId}-${scope}-${o.index}`,
    document_id: o.documentId,
    document_type: o.documentType,
    operation_type: o.type,
    timestamp: o.timestampUtcMs ?? new Date().toISOString(),
    index: o.index,
    scope,
    summary: summarizeOperation(o.type, input),
    input_json: JSON.stringify(input),
    signer_address: signer?.user?.address || null,
    signer_app: signer?.app?.name || null,
    signer_key: signer?.app?.key || null,
    signature,
  };
}
