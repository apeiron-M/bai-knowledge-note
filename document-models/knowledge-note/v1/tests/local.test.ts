import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeNoteDocument,
  setLastViewed,
  SetLastViewedInputSchema,
} from "document-models/knowledge-note/v1";

describe("LocalOperations", () => {
  it("should handle setLastViewed operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetLastViewedInputSchema());

    const updatedDocument = reducer(document, setLastViewed(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.local).toHaveLength(1);
    expect(updatedDocument.operations.local[0].action.type).toBe(
      "SET_LAST_VIEWED",
    );
    expect(updatedDocument.operations.local[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.local[0].index).toEqual(0);
  });
});
