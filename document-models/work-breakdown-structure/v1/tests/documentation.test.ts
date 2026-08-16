import { generateMock } from "document-model";
import {
  addNote,
  AddNoteInputSchema,
  isWorkBreakdownStructureDocument,
  reducer,
  removeNote,
  RemoveNoteInputSchema,
  setOwner,
  SetOwnerInputSchema,
  setProjectRef,
  SetProjectRefInputSchema,
  setReferences,
  SetReferencesInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("DocumentationOperations", () => {
  it("should handle addNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddNoteInputSchema(), {
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, addNote(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_NOTE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveNoteInputSchema());

    const updatedDocument = reducer(document, removeNote(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_NOTE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setOwner operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetOwnerInputSchema());

    const updatedDocument = reducer(document, setOwner(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_OWNER");
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

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_REFERENCES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectRefInputSchema());

    const updatedDocument = reducer(document, setProjectRef(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
