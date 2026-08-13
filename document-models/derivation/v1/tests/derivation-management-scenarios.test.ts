import {
  addReseedEntry,
  addSignal,
  initializeDerivation,
  isDerivationDocument,
  reducer,
  updateDimensionRationale,
  utils,
} from "document-models/derivation/v1";
import { describe, expect, it } from "vitest";

describe("DerivationManagement scenarios", () => {
  it("should run a full derivation flow and update an existing dimension rationale in place", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      initializeDerivation({
        engineVersion: "1.0.0",
        derivedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(document.state.global.engineVersion).toBe("1.0.0");
    expect(document.state.global.derivedAt).toBe("2026-01-01T00:00:00.000Z");

    document = reducer(
      document,
      addSignal({
        id: "signal-1",
        utterance: "I mostly capture research claims",
        influencedDimensions: ["scope"],
        interpretation: "Vault is claim-centric",
      }),
    );
    expect(document.state.global.signals).toHaveLength(1);
    expect(document.state.global.signals[0]).toStrictEqual({
      id: "signal-1",
      utterance: "I mostly capture research claims",
      influencedDimensions: ["scope"],
      interpretation: "Vault is claim-centric",
    });

    document = reducer(
      document,
      addReseedEntry({
        id: "reseed-1",
        reseededAt: "2026-01-02T00:00:00.000Z",
        reason: "Config change",
        changes: [],
      }),
    );
    expect(document.state.global.reseedHistory).toHaveLength(1);
    expect(document.state.global.reseedHistory[0].changes).toStrictEqual([]);

    // First rationale is pushed (no existing entry for this dimension)
    document = reducer(
      document,
      updateDimensionRationale({
        dimension: "scope",
        position: 1,
        confidence: 0.8,
        rationale: "Initial reasoning",
        supportingClaims: [],
        failureModes: [],
      }),
    );
    expect(document.state.global.dimensionRationale).toHaveLength(1);

    // Second rationale for a different dimension is also pushed
    document = reducer(
      document,
      updateDimensionRationale({
        dimension: "granularity",
        position: 2,
        confidence: 0.5,
        rationale: "Other reasoning",
        supportingClaims: ["claim-1"],
        failureModes: ["over-fragmentation"],
      }),
    );
    expect(document.state.global.dimensionRationale).toHaveLength(2);
    expect(document.state.global.dimensionRationale[1].dimension).toBe(
      "granularity",
    );

    // Updating an existing dimension replaces the entry in place
    document = reducer(
      document,
      updateDimensionRationale({
        dimension: "scope",
        position: 3,
        confidence: 0.9,
        rationale: "Revised reasoning",
        supportingClaims: ["claim-2"],
        failureModes: [],
      }),
    );
    expect(isDerivationDocument(document)).toBe(true);
    expect(document.state.global.dimensionRationale).toHaveLength(2);
    expect(document.state.global.dimensionRationale[0]).toStrictEqual({
      dimension: "scope",
      position: 3,
      confidence: 0.9,
      rationale: "Revised reasoning",
      supportingClaims: ["claim-2"],
      failureModes: [],
    });

    expect(document.operations.global).toHaveLength(6);
    for (const operation of document.operations.global) {
      expect(operation.error).toBeUndefined();
    }
  });
});
