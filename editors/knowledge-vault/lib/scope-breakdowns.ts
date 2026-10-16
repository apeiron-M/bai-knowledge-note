/**
 * The work breakdowns (bai/wbs) around a scope of work. Which deliver it — its
 * projects' `wbsRef`, and any breakdown whose `sowRef` names it — which are
 * left outside any scope, and what each holds, so deleting a scope never
 * leaves a breakdown pointing at nothing (spec §7).
 *
 * Unlinking uses the model's own SET_SOW_PROJECT_REF with both fields null —
 * the state the model calls "not yet compiled into a scope" — so there is no
 * new operation.
 */
import type { VaultAction } from "./remote-reactor.js";

export type BreakdownRow = {
  id: string;
  name: string;
  /** The scope it says it delivers; null when unlinked. */
  sowRef: string | null;
  goals: number;
  /** COMPLETED */
  done: number;
  /** IN_PROGRESS, IN_REVIEW or BLOCKED */
  active: number;
  /** WONT_DO */
  dropped: number;
  /** Notes on its goals, all of them. */
  notes: number;
};

type GoalLike = { status?: unknown; notes?: unknown };
const ACTIVE = new Set(["IN_PROGRESS", "IN_REVIEW", "BLOCKED"]);

/** A breakdown's row, from its document's name and global state. */
export function breakdownRow(
  id: string,
  name: string,
  global: Record<string, unknown> | null | undefined,
): BreakdownRow {
  const g = global ?? {};
  const goals: GoalLike[] = Array.isArray(g.goals) ? (g.goals as GoalLike[]) : [];
  return {
    id,
    name,
    sowRef: typeof g.sowRef === "string" && g.sowRef ? g.sowRef : null,
    goals: goals.length,
    done: goals.filter((x) => x.status === "COMPLETED").length,
    active: goals.filter((x) => typeof x.status === "string" && ACTIVE.has(x.status)).length,
    dropped: goals.filter((x) => x.status === "WONT_DO").length,
    notes: goals.reduce((n, x) => n + (Array.isArray(x.notes) ? x.notes.length : 0), 0),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (xs: readonly string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** "3 goals, none done" · "2 goals, 1 done" · "1 goal, all done" · "No goals yet" */
export function breakdownProgress(b: BreakdownRow): string {
  if (b.goals === 0) return "No goals yet";
  const done = b.done === 0 ? "none" : b.done === b.goals ? "all" : String(b.done);
  return `${count(b.goals, "goal")}, ${done} done`;
}

/**
 * The breakdowns that deliver a scope: each project's breakdown, in project
 * order, then any other whose `sowRef` names the scope — once each, and only
 * those still in the vault.
 */
export function breakdownsOfScope(
  scopeId: string,
  projectWbsRefs: readonly (string | null | undefined)[],
  breakdowns: readonly BreakdownRow[],
): BreakdownRow[] {
  const byId = new Map(breakdowns.map((b) => [b.id, b] as const));
  const out: BreakdownRow[] = [];
  const seen = new Set<string>();
  const add = (b: BreakdownRow | undefined) => {
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
  };
  for (const ref of projectWbsRefs) if (ref) add(byId.get(ref));
  for (const b of breakdowns) if (b.sowRef === scopeId) add(b);
  return out;
}

/**
 * Breakdowns outside any scope: `sowRef` empty, or naming no scope in this
 * vault — and held by no scope's project. By name.
 */
export function breakdownsOutsideScopes(
  breakdowns: readonly BreakdownRow[],
  scopeIds: ReadonlySet<string>,
  heldByScopes: ReadonlySet<string>,
): BreakdownRow[] {
  return breakdowns
    .filter((b) => !heldByScopes.has(b.id) && (!b.sowRef || !scopeIds.has(b.sowRef)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What deleting these breakdowns takes beyond goals still to do — "5 goals
 * done and 9 notes would be deleted with them." — or null when nothing was
 * recorded.
 */
export function recordedWorkLine(rows: readonly BreakdownRow[], withWhat: "them" | "it"): string | null {
  const sum = (pick: (b: BreakdownRow) => number) => rows.reduce((n, b) => n + pick(b), 0);
  const done = sum((b) => b.done);
  const active = sum((b) => b.active);
  const dropped = sum((b) => b.dropped);
  const notes = sum((b) => b.notes);
  const parts = [
    done ? `${count(done, "goal")} done` : null,
    active ? `${count(active, "goal")} in progress` : null,
    dropped ? `${count(dropped, "goal")} dropped` : null,
    notes ? count(notes, "note") : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${andList(parts)} would be deleted with ${withWhat}.` : null;
}

/** SET_SOW_PROJECT_REF with both fields null: the breakdown stays, outside any scope. */
export function unlinkBreakdownAction(): VaultAction {
  return { type: "SET_SOW_PROJECT_REF", scope: "global", input: { sowRef: null, sowProjectId: null } };
}

export type ScopeDeleteDeps = {
  deleteDocument: (id: string) => Promise<void>;
  /** Write `unlinkBreakdownAction()` to the breakdown. */
  unlinkBreakdown: (id: string) => Promise<void>;
  /** Told as each document goes, so the view drops it even when a later step fails. */
  onDeleted: (id: string) => void;
};

/**
 * Delete a scope of work: its breakdowns first — deleted, or unlinked — then
 * the scope. The first failure stops the rest and is thrown; the scope is
 * deleted last, so a failure never leaves a breakdown pointing at nothing.
 */
export async function deleteScopeOfWork(
  scopeId: string,
  breakdownIds: readonly string[],
  alsoDeleteBreakdowns: boolean,
  deps: ScopeDeleteDeps,
): Promise<void> {
  for (const id of breakdownIds) {
    if (alsoDeleteBreakdowns) {
      await deps.deleteDocument(id);
      deps.onDeleted(id);
    } else {
      await deps.unlinkBreakdown(id);
    }
  }
  await deps.deleteDocument(scopeId);
  deps.onDeleted(scopeId);
}
