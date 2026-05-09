import { generateMock } from "document-model";
import {
  addChildMoc,
  AddChildMocInputSchema,
  addCoreIdea,
  AddCoreIdeaInputSchema,
  addOpenQuestion,
  AddOpenQuestionInputSchema,
  addTension,
  AddTensionInputSchema,
  createMoc,
  CreateMocInputSchema,
  isMocDocument,
  reducer,
  removeChildMoc,
  RemoveChildMocInputSchema,
  removeCoreIdea,
  RemoveCoreIdeaInputSchema,
  removeOpenQuestion,
  RemoveOpenQuestionInputSchema,
  removeTension,
  RemoveTensionInputSchema,
  reorderCoreIdeas,
  ReorderCoreIdeasInputSchema,
  updateCoreIdea,
  UpdateCoreIdeaInputSchema,
  updateDescription,
  UpdateDescriptionInputSchema,
  updateOrientation,
  UpdateOrientationInputSchema,
  utils,
} from "document-models/moc/v1";
import { describe, expect, it } from "vitest";

describe("MocManagementOperations", () => {
  it("should handle createMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateMocInputSchema());

    const updatedDocument = reducer(document, createMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("CREATE_MOC");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOrientation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOrientationInputSchema());

    const updatedDocument = reducer(document, updateOrientation(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_ORIENTATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateDescriptionInputSchema());

    const updatedDocument = reducer(document, updateDescription(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddCoreIdeaInputSchema());

    const updatedDocument = reducer(document, addCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateCoreIdeaInputSchema());

    const updatedDocument = reducer(document, updateCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveCoreIdeaInputSchema());

    const updatedDocument = reducer(document, removeCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderCoreIdeas operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderCoreIdeasInputSchema());

    const updatedDocument = reducer(document, reorderCoreIdeas(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_CORE_IDEAS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTensionInputSchema());

    const updatedDocument = reducer(document, addTension(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTensionInputSchema());

    const updatedDocument = reducer(document, removeTension(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addOpenQuestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddOpenQuestionInputSchema());

    const updatedDocument = reducer(document, addOpenQuestion(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_OPEN_QUESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeOpenQuestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveOpenQuestionInputSchema());

    const updatedDocument = reducer(document, removeOpenQuestion(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_OPEN_QUESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addChildMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddChildMocInputSchema());

    const updatedDocument = reducer(document, addChildMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_CHILD_MOC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeChildMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveChildMocInputSchema());

    const updatedDocument = reducer(document, removeChildMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_CHILD_MOC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
