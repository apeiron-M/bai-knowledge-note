import { generateMock } from "document-model";
import {
  isKnowledgeNoteDocument,
  reducer,
  setLastViewed,
  SetLastViewedInputSchema,
  utils,
} from "document-models/knowledge-note/v1";
import { describe, expect, it } from "vitest";

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
