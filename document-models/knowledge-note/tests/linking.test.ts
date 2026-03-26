import { generateMock } from "@powerhousedao/codegen";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeNoteDocument,
  addLink,
  removeLink,
  updateLinkType,
  addTopic,
  removeTopic,
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  UpdateLinkTypeInputSchema,
  AddTopicInputSchema,
  RemoveTopicInputSchema,
} from "knowledge-note/document-models/knowledge-note";

describe("LinkingOperations", () => {
  it("should handle addLink operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddLinkInputSchema());

    const updatedDocument = reducer(document, addLink(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_LINK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeLink operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveLinkInputSchema());

    const updatedDocument = reducer(document, removeLink(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_LINK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateLinkType operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateLinkTypeInputSchema());

    const updatedDocument = reducer(document, updateLinkType(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_LINK_TYPE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTopic operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTopicInputSchema());

    const updatedDocument = reducer(document, addTopic(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_TOPIC");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTopic operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTopicInputSchema());

    const updatedDocument = reducer(document, removeTopic(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TOPIC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
