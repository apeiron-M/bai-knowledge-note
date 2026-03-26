import { generateMock } from "@powerhousedao/codegen";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeNoteDocument,
  setTitle,
  setDescription,
  setNoteType,
  setContent,
  patchContent,
  setMetadataField,
  setMetadataListField,
  SetTitleInputSchema,
  SetDescriptionInputSchema,
  SetNoteTypeInputSchema,
  SetContentInputSchema,
  PatchContentInputSchema,
  SetMetadataFieldInputSchema,
  SetMetadataListFieldInputSchema,
} from "knowledge-note/document-models/knowledge-note";

describe("ContentOperations", () => {
  it("should handle setTitle operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTitleInputSchema());

    const updatedDocument = reducer(document, setTitle(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_TITLE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetDescriptionInputSchema());

    const updatedDocument = reducer(document, setDescription(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setNoteType operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetNoteTypeInputSchema());

    const updatedDocument = reducer(document, setNoteType(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_NOTE_TYPE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setContent operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetContentInputSchema());

    const updatedDocument = reducer(document, setContent(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_CONTENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle patchContent operation", () => {
    const document = utils.createDocument();
    const input = generateMock(PatchContentInputSchema());

    const updatedDocument = reducer(document, patchContent(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "PATCH_CONTENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMetadataField operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMetadataFieldInputSchema());

    const updatedDocument = reducer(document, setMetadataField(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_METADATA_FIELD",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMetadataListField operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMetadataListFieldInputSchema());

    const updatedDocument = reducer(document, setMetadataListField(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_METADATA_LIST_FIELD",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
