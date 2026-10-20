export const BARE_LINK_TYPES: ReadonlySet<string> = new Set([
  "CORE_IDEA",
  "CHILD_MOC",
]);

export const EDGE_CONFIDENCE = [
  "grounded",
  "established",
  "speculative",
] as const;
export type EdgeConfidence = (typeof EDGE_CONFIDENCE)[number];

const MIN_REASON_LENGTH = 20;
const PLACEHOLDERS = new Set([
  "because",
  "todo",
  "tbd",
  "related",
  "relates to",
  "n/a",
  "none",
]);

export function checkArticulation(input: {
  type: string;
  reason?: string;
  confidence?: string;
}): string | null {
  if (
    input.confidence !== undefined &&
    !(EDGE_CONFIDENCE as readonly string[]).includes(input.confidence)
  ) {
    return `confidence must be one of ${EDGE_CONFIDENCE.join(", ")}`;
  }
  if (BARE_LINK_TYPES.has(input.type)) return null;

  const reason = input.reason?.trim() ?? "";
  if (!reason) return `a reason is required for ${input.type} edges`;
  if (reason.length < MIN_REASON_LENGTH) {
    return `reason must be at least ${MIN_REASON_LENGTH} characters`;
  }
  const normalized = reason.toLowerCase().replace(/[.!?]+$/, "").trim();
  const typeName = input.type.toLowerCase().replace(/_/g, " ");
  const asWords = normalized.replace(/_/g, " ");
  if (
    PLACEHOLDERS.has(normalized) ||
    asWords === input.type.toLowerCase() ||
    asWords.startsWith(`${typeName} `)
  ) {
    return "reason must articulate why the link exists, not restate the link type";
  }
  return null;
}
