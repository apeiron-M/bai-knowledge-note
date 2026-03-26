import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeGraphDocument,
  addNode,
  removeNode,
  updateNode,
  AddNodeInputSchema,
  RemoveNodeInputSchema,
  UpdateNodeInputSchema,
} from "knowledge-note/document-models/knowledge-graph/v1";

describe("NodesOperations", () => {
  it("should handle addNode operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddNodeInputSchema());

    const updatedDocument = reducer(document, addNode(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_NODE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeNode operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveNodeInputSchema());

    const updatedDocument = reducer(document, removeNode(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_NODE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateNode operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateNodeInputSchema());

    const updatedDocument = reducer(document, updateNode(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_NODE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
