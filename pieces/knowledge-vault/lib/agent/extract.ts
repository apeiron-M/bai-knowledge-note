import type { KnowledgeVaultClient } from "../common/client.js";
import type { AgentTool } from "./harness.js";

/**
 * `agent-extract` in dry-run mode: the tool-shaped edition of the
 * `/powerhouse-knowledge:extract` skill. The model reads the source, runs the
 * six gates, searches the vault, and PROPOSES notes; nothing is written. Each
 * proposal is checked against the same rules the vault enforces, so a proposal
 * that passes here is one the write path will accept.
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

export type ExtractState = {
  source: { id: string; title: string; chars: number; read: number } | null;
  proposed: ProposedNote[];
  skipped: SkippedCandidate[];
  existing: ExistingMatch[];
  rejectedProposals: number;
};

export const EXTRACT_SYSTEM = `You extract atomic knowledge claims from ONE source document into a Powerhouse knowledge vault.
This run is a DRY RUN: you PROPOSE notes with the tools; nothing is written.

Transform, do not harvest. A note that could be produced by copying from the source is a duplicate with worse provenance.

Method, in order:
1. Read the WHOLE source first with read_source (page with offset until "more" is false). A claim early on is often qualified later.
2. List candidate claims as sentences in your own words.
3. Run the six gates on each candidate. A claim must pass all six:
   1. sentence: the title completes "This note argues that ...". Not a label, heading or caption.
   2. transclusion: the title works as a clause: "Since [title], it follows that ...". Not a question or fragment.
   3. falsifiability: a competent practitioner could disagree with this specific assertion. "Quality matters" fails.
   4. coherence: statable in 1-3 sentences without "and also". Bundled claims are several notes.
   5. independence: holds for a reader who has never seen the source.
   6. non_attribution: asserts what is TRUE, not what the author said. Attribution lives in provenance.
   Not claims: excerpts, chapter summaries, headings, captions, anecdotes (they are evidence), bare numbers, structure restatements, definitions with no stake.
   Conditions travel inside the claim: "X improves Y only when Z; otherwise ..." rather than dropping the condition.
   Record every struck candidate with skip_candidate (the gate it failed and why).
4. Before proposing each survivor, search_vault for it. If the vault already holds the claim, do NOT propose a duplicate: call note_existing_evidence instead.
5. Propose each survivor with propose_note. Every field is required:
   - title: the claim as one declarative sentence.
   - description: at most 200 characters, a retrieval filter that adds information beyond the title (what holds -> why -> so what). Never paraphrase the title.
   - note_type: one of ${NOTE_TYPES.join(", ")}.
   - content: the argument, not the assertion again: the mechanism, the evidence from the source (quoted as evidence), the conditions under which it holds and when it does not, and what it lets a reader do or predict. Use real line breaks.
   - topics: 1-4 names; reuse the vault's vocabulary (list_topics) before inventing one.
   - confidence: grounded (the source demonstrates it), established (documented, widely agreed) or speculative (your inference).
   - locus: where in the source the claim comes from (section heading and paragraph), so a reader can check it.
   If propose_note answers with issues, fix them and propose again.
6. Zero notes is a valid result for a foreword, recap or glossary. Never propose a note to avoid an empty result; a high skip rate is a finding about the source.
7. Finish with a short plain-text summary: how many candidates, proposed, skipped and already in the vault, and anything the next phase (connecting notes) should know.`;

/** Tool arguments are model output: anything that is not text becomes its JSON. */
const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

export function extractTools(client: KnowledgeVaultClient, drive: string, sourceId: string, state: ExtractState): Record<string, AgentTool> {
  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: AgentTool["run"]): [string, AgentTool] => [
    name,
    { schema: { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }, run },
  ];
  return Object.fromEntries([
    tool("read_source", "Read the source's text, 12,000 characters at a time. Call with increasing offset until more is false.", { offset: { type: "integer", minimum: 0 } }, [], async (args) => {
      const doc = await client.request<{ name: string; state?: { global?: { title?: string; content?: string; sourceType?: string; status?: string } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } });
      const g = doc.state?.global ?? {};
      const text = g.content ?? "";
      const offset = Math.max(0, Number(args.offset ?? 0) || 0);
      const slice = text.slice(offset, offset + 12_000);
      state.source = { id: sourceId, title: g.title ?? doc.name, chars: text.length, read: Math.max(state.source?.read ?? 0, offset + slice.length) };
      return { title: g.title ?? doc.name, source_type: g.sourceType ?? null, status: g.status ?? null, total_chars: text.length, offset, text: slice, more: offset + slice.length < text.length };
    }),
    tool("list_topics", "The vault's topic vocabulary with note counts. Reuse these names.", {}, [], async () => {
      const body = await client.request<{ topics?: { name: string; noteCount: number }[] } | { name: string; noteCount: number }[]>({ path: "topics", query: { drive } });
      const topics = Array.isArray(body) ? body : (body.topics ?? []);
      return topics.sort((a, b) => b.noteCount - a.noteCount).slice(0, 150).map((t) => `${t.name} (${t.noteCount})`);
    }),
    tool("search_vault", "Semantic search over the vault's notes, to find whether a claim already exists.", { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"], async (args) => {
      const body = await client.request<{ hits: { node: { documentId?: string; title?: string; description?: string; status?: string }; similarity: number }[] }>({
        path: "search",
        query: { drive, q: text(args.query), mode: "semantic", limit: Math.min(10, Math.max(1, Number(args.limit ?? 5) || 5)), related: 0 },
      });
      return body.hits.filter((h) => h.node.status !== "MOC").map((h) => ({ id: h.node.documentId, title: h.node.title, description: h.node.description, similarity: Math.round(h.similarity * 1000) / 1000 }));
    }),
    tool("read_note", "Read one vault note as markdown, to compare it with a candidate claim.", { note_id: { type: "string" } }, ["note_id"], async (args) => {
      const md = await client.request<string>({ path: `notes/${encodeURIComponent(text(args.note_id))}.md`, query: { drive }, accept: "text/markdown" });
      return md.length > 6000 ? `${md.slice(0, 6000)}\n…(truncated)` : md;
    }),
    tool("propose_note", "Propose one atomic note (dry run: recorded, not written). Answers with issues to fix if any rule fails.", {
      title: { type: "string" },
      description: { type: "string" },
      note_type: { type: "string", enum: [...NOTE_TYPES] },
      content: { type: "string" },
      topics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
      confidence: { type: "string", enum: [...CONFIDENCE] },
      locus: { type: "string" },
    }, ["title", "description", "note_type", "content", "topics", "confidence", "locus"], async (args) => {
      const issues = checkProposal(args, state.proposed);
      if (issues.length) {
        state.rejectedProposals++;
        return { accepted: false, issues };
      }
      state.proposed.push(args as unknown as ProposedNote);
      return { accepted: true, proposed_so_far: state.proposed.length };
    }),
    tool("note_existing_evidence", "The vault already holds this claim: record the existing note and where this source supports it, instead of proposing a duplicate.", {
      note_id: { type: "string" },
      title: { type: "string" },
      locus: { type: "string" },
      reason: { type: "string" },
    }, ["note_id", "title", "locus", "reason"], async (args) => {
      state.existing.push({ note_id: text(args.note_id), title: text(args.title), locus: text(args.locus), reason: text(args.reason) });
      return { recorded: true };
    }),
    tool("skip_candidate", "Record a candidate claim you struck, and which gate it failed.", {
      candidate: { type: "string" },
      gate: { type: "string", enum: [...GATES] },
      reason: { type: "string" },
    }, ["candidate", "gate", "reason"], async (args) => {
      if (!GATES.includes(args.gate as (typeof GATES)[number])) return { recorded: false, issues: [`gate must be one of ${GATES.join(", ")}`] };
      state.skipped.push({ candidate: text(args.candidate), gate: args.gate as (typeof GATES)[number], reason: text(args.reason) });
      return { recorded: true, skipped_so_far: state.skipped.length };
    }),
  ]);
}

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
