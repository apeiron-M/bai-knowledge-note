import type { ScopeOfWorkDeliverablesOperations } from "document-models/scope-of-work/v1";
import {
  DeliverableAlreadyExistsError,
  DeliverableClosedError,
  DeliverableNotFoundError,
  InvalidBudgetAnchorError,
  InvalidProgressError,
  KeyResultAlreadyExistsError,
} from "../../gen/deliverables/error.js";
import type {
  Deliverable,
  DeliverableStatus,
  Progress,
} from "../../gen/schema/types.js";
import { deleteDeliverables } from "./lookup.js";
import {
  binaryProgress,
  percentageProgress,
  storyPointsProgress,
} from "./progress.js";
import { applyInvariants } from "./projects.js";
import { isSet, round2 } from "./util.js";

export const scopeOfWorkDeliverablesOperations: ScopeOfWorkDeliverablesOperations =
  {
    addDeliverableOperation(state, action) {
      if (
        state.deliverables.some((d) => String(d.id) === String(action.input.id))
      ) {
        throw new DeliverableAlreadyExistsError(
          `Deliverable with ID ${action.input.id} already exists`,
        );
      }

      const deliverable: Deliverable = {
        id: action.input.id,
        owner: action.input.owner || null,
        icon: null,
        title: action.input.title || "",
        code: action.input.code || "",
        description: action.input.description || "",
        status: action.input.status || "DRAFT",
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
      };

      state.deliverables.push(deliverable);
    },
    removeDeliverableOperation(state, action) {
      const deliverable = state.deliverables.find(
        (deliverable) => String(deliverable.id) === String(action.input.id),
      );
      if (!deliverable) {
        throw new Error("Deliverable not found");
      }

      // unlinks it from every project and milestone scope, then deletes it
      deleteDeliverables(state, [action.input.id]);
      applyInvariants(state);
    },
    editDeliverableOperation(state, action) {
      const deliverable = state.deliverables.find(
        (deliverable) => String(deliverable.id) === String(action.input.id),
      );
      if (!deliverable) {
        throw new Error("Deliverable not found");
      }

      const updatedDeliverable: Deliverable = {
        ...deliverable,
        owner:
          action.input.owner !== undefined
            ? action.input.owner
            : deliverable.owner,
        icon:
          action.input.icon !== undefined
            ? action.input.icon
            : deliverable.icon,
        title:
          action.input.title !== undefined
            ? (action.input.title ?? "")
            : deliverable.title,
        code:
          action.input.code !== undefined
            ? (action.input.code ?? "")
            : deliverable.code,
        description:
          action.input.description !== undefined
            ? (action.input.description ?? "")
            : deliverable.description,
        status:
          action.input.status !== undefined && action.input.status !== null
            ? action.input.status
            : deliverable.status,
      };

      state.deliverables = state.deliverables.map((deliverable) =>
        String(deliverable.id) === String(action.input.id)
          ? updatedDeliverable
          : deliverable,
      );
      applyInvariants(state);
    },
    setDeliverableProgressOperation(state, action) {
      const deliverable = state.deliverables.find(
        (deliverable) => String(deliverable.id) === String(action.input.id),
      );
      if (!deliverable) {
        throw new Error("Deliverable not found");
      }
      if (
        deliverable.status === "CANCELED" ||
        deliverable.status === "WONT_DO"
      ) {
        throw new DeliverableClosedError(
          `Deliverable ${action.input.id} is closed`,
        );
      }

      const input = action.input.workProgress;
      let workProgress = deliverable.workProgress;
      if (input) {
        if (isSet(input.percentage)) {
          if (input.percentage < 0 || input.percentage > 100) {
            throw new InvalidProgressError(
              "Percentage must be between 0 and 100",
            );
          }
          workProgress = percentageProgress(round2(input.percentage));
        } else if (input.storyPoints) {
          const { total, completed } = input.storyPoints;
          if (total < 0 || completed < 0 || completed > total) {
            throw new InvalidProgressError(
              "Story points must be non-negative and completed cannot exceed total",
            );
          }
          workProgress = storyPointsProgress(total, completed);
        } else if (isSet(input.done)) {
          workProgress = binaryProgress(input.done);
        }
      }

      const status: DeliverableStatus = isCompleted(workProgress)
        ? "DELIVERED"
        : "IN_PROGRESS";
      const updatedDeliverable: Deliverable = {
        ...deliverable,
        workProgress,
        status,
      };

      state.deliverables = state.deliverables.map((deliverable) =>
        String(deliverable.id) === String(action.input.id)
          ? updatedDeliverable
          : deliverable,
      );
      applyInvariants(state);
    },
    addKeyResultOperation(state, action) {
      const updatedDeliverable = state.deliverables.find(
        (deliverable) =>
          String(deliverable.id) === String(action.input.deliverableId),
      );
      if (!updatedDeliverable) {
        throw new Error("Deliverable not found");
      }
      if (
        updatedDeliverable.keyResults.some(
          (keyResult) => String(keyResult.id) === String(action.input.id),
        )
      ) {
        throw new KeyResultAlreadyExistsError(
          `Key result with ID ${action.input.id} already exists`,
        );
      }

      updatedDeliverable.keyResults.push({
        id: action.input.id,
        title: action.input.title || "",
        link: action.input.link || "",
      });
    },
    removeKeyResultOperation(state, action) {
      const updatedDeliverable = state.deliverables.find(
        (deliverable) =>
          String(deliverable.id) === String(action.input.deliverableId),
      );
      if (!updatedDeliverable) {
        throw new Error("Deliverable not found");
      }

      updatedDeliverable.keyResults = updatedDeliverable.keyResults.filter(
        (keyResult) => String(keyResult.id) !== String(action.input.id),
      );
    },
    editKeyResultOperation(state, action) {
      const updatedDeliverable = state.deliverables.find(
        (deliverable) =>
          String(deliverable.id) === String(action.input.deliverableId),
      );
      if (!updatedDeliverable) {
        throw new Error("Deliverable not found");
      }

      updatedDeliverable.keyResults = updatedDeliverable.keyResults.map(
        (keyResult) =>
          String(keyResult.id) === String(action.input.id)
            ? {
                ...keyResult,
                title: isSet(action.input.title)
                  ? action.input.title
                  : keyResult.title,
                link: isSet(action.input.link)
                  ? action.input.link
                  : keyResult.link,
              }
            : keyResult,
      );
    },
    setDeliverableBudgetAnchorProjectOperation(state, action) {
      const foundDeliverable = state.deliverables.find(
        (deliverable) =>
          String(deliverable.id) === String(action.input.deliverableId),
      );
      if (!foundDeliverable) {
        throw new Error("Deliverable not found");
      }

      const { project, unit, unitCost, quantity, margin, marginPinned } =
        action.input;
      if ((unitCost ?? 0) < 0 || (quantity ?? 0) < 0 || (margin ?? 0) < 0) {
        throw new InvalidBudgetAnchorError(
          "Budget anchor values must be zero or positive",
        );
      }

      // only the anchor's own fields are written; the input's deliverableId never leaks in.
      // A margin typed by a person is pinned unless told otherwise; `marginPinned: false` releases it
      // so a fixed project budget can derive it again.
      const current = foundDeliverable.budgetAnchor ?? {
        project: "",
        unit: "Hours" as const,
        unitCost: 0,
        quantity: 0,
        margin: 0,
        marginPinned: false,
      };
      foundDeliverable.budgetAnchor = {
        project: project !== undefined ? project : current.project,
        unit: isSet(unit) ? unit : current.unit,
        unitCost: isSet(unitCost) ? round2(unitCost) : current.unitCost,
        quantity: isSet(quantity) ? round2(quantity) : current.quantity,
        margin: isSet(margin) ? round2(margin) : current.margin,
        marginPinned: isSet(marginPinned)
          ? marginPinned
          : isSet(margin)
            ? true
            : (current.marginPinned ?? false),
      };

      applyInvariants(state);
    },
    linkDeliverableGoalOperation(state, action) {
      const deliverable = state.deliverables.find(
        (d) => String(d.id) === String(action.input.deliverableId),
      );
      if (!deliverable) {
        throw new DeliverableNotFoundError(
          `Deliverable ${action.input.deliverableId} not found`,
        );
      }
      // A missing or null goalRef unlinks — the same setter style as the
      // project's LINK_PROJECT_WBS, so the vault clears it without a second op.
      deliverable.goalRef = action.input.goalRef || null;
    },
  };

/** Delivered when the binary flag is set, the percentage hits 100, or every story point is done. */
const isCompleted = (progress: Progress | null | undefined): boolean =>
  isSet(progress) &&
  (progress.done === true ||
    progress.value === 100 ||
    (isSet(progress.total) &&
      progress.total > 0 &&
      progress.completed === progress.total));
