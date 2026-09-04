import type { ScopeOfWorkContributorsOperations } from "document-models/scope-of-work/v1";
import { type AddAgentAction } from "../../gen/contributors/actions.js";
import {
  AgentAlreadyExistsError,
  AgentNotFoundError,
} from "../../gen/contributors/error.js";
import type { Agent, ScopeOfWorkState } from "../../gen/schema/types.js";

export const scopeOfWorkContributorsOperations: ScopeOfWorkContributorsOperations =
  {
    addAgentOperation(state: ScopeOfWorkState, action: AddAgentAction) {
      const existingAgent = state.contributors.find(
        (agent) => agent.id === action.input.id,
      );
      if (existingAgent) {
        throw new AgentAlreadyExistsError(
          `Agent with ID ${action.input.id} already exists`,
        );
      }

      const agent = {
        id: action.input.id,
        name: action.input.name,
        icon: action.input.icon || null,
        description: action.input.description || null,
      };

      state.contributors.push(agent);
    },
    removeAgentOperation(state, action) {
      const agentIndex = state.contributors.findIndex(
        (agent) => agent.id === action.input.id,
      );
      if (agentIndex === -1) {
        throw new AgentNotFoundError(
          `Agent with ID ${action.input.id} not found`,
        );
      }

      state.contributors.splice(agentIndex, 1);

      // an agent that no longer exists cannot own or coordinate anything
      for (const deliverable of state.deliverables) {
        if (deliverable.owner === action.input.id) {
          deliverable.owner = null;
        }
      }
      for (const project of state.projects) {
        if (project.projectOwner === action.input.id) {
          project.projectOwner = null;
        }
      }
      for (const roadmap of state.roadmaps) {
        for (const milestone of roadmap.milestones) {
          milestone.coordinators = milestone.coordinators.filter(
            (coordinatorId) => coordinatorId !== action.input.id,
          );
        }
      }
    },
    editAgentOperation(state, action) {
      const agentIndex = state.contributors.findIndex(
        (agent) => agent.id === action.input.id,
      );
      if (agentIndex === -1) {
        throw new AgentNotFoundError(
          `Agent with ID ${action.input.id} not found`,
        );
      }

      const existingAgent = state.contributors[agentIndex];
      const updatedAgent = {
        ...existingAgent,
        name:
          action.input.name !== undefined
            ? action.input.name
            : existingAgent.name,
        icon:
          action.input.icon !== undefined
            ? action.input.icon
            : existingAgent.icon,
        description:
          action.input.description !== undefined
            ? action.input.description
            : existingAgent.description,
      };

      state.contributors[agentIndex] = updatedAgent as Agent;
    },
  };
