import type { ScopeOfWorkRoadmapsOperations } from "document-models/scope-of-work/v1";
import { RoadmapAlreadyExistsError } from "../../gen/roadmaps/error.js";
import { deleteDeliverables } from "./lookup.js";
import { applyInvariants } from "./projects.js";
import { isSet } from "./util.js";

export const scopeOfWorkRoadmapsOperations: ScopeOfWorkRoadmapsOperations = {
  editRoadmapOperation(state, action) {
    const roadmap = state.roadmaps.find(
      (roadmap) => String(roadmap.id) === String(action.input.id),
    );
    if (!roadmap) {
      throw new Error("Roadmap not found");
    }

    const updatedRoadmap = {
      ...roadmap,
      title: isSet(action.input.title) ? action.input.title : roadmap.title,
      slug: isSet(action.input.slug) ? action.input.slug : roadmap.slug,
      description: isSet(action.input.description)
        ? action.input.description
        : roadmap.description,
    };

    state.roadmaps = state.roadmaps.map((roadmap) =>
      String(roadmap.id) === String(action.input.id) ? updatedRoadmap : roadmap,
    );
  },
  addRoadmapOperation(state, action) {
    if (state.roadmaps.some((r) => String(r.id) === String(action.input.id))) {
      throw new RoadmapAlreadyExistsError(
        `Roadmap with ID ${action.input.id} already exists`,
      );
    }

    const roadmap = {
      id: action.input.id,
      title: action.input.title,
      slug: action.input.slug || "",
      description: action.input.description || "",
      milestones: [],
    };

    state.roadmaps.push(roadmap);
  },
  removeRoadmapOperation(state, action) {
    const roadmap = state.roadmaps.find(
      (roadmap) => String(roadmap.id) === String(action.input.id),
    );
    if (!roadmap) {
      throw new Error("Roadmap not found");
    }

    // the milestones' deliverables go with the roadmap, wherever else they were listed
    deleteDeliverables(
      state,
      roadmap.milestones.flatMap(
        (milestone) => milestone.scope?.deliverables ?? [],
      ),
    );

    state.roadmaps = state.roadmaps.filter(
      (roadmap) => String(roadmap.id) !== String(action.input.id),
    );
    applyInvariants(state);
  },
};
