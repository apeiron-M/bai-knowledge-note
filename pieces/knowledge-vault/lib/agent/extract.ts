
/**
 * The extract skill's vocabulary and the vault's rules for a note, shared by
 * the extract-claims stages: a draft that passes checkProposal is one the
 * write path will accept.
 */

/** The v2 `NoteType` enum (document-models/knowledge-note/v2); a test pins them equal. */
export const NOTE_TYPES = ["ARCHITECTURE", "BUG_PATTERN", "CONCEPT", "DECISION", "INTEGRATION", "OBSERVATION", "PATTERN", "PROCEDURE", "REFERENCE", "WORKFLOW"] as const;
export const CONFIDENCE = ["grounded", "established", "speculative"] as const;
export const GATES = ["sentence", "transclusion", "falsifiability", "coherence", "independence", "non_attribution", "out_of_scope", "duplicate"] as const;

export type ProposedNote = {
  title: string;
  description: string;
  note_type: (typeof NOTE_TYPES)[number];
  content: string;
  topics: string[];
  confidence: (typeof CONFIDENCE)[number];
  locus: string;
};
export type SkippedCandidate = { candidate: string; gate: (typeof GATES)[number]; reason: string };
export type ExistingMatch = { note_id: string; title: string; locus: string; reason: string };

/** The vault's own rules, checked before a proposal is accepted. */
export function checkProposal(args: Record<string, unknown>, already: ProposedNote[]): string[] {
  const issues: string[] = [];
  const str = (k: string) => (typeof args[k] === "string" ? (args[k]).trim() : "");
  const title = str("title");
  const description = str("description");
  if (!title) issues.push("title is required: the claim as one declarative sentence");
  else if (title.endsWith("?")) issues.push("title is a question; state the claim instead (gate 2)");
  if (!description) issues.push("description is required");
  // JavaScript counts UTF-16 units, which is what the vault's 200 limit counts.
  else if (description.length > 200) issues.push(`description is ${description.length} characters; the vault's limit is 200`);
  if (description && description.toLowerCase() === title.toLowerCase()) issues.push("description repeats the title; it must add information");
  if (!NOTE_TYPES.includes(args.note_type as (typeof NOTE_TYPES)[number])) issues.push(`note_type must be one of ${NOTE_TYPES.join(", ")}`);
  if (str("content").length < 80) issues.push("content is too thin: give the mechanism, the evidence and the conditions");
  if (/\\[ntr]/.test(str("content"))) issues.push("content contains a literal backslash escape (\\n); use real line breaks");
  const topics = Array.isArray(args.topics) ? args.topics.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  if (topics.length === 0) issues.push("at least one topic is required");
  if (!CONFIDENCE.includes(args.confidence as (typeof CONFIDENCE)[number])) issues.push(`confidence must be one of ${CONFIDENCE.join(", ")}`);
  if (!str("locus")) issues.push("locus is required: where in the source the claim comes from");
  if (title && already.some((p) => p.title.trim().toLowerCase() === title.toLowerCase())) issues.push("a note with this title is already proposed in this run");
  return issues;
}
