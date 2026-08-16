# Projects & WBS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bai/project` + `bai/wbs` document models, their editors, and a Projects tab to the Knowledge Vault drive app, so humans and agents manage projects/WBS as documents in the same drive as the knowledge.

**Architecture:** Two new document models created on the Vetra drive (codegen emits all boilerplate), pure reducers implemented TDD in `src/`, two document editors (vault-themed), one new drive-app tab reading via `useDocumentsInSelectedDrive`. No custom subgraph, no processors, no status cascades. Spec: `docs/superpowers/specs/2026-08-16-projects-wbs-design.md`.

**Tech Stack:** Powerhouse 6.2.2-dev.47 (document-model, reactor-browser, ph-cli/vetra codegen), React 19, Tailwind 4 + `--bai-*` CSS tokens, vitest, switchboard CLI, reactor-mcp.

## Global Constraints

- **Vetra flow only:** models + editor documents are created on drive **`vetra-dfa9f5f8`** (local `ph vetra` must be running — ask the user, never start it yourself). NEVER hand-edit `document-models/<name>/<name>.json`, `schema.graphql`, or anything in `gen/`.
- After every codegen run: `git diff document-models/ editors/` and confirm only intended changes (imported/stale documents can revert unrelated code — see CLAUDE.md).
- **Use `bun`, not npm**: `bun run tsc`, `bun run lint:fix`, `bunx vitest run --coverage`.
- Reducers: pure & synchronous; every id/timestamp from `action.input`; `InputMaybe` handling with `|| null` / truthy checks; errors thrown by bare name (`throw new GoalNotFoundError("…")`, no imports).
- Reducer coverage ≥ **95%** lines/branches/functions/statements for both new models. Error tests use the operation-index pattern (`operations.global[i].error`), NEVER `.toThrow()`.
- Editor code: import document-model symbols ONLY from top-level barrels (`document-models/project`, `document-models/work-breakdown-structure`); relative imports carry `.js`; no `@/*` alias; every document editor renders `<DocumentToolbar />` first.
- UI theme: `--bai-*` CSS variables via inline `style` + Tailwind for layout only; radius ladder `rounded-md/lg/xl/2xl`; status pills use the `bg-<color>-500/20 text-<color>-300 border-<color>-500/30` recipe. Match `SourceList.tsx` / `NoteList.tsx` patterns.
- Document type ids: `bai/project` (ext `.proj`, name "Project"), `bai/wbs` (ext `.wbs`, name "Work Breakdown Structure").
- All GraphQL timestamps Z-suffixed ISO (`new Date().toISOString()` / `gql._now_iso()`).
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Pre-flight — vetra connectivity + operation input shapes

**Files:**
- Create: `/tmp/projects-wbs/` (scratch dir for action payloads)

**Interfaces:**
- Produces: confirmed reachable vetra drive slug `vetra-dfa9f5f8`; confirmed input shapes for `powerhouse/document-model` operations (`ADD_MODULE`, `ADD_OPERATION`, `SET_OPERATION_SCHEMA`, `ADD_OPERATION_ERROR`, `SET_STATE_SCHEMA`, `SET_INITIAL_STATE`); the id of one existing document-model document as a shape reference.

- [ ] **Step 1: Verify the local reactor is up and the vetra drive exists**

```bash
mkdir -p /tmp/projects-wbs
switchboard config show            # must target http://localhost:4001/graphql — if not: ask user which profile, or `switchboard config use <local-profile>`
switchboard ping
switchboard drives list --format json | python3 -c "import json,sys; print([d['slug'] for d in json.load(sys.stdin)])"
```
Expected: list contains `vetra-dfa9f5f8`. If the reactor is down, STOP and ask the user to run `ph vetra --watch` in the repo.

- [ ] **Step 2: Confirm document-model operation input shapes**

If reactor-mcp is available: `mcp__reactor-mcp__getDocumentModelSchema({type: "powerhouse/document-model"})`.
CLI fallback — read an existing model document's operations to see real payload shapes:
```bash
switchboard docs tree vetra-dfa9f5f8 --format json | python3 -c "
import json,sys
for n in json.load(sys.stdin).get('nodes',[]):
    if n.get('documentType')=='powerhouse/document-model': print(n['id'], n['name'])"
```
Pick one model doc id, then `switchboard docs get <id> --format json | python3 -m json.tool | grep -A5 ADD_OPERATION | head -40`.
Record the exact field names for: `ADD_MODULE {id,name,description?}`, `ADD_OPERATION {id,moduleId,name}`, `SET_OPERATION_SCHEMA {id,schema}`, `ADD_OPERATION_ERROR {id,operationId,errorCode,errorName,errorDescription}`, `SET_STATE_SCHEMA {scope,schema}`, `SET_INITIAL_STATE {scope,initialValue}`. **If any differ from the payloads written in Tasks 2–3, adjust those payloads before dispatching.**

- [ ] **Step 3: Confirm the drive has no existing Project/WBS model docs** (idempotency): the tree listing from Step 2 must not contain models named `Project` or `Work Breakdown Structure`. If it does, STOP — resume from Task 4 instead of re-creating.

---

### Task 2: Create the `bai/project` document model on the vetra drive

**Files:**
- Create: `/tmp/projects-wbs/project-model-actions.json` (payload), generated output `document-models/project/` (by codegen — do not hand-create)

**Interfaces:**
- Consumes: input shapes from Task 1.
- Produces: document type `bai/project`; generated barrel `document-models/project` exporting `actions.{createProject,updateProjectInfo,setProjectStatus,setOwner,setTargetDate,linkWbs,addMember,updateMember,removeMember,addDeliverable,updateDeliverable,setDeliverableStatus,removeDeliverable,addKnowledgeRef,removeKnowledgeRef,setReferences}`, types `ProjectState`, hooks `useProjectDocumentById`, `useSelectedProjectDocument`, `useProjectDocumentsInSelectedDrive`; scaffolded reducer files `document-models/project/v1/src/reducers/{lifecycle,team,deliverables,knowledge}.ts`.

- [ ] **Step 1: Create the model document**

```bash
switchboard docs create --type powerhouse/document-model --name "Project" --drive vetra-dfa9f5f8 --format json
# capture <PROJECT_MODEL_ID> from output
```

- [ ] **Step 2: Build the action payload file**

Write `/tmp/projects-wbs/project-model-actions.json` with this Python script (generates uuids, embeds schemas verbatim from the spec). Module/op/error ids are fresh uuid4s; keep the emitted file for traceability.

```python
import json, uuid
uid = lambda: str(uuid.uuid4())

STATE_SCHEMA = """type ProjectState {
  name: String
  description: String
  status: ProjectStatus!
  owner: String
  targetDate: Date
  wbsRef: PHID
  team: [TeamMember!]!
  deliverables: [Deliverable!]!
  knowledgeRefs: [PHID!]!
  references: [URL!]!
  createdAt: DateTime
}

enum ProjectStatus { PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED }

type TeamMember { id: OID!  name: String!  role: String  kind: MemberKind }
enum MemberKind { HUMAN AGENT }

type Deliverable {
  id: OID!
  title: String!
  description: String
  status: DeliverableStatus!
  goalRef: OID
  url: URL
  deliveredAt: DateTime
}
enum DeliverableStatus { PLANNED IN_PROGRESS DELIVERED CANCELLED }"""

INITIAL_STATE = json.dumps({"name": None, "description": None, "status": "PLANNING",
  "owner": None, "targetDate": None, "wbsRef": None, "team": [], "deliverables": [],
  "knowledgeRefs": [], "references": [], "createdAt": None}, indent=2)

# (opName, inputSchema, [(errorCode, errorName, errorDescription), ...])
MODULES = {
  "lifecycle": [
    ("CREATE_PROJECT", "input CreateProjectInput {\n  name: String!\n  description: String\n  owner: String\n  status: ProjectStatus\n  createdAt: DateTime!\n}",
      [("ALREADY_INITIALIZED","AlreadyInitializedError","Project already initialized (name is set)")]),
    ("UPDATE_PROJECT_INFO", "input UpdateProjectInfoInput {\n  name: String\n  description: String\n}", []),
    ("SET_PROJECT_STATUS", "input SetProjectStatusInput {\n  status: ProjectStatus!\n}", []),
    ("SET_OWNER", "input SetOwnerInput {\n  owner: String\n}", []),
    ("SET_TARGET_DATE", "input SetTargetDateInput {\n  targetDate: Date\n}", []),
    ("LINK_WBS", "input LinkWbsInput {\n  wbsRef: PHID\n}", []),
  ],
  "team": [
    ("ADD_MEMBER", "input AddMemberInput {\n  id: OID!\n  name: String!\n  role: String\n  kind: MemberKind\n}",
      [("DUPLICATE_MEMBER","DuplicateMemberError","A team member with this id already exists")]),
    ("UPDATE_MEMBER", "input UpdateMemberInput {\n  id: OID!\n  name: String\n  role: String\n  kind: MemberKind\n}",
      [("MEMBER_NOT_FOUND","MemberNotFoundError","No team member with this id")]),
    ("REMOVE_MEMBER", "input RemoveMemberInput {\n  id: OID!\n}",
      [("MEMBER_NOT_FOUND","MemberNotFoundError","No team member with this id")]),
  ],
  "deliverables": [
    ("ADD_DELIVERABLE", "input AddDeliverableInput {\n  id: OID!\n  title: String!\n  description: String\n  goalRef: OID\n  url: URL\n}",
      [("DUPLICATE_DELIVERABLE","DuplicateDeliverableError","A deliverable with this id already exists")]),
    ("UPDATE_DELIVERABLE", "input UpdateDeliverableInput {\n  id: OID!\n  title: String\n  description: String\n  goalRef: OID\n  url: URL\n}",
      [("DELIVERABLE_NOT_FOUND","DeliverableNotFoundError","No deliverable with this id")]),
    ("SET_DELIVERABLE_STATUS", "input SetDeliverableStatusInput {\n  id: OID!\n  status: DeliverableStatus!\n  deliveredAt: DateTime\n}",
      [("DELIVERABLE_NOT_FOUND","DeliverableNotFoundError","No deliverable with this id")]),
    ("REMOVE_DELIVERABLE", "input RemoveDeliverableInput {\n  id: OID!\n}",
      [("DELIVERABLE_NOT_FOUND","DeliverableNotFoundError","No deliverable with this id")]),
  ],
  "knowledge": [
    ("ADD_KNOWLEDGE_REF", "input AddKnowledgeRefInput {\n  ref: PHID!\n}",
      [("DUPLICATE_KNOWLEDGE_REF","DuplicateKnowledgeRefError","This knowledge ref is already linked")]),
    ("REMOVE_KNOWLEDGE_REF", "input RemoveKnowledgeRefInput {\n  ref: PHID!\n}",
      [("KNOWLEDGE_REF_NOT_FOUND","KnowledgeRefNotFoundError","This knowledge ref is not linked")]),
    ("SET_REFERENCES", "input SetReferencesInput {\n  references: [URL!]!\n}", []),
  ],
}

actions = [
  {"type":"SET_MODEL_ID","input":{"id":"bai/project"},"scope":"global"},
  {"type":"SET_MODEL_NAME","input":{"name":"Project"},"scope":"global"},
  {"type":"SET_MODEL_EXTENSION","input":{"extension":".proj"},"scope":"global"},
  {"type":"SET_MODEL_DESCRIPTION","input":{"description":"A project managed in the Knowledge Vault: status, owner, team, deliverables, links to its Work Breakdown Structure and to the knowledge it builds on."},"scope":"global"},
  {"type":"SET_AUTHOR_NAME","input":{"authorName":"BAI"},"scope":"global"},
  {"type":"SET_STATE_SCHEMA","input":{"scope":"global","schema":STATE_SCHEMA},"scope":"global"},
  {"type":"SET_INITIAL_STATE","input":{"scope":"global","initialValue":INITIAL_STATE},"scope":"global"},
]
for mod_name, ops in MODULES.items():
    mid = uid()
    actions.append({"type":"ADD_MODULE","input":{"id":mid,"name":mod_name},"scope":"global"})
    for op_name, schema, errors in ops:
        oid = uid()
        actions.append({"type":"ADD_OPERATION","input":{"id":oid,"moduleId":mid,"name":op_name},"scope":"global"})
        actions.append({"type":"SET_OPERATION_SCHEMA","input":{"id":oid,"schema":schema},"scope":"global"})
        for code,name,desc in errors:
            actions.append({"type":"ADD_OPERATION_ERROR","input":{"id":uid(),"operationId":oid,"errorCode":code,"errorName":name,"errorDescription":desc},"scope":"global"})

open("/tmp/projects-wbs/project-model-actions.json","w").write(json.dumps(actions, indent=1))
print(len(actions), "actions")
```
Expected: `~60 actions`.

- [ ] **Step 3: Dispatch** — `switchboard docs apply <PROJECT_MODEL_ID> --file /tmp/projects-wbs/project-model-actions.json --wait`
  (If `docs apply` reverses order on this deployment — known CLI gotcha — dispatch in chunks per module with separate `apply` calls, or one `docs mutate` per action. Verify order in the next step regardless.)

- [ ] **Step 4: Verify the model document state** — `switchboard docs get <PROJECT_MODEL_ID> --state --format json | python3 -c "import json,sys; d=json.load(sys.stdin); spec=d['state']['global']['specifications'][0]; print([m['name'] for m in spec['modules']], sum(len(m['operations']) for m in spec['modules']))"`
  Expected: 4 modules, 16 operations. If the model has a draft/status flag in state, dispatch the confirm/publish action per the document-model schema (same requirement as editors — codegen skips drafts).

- [ ] **Step 5: Wait for codegen, then inspect** — with `ph vetra --watch` running, codegen writes the files. Then:
```bash
ls document-models/project/v1/src/reducers/   # expect lifecycle.ts team.ts deliverables.ts knowledge.ts
git diff --stat document-models/ | tail -5    # ONLY document-models/project/** may appear
bun run tsc                                   # scaffold compiles (reducers are empty stubs)
```
If codegen didn't run: check the vetra terminal output with the user; the doc may still be draft.

- [ ] **Step 6: Commit** — `git add document-models/project docs && git commit -m "feat(models): scaffold bai/project document model via vetra codegen"`

---

### Task 3: Create the `bai/wbs` document model on the vetra drive

**Files:**
- Create: `/tmp/projects-wbs/wbs-model-actions.json`; generated output `document-models/work-breakdown-structure/`

**Interfaces:**
- Consumes: input shapes from Task 1.
- Produces: document type `bai/wbs`; barrel `document-models/work-breakdown-structure` exporting `actions.{createGoal,updateGoalDescription,deleteGoal,reorder,setGoalStatus,assignGoal,setOutcome,addDependencies,removeDependencies,addNote,removeNote,setOwner,setReferences,setProjectRef}`, types `WorkBreakdownStructureState`, `Goal`, `GoalStatus`, hooks `useWorkBreakdownStructureDocumentById` etc.; scaffolded reducers `v1/src/reducers/{goals,workflow,documentation}.ts`.

- [ ] **Step 1: Create the model document** — `switchboard docs create --type powerhouse/document-model --name "Work Breakdown Structure" --drive vetra-dfa9f5f8 --format json` → capture `<WBS_MODEL_ID>`.

- [ ] **Step 2: Build the payload** — same script shape as Task 2 Step 2 with these values:

```python
STATE_SCHEMA = """type WorkBreakdownStructureState {
  projectRef: PHID
  owner: String
  goals: [Goal!]!
  references: [URL!]!
}

type Goal {
  id: OID!
  description: String!
  status: GoalStatus!
  parentId: OID
  assignee: String
  dependencies: [OID!]!
  blockReason: String
  outcome: String
  notes: [Note!]!
}
enum GoalStatus { TODO IN_PROGRESS BLOCKED IN_REVIEW COMPLETED WONT_DO }

type Note { id: OID!  note: String!  author: String  timestamp: DateTime }"""

INITIAL_STATE = json.dumps({"projectRef": None, "owner": None, "goals": [], "references": []}, indent=2)

MODULES = {
  "goals": [
    ("CREATE_GOAL", "input CreateGoalInput {\n  id: OID!\n  description: String!\n  parentId: OID\n  assignee: String\n  insertBefore: OID\n}",
      [("DUPLICATE_GOAL_ID","DuplicateGoalIdError","A goal with this id already exists"),
       ("GOAL_NOT_FOUND","GoalNotFoundError","Referenced goal (parent or insertBefore) not found")]),
    ("UPDATE_GOAL_DESCRIPTION", "input UpdateGoalDescriptionInput {\n  id: OID!\n  description: String!\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id")]),
    ("DELETE_GOAL", "input DeleteGoalInput {\n  id: OID!\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id")]),
    ("REORDER", "input ReorderInput {\n  id: OID!\n  parentId: OID\n  insertBefore: OID\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id (or insertBefore target missing)"),
       ("INVALID_PARENT","InvalidParentError","parentId is the goal itself or one of its descendants")]),
  ],
  "workflow": [
    ("SET_GOAL_STATUS", "input SetGoalStatusInput {\n  id: OID!\n  status: GoalStatus!\n  blockReason: String\n  outcome: String\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id"),
       ("MISSING_BLOCK_REASON","MissingBlockReasonError","status BLOCKED requires a non-empty blockReason")]),
    ("ASSIGN_GOAL", "input AssignGoalInput {\n  id: OID!\n  assignee: String\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id")]),
    ("SET_OUTCOME", "input SetOutcomeInput {\n  id: OID!\n  outcome: String\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id")]),
    ("ADD_DEPENDENCIES", "input AddDependenciesInput {\n  id: OID!\n  dependencies: [OID!]!\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id"),
       ("DEPENDENCY_NOT_FOUND","DependencyNotFoundError","A dependency id does not exist in this WBS"),
       ("INVALID_DEPENDENCY","InvalidDependencyError","A goal cannot depend on itself")]),
    ("REMOVE_DEPENDENCIES", "input RemoveDependenciesInput {\n  id: OID!\n  dependencies: [OID!]!\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id")]),
  ],
  "documentation": [
    ("ADD_NOTE", "input AddNoteInput {\n  goalId: OID!\n  noteId: OID!\n  note: String!\n  author: String\n  timestamp: DateTime\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id"),
       ("DUPLICATE_NOTE_ID","DuplicateNoteIdError","A note with this id already exists on the goal")]),
    ("REMOVE_NOTE", "input RemoveNoteInput {\n  goalId: OID!\n  noteId: OID!\n}",
      [("GOAL_NOT_FOUND","GoalNotFoundError","No goal with this id"),
       ("NOTE_NOT_FOUND","NoteNotFoundError","No note with this id on the goal")]),
    ("SET_OWNER", "input SetOwnerInput {\n  owner: String\n}", []),
    ("SET_REFERENCES", "input SetReferencesInput {\n  references: [URL!]!\n}", []),
    ("SET_PROJECT_REF", "input SetProjectRefInput {\n  projectRef: PHID\n}", []),
  ],
}
```
Model header actions: `SET_MODEL_ID` = `bai/wbs`, `SET_MODEL_NAME` = `Work Breakdown Structure`, `SET_MODEL_EXTENSION` = `.wbs`, `SET_MODEL_DESCRIPTION` = `"A hierarchy of goals for a project: statuses, assignees, dependencies, block reasons, outcomes and notes. No automatic cascades — every change is an explicit operation."`, `SET_AUTHOR_NAME` = `BAI`.

- [ ] **Step 3: Dispatch** — `switchboard docs apply <WBS_MODEL_ID> --file /tmp/projects-wbs/wbs-model-actions.json --wait`
- [ ] **Step 4: Verify** — same check as Task 2 Step 4. Expected: 3 modules, 14 operations.
- [ ] **Step 5: Codegen check** — `ls document-models/work-breakdown-structure/v1/src/reducers/` → `goals.ts workflow.ts documentation.ts`; `git diff --stat document-models/`; `bun run tsc`.
- [ ] **Step 6: Commit** — `git add document-models/work-breakdown-structure && git commit -m "feat(models): scaffold bai/wbs document model via vetra codegen"`

---

### Task 4: `bai/project` reducers — TDD

**Files:**
- Modify: `document-models/project/v1/src/reducers/lifecycle.ts`, `team.ts`, `deliverables.ts`, `knowledge.ts` (fill scaffolded stubs)
- Test: `document-models/project/v1/tests/project-scenarios.test.ts` (new), `document-models/project/v1/tests/project-errors.test.ts` (new)

**Interfaces:**
- Consumes: barrel `document-models/project/v1` (actions, `utils.createDocument`, `reducer`, input schemas, `isProjectDocument`).
- Produces: working reducers for all 16 ops; behavior contract used by editors: `status` defaults to `PLANNING`; `CREATE_PROJECT` throws once initialized; `SET_DELIVERABLE_STATUS` clears `deliveredAt` unless status is `DELIVERED`.

- [ ] **Step 1: Write the scenario test (failing)** — `document-models/project/v1/tests/project-scenarios.test.ts`:

```typescript
import {
  addDeliverable, addKnowledgeRef, addMember, createProject, linkWbs,
  reducer, removeKnowledgeRef, removeMember, setDeliverableStatus,
  setOwner, setProjectStatus, setReferences, setTargetDate,
  updateDeliverable, updateMember, updateProjectInfo, utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

describe("project lifecycle scenario", () => {
  it("runs a full project flow", () => {
    let doc = utils.createDocument();
    expect(doc.state.global.status).toBe("PLANNING");

    doc = reducer(doc, createProject({
      name: "Vault Projects Tab", description: "Add PM to the vault",
      owner: "liberuum", createdAt: "2026-08-16T12:00:00.000Z",
    }));
    expect(doc.state.global.name).toBe("Vault Projects Tab");
    expect(doc.state.global.createdAt).toBe("2026-08-16T12:00:00.000Z");

    doc = reducer(doc, updateProjectInfo({ description: "Projects + WBS in the vault" }));
    expect(doc.state.global.description).toBe("Projects + WBS in the vault");
    expect(doc.state.global.name).toBe("Vault Projects Tab"); // untouched

    doc = reducer(doc, setProjectStatus({ status: "ACTIVE" }));
    doc = reducer(doc, setOwner({ owner: "knowledge-agent" }));
    doc = reducer(doc, setTargetDate({ targetDate: "2026-09-30" }));
    doc = reducer(doc, linkWbs({ wbsRef: "wbs-doc-1" }));
    expect(doc.state.global.status).toBe("ACTIVE");
    expect(doc.state.global.wbsRef).toBe("wbs-doc-1");

    doc = reducer(doc, addMember({ id: "m1", name: "liberuum", role: "lead", kind: "HUMAN" }));
    doc = reducer(doc, addMember({ id: "m2", name: "knowledge-agent", kind: "AGENT" }));
    doc = reducer(doc, updateMember({ id: "m2", role: "builder" }));
    doc = reducer(doc, removeMember({ id: "m1" }));
    expect(doc.state.global.team).toHaveLength(1);
    expect(doc.state.global.team[0]).toMatchObject({ id: "m2", role: "builder", kind: "AGENT" });

    doc = reducer(doc, addDeliverable({ id: "d1", title: "Projects tab", goalRef: "g1" }));
    doc = reducer(doc, updateDeliverable({ id: "d1", url: "https://github.com/x/pr/1" }));
    doc = reducer(doc, setDeliverableStatus({ id: "d1", status: "IN_PROGRESS" }));
    expect(doc.state.global.deliverables[0].deliveredAt).toBeNull();
    doc = reducer(doc, setDeliverableStatus({ id: "d1", status: "DELIVERED", deliveredAt: "2026-08-20T10:00:00.000Z" }));
    expect(doc.state.global.deliverables[0]).toMatchObject({
      status: "DELIVERED", deliveredAt: "2026-08-20T10:00:00.000Z", goalRef: "g1",
    });

    doc = reducer(doc, addKnowledgeRef({ ref: "note-123" }));
    doc = reducer(doc, removeKnowledgeRef({ ref: "note-123" }));
    expect(doc.state.global.knowledgeRefs).toEqual([]);
    doc = reducer(doc, setReferences({ references: ["https://github.com/x"] }));
    expect(doc.state.global.references).toEqual(["https://github.com/x"]);

    // clears via null
    doc = reducer(doc, setTargetDate({ targetDate: null }));
    doc = reducer(doc, linkWbs({ wbsRef: null }));
    expect(doc.state.global.targetDate).toBeNull();
    expect(doc.state.global.wbsRef).toBeNull();
  });
});
```

- [ ] **Step 2: Write the error test (failing)** — `document-models/project/v1/tests/project-errors.test.ts`. Operation-index pattern; every declared error covered:

```typescript
import {
  addDeliverable, addKnowledgeRef, addMember, createProject, reducer,
  removeDeliverable, removeKnowledgeRef, removeMember,
  setDeliverableStatus, updateDeliverable, updateMember, utils,
} from "document-models/project/v1";
import { describe, expect, it } from "vitest";

const init = () => reducer(utils.createDocument(), createProject({
  name: "P", createdAt: "2026-08-16T12:00:00.000Z",
}));

describe("project errors (state unchanged, error recorded)", () => {
  it("ALREADY_INITIALIZED on second createProject", () => {
    const doc = reducer(init(), createProject({ name: "Q", createdAt: "2026-08-16T13:00:00.000Z" }));
    expect(doc.operations.global[1].error).toMatch(/already initialized/i);
    expect(doc.state.global.name).toBe("P");
  });
  it("DUPLICATE_MEMBER", () => {
    let doc = reducer(init(), addMember({ id: "m1", name: "a" }));
    doc = reducer(doc, addMember({ id: "m1", name: "b" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.team).toHaveLength(1);
  });
  it("MEMBER_NOT_FOUND on update and remove", () => {
    let doc = reducer(init(), updateMember({ id: "nope", name: "x" }));
    expect(doc.operations.global[1].error).toBeTruthy();
    doc = reducer(doc, removeMember({ id: "nope" }));
    expect(doc.operations.global[2].error).toBeTruthy();
  });
  it("DUPLICATE_DELIVERABLE", () => {
    let doc = reducer(init(), addDeliverable({ id: "d1", title: "t" }));
    doc = reducer(doc, addDeliverable({ id: "d1", title: "t2" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.deliverables).toHaveLength(1);
  });
  it("DELIVERABLE_NOT_FOUND on update, setStatus, remove", () => {
    let doc = reducer(init(), updateDeliverable({ id: "nope", title: "x" }));
    expect(doc.operations.global[1].error).toBeTruthy();
    doc = reducer(doc, setDeliverableStatus({ id: "nope", status: "DELIVERED" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    doc = reducer(doc, removeDeliverable({ id: "nope" }));
    expect(doc.operations.global[3].error).toBeTruthy();
  });
  it("DUPLICATE_KNOWLEDGE_REF and KNOWLEDGE_REF_NOT_FOUND", () => {
    let doc = reducer(init(), addKnowledgeRef({ ref: "n1" }));
    doc = reducer(doc, addKnowledgeRef({ ref: "n1" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    doc = reducer(doc, removeKnowledgeRef({ ref: "n2" }));
    expect(doc.operations.global[3].error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail** — `bunx vitest run document-models/project` → failures (stub reducers do nothing).

- [ ] **Step 4: Implement the reducers**

`lifecycle.ts` (keep the scaffolded export name/type — fill the operation bodies):
```typescript
    createProjectOperation(state, action) {
      if (state.name) throw new AlreadyInitializedError("Project already initialized");
      state.name = action.input.name;
      state.description = action.input.description || null;
      state.owner = action.input.owner || null;
      if (action.input.status) state.status = action.input.status;
      state.createdAt = action.input.createdAt;
    },
    updateProjectInfoOperation(state, action) {
      if (action.input.name) state.name = action.input.name;
      if (action.input.description) state.description = action.input.description;
    },
    setProjectStatusOperation(state, action) { state.status = action.input.status; },
    setOwnerOperation(state, action) { state.owner = action.input.owner || null; },
    setTargetDateOperation(state, action) { state.targetDate = action.input.targetDate || null; },
    linkWbsOperation(state, action) { state.wbsRef = action.input.wbsRef || null; },
```

`team.ts`:
```typescript
    addMemberOperation(state, action) {
      if (state.team.some((m) => m.id === action.input.id))
        throw new DuplicateMemberError("Member already exists");
      state.team.push({
        id: action.input.id, name: action.input.name,
        role: action.input.role || null, kind: action.input.kind || null,
      });
    },
    updateMemberOperation(state, action) {
      const m = state.team.find((m) => m.id === action.input.id);
      if (!m) throw new MemberNotFoundError("Member not found");
      if (action.input.name) m.name = action.input.name;
      if (action.input.role) m.role = action.input.role;
      if (action.input.kind) m.kind = action.input.kind;
    },
    removeMemberOperation(state, action) {
      const i = state.team.findIndex((m) => m.id === action.input.id);
      if (i === -1) throw new MemberNotFoundError("Member not found");
      state.team.splice(i, 1);
    },
```

`deliverables.ts`:
```typescript
    addDeliverableOperation(state, action) {
      if (state.deliverables.some((d) => d.id === action.input.id))
        throw new DuplicateDeliverableError("Deliverable already exists");
      state.deliverables.push({
        id: action.input.id, title: action.input.title,
        description: action.input.description || null, status: "PLANNED",
        goalRef: action.input.goalRef || null, url: action.input.url || null,
        deliveredAt: null,
      });
    },
    updateDeliverableOperation(state, action) {
      const d = state.deliverables.find((d) => d.id === action.input.id);
      if (!d) throw new DeliverableNotFoundError("Deliverable not found");
      if (action.input.title) d.title = action.input.title;
      if (action.input.description) d.description = action.input.description;
      if (action.input.goalRef) d.goalRef = action.input.goalRef;
      if (action.input.url) d.url = action.input.url;
    },
    setDeliverableStatusOperation(state, action) {
      const d = state.deliverables.find((d) => d.id === action.input.id);
      if (!d) throw new DeliverableNotFoundError("Deliverable not found");
      d.status = action.input.status;
      d.deliveredAt = action.input.status === "DELIVERED"
        ? action.input.deliveredAt || d.deliveredAt || null
        : null;
    },
    removeDeliverableOperation(state, action) {
      const i = state.deliverables.findIndex((d) => d.id === action.input.id);
      if (i === -1) throw new DeliverableNotFoundError("Deliverable not found");
      state.deliverables.splice(i, 1);
    },
```

`knowledge.ts`:
```typescript
    addKnowledgeRefOperation(state, action) {
      if (state.knowledgeRefs.includes(action.input.ref))
        throw new DuplicateKnowledgeRefError("Knowledge ref already linked");
      state.knowledgeRefs.push(action.input.ref);
    },
    removeKnowledgeRefOperation(state, action) {
      const i = state.knowledgeRefs.indexOf(action.input.ref);
      if (i === -1) throw new KnowledgeRefNotFoundError("Knowledge ref not linked");
      state.knowledgeRefs.splice(i, 1);
    },
    setReferencesOperation(state, action) { state.references = action.input.references; },
```

- [ ] **Step 5: Run tests + coverage** — `bunx vitest run --coverage document-models/project` → all pass, coverage ≥95% on `v1/src/reducers/**`. If a branch is uncovered, categorize per CLAUDE.md (wrong nullability / missing validation / wrong operator / legitimate optionality) and extend the scenario test — do not add trivial one-off tests.
- [ ] **Step 6: Commit** — `git add document-models/project && git commit -m "feat(project): implement + test bai/project reducers"`

---

### Task 5: `bai/wbs` tree utils + reducers — TDD

**Files:**
- Create: `document-models/work-breakdown-structure/v1/src/tree-utils.ts`
- Modify: `document-models/work-breakdown-structure/v1/src/reducers/goals.ts`, `workflow.ts`, `documentation.ts`
- Test: `document-models/work-breakdown-structure/v1/tests/wbs-scenarios.test.ts`, `wbs-errors.test.ts`

**Interfaces:**
- Consumes: barrel `document-models/work-breakdown-structure/v1`.
- Produces: `rebuildDepthFirst(goals: Goal[]): Goal[]` and `collectSubtreeIds(goals: Goal[], rootId: string): Set<string>` (used only inside reducers); behavior contract used by editors: goals array is always depth-first (parents before children, sibling order = array order); `DELETE_GOAL` removes the subtree and strips dangling dependency ids; `SET_GOAL_STATUS` with non-BLOCKED clears `blockReason`.

- [ ] **Step 1: Write `tree-utils.ts`** (pure helpers, no document-model imports needed beyond the Goal type):

```typescript
import type { Goal } from "document-models/work-breakdown-structure/v1";

/** Depth-first order: parents before children, sibling order = current array order. */
export function rebuildDepthFirst(goals: Goal[]): Goal[] {
  const byParent = new Map<string | null, Goal[]>();
  for (const g of goals) {
    const key = g.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(g);
    byParent.set(key, list);
  }
  const out: Goal[] = [];
  const visit = (parentId: string | null) => {
    for (const g of byParent.get(parentId) ?? []) {
      out.push(g);
      visit(g.id);
    }
  };
  visit(null);
  for (const g of goals) if (!out.includes(g)) out.push(g); // orphan safety
  return out;
}

export function collectSubtreeIds(goals: Goal[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of goals) {
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  return ids;
}
```

- [ ] **Step 2: Write the scenario test (failing)** — `wbs-scenarios.test.ts`:

```typescript
import {
  addDependencies, addNote, assignGoal, createGoal, deleteGoal, reducer,
  removeDependencies, removeNote, reorder, setGoalStatus, setOutcome,
  setOwner, setProjectRef, setReferences, updateGoalDescription, utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

const ids = (doc: ReturnType<typeof utils.createDocument>) =>
  doc.state.global.goals.map((g) => g.id);

describe("wbs full flow", () => {
  it("builds, orders, works and prunes a goal tree", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, setOwner({ owner: "liberuum" }));
    doc = reducer(doc, setProjectRef({ projectRef: "proj-1" }));
    doc = reducer(doc, setReferences({ references: ["https://spec"] }));

    doc = reducer(doc, createGoal({ id: "a", description: "Design models" }));
    doc = reducer(doc, createGoal({ id: "b", description: "Build editors" }));
    doc = reducer(doc, createGoal({ id: "a1", description: "Project model", parentId: "a" }));
    doc = reducer(doc, createGoal({ id: "a2", description: "WBS model", parentId: "a" }));
    // insertBefore among siblings
    doc = reducer(doc, createGoal({ id: "a0", description: "Spec review", parentId: "a", insertBefore: "a1" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "a2", "b"]); // depth-first, a0 before a1

    // reorder: move b's position - make b a child of a, before a2
    doc = reducer(doc, reorder({ id: "b", parentId: "a", insertBefore: "a2" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "b", "a2"]);
    // back to root (append at end)
    doc = reducer(doc, reorder({ id: "b" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "a2", "b"]);

    // workflow
    doc = reducer(doc, assignGoal({ id: "a1", assignee: "knowledge-agent" }));
    doc = reducer(doc, setGoalStatus({ id: "a1", status: "IN_PROGRESS" }));
    doc = reducer(doc, setGoalStatus({ id: "a2", status: "BLOCKED", blockReason: "waiting on a1" }));
    expect(doc.state.global.goals.find((g) => g.id === "a2")?.blockReason).toBe("waiting on a1");
    doc = reducer(doc, setGoalStatus({ id: "a2", status: "TODO" }));
    expect(doc.state.global.goals.find((g) => g.id === "a2")?.blockReason).toBeNull();
    doc = reducer(doc, setGoalStatus({ id: "a1", status: "COMPLETED", outcome: "PR #42" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")).toMatchObject({
      status: "COMPLETED", outcome: "PR #42",
    });
    // no cascade: parent untouched
    expect(doc.state.global.goals.find((g) => g.id === "a")?.status).toBe("TODO");

    doc = reducer(doc, setOutcome({ id: "a1", outcome: "PR #43" }));
    doc = reducer(doc, updateGoalDescription({ id: "b", description: "Build both editors" }));
    doc = reducer(doc, addDependencies({ id: "b", dependencies: ["a1", "a2"] }));
    doc = reducer(doc, removeDependencies({ id: "b", dependencies: ["a2"] }));
    expect(doc.state.global.goals.find((g) => g.id === "b")?.dependencies).toEqual(["a1"]);

    doc = reducer(doc, addNote({ goalId: "a1", noteId: "n1", note: "done", author: "agent", timestamp: "2026-08-16T12:00:00.000Z" }));
    doc = reducer(doc, removeNote({ goalId: "a1", noteId: "n1" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")?.notes).toEqual([]);

    // delete subtree "a": removes a, a0, a1, a2 and strips b's dangling dep on a1
    doc = reducer(doc, deleteGoal({ id: "a" }));
    expect(ids(doc)).toEqual(["b"]);
    expect(doc.state.global.goals[0].dependencies).toEqual([]);

    // unassign via null
    doc = reducer(doc, assignGoal({ id: "b", assignee: null }));
    expect(doc.state.global.goals[0].assignee).toBeNull();
  });
});
```

- [ ] **Step 3: Write the error test (failing)** — `wbs-errors.test.ts` (operation-index pattern; each case asserts `.error` truthy AND state unchanged):

| # | Dispatch | Expected error |
|---|---|---|
| 1 | `createGoal({id:"a",…})` twice | DUPLICATE_GOAL_ID |
| 2 | `createGoal({id:"x", parentId:"nope"})` | GOAL_NOT_FOUND |
| 3 | `createGoal({id:"x", insertBefore:"nope"})` | GOAL_NOT_FOUND |
| 4 | `updateGoalDescription({id:"nope"})`, `deleteGoal({id:"nope"})`, `setGoalStatus({id:"nope",status:"TODO"})`, `assignGoal({id:"nope"})`, `setOutcome({id:"nope"})`, `addDependencies({id:"nope",dependencies:[]})`, `removeDependencies({id:"nope",dependencies:[]})`, `addNote({goalId:"nope",noteId:"n",note:"x"})`, `removeNote({goalId:"nope",noteId:"n"})`, `reorder({id:"nope"})` | GOAL_NOT_FOUND each |
| 5 | `reorder({id:"a", parentId:"a"})` and `reorder({id:"a", parentId:"a1"})` (a1 child of a) | INVALID_PARENT |
| 6 | `reorder({id:"a", insertBefore:"nope"})` | GOAL_NOT_FOUND |
| 7 | `setGoalStatus({id:"a", status:"BLOCKED"})` and with `blockReason: "  "` | MISSING_BLOCK_REASON |
| 8 | `addDependencies({id:"a", dependencies:["a"]})` | INVALID_DEPENDENCY |
| 9 | `addDependencies({id:"a", dependencies:["nope"]})` | DEPENDENCY_NOT_FOUND |
| 10 | `addNote` same noteId twice | DUPLICATE_NOTE_ID |
| 11 | `removeNote({goalId:"a", noteId:"nope"})` | NOTE_NOT_FOUND |

Write each as an `it(...)` in the same style as Task 4 Step 2 (build a small doc with goals `a`, `a1` (child of `a`) first, then dispatch the failing op, then assert `doc.operations.global[<index>].error` and unchanged state).

- [ ] **Step 4: Run tests, verify failure** — `bunx vitest run document-models/work-breakdown-structure`

- [ ] **Step 5: Implement reducers**

`goals.ts`:
```typescript
import { collectSubtreeIds, rebuildDepthFirst } from "../tree-utils.js";
// keep scaffolded export shape:
    createGoalOperation(state, action) {
      if (state.goals.some((g) => g.id === action.input.id))
        throw new DuplicateGoalIdError("Goal id already exists");
      const parentId = action.input.parentId || null;
      if (parentId && !state.goals.some((g) => g.id === parentId))
        throw new GoalNotFoundError("Parent goal not found");
      let index = state.goals.length;
      if (action.input.insertBefore) {
        const i = state.goals.findIndex((g) => g.id === action.input.insertBefore);
        if (i === -1) throw new GoalNotFoundError("insertBefore goal not found");
        index = i;
      }
      state.goals.splice(index, 0, {
        id: action.input.id, description: action.input.description,
        status: "TODO", parentId, assignee: action.input.assignee || null,
        dependencies: [], blockReason: null, outcome: null, notes: [],
      });
      state.goals = rebuildDepthFirst(state.goals);
    },
    updateGoalDescriptionOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.description = action.input.description;
    },
    deleteGoalOperation(state, action) {
      if (!state.goals.some((g) => g.id === action.input.id))
        throw new GoalNotFoundError("Goal not found");
      const removed = collectSubtreeIds(state.goals, action.input.id);
      state.goals = state.goals.filter((g) => !removed.has(g.id));
      for (const g of state.goals)
        g.dependencies = g.dependencies.filter((d) => !removed.has(d));
    },
    reorderOperation(state, action) {
      const goal = state.goals.find((g) => g.id === action.input.id);
      if (!goal) throw new GoalNotFoundError("Goal not found");
      const parentId = action.input.parentId || null;
      if (parentId) {
        if (!state.goals.some((g) => g.id === parentId))
          throw new GoalNotFoundError("Parent goal not found");
        if (parentId === goal.id || collectSubtreeIds(state.goals, goal.id).has(parentId))
          throw new InvalidParentError("Cannot move a goal under itself or its descendant");
      }
      goal.parentId = parentId;
      const without = state.goals.filter((g) => g.id !== goal.id);
      let index = without.length;
      if (action.input.insertBefore) {
        const i = without.findIndex((g) => g.id === action.input.insertBefore);
        if (i === -1) throw new GoalNotFoundError("insertBefore goal not found");
        index = i;
      }
      without.splice(index, 0, goal);
      state.goals = rebuildDepthFirst(without);
    },
```

`workflow.ts`:
```typescript
    setGoalStatusOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      if (action.input.status === "BLOCKED" && !action.input.blockReason?.trim())
        throw new MissingBlockReasonError("BLOCKED requires a blockReason");
      g.status = action.input.status;
      g.blockReason = action.input.status === "BLOCKED" ? (action.input.blockReason ?? null) : null;
      if (action.input.outcome) g.outcome = action.input.outcome;
    },
    assignGoalOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.assignee = action.input.assignee || null;
    },
    setOutcomeOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.outcome = action.input.outcome || null;
    },
    addDependenciesOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      for (const dep of action.input.dependencies) {
        if (dep === g.id) throw new InvalidDependencyError("Goal cannot depend on itself");
        if (!state.goals.some((o) => o.id === dep))
          throw new DependencyNotFoundError("Dependency goal not found");
      }
      for (const dep of action.input.dependencies)
        if (!g.dependencies.includes(dep)) g.dependencies.push(dep);
    },
    removeDependenciesOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.id);
      if (!g) throw new GoalNotFoundError("Goal not found");
      g.dependencies = g.dependencies.filter((d) => !action.input.dependencies.includes(d));
    },
```

`documentation.ts`:
```typescript
    addNoteOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.goalId);
      if (!g) throw new GoalNotFoundError("Goal not found");
      if (g.notes.some((n) => n.id === action.input.noteId))
        throw new DuplicateNoteIdError("Note id already exists");
      g.notes.push({
        id: action.input.noteId, note: action.input.note,
        author: action.input.author || null, timestamp: action.input.timestamp || null,
      });
    },
    removeNoteOperation(state, action) {
      const g = state.goals.find((g) => g.id === action.input.goalId);
      if (!g) throw new GoalNotFoundError("Goal not found");
      const i = g.notes.findIndex((n) => n.id === action.input.noteId);
      if (i === -1) throw new NoteNotFoundError("Note not found");
      g.notes.splice(i, 1);
    },
    setOwnerOperation(state, action) { state.owner = action.input.owner || null; },
    setReferencesOperation(state, action) { state.references = action.input.references; },
    setProjectRefOperation(state, action) { state.projectRef = action.input.projectRef || null; },
```

- [ ] **Step 6: Run tests + coverage** — `bunx vitest run --coverage document-models/work-breakdown-structure` → pass, ≥95% incl. `tree-utils.ts`.
- [ ] **Step 7: Commit** — `git add document-models/work-breakdown-structure && git commit -m "feat(wbs): implement + test bai/wbs reducers and tree utils"`

---

### Task 6: Backport reducer code into the model documents

The model documents are the source of truth; without this, a future regeneration scaffolds empty reducers (CLAUDE.md two-step rule, reversed order for TDD).

**Files:**
- Create: `/tmp/projects-wbs/project-reducer-actions.json`, `/tmp/projects-wbs/wbs-reducer-actions.json`

**Interfaces:**
- Consumes: final reducer bodies from Tasks 4–5; `<PROJECT_MODEL_ID>`, `<WBS_MODEL_ID>`; operation ids read from each model doc's `specifications[0].modules[].operations[].id`.

- [ ] **Step 1: Generate SET_OPERATION_REDUCER payloads** — for each model, read the doc (`switchboard docs get <id> --state --format json`), map operation name → operation id, and emit one `{"type":"SET_OPERATION_REDUCER","input":{"id":"<op-id>","reducer":"<body>"},"scope":"global"}` per operation. The `reducer` string is the **function body only** (no header), copied from the `src/reducers/*.ts` implementation. For WBS ops that use tree helpers, inline the helper calls exactly as written — the model JSON stores the same code; the `tree-utils.ts` import lives only in `src/` (imports belong at the top of the src file, per CLAUDE.md).
- [ ] **Step 2: Dispatch both** — `switchboard docs apply <id> --file ... --wait` for each model.
- [ ] **Step 3: Let codegen re-run, then diff** — `git diff document-models/` → expected: only `<name>.json` changes (reducer strings embedded); `src/`, `gen/` unchanged or regenerated identically. `bun run tsc && bunx vitest run document-models` still green.
- [ ] **Step 4: Commit** — `git add document-models && git commit -m "chore(models): backport reducer code into model documents"`

---

### Task 7: Create the two editor documents on the vetra drive

**Files:**
- Generated: `editors/project-editor/` and `editors/wbs-editor/` shells (by codegen); Modify (only if codegen missed it): `editors/editors.ts`

**Interfaces:**
- Consumes: document types `bai/project`, `bai/wbs` (Tasks 2–3).
- Produces: editor modules `project-editor` (documentTypes `["bai/project"]`) and `wbs-editor` (`["bai/wbs"]`) registered in `editors/editors.ts`; shell files `editors/<name>/editor.tsx` + `module.ts` to implement in Tasks 9–10.

- [ ] **Step 1: Get the editor schema** — `mcp__reactor-mcp__getDocumentModelSchema({type: "powerhouse/document-editor"})` (or read an existing editor document from the vetra tree, e.g. the knowledge-note-editor doc, to copy exact action shapes).
- [ ] **Step 2: Create both editor documents** on `vetra-dfa9f5f8` (type `powerhouse/document-editor`, names "Project Editor" / "WBS Editor"), then dispatch per schema: editor id (`project-editor` / `wbs-editor`), name, `documentTypes` (`bai/project` / `bai/wbs`).
- [ ] **Step 3: Confirm/publish** — the editor document MUST NOT stay DRAFT (codegen skips drafts). Dispatch the status/confirm action per schema; re-read state to verify.
- [ ] **Step 4: Verify codegen output** — `ls editors/project-editor editors/wbs-editor` → `editor.tsx module.ts`; `grep -n "ProjectEditor\|WbsEditor" editors/editors.ts` → both registered (add manually if missing, per CLAUDE.md known gotcha); `bun run tsc`.
- [ ] **Step 5: Commit** — `git add editors powerhouse.manifest.json && git commit -m "feat(editors): scaffold project-editor + wbs-editor via vetra codegen"`

---

### Task 8: Shared status/rollup utilities

**Files:**
- Create: `editors/shared/project-status.ts`
- Test: `editors/shared/project-status.test.ts`

**Interfaces:**
- Consumes: types from `document-models/work-breakdown-structure` and `document-models/project` barrels.
- Produces (exact signatures used by Tasks 9–11):
```typescript
export const GOAL_STATUS_META: Record<GoalStatus, { label: string; fg: string; bg: string; border: string; group: "waiting" | "active" | "finished" }>;
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; fg: string; bg: string; border: string }>;
export const DELIVERABLE_STATUS_META: Record<DeliverableStatus, { label: string; fg: string; bg: string; border: string }>;
export function goalRollup(goals: Pick<Goal, "status">[]): { total: number; finished: number; blocked: number; inProgress: number; pct: number };
```

- [ ] **Step 1: Write the failing test** — rollup math: empty → `{total:0, finished:0, blocked:0, inProgress:0, pct:0}`; `[COMPLETED, WONT_DO, BLOCKED, IN_PROGRESS, TODO]` → `{total:5, finished:2, blocked:1, inProgress:1, pct:40}`.
- [ ] **Step 2: Implement** — status metas use the established pill recipe (rgba tokens like `NoteList.tsx`): TODO gray, IN_PROGRESS blue, BLOCKED red, IN_REVIEW amber, COMPLETED emerald, WONT_DO gray/strikethrough; PLANNING amber, ACTIVE emerald, ON_HOLD blue, COMPLETED purple/mauve `var(--bai-accent)`, ARCHIVED gray; PLANNED gray, IN_PROGRESS blue, DELIVERED emerald, CANCELLED red. `pct = total === 0 ? 0 : Math.round((finished / total) * 100)` where `finished = COMPLETED + WONT_DO`.
- [ ] **Step 3: Run** — `bunx vitest run editors/shared` → pass. `bun run tsc`.
- [ ] **Step 4: Commit** — `git add editors/shared && git commit -m "feat(editors): shared project/wbs status meta + rollup util"`

---

### Task 9: WBS editor UI

**Files:**
- Modify: `editors/wbs-editor/editor.tsx` (codegen shell — edit, don't replace file identity)
- Create: `editors/wbs-editor/components/GoalTree.tsx`, `GoalRow.tsx`, `StatusChipMenu.tsx`, `GoalSidebar.tsx`, `BlockReasonDialog.tsx`, `AddGoalRow.tsx`

**Interfaces:**
- Consumes: `import { actions, useSelectedWorkBreakdownStructureDocument } from "document-models/work-breakdown-structure";` — hook name per generated `hooks.ts` (verify with `grep "export function use" document-models/work-breakdown-structure/v1/hooks.ts`); `GOAL_STATUS_META`, `goalRollup` from `../shared/project-status.js`; `generateId` from `document-model`; `setSelectedNode` from `@powerhousedao/reactor-browser`; `DocumentToolbar` from `@powerhousedao/design-system/connect/index`.
- Produces: working `bai/wbs` editor.

- [ ] **Step 1: editor.tsx skeleton**

```tsx
import { DocumentToolbar } from "@powerhousedao/design-system/connect/index";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { actions, useSelectedWorkBreakdownStructureDocument } from "document-models/work-breakdown-structure";
import { useState } from "react";
import { ThemeProvider } from "../shared/theme-context.js";
import { goalRollup } from "../shared/project-status.js";
import { GoalTree } from "./components/GoalTree.js";
import { GoalSidebar } from "./components/GoalSidebar.js";

export default function Editor() {
  const [document, dispatch] = useSelectedWorkBreakdownStructureDocument();
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const s = document.state.global;
  const rollup = goalRollup(s.goals);
  const selected = s.goals.find((g) => g.id === selectedGoalId) ?? null;
  return (
    <ThemeProvider>
      <DocumentToolbar />
      <div className="flex h-full" style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}>
        <div className="flex-1 overflow-y-auto p-6">
          {/* header: owner (inline input -> actions.setOwner), projectRef breadcrumb, progress bar */}
          {s.projectRef && (
            <button type="button" onClick={() => setSelectedNode(s.projectRef!)}
              className="text-xs" style={{ color: "var(--bai-accent)" }}>← Part of project</button>
          )}
          <GoalTree goals={s.goals} selectedId={selectedGoalId}
            onSelect={setSelectedGoalId} dispatch={dispatch} />
        </div>
        {selected && (
          <GoalSidebar goal={selected} allGoals={s.goals} dispatch={dispatch}
            onClose={() => setSelectedGoalId(null)} />
        )}
      </div>
    </ThemeProvider>
  );
}
```
(Progress header: `rounded-lg px-4 py-3` card with `{rollup.finished}/{rollup.total} · {rollup.pct}%` bar `h-1.5 rounded-full` filled with `var(--bai-accent)`, plus red `{rollup.blocked} blocked` badge when > 0. References list + add-URL input dispatching `actions.setReferences([...s.references, url])`.)

- [ ] **Step 2: GoalTree — visible-row flattening + expand state**

```tsx
type Row = { goal: Goal; depth: number; hasChildren: boolean };
function visibleRows(goals: Goal[], collapsed: Set<string>): Row[] {
  const byParent = new Map<string | null, Goal[]>();
  for (const g of goals) {
    const k = g.parentId ?? null;
    byParent.set(k, [...(byParent.get(k) ?? []), g]);
  }
  const out: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const g of byParent.get(parentId) ?? []) {
      const kids = byParent.get(g.id) ?? [];
      out.push({ goal: g, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(g.id)) walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
```
GoalTree holds `const [collapsed, setCollapsed] = useState<Set<string>>(new Set())`, renders header row + `visibleRows(...).map(<GoalRow/>)` + `<AddGoalRow parentId={null}/>` at bottom. Empty state: "No goals yet — add the first one below."

- [ ] **Step 3: GoalRow** — `rounded-lg px-3 py-2` row, `paddingLeft: 12 + depth * 20`, chevron toggle when `hasChildren`, description (click → onSelect), `<StatusChipMenu/>`, assignee `text-[10px] var(--bai-text-tertiary)`, note count, hover-revealed action buttons (`opacity-0 group-hover:opacity-100`): add child (inline input → `dispatch(actions.createGoal({ id: generateId(), description, parentId: goal.id }))`), move up / move down, delete (confirm modal — subtree warning; `dispatch(actions.deleteGoal({ id }))`).
  Move up/down against **siblings** (same parentId): up → `dispatch(actions.reorder({ id, parentId: goal.parentId, insertBefore: prevSibling.id }))`; down → `insertBefore: siblingAfterNext?.id` (omit `insertBefore` when moving to last). Compute siblings from the flat array order.
- [ ] **Step 4: StatusChipMenu** — pill button (colors from `GOAL_STATUS_META`) opening a `rounded-xl` dropdown grouped by `group` (waiting/active/finished). On pick:
```tsx
if (status === "BLOCKED") setBlockDialogOpen(true);            // BlockReasonDialog -> dispatch(actions.setGoalStatus({ id, status: "BLOCKED", blockReason }))
else if (status === "COMPLETED") setOutcomeDialogOpen(true);   // optional outcome field -> dispatch(actions.setGoalStatus({ id, status: "COMPLETED", outcome: outcome || undefined }))
else dispatch(actions.setGoalStatus({ id, status }));
```
`BlockReasonDialog`: modal (`fixed inset-0 z-50` + `bg-black/60` scrim, `w-[400px] rounded-2xl p-6` panel), textarea, disabled submit until non-empty trim. Reused with an optional-input variant for the COMPLETED outcome prompt.
- [ ] **Step 5: GoalSidebar** (fixed right rail `w-[360px] border-l` `var(--bai-border)`, `var(--bai-surface)`): description textarea (blur → `updateGoalDescription`), status chip menu, assignee input (blur → `assignGoal({ id, assignee: value || null })`), blockReason display when BLOCKED, outcome input (blur → `setOutcome`), dependencies: checked list of all other goals (toggle → `addDependencies({ id, dependencies: [depId] })` / `removeDependencies`), notes thread (author + text, Ctrl+Enter → `addNote({ goalId, noteId: generateId(), note, author: author || undefined, timestamp: new Date().toISOString() })`, hover-delete → `removeNote`).
- [ ] **Step 6: Verify** — `bun run tsc && bun run lint:fix`. Manual: `ph vetra` Connect (localhost:3000) → create a `bai/wbs` doc in any drive → build a small tree, exercise every control.
- [ ] **Step 7: Commit** — `git add editors/wbs-editor && git commit -m "feat(editors): WBS editor — goal tree, status workflow, sidebar"`

---

### Task 10: Project editor UI

**Files:**
- Modify: `editors/project-editor/editor.tsx`
- Create: `editors/project-editor/components/InitCard.tsx`, `HeaderBar.tsx`, `WbsPanel.tsx`, `DeliverablesSection.tsx`, `TeamSection.tsx`, `KnowledgeSection.tsx`, `ReferencesSection.tsx`

**Interfaces:**
- Consumes: `import { actions, useSelectedProjectDocument } from "document-models/project";`; `import { actions as wbsActions, useWorkBreakdownStructureDocumentById } from "document-models/work-breakdown-structure";`; `addDocument`, `setSelectedNode`, `useSelectedDriveId`, `useDocumentsInSelectedDrive` from `@powerhousedao/reactor-browser`; metas + `goalRollup` from `../shared/project-status.js`; the vault's subgraph search hook `useGraphSearch` from `../knowledge-vault/hooks/use-graph-search.js` (verify its export signature first: `grep -n "export" editors/knowledge-vault/hooks/use-graph-search.ts`).
- Produces: working `bai/project` editor.

- [ ] **Step 1: editor.tsx** — `ThemeProvider` + `DocumentToolbar` + branch: `!state.name` → `<InitCard/>`; else header + sections stacked in `max-w-5xl mx-auto p-6 space-y-4`.
- [ ] **Step 2: InitCard** — `rounded-xl border p-6` card pre-filling name from `document.header.name`; fields name/description/owner/status; submit → `dispatch(actions.createProject({ name, description: description || undefined, owner: owner || undefined, status, createdAt: new Date().toISOString() }))`.
- [ ] **Step 3: HeaderBar** — inline-editable name (blur → `updateProjectInfo({ name })`), `PROJECT_STATUS_META` pill dropdown → `setProjectStatus`, owner input → `setOwner`, targetDate `<input type="date">` → `setTargetDate({ targetDate: value || null })`, description textarea → `updateProjectInfo({ description })`.
- [ ] **Step 4: WbsPanel** — reads the linked WBS live:
```tsx
const [wbsDoc] = useWorkBreakdownStructureDocumentById(state.wbsRef ?? "");
```
(Verify the generated by-id hook tolerates empty id — check the generated code in `document-models/work-breakdown-structure/v1/hooks.ts`; if it throws/suspends on missing docs — see VaultSidebar's comment about suspend-on-orphan — guard by rendering the hook-consuming subcomponent only when `state.wbsRef` is set.)
Linked: per-status chips (counts), progress bar from `goalRollup`, first 3 BLOCKED goals with reasons, "Open WBS" → `setSelectedNode(state.wbsRef)`. Unlinked: "Create WBS" button:
```tsx
const driveId = useSelectedDriveId();
async function handleCreateWbs() {
  const result = await addDocument(driveId, `${state.name} — WBS`, "bai/wbs", projectsFolderId);
  if (!result?.id) return;
  dispatch(actions.linkWbs({ wbsRef: result.id }));
  setPendingWbsId(result.id);   // a small effect component mounted for pendingWbsId
}
// <WbsBackLink id={pendingWbsId}/> uses useWorkBreakdownStructureDocumentById(id) and
// dispatches wbsActions.setProjectRef({ projectRef: document.header.id }) exactly once
// (useRef guard), then clears pendingWbsId.
```
`projectsFolderId`: resolve from `useNodesInSelectedDrive()` — folder node named `projects` with `parentFolder == null` (fall back to `undefined` → drive root).
- [ ] **Step 5: DeliverablesSection** — table rows: title (inline edit → `updateDeliverable`), status pill menu → `setDeliverableStatus({ id, status, deliveredAt: status === "DELIVERED" ? new Date().toISOString() : undefined })`, linked goal chip (resolved from the WBS doc's goals by `goalRef`: description + status; picker listing WBS goals when linked), url link, delete → `removeDeliverable`. Add row → `addDeliverable({ id: generateId(), title, goalRef: goalRef || undefined, url: url || undefined })`. Delivered/total count in the section header.
- [ ] **Step 6: TeamSection** — rows name/role/kind badge (🧑 HUMAN / 🤖 AGENT); add form (name, role, kind select) → `addMember({ id: generateId(), name, role: role || undefined, kind })`; hover-delete → `removeMember`.
- [ ] **Step 7: KnowledgeSection** — resolve titles for `state.knowledgeRefs` from `useDocumentsInSelectedDrive()` by header id (fallback: raw id, `font-mono text-[10px]`); click → `setSelectedNode(ref)`; remove → `removeKnowledgeRef`. Add: search input → subgraph search hook results (documentId + title) → pick → `addKnowledgeRef({ ref: documentId })`.
- [ ] **Step 8: ReferencesSection** — URL list + add/remove → `setReferences` with the updated array.
- [ ] **Step 9: Verify** — `bun run tsc && bun run lint:fix`; manual in Connect: init project, create+link WBS (check back-link set exactly once — inspect WBS doc ops), add deliverable linked to a goal, complete that goal in the WBS editor, see status/outcome reflected in the project editor.
- [ ] **Step 10: Commit** — `git add editors/project-editor && git commit -m "feat(editors): Project editor — init, WBS panel, deliverables, team, knowledge"`

---

### Task 11: Projects tab in the drive app

**Files:**
- Create: `editors/knowledge-vault/components/ProjectsView.tsx`
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx` (ViewMode union + TABS array + content ternary + CreateMenu), `editors/knowledge-vault/config.ts` (allowedDocumentTypes), `editors/knowledge-vault/components/CreateDocumentDialog.tsx` (type → folder map), `editors/knowledge-vault/hooks/use-drive-init.ts` (seed `projects` folder)

**Interfaces:**
- Consumes: `useDocumentsInSelectedDrive`, `setSelectedNode`, `addDocument` (reactor-browser); metas + `goalRollup` from `../shared/project-status.js`.
- Produces: `projects` ViewMode; ProjectsView listing `bai/project` docs.

- [ ] **Step 1: ProjectsView.tsx** — mirror `SourceList.tsx` structure (collapsible status groups + modals):

```tsx
const documents = useDocumentsInSelectedDrive();
const wbsById = useMemo(() => {
  const m = new Map<string, { goals: { status: string }[] }>();
  for (const d of documents ?? [])
    if (d.header.documentType === "bai/wbs")
      m.set(d.header.id, (d.state as unknown as { global: { goals: { status: string }[] } }).global);
  return m;
}, [documents]);
const projects = useMemo(() =>
  (documents ?? [])
    .filter((d) => d.header.documentType === "bai/project")
    .map((d) => {
      const g = (d.state as unknown as { global: Record<string, unknown> }).global;
      const wbs = g.wbsRef ? wbsById.get(g.wbsRef as string) : undefined;
      return {
        id: d.header.id,
        name: (g.name as string) ?? d.header.name,
        status: (g.status as string) ?? "PLANNING",
        owner: (g.owner as string) ?? null,
        team: (g.team as { name: string; kind: string | null }[]) ?? [],
        deliverables: (g.deliverables as { status: string }[]) ?? [],
        targetDate: (g.targetDate as string) ?? null,
        lastModified: d.header.lastModified,
        rollup: goalRollup((wbs?.goals ?? []) as { status: GoalStatus }[]),
      };
    }), [documents, wbsById]);
```
Groups in order `["ACTIVE","PLANNING","ON_HOLD","COMPLETED","ARCHIVED"]`, default-open `ACTIVE`+`PLANNING`, header buttons with rotating chevron + count (exact SourceList pattern). Card: name, status pill, owner, team chips, progress bar + `finished/total`, red `⚠ n blocked` when `rollup.blocked > 0`, delivered/total deliverables, targetDate. Click → `setSelectedNode(project.id)`. Empty state card with a "New Project" CTA.
"New Project" button → small name dialog → `addDocument(driveId, name, "bai/project", projectsFolderId)` → `setSelectedNode(result.id)` (init completes in the editor's InitCard). Resolve `projectsFolderId` the same way CreateDocumentDialog resolves target folders: from `useNodesInSelectedDrive()`, the folder node with `name === "projects"` and no parent (fall back to `undefined` → drive root).

- [ ] **Step 2: DriveExplorer wiring** — add `"projects"` to the `ViewMode` union; TABS entry after `sources`: `{ key: "projects", label: "Projects", badge: projectCount > 0 ? projectCount : undefined, icon: (briefcase svg, same 24×24 stroke style) }` where `projectCount` counts non-ARCHIVED `bai/project` file nodes (reuse the existing file-node counting used for `sourceCount`); content ternary branch `viewMode === "projects" ? <ProjectsView /> : …`; add "Project" to `CreateMenu`.
- [ ] **Step 3: config.ts** — append `"bai/project", "bai/wbs"` to `allowedDocumentTypes`.
- [ ] **Step 4: CreateDocumentDialog.tsx** — map both types → `projects` folder.
- [ ] **Step 5: use-drive-init.ts** — add `projects` to the seeded top-level folders (same guarded pattern as `sources`).
- [ ] **Step 6: Verify** — `bun run tsc && bun run lint:fix`; manual: tab appears with badge, groups collapse, card rollups match the WBS, New Project flow lands in the editor.
- [ ] **Step 7: Commit** — `git add editors/knowledge-vault && git commit -m "feat(app): Projects tab — cards, rollups, create flow"`

---

### Task 12: Full verification pass

- [ ] **Step 1:** `bun run tsc` → 0 errors.
- [ ] **Step 2:** `bun run lint:fix` → 0 errors.
- [ ] **Step 3:** `bunx vitest run --coverage` → all green; both new models ≥95% on lines/branches/functions/statements. Fix any regression in existing suites (the graph-indexer tests must be untouched).
- [ ] **Step 4:** `git diff document-models/ --stat` → clean tree, no unintended codegen drift.
- [ ] **Step 5: Commit** anything outstanding — `git commit -m "chore: verification pass for projects/wbs feature"`

---

### Task 13: Local E2E — prove the agent path via CLI

**Files:**
- Create: `/tmp/projects-wbs/e2e-seed.sh` (throwaway; keep commands in the task)

- [ ] **Step 1: Seed a real project via switchboard CLI** against the local vault drive (slug from `switchboard drives list`; the localhost replica drive):

```bash
DRIVE=<local-vault-slug>
# projects folder uuid:
switchboard docs tree $DRIVE --format json | python3 -c "
import json,sys
for n in json.load(sys.stdin).get('nodes',[]):
    if n.get('kind')=='folder' and n.get('name')=='projects': print(n['id'])"
PROJ=$(switchboard docs create --type bai/project --name "Projects Tab Feature" --drive $DRIVE --parent-folder <projects-folder-uuid> --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
switchboard docs mutate $PROJ --op createProject --input '{"name":"Projects Tab Feature","description":"Dogfood: this very feature","owner":"liberuum","status":"ACTIVE","createdAt":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
WBS=$(switchboard docs create --type bai/wbs --name "Projects Tab Feature — WBS" --drive $DRIVE --parent-folder <projects-folder-uuid> --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
switchboard docs mutate $PROJ --op linkWbs --input '{"wbsRef":"'$WBS'"}'
switchboard docs mutate $WBS --op setProjectRef --input '{"projectRef":"'$PROJ'"}'
switchboard docs mutate $WBS --op createGoal --input '{"id":"g1","description":"Ship document models"}'
switchboard docs mutate $WBS --op createGoal --input '{"id":"g2","description":"Ship editors","parentId":null}'
switchboard docs mutate $WBS --op createGoal --input '{"id":"g1a","description":"bai/project model","parentId":"g1"}'
switchboard docs mutate $WBS --op setGoalStatus --input '{"id":"g1a","status":"COMPLETED","outcome":"document-models/project"}'
switchboard docs mutate $PROJ --op addDeliverable --input '{"id":"d1","title":"Projects tab in vault app","goalRef":"g2"}'
switchboard docs mutate $PROJ --op addMember --input '{"id":"m1","name":"knowledge-agent","role":"builder","kind":"AGENT"}'
```
- [ ] **Step 2: Read back and assert** — `switchboard docs get $WBS --state --format json` → goals depth-first `[g1, g1a, g2]`, g1a COMPLETED with outcome; `docs get $PROJ --state` → wbsRef/team/deliverable correct. **Also verify a failed op records `.error`:** dispatch `setGoalStatus {"id":"g1a","status":"BLOCKED"}` (no reason) → operation recorded with error, state unchanged.
- [ ] **Step 3: Verify in Connect** (with the user): Projects tab shows the card with 1/3 progress; open project → WBS panel matches; open WBS → tree renders; operation history visible in the document timeline.
- [ ] **Step 4:** Delete nothing — leave the dogfood project in the local drive as living test data. Commit any fixes found.

---

### Task 14: Plugin update (`/home/p/Powerhouse/powerhouse-knowledge`)

**Files:**
- Create: `skills/projects/SKILL.md`
- Modify: `AGENT.md` + `agents/knowledge-agent.md` (folder table row + document-model tables), `README.md` (skills list), `.claude-plugin/plugin.json` (version → 1.3.0)

**Interfaces:**
- Consumes: op names exactly as shipped (Tasks 2–3).

- [ ] **Step 1: Write `skills/projects/SKILL.md`** covering: finding projects (`docs tree` filter `bai/project` / GraphQL), reading a project + its WBS, the goal-working loop for agents —

```
1. Pick a goal: read WBS state, choose a TODO leaf you're assigned to (or unassigned)
2. switchboard docs mutate <wbs> --op assignGoal   --input '{"id":"<goal>","assignee":"<agent-name>"}'
3. switchboard docs mutate <wbs> --op setGoalStatus --input '{"id":"<goal>","status":"IN_PROGRESS"}'
4. Do the work. Query the vault for relevant knowledge (same drive!).
5. switchboard docs mutate <wbs> --op addNote --input '{"goalId":"<goal>","noteId":"<uuid>","note":"<what happened>","author":"<agent-name>","timestamp":"<ISO-Z>"}'
6. Done: --op setGoalStatus '{"id":"<goal>","status":"COMPLETED","outcome":"<artifact ref>"}'
   Stuck: --op setGoalStatus '{"id":"<goal>","status":"BLOCKED","blockReason":"<why>"}'
7. If the goal maps to a deliverable: --op setDeliverableStatus on the project doc
```
plus the two model op tables (copy from the spec), folder location `/projects/`, and the rule: never leave a goal IN_PROGRESS at session end — note + status it honestly.
- [ ] **Step 2: Update AGENT.md / knowledge-agent.md / README** — add `bai/project` + `bai/wbs` rows to the document-model and folder tables; add the skill to the skills table.
- [ ] **Step 3: Bump plugin version to 1.3.0, commit + push** both repo changes (plugin repo `main`).

---

### Task 15: Ship (user-gated)

- [ ] **Step 1:** Bump package version `1.0.50 → 1.1.0` (new models = minor). `git add package.json && git commit -m "release: 1.1.0 — projects + wbs"`.
- [ ] **Step 2:** With the user: `ph publish` (build runs via prepublishOnly; verify the tarball contains `dist/node/models` — known packaging race), then user deploys/updates the remote pod.
- [ ] **Step 3:** Post-deploy remote verification: `switchboard config use <remote-profile>; switchboard ping`; create nothing yet — confirm the two new models appear in the reactor's model registry (GraphQL introspection or `docs create --type bai/project` into a scratch folder then delete); verify Connect shows the Projects tab on the vault drive; verify semantic search still answers (embedder unaffected).
- [ ] **Step 4:** Push `main` + working branch; update memory notes if new gotchas surfaced.
