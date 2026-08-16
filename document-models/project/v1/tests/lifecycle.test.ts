import { generateMock } from "document-model";
import {
  createProject,
  CreateProjectInputSchema,
  isProjectDocument,
  linkWbs,
  LinkWbsInputSchema,
  reducer,
  setOwner,
  SetOwnerInputSchema,
  setProjectStatus,
  SetProjectStatusInputSchema,
  setTargetDate,
  SetTargetDateInputSchema,
  updateProjectInfo,
  UpdateProjectInfoInputSchema,
  utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("LifecycleOperations", () => {
  it("should handle createProject operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateProjectInputSchema(), {
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, createProject(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_PROJECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateProjectInfo operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateProjectInfoInputSchema());

    const updatedDocument = reducer(document, updateProjectInfo(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PROJECT_INFO",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setProjectStatus operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProjectStatusInputSchema());

    const updatedDocument = reducer(document, setProjectStatus(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PROJECT_STATUS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setOwner operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetOwnerInputSchema());

    const updatedDocument = reducer(document, setOwner(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_OWNER");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTargetDate operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTargetDateInputSchema(), {
      targetDate: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, setTargetDate(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TARGET_DATE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle linkWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(LinkWbsInputSchema());

    const updatedDocument = reducer(document, linkWbs(input));

    expect(isProjectDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("LINK_WBS");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
