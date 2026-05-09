import { generateMock } from "document-model";
import {
  isKnowledgeGraphDocument,
  reducer,
  syncGraph,
  SyncGraphInputSchema,
  utils,
} from "document-models/knowledge-graph/v1";
import { describe, expect, it } from "vitest";

describe("SyncOperations", () => {
  it("should handle syncGraph operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SyncGraphInputSchema());

    const updatedDocument = reducer(document, syncGraph(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SYNC_GRAPH");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
