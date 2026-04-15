import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isObservationDocument,
  createObservation,
  promoteObservation,
  implementObservation,
  archiveObservation,
  CreateObservationInputSchema,
  PromoteObservationInputSchema,
  ImplementObservationInputSchema,
  ArchiveObservationInputSchema,
} from "document-models/observation/v1";

describe("ObservationManagementOperations", () => {
  it("should handle createObservation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateObservationInputSchema());

    const updatedDocument = reducer(document, createObservation(input));

    expect(isObservationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_OBSERVATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle promoteObservation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(PromoteObservationInputSchema());

    const updatedDocument = reducer(document, promoteObservation(input));

    expect(isObservationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "PROMOTE_OBSERVATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle implementObservation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ImplementObservationInputSchema());

    const updatedDocument = reducer(document, implementObservation(input));

    expect(isObservationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "IMPLEMENT_OBSERVATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle archiveObservation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ArchiveObservationInputSchema());

    const updatedDocument = reducer(document, archiveObservation(input));

    expect(isObservationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ARCHIVE_OBSERVATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
