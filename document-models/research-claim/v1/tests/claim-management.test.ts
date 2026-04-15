import { generateMock } from "document-model";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isResearchClaimDocument,
  createClaim,
  addResearchConnection,
  removeResearchConnection,
  updateClaimContent,
  CreateClaimInputSchema,
  AddResearchConnectionInputSchema,
  RemoveResearchConnectionInputSchema,
  UpdateClaimContentInputSchema,
} from "document-models/research-claim/v1";

describe("ClaimManagementOperations", () => {
  it("should handle createClaim operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateClaimInputSchema());

    const updatedDocument = reducer(document, createClaim(input));

    expect(isResearchClaimDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_CLAIM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addResearchConnection operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddResearchConnectionInputSchema());

    const updatedDocument = reducer(document, addResearchConnection(input));

    expect(isResearchClaimDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_RESEARCH_CONNECTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeResearchConnection operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveResearchConnectionInputSchema());

    const updatedDocument = reducer(document, removeResearchConnection(input));

    expect(isResearchClaimDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_RESEARCH_CONNECTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateClaimContent operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateClaimContentInputSchema());

    const updatedDocument = reducer(document, updateClaimContent(input));

    expect(isResearchClaimDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_CLAIM_CONTENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
