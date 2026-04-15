import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isKnowledgeNoteDocument,
  submitForReview,
  approveNote,
  rejectNote,
  archiveNote,
  restoreNote,
  SubmitForReviewInputSchema,
  ApproveNoteInputSchema,
  RejectNoteInputSchema,
  ArchiveNoteInputSchema,
  RestoreNoteInputSchema,
} from "document-models/knowledge-note/v1";

describe("LifecycleOperations", () => {
  it("should handle submitForReview operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SubmitForReviewInputSchema());

    const updatedDocument = reducer(document, submitForReview(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SUBMIT_FOR_REVIEW",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle approveNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ApproveNoteInputSchema());

    const updatedDocument = reducer(document, approveNote(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "APPROVE_NOTE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle rejectNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RejectNoteInputSchema());

    const updatedDocument = reducer(document, rejectNote(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REJECT_NOTE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle archiveNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ArchiveNoteInputSchema());

    const updatedDocument = reducer(document, archiveNote(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ARCHIVE_NOTE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle restoreNote operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RestoreNoteInputSchema());

    const updatedDocument = reducer(document, restoreNote(input));

    expect(isKnowledgeNoteDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "RESTORE_NOTE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
