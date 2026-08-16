import { generateMock } from "document-model";
import {
  addKnowledgeRef,
  AddKnowledgeRefInputSchema,
  isProjectDocument,
  reducer,
  removeKnowledgeRef,
  RemoveKnowledgeRefInputSchema,
  setReferences,
  SetReferencesInputSchema,
  utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("KnowledgeOperations", () => {
  it("should handle addKnowledgeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddKnowledgeRefInputSchema());

    const updatedDocument = reducer(document, addKnowledgeRef(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_KNOWLEDGE_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeKnowledgeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveKnowledgeRefInputSchema());

    const updatedDocument = reducer(document, removeKnowledgeRef(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_KNOWLEDGE_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setReferences operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetReferencesInputSchema(), {
      references: ["https://example.com"],
    });

    const updatedDocument = reducer(document, setReferences(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_REFERENCES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
