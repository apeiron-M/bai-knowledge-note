import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeGraphDocument,
  syncGraph,
  SyncGraphInputSchema,
} from "@powerhousedao/knowledge-note/document-models/knowledge-graph/v1";

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
