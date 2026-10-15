import { randomUUID } from "node:crypto";
import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage, KnowledgeVaultApiError } from "../common/errors.js";

/** The start of the reason a convergence link carries; Connect, Place and Verify tell a converged note by it. */
export const CONVERGENCE_REASON_PREFIX = "Also argued in";

/**
 * Write mode for extract-claims: the drafted notes are created in
 * /knowledge/notes and submitted for review (IN_REVIEW), each linked to its
 * source with a DERIVED_FROM edge that carries where in the source it came
 * from, and the source records what was extracted and moves to EXTRACTED.
 * Nothing is approved: approval must come from someone other than the
 * submitter, so it stays with a person in the app. Every write goes through the vault's REST routes, so the
 * server-side lint, placement and read-back apply as they do for a person.
 */

export type NoteToWrite = {
  title: string;
  description: string;
  note_type: string;
  content: string;
  topics: string[];
  confidence: string;
  locus: string;
};

export type WrittenNote = { id: string; title: string; linked: boolean; problems: string[] };

type Operation = { index: number; type: string; error?: string | null };
type CreatedNote = { id: string; name: string; readBack: string; operations: Operation[] };

const BATCH = 25;
/** Stats this extractor writes carry its mark, so the desktop app's one-time re-run can tell them from the old extractor's. */
export const EXTRACTOR_MARK = "extract-claims 2";
/** A claim the vault already holds as a note: it is linked to this source too. */
export type LinkedClaim = { note_id: string; title: string; locus: string; evidence: string };

/** A readable, collision-tolerant document name; the drive renames on collision. */
export function slugFor(title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return "note";
  if (slug.length <= 72) return slug;
  // Too long: cut at the last whole word that fits.
  const cut = slug.slice(0, 72);
  return slug[72] === "-" ? cut : cut.replace(/-[^-]*$/, "") || cut;
}

/**
 * Refuse a source that already has extracted notes: a rerun would duplicate
 * them. Two records are checked, because a step stopped halfway leaves notes
 * linked to the source (DERIVED_FROM) that the source does not list yet.
 */
export function assertWritable(bundle: { title: string; status: string | null; extracted_claims: number; derived_notes?: number }): void {
  const existing = Math.max(bundle.extracted_claims, bundle.derived_notes ?? 0);
  if (existing > 0) {
    throw new KnowledgeVaultApiError(
      `"${bundle.title}" already has ${existing} extracted note${existing === 1 ? "" : "s"}; writing again would duplicate them. Run in dry-run mode, or archive the earlier notes first.`,
      { category: "validation" },
    );
  }
  if (bundle.status === "ARCHIVED") throw new KnowledgeVaultApiError(`"${bundle.title}" is archived`, { category: "validation" });
}

export async function writeStage(
  client: KnowledgeVaultClient,
  args: { drive: string; sourceId: string; sourceTitle: string; sourceStatus?: string | null; model: string; notes: NoteToWrite[]; rejectedCount: number; skipRate: number; existing?: LinkedClaim[]; archiveReason?: string | null; now?: () => Date },
) {
  const now = () => (args.now ?? (() => new Date()))().toISOString();
  const author = `extract-claims · ${args.model}`;
  const written: WrittenNote[] = [];

  for (let i = 0; i < args.notes.length; i += BATCH) {
    const batch = args.notes.slice(i, i + BATCH);
    const at = now();
    const body = await client.request<{ notes: CreatedNote[] }>({
      method: "POST",
      path: "notes",
      timeoutMs: 120_000,
      json: {
        drive: args.drive,
        notes: batch.map((n) => ({
          name: slugFor(n.title),
          actions: [
            { type: "SET_TITLE", input: { title: n.title, updatedAt: at } },
            { type: "SET_DESCRIPTION", input: { description: n.description, updatedAt: at } },
            { type: "SET_NOTE_TYPE", input: { noteType: n.note_type, updatedAt: at } },
            { type: "SET_CONTENT", input: { content: n.content, updatedAt: at } },
            ...n.topics.map((name) => ({ type: "ADD_TOPIC", input: { id: randomUUID(), name } })),
            { type: "SET_METADATA_FIELD", input: { field: "confidence", value: n.confidence, updatedAt: at } },
            { type: "SET_PROVENANCE", input: { author, sourceOrigin: "DERIVED", createdAt: at } },
            // Straight into the review queue, last: a rejected field above does not block it.
            { type: "SUBMIT_FOR_REVIEW", input: { id: randomUUID(), actor: author, timestamp: at, comment: `Extracted from "${args.sourceTitle}" (${n.locus || "the source"}) by ${args.model}. Check the claim, its type and topics, then approve.` } },
          ],
        })),
      },
    });
    const fresh: WrittenNote[] = body.notes.map((created, k) => {
      const problems = created.operations.filter((o) => o.error).map((o) => `${o.type}: ${o.error}`);
      if (created.readBack !== "confirmed") problems.push(`read-back ${created.readBack}`);
      return { id: created.id, title: batch[k]?.title ?? created.name, linked: false, problems };
    });
    written.push(...fresh);
    // Recorded on the source at once (idempotent), so a step stopped from
    // here on still leaves the source saying what it produced.
    await client
      .request({ method: "POST", path: "actions", timeoutMs: 60_000, json: { documentId: args.sourceId, actions: fresh.map((n) => ({ type: "ADD_EXTRACTED_CLAIM", input: { claimRef: n.id } })) } })
      .catch(() => undefined);
  }

  // Provenance edge per note: the reason says where in the source it came from.
  for (const [k, note] of written.entries()) {
    const locus = args.notes[k]?.locus || "the source";
    try {
      await client.request({
        method: "POST",
        path: "relationships",
        json: { source: note.id, target: args.sourceId, type: "DERIVED_FROM", reason: `Extracted from "${args.sourceTitle}": ${locus}`, confidence: "grounded" },
      });
      note.linked = true;
    } catch (error) {
      note.problems.push(`DERIVED_FROM link: ${errorMessage(error)}`);
    }
  }

  // A claim the vault already holds: the existing note gains this source too. Its text is not touched.
  const linkedExisting: string[] = [];
  const existingProblems: string[] = [];
  const handled = new Set<string>(written.map((n) => n.id));
  for (const e of args.existing ?? []) {
    if (handled.has(e.note_id)) continue;
    handled.add(e.note_id);
    try {
      await client.request({
        method: "POST",
        path: "relationships",
        json: { source: e.note_id, target: args.sourceId, type: "DERIVED_FROM", reason: `${CONVERGENCE_REASON_PREFIX} "${args.sourceTitle}" (${e.locus || "the source"})${e.evidence ? `: "${e.evidence}"` : ""}`.slice(0, 900), confidence: "grounded" },
      });
      linkedExisting.push(e.note_id);
    } catch (error) {
      existingProblems.push(`${e.title || e.note_id}: ${errorMessage(error)}`);
    }
  }

  // The source's side: every claim it makes (new notes and linked ones), the stats, and its status.
  const claims = [...written.map((n) => n.id), ...linkedExisting];
  const archive = !!args.archiveReason && claims.length === 0 && existingProblems.length === 0;
  const at = now();
  let sourceUpdated = true;
  let sourceProblem: string | null = null;
  try {
    const result = await client.request<{ operations: Operation[] }>({
      method: "POST",
      path: "actions",
      timeoutMs: 60_000,
      json: {
        documentId: args.sourceId,
        actions: [
          // Listed before the stats: the source refuses a claim count its list does not match.
          ...claims.map((claimRef) => ({ type: "ADD_EXTRACTED_CLAIM", input: { claimRef } })),
          // A source that was never queued is still in INBOX, which cannot move straight to EXTRACTED.
          ...(args.sourceStatus === null || args.sourceStatus === "INBOX" ? [{ type: "SET_SOURCE_STATUS", input: { status: "EXTRACTING" } }] : []),
          { type: "RECORD_EXTRACTION_STATS", input: { claimCount: claims.length, skippedCount: args.rejectedCount, skipRate: args.skipRate, extractedAt: at, extractedBy: `${EXTRACTOR_MARK} · ${args.model}` } },
          { type: "SET_SOURCE_STATUS", input: { status: archive ? "ARCHIVED" : "EXTRACTED" } },
        ],
      },
    });
    const errors = result.operations.filter((o) => o.error);
    if (errors.length) {
      sourceUpdated = false;
      sourceProblem = errors.map((o) => `${o.type}: ${o.error}`).join("; ");
    }
  } catch (error) {
    sourceUpdated = false;
    sourceProblem = errorMessage(error);
  }

  const withProblems = written.filter((n) => n.problems.length);
  const linked = written.filter((n) => n.linked).length;
  // What must hold for the create phase to count as done.
  const incomplete = !sourceUpdated
    ? "the source was not updated"
    : linked < written.length
      ? `${written.length - linked} note${written.length - linked === 1 ? " is" : "s are"} not linked to the source`
      : existingProblems.length
        ? `${existingProblems.length} note${existingProblems.length === 1 ? "" : "s"} already in the vault could not be linked to the source`
        : null;
  const status = archive ? `the source is archived: ${args.archiveReason}` : "the source is marked EXTRACTED";
  const also = linkedExisting.length ? `; ${linkedExisting.length} note${linkedExisting.length === 1 ? "" : "s"} already in the vault now also link${linkedExisting.length === 1 ? "s" : ""} to it` : "";
  return {
    incomplete,
    summary:
      (archive ? `Nothing in "${args.sourceTitle}" is knowledge` : `Wrote ${written.length} note${written.length === 1 ? "" : "s"} to /knowledge/notes, submitted for review, ${linked} linked to the source${also}`) +
      (sourceUpdated ? `; ${status}.` : `; the source was NOT updated (${sourceProblem}).`) +
      (withProblems.length ? ` ${withProblems.length} note${withProblems.length === 1 ? " has" : "s have"} problems: see written.` : "") +
      (existingProblems.length ? ` ${existingProblems.length} existing note${existingProblems.length === 1 ? "" : "s"} could not be linked: ${existingProblems.join("; ")}.` : ""),
    written,
    note_ids: written.map((n) => n.id),
    linked_count: linked,
    linked_existing: linkedExisting,
    existing_problems: existingProblems,
    archived: archive && sourceUpdated,
    source_updated: sourceUpdated,
    source_problem: sourceProblem,
    problem_count: withProblems.length,
  };
}
