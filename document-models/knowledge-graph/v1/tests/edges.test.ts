import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeGraphDocument,
  addEdge,
  removeEdge,
  updateEdge,
  AddEdgeInputSchema,
  RemoveEdgeInputSchema,
  UpdateEdgeInputSchema,
} from "document-models/knowledge-graph/v1";

describe("EdgesOperations", () => {
  it("should handle addEdge operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddEdgeInputSchema());

    const updatedDocument = reducer(document, addEdge(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_EDGE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeEdge operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveEdgeInputSchema());

    const updatedDocument = reducer(document, removeEdge(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_EDGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateEdge operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateEdgeInputSchema());

    const updatedDocument = reducer(document, updateEdge(input));

    expect(isKnowledgeGraphDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_EDGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
