import {
  addDeliverable, addKnowledgeRef, addMember, createProject, linkWbs,
  reducer, removeDeliverable, removeKnowledgeRef, removeMember, setDeliverableStatus,
  setOwner, setProjectStatus, setReferences, setTargetDate,
  updateDeliverable, updateMember, updateProjectInfo, utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("project lifecycle scenario", () => {
  it("runs a full project flow", () => {
    let doc = utils.createDocument();
    expect(doc.state.global.status).toBe("PLANNING");

    doc = reducer(doc, createProject({
      name: "Vault Projects Tab", description: "Add PM to the vault",
      owner: "liberuum", createdAt: "2026-08-16T12:00:00.000Z",
      status: "PLANNING",
    }));
    expect(doc.state.global.name).toBe("Vault Projects Tab");
    expect(doc.state.global.createdAt).toBe("2026-08-16T12:00:00.000Z");
    expect(doc.state.global.status).toBe("PLANNING");

    doc = reducer(doc, updateProjectInfo({ description: "Projects + WBS in the vault" }));
    expect(doc.state.global.description).toBe("Projects + WBS in the vault");
    expect(doc.state.global.name).toBe("Vault Projects Tab"); // untouched

    doc = reducer(doc, setProjectStatus({ status: "ACTIVE" }));
    doc = reducer(doc, setOwner({ owner: "knowledge-agent" }));
    doc = reducer(doc, setTargetDate({ targetDate: "2026-09-30T00:00:00.000Z" }));
    doc = reducer(doc, linkWbs({ wbsRef: "wbs-doc-1" }));
    expect(doc.state.global.status).toBe("ACTIVE");
    expect(doc.state.global.wbsRef).toBe("wbs-doc-1");

    doc = reducer(doc, addMember({ id: "m1", name: "liberuum", role: "lead", kind: "HUMAN" }));
    doc = reducer(doc, addMember({ id: "m2", name: "knowledge-agent", kind: "AGENT" }));
    doc = reducer(doc, addMember({ id: "m3", name: "assistant" }));
    doc = reducer(doc, updateMember({ id: "m2", role: "builder" }));
    doc = reducer(doc, updateMember({ id: "m3", name: "ai-assistant", kind: "AGENT" }));
    doc = reducer(doc, removeMember({ id: "m1" }));
    expect(doc.state.global.team).toHaveLength(2);
    expect(doc.state.global.team[0]).toMatchObject({ id: "m2", role: "builder", kind: "AGENT" });
    expect(doc.state.global.team[1]).toMatchObject({ id: "m3", name: "ai-assistant", kind: "AGENT" });

    doc = reducer(doc, addDeliverable({ id: "d1", title: "Projects tab", goalRef: "g1", description: "Initial desc" }));
    doc = reducer(doc, addDeliverable({ id: "d2", title: "WBS integration" }));
    doc = reducer(doc, updateDeliverable({ id: "d1", url: "https://github.com/x/pr/1" }));
    doc = reducer(doc, updateDeliverable({ id: "d1", description: "Updated desc", title: "New title" }));
    doc = reducer(doc, updateDeliverable({ id: "d1", goalRef: "g2" }));
    doc = reducer(doc, setDeliverableStatus({ id: "d1", status: "IN_PROGRESS" }));
    expect(doc.state.global.deliverables[0].deliveredAt).toBeNull();
    doc = reducer(doc, setDeliverableStatus({ id: "d1", status: "DELIVERED", deliveredAt: "2026-08-20T10:00:00.000Z" }));
    expect(doc.state.global.deliverables[0]).toMatchObject({
      status: "DELIVERED", deliveredAt: "2026-08-20T10:00:00.000Z", goalRef: "g2",
    });
    doc = reducer(doc, setDeliverableStatus({ id: "d1", status: "DELIVERED" }));
    expect(doc.state.global.deliverables[0].deliveredAt).toBe("2026-08-20T10:00:00.000Z");
    doc = reducer(doc, removeDeliverable({ id: "d2" }));
    expect(doc.state.global.deliverables).toHaveLength(1);

    doc = reducer(doc, addKnowledgeRef({ ref: "note-123" }));
    doc = reducer(doc, removeKnowledgeRef({ ref: "note-123" }));
    expect(doc.state.global.knowledgeRefs).toEqual([]);
    doc = reducer(doc, setReferences({ references: ["https://github.com/x"] }));
    expect(doc.state.global.references).toEqual(["https://github.com/x"]);

    // clears via null
    doc = reducer(doc, setTargetDate({ targetDate: null }));
    doc = reducer(doc, linkWbs({ wbsRef: null }));
    expect(doc.state.global.targetDate).toBeNull();
    expect(doc.state.global.wbsRef).toBeNull();
  });
});
