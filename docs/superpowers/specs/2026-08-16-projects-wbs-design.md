# Projects & WBS in the Knowledge Vault — Design

**Date:** 2026-08-16
**Status:** Approved design, pending implementation plan
**Owner:** liberuum + knowledge-agent

## Goal

Add project/task management to the Knowledge Vault drive app: a **Projects** tab in the
top nav showing every project agents/teams are working on, each with its Work Breakdown
Structure (WBS), statuses, deliverables, team, and links into the vault's knowledge.
Humans use the editors; agents read/write the same documents via MCP / GraphQL /
Switchboard CLI. Every change is a document operation, so the full history is visible.

Keeping projects in the same drive as the knowledge is the point: an agent working a
goal can query the stack knowledge (semantic search, notes, MOCs) from the drive it is
already operating on, and a project can cite the knowledge it builds on.

## Non-goals

- **No agent-rupert logic.** No workId/SKILL-SCENARIO-TASK conventions, no skills-repo
  coupling, no draft gating, no delegation/report-review handshake, no agent runtime.
  (Studied upstream `@powerhousedao/agent-manager` + `ph-clint/prototypes/library` and
  deliberately dropped these; upstream `powerhouse/agent-projects` is a dev-process
  supervisor and is not reused at all.)
- No automatic status cascades in reducers — statuses change only by explicit operation;
  progress rollups are computed in the UI.
- No custom subgraph in v1 (client-side rollups; generic document GraphQL is enough).
- No DocumentRelationship edges for projects in v1 (`knowledgeRefs` PHIDs in state).
- No drag-and-drop reordering in v1 (move up/down buttons dispatching REORDER).

## Document model 1: `bai/project`

One document per project (extension `.proj`, name "Project"). Doc-per-project gives
per-project operation history, drive-tree presence, and `setSelectedNode` navigation —
same pattern as `bai/source`.

### State (global)

```graphql
type ProjectState {
  name: String
  description: String
  status: ProjectStatus!        # default PLANNING
  owner: String                 # responsible human/agent
  targetDate: Date
  wbsRef: PHID                  # the project's WBS document
  team: [TeamMember!]!
  deliverables: [Deliverable!]!
  knowledgeRefs: [PHID!]!       # notes/MOCs this project builds on
  references: [URL!]!           # repo, PRs, external docs
  createdAt: DateTime
}

enum ProjectStatus { PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED }

type TeamMember { id: OID!  name: String!  role: String  kind: MemberKind }
enum MemberKind { HUMAN AGENT }

type Deliverable {
  id: OID!
  title: String!
  description: String
  status: DeliverableStatus!    # default PLANNED
  goalRef: OID                  # optional: WBS goal that produces it
  url: URL                      # where the artifact lives
  deliveredAt: DateTime
}
enum DeliverableStatus { PLANNED IN_PROGRESS DELIVERED CANCELLED }
```

No `updatedAt` in state — `header.lastModified` already provides it.

### Operations (4 modules, 16 ops)

**lifecycle**
| Op | Input | Errors |
|---|---|---|
| CREATE_PROJECT | `{ name!, description, owner, status, createdAt! }` | ALREADY_INITIALIZED (name already set) |
| UPDATE_PROJECT_INFO | `{ name, description }` | — |
| SET_PROJECT_STATUS | `{ status! }` | — |
| SET_OWNER | `{ owner }` (null clears) | — |
| SET_TARGET_DATE | `{ targetDate }` (null clears) | — |
| LINK_WBS | `{ wbsRef }` (null unlinks) | — |

**team**
| Op | Input | Errors |
|---|---|---|
| ADD_MEMBER | `{ id!, name!, role, kind }` | DUPLICATE_MEMBER |
| UPDATE_MEMBER | `{ id!, name, role, kind }` | MEMBER_NOT_FOUND |
| REMOVE_MEMBER | `{ id! }` | MEMBER_NOT_FOUND |

**deliverables**
| Op | Input | Errors |
|---|---|---|
| ADD_DELIVERABLE | `{ id!, title!, description, goalRef, url }` | DUPLICATE_DELIVERABLE |
| UPDATE_DELIVERABLE | `{ id!, title, description, goalRef, url }` | DELIVERABLE_NOT_FOUND |
| SET_DELIVERABLE_STATUS | `{ id!, status!, deliveredAt }` | DELIVERABLE_NOT_FOUND |
| REMOVE_DELIVERABLE | `{ id! }` | DELIVERABLE_NOT_FOUND |

**knowledge**
| Op | Input | Errors |
|---|---|---|
| ADD_KNOWLEDGE_REF | `{ ref! }` | DUPLICATE_KNOWLEDGE_REF |
| REMOVE_KNOWLEDGE_REF | `{ ref! }` | KNOWLEDGE_REF_NOT_FOUND |
| SET_REFERENCES | `{ references! }` | — |

## Document model 2: `bai/wbs`

Extension `.wbs`, name "Work Breakdown Structure" (state type
`WorkBreakdownStructureState`). Flat goal list, tree via `parentId`, array order is
sibling order (kept depth-first: parents before their children — port of the
`sortGoalsDepthFirst` invariant, which is generic tree bookkeeping, not agent logic).

### State (global)

```graphql
type WorkBreakdownStructureState {
  projectRef: PHID              # back-link to its project
  owner: String
  goals: [Goal!]!
  references: [URL!]!
}

type Goal {
  id: OID!
  description: String!
  status: GoalStatus!           # default TODO
  parentId: OID                 # null = root
  assignee: String              # human or agent name
  dependencies: [OID!]!         # other goal ids
  blockReason: String           # required when BLOCKED, cleared otherwise
  outcome: String               # deliverable/result text or URL
  notes: [Note!]!               # append-only progress commentary
}
enum GoalStatus { TODO IN_PROGRESS BLOCKED IN_REVIEW COMPLETED WONT_DO }

type Note { id: OID!  note: String!  author: String  timestamp: DateTime }
```

### Operations (3 modules, 14 ops)

**goals**
| Op | Input | Errors |
|---|---|---|
| CREATE_GOAL | `{ id!, description!, parentId, assignee, insertBefore }` — without `insertBefore`, appended as last child of `parentId` (or last root) | DUPLICATE_GOAL_ID, GOAL_NOT_FOUND (parent/insertBefore) |
| UPDATE_GOAL_DESCRIPTION | `{ id!, description! }` | GOAL_NOT_FOUND |
| DELETE_GOAL | `{ id! }` — removes subtree + dangling dependency refs | GOAL_NOT_FOUND |
| REORDER | `{ id!, parentId, insertBefore }` | GOAL_NOT_FOUND, INVALID_PARENT (self/descendant cycle) |

**workflow**
| Op | Input | Errors |
|---|---|---|
| SET_GOAL_STATUS | `{ id!, status!, blockReason, outcome }` — BLOCKED requires blockReason; blockReason cleared on non-BLOCKED; outcome stored if provided (typically with COMPLETED) | GOAL_NOT_FOUND, MISSING_BLOCK_REASON |
| ASSIGN_GOAL | `{ id!, assignee }` (null unassigns) | GOAL_NOT_FOUND |
| SET_OUTCOME | `{ id!, outcome }` (null clears) | GOAL_NOT_FOUND |
| ADD_DEPENDENCIES | `{ id!, dependencies! }` | GOAL_NOT_FOUND, DEPENDENCY_NOT_FOUND, INVALID_DEPENDENCY (self) |
| REMOVE_DEPENDENCIES | `{ id!, dependencies! }` | GOAL_NOT_FOUND |

**documentation**
| Op | Input | Errors |
|---|---|---|
| ADD_NOTE | `{ goalId!, noteId!, note!, author, timestamp }` | GOAL_NOT_FOUND, DUPLICATE_NOTE_ID |
| REMOVE_NOTE | `{ goalId!, noteId! }` | GOAL_NOT_FOUND, NOTE_NOT_FOUND |
| SET_OWNER | `{ owner }` | — |
| SET_REFERENCES | `{ references! }` | — |
| SET_PROJECT_REF | `{ projectRef }` | — |

## UI

All new UI uses the existing `--bai-*` token theme (dark Catppuccin / light neutral),
the established radius/type ladder, and the SourceList/NoteList component patterns.

### Projects tab (knowledge-vault drive app)

- `"projects"` added to `ViewMode` and the `TABS` array in
  `editors/knowledge-vault/components/DriveExplorer.tsx` (briefcase icon, badge =
  non-archived project count) with a content branch rendering `<ProjectsView />`.
- **`components/ProjectsView.tsx`**: reads drive docs via `useDocumentsInSelectedDrive`,
  filters `bai/project`, joins `wbsRef` against `bai/wbs` docs from the same hook.
  Collapsible status groups with counts (ACTIVE, PLANNING, ON_HOLD, COMPLETED,
  ARCHIVED). Project card: name, status pill, owner, team chips (HUMAN/AGENT aware),
  progress bar (finished goals / total), blocked-goal warning badge, deliverables
  delivered/total, targetDate, lastModified. Click → `setSelectedNode(projectId)`.
- **New Project** button → dialog (name only — `addDocument` can set nothing else) →
  doc created in `/projects/` → opens project editor, which shows a one-time init card
  (name pre-filled from header, plus description/owner/status fields) dispatching
  `CREATE_PROJECT`.

### Project editor (`editors/project-editor/`, documentType `bai/project`)

`DocumentToolbar` on top. Sections:
- Header: inline name edit, status dropdown, owner, targetDate.
- WBS panel: linked → per-status chips, progress bar, blocked goals, "Open WBS"
  (`setSelectedNode(wbsRef)`); unlinked → "Create WBS" (`addDocument(bai/wbs)` +
  `LINK_WBS` + `SET_PROJECT_REF` on the new doc via
  `useWorkBreakdownStructureDocumentById`).
- Deliverables table: title, status pill, linked goal status/outcome, url; add/edit/
  remove/status ops inline.
- Team: rows with name, role, HUMAN/AGENT badge; add/remove.
- Knowledge: linked notes/MOCs with resolved titles, add via the existing subgraph
  search hook, remove.
- References: URL list.

### WBS editor (`editors/wbs-editor/`, documentType `bai/wbs`)

- Own tree table (no external grid dep): indent by depth, expand/collapse; columns
  description / status chip / assignee / note count. Row actions: add child, move
  up/down (REORDER + insertBefore), delete with subtree confirm.
- Status chip menu grouped waiting (TODO, BLOCKED) / active (IN_PROGRESS, IN_REVIEW) /
  finished (COMPLETED, WONT_DO); BLOCKED prompts for reason; COMPLETED offers outcome.
- Right-rail goal detail on row select: description, assignee, dependencies picker,
  outcome, notes thread (author + Ctrl+Enter).
- Header: owner, "Part of project X" breadcrumb via `projectRef`, references,
  progress summary.

### App plumbing

- `editors/knowledge-vault/config.ts`: `allowedDocumentTypes` += `bai/project`,
  `bai/wbs`.
- `CreateDocumentDialog.tsx` folder map += both types → `/projects/`.
- `hooks/use-drive-init.ts`: seed `/projects/` folder idempotently.

## Agent access

Free once the models are deployed — no bespoke API:
- **CLI**: `switchboard docs create --type bai/project …`, `docs mutate --op createGoal
  / setGoalStatus / addNote …`, `docs get --state`.
- **GraphQL**: auto-generated namespaced document mutations + document/drive queries.
- **MCP**: `getDocument` / `addActions`.
- **Plugin** (`powerhouse-knowledge` repo): new skill `/powerhouse-knowledge:projects`
  documenting the models and the goal-working loop (IN_PROGRESS → work → ADD_NOTE →
  COMPLETED with outcome → tick linked deliverable); `/projects/` added to folder
  tables in AGENT.md / knowledge-agent.md.

Graph indexer, embedder, and health checks ignore the new document types (they filter
on knowledge types) — no interference.

## Implementation constraints

- Models and editor documents are created on the Vetra drive **`vetra-dfa9f5f8`** via
  reactor-mcp (`ph vetra` running); codegen emits `document-models/…` and editor
  shells. Never hand-edit `<name>.json` / `schema.graphql`. Two-phase editor flow
  (editor doc confirmed → codegen → implement UI). After codegen: `git diff
  document-models/` to confirm only intended changes.
- Reducers: pure, all ids/timestamps from inputs, `InputMaybe` handling per repo
  conventions, errors thrown by name.
- Reducer test coverage ≥ 95% (scenario tests + every error branch).
- `bun run tsc`, `bun run lint:fix`, `bun run test:coverage` green before ship.

## Rollout

1. Implement + test locally (`ph vetra`, localhost replica drive).
2. Seed one real sample project + WBS via CLI to prove the agent path end-to-end.
3. Version bump, `ph publish`, deploy remote (light-colt), re-verify.
4. Plugin skill update ships alongside.
