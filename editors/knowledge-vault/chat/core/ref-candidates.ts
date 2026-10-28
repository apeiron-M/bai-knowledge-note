/**
 * Labeled ref candidates from a document's state, for step 2: which items a
 * ref field may point at, and the label the model sees for each. The labels
 * follow the training data's conventions (`training/gen/ref-scenarios.ts`,
 * `RECIPES[op].paths`): goal description, member name, deliverable title,
 * task target, topic name, link target title, the drive's document titles.
 * `tests/unit/chat-ref-candidates.test.ts` checks every recipe against this.
 *
 * The machinery moved to nl-runtime (core/ref-candidates) in M1, where the
 * tables are inputs. The vault's tables stay here, and the old functions
 * bind them.
 */
import {
  type CandidateDoc,
  type ChatDocument,
  type ContextKinds,
  type CrossDocumentHook,
  currentListsFor as coreCurrentListsFor,
  type CurrentList,
  driveRefContext as coreDriveRefContext,
  type DriveRefOptions as CoreDriveRefOptions,
  type ListMode,
  type RefCandidates,
  refCandidatesFor as coreRefCandidatesFor,
  type RefContextItem,
  type RefExtractor,
} from "nl-runtime";

export {
  type ChatDocument,
  documentTitle,
  type RefCandidate,
  type RefContextItem,
} from "nl-runtime";

type Rec = Record<string, unknown>;

type Extract = RefExtractor;

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
  return coreRefCandidatesFor(opKey, state, ctx, {
    refExtractors: REF_EXTRACTORS,
    stateChoices: STATE_CHOICES,
  });
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
  return coreCurrentListsFor(opKey, state, CURRENT_LISTS);
}

/** Drive document kinds per document type (`driveRefContext`). */
export const CTX_KIND_BY_TYPE: ContextKinds = {
  "bai/knowledge-note": ["note", "knowledge"],
  "bai/wbs": ["wbs"],
  "bai/project": ["project"],
  "bai/moc": ["moc"],
};

/** The `bai/project` branch: a project's linked plan's goals (`wbs-goal`). */
export const linkedPlanGoals: CrossDocumentHook = (target, opts, bounded) => {
  const wbs = opts.linked;
  if (target.docType === "bai/project" && wbs && wbs.id === str(target.state.wbsRef))
    return bounded(
      "wbs-goal",
      recs(wbs.state.goals).map((g) => ({
        id: str(g.id),
        docType: "wbs-goal",
        title: str(g.description),
      })),
    );
  return [];
};

export type DriveRefOptions = Omit<CoreDriveRefOptions, "linked"> & {
  /** A project target's linked plan, loaded by id (its goals). */
  linkedWbs?: ChatDocument;
};

/**
 * The drive's items a ref field may point at, from the target document's
 * point of view: other notes (`note`, `knowledge`), plans (`wbs`), projects
 * (`project`) and, for a project with a linked plan, that plan's goals
 * (`wbs-goal`). At most `cap` per kind plus the items the target's state
 * already refers to.
 */
export function driveRefContext(
  target: ChatDocument,
  documents: CandidateDoc[],
  opts: DriveRefOptions = {},
): RefContextItem[] {
  const { linkedWbs, ...rest } = opts;
  return coreDriveRefContext(
    target,
    documents,
    { contextKinds: CTX_KIND_BY_TYPE, crossDocument: linkedPlanGoals },
    { ...rest, linked: linkedWbs },
  );
}
