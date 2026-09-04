import type {
  Milestone,
  Roadmap,
  ScopeOfWorkState,
} from "../../gen/schema/types.js";

/**
 * Locate a milestone by id across every roadmap, returning it together with
 * the roadmap that owns it. A single lookup means a single "not found" path:
 * once the roadmap is known to contain the milestone, the milestone exists.
 */
export function findMilestone(
  state: ScopeOfWorkState,
  milestoneId: string,
): { roadmap: Roadmap; milestone: Milestone } | undefined {
  for (const roadmap of state.roadmaps) {
    const milestone = roadmap.milestones.find(
      (candidate) => String(candidate.id) === String(milestoneId),
    );
    if (milestone) {
      return { roadmap, milestone };
    }
  }
  return undefined;
}

/** Remove a deliverable id from every project and milestone scope that lists it. */
export function unlinkDeliverable(
  state: ScopeOfWorkState,
  deliverableId: string,
): void {
  const keep = (id: string) => String(id) !== String(deliverableId);
  for (const project of state.projects) {
    if (project.scope) {
      project.scope.deliverables = project.scope.deliverables.filter(keep);
    }
  }
  for (const roadmap of state.roadmaps) {
    for (const milestone of roadmap.milestones) {
      if (milestone.scope) {
        milestone.scope.deliverables =
          milestone.scope.deliverables.filter(keep);
      }
    }
  }
}

/**
 * Delete deliverables from the document, unlinking each from every scope first
 * so no container is left pointing at a deliverable that no longer exists.
 */
export function deleteDeliverables(
  state: ScopeOfWorkState,
  deliverableIds: readonly string[],
): void {
  for (const id of deliverableIds) {
    unlinkDeliverable(state, id);
  }
  const removed = new Set(deliverableIds.map(String));
  state.deliverables = state.deliverables.filter(
    (deliverable) => !removed.has(String(deliverable.id)),
  );
}
