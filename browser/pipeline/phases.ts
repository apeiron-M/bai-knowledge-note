/**
 * The four phases of the browser pipeline: the desktop's own stages
 * (pieces/knowledge-vault/lib/agent), run against the in-page vault with the
 * visitor's AI. Each mirrors its action's run() in
 * pieces/knowledge-vault/lib/actions, without what the runner does around it:
 * claiming the task, holding the store's writes, and the handoff.
 */
import { gatherCandidates, proposeLinksStage, sourceNotes, writeLinksStage } from "../../pieces/knowledge-vault/lib/agent/connect.js";
import type { PipelinePhase } from "../../pieces/knowledge-vault/lib/agent/pipeline.js";
import { candidatesStage, checkVaultStage, draftStage, readSourceStage, reportStage } from "../../pieces/knowledge-vault/lib/agent/staged.js";
import { planStage, readMocs, writePlacementsStage } from "../../pieces/knowledge-vault/lib/agent/synthesize.js";
import { checkNote, readVerifyNotes } from "../../pieces/knowledge-vault/lib/agent/verify.js";
import { HOSTED_WINDOW_CHARS, LOCAL_WINDOW_CHARS, WindowCursor } from "../../pieces/knowledge-vault/lib/agent/windows.js";
import { writeStage } from "../../pieces/knowledge-vault/lib/agent/write.js";
import type { KnowledgeVaultClient } from "../../pieces/knowledge-vault/lib/common/client.js";
import type { PipelineAi } from "./ai.js";

export type PhaseContext = {
  client: KnowledgeVaultClient;
  drive: string;
  sourceId: string;
  ai: PipelineAi;
  /** The map this source's notes go into when no existing one fits: see {@link mapTitleFor}. */
  mapTitle: string;
  /**
   * Called once, right before the phase's first write: the runner holds the store's writes from
   * there to its handoff. Throws when the runner has stopped, so nothing is written after a stop.
   */
  beforeWrites?: () => void;
};

/**
 * What the handoff says. `incomplete`: what did not land, said beside `workDone`. `partial`: the
 * source was longer than one read, and only its first part became notes.
 */
export type PhaseOutcome = { workDone: string; filesModified: string[]; incomplete?: string; partial?: boolean };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const count = (n: number) => n.toLocaleString("en");

async function create(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { client, drive, sourceId, ai } = ctx;
  const read = await readSourceStage(client, drive, sourceId);
  // Already extracted — the phase stopped after its writes, or "Process again" after a later phase
  // failed: the notes stand, and extracting again would duplicate them.
  const existing = Math.max(read.extracted_claims, read.derived_notes);
  if (existing > 0) {
    // "Process again" puts the source back to EXTRACTING; its notes are in, so it is extracted.
    if (read.status === "INBOX" || read.status === "EXTRACTING") {
      ctx.beforeWrites?.();
      const steps = read.status === "INBOX" ? ["EXTRACTING", "EXTRACTED"] : ["EXTRACTED"];
      await client
        .request({ method: "POST", path: "actions", json: { documentId: read.source_id, actions: steps.map((status) => ({ type: "SET_SOURCE_STATUS", input: { status } })) } })
        .catch(() => undefined);
    }
    return { workDone: `Already extracted: ${plural(existing, "note")}.`, filesModified: [] };
  }
  if (read.stats_recorded && (read.status === "EXTRACTED" || read.status === "ARCHIVED")) return { workDone: "Already read: nothing in it to extract.", filesModified: [] };

  // One window of text: a long source costs one read, not ten. The rest stays in the source.
  const size = ai.local ? LOCAL_WINDOW_CHARS : HOSTED_WINDOW_CHARS;
  const cursor = new WindowCursor(read.text);
  const first = cursor.next(size)?.text ?? read.text;
  const partial = !cursor.done || read.chars > read.text.length;
  const bundle = { ...read, text: first };
  const candidates = await candidatesStage(ai.llm, ai.model, bundle, ai.fetchImpl, { windowChars: size });
  const checked = await checkVaultStage(client, drive, candidates);
  const draft = await draftStage(ai.llm, ai.model, bundle, checked, ai.fetchImpl, candidates.windows);
  const report = reportStage(ai.model, bundle, candidates, checked, draft);
  ctx.beforeWrites?.();
  const written = await writeStage(client, {
    drive,
    sourceId: read.source_id,
    sourceTitle: read.title,
    sourceStatus: read.status,
    model: ai.model,
    notes: draft.proposed,
    rejectedCount: report.skipped_count,
    skipRate: report.skip_rate,
    existing: draft.existing,
    archiveReason: report.archive_reason,
  });
  const part = partial ? ` (read the first ${count(first.length)} of ${count(read.chars)} characters)` : "";
  const also = written.linked_existing.length ? `, and linked ${plural(written.linked_existing.length, "note")} already in the vault` : "";
  return {
    workDone: written.archived ? `Found no knowledge in it, so it is archived${part}.` : `Extracted ${plural(written.written.length, "note")}${also}${part}.`,
    filesModified: [...written.note_ids, ...written.linked_existing],
    ...(written.incomplete ? { incomplete: written.incomplete } : {}),
    ...(partial ? { partial: true } : {}),
  };
}

async function reflect(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { client, drive, sourceId, ai } = ctx;
  const { notes } = await sourceNotes(client, drive, sourceId);
  if (notes.length === 0) return { workDone: "No notes to connect.", filesModified: [] };
  const candidates = await gatherCandidates(client, drive, notes);
  const proposed = await proposeLinksStage(ai.llm, ai.model, notes, candidates, ai.fetchImpl);
  ctx.beforeWrites?.();
  const written = await writeLinksStage(client, proposed.links);
  const made = written.written.length;
  const failed = written.failed.length;
  return {
    workDone: made
      ? `Connected ${plural(notes.length, "note")} with ${plural(made, "link")}, each with its reason.`
      : failed
        ? `Connected none of ${plural(notes.length, "note")}.`
        : `Found no links to make for ${plural(notes.length, "note")}.`,
    filesModified: notes.map((n) => n.id),
    ...(failed ? { incomplete: `${plural(failed, "link")} did not land` } : {}),
  };
}

async function reweave(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { client, drive, sourceId, ai } = ctx;
  const [{ notes }, tree] = await Promise.all([sourceNotes(client, drive, sourceId), readMocs(client, drive)]);
  if (notes.length === 0) return { workDone: "No notes to place.", filesModified: [] };
  // Notes that fit no map go into one named after their source, however few: in the browser a short
  // paste would otherwise land in the guide's unrelated map, or in none.
  const plan = await planStage(ai.llm, ai.model, notes, tree.mocs, ai.fetchImpl, { minNewTopic: 1, newTopicTitle: ctx.mapTitle });
  ctx.beforeWrites?.();
  const written = await writePlacementsStage(client, { drive, placements: plan.placements, newMocs: plan.new_mocs, coreIdeas: tree.coreIdeas });
  const fresh = plan.new_mocs[0] ? ` (new map: "${plan.new_mocs[0].title}")` : "";
  return {
    workDone: `Placed ${plan.placements.length} of ${plural(notes.length, "note")} in maps${fresh}.`,
    filesModified: [...notes.map((n) => n.id), ...written.created_mocs],
    ...(written.problems.length ? { incomplete: `${plural(written.problems.length, "placement")} did not land` } : {}),
  };
}

/** No model call: the checks that need none (the note rules, its links, its provenance, its map). */
async function verify(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { notes } = await readVerifyNotes(ctx.client, ctx.drive, ctx.sourceId);
  if (notes.length === 0) return { workDone: "No notes to check.", filesModified: [] };
  const flagged = notes.map((n) => checkNote(n, ctx.sourceId)).filter((issues) => issues.length > 0);
  const verdict = flagged.length ? `: ${flagged.length} need${flagged.length === 1 ? "s" : ""} a look — ${flagged[0][0]}` : ": all pass";
  return { workDone: `Checked ${plural(notes.length, "note")}${verdict}.`, filesModified: notes.map((n) => n.id) };
}

const PHASES: Record<PipelinePhase, (ctx: PhaseContext) => Promise<PhaseOutcome>> = { create, reflect, reweave, verify };

export function runPhase(phase: PipelinePhase, ctx: PhaseContext): Promise<PhaseOutcome> {
  return PHASES[phase](ctx);
}

export type TreeNode = { id: string; kind?: string | null; name?: string | null; parentFolder?: string | null };

/**
 * The map a source's notes go into when none fits: the file its sections came from — the intake
 * files a file's sections in a folder named after it, inside /sources — else the source itself.
 */
export function mapTitleFor(nodes: readonly TreeNode[], sourceId: string, sourceTitle: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const folder = byId.get(byId.get(sourceId)?.parentFolder ?? "");
  const name = folder?.name?.trim();
  return folder?.kind === "folder" && folder.parentFolder && name ? name : sourceTitle;
}
