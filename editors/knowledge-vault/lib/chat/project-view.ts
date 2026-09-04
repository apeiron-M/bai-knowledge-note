/**
 * Readable renderings of a project and its work breakdown for the chat.
 *
 * A project's information lives in its arrays — deliverables joined to WBS
 * goals by `goalRef`, a goal tree flattened by `parentId`, knowledge refs back
 * into the vault — so paging its `description` and dumping the arrays as JSON
 * would hand the model the least useful parts first. These renderers produce
 * an outline the model can quote and a compact `data` shape it can reason
 * over. Pure functions; the tool layer does the fetching.
 */
import type {
  Goal,
  GoalStatus,
  WorkBreakdownStructureState,
} from "document-models/work-breakdown-structure";
import type { ScopeOfWorkState } from "document-models/scope-of-work";

export interface GoalNode {
  goal: Goal;
  children: GoalNode[];
}

/**
 * Nest a flat `parentId` list, preserving input order. A goal whose parent is
 * missing is promoted to a root rather than dropped: a stale reference should
 * cost the reader a level of indentation, not the goal itself.
 */
export function buildGoalTree(goals: Goal[]): GoalNode[] {
  const nodes = new Map(
    goals.map((g) => [g.id, { goal: g, children: [] as GoalNode[] }]),
  );
  const roots: GoalNode[] = [];
  for (const g of goals) {
    const node = nodes.get(g.id)!;
    const parent = g.parentId ? nodes.get(g.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface GoalProgress {
  completed: number;
  /** Goals that still count — WONT_DO is excluded from the denominator. */
  total: number;
  byStatus: Partial<Record<GoalStatus, number>>;
}

export function goalProgress(goals: Goal[]): GoalProgress {
  const byStatus: Partial<Record<GoalStatus, number>> = {};
  for (const g of goals) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
  const counting = goals.filter((g) => g.status !== "WONT_DO");
  return {
    completed: counting.filter((g) => g.status === "COMPLETED").length,
    total: counting.length,
    byStatus,
  };
}

function describe(goals: Map<string, Goal>, id: string): string {
  return goals.get(id)?.description ?? id.slice(0, 8);
}

function goalLines(
  nodes: GoalNode[],
  all: Map<string, Goal>,
  depth: number,
  out: string[],
): void {
  for (const { goal, children } of nodes) {
    const indent = "  ".repeat(depth);
    const bits: string[] = [];
    if (goal.assignee) bits.push(`@${goal.assignee}`);
    if (goal.blockReason) bits.push(`blocked: ${goal.blockReason}`);
    if (goal.outcome) bits.push(`outcome: ${goal.outcome}`);
    if (goal.dependencies.length > 0) {
      bits.push(
        `depends on: ${goal.dependencies.map((d) => describe(all, d)).join(", ")}`,
      );
    }
    out.push(
      `${indent}- [${goal.status}] ${goal.description}${bits.length ? ` — ${bits.join("; ")}` : ""}`,
    );
    for (const n of goal.notes) {
      out.push(
        `${indent}    note${n.author ? ` (${n.author})` : ""}: ${n.note}`,
      );
    }
    goalLines(children, all, depth + 1, out);
  }
}

export interface WbsRendering {
  text: string;
  data: {
    /** The WBS document's id — what a citation of this outline points at. */
    documentId: string;
    documentType: "bai/wbs";
    title: string;
    projectRef: string | null;
    owner: string | null;
    goalCount: number;
    progress: GoalProgress;
  };
}

export function renderWbs(
  wbs: WorkBreakdownStructureState,
  ctx: { id: string; projectName?: string | null },
): WbsRendering {
  const all = new Map(wbs.goals.map((g) => [g.id, g]));
  const progress = goalProgress(wbs.goals);
  const lines: string[] = [];
  const title = `Work breakdown${ctx.projectName ? ` for ${ctx.projectName}` : ""}`;
  // The id rides along in the text as a ready-made citation marker, so the
  // model cites the document it is reading rather than inventing a label.
  lines.push(`# ${title}${ctx.id ? ` [[${ctx.id}]]` : ""}`);
  if (wbs.owner) lines.push(`Owner: ${wbs.owner}`);
  lines.push(`${progress.completed}/${progress.total} goals completed`);
  lines.push("");
  if (wbs.goals.length === 0) lines.push("No goals yet.");
  else goalLines(buildGoalTree(wbs.goals), all, 0, lines);
  if (wbs.references.length > 0) {
    lines.push("", "References:", ...wbs.references.map((r) => `- ${r}`));
  }
  return {
    text: lines.join("\n"),
    data: {
      documentId: ctx.id,
      documentType: "bai/wbs",
      title,
      projectRef: wbs.projectRef ?? null,
      owner: wbs.owner ?? null,
      goalCount: wbs.goals.length,
      progress,
    },
  };
}

/**
 * `knowledgeRefs` / `references` are non-nullable in the schema, but a scope
 * written before the fields existed stores envelopes with neither. The cast is
 * the one place this file admits stored data can predate the schema.
 */
function envelopeList(
  env: { knowledgeRefs: string[]; references: string[] },
  key: "knowledgeRefs" | "references",
): string[] {
  return (env as Partial<Record<typeof key, string[]>>)[key] ?? [];
}

/* ── Scope of work ─────────────────────────────────────────────────────── */

export interface ScopeRendering {
  text: string;
  data: {
    documentId: string;
    documentType: "powerhouse/scopeofwork";
    title: string;
    status: ScopeOfWorkState["status"];
    envelopes: {
      id: string;
      code: string;
      title: string;
      owner: string | null;
      status: string;
      budget: number | null;
      currency: string | null;
      wbsRef: string | null;
      goals: GoalProgress | null;
      deliverables: { id: string; code: string; title: string; status: string; goal: string | null }[];
      knowledgeRefs: { documentId: string; title: string | null }[];
      references: string[];
    }[];
    deliverables: { delivered: number; total: number };
    milestones: { code: string; title: string; target: string; deliverables: number }[];
    contributors: string[];
  };
}

/**
 * A scope of work as one outline: envelopes (the projects) with their
 * deliverables joined to the WBS goal that delivers each, then the schedule
 * and the people. Everything citable in it is the scope document itself —
 * envelopes and deliverables have no documentId of their own; the linked
 * work breakdowns do.
 */
export function renderScope(o: {
  id: string;
  scope: ScopeOfWorkState;
  wbsById: Map<string, WorkBreakdownStructureState>;
  noteTitles: Map<string, string>;
}): ScopeRendering {
  const g = o.scope;
  const agent = new Map(g.contributors.map((c) => [c.id, c.name] as const));
  const byId = new Map(g.deliverables.map((d) => [d.id, d] as const));
  const lines: string[] = [];
  lines.push(`# Scope of work: ${g.title || "(untitled)"} — ${g.status} [[${o.id}]]`);
  if (g.description) lines.push("", g.description);

  const envelopes: ScopeRendering["data"]["envelopes"] = [];
  lines.push("", "## Projects (envelopes)");
  if (g.projects.length === 0) lines.push("No projects yet.");
  for (const env of g.projects) {
    const owner = env.projectOwner ? (agent.get(env.projectOwner) ?? env.projectOwner) : null;
    const wbs = env.wbsRef ? (o.wbsById.get(env.wbsRef) ?? null) : null;
    const goalById = new Map((wbs?.goals ?? []).map((x) => [x.id, x] as const));
    const ids = env.scope?.deliverables ?? [];
    const ds = ids.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
    lines.push("", `### ${env.code} · ${env.title}${owner ? ` — owner ${owner}` : ""} (${env.scope?.status ?? "DRAFT"})`);
    if (env.abstract) lines.push(env.abstract);
    if (env.budget) lines.push(`Budget: ${env.budget} ${env.currency ?? ""}`.trim());
    for (const d of ds) {
      const goal = d.goalRef ? goalById.get(d.goalRef) : undefined;
      lines.push(`- [${d.status}] ${d.code ? `${d.code} ` : ""}${d.title}${goal ? ` — goal: ${goal.description} (${goal.status})` : ""}`);
      for (const kr of d.keyResults) lines.push(`    ${kr.title}: ${kr.link}`);
    }
    if (ds.length === 0) lines.push("- No deliverables yet.");
    if (wbs) {
      const gp = goalProgress(wbs.goals);
      lines.push(`Work breakdown [[${env.wbsRef}]]: ${gp.completed}/${gp.total} goals completed`);
    } else if (env.wbsRef) {
      lines.push(`Work breakdown [[${env.wbsRef}]] (not loaded)`);
    }
    const refs = envelopeList(env, "knowledgeRefs");
    if (refs.length) lines.push("Knowledge: " + refs.map((r) => `${o.noteTitles.get(r) ?? "(untitled)"} [[${r}]]`).join("; "));
    const extRefs = envelopeList(env, "references");
    if (extRefs.length) lines.push("References: " + extRefs.join(", "));
    envelopes.push({
      id: env.id,
      code: env.code,
      title: env.title,
      owner,
      status: env.scope?.status ?? "DRAFT",
      budget: env.budget ?? null,
      currency: env.currency ?? null,
      wbsRef: env.wbsRef ?? null,
      goals: wbs ? goalProgress(wbs.goals) : null,
      deliverables: ds.map((d) => ({
        id: d.id,
        code: d.code,
        title: d.title,
        status: d.status,
        goal: d.goalRef ? (goalById.get(d.goalRef)?.description ?? null) : null,
      })),
      knowledgeRefs: refs.map((r) => ({ documentId: r, title: o.noteTitles.get(r) ?? null })),
      references: extRefs,
    });
  }

  const milestones: ScopeRendering["data"]["milestones"] = [];
  lines.push("", "## Schedule");
  for (const r of g.roadmaps) {
    lines.push(`Roadmap: ${r.title}`);
    for (const m of r.milestones) {
      const n = m.scope?.deliverables.length ?? 0;
      lines.push(`- ${m.sequenceCode} ${m.title} — ${m.deliveryTarget || "no date"} (${n} deliverable${n === 1 ? "" : "s"})`);
      milestones.push({ code: m.sequenceCode, title: m.title, target: m.deliveryTarget, deliverables: n });
    }
  }
  if (g.roadmaps.length === 0) lines.push("No roadmap yet.");

  lines.push("", "## Contributors");
  lines.push(g.contributors.length ? g.contributors.map((c) => c.name).join(", ") : "None listed.");

  return {
    text: lines.join("\n"),
    data: {
      documentId: o.id,
      documentType: "powerhouse/scopeofwork",
      title: g.title,
      status: g.status,
      envelopes,
      deliverables: {
        delivered: g.deliverables.filter((d) => d.status === "DELIVERED").length,
        total: g.deliverables.length,
      },
      milestones,
      contributors: g.contributors.map((c) => c.name),
    },
  };
}
