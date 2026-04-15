import type { DerivationDerivationManagementOperations } from "document-models/derivation/v1";

export const derivationDerivationManagementOperations: DerivationDerivationManagementOperations =
  {
    initializeDerivationOperation(state, action) {
      state.engineVersion = action.input.engineVersion;
      state.derivedAt = action.input.derivedAt;
    },
    addSignalOperation(state, action) {
      state.signals.push({
        id: action.input.id,
        utterance: action.input.utterance,
        influencedDimensions: action.input.influencedDimensions,
        interpretation: action.input.interpretation,
      });
    },
    addReseedEntryOperation(state, action) {
      state.reseedHistory.push({
        id: action.input.id,
        reseededAt: action.input.reseededAt,
        reason: action.input.reason,
        changes: action.input.changes,
      });
    },
    updateDimensionRationaleOperation(state, action) {
      const existing = state.dimensionRationale.findIndex(
        (d) => d.dimension === action.input.dimension,
      );
      const entry = {
        dimension: action.input.dimension,
        position: action.input.position,
        confidence: action.input.confidence,
        rationale: action.input.rationale,
        supportingClaims: action.input.supportingClaims,
        failureModes: action.input.failureModes,
      };
      if (existing >= 0) {
        state.dimensionRationale[existing] = entry;
      } else {
        state.dimensionRationale.push(entry);
      }
    },
  };
