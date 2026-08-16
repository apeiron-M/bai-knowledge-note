import { generateMock } from "document-model";
import {
  addDependencies,
  AddDependenciesInputSchema,
  assignGoal,
  AssignGoalInputSchema,
  isWorkBreakdownStructureDocument,
  reducer,
  removeDependencies,
  RemoveDependenciesInputSchema,
  setGoalStatus,
  SetGoalStatusInputSchema,
  setOutcome,
  SetOutcomeInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("WorkflowOperations", () => {
  it("should handle setGoalStatus operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetGoalStatusInputSchema());

    const updatedDocument = reducer(document, setGoalStatus(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_GOAL_STATUS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle assignGoal operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AssignGoalInputSchema());

    const updatedDocument = reducer(document, assignGoal(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ASSIGN_GOAL",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setOutcome operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetOutcomeInputSchema());

    const updatedDocument = reducer(document, setOutcome(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_OUTCOME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addDependencies operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddDependenciesInputSchema());

    const updatedDocument = reducer(document, addDependencies(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_DEPENDENCIES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeDependencies operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveDependenciesInputSchema());

    const updatedDocument = reducer(document, removeDependencies(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_DEPENDENCIES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
