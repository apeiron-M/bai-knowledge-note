import {
  addDeliverable, addKnowledgeRef, addMember, createProject, reducer,
  removeDeliverable, removeKnowledgeRef, removeMember,
  setDeliverableStatus, updateDeliverable, updateMember, utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

const init = () => reducer(utils.createDocument(), createProject({
  name: "P", createdAt: "2026-08-16T12:00:00.000Z",
}));

describe("project errors (state unchanged, error recorded)", () => {
  it("ALREADY_INITIALIZED on second createProject", () => {
    const doc = reducer(init(), createProject({ name: "Q", createdAt: "2026-08-16T13:00:00.000Z" }));
    expect(doc.operations.global[1].error).toMatch(/already initialized/i);
    expect(doc.state.global.name).toBe("P");
  });
  it("DUPLICATE_MEMBER", () => {
    let doc = reducer(init(), addMember({ id: "m1", name: "a" }));
    doc = reducer(doc, addMember({ id: "m1", name: "b" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.team).toHaveLength(1);
  });
  it("MEMBER_NOT_FOUND on update and remove", () => {
    let doc = reducer(init(), updateMember({ id: "nope", name: "x" }));
    expect(doc.operations.global[1].error).toBeTruthy();
    expect(doc.state.global.team).toEqual([]);
    doc = reducer(doc, removeMember({ id: "nope" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.team).toEqual([]);
  });
  it("DUPLICATE_DELIVERABLE", () => {
    let doc = reducer(init(), addDeliverable({ id: "d1", title: "t" }));
    doc = reducer(doc, addDeliverable({ id: "d1", title: "t2" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.deliverables).toHaveLength(1);
  });
  it("DELIVERABLE_NOT_FOUND on update, setStatus, remove", () => {
    let doc = reducer(init(), updateDeliverable({ id: "nope", title: "x" }));
    expect(doc.operations.global[1].error).toBeTruthy();
    expect(doc.state.global.deliverables).toEqual([]);
    doc = reducer(doc, setDeliverableStatus({ id: "nope", status: "DELIVERED" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.deliverables).toEqual([]);
    doc = reducer(doc, removeDeliverable({ id: "nope" }));
    expect(doc.operations.global[3].error).toBeTruthy();
    expect(doc.state.global.deliverables).toEqual([]);
  });
  it("DUPLICATE_KNOWLEDGE_REF and KNOWLEDGE_REF_NOT_FOUND", () => {
    let doc = reducer(init(), addKnowledgeRef({ ref: "n1" }));
    doc = reducer(doc, addKnowledgeRef({ ref: "n1" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.knowledgeRefs).toEqual(["n1"]);
    doc = reducer(doc, removeKnowledgeRef({ ref: "n2" }));
    expect(doc.operations.global[3].error).toBeTruthy();
    expect(doc.state.global.knowledgeRefs).toEqual(["n1"]);
  });
});
