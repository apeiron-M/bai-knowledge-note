import {
  defaultGlobalState,
  reducer,
  utils,
} from "document-models/scope-of-work/v1";
import type {
  Deliverable,
  DeliverablesSet,
  Milestone,
  Project,
  Roadmap,
} from "../gen/schema/types.js";
import { percentageProgress } from "../src/reducers/progress.js";

export type Doc = ReturnType<typeof utils.createDocument>;
export type Action = Parameters<typeof reducer>[1];

/** Dispatch a sequence of actions against a document, in order. */
export function apply(doc: Doc, ...actions: Action[]): Doc {
  return actions.reduce<Doc>(
    (current, action) => reducer(current, action),
    doc,
  );
}

/** The error recorded on the operation at `index`, or undefined if it applied cleanly. */
export function errorAt(doc: Doc, index: number): string | undefined {
  return doc.operations.global[index].error;
}

export function lastError(doc: Doc): string | undefined {
  return errorAt(doc, doc.operations.global.length - 1);
}

/** Every error recorded across all operations — expect `[]` for a clean run. */
export function errors(doc: Doc): string[] {
  return doc.operations.global.flatMap((op) => (op.error ? [op.error] : []));
}

export function state(doc: Doc) {
  return doc.state.global;
}

/**
 * A fresh document whose global state starts from `global`.
 * Never mutate a document's state in place: `createDocument()` shallow-spreads a
 * shared `initialGlobalState`, so a `.push` there leaks into every later document.
 */
export function craft(global: Partial<Doc["state"]["global"]>): Doc {
  return utils.createDocument({
    global: { ...defaultGlobalState(), ...global },
  });
}

export function emptySet(): DeliverablesSet {
  return {
    deliverables: [],
    status: "DRAFT",
    progress: percentageProgress(0),
    deliverablesCompleted: { total: 0, completed: 0 },
  };
}

/**
 * Builders for hand-crafted state. The generated types allow `scope`,
 * `workProgress` and `budgetAnchor` to be null even though the reducers
 * never produce that — these let tests reach the branches that guard it.
 */
export function rawDeliverable(
  overrides: Partial<Deliverable> & { id: string },
): Deliverable {
  return {
    owner: null,
    icon: null,
    title: "",
    code: "",
    description: "",
    status: "DRAFT",
    workProgress: null,
    keyResults: [],
    goalRef: null,
    budgetAnchor: {
      project: "",
      unit: "Hours",
      unitCost: 0,
      quantity: 0,
      margin: 0,
      marginPinned: false,
    },
    ...overrides,
  };
}

export function rawProject(
  overrides: Partial<Project> & { id: string },
): Project {
  return {
    code: "",
    title: "",
    slug: "",
    projectOwner: null,
    abstract: null,
    imageUrl: null,
    budgetType: null,
    currency: null,
    budget: 0,
    targetBudget: null,
    expenditure: null,
    scope: emptySet(),
    wbsRef: null,
    knowledgeRefs: [],
    references: [],
    ...overrides,
  };
}

export function rawMilestone(
  overrides: Partial<Milestone> & { id: string },
): Milestone {
  return {
    sequenceCode: "",
    title: "",
    description: "",
    deliveryTarget: "",
    coordinators: [],
    scope: emptySet(),
    budget: 0,
    ...overrides,
  };
}

export function rawRoadmap(
  overrides: Partial<Roadmap> & { id: string },
): Roadmap {
  return { title: "", slug: "", description: "", milestones: [], ...overrides };
}
