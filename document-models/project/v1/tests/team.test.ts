import { generateMock } from "document-model";
import {
  addMember,
  AddMemberInputSchema,
  isProjectDocument,
  reducer,
  removeMember,
  RemoveMemberInputSchema,
  updateMember,
  UpdateMemberInputSchema,
  utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("TeamOperations", () => {
  it("should handle addMember operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddMemberInputSchema());

    const updatedDocument = reducer(document, addMember(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_MEMBER");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateMember operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateMemberInputSchema());

    const updatedDocument = reducer(document, updateMember(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_MEMBER",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeMember operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveMemberInputSchema());

    const updatedDocument = reducer(document, removeMember(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_MEMBER",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
