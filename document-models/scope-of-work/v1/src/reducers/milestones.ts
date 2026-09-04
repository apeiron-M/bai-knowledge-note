import type { ScopeOfWorkMilestonesOperations } from "document-models/scope-of-work/v1";
import type { EditMilestoneAction } from "../../gen/milestones/actions.js";
import {
  MilestoneAlreadyExistsError,
  MilestoneDeliverableAlreadyExistsError,
} from "../../gen/milestones/error.js";
import type { ScopeOfWorkState } from "../../gen/schema/types.js";
import type { Deliverable } from "../../gen/types.js";
import { deleteDeliverables, findMilestone } from "./lookup.js";
import { percentageProgress } from "./progress.js";
import { applyInvariants } from "./projects.js";
import { isSet } from "./util.js";

export const scopeOfWorkMilestonesOperations: ScopeOfWorkMilestonesOperations =
  {
    editMilestoneOperation(
      state: ScopeOfWorkState,
      action: EditMilestoneAction,
    ) {
      const foundRoadmap = state.roadmaps.find(
        (roadmap) => String(roadmap.id) === String(action.input.roadmapId),
      );
      if (!foundRoadmap) {
        throw new Error("Roadmap not found");
      }

      const foundMilestone = foundRoadmap.milestones.find(
        (milestone) => String(milestone.id) === String(action.input.id),
      );
      if (!foundMilestone) {
        throw new Error("Milestone not found");
      }

      const { input } = action;
      const updatedMilestone = {
        ...foundMilestone,
        sequenceCode: isSet(input.sequenceCode)
          ? input.sequenceCode
          : foundMilestone.sequenceCode,
        title: isSet(input.title) ? input.title : foundMilestone.title,
        description: isSet(input.description)
          ? input.description
          : foundMilestone.description,
        deliveryTarget: isSet(input.deliveryTarget)
          ? input.deliveryTarget
          : foundMilestone.deliveryTarget,
      };

      foundRoadmap.milestones = foundRoadmap.milestones.map((milestone) =>
        String(milestone.id) === String(action.input.id)
          ? updatedMilestone
          : milestone,
      );
      state.roadmaps = state.roadmaps.map((roadmap) => {
        return String(roadmap.id) === String(action.input.roadmapId)
          ? foundRoadmap
          : roadmap;
      });
    },
    addCoordinatorOperation(state, action) {
      const found = findMilestone(state, action.input.milestoneId);
      if (!found) {
        throw new Error(
          `Roadmap with milestone ${action.input.milestoneId} not found`,
        );
      }
      const { roadmap: foundRoadmap, milestone: foundMilestone } = found;

      if (!foundMilestone.coordinators.includes(action.input.id)) {
        foundMilestone.coordinators.push(action.input.id);
      }

      state.roadmaps = state.roadmaps.map((roadmap) => {
        return String(roadmap.id) === String(foundRoadmap.id)
          ? foundRoadmap
          : roadmap;
      });
    },
    removeCoordinatorOperation(state, action) {
      const found = findMilestone(state, action.input.milestoneId);
      if (!found) {
        throw new Error(
          `Roadmap with milestone ${action.input.milestoneId} not found`,
        );
      }
      const { roadmap: foundRoadmap, milestone: foundMilestone } = found;

      foundMilestone.coordinators = foundMilestone.coordinators.filter(
        (coordinatorId) => coordinatorId !== action.input.id,
      );

      state.roadmaps = state.roadmaps.map((roadmap) => {
        return String(roadmap.id) === String(foundRoadmap.id)
          ? foundRoadmap
          : roadmap;
      });
    },
    addMilestoneOperation(state, action) {
      const foundRoadmap = state.roadmaps.find(
        (roadmap) => String(roadmap.id) === String(action.input.roadmapId),
      );
      if (!foundRoadmap) {
        throw new Error("Roadmap not found");
      }
      if (findMilestone(state, action.input.id)) {
        throw new MilestoneAlreadyExistsError(
          `Milestone with ID ${action.input.id} already exists`,
        );
      }

      const milestone = {
        id: action.input.id,
        sequenceCode: action.input.sequenceCode || "",
        title: action.input.title || "",
        description: action.input.description || "",
        deliveryTarget: action.input.deliveryTarget || "",
        coordinators: [],
        scope: {
          deliverables: [],
          status: "DRAFT" as const,
          progress: percentageProgress(0),
          deliverablesCompleted: {
            total: 0,
            completed: 0,
          },
        },
        budget: 0,
      };

      foundRoadmap.milestones.push(milestone);
      state.roadmaps = state.roadmaps.map((roadmap) => {
        return String(roadmap.id) === String(action.input.roadmapId)
          ? foundRoadmap
          : roadmap;
      });
    },
    removeMilestoneOperation(state, action) {
      const foundRoadmap = state.roadmaps.find(
        (roadmap) => String(roadmap.id) === String(action.input.roadmapId),
      );
      if (!foundRoadmap) {
        throw new Error("Roadmap not found");
      }

      const foundMilestone = foundRoadmap.milestones.find(
        (milestone) => String(milestone.id) === String(action.input.id),
      );
      if (!foundMilestone) {
        throw new Error("Milestone not found");
      }

      // the milestone's deliverables go with it, wherever else they were listed
      deleteDeliverables(state, [
        ...(foundMilestone.scope?.deliverables ?? []),
      ]);

      foundRoadmap.milestones = foundRoadmap.milestones.filter(
        (milestone) => String(milestone.id) !== String(action.input.id),
      );
      state.roadmaps = state.roadmaps.map((roadmap) => {
        return String(roadmap.id) === String(foundRoadmap.id)
          ? foundRoadmap
          : roadmap;
      });
      applyInvariants(state);
    },
    addMilestoneDeliverableOperation(state, action) {
      // resolve the target first: a throw after mutating would leave an orphan deliverable behind
      const found = findMilestone(state, action.input.milestoneId);
      if (!found) {
        throw new Error("Milestone not found");
      }
      const { milestone: foundMilestone } = found;
      if (!foundMilestone.scope) {
        throw new Error("Milestone deliverable set not found");
      }
      if (
        state.deliverables.some(
          (d) => String(d.id) === String(action.input.deliverableId),
        )
      ) {
        throw new MilestoneDeliverableAlreadyExistsError(
          `Deliverable with ID ${action.input.deliverableId} already exists`,
        );
      }

      const newDeliverable: Deliverable = {
        id: action.input.deliverableId,
        owner: "",
        icon: "",
        title: action.input.title,
        code: "",
        description: "",
        status: "DRAFT",
        workProgress: percentageProgress(0),
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

      state.deliverables.push(newDeliverable);
      foundMilestone.scope.deliverables.push(newDeliverable.id);
      applyInvariants(state);
    },
    removeMilestoneDeliverableOperation(state, action) {
      const found = findMilestone(state, action.input.milestoneId);
      if (!found) {
        throw new Error("Roadmap not found");
      }
      const { milestone: foundMilestone } = found;
      if (!foundMilestone.scope) {
        throw new Error("Milestone deliverable set not found");
      }
      foundMilestone.scope.deliverables =
        foundMilestone.scope.deliverables.filter(
          (deliverableId) => deliverableId !== action.input.deliverableId,
        );

      state.deliverables = state.deliverables.map((deliverable) => {
        return String(deliverable.id) === String(action.input.deliverableId)
          ? {
              ...deliverable,
              budgetAnchor: {
                project: "",
                unit: deliverable.budgetAnchor?.unit || "Hours",
                unitCost: deliverable.budgetAnchor?.unitCost || 0,
                quantity: deliverable.budgetAnchor?.quantity || 0,
                margin: deliverable.budgetAnchor?.margin || 0,
                marginPinned: deliverable.budgetAnchor?.marginPinned ?? false,
              },
            }
          : deliverable;
      });
      applyInvariants(state);
    },
  };
