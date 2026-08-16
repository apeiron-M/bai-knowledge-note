import { generateMock } from "document-model";
import {
  addDeliverable,
  AddDeliverableInputSchema,
  isProjectDocument,
  reducer,
  removeDeliverable,
  RemoveDeliverableInputSchema,
  setDeliverableStatus,
  SetDeliverableStatusInputSchema,
  updateDeliverable,
  UpdateDeliverableInputSchema,
  utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("DeliverablesOperations", () => {
  it("should handle addDeliverable operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddDeliverableInputSchema(), {
      url: "https://example.com",
    });

    const updatedDocument = reducer(document, addDeliverable(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_DELIVERABLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateDeliverable operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateDeliverableInputSchema(), {
      url: "https://example.com",
    });

    const updatedDocument = reducer(document, updateDeliverable(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_DELIVERABLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setDeliverableStatus operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetDeliverableStatusInputSchema(), {
      deliveredAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, setDeliverableStatus(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_DELIVERABLE_STATUS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeDeliverable operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveDeliverableInputSchema());

    const updatedDocument = reducer(document, removeDeliverable(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_DELIVERABLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
