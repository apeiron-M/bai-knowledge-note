/**
 * A scope of work and a work breakdown, built with the models' own reducers —
 * so a loaded document in a test is what read_document returns from a vault.
 *
 * scope-1 “Powerhouse 2026”: contributor Alice; project KV “Knowledge
 * Vault” funding deliverables “Search” and “Chat”; roadmap “2026” with
 * milestone M1 “Beta”.
 * wbs-1 “Knowledge Vault breakdown”: “Ship the vault” › “Design”, and
 * “Build” › “API”.
 */
import { expect } from "vitest";
import { actions as sow, reducer as sowReducer, utils as sowUtils } from "document-models/scope-of-work";
import { actions as wbs, reducer as wbsReducer, utils as wbsUtils } from "document-models/work-breakdown-structure";
import { SCOPE_TYPE, WBS_TYPE, type LoadedDocument } from "../work-changes.js";

export function scopeState(): Record<string, unknown> {
  let d = sowUtils.createDocument();
  for (const a of [
    sow.editScopeOfWork({ title: "Powerhouse 2026" }),
    sow.addAgent({ id: "agent-alice", name: "Alice" }),
    sow.addProject({ id: "proj-kv", code: "KV", title: "Knowledge Vault", projectOwner: "agent-alice", budgetType: "OPEX", currency: "USD" }),
    sow.addProjectDeliverable({ projectId: "proj-kv", deliverableId: "del-1", title: "Search" }),
    sow.addProjectDeliverable({ projectId: "proj-kv", deliverableId: "del-2", title: "Chat" }),
    sow.addRoadmap({ id: "road-1", title: "2026" }),
    sow.addMilestone({ roadmapId: "road-1", id: "ms-1", sequenceCode: "M1", title: "Beta" }),
  ]) {
    d = sowReducer(d, a);
  }
  expect(d.operations.global.every((op) => !op.error)).toBe(true);
  return d.state.global as unknown as Record<string, unknown>;
}

export function wbsState(): Record<string, unknown> {
  let d = wbsUtils.createDocument();
  for (const a of [
    wbs.createGoal({ id: "g-root", description: "Ship the vault" }),
    wbs.createGoal({ id: "g-a", description: "Design", parentId: "g-root" }),
    wbs.createGoal({ id: "g-b", description: "Build", parentId: "g-root" }),
    wbs.createGoal({ id: "g-b1", description: "API", parentId: "g-b" }),
  ]) {
    d = wbsReducer(d, a);
  }
  expect(d.operations.global.every((op) => !op.error)).toBe(true);
  return d.state.global as unknown as Record<string, unknown>;
}

/** The same two, linked both ways — project KV's breakdown is wbs-1 — as create_wbs leaves them. */
export function linkedWorkDocs(): Map<string, LoadedDocument> {
  const docs = loadedWorkDocs();
  let s = sowUtils.createDocument({ global: docs.get("scope-1")!.state } as never);
  s = sowReducer(s, sow.linkProjectWbs({ projectId: "proj-kv", wbsRef: "wbs-1" }));
  let w = wbsUtils.createDocument({ global: docs.get("wbs-1")!.state } as never);
  w = wbsReducer(w, wbs.setSowProjectRef({ sowRef: "scope-1", sowProjectId: "proj-kv" }));
  expect([...s.operations.global, ...w.operations.global].every((op) => !op.error)).toBe(true);
  docs.set("scope-1", { ...docs.get("scope-1")!, state: s.state.global as unknown as Record<string, unknown> });
  docs.set("wbs-1", { ...docs.get("wbs-1")!, state: w.state.global as unknown as Record<string, unknown> });
  return docs;
}

/** wbs-1 names scope-1 as its scope, but no project of scope-1 holds it — a one-way link. */
export function pointingWorkDocs(): Map<string, LoadedDocument> {
  const docs = loadedWorkDocs();
  let w = wbsUtils.createDocument({ global: docs.get("wbs-1")!.state } as never);
  w = wbsReducer(w, wbs.setSowProjectRef({ sowRef: "scope-1", sowProjectId: "proj-kv" }));
  expect(w.operations.global.every((op) => !op.error)).toBe(true);
  docs.set("wbs-1", { ...docs.get("wbs-1")!, state: w.state.global as unknown as Record<string, unknown> });
  return docs;
}

/** The documents a proposal check sees: the scope, the breakdown, and a note it may not touch. */
export function loadedWorkDocs(): Map<string, LoadedDocument> {
  return new Map<string, LoadedDocument>([
    ["scope-1", { documentId: "scope-1", documentType: SCOPE_TYPE, name: "powerhouse-2026", state: scopeState() }],
    ["wbs-1", { documentId: "wbs-1", documentType: WBS_TYPE, name: "Knowledge Vault breakdown", state: wbsState() }],
    ["note-1", { documentId: "note-1", documentType: "bai/knowledge-note", name: "a-note", state: { title: "A note" } }],
  ]);
}
