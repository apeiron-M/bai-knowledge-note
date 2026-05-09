import { generateMock } from "document-model";
import {
  isKnowledgeNoteDocument,
  reducer,
  setProvenance,
  SetProvenanceInputSchema,
  utils,
} from "document-models/knowledge-note/v1";
import { describe, expect, it } from "vitest";

describe("ProvenanceOperations", () => {
  it("should handle setProvenance operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProvenanceInputSchema());

    const updatedDocument = reducer(document, setProvenance(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROVENANCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
