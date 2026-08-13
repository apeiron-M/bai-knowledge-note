import { generateMock } from "document-model";
import {
  addInvolvedRef,
  AddInvolvedRefInputSchema,
  createTension,
  CreateTensionInputSchema,
  dissolveTension,
  DissolveTensionInputSchema,
  isTensionDocument,
  reducer,
  resolveTension,
  ResolveTensionInputSchema,
  utils,
} from "document-models/tension/v1";
import { describe, expect, it } from "vitest";

describe("TensionManagementOperations", () => {
  it("should handle createTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateTensionInputSchema());

    const updatedDocument = reducer(document, createTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CREATE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle resolveTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ResolveTensionInputSchema());

    const updatedDocument = reducer(document, resolveTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "RESOLVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle dissolveTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(DissolveTensionInputSchema());

    const updatedDocument = reducer(document, dissolveTension(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "DISSOLVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addInvolvedRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddInvolvedRefInputSchema());

    const updatedDocument = reducer(document, addInvolvedRef(input));

    expect(isTensionDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_INVOLVED_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle a full lifecycle and reject resolving a non-open tension", () => {
    const document = utils.createDocument();

    // Op 0: create with all optional fields provided
    let updatedDocument = reducer(
      document,
      createTension({
        title: "Conflicting retention claims",
        description: "Two claims disagree about spaced repetition",
        content: "Claim A says X, claim B says not-X",
        involvedRefs: ["claim-a"],
        observedAt: "2026-01-01T00:00:00.000Z",
        observedBy: "liberuum",
      }),
    );

    expect(updatedDocument.state.global.title).toBe(
      "Conflicting retention claims",
    );
    expect(updatedDocument.state.global.content).toBe(
      "Claim A says X, claim B says not-X",
    );
    expect(updatedDocument.state.global.observedBy).toBe("liberuum");
    expect(updatedDocument.state.global.status).toBe("OPEN");
    expect(updatedDocument.state.global.involvedRefs).toStrictEqual([
      "claim-a",
    ]);

    // Op 1: add a new involved ref
    updatedDocument = reducer(
      updatedDocument,
      addInvolvedRef({ ref: "claim-b" }),
    );
    expect(updatedDocument.state.global.involvedRefs).toStrictEqual([
      "claim-a",
      "claim-b",
    ]);

    // Op 2: adding a duplicate ref is a no-op
    updatedDocument = reducer(
      updatedDocument,
      addInvolvedRef({ ref: "claim-b" }),
    );
    expect(updatedDocument.state.global.involvedRefs).toStrictEqual([
      "claim-a",
      "claim-b",
    ]);

    // Op 3: resolve the open tension
    updatedDocument = reducer(
      updatedDocument,
      resolveTension({
        resolution: "Claim B was refined",
        resolvedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(updatedDocument.state.global.status).toBe("RESOLVED");
    expect(updatedDocument.state.global.resolution).toBe("Claim B was refined");
    expect(updatedDocument.state.global.resolvedAt).toBe(
      "2026-01-02T00:00:00.000Z",
    );

    // Op 4: resolving again errors and does not mutate state
    updatedDocument = reducer(
      updatedDocument,
      resolveTension({
        resolution: "Should not apply",
        resolvedAt: "2026-01-03T00:00:00.000Z",
      }),
    );
    expect(updatedDocument.operations.global[4].error).toBe(
      "Tension is not open",
    );
    expect(updatedDocument.state.global.status).toBe("RESOLVED");
    expect(updatedDocument.state.global.resolution).toBe("Claim B was refined");

    // Op 5: dissolving a resolved tension errors and does not mutate state
    updatedDocument = reducer(
      updatedDocument,
      dissolveTension({
        resolution: "Should not apply either",
        resolvedAt: "2026-01-04T00:00:00.000Z",
      }),
    );
    expect(updatedDocument.operations.global[5].error).toBe(
      "Tension is not open",
    );
    expect(updatedDocument.state.global.status).toBe("RESOLVED");
    expect(updatedDocument.state.global.resolution).toBe("Claim B was refined");
    expect(updatedDocument.state.global.resolvedAt).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("should default optional create fields to null and dissolve an open tension", () => {
    const document = utils.createDocument();

    // Op 0: create without content/observedBy
    let updatedDocument = reducer(
      document,
      createTension({
        title: "Sparse tension",
        description: "Minimal input",
        involvedRefs: [],
        observedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    expect(updatedDocument.state.global.content).toBeNull();
    expect(updatedDocument.state.global.observedBy).toBeNull();
    expect(updatedDocument.state.global.status).toBe("OPEN");

    // Op 1: dissolve the open tension
    updatedDocument = reducer(
      updatedDocument,
      dissolveTension({
        resolution: "Turned out to be a misreading",
        resolvedAt: "2026-02-02T00:00:00.000Z",
      }),
    );
    expect(updatedDocument.state.global.status).toBe("DISSOLVED");
    expect(updatedDocument.state.global.resolution).toBe(
      "Turned out to be a misreading",
    );

    // Op 2: resolving a dissolved tension errors and does not mutate state
    updatedDocument = reducer(
      updatedDocument,
      resolveTension({
        resolution: "Should not apply",
        resolvedAt: "2026-02-03T00:00:00.000Z",
      }),
    );
    expect(updatedDocument.operations.global[2].error).toBe(
      "Tension is not open",
    );
    expect(updatedDocument.state.global.status).toBe("DISSOLVED");
    expect(updatedDocument.state.global.resolution).toBe(
      "Turned out to be a misreading",
    );
  });
});
