import { generateMock } from "document-model/mock";
import {
  addProject,
  addProjectDeliverable,
  AddProjectDeliverableInputSchema,
  AddProjectInputSchema,
  addProjectKnowledgeRef,
  AddProjectKnowledgeRefInputSchema,
  isScopeOfWorkDocument,
  linkProjectWbs,
  LinkProjectWbsInputSchema,
  reducer,
  removeProject,
  removeProjectDeliverable,
  RemoveProjectDeliverableInputSchema,
  RemoveProjectInputSchema,
  removeProjectKnowledgeRef,
  RemoveProjectKnowledgeRefInputSchema,
  setProjectExpenditure,
  SetProjectExpenditureInputSchema,
  setProjectMargin,
  SetProjectMarginInputSchema,
  setProjectReferences,
  SetProjectReferencesInputSchema,
  setProjectTotalBudget,
  SetProjectTotalBudgetInputSchema,
  updateProject,
  UpdateProjectInputSchema,
  updateProjectOwner,
  UpdateProjectOwnerInputSchema,
  utils,
} from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";

describe("ProjectsOperations", () => {
  it("should handle addProject operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddProjectInputSchema(), {
      imageUrl: "https://example.com",
    });

    const updatedDocument = reducer(document, addProject(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_PROJECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateProject operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateProjectInputSchema(), {
      imageUrl: "https://example.com",
    });

    const updatedDocument = reducer(document, updateProject(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PROJECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateProjectOwner operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateProjectOwnerInputSchema());

    const updatedDocument = reducer(document, updateProjectOwner(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PROJECT_OWNER",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeProject operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveProjectInputSchema());

    const updatedDocument = reducer(document, removeProject(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_PROJECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectMargin operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectMarginInputSchema());

    const updatedDocument = reducer(document, setProjectMargin(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_MARGIN",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectTotalBudget operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectTotalBudgetInputSchema());

    const updatedDocument = reducer(document, setProjectTotalBudget(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_TOTAL_BUDGET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addProjectDeliverable operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddProjectDeliverableInputSchema());

    const updatedDocument = reducer(document, addProjectDeliverable(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_PROJECT_DELIVERABLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeProjectDeliverable operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveProjectDeliverableInputSchema());

    const updatedDocument = reducer(document, removeProjectDeliverable(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_PROJECT_DELIVERABLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectExpenditure operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectExpenditureInputSchema());

    const updatedDocument = reducer(document, setProjectExpenditure(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_EXPENDITURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle linkProjectWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(LinkProjectWbsInputSchema());

    const updatedDocument = reducer(document, linkProjectWbs(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "LINK_PROJECT_WBS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addProjectKnowledgeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddProjectKnowledgeRefInputSchema());

    const updatedDocument = reducer(document, addProjectKnowledgeRef(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_PROJECT_KNOWLEDGE_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeProjectKnowledgeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveProjectKnowledgeRefInputSchema());

    const updatedDocument = reducer(document, removeProjectKnowledgeRef(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_PROJECT_KNOWLEDGE_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectReferences operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectReferencesInputSchema(), {
      references: ["https://example.com"],
    });

    const updatedDocument = reducer(document, setProjectReferences(input));

    expect(isScopeOfWorkDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_REFERENCES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
