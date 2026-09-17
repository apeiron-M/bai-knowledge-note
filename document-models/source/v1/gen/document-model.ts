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
            "enum SourceType {\n    ARTICLE\n    PAPER\n    BOOK_CHAPTER\n    TRANSCRIPT\n    DOCUMENTATION\n    CONVERSATION\n    WEB_PAGE\n    MANUAL_ENTRY\n}\n\nenum SourceStatus {\n    INBOX\n    EXTRACTING\n    EXTRACTED\n    ARCHIVED\n}\n\ntype SourceProvenance {\n    url: String\n    author: String\n    publishedAt: DateTime\n    method: String\n    tool: String\n}\n\ntype ExtractionStats {\n    claimCount: Int!\n    skippedCount: Int!\n    skipRate: Float!\n    extractedAt: DateTime\n    extractedBy: String\n}\n\ntype SourceState {\n    title: String\n    description: String\n    content: String\n    sourceType: SourceType\n    status: SourceStatus\n    provenance: SourceProvenance\n    extractedClaims: [String!]!\n    extractionStats: ExtractionStats\n    # the artefact this source was derived from. The vault's premise is that a\n    # source is the unrecoverable anchor, so the original bytes are kept here\n    # rather than discarded at ingestion. Content-addressed: see the attachment store.\n    originalFile: AttachmentRef\n    originalFileName: String\n    originalMimeType: String\n    originalSizeBytes: Int\n    originalAttachedAt: DateTime\n    # what produced `content` from the original, so a re-ingest can say what changed\n    convertedBy: String\n    createdAt: DateTime\n    createdBy: String\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "sourceType": null,\n    "status": "INBOX",\n    "provenance": null,\n    "extractedClaims": [],\n    "extractionStats": null,\n    "createdAt": null,\n    "createdBy": null,\n    "originalFile": null,\n    "originalFileName": null,\n    "originalMimeType": null,\n    "originalSizeBytes": null,\n    "originalAttachedAt": null,\n    "convertedBy": null\n}',
        },
      },
      modules: [
        {
          id: "source-management",
          name: "source-management",
          description: "Source lifecycle and extraction tracking",
          operations: [
            {
              id: "ingest-source",
              name: "INGEST_SOURCE",
              description: "Add new source material",
              schema:
                "input IngestSourceInput {\n    title: String!\n    content: String!\n    sourceType: SourceType!\n    description: String\n    url: String\n    author: String\n    publishedAt: DateTime\n    method: String\n    tool: String\n    createdAt: DateTime!\n    createdBy: String\n}",
              template: "Add new source material",
              reducer:
                'state.title = action.input.title;\nstate.content = action.input.content;\nstate.sourceType = action.input.sourceType;\nstate.description = action.input.description || null;\nstate.status = "INBOX";\nstate.createdAt = action.input.createdAt;\nstate.createdBy = action.input.createdBy || null;\nconst { url, author, publishedAt, method, tool } = action.input;\nif (url || author || publishedAt || method || tool) {\n  state.provenance = {\n    url: url || null,\n    author: author || null,\n    publishedAt: publishedAt || null,\n    method: method || null,\n    tool: tool || null,\n  };\n}',
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "set-source-status",
              name: "SET_SOURCE_STATUS",
              description: "Transition source status",
              schema:
                "input SetSourceStatusInput {\n    status: SourceStatus!\n}",
              template: "Transition source status",
              reducer:
                'const from: SourceStatus = state.status || "INBOX";\nconst to = action.input.status;\nif (from === to) return;\nconst ALLOWED: Record<SourceStatus, readonly SourceStatus[]> = {\n  INBOX: ["EXTRACTING", "ARCHIVED"],\n  EXTRACTING: ["EXTRACTED", "INBOX", "ARCHIVED"],\n  EXTRACTED: ["ARCHIVED", "EXTRACTING"],\n  ARCHIVED: ["INBOX"],\n};\nif (!ALLOWED[from].includes(to)) {\n  throw new InvalidSourceStatusTransitionError(\n    `A source cannot move from ${from} to ${to}`,\n  );\n}\nstate.status = to;',
              errors: [
                {
                  id: "err-invalid-source-status-transition",
                  name: "InvalidSourceStatusTransitionError",
                  code: "INVALID_SOURCE_STATUS_TRANSITION",
                  description:
                    "Lifecycle is INBOX \u2192 EXTRACTING \u2192 EXTRACTED \u2192 ARCHIVED (with EXTRACTING\u2192INBOX, EXTRACTED\u2192EXTRACTING and ARCHIVED\u2192INBOX as the only ways back)",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "add-extracted-claim",
              name: "ADD_EXTRACTED_CLAIM",
              description:
                "Record that a knowledge note was extracted from this source. Idempotent on claimRef: re-adding a listed claim is a no-op.",
              schema:
                "input AddExtractedClaimInput {\n    claimRef: String!\n}",
              template: "Link an extracted claim to this source",
              reducer:
                "// Idempotent on claimRef: a claim is listed once, however many times an\n// extraction, a sync or a retry asserts it. Re-adding is a no-op, not an\n// error, so pipelines can assert membership without reading state first.\nif (state.extractedClaims.includes(action.input.claimRef)) {\n  return;\n}\nstate.extractedClaims.push(action.input.claimRef);",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "record-extraction-stats",
              name: "RECORD_EXTRACTION_STATS",
              description: "Record extraction statistics",
              schema:
                "input RecordExtractionStatsInput {\n    claimCount: Int!\n    skippedCount: Int!\n    skipRate: Float!\n    extractedAt: DateTime!\n    extractedBy: String\n}",
              template: "Record extraction statistics",
              reducer:
                'const { claimCount, skippedCount, skipRate } = action.input;\nif (claimCount < 0 || skippedCount < 0 || skipRate < 0 || skipRate > 1) {\n  throw new InvalidExtractionStatsError(\n    "claimCount and skippedCount must be >= 0 and skipRate within 0..1",\n  );\n}\nif (claimCount !== state.extractedClaims.length) {\n  throw new ExtractionStatsMismatchError(\n    `claimCount ${claimCount} does not match the ${state.extractedClaims.length} extracted claims on this source; add the claims first`,\n  );\n}\nstate.extractionStats = {\n  claimCount,\n  skippedCount,\n  skipRate,\n  extractedAt: action.input.extractedAt,\n  extractedBy: action.input.extractedBy || null,\n};',
              errors: [
                {
                  id: "err-invalid-extraction-stats",
                  name: "InvalidExtractionStatsError",
                  code: "INVALID_EXTRACTION_STATS",
                  description:
                    "Counts must be non-negative and skipRate a fraction in 0..1",
                  template: "",
                },
                {
                  id: "err-extraction-stats-mismatch",
                  name: "ExtractionStatsMismatchError",
                  code: "EXTRACTION_STATS_MISMATCH",
                  description:
                    "claimCount must equal the number of extractedClaims already on the source",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
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
            {
              id: "attach-original-file",
              name: "ATTACH_ORIGINAL_FILE",
              description:
                "Records the original file this source was converted from, as an attachment ref.",
              schema:
                "input AttachOriginalFileInput {\n    originalFile: AttachmentRef!\n    originalFileName: String\n    originalMimeType: String\n    originalSizeBytes: Int\n    convertedBy: String\n    attachedAt: DateTime!\n}",
              template:
                "Records the original file this source was converted from, as an attachment ref.",
              reducer:
                'if (state.originalFile && state.originalFile !== action.input.originalFile) {\n  throw new OriginalAlreadyAttachedError("This source already has an original file; attach it again only with the same ref");\n}\nstate.originalFile = action.input.originalFile;\nstate.originalFileName = action.input.originalFileName || null;\nstate.originalMimeType = action.input.originalMimeType || null;\nstate.originalSizeBytes = action.input.originalSizeBytes ?? null;\nstate.originalAttachedAt = action.input.attachedAt;\nstate.convertedBy = action.input.convertedBy || null;',
              errors: [
                {
                  id: "original-already-attached",
                  name: "OriginalAlreadyAttachedError",
                  code: "ORIGINAL_ALREADY_ATTACHED",
                  description:
                    "The source already has a different original file attached.",
                  template: "",
                },
              ],
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
