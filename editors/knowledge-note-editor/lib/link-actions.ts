/**
 * The reactor system actions behind the note editor's links. A relationship
 * is (source, target, type): ADD_RELATIONSHIP carries the articulation as its
 * `metadata`, and a new target is REMOVE + ADD in one dispatch — as a type
 * change is — so the edge never exists without its reason.
 *
 * The guard lives here: nothing is sent without a target, or with the note
 * itself as the target (spec §6).
 */
import type { LinkType } from "document-models/knowledge-note";
import {
  articulationToMetadata,
  type EdgeConfidence,
  type LinkArticulation,
} from "../../shared/edge-articulation.js";

export type RelationshipAction = {
  id: string;
  type: "ADD_RELATIONSHIP" | "REMOVE_RELATIONSHIP";
  scope: "document";
  timestampUtcMs: string;
  input: {
    sourceId: string;
    targetId: string;
    relationshipType: string;
    metadata?: { reason?: string; confidence?: EdgeConfidence };
  };
};

/** When the actions are stamped, and how their ids are made. */
export type LinkClock = { now: string; newId: () => string };

/** One ADD_RELATIONSHIP — or nothing, without a target or to the note itself. */
export function addLinkActions(
  noteId: string,
  targetId: string,
  linkType: LinkType,
  articulation: LinkArticulation,
  clock: LinkClock,
): RelationshipAction[] {
  const target = targetId.trim();
  if (!target || target === noteId) return [];
  const metadata = articulationToMetadata(articulation);
  return [
    {
      id: clock.newId(),
      type: "ADD_RELATIONSHIP",
      scope: "document",
      timestampUtcMs: clock.now,
      input: { sourceId: noteId, targetId: target, relationshipType: linkType, ...(metadata ? { metadata } : {}) },
    },
  ];
}

/** REMOVE the old pair and ADD the new one with the reason — or nothing, when there is nothing valid to change. */
export function retargetLinkActions(
  noteId: string,
  link: { targetDocumentId: string | null; linkType: string | null },
  newTargetId: string,
  articulation: LinkArticulation,
  clock: LinkClock,
): RelationshipAction[] {
  const old = link.targetDocumentId;
  const target = newTargetId.trim();
  if (!old || !target || target === noteId || target === old) return [];
  const linkType = (link.linkType ?? "RELATES_TO") as LinkType;
  const remove: RelationshipAction = {
    id: clock.newId(),
    type: "REMOVE_RELATIONSHIP",
    scope: "document",
    timestampUtcMs: clock.now,
    input: { sourceId: noteId, targetId: old, relationshipType: linkType },
  };
  return [remove, ...addLinkActions(noteId, target, linkType, articulation, clock)];
}
