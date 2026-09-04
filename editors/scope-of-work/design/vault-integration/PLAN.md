# Integrating Scope of Work with vault Projects and WBS

**Status:** proposal. No schema or editor changes in this folder — read this file, then open [`index.html`](index.html) for the flows.

**Audience:** how the three document types should live in the Knowledge Vault nav, given (a) how this team actually starts work and (b) how `bai/project` already cites vault notes.

---

## 1. Verdict

Keep **three models**. Give them **one nav tab**. Author **bottom-up**. Report **top-down**.

| You start with | You compile into | You show Sky |
|---|---|---|
| `bai/project` + `bai/wbs` (tasks, team, notes) | a SoW **deliverable** (named outcome) | SoW projects → milestones → roadmap |

Do **not**:

- add a second “SoW” tab next to Projects
- put the goal tree inside the SoW document
- require a SoW deliverable before anyone can write tasks
- migrate existing Paperless-style projects in v1

The SoW editor stays the stakeholder canvas. The vault Projects tab stays the team’s working list. A **compile** action is the only new verb.

---

## 2. What I found in the current vault

### 2.1 Three products, overlapping English

| Type | What the code actually is | What the name pretends |
|---|---|---|
| `powerhouse/scopeofwork` | Programme: quoted deliverables, budget envelopes, roadmaps/milestones | Scope of Work (accurate) |
| `bai/project` | Execution envelope: status, team, shipped artifacts, knowledge cites, pointer to a goal tree | “Project” — no budget, no schedule |
| `bai/wbs` | Goal/task tree: assignee, blocker, notes, no cascades | “Work Breakdown Structure” — **not** a PMBOK WBS |

A textbook WBS is deliverable decomposition. That job already belongs to **SoW deliverables**. `bai/wbs` is how humans and agents **do** the work. That is why “deliverable → WBS” and “WBS → deliverable” felt like opposites: people were using one word for two layers.

### 2.2 How work is created today

- Vault nav **Projects** lists `bai/project` cards (`ProjectsView`). Badge = non-ARCHIVED count.
- **New Project** only creates the file under `/projects/`. Init (`CREATE_PROJECT`) and WBS create happen in `project-editor`.
- WBS is created **on the server** (`createDocumentRemote`) then `LINK_WBS` / `SET_PROJECT_REF`. Local `addDocument` is forbidden (remote-first would leave a dangling id).
- Clicking a card does `setSelectedNode(id)` — Connect swaps the tab body for the document editor; the vault sidebar stays.
- Neither type is graph-indexed. Chat uses `list_projects` + `read_document`, not `knowledgeGraph*`.

### 2.3 Knowledge notes — this is the important existing pattern

`bai/project` already has a vault-native knowledge surface. SoW does not.

| Field | Model | What it is |
|---|---|---|
| `knowledgeRefs: [PHID!]!` | `bai/project` only | Notes and MOCs in **this** drive. `ADD_KNOWLEDGE_REF` / `REMOVE_KNOWLEDGE_REF`. Not `docs link`, not the relationship table. |
| Knowledge UI | `project-editor` → `KnowledgeSection` | Search notes/MOCs by title (vault doc index), click opens the note, unlink on hover. |
| `references: [URL!]!` | `bai/project` **and** `bai/wbs` | External URLs. `SET_REFERENCES` **replaces** the whole array. |
| SoW `contributors` | `powerhouse/scopeofwork` | People (`Agent` with `PHID`). Not knowledge. |
| SoW deliverable `keyResults` | SoW | Title + URL. Outcome evidence, not vault notes. |

**Finding:** knowledge stays on the execution project. That is correct. A SoW deliverable is a named outcome for a stakeholder; the notes that informed the work belong next to the people doing the work. Compiling a project into a SoW deliverable should **not** copy `knowledgeRefs` onto the SoW. The SoW editor can *show* them by following `executionRef` → `bai/project.knowledgeRefs` (read-only chips that open the note). Writes stay on `bai/project`.

If you later want “this deliverable was derived from note X”, add that on the execution side (project knowledge, or a goal note), not as a second PHID array on SoW.

### 2.4 Two “deliverables”

| | SoW deliverable | `bai/project` deliverable |
|---|---|---|
| Meaning | Work package: quote, progress, schedule, who pays | Shipped artifact: title, URL, status, optional `goalRef` |
| Status | `DRAFT`…`DELIVERED` plus `WONT_DO` | `PLANNED` / `IN_PROGRESS` / `DELIVERED` / `CANCELLED` |
| Money | First-class | None |
| Link to tasks | **Does not exist today** | `goalRef` → one WBS goal |

Keep both. The project deliverable is “we shipped this URL.” The SoW deliverable is “this is the outcome Sky is buying.” A project deliverable may still `goalRef` a goal; that is execution hygiene, not the compile link.

### 2.5 The BA conversation (apeiron / liberuum)

Apeiron’s order, for *this* team:

> brief → demo steps → WBS (identify tasks) → *if we had a PM* compile tasks into a deliverable set → compile deliverables into projects and milestones → milestones into a roadmap.

That is **authoring order**. SoW’s editor is **reading order** (roadmap down). Both are right. The product mistake would be making the create path match the read path.

---

## 3. Layers (keep them separate)

```
SoW  ────────────────────────────────────────────  stakeholder / PM
  roadmap → milestone → project (budget) → deliverable (work package)
                                                    │  compile (PHID)
                                                    ▼
bai/project  ─────────────────────────────────────  execution envelope
  team · knowledgeRefs · shipped artifacts · wbsRef
                                                    │
                                                    ▼
bai/wbs  ─────────────────────────────────────────  tasks / goals
  parentId tree · assignee · BLOCKED · notes
```

Rules that do not change:

- No automatic cascades. Completing a goal does not mark a SoW deliverable `DELIVERED`.
- Budget invariants stay in SoW reducers. Goal semantics stay in WBS reducers.
- Cross-links are explicit and independent (same as today’s `wbsRef` / `projectRef`).

---

## 4. Link model (v1)

Minimal glue. One execution pair per compiled deliverable.

**On `bai/project`**

```graphql
sowRef: PHID              # the SoW document, or null
sowDeliverableId: OID     # which deliverable this was compiled into, or null
```

Ops: `LINK_SOW` / clear by falsy, same setter style as `LINK_WBS`.

**On SoW `Deliverable`**

```graphql
executionRef: PHID        # the bai/project, or null
```

The WBS is reached through `project.wbsRef`. Do not also store a WBS PHID on the deliverable in v1 (three pointers will drift).

**Compile** writes both sides, in order, after the remote documents exist — same discipline as `WbsPanel` (server create, then link, then back-link).

**Uncompiled** is legal: `sowRef` null. **Unexecuted** is legal: SoW deliverable with `executionRef` null (a Sky-shaped plan before the team has a project).

Goal-level `goalIds[]` on a deliverable is a v2 if one WBS must feed several deliverables. v1 is 1:1 project ↔ deliverable.

---

## 5. UI patterns

### 5.1 Nav — still one “Projects” tab

Do not add “Scope”. The tab body becomes **two bands**, execution first:

1. **In progress** — today’s `ProjectsView` cards (`bai/project`). This is how the team starts. **New Project** stays here.
2. **Scope of work** — SoW documents (usually one). **New scope** is secondary. Click → `setSelectedNode(sowId)` so the existing SoW editor fills the main pane (sidebar stays), exactly like a project card.

If a vault later standardises on a single SoW, this band can collapse to a jump (Health/Config pattern). Until then it is a list.

Badge on the tab: keep non-ARCHIVED **execution** projects. That is what “how much work is live” means. SoW status (`DRAFT`/`SUBMITTED`/…) is a chip on the SoW card, not the nav count.

### 5.2 Authoring (bottom-up) — no SoW required

Unchanged path:

1. Projects tab → New Project → InitCard → Create WBS → goals.
2. Link notes in **Knowledge** on the project.
3. Agents keep the current goal loop on the WBS.

New, optional, on `project-editor` header (only if a SoW exists in the drive):

> **Compile into scope** → pick a SoW → pick or create a deliverable → writes `executionRef` + `sowRef`.

From a WBS with `projectRef`, the same action is offered as “Compile this project…”.

### 5.3 Compile picker

A small modal, not a new document type:

- Left: this project’s name, goal rollup, knowledge chip count (so you see what you are binding).
- Right: SoW list → that SoW’s deliverables (title, code, already-linked?).
- Footer: **Link to existing** or **Create deliverable in {project code}** (dispatches `addProjectDeliverable` / `addDeliverable` then the two PHIDs).

Disable rows that already have an `executionRef`. No drag-and-drop in v1.

### 5.4 SoW editor (top-down read)

Do not rebuild the SoW shell. Add one row on the deliverable inspector:

- If `executionRef` is set: chip **Execution · {project name}** `{finished}/{total} goals` + **Open**. Click `setSelectedNode(executionRef)`.
- Under it, read-only **Knowledge** chips fetched from that project’s `knowledgeRefs` (title from vault index). Click opens the note. No add/remove here.
- If unset: **Link execution** opens the same picker, filtered to uncompiled `bai/project`s.

Roadmap / milestone / project views can show a small “has execution” mark on deliverable rows. No second tree of goals inside SoW.

### 5.5 Back-links

- `bai/project` header: if `sowRef` set → `Part of {SoW title} · {deliverable code}` (accent link, `setSelectedNode(sowRef)`).
- `bai/wbs`: keep **← Part of project**. That is enough; the SoW is one hop via the project.

### 5.6 Chat / agents

- `list_projects` unchanged (execution).
- Add SoW to the citation contract the way projects were added (documentId + title + type).
- Compile is a human/PM action in v1, not an agent default. Agents still pick `TODO` leaves on a WBS.

---

## 6. Folder and create rules

Keep `/projects/` as the folder for `bai/project`, `bai/wbs`, **and** SoW documents. Drive init already seeds it. Do not invent `/scope/`.

| Action | Creates | Folder |
|---|---|---|
| New Project | `bai/project` only | `/projects/` |
| Create WBS (from project editor) | `bai/wbs` + both PHIDs | `/projects/` |
| New scope | `powerhouse/scopeofwork` | `/projects/` |
| Compile | no new folder; two link ops (+ optional new SoW deliverable) | — |

SoW create is remote-first, same helper as project/WBS.

---

## 7. What we are not doing

| Idea | Why not |
|---|---|
| Second nav tab | Two lists of “what are we working on” |
| Goals inside SoW | Wrong layer; SoW reducers already derive budget/progress from deliverables |
| Copy `knowledgeRefs` onto SoW | Duplicates the vault cite; notes would go stale in two places |
| Replace `bai/project`+`bai/wbs` | Loses the agent loop, knowledge UI, independent docs, no-cascade rules |
| Deliverable-first create | Contradicts how this team starts; makes SoW a gate |
| Auto-roll goal completion → SoW `DELIVERED` | Same reason project deliverables do not auto-close |

---

## 8. Rollout

1. **Nav bands + SoW list** in `ProjectsView`. No schema yet. Existing cards untouched.
2. **Schema glue** (`sowRef`, `sowDeliverableId`, `executionRef`) via MCP on both models. Reducers + tests. No cascades.
3. **Compile picker** on project editor + “Link execution” on SoW inspector. Back-link eyebrow.
4. **Read-only knowledge chips** on the SoW deliverable, sourced from the linked project.
5. Chat: cite SoW documents. Skill: document compile; do not change the goal-working loop.
6. Later, optional: singleton SoW jump; goal-level split; hide uncompiled band once everything is linked.

---

## 9. HTML flows

Open [`index.html`](index.html) (dark vault chrome). Four screens:

| File | What it shows |
|---|---|
| [`01-layers.html`](01-layers.html) | The three layers and the compile arrow |
| [`02-nav.html`](02-nav.html) | Projects tab with execution + scope bands |
| [`03-author.html`](03-author.html) | Bottom-up: brief → tasks → knowledge, no SoW yet |
| [`04-compile.html`](04-compile.html) | Compile picker and the SoW inspector after the link |

---

## 10. Open questions (product, not architecture)

1. One SoW per vault, or several programmes? Nav works either way; singleton is a later shortcut.
2. May one execution project compile into more than one deliverable? v1 says no.
3. Closed/canceled SoW deliverables: keep the execution link visible?
4. Should “Create deliverable in SoW” from the picker also add it to a milestone in the same step, or leave scheduling for the SoW editor?
