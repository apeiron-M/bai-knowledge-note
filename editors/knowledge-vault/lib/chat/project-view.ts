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
import type { Deliverable, ProjectState } from "document-models/project";
import type {
  Goal,
  GoalStatus,
  WorkBreakdownStructureState,
} from "document-models/work-breakdown-structure";

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

export interface ProjectRendering {
  text: string;
  data: {
    /** The project document's id — what a citation of this outline points at. */
    documentId: string;
    documentType: "bai/project";
    title: string;
    status: ProjectState["status"];
    owner: string | null;
    targetDate: string | null;
    wbsRef: string | null;
    team: { name: string; role: string | null; kind: string | null }[];
    deliverables: {
      id: string;
      title: string;
      status: Deliverable["status"];
      goal: { id: string; description: string; status: GoalStatus } | null;
      url: string | null;
    }[];
    deliverableProgress: { delivered: number; total: number };
    goals: GoalProgress | null;
    knowledgeRefs: { documentId: string; title: string | null }[];
    references: string[];
  };
}

export function renderProject(o: {
  id: string;
  project: ProjectState;
  wbs: WorkBreakdownStructureState | null;
  /** Titles for `knowledgeRefs`, where the graph index knew them. */
  noteTitles: Map<string, string>;
}): ProjectRendering {
  const { project: p, wbs } = o;
  const goals = new Map((wbs?.goals ?? []).map((g) => [g.id, g]));
  const lines: string[] = [];

  const title = p.name ?? "(unnamed)";
  lines.push(`# Project: ${title} — ${p.status} [[${o.id}]]`);
  const meta: string[] = [];
  if (p.owner) meta.push(`Owner: ${p.owner}`);
  if (p.targetDate) meta.push(`Target: ${String(p.targetDate).slice(0, 10)}`);
  if (meta.length) lines.push(meta.join(" · "));
  if (p.description) lines.push("", p.description);

  lines.push("", "## Team");
  if (p.team.length === 0) lines.push("No team listed.");
  for (const t of p.team) {
    lines.push(
      `- ${t.name}${t.role ? ` — ${t.role}` : ""}${t.kind === "AGENT" ? " (agent)" : ""}`,
    );
  }

  lines.push("", "## Deliverables");
  const deliverables = p.deliverables.map((d) => {
    const g = d.goalRef ? goals.get(d.goalRef) : undefined;
    return {
      id: d.id,
      title: d.title,
      status: d.status,
      goal: g
        ? { id: g.id, description: g.description, status: g.status }
        : null,
      url: d.url ?? null,
    };
  });
  if (deliverables.length === 0) lines.push("No deliverables yet.");
  for (const d of deliverables) {
    const bits: string[] = [];
    if (d.goal) bits.push(`goal: ${d.goal.description} (${d.goal.status})`);
    if (d.url) bits.push(d.url);
    lines.push(
      `- [${d.status}] ${d.title}${bits.length ? ` — ${bits.join("; ")}` : ""}`,
    );
  }

  lines.push("");
  if (wbs) {
    const w = renderWbs(wbs, { id: p.wbsRef ?? "", projectName: p.name });
    lines.push(w.text.replace(/^# Work breakdown[^\n]*/, "## Work breakdown"));
  } else {
    lines.push("## Work breakdown", "No work breakdown linked.");
  }

  const knowledgeRefs = p.knowledgeRefs.map((id) => ({
    documentId: id,
    title: o.noteTitles.get(id) ?? null,
  }));
  if (knowledgeRefs.length > 0) {
    lines.push("", "## Linked knowledge");
    for (const k of knowledgeRefs)
      lines.push(`- ${k.title ? `${k.title} ` : ""}[[${k.documentId}]]`);
  }
  if (p.references.length > 0) {
    lines.push("", "## References", ...p.references.map((r) => `- ${r}`));
  }

  return {
    text: lines.join("\n"),
    data: {
      documentId: o.id,
      documentType: "bai/project",
      title,
      status: p.status,
      owner: p.owner ?? null,
      targetDate: p.targetDate ? String(p.targetDate) : null,
      wbsRef: p.wbsRef ?? null,
      team: p.team.map((t) => ({
        name: t.name,
        role: t.role ?? null,
        kind: t.kind ?? null,
      })),
      deliverables,
      deliverableProgress: {
        delivered: deliverables.filter((d) => d.status === "DELIVERED").length,
        total: deliverables.length,
      },
      goals: wbs ? goalProgress(wbs.goals) : null,
      knowledgeRefs,
      references: [...p.references],
    },
  };
}
