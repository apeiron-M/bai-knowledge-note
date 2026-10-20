# Scope of Work editor — redesign plan

**Status:** design proposal, awaiting green light. Nothing in the React editor has been changed.
**Review:** open [`index.html`](index.html) (or the three `concept-*.html` files directly). They are self-contained; budgets and progress are computed live with the same rules as the reducers.

**Vault integration** (Projects tab × SoW × WBS, bottom-up compile): [`vault-integration/PLAN.md`](vault-integration/PLAN.md) and [`vault-integration/index.html`](vault-integration/index.html).

---

## 1. What is wrong with the editor today

Findings from reading every screen in `editors/scope-of-work/` (4,325 lines).

**Navigation and orientation**

- The only way in is a tree (`Roadmaps ▸ Milestones`, `Projects`, `Deliverables`, `Contributors`) plus breadcrumbs. The home screen is a title/description form and two tables. There is no overview of budget, progress, dates or blockers anywhere.
- The schema's key fact — a deliverable belongs to **two** containers at once, a milestone (_when_) and a project (_who pays_) — is invisible. Nothing tells you a deliverable is unscheduled or unfunded; you find out when a budget is wrong.
- Roll-ups the reducers compute (project budget, milestone progress, `deliverablesCompleted`) are only shown as small bars inside tables, never as first-class numbers.

**Data entry**

- Creating anything means finding a ghost row and reading the hint _"+ Double-click to add new … (enter or click outside to save)"_. It appears **9 times**. Double-click-to-create is undiscoverable and fails on touch.
- **10 of 10** screens are `ObjectSetTable`-driven, including single-record forms; every list looks and behaves identically regardless of what it holds.
- Progress is entered through three 48-px buttons labelled `-`, `%` and `SP`, then a checkbox or unlabelled number inputs. Nothing explains that reaching 100 % marks the deliverable Delivered.
- `deliveryTarget` is a free-text `TextInput`; dates cannot be sorted or compared (there is a `DatePicker` in the component library, unused).
- Budgeting lives in a modal "Budget Calculator" and a bare "Budget" number field, so the relationship _unit cost × quantity × (1 + margin) = budget_ is never visible while typing.
- No search, no filters, no sorting on the big deliverables table (one `sort(` call in the whole editor).

**Feedback and state**

- Reducer errors (now typed — `InvalidProgressError`, `SetDeliverableNotFoundError`, …) are recorded on the operation but never surfaced; a rejected edit looks like a successful one.
- Empty states are ghost rows; nothing tells a new author what to do first or what "complete" means.

**Visual**

- Default grays, no type hierarchy, `border border-gray-300 p-4 rounded-md` boxes for everything; the layout hard-codes `calc(100vh - 80px)` and reads the sidebar width from a CSS variable via a `MutationObserver`.

## 2. Goals

1. **Populate a scope of work in minutes**, from empty to _Submitted_, without knowing the schema.
2. **Navigate the hierarchy without losing context** — roadmaps → milestones, projects → deliverables — and see both axes of a deliverable at once.
3. **Get the overview in one glance**: budget, progress, next milestone, blockers, what is unscheduled/unfunded.
4. Build on the hierarchy the schema already has, but make the derived numbers the stars, not the tables.

Design principle that follows from the schema: **time is one axis, money is the other, deliverables sit at their intersection.** Every concept below makes that intersection visible.

## 3. Three concepts

### A · Ledger — outline · document · inspector _(recommended shell)_

```
┌──────────────┬────────────────────────────────────────────┬──────────────────┐
│ ◫ Overview   │  SCOPE OF WORK                              │ DELIVERABLE    × │
│ ROADMAPS  +  │  Atlas Platform — H2 2026            [chip] │ [CODE] [title…]  │
│ ▸ Delivery   │  summary… (click to edit)                   │ status  owner    │
│    M1 Alpha ●│ ┌Budget┐┌Progress┐┌Deliv.┐┌Next MS┐         │ ─ Progress ───── │
│    M2 Beta  ◔│ └──────┘└────────┘└──────┘└───────┘         │ [Percent|SP|Done]│
│ ▸ Research   │  Delivery ────●────◔────○────○  (spine)     │ ▁▃▅▇ 65%         │
│ PROJECTS  +  │  Plan   │Unsched│ M1 │ M2 │ M3 │            │ ─ Placement ──── │
│  PLT  $17k   │  PLT    │       │ ▪  │ ▪  │ ▪  │            │ milestone project│
│  API  $19k   │  API    │       │ ▪  │ ▪  │    │            │ ─ Quote ──────── │
│  DOC  €9k    │  Unfund.│  ▪    │    │    │    │            │ unit cost qty    │
│ DELIVERABLES │  Ready to submit?  ✓ ✓ ○ ○ ○ ○  [Fix]       │ margin ▁▃▅ 20%   │
│ TEAM         │                                             │ cost→margin→budg.│
└──────────────┴────────────────────────────────────────────┴──────────────────┘
```

- Left rail is the hierarchy with live signals: progress rings on milestones, budgets on projects, an _Unscheduled_ shortcut when needed.
- The canvas reads like the proposal it is. Roadmap view = vertical **delivery spine** with milestones as notches and their deliverables underneath; project view = a **ledger** (unit × qty → cost → margin → budget, with totals and _Set total budget_ that re-derives margins).
- Every title/description is click-to-edit in place. Lists end in a visible _+ Add …_ row. Rows open the **inspector**, which is the single home for the heavy controls: segmented progress control, placement (schedule / fund), quote with a live calculation, key results.
- Overview = KPIs + spine + **plan matrix** (projects × milestones, with Unscheduled/Unfunded gutters) + a _Ready to submit?_ checklist whose items deep-link to the fix.

**Strengths:** hierarchy always visible; reading and editing in one place; a stable home for complex controls. **Risk:** three panes need ≥ 1180 px; the inspector collapses below that.

### B · Board — the matrix is the home screen

```
┌ Atlas Platform — H2 2026  [chip]                 Budget $36k·€9k  Progress 48%  Delivered 3/10 ┐
│ Plan │ Deliverables 11 │ Budget │ Team 4                                                       │
├──────────┬───────────┬──────────────┬──────────────┬──────────────┐                            │
│          │ Unsched.  │ M1 Alpha ◕   │ M2 Beta ◔    │ M3 GA ○      │   drag card → new column   │
│ PLT $17k │           │ ▪ PLT-01 ●   │ ▪ PLT-02 ⚠   │ ▪ PLT-03     │   (reschedule) or row      │
│ API $19k │           │ ▪ API-01 ◔   │ ▪ API-02 ◔   │              │   (change who pays)        │
│ DOC €9k  │           │ ▪ DOC-01 ●   │ ▪ DOC-02     │ ▪ DOC-03 ⚠   │                            │
│ Unfunded │ ▪ sandbox │              │              │              │   click card → drawer      │
└──────────┴───────────┴──────────────┴──────────────┴──────────────┘                            │
```

- Drag & drop is the primary re-planning gesture; `+` appears in any cell to create a deliverable already scheduled _and_ funded.
- Deliverables tab: filter chips, sortable columns, inline status, multi-select **bulk edit** (status, owner).
- Budget tab: ledger per project with editable margins, _Set total budget_, _Margin for all_, plus a _by milestone_ column showing what each date commits.
- Editing in a slide-over drawer; the board stays visible behind it.

**Strengths:** the best overview and the fastest re-planning; scales to many deliverables. **Risk:** an empty matrix is intimidating; needs C's guidance on first use.

### C · Flow — six guided steps from an empty document

```
┌ 1 Basics ✓ ─┬──────────────────────────────────────┬─ Live summary ───┐
│ 2 Team ✓    │ Step 5 of 6 · Deliverables            │ Projects      3  │
│ 3 Projects ◔│ PLT Platform core            $17,280  │ Milestones    3  │
│ 4 Roadmap ✓ │ CODE  Deliverable  Owner  Milestone  │ Scheduled   7/8  │
│ 5 Deliv.  ◔ │ PLT-01 Op. store   Alice  M1 Alpha   │ Funded      7/8  │
│ 6 Review    │        quote 120 × 80 @ 20% = $11,520 │ Budget $36k·€9k  │
│             │ + Add deliverable to PLT              │ Before you submit│
│             │ cost $24,000 · margin 20% · budget …  │ ✓ Title  ○ Owners│
│             │ [← Roadmap]            [Next: Review →]│ [Submit for rev.]│
└─────────────┴──────────────────────────────────────┴──────────────────┘
```

- Starts **empty** (there is a _Load example data_ button). Each step has a completeness meter; _Submit for review_ unlocks when every check passes; the Review step is exactly what a reviewer sees.
- Deliverables are entered under the project that pays, with owner, milestone and quote on one line; project totals update as you type.

**Strengths:** the fastest path from nothing to a submittable document; teaches the model. **Risk:** wrong shape for ongoing tracking — after submission people live in A or B.

## 4. Recommendation

**Ship A as the shell, with B's board as the Overview's _Plan_ section (including drag & drop), and C's checklist as the empty-state and pre-submit guidance.**

- A keeps the hierarchy you asked to build on, and solves the two worst problems at once: nowhere to see the whole, and nowhere stable to put the complex controls.
- B's matrix is the single best answer to "what pays for what, and when does it land" — it belongs on the overview, not in a separate tool.
- C's completeness checklist is what makes "populate easily" true for a first-time author; as a permanent card on the overview it also tells a returning author what is left.

What is deliberately _not_ in the recommendation: a wizard as the default mode (C's stepper), because the document is edited long after it is first written; and a separate "Deliverables" page as the primary editing surface, because it hides the two axes.

## 5. Visual system

Chosen to sit inside Connect's chrome (Inter, gray-50 canvas, 1 px gray-200 rules, slate dark mode) without looking like a default admin template.

| Token        | Value                      | Role                                         |
| ------------ | -------------------------- | -------------------------------------------- |
| Canvas       | `#F6F7F9` (dark `#0F141B`) | page                                         |
| Panel        | `#FFFFFF` (dark `#161C25`) | cards, rail, inspector                       |
| Ink          | `#1B2230` (dark `#E6EAF0`) | text; also the primary button                |
| Rule         | `#E1E5EB` (dark `#263040`) | borders                                      |
| **Meridian** | `#0E8A7A`                  | progress, delivered, positive money          |
| **Signal**   | `#D98A00`                  | time: milestones, in progress, "unscheduled" |
| **Ember**    | `#C2412B`                  | blocked, rejected, invalid                   |
| Focus        | `#2F5BFF`                  | keyboard focus and selection only            |

- **Type.** _Bricolage Grotesque_ for the document title, section heads and KPI numbers only — it carries the personality; _Inter_ for all UI text, deliberately matching the host; _JetBrains Mono_ for everything that is an identifier or a figure: sequence codes (`M1`), project codes (`PLT`), PHIDs, money, story points. The mono face is doing real work: it makes codes scannable and columns of money align.
- **Signature: the delivery spine.** One line that carries the milestones as notches (numbered because sequence codes _are_ a real order), fills with Meridian as milestones complete, and — in the project ledger and the matrix — aligns money to the same axis as time. It appears horizontally on the overview and vertically inside a roadmap.
- **Structure encodes meaning.** Status chips use one colour family; badges (_Unscheduled_, _Unfunded_, _Unquoted_) appear only when something is missing; empty states are invitations with the next action in them.
- **Motion:** the spine fill and progress bars animate on change; nothing else. `prefers-reduced-motion` disables it.
- **Copy:** plain verbs in sentence case — _Add milestone_, _Schedule_, _Set total budget_, _Mark as delivered_; errors say what happened and what to do (_"Story points: completed must be ≤ total"_).

**Self-critique against the usual AI looks.** Not the cream-serif-terracotta page, not black-with-acid-green, not the broadsheet of hairlines: canvas and rules stay quiet and host-like, the single risk is the display face on headings and the spine. First draft used blue as the accent for everything; changed to Meridian/Signal/Ember because the interface needs three _semantic_ colours (done / time / risk), and a fourth decorative one would have competed with them.

## 6. Populating a scope of work — the intended flow

1. **New document** → Overview shows the _Ready to submit?_ card with six unchecked items; each _Fix_ deep-links.
2. **Title & summary** in place on the overview.
3. **Team** — add contributors by name/PHID; owners and coordinators are picked from this list everywhere.
4. **Projects** — code, title, owner, currency, budget type. Budget is shown as _derived_ from the start.
5. **Roadmap** — milestones with a date picker (stored in the existing `deliveryTarget: String`, ISO), coordinators as chips.
6. **Deliverables** — created from a milestone (_scheduled_), a project (_funded_) or a matrix cell (_both_); the inspector then covers owner, progress kind, placement and quote with the live cost → margin → budget calculation. Badges disappear as placement completes.
7. **Submit** — status changes to Submitted; the reviewer opens the same overview.

Interactions specified across concepts: click-to-edit text; visible _+ Add_ rows; segmented progress control (percent slider / story-point pair / done toggle); _Set total budget_ that re-derives margins (and refuses budgets below cost, as the reducer now does); bulk status/owner edits; filters and sorting; `Esc` to close; typed reducer errors shown inline next to the field that caused them.

## 7. Implementation mapping (after approval)

- **Components** (`editors/scope-of-work/`): `Shell` (rail · canvas · inspector grid), `OutlineRail`, `Overview` (`Kpis`, `DeliverySpine`, `PlanMatrix`, `ReadyChecklist`), `RoadmapView`, `MilestoneView`, `ProjectLedger`, `DeliverablesTable`, `TeamView`, `DeliverableInspector` (`ProgressControl`, `PlacementFields`, `QuoteForm`, `KeyResults`), shared `StatusChip`, `Badges`, `Avatar`, `Money`.
- **Derived values** come from state already maintained by the reducers (`project.budget`, `milestone.budget`, `scope.progress`, `deliverablesCompleted`); the editor computes only view-level sums (per-currency totals, next milestone, checklist).
- **Actions:** every interaction maps to an existing action — `editScopeOfWork`, `add/edit/removeRoadmap`, `add/edit/removeMilestone`, `add/removeCoordinator`, `addMilestoneDeliverable`, `addProjectDeliverable`, `add/removeDeliverableInSet` (drag & drop), `setDeliverableProgress`, `setDeliverableBudgetAnchorProject`, `setProjectTotalBudget`, `setProjectMargin`, `editDeliverable`, `add/edit/removeKeyResult`, `add/edit/removeAgent`. No document-model change is required. Optional later: an `ADD_DELIVERABLE_IN_SET` variant that takes both ids, to make a matrix-cell create a single operation.
- **Errors:** read `operation.error` of the last dispatch (the typed errors landed with the gap fixes) and render it inline.
- **Libraries:** `@powerhousedao/document-engineering` for `Select`, `DatePicker`, `TextInput`, `Textarea`, `Checkbox`, `PHIDInput`, `Dropdown`, `Icon`, `Button`; Tailwind for layout; tokens as CSS variables scoped to the editor root (light/dark via the host's `.dark`). The existing `Sidebar` tree can back `OutlineRail`, or a 60-line custom tree if its macros/pinning get in the way.
- **Phases:** (1) shell, overview (KPIs, spine, checklist), rail, inspector, roadmap/milestone/project views — this alone retires the old editor; (2) plan matrix with drag & drop and the deliverables table with filters/bulk edit; (3) polish: keyboard flow, inline error surfacing, reviewer read-only mode.
- **Tests:** unit tests for the view-level derivations (checklist, per-currency totals, next milestone) and for the action mapping of the drag/drop and quote forms; the reducers are already at 100 %.

## 8. Open questions

1. Mixed currencies: show per-currency totals (as the mockups do), or convert to one reporting currency?
2. Keep `deliveryTarget` as an ISO string behind a date picker, or change the schema to `Date`?
3. Should reviewers get a read-only mode of the same overview, or is the status chip enough?
4. Drag & drop in phase 1 or phase 2?

## 9. Budget model (implemented)

Money flows **bottom-up** by default and can be pinned **top-down** per project.

```
line budget     = unit cost × quantity × (1 + margin %)          ← the quote
project budget  = Σ line budgets                     (derived)   ← default
                | = targetBudget                      (fixed)     ← when a budget is set on the project
milestone budget = Σ line budgets of what is scheduled in it, shown per currency
```

- **Derived** (no `targetBudget`): margins are yours; the total follows the quotes.
- **Fixed** (`targetBudget` set via _Budget_ in the project header, `addProject.budget`, `updateProject.budget` or `setProjectTotalBudget`): the envelope is yours. Every quote whose margin you never typed is _unpinned_ and receives the single margin that makes the lines add up to the envelope — recomputed on every quote change. A margin you type (or _Set margin for all_) is **pinned** and held; pinned lines can be released (unlock) and derived lines pinned (lock) in the ledger or the inspector. With every line pinned there is nothing to solve: the total shows the envelope and the ledger shows the lines' own totals. Cost above the envelope produces a negative derived margin — shown as **Over budget** — not an error. `updateProject({ budget: null })` or _Release_ returns to derived mode, keeping the last margins.
- Every stored number carries at most two decimals (quotes, margins, budgets, progress percentages); inputs accept two decimals; money renders with cents.
- Still open from the review: closed (canceled / won't-do) deliverables count in cost and budget; `expenditure` has no operations.

**Replay caveat.** Reducer semantics changed for `SET_PROJECT_TOTAL_BUDGET` (it now persists an envelope). Clients that rebuild state by replaying a document's history with the current reducers will re-interpret old "set total budget" operations as fixing the envelope; stores that keep state snapshots will not. Demo documents are fine; a production change of this kind belongs in a new model version with an upgrade manifest.

## 10. Implemented since the mockups (not in the concepts)

- **Tables, not grids.** Every list — deliverables in roadmap / milestone / all-deliverables views, the project ledger — is a real `<table>`: shared column widths across rows, right-aligned tabular numbers, one flexible title column that truncates, horizontal scroll as a last resort. Nothing overlaps at any magnitude.
- **Fixed budgets and pinned margins** (§9), a **Spending** card per project (`SET_PROJECT_EXPENDITURE`: actuals / optional cap; percentage derived against the cap, else the budget), 2-decimal numbers everywhere.
- **Deletes are draft-only.** Row-level × on deliverable rows, ledger lines and roadmap milestones, plus the bottom *Remove …* actions, are enabled only while the document status is DRAFT or REJECTED; otherwise they are hidden/disabled with the reason.
- **Inspector expands to a focus modal.** ⤢ in the inspector header lifts the same editor into a centered modal over a blurred, dimmed backdrop, laid out in two columns (identity · progress | placement · quote · key results). Click outside, Esc or × closes it and the selection.
- **Plan matrix**: legend under the grid; *Unscheduled* gutter only when live work lacks a date; *Ready to submit?* hides when every check passes and returns when one regresses.
- Inspector closes on click outside; reducer rejections surface from the dispatch result; dark mode uses `color-scheme` for native controls; the shell fills the viewport by measurement.
