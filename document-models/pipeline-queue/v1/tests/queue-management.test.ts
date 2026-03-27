import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isPipelineQueueDocument,
  addTask,
  assignTask,
  advancePhase,
  completeTask,
  failTask,
  blockTask,
  unblockTask,
  AddTaskInputSchema,
  AssignTaskInputSchema,
  AdvancePhaseInputSchema,
  CompleteTaskInputSchema,
  FailTaskInputSchema,
  BlockTaskInputSchema,
  UnblockTaskInputSchema,
} from "@powerhousedao/knowledge-note/document-models/pipeline-queue/v1";

describe("QueueManagementOperations", () => {
  it("should handle addTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTaskInputSchema());

    const updatedDocument = reducer(document, addTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle assignTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AssignTaskInputSchema());

    const updatedDocument = reducer(document, assignTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ASSIGN_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle advancePhase operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AdvancePhaseInputSchema());

    const updatedDocument = reducer(document, advancePhase(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADVANCE_PHASE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle completeTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CompleteTaskInputSchema());

    const updatedDocument = reducer(document, completeTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "COMPLETE_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle failTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(FailTaskInputSchema());

    const updatedDocument = reducer(document, failTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("FAIL_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle blockTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(BlockTaskInputSchema());

    const updatedDocument = reducer(document, blockTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("BLOCK_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle unblockTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UnblockTaskInputSchema());

    const updatedDocument = reducer(document, unblockTask(input));

    expect(isPipelineQueueDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UNBLOCK_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
