/**
 * Labeled ref candidates from a document's state, for step 2: which items a
 * ref field may point at, and the label the model sees for each. The labels
 * follow the training data's conventions (`training/gen/ref-scenarios.ts`,
 * `RECIPES[op].paths`): goal description, member name, deliverable title,
 * task target, topic name, link target title, the drive's document titles.
 * `tests/unit/chat-ref-candidates.test.ts` checks every recipe against this.
 */
import {
  CANDIDATE_CAP,
  rankCandidates,
  referencedIds,
} from "../context/candidates.js";
import type { CandidateDoc } from "../context/context-frame.js";
import type { CurrentList, ListMode } from "./list-completion.js";
import type { RefCandidates } from "./v1-pipeline.js";

type Rec = Record<string, unknown>;

export interface RefCandidate {
  id: string;
  label: string;
}

/**
 * An item listed from outside the document (other documents in the drive,
 * goals of a linked plan), by kind: `note`, `knowledge`, `wbs`, `project`,
 * `wbs-goal`, `topic`, `session`, `moc`.
 */
export interface RefContextItem {
  id: string;
  title: string;
  kind: string;
}

type Extract = (state: Rec, ctx: RefContextItem[]) => RefCandidate[];

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const titleOf = (ctx: RefContextItem[], id: unknown) =>
  ctx.find((c) => c.id === id)?.title ?? str(id);
const ctxOf =
  (kind: string): Extract =>
  (_s, ctx) =>
    ctx
      .filter((c) => c.kind === kind)
      .map((c) => ({ id: c.id, label: c.title }));

const noteTopics: Extract = (s) =>
  recs(s.topics).map((x) => ({ id: str(x.id), label: str(x.name) }));
const noteLinks: Extract = (s) =>
  recs(s.links).map((x) => ({
    id: str(x.id),
    label: str(x.targetTitle) || str(x.targetDocumentId),
  }));
const unlinkedNotes: Extract = (s, ctx) => {
  const linked = new Set(recs(s.links).map((l) => l.targetDocumentId));
  return ctxOf("note")(s, ctx).filter((c) => !linked.has(c.id));
};
const wbsGoals: Extract = (s) =>
  recs(s.goals).map((g) => ({ id: str(g.id), label: str(g.description) }));
const wbsNotes: Extract = (s) =>
  recs(s.goals).flatMap((g) =>
    recs(g.notes).map((n) => ({ id: str(n.id), label: str(n.note) })),
  );
const team: Extract = (s) =>
  recs(s.team).map((m) => ({ id: str(m.id), label: str(m.name) }));
const deliverables: Extract = (s) =>
  recs(s.deliverables).map((d) => ({ id: str(d.id), label: str(d.title) }));
const linkedKnowledge: Extract = (s, ctx) =>
  (Array.isArray(s.knowledgeRefs) ? s.knowledgeRefs : []).map((id) => ({
    id: str(id),
    label: titleOf(ctx, id),
  }));
const unlinkedKnowledge: Extract = (s, ctx) => {
  const linked = new Set(Array.isArray(s.knowledgeRefs) ? s.knowledgeRefs : []);
  return ctxOf("knowledge")(s, ctx).filter((c) => !linked.has(c.id));
};
const coreIdeas: Extract = (s, ctx) =>
  recs(s.coreIdeas).map((c) => ({
    id: str(c.id),
    label: titleOf(ctx, c.noteRef),
  }));
const mocTensions: Extract = (s) =>
  recs(s.tensions).map((x) => ({ id: str(x.id), label: str(x.description) }));
const tasks: Extract = (s) =>
  recs(s.tasks).map((x) => ({ id: str(x.id), label: str(x.target) }));
const batchIds: Extract = (s) =>
  [
    ...new Set(
      recs(s.tasks)
        .map((x) => str(x.batchId))
        .filter(Boolean),
    ),
  ].map((b) => ({ id: b, label: b }));

/** Ref paths per op key, as in the training recipes. */
export const REF_EXTRACTORS: Record<string, Record<string, Extract>> = {
  "knowledge-note:SET_PROVENANCE": { sessionId: ctxOf("session") },
  "knowledge-note:ADD_LINK": { targetDocumentId: unlinkedNotes },
  "knowledge-note:REMOVE_LINK": { id: noteLinks },
  "knowledge-note:UPDATE_LINK_TYPE": { id: noteLinks },
  "knowledge-note:ADD_TOPIC": { topicDocumentId: ctxOf("topic") },
  "knowledge-note:REMOVE_TOPIC": { id: noteTopics },
  "moc:UPDATE_CORE_IDEA": { id: coreIdeas },
  "moc:REMOVE_CORE_IDEA": { id: coreIdeas },
  "moc:REORDER_CORE_IDEAS": { ids: coreIdeas },
  "moc:REMOVE_TENSION": { id: mocTensions },
  "pipeline-queue:ADD_TASK": { batchId: batchIds },
  "pipeline-queue:ASSIGN_TASK": { taskId: tasks },
  "pipeline-queue:ADVANCE_PHASE": { taskId: tasks },
  "pipeline-queue:COMPLETE_TASK": { taskId: tasks },
  "pipeline-queue:FAIL_TASK": { taskId: tasks },
  "pipeline-queue:BLOCK_TASK": { taskId: tasks },
  "pipeline-queue:UNBLOCK_TASK": { taskId: tasks },
  "project:LINK_WBS": { wbsRef: ctxOf("wbs") },
  "project:UPDATE_MEMBER": { id: team },
  "project:REMOVE_MEMBER": { id: team },
  "project:ADD_DELIVERABLE": { goalRef: ctxOf("wbs-goal") },
  "project:UPDATE_DELIVERABLE": {
    id: deliverables,
    goalRef: ctxOf("wbs-goal"),
  },
  "project:SET_DELIVERABLE_STATUS": { id: deliverables },
  "project:REMOVE_DELIVERABLE": { id: deliverables },
  "project:ADD_KNOWLEDGE_REF": { ref: unlinkedKnowledge },
  "project:REMOVE_KNOWLEDGE_REF": { ref: linkedKnowledge },
  "research-claim:REMOVE_RESEARCH_CONNECTION": {
    id: (s, ctx) =>
      recs(s.connections).map((c) => ({
        id: str(c.id),
        label: titleOf(ctx, c.targetRef),
      })),
  },
  "vault-config:TOGGLE_EXTRACTION_CATEGORY": {
    id: (s) =>
      recs(s.extractionCategories).map((c) => ({
        id: str(c.id),
        label: str(c.name),
      })),
  },
  "wbs:CREATE_GOAL": { parentId: wbsGoals, insertBefore: wbsGoals },
  "wbs:UPDATE_GOAL_DESCRIPTION": { id: wbsGoals },
  "wbs:DELETE_GOAL": { id: wbsGoals },
  "wbs:REORDER": { id: wbsGoals, parentId: wbsGoals, insertBefore: wbsGoals },
  "wbs:SET_GOAL_STATUS": { id: wbsGoals },
  "wbs:ASSIGN_GOAL": { id: wbsGoals },
  "wbs:SET_OUTCOME": { id: wbsGoals },
  "wbs:ADD_DEPENDENCIES": { id: wbsGoals, dependencies: wbsGoals },
  "wbs:REMOVE_DEPENDENCIES": { id: wbsGoals, dependencies: wbsGoals },
  "wbs:ADD_NOTE": { goalId: wbsGoals },
  "wbs:REMOVE_NOTE": { goalId: wbsGoals, noteId: wbsNotes },
  "wbs:SET_PROJECT_REF": { projectRef: ctxOf("project") },
};

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * X9: semantic fields that name an existing list item by its value (the
 * reducer removes the exact string), offered as choices from state. A path
 * with no items is left out, so the field stays a free span.
 */
export const STATE_CHOICES: Record<string, Record<string, Extract>> = {
  "moc:REMOVE_OPEN_QUESTION": {
    question: (s) => strs(s.openQuestions).map((q) => ({ id: q, label: q })),
  },
  "moc:REMOVE_CHILD_MOC": {
    childRef: (s, ctx) =>
      strs(s.childRefs).map((r) => ({ id: r, label: titleOf(ctx, r) })),
  },
};

/** Labeled candidates for every ref path of `opKey` (none for other ops). */
export function refCandidatesFor(
  opKey: string,
  state: Rec,
  ctx: RefContextItem[],
): RefCandidates {
  const paths = REF_EXTRACTORS[opKey] ?? {};
  const out: RefCandidates = Object.fromEntries(
    Object.entries(paths).map(([p, f]) => [p, f(state, ctx)]),
  );
  for (const [p, f] of Object.entries(STATE_CHOICES[opKey] ?? {})) {
    const cands = f(state, ctx);
    if (cands.length > 0) out[p] = cands;
  }
  return out;
}

/** X9: list fields an op replaces whole, with the current list (state order). */
export const CURRENT_LISTS: Record<
  string,
  Record<string, { mode: ListMode; from: (s: Rec) => string[] }>
> = {
  "moc:REORDER_CORE_IDEAS": {
    ids: {
      mode: "order",
      from: (s) => recs(s.coreIdeas).map((c) => str(c.id)),
    },
  },
  "project:SET_REFERENCES": {
    references: { mode: "keep", from: (s) => strs(s.references) },
  },
  "wbs:SET_REFERENCES": {
    references: { mode: "keep", from: (s) => strs(s.references) },
  },
};

/** The current lists `opKey` replaces whole (empty ones left out). */
export function currentListsFor(
  opKey: string,
  state: Rec,
): Record<string, CurrentList> {
  const out: Record<string, CurrentList> = {};
  for (const [p, { mode, from }] of Object.entries(
    CURRENT_LISTS[opKey] ?? {},
  )) {
    const values = from(state).filter(Boolean);
    if (values.length > 0) out[p] = { mode, values };
  }
  return out;
}

/** A drive document as the chat sees it: id, type, title and global state. */
export interface ChatDocument {
  id: string;
  docType: string;
  title: string;
  state: Rec;
}

const CTX_KIND_BY_TYPE: Record<string, string[]> = {
  "bai/knowledge-note": ["note", "knowledge"],
  "bai/wbs": ["wbs"],
  "bai/project": ["project"],
  "bai/moc": ["moc"],
};

export interface DriveRefOptions {
  /** A project target's linked plan, loaded by id (its goals). */
  linkedWbs?: ChatDocument;
  /** The request, for ranking; without it the recent ring orders. */
  utterance?: string;
  recentIds?: string[];
  /** Per kind; items the target already refers to are always kept. */
  cap?: number;
}

/**
 * The drive's items a ref field may point at, from the target document's
 * point of view: other notes (`note`, `knowledge`), plans (`wbs`), projects
 * (`project`) and, for a project with a linked plan, that plan's goals
 * (`wbs-goal`). Topic pages and capture sessions have no drive source yet.
 * M0: built from names (nodes, known titles), at most `cap` per kind plus
 * the items the target's state already refers to (their labels).
 */
export function driveRefContext(
  target: ChatDocument,
  documents: CandidateDoc[],
  opts: DriveRefOptions = {},
): RefContextItem[] {
  const utterance = opts.utterance ?? "";
  const cap = opts.cap ?? CANDIDATE_CAP;
  const referenced = referencedIds(target.state);
  const bounded = (kind: string, items: CandidateDoc[]): RefContextItem[] => {
    const kept = items.filter((d) => referenced.has(d.id));
    const rest = rankCandidates(
      utterance,
      items.filter((d) => !referenced.has(d.id)),
      { recentIds: opts.recentIds, cap },
    );
    return [...kept, ...rest].map((d) => ({ id: d.id, title: d.title, kind }));
  };
  const byKind = new Map<string, CandidateDoc[]>();
  for (const d of documents) {
    if (d.id === target.id) continue;
    for (const kind of CTX_KIND_BY_TYPE[d.docType] ?? [])
      byKind.set(kind, [...(byKind.get(kind) ?? []), d]);
  }
  const out = [...byKind].flatMap(([kind, items]) => bounded(kind, items));
  const wbs = opts.linkedWbs;
  if (target.docType === "bai/project" && wbs && wbs.id === str(target.state.wbsRef))
    out.push(
      ...bounded(
        "wbs-goal",
        recs(wbs.state.goals).map((g) => ({
          id: str(g.id),
          docType: "wbs-goal",
          title: str(g.description),
        })),
      ),
    );
  return out;
}

/** A document's display title: its state's title or name, else `fallback`. */
export function documentTitle(state: Rec, fallback: string): string {
  return str(state.title) || str(state.name) || fallback;
}
