import type { ScopeOfWorkDeliverablesSetOperations } from "document-models/scope-of-work/v1";
import type { EditDeliverablesSetAction } from "../../gen/deliverables-set/actions.js";
import { SetDeliverableNotFoundError } from "../../gen/deliverables-set/error.js";
import type { ScopeOfWorkState } from "../../gen/schema/types.js";
import { findMilestone } from "./lookup.js";
import { percentageProgress, storyPointsProgress } from "./progress.js";
import { applyInvariants } from "./projects.js";

export const scopeOfWorkDeliverablesSetOperations: ScopeOfWorkDeliverablesSetOperations =
  {
    editDeliverablesSetOperation(
      state: ScopeOfWorkState,
      action: EditDeliverablesSetAction,
    ) {
      if (action.input.milestoneId && !action.input.projectId) {
        const found = findMilestone(state, action.input.milestoneId);
        if (!found) {
          throw new Error("Roadmap with milestone not found");
        }
        const { roadmap: foundRoadmap, milestone: foundMilestone } = found;
        if (!foundMilestone.scope) {
          throw new Error("Milestone or scope not found");
        }

        const updatedScope = {
          ...foundMilestone.scope,
          status: action.input.status || foundMilestone.scope.status,
          deliverablesCompleted:
            action.input.deliverablesCompleted ||
            foundMilestone.scope.deliverablesCompleted,
        };

        foundMilestone.scope = updatedScope;
        state.roadmaps = state.roadmaps.map((roadmap) => {
          return String(roadmap.id) === String(foundRoadmap.id)
            ? foundRoadmap
            : roadmap;
        });
        applyInvariants(state);
      } else if (action.input.projectId && !action.input.milestoneId) {
        // update project set
        const project = state.projects.find(
          (p) => p.id === action.input.projectId,
        );
        if (!project) {
          throw new Error(
            `Project with id ${action.input.projectId} not found`,
          );
        }
        const updatedProject = {
          ...project,
          scope: {
            deliverables: project.scope?.deliverables || [],
            status:
              action.input.status ||
              project.scope?.status ||
              ("DRAFT" as const),
            progress: project.scope?.progress || percentageProgress(0),
            deliverablesCompleted: action.input.deliverablesCompleted ||
              project.scope?.deliverablesCompleted || {
                total: 0,
                completed: 0,
              },
          },
        };

        state.projects = state.projects.map((project) => {
          return String(project.id) === String(action.input.projectId)
            ? updatedProject
            : project;
        });
        applyInvariants(state);
      }
    },
    addDeliverableInSetOperation(state, action) {
      // check if action.input either milestoneId or projectId is provided
      if (!action.input.milestoneId && !action.input.projectId) {
        throw new Error("Either milestoneId or projectId must be provided");
      }
      if (
        !state.deliverables.some(
          (d) => String(d.id) === String(action.input.deliverableId),
        )
      ) {
        throw new SetDeliverableNotFoundError(
          `Deliverable ${action.input.deliverableId} not found`,
        );
      }

      // if milestoneId is provided, check if roadmap exists
      if (action.input.milestoneId && !action.input.projectId) {
        const found = findMilestone(state, action.input.milestoneId);
        if (!found) {
          throw new Error(
            `Roadmap with milestone ${action.input.milestoneId} not found`,
          );
        }
        const { roadmap: foundRoadmap, milestone: foundMilestone } = found;

        if (!foundMilestone.scope) {
          foundMilestone.scope = {
            deliverables: [],
            status: "DRAFT" as const,
            progress: storyPointsProgress(0, 0),
            deliverablesCompleted: {
              total: 0,
              completed: 0,
            },
          };
        }

        if (
          !foundMilestone.scope.deliverables.includes(
            action.input.deliverableId,
          )
        ) {
          foundMilestone.scope.deliverables.push(action.input.deliverableId);
        }

        state.roadmaps = state.roadmaps.map((roadmap) => {
          return String(roadmap.id) === String(foundRoadmap.id)
            ? foundRoadmap
            : roadmap;
        });
        applyInvariants(state);
      } else if (action.input.projectId && !action.input.milestoneId) {
        // check if project exists
        const foundProject = state.projects.find(
          (project) => String(project.id) === String(action.input.projectId),
        );
        if (!foundProject) {
          throw new Error(
            `Project with id ${action.input.projectId} not found`,
          );
        }

        if (!foundProject.scope) {
          foundProject.scope = {
            deliverables: [],
            status: "DRAFT" as const,
            progress: storyPointsProgress(0, 0),
            deliverablesCompleted: {
              total: 0,
              completed: 0,
            },
          };
        }

        if (
          !foundProject.scope.deliverables.includes(action.input.deliverableId)
        ) {
          foundProject.scope.deliverables.push(action.input.deliverableId);
        }

        state.projects = state.projects.map((project) => {
          return String(project.id) === String(action.input.projectId)
            ? foundProject
            : project;
        });

        state.deliverables = state.deliverables.map((deliverable) => {
          return String(deliverable.id) === String(action.input.deliverableId)
            ? {
                ...deliverable,
                budgetAnchor: {
                  project: foundProject.id,
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
      }
    },
    removeDeliverableInSetOperation(state, action) {
      if (action.input.milestoneId) {
        const found = findMilestone(state, action.input.milestoneId);
        if (!found) {
          throw new Error("Roadmap with milestone not found");
        }
        const { roadmap: foundRoadmap, milestone: foundMilestone } = found;

        if (!foundMilestone.scope) {
          throw new Error("Milestone scope not found");
        }

        foundMilestone.scope.deliverables =
          foundMilestone.scope.deliverables.filter(
            (deliverableId) =>
              String(deliverableId) !== String(action.input.deliverableId),
          );

        state.roadmaps = state.roadmaps.map((roadmap) => {
          return String(roadmap.id) === String(foundRoadmap.id)
            ? foundRoadmap
            : roadmap;
        });
        applyInvariants(state);
      } else if (action.input.projectId) {
        const foundProject = state.projects.find(
          (project) => String(project.id) === String(action.input.projectId),
        );
        if (!foundProject) {
          throw new Error(
            `Project with id ${action.input.projectId} not found`,
          );
        }

        if (!foundProject.scope) {
          throw new Error(
            `Project scope not found for project ${action.input.projectId}`,
          );
        }

        foundProject.scope.deliverables =
          foundProject.scope.deliverables.filter(
            (deliverableId) =>
              String(deliverableId) !== String(action.input.deliverableId),
          );

        state.projects = state.projects.map((project) => {
          return String(project.id) === String(action.input.projectId)
            ? foundProject
            : project;
        });

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
      }
    },
  };
