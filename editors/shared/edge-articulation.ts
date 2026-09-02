/**
 * Editor-side view of relationship metadata — what the UI collects when a
 * human links two notes, and how it becomes the `metadata` the reactor
 * stores on the `DocumentRelationship` row.
 *
 * Kept free of processor imports so the editor bundle never pulls indexer
 * code; a test pins this list to the processor's `EDGE_CONFIDENCE_LEVELS`.
 */

export const EDGE_CONFIDENCE_LEVELS = [
  "grounded",
  "established",
  "speculative",
] as const;

export type EdgeConfidence = (typeof EDGE_CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<EdgeConfidence, string> = {
  grounded: "Grounded — backed by evidence or a source",
  established: "Established — well accepted, not directly evidenced here",
  speculative: "Speculative — a hunch worth recording",
};

export type LinkArticulation = {
  /** "A connects to B because …" — the articulation test, in data. */
  reason: string;
  confidence: EdgeConfidence | null;
};

export function isEdgeConfidence(value: unknown): value is EdgeConfidence {
  return (
    typeof value === "string" &&
    (EDGE_CONFIDENCE_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * The metadata object for ADD_RELATIONSHIP / UPDATE_RELATIONSHIP, or
 * `undefined` when there is nothing to say (so the input omits the key).
 */
export function articulationToMetadata(
  articulation: Partial<LinkArticulation> | null | undefined,
): { reason?: string; confidence?: EdgeConfidence } | undefined {
  const reason = articulation?.reason?.trim();
  const confidence = articulation?.confidence ?? null;
  const out: { reason?: string; confidence?: EdgeConfidence } = {};
  if (reason) out.reason = reason;
  if (confidence) out.confidence = confidence;
  return Object.keys(out).length > 0 ? out : undefined;
}
