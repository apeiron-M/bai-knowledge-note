import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/derivation",
  name: "Derivation",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "der.phd",
  description:
    "Derivation record \u2014 audit trail of vault configuration decisions backed by research claims, dimension rationale, and coherence checks.",
  specifications: [
    {
      state: {
        local: {
          schema: "",
          examples: [],
          initialValue: "",
        },
        global: {
          schema:
            "type DerivationSignal {\n    id: OID!\n    utterance: String!\n    influencedDimensions: [String!]!\n    interpretation: String!\n}\n\ntype DimensionRationale {\n    dimension: String!\n    position: Int!\n    confidence: Float!\n    rationale: String!\n    supportingClaims: [String!]!\n    failureModes: [String!]!\n}\n\ntype ClaimReference {\n    id: OID!\n    claimRef: String!\n    supportsDecision: String!\n    strength: String!\n}\n\ntype FeatureDecision {\n    feature: String!\n    enabled: Boolean!\n    rationale: String!\n    supportingClaims: [String!]!\n}\n\ntype CoherenceCheck {\n    dimensionPair: [String!]!\n    coherent: Boolean!\n    explanation: String!\n}\n\ntype ReseedEntry {\n    id: OID!\n    reseededAt: DateTime!\n    reason: String!\n    changes: [String!]!\n}\n\ntype DerivationState {\n    engineVersion: String\n    derivedAt: DateTime\n    signals: [DerivationSignal!]!\n    dimensionRationale: [DimensionRationale!]!\n    claimReferences: [ClaimReference!]!\n    featureDecisions: [FeatureDecision!]!\n    coherenceResults: [CoherenceCheck!]!\n    reseedHistory: [ReseedEntry!]!\n}",
          examples: [],
          initialValue:
            '{\n    "engineVersion": null,\n    "derivedAt": null,\n    "signals": [],\n    "dimensionRationale": [],\n    "claimReferences": [],\n    "featureDecisions": [],\n    "coherenceResults": [],\n    "reseedHistory": []\n}',
        },
      },
      modules: [
        {
          id: "derivation-management",
          name: "derivation-management",
          description: "Derivation audit trail",
          operations: [
            {
              id: "initialize-derivation",
              name: "INITIALIZE_DERIVATION",
              description: "Initialize derivation record",
              schema:
                "input InitializeDerivationInput {\n    engineVersion: String!\n    derivedAt: DateTime!\n}",
              template: "Initialize derivation record",
              reducer:
                "state.engineVersion = action.input.engineVersion;\nstate.derivedAt = action.input.derivedAt;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "add-signal",
              name: "ADD_SIGNAL",
              description: "Record a user signal that influenced derivation",
              schema:
                "input AddSignalInput {\n    id: OID!\n    utterance: String!\n    influencedDimensions: [String!]!\n    interpretation: String!\n}",
              template: "Record a user signal that influenced derivation",
              reducer:
                "state.signals.push({\n    id: action.input.id,\n    utterance: action.input.utterance,\n    influencedDimensions: action.input.influencedDimensions,\n    interpretation: action.input.interpretation,\n});",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "add-reseed-entry",
              name: "ADD_RESEED_ENTRY",
              description: "Record a re-derivation event",
              schema:
                "input AddReseedEntryInput {\n    id: OID!\n    reseededAt: DateTime!\n    reason: String!\n    changes: [String!]!\n}",
              template: "Record a re-derivation event",
              reducer:
                "state.reseedHistory.push({\n    id: action.input.id,\n    reseededAt: action.input.reseededAt,\n    reason: action.input.reason,\n    changes: action.input.changes,\n});",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "update-dimension-rationale",
              name: "UPDATE_DIMENSION_RATIONALE",
              description: "Update rationale for a dimension position",
              schema:
                "input UpdateDimensionRationaleInput {\n    dimension: String!\n    position: Int!\n    confidence: Float!\n    rationale: String!\n    supportingClaims: [String!]!\n    failureModes: [String!]!\n}",
              template: "Update rationale for a dimension position",
              reducer:
                "const existing = state.dimensionRationale.findIndex(d => d.dimension === action.input.dimension);\nconst entry = {\n    dimension: action.input.dimension,\n    position: action.input.position,\n    confidence: action.input.confidence,\n    rationale: action.input.rationale,\n    supportingClaims: action.input.supportingClaims,\n    failureModes: action.input.failureModes,\n};\nif (existing >= 0) {\n    state.dimensionRationale[existing] = entry;\n} else {\n    state.dimensionRationale.push(entry);\n}",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
