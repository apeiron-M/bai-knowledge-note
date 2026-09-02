import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/source",
  name: "Source",
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  extension: "",
  description:
    "Ingested source material \u2014 articles, papers, transcripts, and other content that feeds the knowledge extraction pipeline.",
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
            "enum SourceType {\n    ARTICLE\n    PAPER\n    BOOK_CHAPTER\n    TRANSCRIPT\n    DOCUMENTATION\n    CONVERSATION\n    WEB_PAGE\n    MANUAL_ENTRY\n}\n\nenum SourceStatus {\n    INBOX\n    EXTRACTING\n    EXTRACTED\n    ARCHIVED\n}\n\ntype SourceProvenance {\n    url: String\n    author: String\n    publishedAt: DateTime\n    method: String\n    tool: String\n}\n\ntype ExtractionStats {\n    claimCount: Int!\n    skippedCount: Int!\n    skipRate: Float!\n    extractedAt: DateTime\n    extractedBy: String\n}\n\ntype SourceState {\n    title: String\n    description: String\n    content: String\n    sourceType: SourceType\n    status: SourceStatus\n    provenance: SourceProvenance\n    extractedClaims: [String!]!\n    extractionStats: ExtractionStats\n    createdAt: DateTime\n    createdBy: String\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "sourceType": null,\n    "status": "INBOX",\n    "provenance": null,\n    "extractedClaims": [],\n    "extractionStats": null,\n    "createdAt": null,\n    "createdBy": null\n}',
        },
      },
      modules: [
        {
          id: "source-management",
          name: "source-management",
          operations: [
            {
              id: "ingest-source",
              name: "INGEST_SOURCE",
              scope: "global",
              errors: [],
              schema:
                "input IngestSourceInput {\n    title: String!\n    content: String!\n    sourceType: SourceType!\n    description: String\n    url: String\n    author: String\n    publishedAt: DateTime\n    method: String\n    tool: String\n    createdAt: DateTime!\n    createdBy: String\n}",
              reducer:
                'state.title = action.input.title;\nstate.content = action.input.content;\nstate.sourceType = action.input.sourceType;\nstate.description = action.input.description || null;\nstate.status = "INBOX";\nstate.createdAt = action.input.createdAt;\nstate.createdBy = action.input.createdBy || null;\nif (action.input.url || action.input.author || action.input.publishedAt) {\n    state.provenance = {\n        url: action.input.url || null,\n        author: action.input.author || null,\n        publishedAt: action.input.publishedAt || null,\n        method: action.input.method || null,\n        tool: action.input.tool || null,\n    };\n}',
              examples: [],
              template: "Add new source material",
              description: "Add new source material",
            },
            {
              id: "set-source-status",
              name: "SET_SOURCE_STATUS",
              scope: "global",
              errors: [],
              schema:
                "input SetSourceStatusInput {\n    status: SourceStatus!\n}",
              reducer: "state.status = action.input.status;",
              examples: [],
              template: "Transition source status",
              description: "Transition source status",
            },
            {
              id: "add-extracted-claim",
              name: "ADD_EXTRACTED_CLAIM",
              scope: "global",
              errors: [],
              schema:
                "input AddExtractedClaimInput {\n    claimRef: String!\n}",
              reducer:
                "// Idempotent on claimRef: a claim is listed once, however many times an\n// extraction, a sync or a retry asserts it. Re-adding is a no-op, not an\n// error, so pipelines can assert membership without reading state first.\nif (state.extractedClaims.includes(action.input.claimRef)) {\n  return;\n}\nstate.extractedClaims.push(action.input.claimRef);",
              examples: [],
              template: "Link an extracted claim to this source",
              description:
                "Record that a knowledge note was extracted from this source. Idempotent on claimRef: re-adding a listed claim is a no-op.",
            },
            {
              id: "record-extraction-stats",
              name: "RECORD_EXTRACTION_STATS",
              scope: "global",
              errors: [],
              schema:
                "input RecordExtractionStatsInput {\n    claimCount: Int!\n    skippedCount: Int!\n    skipRate: Float!\n    extractedAt: DateTime!\n    extractedBy: String\n}",
              reducer:
                "state.extractionStats = {\n    claimCount: action.input.claimCount,\n    skippedCount: action.input.skippedCount,\n    skipRate: action.input.skipRate,\n    extractedAt: action.input.extractedAt,\n    extractedBy: action.input.extractedBy || null,\n};",
              examples: [],
              template: "Record extraction statistics",
              description: "Record extraction statistics",
            },
            {
              id: "remove-extracted-claim",
              name: "REMOVE_EXTRACTED_CLAIM",
              description:
                "Remove a claim reference from extractedClaims \u2014 every occurrence, so it also repairs lists that grew duplicates before ADD_EXTRACTED_CLAIM became idempotent. Fails with CLAIM_NOT_FOUND when the ref is not listed.",
              schema:
                "input RemoveExtractedClaimInput {\n    claimRef: String!\n}",
              template:
                "Remove a claim reference from extractedClaims \u2014 every occurrence, so it also repairs lists that grew duplicates before ADD_EXTRACTED_CLAIM became idempotent. Fails with CLAIM_NOT_FOUND when the ref is not listed.",
              reducer:
                "if (!state.extractedClaims.includes(action.input.claimRef)) {\n  throw new ClaimNotFoundError(\n    `Claim ${action.input.claimRef} is not listed on this source`,\n  );\n}\n// Every occurrence: this also repairs lists that grew duplicates before\n// ADD_EXTRACTED_CLAIM became idempotent.\nstate.extractedClaims = state.extractedClaims.filter(\n  (ref) => ref !== action.input.claimRef,\n);",
              errors: [
                {
                  id: "claim-not-found",
                  name: "ClaimNotFoundError",
                  code: "CLAIM_NOT_FOUND",
                  description:
                    "The claim reference is not listed in this source's extractedClaims",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
          description: "Source lifecycle and extraction tracking",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
