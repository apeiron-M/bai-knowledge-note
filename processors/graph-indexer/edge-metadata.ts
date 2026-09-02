/**
 * What an edge carries besides its endpoints and type.
 *
 * The reactor's `DocumentRelationship.metadata` (jsonb) is opaque: it stores
 * whatever `ADD_RELATIONSHIP` / `UPDATE_RELATIONSHIP` put there. The vault
 * gives it a shape so the articulation test — "A connects to B because
 * [specific reason]" — lives on the edge itself, in data, instead of only
 * in note prose where nothing can check it.
 *
 *   reason      the articulation, one or two sentences
 *   confidence  how well-founded the link is, mirroring the methodology
 *               files' vocabulary: grounded | established | speculative
 *
 * Unknown keys are kept verbatim (other apps may attach their own), but
 * only these two are read by the vault.
 */

export const EDGE_CONFIDENCE_LEVELS = [
  "grounded",
  "established",
  "speculative",
] as const;

export type EdgeConfidence = (typeof EDGE_CONFIDENCE_LEVELS)[number];

export type EdgeMetadata = {
  reason?: string;
  confidence?: EdgeConfidence;
  [key: string]: unknown;
};

export function isEdgeConfidence(value: unknown): value is EdgeConfidence {
  return (
    typeof value === "string" &&
    (EDGE_CONFIDENCE_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Accept whatever arrived on the wire and return the vault's view of it,
 * or `null` when there is nothing worth storing. A blank reason is no
 * reason; an unknown confidence is dropped rather than stored as a lie;
 * anything that is not an object is ignored.
 */
export function normalizeEdgeMetadata(input: unknown): EdgeMetadata | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const out: EdgeMetadata = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "reason") {
      const reason = typeof value === "string" ? value.trim() : "";
      if (reason) out.reason = reason;
    } else if (key === "confidence") {
      if (isEdgeConfidence(value)) out.confidence = value;
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Stable JSON for the `graph_edges.metadata` text column. */
export function serializeEdgeMetadata(metadata: EdgeMetadata | null): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

/** Inverse of `serializeEdgeMetadata`; tolerant of hand-written rows. */
export function parseEdgeMetadata(text: string | null | undefined): EdgeMetadata | null {
  if (!text) return null;
  try {
    return normalizeEdgeMetadata(JSON.parse(text));
  } catch {
    return null;
  }
}
