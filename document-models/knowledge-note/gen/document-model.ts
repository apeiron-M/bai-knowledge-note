import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/knowledge-note",
  name: "KnowledgeNote",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "kn.phd",
  description:
    "Atomic knowledge note \u2014 the building block of team-wide institutional memory. Notes have typed content, structured links, lifecycle states, and provenance tracking.",
  specifications: [
    {
      state: {
        local: {
          schema:
            "type KnowledgeNoteLocalState {\n    lastViewedAt: DateTime\n    personalTags: [PersonalTag!]!\n}\n\ntype PersonalTag {\n    id: OID!\n    name: String!\n}",
          examples: [],
          initialValue:
            '{\n    "lastViewedAt": null,\n    "personalTags": []\n}',
        },
        global: {
          schema:
            "enum NoteStatus {\n    DRAFT\n    IN_REVIEW\n    CANONICAL\n    ARCHIVED\n}\n\nenum SourceOrigin {\n    MANUAL\n    SESSION_MINE\n    IMPORT\n    DERIVED\n}\n\nenum LinkType {\n    RELATES_TO\n    BUILDS_ON\n    CONTRADICTS\n    SUPERSEDES\n    DERIVED_FROM\n}\n\ntype KnowledgeNoteState {\n    title: String\n    description: String\n    noteType: String\n    content: String\n    status: NoteStatus\n    provenance: Provenance\n    links: [NoteLink!]!\n    topics: [Topic!]!\n    scope: String\n    confidence: String\n    severity: String\n    editor: String\n    models: [String!]!\n    hooksUsed: [String!]!\n    dispatchTargets: [String!]!\n    modelId: String\n    modules: [String!]!\n    version: String\n    filePath: String\n    computes: String\n    inputs: [String!]!\n    outputs: [String!]!\n    consumedBy: [String!]!\n    context: String\n    alternatives: [String!]!\n    consequences: [String!]!\n    decisionStatus: String\n    model: String\n    sourceType: String\n    targetType: String\n    relationType: String\n    cardinality: String\n    errorMessage: String\n    rootCause: String\n    correctPattern: String\n    lifecycleEvents: [LifecycleEvent!]!\n}\n\ntype Provenance {\n    author: String\n    sourceOrigin: SourceOrigin\n    sessionId: String\n    createdAt: DateTime\n    updatedAt: DateTime\n}\n\ntype NoteLink {\n    id: OID!\n    targetDocumentId: String\n    targetTitle: String\n    linkType: LinkType\n}\n\ntype Topic {\n    id: OID!\n    name: String!\n    topicDocumentId: String\n}\n\ntype LifecycleEvent {\n    id: OID!\n    fromStatus: NoteStatus\n    toStatus: NoteStatus\n    actor: String\n    timestamp: DateTime\n    comment: String\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "noteType": null,\n    "content": null,\n    "status": "DRAFT",\n    "provenance": null,\n    "links": [],\n    "topics": [],\n    "scope": null,\n    "confidence": null,\n    "severity": null,\n    "editor": null,\n    "models": [],\n    "hooksUsed": [],\n    "dispatchTargets": [],\n    "modelId": null,\n    "modules": [],\n    "version": null,\n    "filePath": null,\n    "computes": null,\n    "inputs": [],\n    "outputs": [],\n    "consumedBy": [],\n    "context": null,\n    "alternatives": [],\n    "consequences": [],\n    "decisionStatus": null,\n    "model": null,\n    "sourceType": null,\n    "targetType": null,\n    "relationType": null,\n    "cardinality": null,\n    "errorMessage": null,\n    "rootCause": null,\n    "correctPattern": null,\n    "lifecycleEvents": []\n}',
        },
      },
      modules: [
        {
          id: "content-module",
          name: "content",
          operations: [
            {
              id: "set-title",
              name: "SET_TITLE",
              scope: "global",
              errors: [],
              schema:
                "input SetTitleInput {\n    title: String!\n    updatedAt: DateTime!\n}",
              reducer:
                "state.title = action.input.title;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}",
              examples: [],
              template: "",
              description: "Set the note title",
            },
            {
              id: "set-description",
              name: "SET_DESCRIPTION",
              scope: "global",
              errors: [
                {
                  id: "err-description-too-long",
                  code: "DESCRIPTION_TOO_LONG",
                  name: "DescriptionTooLongError",
                  template: "",
                  description: "Description exceeds 200 characters",
                },
              ],
              schema:
                "input SetDescriptionInput {\n    description: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'if (action.input.description.length > 200) {\n    throw new DescriptionTooLongError("Description exceeds 200 characters");\n}\nstate.description = action.input.description;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}',
              examples: [],
              template: "",
              description: "Set the note description (max 200 chars)",
            },
            {
              id: "set-note-type",
              name: "SET_NOTE_TYPE",
              scope: "global",
              errors: [],
              schema:
                "input SetNoteTypeInput {\n    noteType: String!\n    updatedAt: DateTime!\n}",
              reducer:
                "state.noteType = action.input.noteType;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}",
              examples: [],
              template: "",
              description: "Set or change the note type",
            },
            {
              id: "set-content",
              name: "SET_CONTENT",
              scope: "global",
              errors: [],
              schema:
                "input SetContentInput {\n    content: String!\n    updatedAt: DateTime!\n}",
              reducer:
                "state.content = action.input.content;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}",
              examples: [],
              template: "",
              description: "Replace the markdown content body",
            },
            {
              id: "patch-content",
              name: "PATCH_CONTENT",
              scope: "global",
              errors: [
                {
                  id: "err-patch-out-of-bounds",
                  code: "PATCH_OUT_OF_BOUNDS",
                  name: "PatchOutOfBoundsError",
                  template: "",
                  description: "Offset + removeCount exceeds content length",
                },
              ],
              schema:
                "input PatchContentInput {\n    offset: Int!\n    removeCount: Int!\n    insert: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'const content = state.content || "";\nconst { offset, removeCount, insert } = action.input;\nif (offset < 0 || offset + removeCount > content.length) {\n    throw new PatchOutOfBoundsError("Offset + removeCount exceeds content length");\n}\nstate.content = content.slice(0, offset) + insert + content.slice(offset + removeCount);\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}',
              examples: [],
              template: "",
              description: "Surgical edit to content",
            },
            {
              id: "set-metadata-field",
              name: "SET_METADATA_FIELD",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-metadata-field",
                  code: "INVALID_METADATA_FIELD",
                  name: "InvalidMetadataFieldError",
                  template: "",
                  description:
                    "Field name is not a recognized string metadata field",
                },
              ],
              schema:
                "input SetMetadataFieldInput {\n    field: String!\n    value: String\n    updatedAt: DateTime!\n}",
              reducer:
                'const STRING_METADATA_FIELDS = [\n    "scope", "confidence", "severity", "editor", "modelId", "version",\n    "filePath", "computes", "context", "decisionStatus", "model",\n    "sourceType", "targetType", "relationType", "cardinality",\n    "errorMessage", "rootCause", "correctPattern"\n];\nconst { field, value } = action.input;\nif (!STRING_METADATA_FIELDS.includes(field)) {\n    throw new InvalidMetadataFieldError(`"${field}" is not a recognized string metadata field`);\n}\n(state as any)[field] = value || null;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}',
              examples: [],
              template: "",
              description: "Set any string metadata field by name",
            },
            {
              id: "set-metadata-list-field",
              name: "SET_METADATA_LIST_FIELD",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-metadata-list-field",
                  code: "INVALID_METADATA_LIST_FIELD",
                  name: "InvalidMetadataListFieldError",
                  template: "",
                  description:
                    "Field name is not a recognized list metadata field",
                },
              ],
              schema:
                "input SetMetadataListFieldInput {\n    field: String!\n    values: [String!]!\n    updatedAt: DateTime!\n}",
              reducer:
                'const LIST_METADATA_FIELDS = [\n    "models", "hooksUsed", "dispatchTargets", "modules", "inputs",\n    "outputs", "consumedBy", "alternatives", "consequences"\n];\nconst { field, values } = action.input;\nif (!LIST_METADATA_FIELDS.includes(field)) {\n    throw new InvalidMetadataListFieldError(`"${field}" is not a recognized list metadata field`);\n}\n(state as any)[field] = values;\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.updatedAt;\n}',
              examples: [],
              template: "",
              description: "Set any string-array metadata field by name",
            },
          ],
          description: "Core note editing",
        },
        {
          id: "provenance-module",
          name: "provenance",
          operations: [
            {
              id: "set-provenance",
              name: "SET_PROVENANCE",
              scope: "global",
              errors: [],
              schema:
                "input SetProvenanceInput {\n    author: String!\n    sourceOrigin: SourceOrigin!\n    sessionId: String\n    createdAt: DateTime!\n}",
              reducer:
                "state.provenance = {\n    author: action.input.author,\n    sourceOrigin: action.input.sourceOrigin,\n    sessionId: action.input.sessionId || null,\n    createdAt: action.input.createdAt,\n    updatedAt: action.input.createdAt,\n};",
              examples: [],
              template: "",
              description:
                "Record author, source origin, session ID, and creation timestamp",
            },
          ],
          description: "Source tracking",
        },
        {
          id: "linking-module",
          name: "linking",
          operations: [
            {
              id: "add-link",
              name: "ADD_LINK",
              scope: "global",
              errors: [
                {
                  id: "err-duplicate-link-id",
                  code: "DUPLICATE_LINK_ID",
                  name: "DuplicateLinkIdError",
                  template: "",
                  description: "A link with this OID already exists",
                },
              ],
              schema:
                "input AddLinkInput {\n    id: OID!\n    targetDocumentId: String!\n    targetTitle: String\n    linkType: LinkType!\n}",
              reducer:
                'const existing = state.links.find(l => l.id === action.input.id);\nif (existing) {\n    throw new DuplicateLinkIdError("A link with this OID already exists");\n}\nstate.links.push({\n    id: action.input.id,\n    targetDocumentId: action.input.targetDocumentId,\n    targetTitle: action.input.targetTitle || null,\n    linkType: action.input.linkType,\n});',
              examples: [],
              template: "",
              description: "Create a typed link to another note",
            },
            {
              id: "remove-link",
              name: "REMOVE_LINK",
              scope: "global",
              errors: [
                {
                  id: "err-link-not-found-remove",
                  code: "LINK_NOT_FOUND",
                  name: "LinkNotFoundError",
                  template: "",
                  description: "No link with this OID",
                },
              ],
              schema: "input RemoveLinkInput {\n    id: OID!\n}",
              reducer:
                'const index = state.links.findIndex(l => l.id === action.input.id);\nif (index === -1) {\n    throw new LinkNotFoundError("No link with this OID");\n}\nstate.links.splice(index, 1);',
              examples: [],
              template: "",
              description: "Remove a link by ID",
            },
            {
              id: "update-link-type",
              name: "UPDATE_LINK_TYPE",
              scope: "global",
              errors: [
                {
                  id: "err-link-not-found-update",
                  code: "LINK_NOT_FOUND",
                  name: "LinkNotFoundError",
                  template: "",
                  description: "No link with this OID",
                },
              ],
              schema:
                "input UpdateLinkTypeInput {\n    id: OID!\n    linkType: LinkType!\n}",
              reducer:
                'const link = state.links.find(l => l.id === action.input.id);\nif (!link) {\n    throw new LinkNotFoundError("No link with this OID");\n}\nlink.linkType = action.input.linkType;',
              examples: [],
              template: "",
              description: "Change a link's type",
            },
            {
              id: "add-topic",
              name: "ADD_TOPIC",
              scope: "global",
              errors: [
                {
                  id: "err-duplicate-topic",
                  code: "DUPLICATE_TOPIC",
                  name: "DuplicateTopicError",
                  template: "",
                  description:
                    "A topic with this name already exists on this note",
                },
              ],
              schema:
                "input AddTopicInput {\n    id: OID!\n    name: String!\n    topicDocumentId: String\n}",
              reducer:
                'const duplicate = state.topics.find(t => t.name === action.input.name);\nif (duplicate) {\n    throw new DuplicateTopicError("A topic with this name already exists on this note");\n}\nstate.topics.push({\n    id: action.input.id,\n    name: action.input.name,\n    topicDocumentId: action.input.topicDocumentId || null,\n});',
              examples: [],
              template: "",
              description: "Tag the note with a topic",
            },
            {
              id: "remove-topic",
              name: "REMOVE_TOPIC",
              scope: "global",
              errors: [
                {
                  id: "err-topic-not-found",
                  code: "TOPIC_NOT_FOUND",
                  name: "TopicNotFoundError",
                  template: "",
                  description: "No topic with this OID",
                },
              ],
              schema: "input RemoveTopicInput {\n    id: OID!\n}",
              reducer:
                'const index = state.topics.findIndex(t => t.id === action.input.id);\nif (index === -1) {\n    throw new TopicNotFoundError("No topic with this OID");\n}\nstate.topics.splice(index, 1);',
              examples: [],
              template: "",
              description: "Remove a topic tag by ID",
            },
          ],
          description: "Knowledge graph edges",
        },
        {
          id: "lifecycle-module",
          name: "lifecycle",
          operations: [
            {
              id: "submit-for-review",
              name: "SUBMIT_FOR_REVIEW",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-transition-submit",
                  code: "INVALID_STATUS_TRANSITION",
                  name: "InvalidStatusTransitionError",
                  template: "",
                  description: "Current status doesn't allow this transition",
                },
              ],
              schema:
                "input SubmitForReviewInput {\n    id: OID!\n    actor: String!\n    timestamp: DateTime!\n    comment: String\n}",
              reducer:
                'if (state.status !== "DRAFT") {\n    throw new InvalidStatusTransitionError("Can only submit for review from DRAFT status");\n}\nstate.status = "IN_REVIEW";\nstate.lifecycleEvents.push({\n    id: action.input.id,\n    fromStatus: "DRAFT",\n    toStatus: "IN_REVIEW",\n    actor: action.input.actor,\n    timestamp: action.input.timestamp,\n    comment: action.input.comment || null,\n});\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.timestamp;\n}',
              examples: [],
              template: "",
              description: "Transition DRAFT \u2192 IN_REVIEW",
            },
            {
              id: "approve-note",
              name: "APPROVE_NOTE",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-transition-approve",
                  code: "INVALID_STATUS_TRANSITION",
                  name: "InvalidStatusTransitionError",
                  template: "",
                  description: "Current status doesn't allow this transition",
                },
                {
                  id: "err-self-approval",
                  code: "SELF_APPROVAL",
                  name: "SelfApprovalError",
                  template: "",
                  description: "Actor cannot approve their own note",
                },
              ],
              schema:
                "input ApproveNoteInput {\n    id: OID!\n    actor: String!\n    timestamp: DateTime!\n    comment: String\n}",
              reducer:
                'if (state.status !== "IN_REVIEW") {\n    throw new InvalidStatusTransitionError("Can only approve from IN_REVIEW status");\n}\nif (state.provenance && state.provenance.author === action.input.actor) {\n    throw new SelfApprovalError("Actor cannot approve their own note");\n}\nstate.status = "CANONICAL";\nstate.lifecycleEvents.push({\n    id: action.input.id,\n    fromStatus: "IN_REVIEW",\n    toStatus: "CANONICAL",\n    actor: action.input.actor,\n    timestamp: action.input.timestamp,\n    comment: action.input.comment || null,\n});\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.timestamp;\n}',
              examples: [],
              template: "",
              description:
                "Transition IN_REVIEW \u2192 CANONICAL (actor \u2260 author)",
            },
            {
              id: "reject-note",
              name: "REJECT_NOTE",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-transition-reject",
                  code: "INVALID_STATUS_TRANSITION",
                  name: "InvalidStatusTransitionError",
                  template: "",
                  description: "Current status doesn't allow this transition",
                },
              ],
              schema:
                "input RejectNoteInput {\n    id: OID!\n    actor: String!\n    timestamp: DateTime!\n    comment: String!\n}",
              reducer:
                'if (state.status !== "IN_REVIEW") {\n    throw new InvalidStatusTransitionError("Can only reject from IN_REVIEW status");\n}\nstate.status = "DRAFT";\nstate.lifecycleEvents.push({\n    id: action.input.id,\n    fromStatus: "IN_REVIEW",\n    toStatus: "DRAFT",\n    actor: action.input.actor,\n    timestamp: action.input.timestamp,\n    comment: action.input.comment,\n});\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.timestamp;\n}',
              examples: [],
              template: "",
              description: "Transition IN_REVIEW \u2192 DRAFT with feedback",
            },
            {
              id: "archive-note",
              name: "ARCHIVE_NOTE",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-transition-archive",
                  code: "INVALID_STATUS_TRANSITION",
                  name: "InvalidStatusTransitionError",
                  template: "",
                  description: "Current status doesn't allow this transition",
                },
              ],
              schema:
                "input ArchiveNoteInput {\n    id: OID!\n    actor: String!\n    timestamp: DateTime!\n    comment: String!\n}",
              reducer:
                'if (state.status !== "CANONICAL") {\n    throw new InvalidStatusTransitionError("Can only archive from CANONICAL status");\n}\nstate.status = "ARCHIVED";\nstate.lifecycleEvents.push({\n    id: action.input.id,\n    fromStatus: "CANONICAL",\n    toStatus: "ARCHIVED",\n    actor: action.input.actor,\n    timestamp: action.input.timestamp,\n    comment: action.input.comment,\n});\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.timestamp;\n}',
              examples: [],
              template: "",
              description: "Transition CANONICAL \u2192 ARCHIVED",
            },
            {
              id: "restore-note",
              name: "RESTORE_NOTE",
              scope: "global",
              errors: [
                {
                  id: "err-invalid-transition-restore",
                  code: "INVALID_STATUS_TRANSITION",
                  name: "InvalidStatusTransitionError",
                  template: "",
                  description: "Current status doesn't allow this transition",
                },
              ],
              schema:
                "input RestoreNoteInput {\n    id: OID!\n    actor: String!\n    timestamp: DateTime!\n    comment: String\n}",
              reducer:
                'if (state.status !== "ARCHIVED") {\n    throw new InvalidStatusTransitionError("Can only restore from ARCHIVED status");\n}\nstate.status = "DRAFT";\nstate.lifecycleEvents.push({\n    id: action.input.id,\n    fromStatus: "ARCHIVED",\n    toStatus: "DRAFT",\n    actor: action.input.actor,\n    timestamp: action.input.timestamp,\n    comment: action.input.comment || null,\n});\nif (state.provenance) {\n    state.provenance.updatedAt = action.input.timestamp;\n}',
              examples: [],
              template: "",
              description: "Transition ARCHIVED \u2192 DRAFT",
            },
          ],
          description: "Status transitions with audit trail",
        },
        {
          id: "local-module",
          name: "local",
          operations: [
            {
              id: "set-last-viewed",
              name: "SET_LAST_VIEWED",
              scope: "local",
              errors: [],
              schema:
                "input SetLastViewedInput {\n    lastViewedAt: DateTime!\n}",
              reducer: "state.lastViewedAt = action.input.lastViewedAt;",
              examples: [],
              template: "",
              description: "Update the local lastViewedAt timestamp",
            },
          ],
          description: "Per-user local state",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
