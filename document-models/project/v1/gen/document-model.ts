import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/project",
  name: "Project",
  author: {
    name: "BAI",
    website: "",
  },
  extension: ".proj",
  description:
    "A project managed in the Knowledge Vault: status, owner, team, deliverables, links to its Work Breakdown Structure and to the knowledge it builds on.",
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
            "type ProjectState {\n  name: String\n  description: String\n  status: ProjectStatus!\n  owner: String\n  targetDate: Date\n  wbsRef: PHID\n  team: [TeamMember!]!\n  deliverables: [Deliverable!]!\n  knowledgeRefs: [PHID!]!\n  references: [URL!]!\n  createdAt: DateTime\n}\n\nenum ProjectStatus { PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED }\n\ntype TeamMember { id: OID!  name: String!  role: String  kind: MemberKind }\nenum MemberKind { HUMAN AGENT }\n\ntype Deliverable {\n  id: OID!\n  title: String!\n  description: String\n  status: DeliverableStatus!\n  goalRef: OID\n  url: URL\n  deliveredAt: DateTime\n}\nenum DeliverableStatus { PLANNED IN_PROGRESS DELIVERED CANCELLED }",
          examples: [],
          initialValue:
            '{\n  "name": null,\n  "description": null,\n  "status": "PLANNING",\n  "owner": null,\n  "targetDate": null,\n  "wbsRef": null,\n  "team": [],\n  "deliverables": [],\n  "knowledgeRefs": [],\n  "references": [],\n  "createdAt": null\n}',
        },
      },
      modules: [
        {
          id: "37d13eb7-b9d7-4f72-a744-bedb21be48cf",
          name: "lifecycle",
          description: "",
          operations: [
            {
              id: "5dc0f9a9-72b3-4d03-830a-51426639d3e6",
              name: "CREATE_PROJECT",
              description: "",
              schema:
                "input CreateProjectInput {\n  name: String!\n  description: String\n  owner: String\n  status: ProjectStatus\n  createdAt: DateTime!\n}",
              template: "",
              reducer:
                'if (state.name) throw new AlreadyInitializedError("Project already initialized");\nstate.name = action.input.name;\nstate.description = action.input.description || null;\nstate.owner = action.input.owner || null;\nif (action.input.status) state.status = action.input.status;\nstate.createdAt = action.input.createdAt;',
              errors: [
                {
                  id: "3d3f1996-e048-4cb1-9875-2738af3ea1b9",
                  name: "AlreadyInitializedError",
                  code: "ALREADY_INITIALIZED",
                  description: "Project already initialized (name is set)",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "026d155d-d5b8-4df1-a3bd-5d5434c4d192",
              name: "UPDATE_PROJECT_INFO",
              description: "",
              schema:
                "input UpdateProjectInfoInput {\n  name: String\n  description: String\n}",
              template: "",
              reducer:
                "if (action.input.name) state.name = action.input.name;\nif (action.input.description) state.description = action.input.description;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "3d9e3fea-c82b-4241-a881-8248fdfe9bdc",
              name: "SET_PROJECT_STATUS",
              description: "",
              schema:
                "input SetProjectStatusInput {\n  status: ProjectStatus!\n}",
              template: "",
              reducer: "state.status = action.input.status;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "aacb7f3a-5637-46a5-8725-56516d22f0bc",
              name: "SET_OWNER",
              description: "",
              schema: "input SetOwnerInput {\n  owner: String\n}",
              template: "",
              reducer: "state.owner = action.input.owner || null;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "f835997f-6c29-442f-b8f4-45689e3d8076",
              name: "SET_TARGET_DATE",
              description: "",
              schema: "input SetTargetDateInput {\n  targetDate: Date\n}",
              template: "",
              reducer: "state.targetDate = action.input.targetDate || null;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "d59cf805-ada0-4e71-ae48-f6b41ca91d0e",
              name: "LINK_WBS",
              description: "",
              schema: "input LinkWbsInput {\n  wbsRef: PHID\n}",
              template: "",
              reducer: "state.wbsRef = action.input.wbsRef || null;",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "a75bbf0c-1984-45da-86ef-17c6ffaee56d",
          name: "team",
          description: "",
          operations: [
            {
              id: "03ec2049-94dd-4b6e-9a47-ded5ff6a39b2",
              name: "ADD_MEMBER",
              description: "",
              schema:
                "input AddMemberInput {\n  id: OID!\n  name: String!\n  role: String\n  kind: MemberKind\n}",
              template: "",
              reducer:
                'if (state.team.some((m) => m.id === action.input.id))\n  throw new DuplicateMemberError("Member already exists");\nstate.team.push({\n  id: action.input.id, name: action.input.name,\n  role: action.input.role || null, kind: action.input.kind || null,\n});',
              errors: [
                {
                  id: "41bf1e0d-6814-48b3-a8eb-1bf98f640bf6",
                  name: "DuplicateMemberError",
                  code: "DUPLICATE_MEMBER",
                  description: "A team member with this id already exists",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "269e3429-3a3d-40e6-aca2-b39a93d34291",
              name: "UPDATE_MEMBER",
              description: "",
              schema:
                "input UpdateMemberInput {\n  id: OID!\n  name: String\n  role: String\n  kind: MemberKind\n}",
              template: "",
              reducer:
                'const m = state.team.find((m) => m.id === action.input.id);\nif (!m) throw new MemberNotFoundError("Member not found");\nif (action.input.name) m.name = action.input.name;\nif (action.input.role) m.role = action.input.role;\nif (action.input.kind) m.kind = action.input.kind;',
              errors: [
                {
                  id: "4445ba38-89a8-4f65-80f1-6faca0e69d48",
                  name: "MemberNotFoundError",
                  code: "MEMBER_NOT_FOUND",
                  description: "No team member with this id",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "45c56801-9123-4f7c-a249-ef933c637cf2",
              name: "REMOVE_MEMBER",
              description: "",
              schema: "input RemoveMemberInput {\n  id: OID!\n}",
              template: "",
              reducer:
                'const i = state.team.findIndex((m) => m.id === action.input.id);\nif (i === -1) throw new MemberNotFoundError("Member not found");\nstate.team.splice(i, 1);',
              errors: [
                {
                  id: "bef93688-0451-4af0-9edd-f00048452743",
                  name: "MemberNotFoundError",
                  code: "MEMBER_NOT_FOUND",
                  description: "No team member with this id",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "a573f3c6-0a37-4674-a2f7-f088c5b4593a",
          name: "deliverables",
          description: "",
          operations: [
            {
              id: "1242f9ae-8b2b-47d4-92c6-b1702718202f",
              name: "ADD_DELIVERABLE",
              description: "",
              schema:
                "input AddDeliverableInput {\n  id: OID!\n  title: String!\n  description: String\n  goalRef: OID\n  url: URL\n}",
              template: "",
              reducer:
                'if (state.deliverables.some((d) => d.id === action.input.id))\n  throw new DuplicateDeliverableError("Deliverable already exists");\nstate.deliverables.push({\n  id: action.input.id, title: action.input.title,\n  description: action.input.description || null, status: "PLANNED",\n  goalRef: action.input.goalRef || null, url: action.input.url || null,\n  deliveredAt: null,\n});',
              errors: [
                {
                  id: "8215bf93-aa9a-44bd-8e08-97611d0418a6",
                  name: "DuplicateDeliverableError",
                  code: "DUPLICATE_DELIVERABLE",
                  description: "A deliverable with this id already exists",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "ce8bd1a8-6011-4d95-a88d-c8a4cb6c950e",
              name: "UPDATE_DELIVERABLE",
              description: "",
              schema:
                "input UpdateDeliverableInput {\n  id: OID!\n  title: String\n  description: String\n  goalRef: OID\n  url: URL\n}",
              template: "",
              reducer:
                'const d = state.deliverables.find((d) => d.id === action.input.id);\nif (!d) throw new DeliverableNotFoundError("Deliverable not found");\nif (action.input.title) d.title = action.input.title;\nif (action.input.description) d.description = action.input.description;\nif (action.input.goalRef) d.goalRef = action.input.goalRef;\nif (action.input.url) d.url = action.input.url;',
              errors: [
                {
                  id: "ca863f7b-de6a-4e24-adf8-9f3d16385b3f",
                  name: "DeliverableNotFoundError",
                  code: "DELIVERABLE_NOT_FOUND",
                  description: "No deliverable with this id",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "4c7ac60b-2891-4cfd-803d-d282f3c10abf",
              name: "SET_DELIVERABLE_STATUS",
              description: "",
              schema:
                "input SetDeliverableStatusInput {\n  id: OID!\n  status: DeliverableStatus!\n  deliveredAt: DateTime\n}",
              template: "",
              reducer:
                'const d = state.deliverables.find((d) => d.id === action.input.id);\nif (!d) throw new DeliverableNotFoundError("Deliverable not found");\nd.status = action.input.status;\nd.deliveredAt = action.input.status === "DELIVERED"\n  ? action.input.deliveredAt || d.deliveredAt || null\n  : null;',
              errors: [
                {
                  id: "61d26f67-721b-4ad6-a104-a3a9d993f6e2",
                  name: "DeliverableNotFoundError",
                  code: "DELIVERABLE_NOT_FOUND",
                  description: "No deliverable with this id",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "cc7ae471-f4c1-48c5-82a8-8ae0ebf7c2a5",
              name: "REMOVE_DELIVERABLE",
              description: "",
              schema: "input RemoveDeliverableInput {\n  id: OID!\n}",
              template: "",
              reducer:
                'const i = state.deliverables.findIndex((d) => d.id === action.input.id);\nif (i === -1) throw new DeliverableNotFoundError("Deliverable not found");\nstate.deliverables.splice(i, 1);',
              errors: [
                {
                  id: "996307e8-4a3a-4e24-98bc-7ef6bbd2d931",
                  name: "DeliverableNotFoundError",
                  code: "DELIVERABLE_NOT_FOUND",
                  description: "No deliverable with this id",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "314ff230-de6a-4454-bc58-cfa8af373448",
          name: "knowledge",
          description: "",
          operations: [
            {
              id: "19329ef0-8eb2-43d9-a20f-cac1ccdd2eb7",
              name: "ADD_KNOWLEDGE_REF",
              description: "",
              schema: "input AddKnowledgeRefInput {\n  ref: PHID!\n}",
              template: "",
              reducer:
                'if (state.knowledgeRefs.includes(action.input.ref))\n  throw new DuplicateKnowledgeRefError("Knowledge ref already linked");\nstate.knowledgeRefs.push(action.input.ref);',
              errors: [
                {
                  id: "426c4c2c-8c65-4b85-a78f-8f7b1b3a29c6",
                  name: "DuplicateKnowledgeRefError",
                  code: "DUPLICATE_KNOWLEDGE_REF",
                  description: "This knowledge ref is already linked",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "2d74160d-8e68-4d50-8ad8-6a26dedec899",
              name: "REMOVE_KNOWLEDGE_REF",
              description: "",
              schema: "input RemoveKnowledgeRefInput {\n  ref: PHID!\n}",
              template: "",
              reducer:
                'const i = state.knowledgeRefs.indexOf(action.input.ref);\nif (i === -1) throw new KnowledgeRefNotFoundError("Knowledge ref not linked");\nstate.knowledgeRefs.splice(i, 1);',
              errors: [
                {
                  id: "f3e0da09-65ba-4a70-a585-79f9f6eed857",
                  name: "KnowledgeRefNotFoundError",
                  code: "KNOWLEDGE_REF_NOT_FOUND",
                  description: "This knowledge ref is not linked",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "9835ab0c-7c8b-4c21-94ea-2b311d41a74b",
              name: "SET_REFERENCES",
              description: "",
              schema: "input SetReferencesInput {\n  references: [URL!]!\n}",
              template: "",
              reducer: "state.references = action.input.references;",
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
