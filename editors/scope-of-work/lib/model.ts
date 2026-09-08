import type {
  Agent,
  Deliverable,
  DeliverablesSet,
  Milestone,
  Project,
  Roadmap,
  ScopeOfWorkState,
} from "document-models/scope-of-work";

/* ── navigation ─────────────────────────────────────────────────────────── */
export type Filters = {
  status: string;
  project: string;
  milestone: string;
  owner: string;
  q: string;
};
export const emptyFilters: Filters = {
  status: "",
  project: "",
  milestone: "",
  owner: "",
  q: "",
};
export type View =
  | { kind: "overview" }
  /** Every roadmap, as a table; the sidebar section header opens it. */
  | { kind: "roadmaps" }
  | { kind: "roadmap"; id: string }
  | { kind: "milestone"; id: string }
  /** Every envelope, as a table; the sidebar section header opens it. */
  | { kind: "projects" }
  | { kind: "project"; id: string }
  | { kind: "deliverables"; filters?: Partial<Filters> }
  /** The work breakdown that delivers one envelope, edited without leaving the scope. */
  | { kind: "wbs"; projectId: string }
  | { kind: "team" };

/* ── lookups ────────────────────────────────────────────────────────────── */
export type MilestoneRef = { milestone: Milestone; roadmap: Roadmap };
export const allMilestones = (s: ScopeOfWorkState): MilestoneRef[] =>
  s.roadmaps.flatMap((r) =>
    r.milestones.map((m) => ({ milestone: m, roadmap: r })),
  );
export const sortedMilestones = (s: ScopeOfWorkState): MilestoneRef[] =>
  allMilestones(s).sort((a, b) =>
    (a.milestone.deliveryTarget || "9999").localeCompare(
      b.milestone.deliveryTarget || "9999",
    ),
  );
export const milestoneOf = (
  s: ScopeOfWorkState,
  deliverableId: string,
): MilestoneRef | undefined =>
  allMilestones(s).find((x) =>
    x.milestone.scope?.deliverables.includes(deliverableId),
  );
export const projectOf = (
  s: ScopeOfWorkState,
  deliverableId: string,
): Project | undefined =>
  s.projects.find((p) => p.scope?.deliverables.includes(deliverableId));
export const deliverableById = (
  s: ScopeOfWorkState,
  id: string,
): Deliverable | undefined => s.deliverables.find((d) => d.id === id);
export const agentById = (
  s: ScopeOfWorkState,
  id: string | null | undefined,
): Agent | undefined =>
  id ? s.contributors.find((a) => a.id === id) : undefined;
export const deliverablesIn = (
  s: ScopeOfWorkState,
  ids: readonly string[],
): Deliverable[] =>
  ids
    .map((id) => deliverableById(s, id))
    .filter((d): d is Deliverable => d !== undefined);

/**
 * Where an id from a deep link lives: the view that shows the item and, for
 * a deliverable, the selection that opens its inspector. A deliverable is
 * shown inside the envelope that funds it when there is one, else in the
 * flat list. Null when the scope holds nothing by that id.
 */
export const locate = (
  s: ScopeOfWorkState,
  id: string,
): { view: View; selected: string | null } | null => {
  if (s.projects.some((p) => p.id === id))
    return { view: { kind: "project", id }, selected: null };
  if (s.roadmaps.some((r) => r.id === id))
    return { view: { kind: "roadmap", id }, selected: null };
  if (allMilestones(s).some((x) => x.milestone.id === id))
    return { view: { kind: "milestone", id }, selected: null };
  if (s.deliverables.some((d) => d.id === id)) {
    const funder = projectOf(s, id);
    return {
      view: funder ? { kind: "project", id: funder.id } : { kind: "deliverables" },
      selected: id,
    };
  }
  if (s.contributors.some((c) => c.id === id))
    return { view: { kind: "team" }, selected: null };
  return null;
};

/* ── progress (mirrors the reducer rules) ───────────────────────────────── */
export const isClosed = (d: Deliverable): boolean =>
  d.status === "CANCELED" || d.status === "WONT_DO";
export const isDelivered = (d: Deliverable): boolean =>
  d.status === "DELIVERED" || d.workProgress?.done === true;
export type ProgressKind = "pct" | "sp" | "bin";
export const progressKind = (d: Deliverable): ProgressKind => {
  const p = d.workProgress;
  if (typeof p?.total === "number" && typeof p.completed === "number")
    return "sp";
  if (typeof p?.done === "boolean") return "bin";
  return "pct";
};
export const pctOf = (d: Deliverable): number => {
  const p = d.workProgress;
  if (!p) return 0;
  if (typeof p.value === "number") return p.value;
  if (typeof p.total === "number" && typeof p.completed === "number")
    return p.total > 0 ? (p.completed / p.total) * 100 : 0;
  if (typeof p.done === "boolean")
    return d.status === "IN_PROGRESS" ? 50 : p.done ? 100 : 0;
  return 0;
};
export const progressText = (d: Deliverable): string => {
  const p = d.workProgress;
  if (typeof p?.total === "number" && typeof p.completed === "number")
    return `${p.completed}/${p.total} SP`;
  if (typeof p?.done === "boolean") return p.done ? "Done" : "Not done";
  return `${Math.round(pctOf(d))}%`;
};
/** Roll-up over a list of deliverable ids, same aggregation the reducers use for a scope. */
export type Rollup = {
  pct: number;
  total: number;
  done: number;
  storyPoints?: { total: number; completed: number };
};
export const rollup = (s: ScopeOfWorkState, ids: readonly string[]): Rollup => {
  const ds = deliverablesIn(s, ids).filter((d) => !isClosed(d));
  if (ds.length === 0) return { pct: 0, total: 0, done: 0 };
  const done = ds.filter(isDelivered).length;
  if (ds.every((d) => progressKind(d) === "sp")) {
    const total = ds.reduce((a, d) => a + (d.workProgress?.total ?? 0), 0);
    const completed = ds.reduce(
      (a, d) => a + (d.workProgress?.completed ?? 0),
      0,
    );
    return {
      pct: total > 0 ? (completed / total) * 100 : 0,
      total: ds.length,
      done,
      storyPoints: { total, completed },
    };
  }
  return {
    pct:
      Math.round((ds.reduce((a, d) => a + pctOf(d), 0) / ds.length) * 100) /
      100,
    total: ds.length,
    done,
  };
};
export const scopePct = (scope: DeliverablesSet | null | undefined): number => {
  const p = scope?.progress;
  if (!p) return 0;
  if (typeof p.value === "number") return p.value;
  if (typeof p.total === "number" && typeof p.completed === "number")
    return p.total > 0 ? (p.completed / p.total) * 100 : 0;
  return p.done ? 100 : 0;
};

/* ── money (mirrors the reducer rules) ──────────────────────────────────── */
export const costOf = (d: Deliverable): number =>
  d.budgetAnchor ? d.budgetAnchor.unitCost * d.budgetAnchor.quantity : 0;
export const budgetOf = (d: Deliverable): number =>
  d.budgetAnchor
    ? Math.round(costOf(d) * (1 + d.budgetAnchor.margin / 100) * 100) / 100
    : 0;
export const sumCost = (s: ScopeOfWorkState, ids: readonly string[]): number =>
  deliverablesIn(s, ids).reduce((a, d) => a + costOf(d), 0);
export const sumBudget = (
  s: ScopeOfWorkState,
  ids: readonly string[],
): number => deliverablesIn(s, ids).reduce((a, d) => a + budgetOf(d), 0);
export const budgetsByCurrency = (
  s: ScopeOfWorkState,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of s.projects) {
    const cur = p.currency ?? "USD";
    out[cur] = (out[cur] ?? 0) + (p.budget ?? 0);
  }
  return out;
};
/** Budget of a set of deliverables, grouped by the currency of the project that funds each. */
export const budgetsByCurrencyFor = (
  s: ScopeOfWorkState,
  ids: readonly string[],
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const d of deliverablesIn(s, ids)) {
    const cur = projectOf(s, d.id)?.currency ?? "USD";
    out[cur] = (out[cur] ?? 0) + budgetOf(d);
  }
  return out;
};
/** Tokens are not ISO currencies: Intl prefixes a 3-letter one ("DAI 1.00") and
 *  throws on a 4-letter one, so USDS fell into a no-grouping fallback. Format them
 *  as a grouped number with the code after it, and keep fiat symbols as they were. */
const TOKEN_CODES = new Set(["DAI", "USDS"]);
const AMOUNT = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** "412,637.50" — the number alone, for layouts that set the code apart. */
export const moneyAmount = (n: number): string => AMOUNT.format(n);
export const money = (
  n: number,
  currency: string | null | undefined = "USD",
): string => {
  const code = currency ?? "USD";
  if (TOKEN_CODES.has(code)) return `${moneyAmount(n)} ${code}`;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${moneyAmount(n)} ${code}`;
  }
};
export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return n;
  const s = String(n);
  if (s.includes("e")) return Math.round(n * 100) / 100;
  return Number(`${Math.round(Number(`${s}e2`))}e-2`);
};
export const pct = (n: number): string => `${round2(n)}%`;
export const num = (n: number): string => String(round2(n));

/* ── fixed vs derived project budgets ───────────────────────────────────── */
export const isFixedBudget = (p: Project): boolean =>
  p.targetBudget !== null && p.targetBudget !== undefined;
export const isPinned = (d: Deliverable): boolean =>
  d.budgetAnchor?.marginPinned === true;
/** Σ of the line budgets a project funds — equals `project.budget` in derived mode. */
export const linesBudget = (s: ScopeOfWorkState, p: Project): number =>
  round2(sumBudget(s, p.scope?.deliverables ?? []));
/** Fixed mode only: envelope minus what the lines add up to (positive = unallocated, negative = over). */
export const budgetVariance = (
  s: ScopeOfWorkState,
  p: Project,
): number | null =>
  isFixedBudget(p) ? round2((p.targetBudget ?? 0) - linesBudget(s, p)) : null;
export const isOverBudget = (s: ScopeOfWorkState, p: Project): boolean =>
  isFixedBudget(p) &&
  sumCost(s, p.scope?.deliverables ?? []) > (p.targetBudget ?? 0);
/** The margin currently derived for unpinned quotes (they all share it), or null when none are free. */
export const derivedMargin = (
  s: ScopeOfWorkState,
  p: Project,
): number | null => {
  const free = deliverablesIn(s, p.scope?.deliverables ?? []).find(
    (d) => d.budgetAnchor && !isPinned(d),
  );
  return free?.budgetAnchor ? free.budgetAnchor.margin : null;
};

export const moneyList = (byCur: Record<string, number>): string =>
  Object.entries(byCur)
    .map(([c, v]) => money(v, c))
    .join(" · ") || "—";
export const isQuoted = (d: Deliverable): boolean =>
  !!d.budgetAnchor &&
  d.budgetAnchor.quantity > 0 &&
  d.budgetAnchor.unitCost > 0;

/* ── dates ──────────────────────────────────────────────────────────────── */
export const dateFmt = (
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string => {
  if (!iso) return "no date";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en", opts);
};
export const nextMilestone = (
  s: ScopeOfWorkState,
  today: Date,
): MilestoneRef | undefined => {
  const t = today.toISOString().slice(0, 10);
  return sortedMilestones(s).find((x) => x.milestone.deliveryTarget >= t);
};
export type MilestoneState = "done" | "live" | "";
export const milestoneState = (
  s: ScopeOfWorkState,
  m: Milestone,
  today: Date,
): MilestoneState => {
  const r = rollup(s, m.scope?.deliverables ?? []);
  if (r.total > 0 && r.done === r.total) return "done";
  return nextMilestone(s, today)?.milestone.id === m.id ? "live" : "";
};

/** Structural deletes are allowed only while the scope of work is still being authored. */
export const isEditable = (s: ScopeOfWorkState): boolean =>
  s.status === "DRAFT" || s.status === "REJECTED";
export const LOCKED_HINT =
  "Removing is only possible while the scope of work is a draft (or rejected).";

/* ── labels ─────────────────────────────────────────────────────────────── */
export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  TODO: "To do",
  BLOCKED: "Blocked",
  IN_PROGRESS: "In progress",
  DELIVERED: "Delivered",
  CANCELED: "Canceled",
  WONT_DO: "Won't do",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  FINISHED: "Finished",
};
export const DELIVERABLE_STATUSES = [
  "DRAFT",
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DELIVERED",
  "CANCELED",
  "WONT_DO",
] as const;
export const SOW_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_PROGRESS",
  "APPROVED",
  "REJECTED",
  "DELIVERED",
  "CANCELED",
] as const;
export const CURRENCIES = ["USD", "EUR", "DAI", "USDS"] as const;
export const BUDGET_TYPES = [
  "OPEX",
  "CAPEX",
  "OVERHEAD",
  "CONTINGENCY",
] as const;
export const isOneOf = <T extends readonly string[]>(
  list: T,
  v: string,
): v is T[number] => (list as readonly string[]).includes(v);

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
export const slugify = (title: string, id: string): string =>
  `${title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${id.slice(-8)}`;
export const nextSequenceCode = (r: Roadmap): string => {
  const first = r.milestones.at(0);
  const prefix = first ? first.sequenceCode.replace(/\d+$/, "") || "M" : "M";
  return `${prefix}${r.milestones.length + 1}`;
};

/* ── badges + checklist ─────────────────────────────────────────────────── */
export type Badge = {
  kind: "unfunded" | "unscheduled" | "unquoted";
  label: string;
};
export const badgesFor = (s: ScopeOfWorkState, d: Deliverable): Badge[] => {
  const out: Badge[] = [];
  const p = projectOf(s, d.id);
  if (!p) out.push({ kind: "unfunded", label: "Unfunded" });
  if (!milestoneOf(s, d.id))
    out.push({ kind: "unscheduled", label: "Unscheduled" });
  if (p && !isQuoted(d)) out.push({ kind: "unquoted", label: "Unquoted" });
  return out;
};
export type Check = { label: string; ok: boolean; go: View };
export const checklist = (s: ScopeOfWorkState): Check[] => {
  const live = s.deliverables.filter((d) => !isClosed(d));
  const ms = allMilestones(s);
  return [
    {
      label: "Title and summary written",
      ok: s.title.trim() !== "" && s.description.trim() !== "",
      go: { kind: "overview" },
    },
    {
      label: "At least one project with an owner",
      ok: s.projects.some((p) => !!p.projectOwner),
      go: s.projects[0]
        ? { kind: "project", id: s.projects[0].id }
        : { kind: "overview" },
    },
    {
      label: "A roadmap with dated milestones",
      ok: ms.length > 0 && ms.every((x) => x.milestone.deliveryTarget !== ""),
      go: s.roadmaps[0]
        ? { kind: "roadmap", id: s.roadmaps[0].id }
        : { kind: "overview" },
    },
    {
      label: "Every deliverable scheduled",
      ok: live.length > 0 && live.every((d) => !!milestoneOf(s, d.id)),
      go: { kind: "deliverables", filters: { milestone: "__none" } },
    },
    {
      label: "Every deliverable funded and quoted",
      ok:
        live.length > 0 &&
        live.every((d) => !!projectOf(s, d.id) && isQuoted(d)),
      go: { kind: "deliverables", filters: { project: "__none" } },
    },
    {
      label: "Every deliverable has an owner",
      ok: live.length > 0 && live.every((d) => !!d.owner),
      go: { kind: "deliverables", filters: { owner: "__none" } },
    },
  ];
};
