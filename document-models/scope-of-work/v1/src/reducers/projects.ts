import type { ScopeOfWorkProjectsOperations } from "document-models/scope-of-work/v1";
import {
  InvalidBudgetUpdateError,
  InvalidExpenditureError,
  InvalidInitialBudgetError,
  InvalidProjectBudgetError,
  InvalidProjectMarginError,
  KnowledgeRefAlreadyExistsError,
  KnowledgeRefNotFoundError,
  ProjectAlreadyExistsError,
  ProjectDeliverableAlreadyExistsError,
  ProjectNotFoundError,
} from "../../gen/projects/error.js";
import type {
  Deliverable,
  DeliverablesSet,
  Progress,
  ScopeOfWorkState,
} from "../../gen/schema/types.js";
import { deleteDeliverables } from "./lookup.js";
import { percentageProgress, storyPointsProgress } from "./progress.js";
import { isSet, round2 } from "./util.js";

export const scopeOfWorkProjectsOperations: ScopeOfWorkProjectsOperations = {
  addProjectOperation(state, action) {
    if (state.projects.some((p) => p.id === action.input.id)) {
      throw new ProjectAlreadyExistsError(
        `Project with ID ${action.input.id} already exists`,
      );
    }
    if (isSet(action.input.budget) && action.input.budget < 0) {
      throw new InvalidInitialBudgetError("Budget must be zero or positive");
    }
    // a budget given at creation fixes the project's envelope from day one
    const targetBudget = isSet(action.input.budget)
      ? round2(action.input.budget)
      : null;

    state.projects.push({
      id: action.input.id,
      code: action.input.code,
      title: action.input.title,
      slug: action.input.slug || "",
      projectOwner: action.input.projectOwner || null,
      abstract: action.input.abstract || null,
      imageUrl: action.input.imageUrl || null,
      budgetType: action.input.budgetType || "CAPEX",
      currency: action.input.currency || "USD",
      budget: targetBudget ?? 0,
      targetBudget,
      expenditure: { percentage: 0, actuals: 0, cap: 0 },
      scope: {
        deliverables: [],
        status: "DRAFT" as const,
        progress: percentageProgress(0),
        deliverablesCompleted: { total: 0, completed: 0 },
      },
      // execution links start empty; the vault fills them in
      wbsRef: null,
      knowledgeRefs: [],
      references: [],
    });
  },
  updateProjectOperation(state, action) {
    const project = state.projects.find((p) => p.id === action.input.id);
    if (!project) {
      throw new Error("Project not found");
    }
    const { input } = action;
    if (isSet(input.budget) && input.budget < 0) {
      throw new InvalidBudgetUpdateError("Budget must be zero or positive");
    }
    // required fields ignore an explicit null; nullable fields accept it as "clear"
    if (isSet(input.title)) project.title = input.title;
    if (isSet(input.code)) project.code = input.code;
    if (isSet(input.slug)) project.slug = input.slug;
    if (input.abstract !== undefined) project.abstract = input.abstract;
    if (input.imageUrl !== undefined) project.imageUrl = input.imageUrl;
    if (input.budgetType !== undefined) project.budgetType = input.budgetType;
    if (input.currency !== undefined) project.currency = input.currency;
    // `budget` sets (or, with null, releases) the fixed envelope; the derived budget follows
    if (input.budget !== undefined)
      project.targetBudget =
        input.budget === null ? null : round2(input.budget);
    applyInvariants(state);
  },
  updateProjectOwnerOperation(state, action) {
    const project = state.projects.find((p) => p.id === action.input.id);
    if (!project) {
      throw new Error("Project not found");
    }
    project.projectOwner = action.input.projectOwner;
  },
  removeProjectOperation(state, action) {
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new ProjectNotFoundError("Project not found");
    }
    // the project's deliverables go with it, wherever else they were listed
    deleteDeliverables(state, [...(project.scope?.deliverables ?? [])]);
    state.projects = state.projects.filter(
      (p) => p.id !== action.input.projectId,
    );
    applyInvariants(state);
  },
  setProjectMarginOperation(state, action) {
    if (action.input.margin < 0) {
      throw new InvalidProjectMarginError("Margin must be zero or positive");
    }
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const projectDeliverableSet = project.scope;
    if (!projectDeliverableSet) {
      throw new Error("Project deliverable set not found`");
    }
    if (projectDeliverableSet.deliverables.length < 1) {
      throw new Error("Project deliverable set has no deliverables");
    }
    // a margin set by a person is pinned: a fixed budget solves around it, never over it
    const margin = round2(action.input.margin);
    for (const deliverable of fundedDeliverables(
      state,
      projectDeliverableSet,
    )) {
      if (deliverable.budgetAnchor) {
        deliverable.budgetAnchor = {
          ...deliverable.budgetAnchor,
          margin,
          marginPinned: true,
        };
      }
    }
    applyInvariants(state);
  },
  setProjectTotalBudgetOperation(state, action) {
    const { totalBudget } = action.input;
    if (totalBudget < 0) {
      throw new InvalidProjectBudgetError(
        "Total budget must be zero or positive",
      );
    }
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    // fixes the envelope; unpinned margins are derived from it by the invariant
    project.targetBudget = round2(totalBudget);
    applyInvariants(state);
  },
  addProjectDeliverableOperation(state, action) {
    // resolve the target first: a throw after mutating would leave an orphan deliverable behind
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (!project.scope) {
      throw new Error("Project deliverable set not found");
    }
    if (
      state.deliverables.some(
        (d) => String(d.id) === String(action.input.deliverableId),
      )
    ) {
      throw new ProjectDeliverableAlreadyExistsError(
        `Deliverable with ID ${action.input.deliverableId} already exists`,
      );
    }
    const newDeliverable: Deliverable = {
      id: action.input.deliverableId,
      owner: "",
      title: action.input.title,
      icon: "",
      code: "",
      description: "",
      status: "DRAFT",
      workProgress: percentageProgress(0),
      keyResults: [],
      goalRef: null,
      budgetAnchor: {
        project: action.input.projectId,
        unit: "Hours",
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      },
    };
    state.deliverables.push(newDeliverable);
    project.scope.deliverables.push(newDeliverable.id);
    applyInvariants(state);
  },
  removeProjectDeliverableOperation(state, action) {
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (!project.scope) {
      throw new Error("Project deliverable set not found");
    }
    project.scope.deliverables = project.scope.deliverables.filter(
      (d) => d !== action.input.deliverableId,
    );
    state.deliverables = state.deliverables.map((deliverable) =>
      String(deliverable.id) === String(action.input.deliverableId)
        ? { ...deliverable, budgetAnchor: detachedAnchor(deliverable) }
        : deliverable,
    );
    applyInvariants(state);
  },
  setProjectExpenditureOperation(state, action) {
    const { actuals, cap } = action.input;
    if ((actuals ?? 0) < 0 || (cap ?? 0) < 0) {
      throw new InvalidExpenditureError(
        "Actuals and cap must be zero or positive",
      );
    }
    const project = state.projects.find((p) => p.id === action.input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const current = project.expenditure ?? {
      percentage: 0,
      actuals: 0,
      cap: 0,
    };
    project.expenditure = {
      actuals: isSet(actuals) ? round2(actuals) : current.actuals,
      cap: isSet(cap) ? round2(cap) : current.cap,
      percentage: current.percentage, // derived by the invariant below
    };
    applyInvariants(state);
  },
  linkProjectWbsOperation(state, action) {
    const project = requireProject(state, action.input.projectId);
    // a missing or null wbsRef unlinks — the same setter style as
    // bai/project's LINK_WBS, so the vault can clear it without a second op
    project.wbsRef = action.input.wbsRef || null;
  },
  addProjectKnowledgeRefOperation(state, action) {
    const project = requireProject(state, action.input.projectId);
    const refs = storedKnowledgeRefs(project);
    if (refs.includes(action.input.ref)) {
      throw new KnowledgeRefAlreadyExistsError(
        `Project ${action.input.projectId} already cites ${action.input.ref}`,
      );
    }
    project.knowledgeRefs = [...refs, action.input.ref];
  },
  removeProjectKnowledgeRefOperation(state, action) {
    const project = requireProject(state, action.input.projectId);
    const refs = storedKnowledgeRefs(project);
    if (!refs.includes(action.input.ref)) {
      throw new KnowledgeRefNotFoundError(
        `Project ${action.input.projectId} does not cite ${action.input.ref}`,
      );
    }
    project.knowledgeRefs = refs.filter((r) => r !== action.input.ref);
  },
  setProjectReferencesOperation(state, action) {
    const project = requireProject(state, action.input.projectId);
    // replaces the whole list, as bai/project's SET_REFERENCES does
    project.references = [...action.input.references];
  },
};

/** The anchor a deliverable keeps when it leaves a project or milestone: same quote, no funder. */
export const detachedAnchor = (deliverable: Deliverable) => ({
  project: "",
  unit: deliverable.budgetAnchor?.unit || "Hours",
  unitCost: deliverable.budgetAnchor?.unitCost || 0,
  quantity: deliverable.budgetAnchor?.quantity || 0,
  margin: deliverable.budgetAnchor?.margin || 0,
  marginPinned: deliverable.budgetAnchor?.marginPinned ?? false,
});

/**
 * Re-derive everything that depends on the deliverables, in dependency order:
 * project budgets (or, for fixed budgets, the margins that fit them), milestone
 * budgets from the resulting line budgets, then progress.
 * Every operation that touches a deliverable, a quote or a scope calls this.
 */
export const applyInvariants = (state: ScopeOfWorkState) => {
  for (const project of state.projects) {
    if (!project.scope) continue;
    const deliverables = fundedDeliverables(state, project.scope);
    if (isSet(project.targetBudget)) {
      fitMarginsToBudget(deliverables, project.targetBudget);
      project.budget = project.targetBudget;
    } else {
      project.budget = round2(
        deliverables.reduce((acc, d) => acc + lineBudget(d), 0),
      );
    }
    // spending is read against the cap when one is set, otherwise against the budget
    if (project.expenditure) {
      const base =
        project.expenditure.cap > 0
          ? project.expenditure.cap
          : (project.budget ?? 0);
      project.expenditure.percentage =
        base > 0 ? round2((project.expenditure.actuals / base) * 100) : 0;
    }
  }
  for (const roadmap of state.roadmaps) {
    for (const milestone of roadmap.milestones) {
      if (milestone.scope) {
        milestone.budget = round2(
          fundedDeliverables(state, milestone.scope).reduce(
            (acc, d) => acc + lineBudget(d),
            0,
          ),
        );
      }
    }
  }
  calculateDeliverableSetsProgress(state);
};

/**
 * Fixed budget: pinned margins hold; every unpinned quote gets the single margin that makes
 * the lines add up to the envelope. Negative when the work costs more than the envelope —
 * that is the "over budget" signal, not an error. Nothing to solve when everything is pinned.
 */
const fitMarginsToBudget = (deliverables: Deliverable[], target: number) => {
  const free = deliverables.filter(
    (d) => d.budgetAnchor && d.budgetAnchor.marginPinned !== true,
  );
  const pinnedBudget = deliverables
    .filter((d) => d.budgetAnchor?.marginPinned === true)
    .reduce((acc, d) => acc + lineBudget(d), 0);
  const freeCost = free.reduce((acc, d) => acc + lineCost(d), 0);
  if (freeCost <= 0) return;
  const margin = round2(((target - pinnedBudget) / freeCost - 1) * 100);
  for (const d of free) {
    if (d.budgetAnchor) d.budgetAnchor = { ...d.budgetAnchor, margin };
  }
};

const fundedDeliverables = (
  state: ScopeOfWorkState,
  set: DeliverablesSet,
): Deliverable[] =>
  set.deliverables
    .map((id) => state.deliverables.find((d) => d.id === id))
    .filter((d): d is Deliverable => d !== undefined);

export const lineCost = (d: Deliverable): number =>
  d.budgetAnchor ? d.budgetAnchor.unitCost * d.budgetAnchor.quantity : 0;
export const lineBudget = (d: Deliverable): number =>
  d.budgetAnchor ? round2(lineCost(d) * (1 + d.budgetAnchor.margin / 100)) : 0;

// Helper function to determine if a deliverable uses story points
const isStoryPointsProgress = (
  progress: Progress | null | undefined,
): progress is Progress & { total: number; completed: number } => {
  return (
    progress != null &&
    typeof progress.total === "number" &&
    typeof progress.completed === "number"
  );
};

// Helper function to determine if a deliverable uses percentage progress
const isPercentageProgress = (
  progress: Progress | null | undefined,
): progress is Progress & { value: number } => {
  return progress != null && typeof progress.value === "number";
};

// Helper function to determine if a deliverable uses binary progress
const isBinaryProgress = (
  progress: Progress | null | undefined,
): progress is Progress & { done: boolean } => {
  return progress != null && typeof progress.done === "boolean";
};

// Helper function to calculate percentage equivalent for any progress type
const getPercentageEquivalent = (deliverable: Deliverable): number => {
  if (!deliverable.workProgress) {
    return 0;
  }
  const progress = deliverable.workProgress;
  if (isPercentageProgress(progress)) {
    return progress.value;
  }
  if (isStoryPointsProgress(progress)) {
    return progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  }
  if (isBinaryProgress(progress)) {
    if (deliverable.status === "IN_PROGRESS") {
      return 50;
    }
    return progress.done ? 100 : 0;
  }
  return 0;
};

// Helper function to check if deliverable should be ignored
const shouldIgnoreDeliverable = (deliverable: Deliverable): boolean => {
  return deliverable.status === "CANCELED" || deliverable.status === "WONT_DO";
};

// Helper function to calculate progress for a single deliverable set
const calculateDeliverableSetProgress = (
  state: ScopeOfWorkState,
  deliverableSet: DeliverablesSet,
) => {
  const deliverables = deliverableSet.deliverables
    .map((id) => state.deliverables.find((d) => d.id === id))
    .filter(
      (deliverable): deliverable is Deliverable =>
        deliverable != null && !shouldIgnoreDeliverable(deliverable),
    );

  if (deliverables.length === 0) {
    deliverableSet.progress = percentageProgress(0);
    deliverableSet.deliverablesCompleted = { total: 0, completed: 0 };
    return;
  }

  const allUseStoryPoints = deliverables.every(
    (d) => d.workProgress != null && isStoryPointsProgress(d.workProgress),
  );

  if (allUseStoryPoints) {
    let totalStoryPoints = 0;
    let completedStoryPoints = 0;
    deliverables.forEach((deliverable) => {
      if (isStoryPointsProgress(deliverable.workProgress)) {
        totalStoryPoints += deliverable.workProgress.total;
        completedStoryPoints += deliverable.workProgress.completed;
      }
    });
    deliverableSet.progress = storyPointsProgress(
      totalStoryPoints,
      completedStoryPoints,
    );
  } else {
    const percentages = deliverables.map((d) => getPercentageEquivalent(d));
    // the empty-set case returned early above, so percentages is never empty
    const averagePercentage =
      percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
    deliverableSet.progress = percentageProgress(round2(averagePercentage));
  }

  const completedDeliverables = deliverables.filter((d) => {
    const progress = d.workProgress;
    return (
      d.status === "DELIVERED" || (isBinaryProgress(progress) && progress.done)
    );
  });
  deliverableSet.deliverablesCompleted = {
    total: deliverables.length,
    completed: completedDeliverables.length,
  };
};

const calculateDeliverableSetsProgress = (state: ScopeOfWorkState) => {
  // every deliverable set — in projects and in milestones — derives its progress from its deliverables:
  // story points only → summed points; otherwise the average percentage equivalent
  state.projects.forEach((project) => {
    if (project.scope) {
      calculateDeliverableSetProgress(state, project.scope);
    }
  });
  state.roadmaps.forEach((roadmap) => {
    roadmap.milestones.forEach((milestone) => {
      if (milestone.scope) {
        calculateDeliverableSetProgress(state, milestone.scope);
      }
    });
  });
};

/** The project an execution-link operation targets, or the model's own not-found error. */
function requireProject(state: ScopeOfWorkState, projectId: string) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new ProjectNotFoundError(`Project ${projectId} not found`);
  }
  return project;
}

/**
 * The citations a project holds today. The schema types `knowledgeRefs` as a
 * non-nullable array, which is true of every project created since the field
 * existed — but a document written under the previous schema stores projects
 * with no array at all, and a reducer that assumed the type would crash on
 * the first citation added to an old project. The cast is the one place this
 * repo admits stored data can predate the schema.
 */
function storedKnowledgeRefs(project: { knowledgeRefs: string[] }): string[] {
  return (project as { knowledgeRefs?: string[] }).knowledgeRefs ?? [];
}
