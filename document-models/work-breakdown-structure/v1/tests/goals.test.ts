import { generateMock } from "document-model";
import {
  createGoal,
  CreateGoalInputSchema,
  deleteGoal,
  DeleteGoalInputSchema,
  isWorkBreakdownStructureDocument,
  reducer,
  reorder,
  ReorderInputSchema,
  updateGoalDescription,
  UpdateGoalDescriptionInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("GoalsOperations", () => {
  it("should handle createGoal operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateGoalInputSchema());

    const updatedDocument = reducer(document, createGoal(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_GOAL",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateGoalDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateGoalDescriptionInputSchema());

    const updatedDocument = reducer(document, updateGoalDescription(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_GOAL_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle deleteGoal operation", () => {
    const document = utils.createDocument();
    const input = generateMock(DeleteGoalInputSchema());

    const updatedDocument = reducer(document, deleteGoal(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "DELETE_GOAL",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorder operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderInputSchema());

    const updatedDocument = reducer(document, reorder(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REORDER");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
