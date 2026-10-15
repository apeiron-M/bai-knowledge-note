/**
 * Changes to scopes of work, their projects and the work breakdowns that
 * deliver them — proposed by the chat, applied only on the person's word.
 *
 * The chat reads; for work it may also *propose*. A proposal is a list of
 * changes the model wants made, checked here against the document models
 * themselves (the same validators the reducers run), described in plain words,
 * and shown to the person as a card. Nothing is written until they press
 * Apply — then `use-work-proposal.ts` makes the changes, signed as them.
 *
 * The kinds of change, in the words a person plans in:
 *   create_scope     a new powerhouse/scopeofwork document in /projects
 *   add_project      a project (envelope) in a scope, its owner named as a person
 *   add_deliverable  a deliverable a project funds
 *   create_wbs       a new bai/wbs document, linked both ways to a project
 *   add_goal         a goal in a work breakdown, under a parent goal or at the top
 *   delete_document  a scope of work or work breakdown, removed
 *   operation        any of the models' own operations, on one document
 * Each but the creations and the deletion runs as steps — the models' own
 * operations — on one document. The named kinds exist because a model plans
 * "a scope, then a project, then its breakdown, then goals": given only
 * `operation`, a small one builds every piece out of create_wbs.
 *
 * Something created in the same proposal — a scope, a project inside it, a
 * person, a deliverable, a goal — is named `new:<name>` wherever its id is
 * needed; the names become real ids when the proposal is applied.
 *
 * Checked twice before the person sees it: each change's input against the
 * model's validator, then the whole proposal rehearsed — applied in memory, in
 * order, to copies of the documents it touches, by the models' own reducers —
 * so a change the vault would refuse (a project that is not there, an id
 * already taken, a goal under a missing parent) goes back to the model to fix
 * instead of stopping the person's Apply halfway.
 *
 * Pure: no network, no React. vault-tools.ts loads the documents a proposal
 * touches and calls `checkProposal`; the UI renders what it returns.
 */
import {
  actions as scopeActions,
  reducer as scopeReducer,
  utils as scopeUtils,
  type ScopeOfWorkState,
} from "document-models/scope-of-work";
import * as scopeModel from "document-models/scope-of-work";
import {
  actions as wbsActions,
  reducer as wbsReducer,
  utils as wbsUtils,
  type WorkBreakdownStructureState,
} from "document-models/work-breakdown-structure";
import * as wbsModel from "document-models/work-breakdown-structure";

export const SCOPE_TYPE = "powerhouse/scopeofwork";
export const WBS_TYPE = "bai/wbs";
type WorkDocType = typeof SCOPE_TYPE | typeof WBS_TYPE;

/* ------------------------------------------------------------------ */
/*  The operations                                                    */
/* ------------------------------------------------------------------ */

/** Operations the chat may propose, per document type — every one but the legacy SET_PROJECT_REF. */
export const WORK_OPERATIONS: Record<WorkDocType, readonly string[]> = {
  [SCOPE_TYPE]: [
    "EDIT_SCOPE_OF_WORK",
    "ADD_PROJECT", "UPDATE_PROJECT", "UPDATE_PROJECT_OWNER", "REMOVE_PROJECT", "SET_PROJECT_MARGIN",
    "SET_PROJECT_TOTAL_BUDGET", "ADD_PROJECT_DELIVERABLE", "REMOVE_PROJECT_DELIVERABLE", "SET_PROJECT_EXPENDITURE",
    "LINK_PROJECT_WBS", "ADD_PROJECT_KNOWLEDGE_REF", "REMOVE_PROJECT_KNOWLEDGE_REF", "SET_PROJECT_REFERENCES",
    "ADD_DELIVERABLE", "EDIT_DELIVERABLE", "REMOVE_DELIVERABLE", "SET_DELIVERABLE_PROGRESS", "LINK_DELIVERABLE_GOAL",
    "SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT", "ADD_KEY_RESULT", "EDIT_KEY_RESULT", "REMOVE_KEY_RESULT",
    "ADD_ROADMAP", "EDIT_ROADMAP", "REMOVE_ROADMAP",
    "ADD_MILESTONE", "EDIT_MILESTONE", "REMOVE_MILESTONE", "ADD_COORDINATOR", "REMOVE_COORDINATOR",
    "ADD_MILESTONE_DELIVERABLE", "REMOVE_MILESTONE_DELIVERABLE",
    "ADD_DELIVERABLE_IN_SET", "REMOVE_DELIVERABLE_IN_SET", "EDIT_DELIVERABLES_SET",
    "ADD_AGENT", "EDIT_AGENT", "REMOVE_AGENT",
  ],
  [WBS_TYPE]: [
    "CREATE_GOAL", "UPDATE_GOAL_DESCRIPTION", "DELETE_GOAL", "REORDER",
    "SET_GOAL_STATUS", "ASSIGN_GOAL", "SET_OUTCOME", "ADD_DEPENDENCIES", "REMOVE_DEPENDENCIES",
    "ADD_NOTE", "REMOVE_NOTE", "SET_OWNER", "SET_REFERENCES", "SET_SOW_PROJECT_REF",
  ],
};

/** "ADD_PROJECT" → "addProject": the creator's name in the model's `actions`. */
export function creatorName(type: string): string {
  return type.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}
/** "ADD_PROJECT" → "AddProjectInputSchema". */
function schemaName(type: string): string {
  const camel = creatorName(type);
  return `${camel[0].toUpperCase()}${camel.slice(1)}InputSchema`;
}

type Creator = (input: unknown) => { type: string; input: unknown; scope: string };
const CREATORS: Record<WorkDocType, Record<string, Creator>> = {
  [SCOPE_TYPE]: scopeActions as unknown as Record<string, Creator>,
  [WBS_TYPE]: wbsActions as unknown as Record<string, Creator>,
};
type SchemaFn = () => { shape: Record<string, ZodLike> };
const MODELS: Record<WorkDocType, Record<string, unknown>> = {
  [SCOPE_TYPE]: scopeModel as unknown as Record<string, unknown>,
  [WBS_TYPE]: wbsModel as unknown as Record<string, unknown>,
};

/** The model's own action for an operation — its creator runs the input validator, and throws on a bad input. */
export function buildAction(docType: WorkDocType, type: string, input: Record<string, unknown>) {
  const create = CREATORS[docType][creatorName(type)];
  if (typeof create !== "function") throw new Error(`${type} is not an operation on a ${docType}`);
  return create(input);
}

/** The document type an operation belongs to, or null. */
export function operationHome(type: string): WorkDocType | null {
  if (WORK_OPERATIONS[SCOPE_TYPE].includes(type)) return SCOPE_TYPE;
  if (WORK_OPERATIONS[WBS_TYPE].includes(type)) return WBS_TYPE;
  return null;
}

/* ------------------------------------------------------------------ */
/*  The catalog the model reads                                       */
/* ------------------------------------------------------------------ */

type ZodLike = { def?: Record<string, unknown>; shape?: Record<string, ZodLike>; options?: unknown[] };

/** A field's type as a short phrase — "string", "OPEX|CAPEX|…", "[string]", "{a!, b}" — read from its validator. */
function describeZod(z: ZodLike | undefined, depth = 0): { type: string; required: boolean } {
  let node = z;
  let required = true;
  for (let i = 0; i < 6 && node?.def; i++) {
    const t = node.def.type;
    if (t === "optional" || t === "nullable" || t === "default") {
      required = false;
      node = node.def.innerType as ZodLike;
      continue;
    }
    if (t === "lazy" && typeof node.def.getter === "function") {
      node = (node.def.getter as () => ZodLike)();
      continue;
    }
    break;
  }
  const def = node?.def ?? {};
  switch (def.type) {
    case "enum": {
      const entries = def.entries as Record<string, string> | undefined;
      return { type: Object.values(entries ?? {}).join("|"), required };
    }
    case "array":
      return { type: `[${describeZod(def.element as ZodLike, depth + 1).type}]`, required };
    case "object": {
      if (depth > 1) return { type: "object", required };
      const shape = (node?.shape ?? def.shape ?? {}) as Record<string, ZodLike>;
      const inner = Object.entries(shape).map(([k, v]) => {
        const d = describeZod(v, depth + 1);
        return `${k}${d.required ? "!" : ""}: ${d.type}`;
      });
      return { type: `{ ${inner.join(", ")} }`, required };
    }
    case "union": {
      const opts = (def.options as ZodLike[] | undefined) ?? [];
      return { type: opts.map((o) => describeZod(o, depth + 1).type).join(" | "), required };
    }
    default:
      return { type: typeof def.type === "string" ? def.type : "any", required };
  }
}

/** One operation's input, field by field: "id!: string, code!: string, budgetType: CONTINGENCY|OPEX|CAPEX|OVERHEAD". */
export function inputSignature(docType: WorkDocType, type: string): string {
  const fn = MODELS[docType][schemaName(type)] as SchemaFn | undefined;
  if (typeof fn !== "function") return "";
  const shape = fn().shape;
  return Object.entries(shape)
    .map(([k, v]) => {
      const d = describeZod(v);
      return `${k}${d.required ? "!" : ""}: ${d.type}`;
    })
    .join(", ");
}

/** What the signature cannot say: the defaults and traps a model must know (projects skill, § Reducer behaviours). */
const OPERATION_NOTES: Record<string, string> = {
  EDIT_SCOPE_OF_WORK: "title, description, status — all optional.",
  ADD_PROJECT: "A project (envelope). Mint id as new:<name>. Omitted budgetType stores CAPEX and currency USD, so state both. A budget fixes the envelope; omit it to derive the budget from quotes. Add the owner first with ADD_AGENT.",
  UPDATE_PROJECT: "null on abstract/imageUrl/budgetType/currency clears the field; budget: null releases a fixed budget. Cannot change the owner — UPDATE_PROJECT_OWNER does.",
  REMOVE_PROJECT: "Deletes the project AND the deliverables it funds.",
  ADD_PROJECT_DELIVERABLE: "Creates a deliverable inside the project (the id must be new in the whole document). It starts DRAFT with no code, owner or quote: follow it with EDIT_DELIVERABLE (code, description, owner, status TODO) and SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT.",
  EDIT_DELIVERABLE: "Only the fields given change — omit the rest (a null would blank them, so nulls are dropped).",
  SET_DELIVERABLE_PROGRESS: "Writes the status too: complete → DELIVERED, anything else → IN_PROGRESS. Never on unstarted work. workProgress is one of { percentage } | { storyPoints: { total, completed } } | { done }.",
  LINK_DELIVERABLE_GOAL: "goalRef is a goal id inside the project's work breakdown.",
  SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT: "project is the project's id inside the scope. unit StoryPoints or Hours (omitted → Hours). A margin given pins itself.",
  REMOVE_ROADMAP: "Deletes the roadmap AND every deliverable in its milestones.",
  REMOVE_MILESTONE: "Deletes the milestone AND every deliverable in it.",
  ADD_MILESTONE_DELIVERABLE: "CREATES a new deliverable in the milestone. To schedule an existing one, use ADD_DELIVERABLE_IN_SET.",
  ADD_DELIVERABLE_IN_SET: "Puts an existing deliverable in a milestone (milestoneId) or a project (projectId) — exactly one of them.",
  EDIT_DELIVERABLES_SET: "Sets a project's or milestone's set status (exactly one of milestoneId/projectId); only status is kept.",
  REMOVE_AGENT: "Clears every owner and coordinator entry that named this person.",
  ADD_AGENT: "A person who can own projects and deliverables. Reuse an existing contributor's id for the same person.",
  CREATE_GOAL: "Mint id as new:<name>. Parents before children. Starts TODO; assignee is free text (a name), not an agent id.",
  DELETE_GOAL: "Deletes the goal AND its whole subtree.",
  SET_GOAL_STATUS: "BLOCKED needs blockReason; send outcome with COMPLETED.",
  ADD_NOTE: "Mint noteId as new:<name>. The time is stamped when applied. author is free text: give it only when the person names one — the change is signed as them.",
  SET_SOW_PROJECT_REF: "Always send both sowRef (the scope document) and sowProjectId (the project's id inside it). create_wbs does this for you.",
  SET_REFERENCES: "Replaces the whole list.",
  SET_PROJECT_REFERENCES: "Replaces the whole list.",
};

/**
 * The form propose_work_changes takes: one list per kind of change, each with
 * its own fields — required ones the schema can enforce — applied in this
 * order, the order work is planned in. One mixed list of kinds was the first
 * design; a small model filled it by copying the fields of the change before,
 * and built projects and goals out of work breakdowns.
 */
export const FORM_LISTS = [
  ["scopes", "create_scope"],
  ["projects", "add_project"],
  ["breakdowns", "create_wbs"],
  ["goals", "add_goal"],
  ["deliverables", "add_deliverable"],
  ["roadmaps", "add_roadmap"],
  ["milestones", "add_milestone"],
  ["operations", "operation"],
  ["deletions", "delete_document"],
] as const;

/** The form's lists, as work_operations describes them. */
export const FORM_FIELDS: Record<string, string> = {
  scopes: "[{ ref, title!, description }] — new scopes of work, in /projects. Check list_projects first: one scope per team or programme.",
  projects: "[{ scope!, ref, code!, title!, owner, budgetType, currency, budget }] — projects (envelopes) in a scope: its documentId or new:<name>. owner is a person's name, added as a contributor if not one yet.",
  breakdowns: "[{ ref, name!, scope, project, owner }] — a work breakdown document for one project; with scope and project it is linked both ways.",
  goals: "[{ wbs!, ref, description!, parent, assignee }] — goals in a work breakdown; parent is the ref or id of the goal it sits under.",
  deliverables: "[{ scope!, project!, ref, title!, code, description, owner, status }] — deliverables a project funds.",
  roadmaps: "[{ scope!, ref, title!, description }] — a roadmap in a scope: the schedule its milestones sit on.",
  milestones: "[{ roadmap!, scope, ref, code, title!, target, description, coordinator, deliverables }] — a milestone on a roadmap: target is its date (YYYY-MM-DD), coordinator a person's name, deliverables the ones it schedules (their refs, ids, codes or titles).",
  operations: "[{ document!, type!, input! }] — any operation below, on one document: for edits, statuses, milestones, removals.",
  deletions: "[{ document! }] — whole scopes of work or work breakdowns. Only when the person asks.",
};

/** A whole proposal, as the model should write one: a scope, its project, the project's breakdown, two goals. */
export const FORM_EXAMPLE = {
  summary: "Set up Operations 2027 with an Infrastructure project and its first goals.",
  scopes: [{ ref: "new:ops", title: "Operations 2027" }],
  projects: [{ scope: "new:ops", ref: "new:infra", code: "INF", title: "Infrastructure", owner: "Bob", budgetType: "OPEX", currency: "EUR" }],
  breakdowns: [{ ref: "new:plan", name: "Infrastructure plan", scope: "new:ops", project: "new:infra" }],
  goals: [
    { wbs: "new:plan", ref: "new:servers", description: "Provision servers" },
    { wbs: "new:plan", description: "Point the domain", parent: "new:servers" },
  ],
  deliverables: [{ scope: "new:ops", project: "new:infra", ref: "new:live", code: "INF-1", title: "Servers in production" }],
  roadmaps: [{ scope: "new:ops", ref: "new:launch", title: "2027 launch" }],
  milestones: [{ roadmap: "new:launch", code: "M1", title: "Servers live", target: "2027-03-31", deliverables: ["new:live"] }],
};

/**
 * The form, as the list of changes `checkProposal` reads: each entry given its
 * kind and named by its place ("goals[1]"), so a problem is reported where the
 * model wrote it. A list of mixed `changes` is still read, after the form.
 */
export function formToChanges(args: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const entry = (item: unknown): Record<string, unknown> =>
    item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
  for (const [list, kind] of FORM_LISTS) {
    const items = args[list];
    if (!Array.isArray(items)) continue;
    (items as unknown[]).forEach((item, i) => {
      // A deletion given as just the id.
      const fields = kind === "delete_document" && typeof item === "string" ? { document: item } : entry(item);
      out.push({ ...fields, kind, at: `${list}[${i}]` });
    });
  }
  if (Array.isArray(args.changes)) (args.changes as unknown[]).forEach((c, i) => out.push({ ...entry(c), at: `changes[${i}]` }));
  return out;
}

/**
 * The catalog `work_operations` returns: every operation the chat may propose,
 * its input read from the model's own validator, and the notes the validator
 * cannot carry. Generated, so it never drifts from the models.
 */
export function workCatalog(area: "scope" | "wbs" | "all" = "all"): {
  form: Record<string, string>;
  example: typeof FORM_EXAMPLE;
  operations: { document: WorkDocType; type: string; input: string; note?: string }[];
  ids: string;
} {
  const types: WorkDocType[] = area === "scope" ? [SCOPE_TYPE] : area === "wbs" ? [WBS_TYPE] : [SCOPE_TYPE, WBS_TYPE];
  return {
    form: FORM_FIELDS,
    example: FORM_EXAMPLE,
    operations: types.flatMap((docType) =>
      WORK_OPERATIONS[docType].map((type) => ({
        document: docType,
        type,
        input: inputSignature(docType, type),
        ...(OPERATION_NOTES[type] ? { note: OPERATION_NOTES[type] } : {}),
      })),
    ),
    ids: "A project is an envelope INSIDE a scope document: its id is not a documentId. projectId, sowProjectId and budgetAnchor project are that inner id; wbsRef and sowRef are document ids; goalRef is a goal id inside the work breakdown. Read the scope with read_document for the ids that exist; name anything new new:<name> and reuse the name wherever its id goes.",
  };
}

/* ------------------------------------------------------------------ */
/*  Proposals                                                         */
/* ------------------------------------------------------------------ */

export type ChangeKind = "create_scope" | "create_wbs" | "add_project" | "add_deliverable" | "add_goal" | "add_roadmap" | "add_milestone" | "delete_document" | "operation";
const KINDS: readonly ChangeKind[] = ["create_scope", "add_project", "add_deliverable", "create_wbs", "add_goal", "add_roadmap", "add_milestone", "delete_document", "operation"];

/** One of the models' operations, ready to run on its change's document. */
export interface Step {
  type: string;
  input: Record<string, unknown>;
}

/** One change as checked: what it does, in words, and what it will run. */
export interface ProposedChange {
  kind: ChangeKind;
  /** Where the model wrote it — "goals[1]" — for the rehearsal's report, and what an edit on the card changes. */
  at?: string;
  /** Added by the checker, not written by the model — the unlink before a breakdown's deletion: not edited on its own. */
  derived?: boolean;
  /** The sentence the person reads. */
  says: string;
  /** Set when the change removes more than it names, or anything at all. */
  warning?: string;
  /** create_scope / create_wbs: the name the rest of the proposal refers to it by. */
  ref?: string;
  /** The document its steps run on, or the one deleted: a documentId or a new:<name> created earlier. */
  document?: string;
  documentType?: WorkDocType;
  /** operation and add_*: what runs on `document`, in order. */
  steps?: Step[];
  /** create_scope */
  title?: string;
  description?: string;
  status?: string;
  /** create_wbs */
  name?: string;
  scope?: string;
  project?: string;
  owner?: string;
}

export interface WorkProposal {
  /** Stable id: the card's state is kept under it. */
  id: string;
  /** The existing documents it touches, by documentId: what the card's Open links say. */
  documents: Partial<Record<string, { title: string; documentType: WorkDocType }>>;
  /** The model's one-line account of what the proposal does. */
  summary: string;
  changes: ProposedChange[];
  /** Destructive changes, counted: the card names them beside the button. */
  deletions: number;
  /** Every new:<name> the proposal creates — the only values Apply turns into ids. */
  refs: string[];
  createdAt: string;
  /** The form the model filled in, kept so the person can edit it on the card and it is checked again. */
  form?: Record<string, unknown>;
  /** The entries the person edited — "projects[0]" — marked on the card and told to the model. */
  edited?: string[];
}

/** A document a proposal touches, as loaded by the tool. */
export interface LoadedDocument {
  documentId: string;
  documentType: string;
  name: string | null;
  state: Record<string, unknown> | null;
}

export type CheckResult = { ok: true; proposal: WorkProposal } | { ok: false; errors: string[] };

/** "new:" and a name — any name, spaces and all: a model writes "new:Vault operations 2027" as readily as "new:ops". */
const NEW_RE = /^new:\S/;
export const isNewRef = (v: unknown): v is `new:${string}` => typeof v === "string" && NEW_RE.test(v);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** A value from an input, as text: strings and numbers as they are, anything else as JSON. */
const txt = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);

/** A change's `input`, whether the model sent an object or (as a string parameter asks) JSON text. */
function inputOf(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return raw === undefined ? {} : null;
}

/** Inputs where null means "clear this" — kept. Everywhere else a null would blank a field, and is dropped. */
const NULL_MEANS_CLEAR = new Set(["UPDATE_PROJECT", "LINK_PROJECT_WBS", "LINK_DELIVERABLE_GOAL", "SET_SOW_PROJECT_REF", "ASSIGN_GOAL", "SET_OUTCOME", "SET_OWNER"]);

function withoutNulls(type: string, input: Record<string, unknown>): Record<string, unknown> {
  if (NULL_MEANS_CLEAR.has(type)) return input;
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null));
}

/** "deliverable KV-1 “Search”" — a kind, its code when it has one, its title. */
const labeled = (kind: string, code: unknown, title: unknown) => `${kind} ${typeof code === "string" && code ? `${code} ` : ""}“${typeof title === "string" ? title : ""}”`;

/**
 * Names for ids, read from the documents loaded — so the card says
 * project KV “Knowledge Vault”, not an id — and from the proposal itself: a
 * person, project, deliverable or goal it adds is named as it was added.
 */
class Names {
  /** What the proposal adds inside documents, by id (a new:<name> or a plain one): its name as the card says it. */
  private made = new Map<string, string>();
  /** A deliverable's code and title as the proposal gives them — its code may come in a later step. */
  private deliverableParts = new Map<string, { code?: unknown; title?: unknown }>();
  constructor(private docs: Map<string, LoadedDocument>, private created: Map<string, string>) {}
  /** Record what a checked operation adds, so later changes name it. */
  remember(type: string, i: Record<string, unknown>): void {
    const set = (id: unknown, name: string) => {
      if (typeof id === "string" && id) this.made.set(id, name);
    };
    if (type === "ADD_AGENT") set(i.id, str(i.name) ?? "a person");
    if (type === "ADD_PROJECT") set(i.id, labeled("project", i.code, i.title));
    if (type === "ADD_DELIVERABLE") set(i.id, labeled("deliverable", i.code, i.title));
    if (type === "ADD_PROJECT_DELIVERABLE" || type === "ADD_MILESTONE_DELIVERABLE") {
      if (typeof i.deliverableId === "string") this.deliverableParts.set(i.deliverableId, { title: i.title });
      set(i.deliverableId, labeled("deliverable", undefined, i.title));
    }
    // An edit of a deliverable this proposal adds — its code, a new title — renames it on the card.
    if (type === "EDIT_DELIVERABLE" && typeof i.id === "string" && this.deliverableParts.has(i.id)) {
      const parts = { ...this.deliverableParts.get(i.id), ...(i.code !== undefined ? { code: i.code } : {}), ...(i.title !== undefined ? { title: i.title } : {}) };
      this.deliverableParts.set(i.id, parts);
      set(i.id, labeled("deliverable", parts.code, parts.title));
    }
    if (type === "ADD_ROADMAP") set(i.id, labeled("roadmap", undefined, i.title));
    if (type === "ADD_MILESTONE") set(i.id, labeled("milestone", i.sequenceCode, i.title));
    if (type === "CREATE_GOAL") set(i.id, labeled("goal", undefined, i.description));
  }
  doc(id: string | undefined): string {
    if (!id) return "a document";
    if (isNewRef(id)) return `the new ${this.created.get(id) ?? "document"}`;
    return `“${this.titleOf(id)}”`;
  }
  /** A loaded document's title — a scope's own, a work breakdown's name (it has no title) — or its id. */
  titleOf(id: string): string {
    const d = this.docs.get(id);
    const title = (d?.state as { title?: unknown } | null)?.title;
    return typeof title === "string" && title ? title : d?.name ?? id;
  }
  private scope(docId: string | undefined): ScopeOfWorkState | null {
    if (!docId) return null;
    const s = this.docs.get(docId)?.state as ScopeOfWorkState | null | undefined;
    return s && Array.isArray(s.projects) ? s : null;
  }
  project(docId: string | undefined, id: unknown): string {
    if (typeof id !== "string") return "a project";
    const made = this.made.get(id);
    if (made) return made;
    if (isNewRef(id)) return `the new project ${id.slice(4)}`;
    const p = this.scope(docId)?.projects.find((x) => x.id === id);
    return p ? labeled("project", p.code, p.title) : `project ${id}`;
  }
  deliverable(docId: string | undefined, id: unknown): string {
    if (typeof id !== "string") return "a deliverable";
    const made = this.made.get(id);
    if (made) return made;
    if (isNewRef(id)) return `the new deliverable ${id.slice(4)}`;
    const d = this.scope(docId)?.deliverables.find((x) => x.id === id);
    return d ? labeled("deliverable", d.code, d.title) : `deliverable ${id}`;
  }
  fundedBy(docId: string | undefined, projectId: unknown): number {
    const s = this.scope(docId);
    const p = s?.projects.find((x) => x.id === projectId);
    return p?.scope?.deliverables.length ?? 0;
  }
  milestone(docId: string | undefined, id: unknown): { name: string; deliverables: number } {
    const made = typeof id === "string" ? this.made.get(id) : undefined;
    if (made) return { name: made, deliverables: 0 };
    const s = this.scope(docId);
    for (const r of s?.roadmaps ?? []) {
      const m = r.milestones.find((x) => x.id === id);
      if (m) return { name: labeled("milestone", m.sequenceCode, m.title), deliverables: m.scope?.deliverables.length ?? 0 };
    }
    return { name: `milestone ${String(id)}`, deliverables: 0 };
  }
  roadmap(docId: string | undefined, id: unknown): { name: string; deliverables: number } {
    const made = typeof id === "string" ? this.made.get(id) : undefined;
    if (made) return { name: made, deliverables: 0 };
    const r = this.scope(docId)?.roadmaps.find((x) => x.id === id);
    if (!r) return { name: `roadmap ${String(id)}`, deliverables: 0 };
    return { name: labeled("roadmap", undefined, r.title), deliverables: r.milestones.reduce((n, m) => n + (m.scope?.deliverables.length ?? 0), 0) };
  }
  agent(docId: string | undefined, id: unknown): string {
    if (typeof id !== "string") return "someone";
    const made = this.made.get(id);
    if (made) return made;
    const a = this.scope(docId)?.contributors.find((x) => x.id === id);
    return a ? a.name : isNewRef(id) ? `the new person ${id.slice(4)}` : id;
  }
  /** A goal by id in whichever breakdown holds it — one the proposal adds, or one loaded — or null. */
  goalAnywhere(id: unknown): string | null {
    if (typeof id !== "string") return null;
    const made = this.made.get(id);
    if (made) return made;
    for (const [docId, d] of this.docs) {
      const goals = (d.state as WorkBreakdownStructureState | null)?.goals;
      if (Array.isArray(goals) && goals.some((g) => g.id === id)) return this.goal(docId, id).name;
    }
    return null;
  }
  goal(docId: string | undefined, id: unknown): { name: string; subtree: number } {
    const made = typeof id === "string" ? this.made.get(id) : undefined;
    if (made) return { name: made, subtree: 0 };
    const w = (docId ? this.docs.get(docId)?.state : null) as WorkBreakdownStructureState | null;
    const goals = Array.isArray(w?.goals) ? w.goals : [];
    const g = goals.find((x) => x.id === id);
    if (!g) return { name: typeof id === "string" && isNewRef(id) ? `the new goal ${id.slice(4)}` : `goal ${String(id)}`, subtree: 0 };
    const below = new Set<string>([g.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of goals) {
        if (x.parentId && below.has(x.parentId) && !below.has(x.id)) {
          below.add(x.id);
          grew = true;
        }
      }
    }
    return { name: labeled("goal", undefined, g.description), subtree: below.size - 1 };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Fields as the person says them. */
const FIELD_WORDS: Record<string, string> = {
  budgetType: "budget type",
  projectOwner: "owner",
  sequenceCode: "code",
  deliveryTarget: "target date",
  imageUrl: "image",
  totalBudget: "total budget",
};
/** Text too long to quote in a line: the line names the field, the card does not repeat it. */
const LONG_FIELDS = new Set(["description", "abstract", "imageUrl", "icon"]);
/** Fields holding a contributor's id: the line says their name. */
const PERSON_FIELDS = new Set(["owner", "projectOwner"]);

/**
 * What an edit sets, field by field, with the new value where it fits on a
 * line — "status → CANCELED, title → “Vault”, owner → Alice" — so the person
 * decides on what will be there, not on which fields are touched.
 */
function fieldChanges(names: Names, docId: string, input: Record<string, unknown>, skip: readonly string[] = ["id"]): string {
  const parts = Object.entries(input)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => {
      const word = FIELD_WORDS[k] ?? k;
      // A project's budget set to none is not lost: it is then the sum of its deliverables' quotes.
      if (v === null && k === "budget") return "budget from its deliverables' quotes";
      if (v === null) return `${word} cleared`;
      if (LONG_FIELDS.has(k)) return `new ${word}`;
      if (PERSON_FIELDS.has(k) && typeof v === "string") return `${word} → ${names.agent(docId, v)}`;
      if (typeof v === "string") return /^[A-Z][A-Z_]+$/.test(v) ? `${word} → ${v}` : `${word} → “${v.length > 60 ? `${v.slice(0, 57)}…` : v}”`;
      if (typeof v === "number" || typeof v === "boolean") return `${word} → ${String(v)}`;
      return word;
    });
  return parts.join(", ") || "nothing";
}

/** What one operation does, in a sentence — and, when it removes more than it names, the warning. */
function describeOperation(names: Names, docId: string, type: string, input: Record<string, unknown>): { says: string; warning?: string } {
  const doc = names.doc(docId);
  const i = input;
  switch (type) {
    case "EDIT_SCOPE_OF_WORK":
      return { says: `Edit scope ${doc}: ${fieldChanges(names, docId, i, [])}` };
    case "ADD_PROJECT": {
      const details = [
        i.projectOwner ? `owned by ${names.agent(docId, i.projectOwner)}` : null,
        i.budgetType ? `${txt(i.budgetType)} budget` : null,
        i.currency ? `in ${txt(i.currency)}` : null,
      ].filter(Boolean);
      return { says: `Add ${labeled("project", i.code, i.title)} to ${doc}${details.length ? `, ${details.join(", ")}` : ""}` };
    }
    case "UPDATE_PROJECT":
      return { says: `Update ${names.project(docId, i.id)}: ${fieldChanges(names, docId, i)}` };
    case "UPDATE_PROJECT_OWNER":
      return { says: `Make ${names.agent(docId, i.projectOwner)} the owner of ${names.project(docId, i.id)}` };
    case "REMOVE_PROJECT": {
      const n = names.fundedBy(docId, i.projectId);
      return { says: `Delete ${names.project(docId, i.projectId)} from ${doc}`, warning: n ? `also deletes the ${plural(n, "deliverable")} it funds` : "a deletion" };
    }
    case "ADD_PROJECT_DELIVERABLE":
      return { says: `Add ${labeled("deliverable", undefined, i.title)} to ${names.project(docId, i.projectId)}` };
    case "REMOVE_PROJECT_DELIVERABLE":
      return { says: `Take ${names.deliverable(docId, i.deliverableId)} out of ${names.project(docId, i.projectId)}`, warning: "a removal" };
    case "ADD_DELIVERABLE":
      return { says: `Add ${labeled("deliverable", i.code, i.title)} to ${doc}, funded by no project yet` };
    case "EDIT_DELIVERABLE":
      return { says: `Edit ${names.deliverable(docId, i.id)}: ${fieldChanges(names, docId, i)}` };
    case "EDIT_ROADMAP":
      return { says: `Edit ${names.roadmap(docId, i.id).name}: ${fieldChanges(names, docId, i)}` };
    case "EDIT_MILESTONE":
      return { says: `Edit ${names.milestone(docId, i.id).name}: ${fieldChanges(names, docId, i, ["id", "roadmapId"])}` };
    case "EDIT_AGENT":
      return { says: `Edit contributor ${names.agent(docId, i.id)}: ${fieldChanges(names, docId, i)}` };
    case "ADD_ROADMAP":
      return { says: `Add ${labeled("roadmap", undefined, i.title)} to ${doc}` };
    case "ADD_MILESTONE":
      return { says: `Add ${labeled("milestone", i.sequenceCode, i.title)} to ${names.roadmap(docId, i.roadmapId).name}${i.deliveryTarget ? `, due ${txt(i.deliveryTarget)}` : ""}` };
    case "UPDATE_GOAL_DESCRIPTION":
      return { says: `Rename ${names.goal(docId, i.id).name} to “${txt(i.description)}”` };
    case "REMOVE_DELIVERABLE":
      return { says: `Delete ${names.deliverable(docId, i.id)}`, warning: "a deletion" };
    case "SET_DELIVERABLE_PROGRESS":
      return { says: `Record progress on ${names.deliverable(docId, i.id)}` };
    case "LINK_DELIVERABLE_GOAL":
      return {
        says: i.goalRef
          ? `Link ${names.deliverable(docId, i.deliverableId)} to ${names.goalAnywhere(i.goalRef) ?? "its work-breakdown goal"}`
          : `Unlink ${names.deliverable(docId, i.deliverableId)} from its goal`,
      };
    case "SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT":
      return { says: `Quote ${names.deliverable(docId, i.deliverableId)}${i.quantity !== undefined ? `: ${txt(i.quantity)} ${txt(i.unit ?? "Hours")}` : ""}${i.unitCost !== undefined ? ` at ${txt(i.unitCost)}` : ""}` };
    case "LINK_PROJECT_WBS":
      return { says: i.wbsRef ? `Link ${names.project(docId, i.projectId)} to work breakdown ${names.doc(txt(i.wbsRef))}` : `Unlink ${names.project(docId, i.projectId)} from its work breakdown` };
    case "REMOVE_ROADMAP": {
      const r = names.roadmap(docId, i.id);
      return { says: `Delete ${r.name}`, warning: r.deliverables ? `also deletes the ${plural(r.deliverables, "deliverable")} in its milestones` : "a deletion" };
    }
    case "REMOVE_MILESTONE": {
      const m = names.milestone(docId, i.id);
      return { says: `Delete ${m.name}`, warning: m.deliverables ? `also deletes the ${plural(m.deliverables, "deliverable")} in it` : "a deletion" };
    }
    case "ADD_AGENT":
      return { says: `Add ${str(i.name) ?? "a person"} as a contributor to ${doc}` };
    case "REMOVE_AGENT":
      return { says: `Remove ${names.agent(docId, i.id)} from the contributors`, warning: "clears every project, deliverable and milestone they owned or coordinated" };
    case "CREATE_GOAL":
      return { says: `Add ${labeled("goal", undefined, i.description)} to ${doc}${i.parentId ? `, under ${names.goal(docId, i.parentId).name}` : ""}` };
    case "DELETE_GOAL": {
      const g = names.goal(docId, i.id);
      return { says: `Delete ${g.name}`, warning: g.subtree ? `also deletes the ${plural(g.subtree, "goal")} beneath it` : "a deletion" };
    }
    case "SET_GOAL_STATUS":
      return { says: `Set ${names.goal(docId, i.id).name} to ${txt(i.status)}` };
    case "ASSIGN_GOAL":
      return { says: i.assignee ? `Assign ${names.goal(docId, i.id).name} to ${txt(i.assignee)}` : `Unassign ${names.goal(docId, i.id).name}` };
    case "ADD_NOTE":
      return { says: `Note on ${names.goal(docId, i.goalId).name}: “${str(i.note) ?? ""}”` };
    case "REMOVE_NOTE":
      return { says: `Remove a note from ${names.goal(docId, i.goalId).name}`, warning: "a deletion" };
    default: {
      const words = type.toLowerCase().replace(/_/g, " ");
      const destructive = /^(remove|delete)\b/.test(words);
      return { says: `${words[0].toUpperCase()}${words.slice(1)} in ${doc}`, ...(destructive ? { warning: "a removal" } : {}) };
    }
  }
}

/** What an operation's input must satisfy beyond its validator — the rules the reducers state but do not enforce. */
function semanticProblem(type: string, input: Record<string, unknown>): string | null {
  if (type === "SET_SOW_PROJECT_REF" && (input.sowRef == null) !== (input.sowProjectId == null)) {
    return "SET_SOW_PROJECT_REF needs both sowRef and sowProjectId (or neither, to unlink): one alone leaves the breakdown pointing at a scope but no project.";
  }
  if ((type === "ADD_DELIVERABLE_IN_SET" || type === "EDIT_DELIVERABLES_SET") && Boolean(input.milestoneId) === Boolean(input.projectId)) {
    return `${type} needs exactly one of milestoneId and projectId.`;
  }
  if (type === "SET_GOAL_STATUS" && input.status === "BLOCKED" && !str(input.blockReason)) {
    return "SET_GOAL_STATUS to BLOCKED needs a blockReason.";
  }
  return null;
}

/** A short, readable reason a validator refused an input. */
function refusal(err: unknown): string {
  const issues = (err as { issues?: { path?: (string | number)[]; message?: string }[] } | null)?.issues;
  if (Array.isArray(issues) && issues.length) {
    return issues.slice(0, 3).map((x) => `${(x.path ?? []).join(".") || "input"}: ${x.message ?? "invalid"}`).join("; ");
  }
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}

/** The field a creating step puts its new id in — the id a later change may name by its new:<name>. */
const DECLARES: Partial<Record<string, { key: string; is: Declared }>> = {
  ADD_PROJECT: { key: "id", is: "project" },
  ADD_AGENT: { key: "id", is: "person" },
  ADD_DELIVERABLE: { key: "id", is: "deliverable" },
  ADD_PROJECT_DELIVERABLE: { key: "deliverableId", is: "deliverable" },
  ADD_MILESTONE_DELIVERABLE: { key: "deliverableId", is: "deliverable" },
  ADD_ROADMAP: { key: "id", is: "roadmap" },
  ADD_MILESTONE: { key: "id", is: "milestone" },
  ADD_KEY_RESULT: { key: "id", is: "key result" },
  CREATE_GOAL: { key: "id", is: "goal" },
  ADD_NOTE: { key: "noteId", is: "note" },
};
type Declared = "scope" | "work breakdown" | "project" | "person" | "deliverable" | "roadmap" | "milestone" | "key result" | "goal" | "note";

/** The entry a model should have written, for a guidance message. */
const ADD_PROJECT_HINT = (scope: string) => `put it in projects — {"scope":"${scope}","ref":"new:<name>","code":"<CODE>","title":"<title>"}`;
const ADD_GOAL_HINT = (wbs: string, description: string) => `put them in goals — {"wbs":"${wbs}","description":"${description}"}`;

/** The fields each kind reads; anything else is ignored, and named when the change has a problem. */
const KIND_FIELDS: Record<string, readonly string[]> = {
  create_scope: ["kind", "ref", "title", "description", "status"],
  add_project: ["kind", "scope", "document", "ref", "code", "title", "name", "owner", "budgetType", "currency", "budget", "abstract"],
  add_deliverable: ["kind", "scope", "document", "project", "ref", "title", "name", "code", "description", "owner", "status"],
  create_wbs: ["kind", "ref", "name", "title", "scope", "project", "owner"],
  add_goal: ["kind", "wbs", "document", "ref", "description", "title", "name", "goal", "parent", "parentId", "assignee", "owner"],
  add_roadmap: ["kind", "scope", "document", "ref", "title", "name", "description"],
  add_milestone: ["kind", "roadmap", "scope", "document", "ref", "code", "title", "name", "target", "date", "description", "coordinator", "owner", "deliverables"],
  delete_document: ["kind", "document"],
  operation: ["kind", "document", "type", "input"],
};

/**
 * The model's own change, rewritten as it should be — the missing field put
 * in with a placeholder, the fields the kind does not read taken out — and a
 * note of what was taken out. A small model corrects from an example of its
 * own change far more reliably than from a rule.
 */
function rewritten(c: Record<string, unknown>, kind: string, missing: Record<string, string>): string {
  const fields = KIND_FIELDS[kind] ?? [];
  // An entry of the form has its kind from its list, and its label from its place: neither is the model's to write.
  const fromForm = typeof c.at === "string" && !c.at.startsWith("changes[");
  const own = Object.entries(c).filter(([k]) => k !== "at" && !(fromForm && k === "kind"));
  const kept = Object.fromEntries(own.filter(([k, v]) => fields.includes(k) && v !== "" && v !== null));
  const ignored = own.map(([k]) => k).filter((k) => !fields.includes(k));
  const example = JSON.stringify({ ...kept, ...missing });
  const list = fromForm ? (c.at as string).replace(/\[\d+\]$/, "") : kind;
  return `Write it like this: ${example}${ignored.length ? ` (${ignored.join(", ")} ${ignored.length === 1 ? "is" : "are"} not read in ${list})` : ""}.`;
}

/** "<your name>", "<CODE>" — a slot the model did not fill. */
const SLOT_RE = /<[^<>\n]{1,40}>/;
/** "New Project", "Untitled scope" — a name that names nothing. */
const GENERIC_NAME_RE = /^(new|untitled|sample|example|my|test)( (project|scope|scope of work|work breakdown|breakdown|plan|goal|deliverable))+$/i;
const NAMING_KEYS = new Set(["title", "name"]);

/** Why an entry holds a placeholder instead of the person's words — or null. */
function placeholderIn(entry: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v !== "string") continue;
    const slot = SLOT_RE.exec(v);
    if (slot && k !== "input") return `${k} is a placeholder (${slot[0]}), not the person's words — ask them, or leave the field out.`;
    if (NAMING_KEYS.has(k) && GENERIC_NAME_RE.test(v.trim())) {
      return `"${v.trim()}" is a placeholder, not a name — ask the person what the work is and what it is called before proposing it.`;
    }
  }
  return null;
}

/** A milestone's target as the editor's date picker holds it — YYYY-MM-DD — or why not. */
function targetDate(v: unknown): { date?: string; problem?: string } {
  const t = str(v);
  if (!t) return {};
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (!m) return { problem: `target "${t}" is not a date — give it as YYYY-MM-DD, or leave it out for the person to set.` };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const real = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== date) return { problem: `target "${t}" is not a real date.` };
  return { date };
}

/** A number the model sent as a number or as digits. */
function numberOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Check a proposal the model wrote, change by change, against the models and
 * the documents it touches. Every problem is reported at once, so one round of
 * corrections suffices; a proposal with any problem is not shown to the person.
 *
 * Forgiving where a model's slip has one reading: a creation without a ref is
 * named after its title, a ref without its "new:" prefix gets one, and a
 * reference to "ops" means "new:ops" when that is a name the proposal makes.
 */
export function checkProposal(
  raw: { summary?: unknown; changes?: unknown },
  docs: Map<string, LoadedDocument>,
  now: () => string = () => new Date().toISOString(),
  newId: () => string = () => `p-${Math.random().toString(36).slice(2, 10)}`,
  /** Entries the person edited: their words are theirs, so not refused as placeholders. */
  edited: readonly string[] = [],
): CheckResult {
  const errors: string[] = [];
  // What the model sent, item by item: anything but an object is a change with no kind.
  const list: Record<string, unknown>[] = (Array.isArray(raw.changes) ? (raw.changes as unknown[]) : []).map((c) =>
    c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {},
  );
  if (list.length === 0) errors.push("changes is empty: propose at least one change.");
  // Documents this proposal creates, by name, with their type: later changes may act on them.
  const created = new Map<string, WorkDocType>();
  const createdLabel = new Map<string, string>();
  const names = new Names(docs, createdLabel);
  const out: ProposedChange[] = [];
  /** The entry being checked, so each change it adds is labelled with it. */
  let current = "";
  const push = (c: ProposedChange) => out.push({ ...c, at: current });
  /** Every new:<name> declared so far — documents and what steps add inside them — and what each is. */
  const declared = new Map<string, Declared>();
  /** People added in this proposal, by scope and lower-cased name: their new id. */
  const peopleAdded = new Map<string, string>();

  /** A ref as written, made exact: "ops" → "new:ops"; a missing one named after its title. */
  const refOf = (ref: unknown, named: string | undefined): string | undefined => {
    const v = str(ref) ?? named;
    if (!v) return undefined;
    return isNewRef(v) ? v : `new:${v}`;
  };
  // The roadmaps the proposal adds, and their scopes: a milestone that names an invented roadmap belongs to the only one.
  const addedRoadmaps = list
    .filter((c) => c.kind === "add_roadmap")
    .map((c) => ({ scope: c.scope ?? c.document, ref: refOf(c.ref, str(c.title) ?? str(c.name)) }));
  /** Deliverables by their words — code and title, lower case — to their ref or id: a milestone may name them either way. */
  const deliverableWords = new Map<string, string>();
  // The projects the proposal adds: a breakdown it creates without naming one delivers the only one there is.
  const addedProjects = list
    .filter((c) => c.kind === "add_project")
    .map((c) => ({ scope: c.scope ?? c.document, ref: refOf(c.ref, str(c.code)) }));
  // The documents the proposal will create, so a use before the creation is caught.
  const createdScopes = list.filter((c) => c.kind === "create_scope").map((c) => refOf(c.ref, str(c.title))).filter((r): r is string => r !== undefined);
  const createdBreakdowns = list.filter((c) => c.kind === "create_wbs").map((c) => refOf(c.ref, str(c.name) ?? str(c.title))).filter((r): r is string => r !== undefined);
  const willCreate = new Set([...createdScopes, ...createdBreakdowns]);
  /** Every name the proposal makes, by its lower case: "new:ops" is "new:OPS". */
  const canonical = new Map<string, string>();
  for (const r of willCreate) canonical.set(r.toLowerCase(), r);
  for (const p of addedProjects) if (p.ref) canonical.set(p.ref.toLowerCase(), p.ref);
  for (const r of addedRoadmaps) if (r.ref) canonical.set(r.ref.toLowerCase(), r.ref);
  /**
   * A reference as written, made exact: a documentId stays; a name the
   * proposal makes is matched whatever its case, and with or without "new:".
   */
  const resolve = (v: unknown): string | undefined => {
    const t = str(v);
    if (!t || docs.has(t)) return t;
    const named = isNewRef(t) ? t : `new:${t}`;
    const known = declared.has(named) ? named : canonical.get(named.toLowerCase());
    return known ?? t;
  };
  /**
   * A reference to something the proposal makes, resolved — and when it names
   * nothing, but the proposal makes exactly one thing of that kind, that thing:
   * goals that name an invented breakdown, in a proposal that creates one,
   * belong to it. The card spells out every link, so the person sees the reading.
   */
  const resolveAs = (v: unknown, kind: "scope" | "work breakdown" | "project" | "roadmap"): string | undefined => {
    const exact = resolve(v);
    if (!exact || !isNewRef(exact) || declared.has(exact) || willCreate.has(exact) || canonical.has(exact.toLowerCase())) return exact;
    const pick = (xs: { ref?: string }[]) => xs.map((x) => x.ref).filter((r): r is string => r !== undefined);
    const only =
      kind === "scope" ? createdScopes : kind === "work breakdown" ? createdBreakdowns : kind === "project" ? pick(addedProjects) : pick(addedRoadmaps);
    return only.length === 1 ? only[0] : exact;
  };
  /** A deliverable as a milestone names it — its ref, its id in the scope, its code or its title — or null. */
  const deliverableOf = (scope: string, v: unknown): string | null => {
    const t = str(v);
    if (!t) return null;
    const exact = resolve(t);
    if (exact && declared.get(exact) === "deliverable") return exact;
    const word = deliverableWords.get(t.toLowerCase());
    if (word) return word;
    const state = isNewRef(scope) ? null : (docs.get(scope)?.state as ScopeOfWorkState | null | undefined);
    const held = Array.isArray(state?.deliverables)
      ? state.deliverables.find((d) => d.id === t || d.code.toLowerCase() === t.toLowerCase() || d.title.toLowerCase() === t.toLowerCase())
      : undefined;
    return held?.id ?? null;
  };
  const typeOf = (id: string): string | undefined => (isNewRef(id) ? created.get(id) : docs.get(id)?.documentType);
  /** Why `id` is not a document of `want`, or null when it is. */
  const notA = (id: string, want: WorkDocType, field: string): string | null => {
    const t = typeOf(id);
    if (t === want) return null;
    const wanted = want === SCOPE_TYPE ? "scope of work" : "work breakdown";
    if (t === SCOPE_TYPE || t === WBS_TYPE) return `${field} ${id} is a ${t === SCOPE_TYPE ? "scope of work" : "work breakdown"}, not a ${wanted}.`;
    if (isNewRef(id)) return `${field} ${id} is ${willCreate.has(id) ? "created later in this proposal — put that change first" : declared.has(id) ? `a ${declared.get(id)}, not a ${wanted}` : "not created earlier in this proposal"}.`;
    return t ? `${field} ${id} is a ${t}, not a ${wanted}.` : `${field} ${id} is not a ${wanted} in this vault.`;
  };
  /** A person, by name, as a contributor of `scope`: an existing one's id, or a step adding them. */
  const person = (scope: string, name: string): { id: string; steps: Step[]; added: boolean } => {
    const key = `${scope}|${name.trim().toLowerCase()}`;
    const already = peopleAdded.get(key);
    if (already) return { id: already, steps: [], added: false };
    const state = isNewRef(scope) ? null : (docs.get(scope)?.state as ScopeOfWorkState | null | undefined);
    const known = Array.isArray(state?.contributors)
      ? state.contributors.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
      : undefined;
    if (known) return { id: known.id, steps: [], added: false };
    const id = `new:person ${name.trim()}`;
    peopleAdded.set(key, id);
    return { id, steps: [{ type: "ADD_AGENT", input: { id, name: name.trim() } }], added: true };
  };
  /** Check each step against its model's validator; declare what it creates; record its names. */
  const accept = (at: string, home: WorkDocType, steps: Step[]): boolean => {
    for (const step of steps) {
      try {
        buildAction(home, step.type, step.input);
      } catch (err) {
        errors.push(`${at}: ${step.type} input refused — ${refusal(err)}. Expected { ${inputSignature(home, step.type)} }.`);
        return false;
      }
    }
    for (const step of steps) {
      const d = DECLARES[step.type];
      const id = d ? step.input[d.key] : undefined;
      if (d && typeof id === "string" && isNewRef(id)) {
        declared.set(id, d.is);
        canonical.set(id.toLowerCase(), id);
      }
      names.remember(step.type, step.input);
    }
    return true;
  };
  const claim = (at: string, ref: string, is: Declared): boolean => {
    if (declared.has(ref)) {
      errors.push(`${at}: ${ref} is already used in this proposal — give this one its own ref.`);
      return false;
    }
    declared.set(ref, is);
    canonical.set(ref.toLowerCase(), ref);
    return true;
  };

  list.forEach((c, n) => {
    const at = typeof c.at === "string" ? c.at : `change ${n + 1}`;
    current = at;
    const kind = str(c.kind) as ChangeKind | undefined;
    const placeholder = edited.includes(at) ? null : placeholderIn(c);
    if (placeholder) return void errors.push(`${at}: ${placeholder}`);

    if (kind === "create_scope") {
      const title = str(c.title);
      if (!title) return void errors.push(`${at}: create_scope needs a title.`);
      const ref = refOf(c.ref, title)!;
      if (!claim(at, ref, "scope")) return;
      const status = str(c.status) ?? "DRAFT";
      created.set(ref, SCOPE_TYPE);
      createdLabel.set(ref, `scope “${title}”`);
      push({ kind, ref, title, ...(str(c.description) ? { description: str(c.description) } : {}), status, documentType: SCOPE_TYPE, says: `Create scope of work “${title}” in /projects` });
      return;
    }

    if (kind === "add_project" || kind === "add_deliverable") {
      const scope = resolveAs(c.scope ?? c.document, "scope");
      if (!scope) return void errors.push(`${at}: ${kind} needs scope — the scope's documentId, or the new:<name> of one created earlier.`);
      const wrong = notA(scope, SCOPE_TYPE, "scope");
      if (wrong) return void errors.push(`${at}: ${wrong}${kind === "add_project" ? " A project belongs to a scope of work." : ""}`);
      const ownerName = str(c.owner);
      const owner = ownerName ? person(scope, ownerName) : null;
      const ownerWords = owner && ownerName ? `, owned by ${ownerName}${owner.added ? " (added as a contributor)" : ""}` : "";

      if (kind === "add_project") {
        const code = str(c.code);
        const title = str(c.title) ?? str(c.name);
        if (!code) return void errors.push(`${at}: add_project has no code — a short code for the project. ${rewritten(c, kind, { code: "<CODE>" })}`);
        if (!title) return void errors.push(`${at}: add_project has no title — the project's name. ${rewritten(c, kind, { title: "<the project's name>" })}`);
        const ref = refOf(c.ref, code)!;
        if (declared.has(ref)) return void errors.push(`${at}: ${ref} is already used in this proposal — give this project its own ref.`);
        // A budget of 0 is a model's filler, not a decision: it would fix the envelope at nothing.
        const given = numberOf(c.budget);
        const budget = given !== undefined && given > 0 ? given : undefined;
        const input: Record<string, unknown> = {
          id: ref, code, title,
          ...(owner ? { projectOwner: owner.id } : {}),
          ...(str(c.budgetType) ? { budgetType: str(c.budgetType)!.toUpperCase() } : {}),
          ...(str(c.currency) ? { currency: str(c.currency)!.toUpperCase() } : {}),
          ...(budget !== undefined ? { budget } : {}),
          ...(str(c.abstract) ? { abstract: str(c.abstract) } : {}),
        };
        const steps: Step[] = [...(owner?.steps ?? []), { type: "ADD_PROJECT", input }];
        if (!accept(at, SCOPE_TYPE, steps)) return;
        const details = [
          input.budgetType ? `${txt(input.budgetType)} budget` : null,
          input.currency ? `in ${txt(input.currency)}` : null,
          budget !== undefined ? `budget ${budget}` : null,
        ].filter(Boolean);
        push({
          kind, document: scope, documentType: SCOPE_TYPE, steps,
          says: `Add ${labeled("project", code, title)} to ${names.doc(scope)}${ownerWords}${details.length ? `, ${details.join(", ")}` : ""}`,
        });
        return;
      }

      const project = resolveAs(c.project, "project");
      const title = str(c.title) ?? str(c.name);
      if (!project) return void errors.push(`${at}: add_deliverable has no project — the project's id in the scope, or the new:<name> given to it in add_project. ${rewritten(c, kind, { project: "<the project's id or new:<name>>" })}`);
      if (!title) return void errors.push(`${at}: add_deliverable has no title — what the deliverable is. ${rewritten(c, kind, { title: "<the deliverable>" })}`);
      if (isNewRef(project) && declared.get(project) !== "project") {
        const is = declared.get(project);
        return void errors.push(`${at}: ${is ? `${project} is a ${is}, not a project.` : `no project ${project} is added before this.`} Add the project first: ${ADD_PROJECT_HINT(scope)} — then name its ref as project here.`);
      }
      const ref = refOf(c.ref, title)!;
      if (declared.has(ref)) return void errors.push(`${at}: ${ref} is already used in this proposal — give this deliverable its own ref.`);
      const edit: Record<string, unknown> = {
        ...(str(c.code) ? { code: str(c.code) } : {}),
        ...(str(c.description) ? { description: str(c.description) } : {}),
        ...(owner ? { owner: owner.id } : {}),
        ...(str(c.status) ? { status: str(c.status)!.toUpperCase() } : {}),
      };
      const steps: Step[] = [
        ...(owner?.steps ?? []),
        { type: "ADD_PROJECT_DELIVERABLE", input: { projectId: project, deliverableId: ref, title } },
        ...(Object.keys(edit).length ? [{ type: "EDIT_DELIVERABLE", input: { id: ref, ...edit } }] : []),
      ];
      if (!accept(at, SCOPE_TYPE, steps)) return;
      deliverableWords.set(title.toLowerCase(), ref);
      if (typeof edit.code === "string") deliverableWords.set(edit.code.toLowerCase(), ref);
      push({
        kind, document: scope, documentType: SCOPE_TYPE, steps,
        says: `Add ${labeled("deliverable", edit.code, title)} to ${names.project(scope, project)}${ownerWords}${edit.status ? `, status ${txt(edit.status)}` : ""}`,
      });
      return;
    }

    if (kind === "create_wbs") {
      const name = str(c.name) ?? str(c.title);
      if (!name) return void errors.push(`${at}: create_wbs needs a name — a work breakdown has no title of its own.`);
      const ref = refOf(c.ref, name)!;
      let scope = resolveAs(c.scope, "scope");
      let project = resolveAs(c.project, "project");
      if (!scope && !project && addedProjects.length === 1) {
        // One reading: the breakdown is for the one project this proposal adds.
        scope = resolveAs(addedProjects[0].scope, "scope");
        project = addedProjects[0].ref;
      } else if (!scope && !project && addedProjects.length > 1) {
        return void errors.push(`${at}: create_wbs names no project, and this proposal adds ${addedProjects.length}. Give scope and project for the one it delivers — e.g. "scope":"${txt(addedProjects[0].scope)}","project":"${txt(addedProjects[0].ref)}".`);
      }
      if (Boolean(scope) !== Boolean(project)) return void errors.push(`${at}: create_wbs links to a project with both scope and project, or to nothing with neither.`);
      if (scope && project) {
        if (typeOf(scope) === WBS_TYPE || createdBreakdowns.includes(scope)) {
          return void errors.push(`${at}: ${scope} is a work breakdown, not a scope — a goal is not a work breakdown. Goals go in a breakdown: ${ADD_GOAL_HINT(scope, name)}.`);
        }
        const wrong = notA(scope, SCOPE_TYPE, "scope");
        if (wrong) return void errors.push(`${at}: ${wrong}`);
        if (isNewRef(project) && declared.get(project) !== "project") {
          const is = declared.get(project) ?? (project === ref ? "work breakdown" : undefined);
          return void errors.push(`${at}: ${is ? `${project} is a ${is}, not a project.` : `no project ${project} is added before this.`} A project lives inside the scope: ${ADD_PROJECT_HINT(scope)} — then give its ref as project here.`);
        }
      }
      if (!claim(at, ref, "work breakdown")) return;
      created.set(ref, WBS_TYPE);
      createdLabel.set(ref, `work breakdown “${name}”`);
      push({
        kind, ref, name, documentType: WBS_TYPE,
        ...(scope && project ? { scope, project } : {}),
        ...(str(c.owner) ? { owner: str(c.owner) } : {}),
        says: `Create work breakdown “${name}”${scope && project ? `, linked both ways to ${names.project(scope, project)}` : ""}`,
      });
      return;
    }

    if (kind === "add_goal") {
      const wbs = resolveAs(c.wbs ?? c.document, "work breakdown");
      if (!wbs) return void errors.push(`${at}: add_goal needs wbs — the work breakdown's documentId, or the new:<name> of one created earlier.`);
      if (typeOf(wbs) === SCOPE_TYPE) return void errors.push(`${at}: ${wbs} is a scope of work; goals belong to a work breakdown. Put the project's breakdown in breakdowns, then give its ref as wbs here.`);
      const wrong = notA(wbs, WBS_TYPE, "wbs");
      if (wrong) return void errors.push(`${at}: ${wrong}`);
      const description = str(c.description) ?? str(c.title) ?? str(c.name) ?? str(c.goal);
      if (!description) return void errors.push(`${at}: add_goal has no description — the goal itself, in a sentence. ${rewritten(c, kind, { description: "<the goal, in a sentence>" })}`);
      const ref = refOf(c.ref, description)!;
      if (declared.has(ref)) return void errors.push(`${at}: ${ref} is already used in this proposal — give this goal its own ref.`);
      const parent = resolve(c.parent ?? c.parentId);
      if (parent && isNewRef(parent) && declared.get(parent) !== "goal") {
        const is = declared.get(parent);
        return void errors.push(`${at}: ${is ? `${parent} is a ${is}, not a goal.` : `no goal ${parent} is added before this change.`} Add the parent goal first, then name its ref as parent.`);
      }
      const assignee = str(c.assignee) ?? str(c.owner);
      const input: Record<string, unknown> = { id: ref, description, ...(parent ? { parentId: parent } : {}), ...(assignee ? { assignee } : {}) };
      const steps: Step[] = [{ type: "CREATE_GOAL", input }];
      // Name the parent before `accept` records this goal under its own name.
      const under = parent ? names.goal(wbs, parent).name : null;
      if (!accept(at, WBS_TYPE, steps)) return;
      push({
        kind, document: wbs, documentType: WBS_TYPE, steps,
        says: `Add ${labeled("goal", undefined, description)} to ${names.doc(wbs)}${under ? `, under ${under}` : ""}${input.assignee ? `, assigned to ${txt(input.assignee)}` : ""}`,
      });
      return;
    }

    if (kind === "add_roadmap") {
      const scope = resolveAs(c.scope ?? c.document, "scope");
      if (!scope) return void errors.push(`${at}: add_roadmap has no scope — the scope's documentId, or the new:<name> of one created earlier. ${rewritten(c, kind, { scope: "<the scope>" })}`);
      const wrong = notA(scope, SCOPE_TYPE, "scope");
      if (wrong) return void errors.push(`${at}: ${wrong} A roadmap belongs to a scope of work.`);
      const title = str(c.title) ?? str(c.name);
      if (!title) return void errors.push(`${at}: add_roadmap has no title. ${rewritten(c, kind, { title: "<the roadmap's name>" })}`);
      const ref = refOf(c.ref, title)!;
      if (declared.has(ref)) return void errors.push(`${at}: ${ref} is already used in this proposal — give this roadmap its own ref.`);
      const steps: Step[] = [{ type: "ADD_ROADMAP", input: { id: ref, title, ...(str(c.description) ? { description: str(c.description) } : {}) } }];
      if (!accept(at, SCOPE_TYPE, steps)) return;
      push({ kind, document: scope, documentType: SCOPE_TYPE, steps, says: `Add ${labeled("roadmap", undefined, title)} to ${names.doc(scope)}` });
      return;
    }

    if (kind === "add_milestone") {
      const roadmap = resolveAs(c.roadmap, "roadmap");
      if (!roadmap) return void errors.push(`${at}: add_milestone has no roadmap — its id, or the new:<name> given to it in roadmaps. ${rewritten(c, kind, { roadmap: "<the roadmap>" })}`);
      // The scope: the one the new roadmap is added to, or the one named.
      const fromProposal = addedRoadmaps.find((r) => r.ref === roadmap);
      const scope = fromProposal ? resolveAs(fromProposal.scope, "scope") : resolveAs(c.scope ?? c.document, "scope");
      if (!scope) return void errors.push(`${at}: add_milestone on roadmap ${roadmap} has no scope — give the scope's documentId as scope.`);
      const wrong = notA(scope, SCOPE_TYPE, "scope");
      if (wrong) return void errors.push(`${at}: ${wrong}`);
      if (isNewRef(roadmap) && declared.get(roadmap) !== "roadmap") {
        const is = declared.get(roadmap);
        return void errors.push(`${at}: ${is ? `${roadmap} is a ${is}, not a roadmap.` : `no roadmap ${roadmap} is added before this.`} Add the roadmap first: put it in roadmaps — {"scope":"${scope}","ref":"new:<name>","title":"<title>"} — then name its ref as roadmap here.`);
      }
      const title = str(c.title) ?? str(c.name);
      if (!title) return void errors.push(`${at}: add_milestone has no title. ${rewritten(c, kind, { title: "<what is reached>" })}`);
      const ref = refOf(c.ref, title)!;
      if (declared.has(ref)) return void errors.push(`${at}: ${ref} is already used in this proposal — give this milestone its own ref.`);
      const target = targetDate(c.target ?? c.date);
      if (target.problem) return void errors.push(`${at}: ${target.problem}`);
      const wanted = Array.isArray(c.deliverables) ? (c.deliverables as unknown[]) : typeof c.deliverables === "string" ? [c.deliverables] : [];
      const scheduled: string[] = [];
      for (const w of wanted) {
        const id = deliverableOf(scope, w);
        if (!id) return void errors.push(`${at}: no deliverable "${txt(w)}" in this scope or proposal — name it by its ref, id, code or title, or add it in deliverables first.`);
        if (!scheduled.includes(id)) scheduled.push(id);
      }
      const coordinatorName = str(c.coordinator) ?? str(c.owner);
      const coordinator = coordinatorName ? person(scope, coordinatorName) : null;
      const steps: Step[] = [
        {
          type: "ADD_MILESTONE",
          input: {
            roadmapId: roadmap, id: ref, title,
            ...(str(c.code) ? { sequenceCode: str(c.code) } : {}),
            ...(target.date ? { deliveryTarget: target.date } : {}),
            ...(str(c.description) ? { description: str(c.description) } : {}),
          },
        },
        ...scheduled.map((deliverableId) => ({ type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId, milestoneId: ref } })),
        ...(coordinator ? [...coordinator.steps, { type: "ADD_COORDINATOR", input: { id: coordinator.id, milestoneId: ref } }] : []),
      ];
      // Named before `accept` records the milestone: the deliverables as the card says them.
      const which = scheduled.map((id) => names.deliverable(scope, id));
      if (!accept(at, SCOPE_TYPE, steps)) return;
      const details = [
        target.date ? `due ${target.date}` : null,
        which.length ? `scheduling ${which.join(", ")}` : null,
        coordinator && coordinatorName ? `coordinated by ${coordinatorName}${coordinator.added ? " (added as a contributor)" : ""}` : null,
      ].filter(Boolean);
      push({
        kind, document: scope, documentType: SCOPE_TYPE, steps,
        says: `Add ${labeled("milestone", str(c.code), title)} to ${names.roadmap(scope, roadmap).name}${details.length ? `, ${details.join("; ")}` : ""}`,
      });
      return;
    }

    if (kind === "delete_document") {
      const document = str(c.document);
      const d = document ? docs.get(document) : undefined;
      if (!document || !d) return void errors.push(`${at}: delete_document needs the documentId of a scope of work or work breakdown in this vault.`);
      if (d.documentType !== SCOPE_TYPE && d.documentType !== WBS_TYPE) return void errors.push(`${at}: only a scope of work or a work breakdown can be deleted from the chat — ${document} is a ${d.documentType}.`);
      if (d.documentType === WBS_TYPE) {
        // A project must not point at a breakdown that is gone: unlink it first, as its own line on the card.
        const w = d.state as { sowRef?: unknown; sowProjectId?: unknown } | null;
        const scopeId = typeof w?.sowRef === "string" ? w.sowRef : null;
        const scope = scopeId ? (docs.get(scopeId)?.state as ScopeOfWorkState | null | undefined) : null;
        const project = Array.isArray(scope?.projects) ? scope.projects.find((x) => x.id === w?.sowProjectId && x.wbsRef === document) : undefined;
        if (scopeId && project) {
          push({
            kind: "operation", document: scopeId, documentType: SCOPE_TYPE, derived: true,
            steps: [{ type: "LINK_PROJECT_WBS", input: { projectId: project.id, wbsRef: null } }],
            says: `Unlink ${names.project(scopeId, project.id)} from work breakdown ${names.doc(document)}, which is deleted next`,
          });
        }
        push({ kind, document, documentType: WBS_TYPE, says: `Delete work breakdown ${names.doc(document)}`, warning: "deletes the whole document" });
        return;
      }
      // A scope's breakdowns are documents of their own: say they stay, so the person can delete them too.
      const held = (d.state as ScopeOfWorkState | null)?.projects;
      const linked = Array.isArray(held) ? held.filter((x) => x.wbsRef).length : 0;
      push({
        kind, document, documentType: SCOPE_TYPE,
        says: `Delete scope of work ${names.doc(document)}`,
        warning: `deletes the whole document${linked === 1 ? " — its project's work breakdown stays, linked to nothing" : linked > 1 ? ` — the ${linked} work breakdowns of its projects stay, linked to nothing` : ""}`,
      });
      return;
    }

    if (kind === "operation") {
      const document = resolve(c.document);
      const type = str(c.type)?.toUpperCase();
      if (!document || !type) return void errors.push(`${at}: an operation needs document and type.`);
      const home = typeOf(document);
      if (!home) return void errors.push(`${at}: ${document} is ${isNewRef(document) ? (willCreate.has(document) ? "created later in this proposal — put that change first" : "not created earlier in this proposal") : "not a document in this vault"}.`);
      if (home !== SCOPE_TYPE && home !== WBS_TYPE) return void errors.push(`${at}: ${document} is a ${home}; only scopes of work and work breakdowns can be changed from the chat.`);
      if (!WORK_OPERATIONS[home].includes(type)) {
        const elsewhere = operationHome(type);
        return void errors.push(`${at}: ${type} is not an operation on a ${home}${elsewhere ? ` — it belongs to a ${elsewhere}` : ""}. Call work_operations for the list.`);
      }
      const parsed = inputOf(c.input);
      if (!parsed) return void errors.push(`${at}: input must be a JSON object.`);
      const input = withoutNulls(type, parsed);
      const problem = semanticProblem(type, input);
      if (problem) return void errors.push(`${at}: ${problem}`);
      const early = Object.values(input).find((v) => isNewRef(v) && willCreate.has(v) && !created.has(v));
      if (typeof early === "string") return void errors.push(`${at}: ${early} is used before the change that creates it — put that change first.`);
      // Described before `accept` records what it adds: an edit names the item as it is.
      const { says, warning } = describeOperation(names, document, type, input);
      if (!accept(at, home, [{ type, input }])) return;
      push({ kind, document, documentType: home, steps: [{ type, input }], says, ...(warning ? { warning } : {}) });
      return;
    }

    errors.push(`${at}: kind must be one of ${KINDS.join(", ")}.`);
  });

  if (errors.length) return { ok: false, errors };
  const refused = rehearse(out, docs);
  if (refused.length) return { ok: false, errors: refused };
  const documents: WorkProposal["documents"] = {};
  for (const c of out) {
    for (const id of [c.document, c.scope]) {
      const d = id && !isNewRef(id) ? docs.get(id) : undefined;
      if (d && (d.documentType === SCOPE_TYPE || d.documentType === WBS_TYPE)) {
        documents[d.documentId] = { title: names.titleOf(d.documentId), documentType: d.documentType };
      }
    }
  }
  return {
    ok: true,
    proposal: {
      id: newId(),
      documents,
      summary: str(raw.summary) ?? `${plural(out.length, "change")} to your work`,
      changes: out,
      deletions: out.filter((c) => c.warning).length,
      refs: [...declared.keys()],
      createdAt: now(),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  The rehearsal                                                     */
/* ------------------------------------------------------------------ */

/** Just what the rehearsal reads of a document: its state, and the error its last operation recorded. */
interface RehearsalDoc {
  state: { global: unknown };
  operations: { global: { error?: string }[] };
}

const REHEARSAL: Record<WorkDocType, { create: (global?: Record<string, unknown>) => RehearsalDoc; reduce: (d: RehearsalDoc, a: unknown) => RehearsalDoc }> = {
  [SCOPE_TYPE]: {
    create: (global) => scopeUtils.createDocument(global ? ({ global } as never) : undefined) as unknown as RehearsalDoc,
    reduce: (d, a) => scopeReducer(d as never, a as never) as unknown as RehearsalDoc,
  },
  [WBS_TYPE]: {
    create: (global) => wbsUtils.createDocument(global ? ({ global } as never) : undefined) as unknown as RehearsalDoc,
    reduce: (d, a) => wbsReducer(d as never, a as never) as unknown as RehearsalDoc,
  },
};

/** What to do about a refusal, by what was missing. */
function remedy(refusal: string): string {
  if (/project .*not found/i.test(refusal)) return "Add the project first (projects), or use a project id from read_document.";
  if (/goal .*not found/i.test(refusal)) return "Add that goal first (goals), or use a goal id from read_document.";
  if (/deliverable .*not found/i.test(refusal)) return "Add the deliverable first (deliverables), or use a deliverable id from read_document.";
  if (/already exists/i.test(refusal)) return "Give the new one its own new:<name>, or change the existing one instead.";
  return "Read it with read_document for the ids that exist, or add what is missing earlier in this proposal.";
}

/**
 * Apply a checked proposal in memory and return what the reducers refused,
 * one line per change — empty when the vault would take all of it.
 *
 * It applies exactly what Apply will (use-work-proposal.ts): the same steps,
 * the same follow-ups to a creation, in the same order. A `new:<name>` stays
 * as it is: one name, one id, as when applied. Documents the tool could not
 * read are not rehearsed — their changes are checked when applied.
 */
export function rehearse(changes: readonly ProposedChange[], docs: Map<string, LoadedDocument>): string[] {
  const copies = new Map<string, { type: WorkDocType; doc: RehearsalDoc }>();
  const deletedBy = new Map<string, string>();
  const errors: string[] = [];

  /** The copy of a document, made on first use — or null when it cannot be rehearsed. */
  const copyOf = (id: string): { type: WorkDocType; doc: RehearsalDoc } | null => {
    const have = copies.get(id);
    if (have) return have;
    const loaded = docs.get(id);
    const type = loaded?.documentType;
    if (type !== SCOPE_TYPE && type !== WBS_TYPE) return null;
    if (!loaded?.state) return null;
    const copy: { type: WorkDocType; doc: RehearsalDoc } = { type, doc: REHEARSAL[type].create(loaded.state) };
    copies.set(id, copy);
    return copy;
  };
  /** Run steps on a copy; the first refusal, with the step refused — or null. */
  const run = (copy: { type: WorkDocType; doc: RehearsalDoc }, steps: Step[]): { type: string; error: string } | null => {
    for (const step of steps) {
      const before = copy.doc.operations.global.length;
      copy.doc = REHEARSAL[copy.type].reduce(copy.doc, buildAction(copy.type, step.type, step.input));
      const error = copy.doc.operations.global.at(before)?.error;
      if (error) return { type: step.type, error };
    }
    return null;
  };

  changes.forEach((c, k) => {
    if (errors.length) return; // later changes build on earlier ones: one refusal at a time is the honest report
    const at = c.at ?? `change ${k + 1}`;
    const doc = c.document ?? "";
    if (c.kind !== "create_scope" && c.kind !== "create_wbs" && deletedBy.has(doc)) {
      errors.push(`${at}: ${doc} is deleted by ${deletedBy.get(doc)} — act on it before deleting it, or not at all.`);
      return;
    }
    if (c.kind === "create_scope") {
      const copy = { type: SCOPE_TYPE as WorkDocType, doc: REHEARSAL[SCOPE_TYPE].create() };
      copies.set(c.ref!, copy);
      const refused = run(copy, [{ type: "EDIT_SCOPE_OF_WORK", input: { title: c.title, ...(c.description ? { description: c.description } : {}), status: c.status ?? "DRAFT" } }]);
      if (refused) errors.push(`${at}: the new scope's title and status were refused — ${refused.error}.`);
      return;
    }
    if (c.kind === "create_wbs") {
      const copy = { type: WBS_TYPE as WorkDocType, doc: REHEARSAL[WBS_TYPE].create() };
      copies.set(c.ref!, copy);
      if (c.scope && c.project) {
        const scope = copyOf(c.scope);
        if (scope) {
          const refused = run(scope, [{ type: "LINK_PROJECT_WBS", input: { projectId: c.project, wbsRef: c.ref } }]);
          if (refused) return void errors.push(`${at}: the scope refused to link project ${c.project} to the new work breakdown — ${refused.error}. ${remedy(refused.error)}`);
        }
      }
      const refused = run(copy, [
        ...(c.scope && c.project ? [{ type: "SET_SOW_PROJECT_REF", input: { sowRef: c.scope, sowProjectId: c.project } }] : []),
        ...(c.owner ? [{ type: "SET_OWNER", input: { owner: c.owner } }] : []),
      ]);
      if (refused) errors.push(`${at}: the new work breakdown refused its link or owner — ${refused.error}.`);
      return;
    }
    if (c.kind === "delete_document") {
      deletedBy.set(doc, at);
      return;
    }
    // Steps, on a copy: a document created earlier in the proposal, or a loaded one.
    const copy = copyOf(doc);
    if (!copy) return;
    const refused = run(copy, c.steps ?? []);
    if (refused) {
      errors.push(`${at}: ${refused.type} would be refused by ${isNewRef(doc) ? doc : `document ${doc}`} — ${refused.error}. ${remedy(refused.error)}`);
    }
  });
  return errors;
}

/* ------------------------------------------------------------------ */
/*  Editing on the card                                               */
/* ------------------------------------------------------------------ */

/** One value of a form entry the person may change on the card: the words, never the ids. */
export interface EditableField {
  /** The entry's key — or, for an operation, a key inside its input. */
  key: string;
  label: string;
  type: "text" | "long" | "select" | "number";
  options?: readonly string[];
  required?: boolean;
}

const PEOPLE = "a person's name";
const FIELDS_BY_KIND: Partial<Record<ChangeKind, EditableField[]>> = {
  create_scope: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "description", label: "Description", type: "long" },
  ],
  add_project: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "owner", label: `Owner (${PEOPLE})`, type: "text" },
    { key: "budgetType", label: "Budget type", type: "select", options: ["OPEX", "CAPEX", "CONTINGENCY", "OVERHEAD"] },
    { key: "currency", label: "Currency", type: "select", options: ["USD", "EUR", "DAI", "USDS"] },
    { key: "budget", label: "Fixed budget", type: "number" },
  ],
  create_wbs: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "owner", label: `Owner (${PEOPLE})`, type: "text" },
  ],
  add_goal: [
    { key: "description", label: "Goal", type: "long", required: true },
    { key: "assignee", label: `Assignee (${PEOPLE})`, type: "text" },
  ],
  add_deliverable: [
    { key: "code", label: "Code", type: "text" },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "description", label: "Description", type: "long" },
    { key: "owner", label: `Owner (${PEOPLE})`, type: "text" },
    { key: "status", label: "Status", type: "select", options: ["DRAFT", "TODO", "IN_PROGRESS", "BLOCKED", "DELIVERED", "CANCELED", "WONT_DO"] },
  ],
  add_roadmap: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "description", label: "Description", type: "long" },
  ],
  add_milestone: [
    { key: "code", label: "Code", type: "text" },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "target", label: "Target date (YYYY-MM-DD)", type: "text" },
    { key: "coordinator", label: `Coordinator (${PEOPLE})`, type: "text" },
    { key: "description", label: "Description", type: "long" },
  ],
};
/** The words inside an operation's input — present ones only; its ids stay as the chat checked them. */
const OPERATION_WORDS: EditableField[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "name", label: "Name", type: "text" },
  { key: "code", label: "Code", type: "text" },
  { key: "description", label: "Description", type: "long" },
  { key: "abstract", label: "Abstract", type: "long" },
  { key: "note", label: "Note", type: "long" },
  { key: "outcome", label: "Outcome", type: "long" },
  { key: "blockReason", label: "Why it is blocked", type: "long" },
];

/** The form entry an "at" names — "projects[0]" → form.projects[0], with its kind — or null. */
export function entryAt(form: Record<string, unknown>, at: string): { list: string; index: number; kind: ChangeKind; entry: Record<string, unknown> } | null {
  const m = /^(\w+)\[(\d+)\]$/.exec(at);
  if (!m) return null;
  const [, list, i] = m;
  const items = form[list];
  const index = Number(i);
  if (!Array.isArray(items) || index >= items.length) return null;
  const raw = (items as unknown[])[index];
  const entry = typeof raw === "string" && list === "deletions" ? { document: raw } : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fromList = FORM_LISTS.find(([l]) => l === list)?.[1];
  const kind = (fromList ?? str(entry.kind)) as ChangeKind | undefined;
  return kind ? { list, index, kind, entry } : null;
}

/** An operation's input as an object, whether the model sent it as one or as JSON text. */
function operationInput(entry: Record<string, unknown>): Record<string, unknown> {
  return inputOf(entry.input) ?? {};
}

/** The fields the person may edit in an entry, with their values now. Empty for a deletion, or an operation with no words. */
export function editableFields(form: Record<string, unknown>, at: string): { field: EditableField; value: string }[] {
  const found = entryAt(form, at);
  if (!found) return [];
  const show = (v: unknown) => (v === undefined || v === null ? "" : txt(v));
  if (found.kind === "operation") {
    const input = operationInput(found.entry);
    return OPERATION_WORDS.filter((f) => typeof input[f.key] === "string").map((f) => ({ field: f, value: show(input[f.key]) }));
  }
  const alias: Record<string, string[]> = { title: ["title", "name"], description: ["description", "title", "name", "goal"], assignee: ["assignee", "owner"], name: ["name", "title"] };
  return (FIELDS_BY_KIND[found.kind] ?? []).map((field) => {
    // A goal's text may have come as title or name; its assignee as owner — show what the checker read.
    const keys = found.kind === "add_goal" || (found.kind === "create_wbs" && field.key === "name") ? (alias[field.key] ?? [field.key]) : [field.key];
    const value = keys.map((k) => found.entry[k]).find((v) => v !== undefined && v !== null && v !== "");
    // A budget of 0 is not applied (see add_project): show it as what it is, no budget.
    if (field.key === "budget" && (numberOf(value) ?? 0) <= 0) return { field, value: "" };
    return { field, value: show(value) };
  });
}

/** Values as the person typed them, made the form's: empty is "not given", a number field a number. */
function cleaned(fields: EditableField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.key in values)) continue;
    const v = values[f.key].trim();
    if (!v) out[f.key] = undefined;
    else if (f.type === "number") out[f.key] = Number.isFinite(Number(v)) ? Number(v) : v;
    else out[f.key] = v;
  }
  return out;
}

/** What is missing from an edit before it is checked: "Title is needed." — or null. */
export function missingIn(form: Record<string, unknown>, at: string, values: Record<string, string>): string | null {
  for (const { field } of editableFields(form, at)) {
    if (field.required && field.key in values && !values[field.key].trim()) return `${field.label} is needed.`;
  }
  return null;
}

/** The form with one entry's words changed. Only the fields offered for editing change; ids never do. */
export function withEdit(form: Record<string, unknown>, at: string, values: Record<string, string>): Record<string, unknown> {
  const found = entryAt(form, at);
  if (!found) return form;
  const fields = editableFields(form, at).map((f) => f.field);
  const patch = cleaned(fields, values);
  let entry: Record<string, unknown>;
  if (found.kind === "operation") {
    const input = { ...operationInput(found.entry) };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete input[k]; else input[k] = v;
    entry = { ...found.entry, input };
  } else {
    entry = { ...found.entry };
    if (found.kind === "add_goal") {
      // The checker reads a goal's text from description first, its assignee from assignee first: write those, drop the aliases.
      if ("description" in patch) for (const k of ["title", "name", "goal"]) delete entry[k];
      if ("assignee" in patch) delete entry.owner;
    }
    if (found.kind === "create_wbs" && "name" in patch) delete entry.title;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete entry[k]; else entry[k] = v;
  }
  const items = [...(form[found.list] as unknown[])];
  items[found.index] = entry;
  return { ...form, [found.list]: items };
}

/** The form without one entry — and the labels of later entries in its list, one place earlier. */
export function withoutEntry(form: Record<string, unknown>, at: string, edited: readonly string[] = []): { form: Record<string, unknown>; edited: string[] } {
  const found = entryAt(form, at);
  if (!found) return { form, edited: [...edited] };
  const items = (form[found.list] as unknown[]).filter((_, i) => i !== found.index);
  const relabel = (label: string): string | null => {
    const m = /^(\w+)\[(\d+)\]$/.exec(label);
    if (!m || m[1] !== found.list) return label;
    const i = Number(m[2]);
    if (i === found.index) return null;
    return i > found.index ? `${m[1]}[${i - 1}]` : label;
  };
  return {
    form: { ...form, [found.list]: items },
    edited: edited.map(relabel).filter((l): l is string => l !== null),
  };
}

/** A checker message the person reads under a field: the model's guidance — the entry's label, the JSON example — left out. */
export function forThePerson(error: string): string {
  const words: Record<string, string> = {
    create_scope: "the scope",
    add_project: "the project",
    add_deliverable: "the deliverable",
    create_wbs: "the work breakdown",
    add_goal: "the goal",
    delete_document: "the deletion",
  };
  const plain = error
    .replace(/^\w+\[\d+\]:\s*/, "")
    .replace(/^change \d+:\s*/, "")
    .replace(/\s*Write it like this: .*$/, "")
    .replace(/\s*— ask (them|the person)[^.]*\.?$/, ".")
    .replace(/\b(create_scope|add_project|add_deliverable|create_wbs|add_goal|delete_document)\b/g, (k) => words[k] ?? k)
    .trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
