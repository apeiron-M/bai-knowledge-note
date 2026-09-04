/**
 * Readable outlines of a scope of work and of a work breakdown.
 *
 * Both documents keep their information in arrays — envelopes funding
 * deliverables, deliverables quoted in units and joined to WBS goals by
 * `goalRef`, a goal tree flattened by `parentId` — so neither has a prose body
 * a search index could embed or a chat could quote. These renderers produce
 * that body: one Markdown outline a person can read, a model can quote, and
 * the graph indexer stores as the node's `content` (what full-text and
 * semantic search run over), plus a compact `data` shape the chat tools return
 * alongside it. One renderer, two consumers, so what search finds and what the
 * chat reads are the same text.
 *
 * Pure functions over document state. The joins that need other documents —
 * the linked work breakdowns, the titles of cited notes — are passed in as
 * maps; an empty map degrades to ids, which is what the indexer (one document
 * at a time) wants. An empty `id` omits the `[[id]]` citation markers.
 *
 * Progress and money mirror the reducers and the scope-of-work editor's
 * `lib/model.ts` (`rollup`, `costOf`, `budgetOf`, `isQuoted`); keep them in
 * step so the chat quotes the numbers the UI shows.
 */
import type {
  Goal,
  GoalStatus,
  WorkBreakdownStructureState,
} from "document-models/work-breakdown-structure";
import type {
  Deliverable,
  DeliverablesSet,
  Project,
  ScopeOfWorkState,
} from "document-models/scope-of-work";

/* ── goals ──────────────────────────────────────────────────────────────── */

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

/**
 * The phase a work breakdown is in, derived from its goals — the document
 * has no status of its own. WONT_DO goals are ignored; an empty tree is TODO.
 */
export type WbsPhase = "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED";

export function wbsPhase(goals: Goal[]): WbsPhase {
  const live = goals.filter((g) => g.status !== "WONT_DO");
  if (live.length === 0) return "TODO";
  if (live.every((g) => g.status === "COMPLETED")) return "COMPLETED";
  if (live.some((g) => g.status === "BLOCKED")) return "BLOCKED";
  if (live.some((g) => g.status !== "TODO")) return "IN_PROGRESS";
  return "TODO";
}

const GOAL_STATUS_WORDS: [GoalStatus, string][] = [
  ["COMPLETED", "completed"],
  ["IN_REVIEW", "in review"],
  ["IN_PROGRESS", "in progress"],
  ["BLOCKED", "blocked"],
  ["TODO", "to do"],
  ["WONT_DO", "won't do"],
];

/** "42 goals: 12 completed, 3 in progress, 1 blocked, 26 to do" */
export function goalSummary(goals: Goal[]): string {
  const { byStatus } = goalProgress(goals);
  const parts = GOAL_STATUS_WORDS.filter(([s]) => byStatus[s]).map(
    ([s, word]) => `${byStatus[s]} ${word}`,
  );
  const n = goals.length;
  return `${n} goal${n === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
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
    /** The scope of work and envelope this tree delivers, when compiled into one. */
    sowRef: string | null;
    sowProjectId: string | null;
    /** Legacy pointer to a retired `bai/project`; kept so old data stays readable. */
    projectRef: string | null;
    owner: string | null;
    goalCount: number;
    phase: WbsPhase;
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
  if (wbs.sowRef) {
    lines.push(
      `Delivers ${ctx.projectName ? `"${ctx.projectName}"` : "an envelope"} in scope of work [[${wbs.sowRef}]]`,
    );
  }
  if (wbs.owner) lines.push(`Owner: ${wbs.owner}`);
  const breakdown = goalSummary(wbs.goals).replace(/^\d+ goals?/, "").replace(/^: /, "");
  lines.push(
    `${progress.completed}/${progress.total} goals completed${breakdown ? ` (${breakdown})` : ""}`,
  );
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
      sowRef: wbs.sowRef ?? null,
      sowProjectId: wbs.sowProjectId ?? null,
      projectRef: wbs.projectRef ?? null,
      owner: wbs.owner ?? null,
      goalCount: wbs.goals.length,
      phase: wbsPhase(wbs.goals),
      progress,
    },
  };
}

/* ── deliverables: progress and money (mirror the reducers) ─────────────── */

const round2 = (n: number): number => Math.round(n * 100) / 100;

const isClosed = (d: Deliverable): boolean =>
  d.status === "CANCELED" || d.status === "WONT_DO";
const isDelivered = (d: Deliverable): boolean =>
  d.status === "DELIVERED" || d.workProgress?.done === true;

function pctOf(d: Deliverable): number {
  const p = d.workProgress;
  if (!p) return 0;
  if (typeof p.value === "number") return p.value;
  if (typeof p.total === "number" && typeof p.completed === "number")
    return p.total > 0 ? (p.completed / p.total) * 100 : 0;
  if (typeof p.done === "boolean")
    return d.status === "IN_PROGRESS" ? 50 : p.done ? 100 : 0;
  return 0;
}

/** "3/8 SP", "done", "40%" — or null when no progress was ever recorded. */
export function progressText(d: Deliverable): string | null {
  const p = d.workProgress;
  if (!p) return null;
  if (typeof p.total === "number" && typeof p.completed === "number")
    return `${p.completed}/${p.total} SP`;
  if (typeof p.done === "boolean") return p.done ? "done" : "not done";
  if (typeof p.value === "number") return `${round2(p.value)}%`;
  return null;
}

export interface SetRollup {
  delivered: number;
  /** Deliverables that still count — CANCELED and WONT_DO are excluded. */
  total: number;
  pct: number;
}

/** Same aggregation the reducers apply to a deliverables set. */
export function rollupDeliverables(all: Deliverable[]): SetRollup {
  const ds = all.filter((d) => !isClosed(d));
  if (ds.length === 0) return { delivered: 0, total: 0, pct: 0 };
  const delivered = ds.filter(isDelivered).length;
  const storyPointed = ds.every(
    (d) =>
      typeof d.workProgress?.total === "number" &&
      typeof d.workProgress.completed === "number",
  );
  if (storyPointed) {
    const total = ds.reduce((a, d) => a + (d.workProgress?.total ?? 0), 0);
    const completed = ds.reduce(
      (a, d) => a + (d.workProgress?.completed ?? 0),
      0,
    );
    return {
      delivered,
      total: ds.length,
      pct: total > 0 ? round2((completed / total) * 100) : 0,
    };
  }
  return {
    delivered,
    total: ds.length,
    pct: round2(ds.reduce((a, d) => a + pctOf(d), 0) / ds.length),
  };
}

const costOf = (d: Deliverable): number =>
  d.budgetAnchor ? d.budgetAnchor.unitCost * d.budgetAnchor.quantity : 0;
const budgetOf = (d: Deliverable): number =>
  d.budgetAnchor ? round2(costOf(d) * (1 + d.budgetAnchor.margin / 100)) : 0;
const isQuoted = (d: Deliverable): boolean =>
  !!d.budgetAnchor &&
  d.budgetAnchor.quantity > 0 &&
  d.budgetAnchor.unitCost > 0;

function money(n: number, currency?: string | null): string {
  const s = n.toLocaleString("en", { maximumFractionDigits: 2 });
  return currency ? `${s} ${currency}` : s;
}

const UNIT_WORDS: Record<string, string> = {
  Hours: "hours",
  StoryPoints: "story points",
};

/** "10 hours × 120 USD = 1,200 USD, +10% margin → 1,320 USD" */
function quoteText(d: Deliverable, currency: string | null): string | null {
  const q = d.budgetAnchor;
  if (!q || !isQuoted(d)) return null;
  const unit = q.unit ? (UNIT_WORDS[q.unit] ?? q.unit) : "units";
  const base = `${money(q.quantity)} ${unit} × ${money(q.unitCost, currency)} = ${money(costOf(d), currency)}`;
  return q.margin
    ? `${base}, +${money(q.margin)}% margin → ${money(budgetOf(d), currency)}`
    : base;
}

/**
 * `knowledgeRefs` / `references` are non-nullable in the schema, but a scope
 * written before the fields existed stores envelopes with neither. This is
 * the one place the outline admits stored data can predate the schema.
 */
export function envelopeList(
  env: { knowledgeRefs: string[]; references: string[] },
  key: "knowledgeRefs" | "references",
): string[] {
  return (env as Partial<Record<typeof key, string[]>>)[key] ?? [];
}

const setStatus = (set: DeliverablesSet | null | undefined): string =>
  set?.status ?? "DRAFT";

/* ── scope of work ──────────────────────────────────────────────────────── */

export interface DeliverableSummary {
  id: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  progress: string | null;
  /** unitCost × quantity, and with the margin applied — 0 when unquoted. */
  cost: number;
  budget: number;
  /** Sequence code of the milestone it is scheduled in, if any. */
  milestone: string | null;
  /** Description of the WBS goal that delivers it, when the WBS was loaded. */
  goal: string | null;
}

export interface EnvelopeSummary {
  id: string;
  code: string;
  title: string;
  owner: string | null;
  /** The envelope's deliverables-set status (DRAFT, TODO, IN_PROGRESS, FINISHED, CANCELED). */
  status: string;
  progress: SetRollup;
  budgetType: string | null;
  currency: string | null;
  /** The envelope's budget as stored (derived from quotes unless fixed). */
  budget: number | null;
  /** Set only for a fixed budget; unpinned margins are then derived from it. */
  targetBudget: number | null;
  /** Σ of the quoted line budgets — what the deliverables add up to. */
  quotedBudget: number;
  expenditure: { actuals: number; cap: number; percentage: number } | null;
  wbsRef: string | null;
  /**
   * The same WBS as a `{documentId, documentType, title}` object — the shape
   * every tool result uses for a citable document, so the chat can label and
   * open a `[[wbsId]]` marker taken from the outline.
   */
  wbs: { documentId: string; documentType: "bai/wbs"; title: string } | null;
  goals: GoalProgress | null;
  deliverables: DeliverableSummary[];
  knowledgeRefs: { documentId: string; title: string | null }[];
  references: string[];
}

export interface MilestoneSummary {
  code: string;
  title: string;
  target: string;
  status: string;
  progress: SetRollup;
  coordinators: string[];
  budget: number | null;
  /** Codes (or titles) of the deliverables scheduled in it. */
  deliverables: string[];
}

export interface ScopeRendering {
  text: string;
  data: {
    documentId: string;
    documentType: "powerhouse/scopeofwork";
    title: string;
    description: string;
    status: ScopeOfWorkState["status"];
    envelopes: EnvelopeSummary[];
    /** Deliverables no envelope funds — the editor's "Unfunded" badge. */
    unfundedDeliverables: DeliverableSummary[];
    deliverables: { delivered: number; total: number };
    milestones: MilestoneSummary[];
    contributors: { id: string; name: string; description: string | null }[];
  };
}

function budgetLines(env: Project, ds: Deliverable[]): string[] {
  const cur = env.currency ?? null;
  const quoted = round2(ds.reduce((a, d) => a + budgetOf(d), 0));
  const type = env.budgetType ? ` (${env.budgetType})` : "";
  const out: string[] = [];
  if (env.targetBudget != null) {
    const variance = round2(env.targetBudget - quoted);
    const tail =
      variance >= 0
        ? `${money(variance, cur)} unallocated`
        : `over by ${money(-variance, cur)}`;
    out.push(
      `Budget: fixed ${money(env.targetBudget, cur)}${type}; quoted lines ${money(quoted, cur)} → ${tail}`,
    );
  } else {
    const budget = env.budget ?? quoted;
    const n = ds.filter(isQuoted).length;
    out.push(
      budget || quoted
        ? `Budget: ${money(budget, cur)}${type}, derived from ${n} quoted deliverable${n === 1 ? "" : "s"}`
        : `Budget: none quoted yet${type}`,
    );
  }
  const x = env.expenditure;
  if (x && (x.actuals || x.cap)) {
    out.push(
      `Spent: ${money(x.actuals, cur)}${x.cap ? ` of ${money(x.cap, cur)} cap (${round2(x.percentage)}%)` : ""}`,
    );
  }
  return out;
}

/**
 * A scope of work as one outline: envelopes (the projects) with their
 * deliverables joined to the WBS goal that delivers each, then the
 * deliverables no envelope funds, the schedule and the people. Everything
 * citable in it is the scope document itself — envelopes and deliverables
 * have no documentId of their own; the linked work breakdowns do.
 */
export function renderScope(o: {
  id: string;
  scope: ScopeOfWorkState;
  wbsById: Map<string, WorkBreakdownStructureState>;
  noteTitles: Map<string, string>;
}): ScopeRendering {
  const g = o.scope;
  const agent = new Map(g.contributors.map((c) => [c.id, c.name] as const));
  const nameOf = (id: string | null | undefined): string | null =>
    id ? (agent.get(id) ?? id) : null;
  const byId = new Map(g.deliverables.map((d) => [d.id, d] as const));
  const pick = (ids: readonly string[]): Deliverable[] =>
    ids
      .map((id) => byId.get(id))
      .filter((d): d is Deliverable => d !== undefined);
  const milestoneOf = new Map<string, string>();
  for (const r of g.roadmaps)
    for (const m of r.milestones)
      for (const id of m.scope?.deliverables ?? [])
        if (!milestoneOf.has(id)) milestoneOf.set(id, m.sequenceCode);
  const funded = new Set<string>();

  const summarize = (d: Deliverable, goal: Goal | undefined): DeliverableSummary => ({
    id: d.id,
    code: d.code,
    title: d.title,
    status: d.status,
    owner: nameOf(d.owner),
    progress: progressText(d),
    cost: round2(costOf(d)),
    budget: budgetOf(d),
    milestone: milestoneOf.get(d.id) ?? null,
    goal: goal?.description ?? null,
  });
  const deliverableLines = (
    d: Deliverable,
    currency: string | null,
    goal: Goal | undefined,
  ): string[] => {
    const bits: string[] = [];
    if (goal) bits.push(`goal: ${goal.description} (${goal.status})`);
    const owner = nameOf(d.owner);
    if (owner) bits.push(`owner ${owner}`);
    const pr = progressText(d);
    if (pr) bits.push(pr);
    const q = quoteText(d, currency);
    if (q) bits.push(`quote: ${q}`);
    const ms = milestoneOf.get(d.id);
    if (ms) bits.push(`milestone ${ms}`);
    const out = [
      `- [${d.status}] ${d.code ? `${d.code} ` : ""}${d.title}${bits.length ? ` — ${bits.join("; ")}` : ""}`,
    ];
    if (d.description.trim())
      out.push(`    ${d.description.trim().replace(/\s*\n\s*/g, " ")}`);
    for (const kr of d.keyResults) out.push(`    KR ${kr.title}: ${kr.link}`);
    return out;
  };

  const lines: string[] = [];
  lines.push(
    `# Scope of work: ${g.title || "(untitled)"} — ${g.status}${o.id ? ` [[${o.id}]]` : ""}`,
  );
  if (g.description) lines.push("", g.description);

  const envelopes: EnvelopeSummary[] = [];
  lines.push("", "## Projects (envelopes)");
  if (g.projects.length === 0) lines.push("No projects yet.");
  for (const env of g.projects) {
    const owner = nameOf(env.projectOwner);
    const currency = env.currency ?? null;
    const wbs = env.wbsRef ? (o.wbsById.get(env.wbsRef) ?? null) : null;
    const goalById = new Map((wbs?.goals ?? []).map((x) => [x.id, x] as const));
    const ds = pick(env.scope?.deliverables ?? []);
    for (const d of ds) funded.add(d.id);
    const roll = rollupDeliverables(ds);
    lines.push(
      "",
      `### ${env.code} · ${env.title}${owner ? ` — owner ${owner}` : ""} (${setStatus(env.scope)})` +
        (roll.total ? ` · ${roll.delivered}/${roll.total} delivered · ${roll.pct}%` : ""),
    );
    if (env.abstract) lines.push(env.abstract);
    lines.push(...budgetLines(env, ds));
    for (const d of ds) {
      lines.push(
        ...deliverableLines(
          d,
          currency,
          d.goalRef ? goalById.get(d.goalRef) : undefined,
        ),
      );
    }
    if (ds.length === 0) lines.push("- No deliverables yet.");
    if (wbs) {
      const gp = goalProgress(wbs.goals);
      const blocked = gp.byStatus.BLOCKED ?? 0;
      lines.push(
        `Work breakdown [[${env.wbsRef}]]: ${gp.completed}/${gp.total} goals completed${blocked ? ` (${blocked} blocked)` : ""}`,
      );
    } else if (env.wbsRef) {
      lines.push(`Work breakdown [[${env.wbsRef}]]`);
    }
    const refs = envelopeList(env, "knowledgeRefs");
    if (refs.length) {
      lines.push(
        "Knowledge: " +
          refs
            .map((r) => {
              const t = o.noteTitles.get(r);
              return t ? `${t} [[${r}]]` : `[[${r}]]`;
            })
            .join("; "),
      );
    }
    const extRefs = envelopeList(env, "references");
    if (extRefs.length) lines.push("References: " + extRefs.join(", "));
    envelopes.push({
      id: env.id,
      code: env.code,
      title: env.title,
      owner,
      status: setStatus(env.scope),
      progress: roll,
      budgetType: env.budgetType ?? null,
      currency,
      budget: env.budget ?? null,
      targetBudget: env.targetBudget ?? null,
      quotedBudget: round2(ds.reduce((a, d) => a + budgetOf(d), 0)),
      expenditure: env.expenditure
        ? {
            actuals: env.expenditure.actuals,
            cap: env.expenditure.cap,
            percentage: env.expenditure.percentage,
          }
        : null,
      wbsRef: env.wbsRef ?? null,
      wbs: env.wbsRef
        ? {
            documentId: env.wbsRef,
            documentType: "bai/wbs",
            title: `Work breakdown for ${env.title}`,
          }
        : null,
      goals: wbs ? goalProgress(wbs.goals) : null,
      deliverables: ds.map((d) =>
        summarize(d, d.goalRef ? goalById.get(d.goalRef) : undefined),
      ),
      knowledgeRefs: refs.map((r) => ({
        documentId: r,
        title: o.noteTitles.get(r) ?? null,
      })),
      references: extRefs,
    });
  }

  const unfunded = g.deliverables.filter((d) => !funded.has(d.id));
  if (unfunded.length > 0) {
    lines.push("", "## Unfunded deliverables (not in any project)");
    for (const d of unfunded) lines.push(...deliverableLines(d, null, undefined));
  }

  const milestones: MilestoneSummary[] = [];
  lines.push("", "## Schedule");
  for (const r of g.roadmaps) {
    lines.push(`Roadmap: ${r.title}${r.description ? ` — ${r.description}` : ""}`);
    for (const m of r.milestones) {
      const ds = pick(m.scope?.deliverables ?? []);
      const roll = rollupDeliverables(ds);
      const coordinators = m.coordinators.map((c) => nameOf(c) ?? c);
      const bits: string[] = [];
      if (roll.total) bits.push(`${roll.delivered}/${roll.total} delivered · ${roll.pct}%`);
      if (coordinators.length) bits.push(`coordinators ${coordinators.join(", ")}`);
      if (m.budget) bits.push(`budget ${money(m.budget)}`);
      lines.push(
        `- ${m.sequenceCode} ${m.title} — ${m.deliveryTarget || "no date"} (${setStatus(m.scope)})${bits.length ? `; ${bits.join("; ")}` : ""}`,
      );
      if (m.description.trim()) lines.push(`    ${m.description.trim()}`);
      const codes = ds.map((d) => d.code || d.title);
      lines.push(
        `    deliverables: ${codes.length ? codes.join(", ") : "none scheduled"}`,
      );
      milestones.push({
        code: m.sequenceCode,
        title: m.title,
        target: m.deliveryTarget,
        status: setStatus(m.scope),
        progress: roll,
        coordinators,
        budget: m.budget ?? null,
        deliverables: codes,
      });
    }
  }
  if (g.roadmaps.length === 0) lines.push("No roadmap yet.");

  lines.push("", "## Contributors");
  if (g.contributors.length === 0) lines.push("None listed.");
  for (const c of g.contributors) {
    lines.push(`- ${c.name} (${c.id})${c.description ? ` — ${c.description}` : ""}`);
  }

  return {
    text: lines.join("\n"),
    data: {
      documentId: o.id,
      documentType: "powerhouse/scopeofwork",
      title: g.title,
      description: g.description,
      status: g.status,
      envelopes,
      unfundedDeliverables: unfunded.map((d) => summarize(d, undefined)),
      deliverables: {
        delivered: g.deliverables.filter(isDelivered).length,
        total: g.deliverables.length,
      },
      milestones,
      contributors: g.contributors.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
      })),
    },
  };
}
