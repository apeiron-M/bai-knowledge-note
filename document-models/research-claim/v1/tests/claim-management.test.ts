import { generateMock } from "document-model";
import {
  addResearchConnection,
  AddResearchConnectionInputSchema,
  createClaim,
  CreateClaimInputSchema,
  isResearchClaimDocument,
  reducer,
  removeResearchConnection,
  RemoveResearchConnectionInputSchema,
  updateClaimContent,
  UpdateClaimContentInputSchema,
  utils,
} from "document-models/research-claim/v1";
import { describe, expect, it } from "vitest";

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

  it("should handle a full claim lifecycle: create, connect, remove, update", () => {
    const document = utils.createDocument();

    let updatedDocument = reducer(
      document,
      createClaim({
        title: "Spaced repetition improves retention",
        description: "A claim about learning",
        content: "Spaced repetition improves long-term retention.",
        kind: "insight",
        methodology: ["literature-review"],
        sources: ["source-1"],
        topics: ["learning"],
      }),
    );

    expect(updatedDocument.state.global.title).toBe(
      "Spaced repetition improves retention",
    );
    expect(updatedDocument.state.global.description).toBe(
      "A claim about learning",
    );
    expect(updatedDocument.state.global.content).toBe(
      "Spaced repetition improves long-term retention.",
    );
    expect(updatedDocument.state.global.kind).toBe("insight");
    expect(updatedDocument.state.global.methodology).toStrictEqual([
      "literature-review",
    ]);
    expect(updatedDocument.state.global.sources).toStrictEqual(["source-1"]);
    expect(updatedDocument.state.global.topics).toStrictEqual(["learning"]);

    updatedDocument = reducer(
      updatedDocument,
      addResearchConnection({
        id: "conn-1",
        targetRef: "claim-a",
        contextPhrase: "builds on",
      }),
    );
    updatedDocument = reducer(
      updatedDocument,
      addResearchConnection({
        id: "conn-2",
        targetRef: "claim-b",
        contextPhrase: "contradicts",
      }),
    );

    expect(updatedDocument.state.global.connections).toHaveLength(2);
    expect(updatedDocument.state.global.connections[0]).toStrictEqual({
      id: "conn-1",
      targetRef: "claim-a",
      contextPhrase: "builds on",
    });

    updatedDocument = reducer(
      updatedDocument,
      removeResearchConnection({ id: "conn-1" }),
    );

    expect(updatedDocument.state.global.connections).toHaveLength(1);
    expect(updatedDocument.state.global.connections[0].id).toBe("conn-2");

    // Removing an unknown id leaves the remaining connections untouched
    updatedDocument = reducer(
      updatedDocument,
      removeResearchConnection({ id: "missing-id" }),
    );

    expect(updatedDocument.state.global.connections).toHaveLength(1);
    expect(updatedDocument.state.global.connections[0].id).toBe("conn-2");

    updatedDocument = reducer(
      updatedDocument,
      updateClaimContent({ content: "Refined claim content." }),
    );

    expect(updatedDocument.state.global.content).toBe("Refined claim content.");
    expect(updatedDocument.operations.global).toHaveLength(6);
  });
});
