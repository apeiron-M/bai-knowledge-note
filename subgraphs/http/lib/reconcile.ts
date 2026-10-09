/**
 * Brings the pipeline queue back in line with what the vault already holds.
 *
 * A pipeline step does its work, then reports it to the queue. When the
 * report is lost — the run was cut off, the advance was refused, a step ran
 * on its own — the work stays in the vault and the queue keeps saying the
 * task waits for it. The next run then refuses (extract will not write a
 * source twice) or never comes (the trigger watches one phase). This planner
 * reads the evidence and says which phases are already done:
 *
 *   create   the source is EXTRACTED with notes or recorded stats (a 0-claim
 *            extraction is a result), or notes derive from it while it still
 *            says EXTRACTING with no stats (the write was cut off before the
 *            source was closed; the source is repaired, its stats are not
 *            invented)
 *   reflect  nothing to connect, or every note carries a knowledge link
 *   reweave  nothing to place, or every note is a CORE_IDEA of a MoC
 *   verify   nothing to verify; otherwise only the Verify step closes it
 *
 * It stops at the first phase it cannot prove, touches only PENDING claim
 * tasks (a held task belongs to whoever holds it, until it has been held far
 * longer than any step runs — then its run is gone), and treats a note the
 * graph index has not seen yet as unconnected and unplaced, so missing
 * evidence never proves more than is there. Pure: the route reads the vault
 * and dispatches; this decides.
 */

export const CLAIM_PHASES = ["create", "reflect", "reweave", "verify"] as const;
export type ClaimPhase = (typeof CLAIM_PHASES)[number];

/** Edge types that mean "connected": the knowledge links, not provenance or MoC structure. */
export const CONNECTING_LINK_TYPES = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"]);

export type ReconcileTask = {
  id: string;
  taskType: string;
  status: string;
  documentRef?: string | null;
  currentPhase?: string | null;
  target?: string | null;
  assignedTo?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** A step runs for an hour at most (the pipeline template's timeout); a task held this long has lost its run. */
export const ABANDONED_AFTER_MS = 2 * 60 * 60_000;

export type EvidenceNote = {
  id: string;
  /** False when the graph index does not have the note yet: it then proves nothing. */
  indexed: boolean;
  linked: boolean;
  placed: boolean;
};

export type SourceEvidence = {
  id: string;
  title: string;
  status: string | null;
  statsRecorded: boolean;
  /** Live (not archived) notes from the source: the ones it lists and the ones linking to it with DERIVED_FROM. */
  notes: EvidenceNote[];
  /** Notes that link to the source with DERIVED_FROM but are not in its extractedClaims. */
  unlisted: string[];
};

export type Handoff = { phase: ClaimPhase; workDone: string; filesModified: string[] };
export type TaskPlan = {
  taskId: string;
  sourceId: string;
  title: string;
  from: ClaimPhase;
  /** The phase the task ends at, or "done" when the last phase was proven. */
  to: ClaimPhase | "done";
  handoffs: Handoff[];
};
export type SourceRepair = { sourceId: string; title: string; addClaims: string[]; close: boolean };
export type LeftAlone = { taskId: string; sourceId: string | null; phase: string | null; reason: string };
export type ReconcilePlan = { tasks: TaskPlan[]; sources: SourceRepair[]; left: LeftAlone[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isClaimPhase = (p: unknown): p is ClaimPhase => typeof p === "string" && (CLAIM_PHASES as readonly string[]).includes(p);

/** What the vault proves about the source's extraction, and the repair a cut-off write needs. */
function extraction(e: SourceEvidence): { done: false; reason: string } | { done: true; workDone: string; repair: SourceRepair | null } {
  const n = e.notes.length;
  const repair = (close: boolean): SourceRepair | null =>
    e.unlisted.length || close ? { sourceId: e.id, title: e.title, addClaims: e.unlisted, close } : null;
  if (e.status === "EXTRACTED" && (n > 0 || e.statsRecorded)) {
    return {
      done: true,
      workDone: n > 0 ? `Found in the vault: ${plural(n, "note")} extracted from the source.` : "Found in the vault: the extraction ran and found no claims in the source.",
      repair: repair(false),
    };
  }
  if (e.status === "EXTRACTING" && n > 0 && !e.statsRecorded) {
    return {
      done: true,
      workDone: `Found in the vault: ${plural(n, "note")} extracted from the source, which was never closed. The source now lists them and reads EXTRACTED; its extraction stats were lost with the run.`,
      repair: repair(true),
    };
  }
  if (e.status === "EXTRACTING" && n > 0) return { done: false, reason: "the source was queued again after an extraction; archive its notes to extract it again" };
  return { done: false, reason: "the source has not been extracted yet" };
}

function proves(phase: ClaimPhase, e: SourceEvidence): { done: false; reason: string } | { done: true; workDone: string } {
  const notes = e.notes;
  const ids = notes.map((x) => x.id);
  switch (phase) {
    case "reflect": {
      if (notes.length === 0) return { done: true, workDone: "The source yielded no notes, so there was nothing to connect." };
      const open = notes.filter((x) => !x.indexed || !x.linked).length;
      return open === 0
        ? { done: true, workDone: notes.length === 1 ? "Found in the vault: the note carries typed links." : `Found in the vault: all ${notes.length} notes carry typed links.` }
        : { done: false, reason: `${plural(open, "note")} not connected yet` };
    }
    case "reweave": {
      if (notes.length === 0) return { done: true, workDone: "The source yielded no notes, so there was nothing to place." };
      const open = notes.filter((x) => !x.indexed || !x.placed).length;
      return open === 0
        ? { done: true, workDone: notes.length === 1 ? "Found in the vault: the note is a core idea of a MoC." : `Found in the vault: all ${notes.length} notes are core ideas of a MoC.` }
        : { done: false, reason: `${plural(open, "note")} not in a MoC yet` };
    }
    case "verify":
      return notes.length === 0
        ? { done: true, workDone: "The source yielded no notes, so there was nothing to verify." }
        : { done: false, reason: `the Verify step closes the task once it has checked the ${ids.length === 1 ? "note" : "notes"}` };
    default:
      return { done: false, reason: "unknown phase" };
  }
}

/** The phases each pending task can move past, and the source repairs that go first. */
/** Whether a held task's run is gone: held for longer than any step runs. */
export function isAbandoned(t: ReconcileTask, now: number, afterMs = ABANDONED_AFTER_MS): boolean {
  const since = Date.parse(t.updatedAt ?? t.createdAt ?? "");
  return t.status === "IN_PROGRESS" && Number.isFinite(since) && now - since >= afterMs;
}

export function planReconcile(
  tasks: readonly ReconcileTask[],
  evidence: ReadonlyMap<string, SourceEvidence>,
  options: { now?: number; abandonedAfterMs?: number } = {},
): ReconcilePlan {
  const plan: ReconcilePlan = { tasks: [], sources: [], left: [] };
  const repaired = new Set<string>();
  for (const t of tasks) {
    if (t.taskType !== "claim" || (t.status !== "PENDING" && t.status !== "IN_PROGRESS")) continue;
    const sourceId = t.documentRef ?? null;
    const phase = t.currentPhase ?? null;
    const leave = (reason: string) => plan.left.push({ taskId: t.id, sourceId, phase, reason });
    const abandoned = options.now !== undefined && isAbandoned(t, options.now, options.abandonedAfterMs);
    if (t.status === "IN_PROGRESS" && !abandoned) {
      leave(`held by ${t.assignedTo ?? "someone"}; whoever holds it reports it`);
      continue;
    }
    if (!sourceId) {
      leave("the task names no source");
      continue;
    }
    const e = evidence.get(sourceId);
    if (!e) {
      leave("the source is not in this vault");
      continue;
    }
    if (!isClaimPhase(phase)) {
      leave(`the task is at an unknown phase (${phase ?? "none"})`);
      continue;
    }
    const handoffs: Handoff[] = [];
    let at: ClaimPhase | "done" = phase;
    let stop: string | null = null;
    for (const p of CLAIM_PHASES.slice(CLAIM_PHASES.indexOf(phase))) {
      if (p === "create") {
        const x = extraction(e);
        if (!x.done) {
          stop = x.reason;
          break;
        }
        if (x.repair && !repaired.has(e.id)) {
          plan.sources.push(x.repair);
          repaired.add(e.id);
        }
        handoffs.push({ phase: p, workDone: x.workDone, filesModified: e.notes.map((n) => n.id) });
      } else {
        const x = proves(p, e);
        if (!x.done) {
          stop = x.reason;
          break;
        }
        handoffs.push({ phase: p, workDone: x.workDone, filesModified: e.notes.map((n) => n.id) });
      }
      at = CLAIM_PHASES.at(CLAIM_PHASES.indexOf(p) + 1) ?? "done";
    }
    if (handoffs.length && abandoned) {
      handoffs[0] = { ...handoffs[0], workDone: `${handoffs[0].workDone} (The task had been held by ${t.assignedTo ?? "someone"} since ${t.updatedAt ?? t.createdAt}; that run is gone.)` };
    }
    if (handoffs.length) plan.tasks.push({ taskId: t.id, sourceId, title: e.title, from: phase, to: at, handoffs });
    else leave(abandoned ? `held by ${t.assignedTo ?? "someone"} since ${t.updatedAt ?? t.createdAt}, and ${stop ?? "nothing to do"}` : (stop ?? "nothing to do"));
  }
  return plan;
}
