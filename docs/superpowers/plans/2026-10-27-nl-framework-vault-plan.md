# Vault-side plan: chat context from UI state, then the move onto powerhouse-nl

Date: 2026-10-27. Branch `explore/in-browser-llm`.

**Status.** M0 is implemented as a spike: commits `9dbbdefb`, `e3b337e0`, `abe5ad89`, the retarget fix `2a2f967b`, `68b7c000`, which turns that fix into an ask, and the final pass (`071eb3a1` to `89d6201e`: the top-3 ask for a non-verbatim mention, the Connect checks and the E2E rerun). Notes, QA and the Connect check are in `docs/superpowers/notes/in-browser-llm/connect-c/M0.md`. §3 ticks what landed; what did not land is in §3.9. M1 onward is plan only.

Tags: **[src]** read in code, **[inf]** inferred, **[unverified]** needs a test.

This plan has no time or effort estimates, on purpose.

**Companion plans.** These live in the `powerhouse-nl` repo (private, AGPL-3.0), under `docs/plans/`:
- `00-overview.md`: goal, demo definition, resolved decisions, open items, milestone map, global acceptance criteria, risks;
- `01-m0-vault-context-ux.md`: the cross-repo view of M0, the interfaces M0 must leave clean for extraction;
- `02-m1-runtime-extraction.md` through `07-m5-vault-on-framework-and-release.md`: the later milestones;
- `ph-drive-integration.md`: the ph-drive side.

This file holds the vault's own task list: M0 in full, and what the vault does in M1, M2, M2b, M3 and M5. Where this file and the framework plans differ on the later milestones, the framework plans win; read `IMPLEMENTER-GUIDE.md` there before starting M1.

## 1. Decisions this plan follows

| Topic | Decision |
|---|---|
| Target tag (the user's, binding) | Always visible in the sheet. With a document open: "Acting on: *title* (*type*)". With no document open: the drive name. It updates live as the viewed document changes, including while the sheet is open. A pending proposal card keeps, and shows, the target it was created for. **The tag shows the context target; the card shows the action target.** |
| Retargeting | Switch without asking only when exactly one other supported document's title appears verbatim; the card names both documents and highlights the switch, and the tag stays on the viewed document. **A pointer at the open document turns the switch into an ask**: when the request also says "this", "this note" (doc, one, MOC, …), "it" or "here", the chat asks which document to change before the models run, with two options, "Change *open title*" and "Change *named title*", each with its type. Which one is right depends on the intent ("link this note to *X*" changes the open note, "add this to *X*" changes *X*), and target resolution runs before the models. The models run on the chosen document, and the other one stays a ref candidate. Several names, or two documents sharing the name: the open document. A request that names no other document: the open document. A non-verbatim mention ("the CRDT MOC" for a MOC titled "CRDTs"): ask with the top 3, plus the open document. Nothing dispatches without Confirm. (This follows the overview's Q1; an earlier version of this plan also asked with the top 3 when several documents are named, see `M0.md`.) |
| Pinning | Not in M0 (the tag follows the viewed document). |
| Shortcut | ⌘J on macOS, Ctrl+Shift+Space on Windows and Linux, rebindable. Capture-phase `window` listener. |
| History | One thread per drive, per browser, in IndexedDB, capped, with Clear. Each turn stores its context frame. A ring of about 20 recent documents. The model gets no history. |
| Candidates | Deictic and ordinal first, then visible results and recents, then a lexical index over `useFileNodesInSelectedDrive()`, then the optional `knowledgeGraphSemanticSearch` with a deadline at the end of step 1. Cap at 10 per ref path. Drop gte-small from the chat (its files stay until M3, §4 M1). |
| Install (from M1) | The vault moves to pnpm: `bun.lock` is replaced by `pnpm-lock.yaml`, with a fresh reinstall at the start of M1. |
| Consuming the framework | `link:../powerhouse-nl/packages/<pkg>` during development, so a `powerhouse-nl` directory must resolve beside the vault checkout (a symlink in the parent directory where it is not a sibling; the framework's implementer guide §1). A git dependency replaces `link:` only after the user pushes `powerhouse-nl`. |
| Blind sets | In `powerhouse-nl`'s gitignored `training/artifacts/blind/`; `BAI_BLIND_DIR` points there. Agents never open them. |

## 2. Starting point before M0 [src]

This is the code M0 started from, kept for the record. M0 replaced the Chat tab, the `<select>`, the `documents` prop and the all-documents ref list (§3, and `M0.md`).

- `components/DriveExplorer.tsx` has a `ViewMode` that includes `"chat"`, a `TABS` entry labelled "Chat", and renders `<ChatView documents={documents ?? []} />` in that tab.
- `DriveExplorer` calls `useDocumentsInSelectedDrive()` (full state of every document) for two things: the project badge count, which needs project status, and the chat's `documents` prop.
- `components/ChatView.tsx` keeps `docId` from a `<select aria-label="Target document">` listing every supported document, and its messages in `useState`, so history is lost when the tab changes.
- `chat/core/target-document.ts` `resolveTargetDocument`: the `<select>` pick, else the one supported document whose title appears verbatim, else ask with every supported document.
- `chat/core/ref-candidates.ts`: `driveRefContext` makes every note, WBS and project a ref candidate, and step 2 prints them all (`args-step.ts`).
- The drive app persists while an editor is open, because Connect renders the editor as `DriveExplorer`'s `children`. So a sheet rendered from `DriveExplorer` survives navigation.
- `useSelectedDocumentSafe`, `useSelectedDocumentId`, `useSelectedFolder`, `useNodePathById`, `useFileNodesInSelectedDrive`, `useDocumentById` and `resolveDriveSwitchboard` all exist in reactor-browser at 6.2.2-dev.47.
- Vault UI state that the chat could use is component-local: `GraphFocus {selectedId, focusedIds}`, `SearchView` results, `viewMode`.

## 3. M0: bottom sheet and UI-state context

M0 landed as a spike (Status, top). A ticked box landed as written or with the deviation noted on it. An open box did not land, or landed only in part; each one is also listed in §3.9.

### 3.1 Sheet and shortcut

- [x] New `components/ChatSheet.tsx`, rendered from `DriveExplorer` over the content column. Collapsed, it is a pill (the tag, "Ask or change…", the platform's shortcut label). Expanded, it is a panel of about 45% of the viewport height over the editor, with a handle. Esc collapses it and returns focus. *Deviations:* it is `position: absolute` inside a `relative` column, not `fixed`; the handle only collapses (no drag-resize on narrow screens, §3.9).
- [x] Portal check: Connect's `DropZoneWrapper` does not clip it, so there is no portal. A portal to `body` would also lose the `--bai-*` theme variables, which live on the vault's `data-bai-theme` wrapper.
- [x] Keep it clear of upstream Connect's chat FAB (`fixed bottom-6 right-6 z-40`): the sheet is centered. Whether the FAB is present at 6.2.3 is still **[unverified]** (M5).
- [x] New `chat/ui/hotkey.ts`: ⌘J on macOS, Ctrl+Shift+Space elsewhere, rebindable in the History menu, stored per browser (`bai.chat.hotkey`, wrapped in try/catch). A capture-phase `window` `keydown` listener matching on `KeyboardEvent.code`, so it works while typing in an editor field. Whether Firefox lets the page `preventDefault` ⌘J is still **[unverified]** (§3.9).
- [x] `ChatView`'s body moved into the sheet as `components/ChatPanel.tsx`. The model status rows and settings stay.

### 3.2 Target tag and context frame

- [x] New `chat/context/context-frame.ts`: `ContextFrame`, `ContextTarget` (`{kind: "document", id, driveId, title, docType} | {kind: "drive", id, name}`), `CandidateDoc` and `ChatContextProvider`. The target's shape stays close to reactor-browser's `ai` `ChatContext`.
- [ ] Context provider: landed in part as `hooks/use-chat-context.ts` (not under `chat/context/`). It builds the frame from `useSelectedDocumentId` + `useDocumentSafe` (no suspense), `useSelectedFolder()`, the drive name, the file nodes and the recent ring. `candidates(q, k)` ranks the file nodes lexically and by recency. **Missing:** the vault store (§3.4), so `visibleIds` is empty, there is no `focusedItem`, and `resolveOrdinal` returns `undefined`.
- [x] New `components/ChatTargetTag.tsx`: always in the sheet header and in the pill. With a document: "Acting on: *title* (*type name*)"; with no document: the drive name. It follows navigation live.
- [x] Proposal and choice cards store a `target` at creation and render "On: *title* (*type*)". A retarget adds an amber "Switched target" box naming the viewed document; after navigation the card says "You are now viewing *X*. Confirm still changes *A*." Confirm dispatches to `card.target.id`.
- [ ] `resolveTargetDocument` takes the context frame's target, not a `<select>` id. What landed (`chat/core/target-document.ts`):
  1. exactly one other supported document named verbatim → retarget, flagged for the card (at drive level: target it). A name found only inside a longer mentioned name, the viewed document's own title included, does not count;
  2. **except** when the request also points at the open document ("this", "this note/doc/one/MOC/…", "it", "here"; document names are masked first, and "this *item*" such as "this goal" does not count) and the open document's type has ops: **ask** which of the two to change, on the choice card ("Change *open title* (*type*)", "Change *named title* (*type*)", "Neither"), before the models run. The models then run on the chosen document; the other one stays a ref candidate (the open one is pinned with `driveRefContext`'s `keepIds`). `2a2f967b` kept the open document here instead, which is wrong for "add this to *X*"; `68b7c000` made it an ask. With nothing open, a pointer has no referent and step 1 targets the named document; with an open document that has no ops, only the named one can change, so step 1 retargets;
  3. no document named verbatim, but a phrase refers to another one by type and an inexact name ("the CRDT MOC", "my beehive project", "the note about gossip") → **ask with the top 3** matches (lexical score, recency, title), plus the open document when its type has ops, plus "None of these", before the models run (`071eb3a1`, `4c6bec78`). The chosen one becomes the target; the others stay pinned ref candidates. A phrase that fits the open document at least as well stays on it. Several names, or two documents sharing the named title, stay on the open document (overview Q1);
  4. otherwise → the frame's target, or "no operations for this type" on an unsupported document, or the drive-level path with nothing open.

  **Missing:** ordinal resolution (needs §3.4). Deixis exists only as the step-2 ask, not as a resolution step of its own.
- [x] With no document open: questions are answered; a create request gets "drive-level changes are not supported yet" and a "New *type*" button that opens `CreateDocumentDialog`. Drive ops arrive with M2b.

### 3.3 Removals and the scale fix

- [x] Removed `"chat"` from `ViewMode`, its `TABS` entry and the render branch in `DriveExplorer`.
- [x] Removed the `<select aria-label="Target document">`, the `docId` state and the `documents` prop.
- [x] **Scale fix:** the chat reads no document state up front. The target loads by id at send time (`useGetDocument`), a project's linked plan loads by id for its goals, and candidates come from file nodes plus known titles.
- [x] **Scale fix, project badge:** `DriveExplorer` loads only the `bai/project` documents, through reactor-browser's `useDocumentsByIds` (it exists in the linked build; see the version note in §3.9).
- [x] `DriveExplorer` no longer calls `useDocumentsInSelectedDrive`. Other vault views still do.

### 3.4 Visible results and recents (a small vault store)

- [ ] New `chat/context/vault-context-store.ts`: lift `GraphFocus` (`selectedId`, `focusedIds`) and `SearchView`'s current results into a store the views publish to, plus the active list view's visible ids. Not built (§3.9).
- [x] The recent ring: 20 ids of documents opened or dispatched to, most recent first, kept by `chat/context/chat-session.ts` and persisted with the history.

### 3.5 History

- [x] `chat/context/history-store.ts`: IndexedDB `bai-chat-history`/`threads`, keyed by `driveId`. Each entry stores its text, its target and, for user turns, the tag at send time. Capped at 200 entries per drive, writes queued, Clear in the sheet's History menu. Falls back to memory when IndexedDB throws, and the menu then says "not saved".
- [ ] Load the drive's thread on mount and on drive change: done. **Pending cards are not restored after a reload** (a live card holds the catalog entry, which cannot be cloned into IndexedDB); the thread keeps a "Proposed X on A (waiting for Confirm)" line instead. Navigation and collapsing keep the live card (§3.9).
- [x] The pipeline stays single-turn: no history goes into any prompt.

### 3.6 Bounded candidates

- [ ] `chat/context/candidates.ts`: (1) deictic and ordinal; (2) visible results and recents; (3) a lexical index over file-node names and types; (4) the optional `knowledgeGraphSemanticSearch`; cap at 10. **Landed:** (3) over names and aliases (types are not scored), with recency as the tie-break, and the cap. **Missing:** (1) beyond the retarget guard, (2) visible results, (4) server candidates (§3.9).
- [x] `driveRefContext` takes the bounded candidates: at most 10 per kind, ranked against the request, plus the items the target already refers to, so their labels stay.
- [x] Stale node names (nothing sends UPDATE_NODE after SET_TITLE): known titles (recent ring, open document) are indexed, and a stale node name is kept as an alias.

### 3.7 Tests and eval

- [x] Unit tests: `chat-context` (the frame, candidate ranking and the cap, card-target retention, sessions per drive), `chat-history-store` (fake IndexedDB), `chat-hotkey`, the rewritten `chat-target-document` (resolution order, the pointer guard, ambiguity), `chat-target-document-pick` (the top-3 ask: matching, ordering and cap, drive level, the verbatim rules first, the Connect E2E utterances, ref pinning) and the extended `chat-ref-candidates` (the cap per kind).
- [ ] A retarget and deictic dev set, about 60 items, at `spike/llm-harness/eval/retarget-dev.json` (the framework's M2b path), written by an isolated writer under the eval-set rules (`training/docs/NEW-DOCUMENT-MODEL.md` §3). Items carry a context frame and score the target and the op. Not written (§3.9).

### 3.8 M0 acceptance

Results are in `M0.md` ("QA" and "Connect verification").

- [x] **Tag on open:** opening the sheet with a document open shows its title and type.
- [x] **Tag on navigation:** with the sheet open, navigating to another document updates the tag without reopening the sheet.
- [x] **Tag at drive level:** with no document open, the tag shows the drive name.
- [x] **Card keeps its target:** a proposal on note A, then navigation to project B; the tag shows B and the card still shows A. Confirm: A's global revision +1 (5 → 6), B unchanged.
- [x] **Retarget:** a verbatim single-title mention of another document gives a card naming both, and the tag stays on the viewed document: passed in Connect (viewing a project, naming a note). With a pointer at the open document as well, the chat asks which of the two to change, and the other one is offered as a ref: passed in Connect (ADD_LINK to the named note; ADD_KNOWLEDGE_REF with the open note). A non-verbatim mention asks with the top 3: passed in Connect ("the CRDT MOC": CRDTs, CRDT basics, CRDT pitfalls, the open note, None).
- [x] **Shortcut:** ⌘J on macOS while typing in a field, and Esc, passed. Ctrl+Shift+Space passed on macOS through rebinding, and as the default with the platform reported as Windows. **Not runnable here:** the default on a real Windows or Linux machine, and Firefox ⌘J (§3.9).
- [x] **History:** survives navigation and reload, and Clear empties it, in Connect. Separation per drive passed in Connect with two drives (47 and 3 entries, one IndexedDB record each, after a reload).
- [x] **Removals:** no Chat tab, no target `<select>`; no chat code calls `useDocumentsInSelectedDrive()`.
- [x] **Regression bars:** `npm run chat:parity-c` PARITY OK (template 228/228, loraPick 228/228, gate 216/216, decideOp 216/216, fillArgs 196/196, Kev Δp 0; fresh full run on the pnpm install); in-browser `__baiChatParityC()` in Connect picks 20/20, gate 20/20, args 18/18; `npx vitest run --dir tests/unit` green (427 tests).
- [x] Connect E2E rerun of E1, E2, E3, E5, E6, E7, E8, E10 and E11 from `docs/superpowers/notes/in-browser-llm/connect-c/E2E.md`, through the sheet: all pass (`M0.md`, "Final pass"). They ran on the Studio started before the pnpm reinstall, because a fresh Studio on the pnpm install does not start (§3.9).
- [x] `npm run tsc` and lint add no new errors over the baseline: after the pnpm switch, tsc 1022 → 1022, `chat/` lint errors 0 → 0. Total lint errors went 1720 → 1742, all 22 in the retarget dev-set writer's `spike/llm-harness/eval/retarget-dev-tools/zodcheck.mts` (`dcbbdd6f`).

### 3.9 M0 follow-ups

What M0 left open. M1-UI extracts the sheet as it is; these can land before or after that, in the vault or in `nl-runtime`.

- **Vault context store** (§3.4): graph focus, search results and visible ids, and with them ordinal resolution ("the second result") and `focusedItem`.
- **Studio on the pnpm install does not start** (M1 blocker for any Connect check): Vite cannot resolve `@electric-sql/pglite-tools/pg_dump`, which pnpm does not hoist to the root `node_modules`. And `npx ph` now falls through to a global `ph`, which turned `connect studio` into a `git push` call (rejected by git); use `npx ph-cli` (`M0.md`, "Final pass").
- **Q1 rule differences the retarget dev set shows**, in rules M0 kept: a sentence-initial "This *verb*" ("This contradicts *X*.") is not read as a pointer; an open document that shares its title with another document lets the other one count as named; a name that also occurs inside the open document's title is dropped even where it stands on its own; a non-verbatim mention without a determiner or type noun ("corridor study is done") does not ask (`M0.md`, "Not done").
- **Retarget edge cases the rule leaves to the user or cannot settle**, for the M2b retarget dev set and rows: every pointer-plus-name request asks, also when the intent is clear ("link this note to *X*" always changes the open note), so the ask costs a click there; an anaphoric "it" after a name ("add a question to *X* and tag it") also asks; with nothing open, a pointer does not block a title match.
- **Server semantic candidates** (`knowledgeGraphSemanticSearch` at `resolveDriveSwitchboard(driveId)`, with a deadline).
- **The ~60-item retarget and deictic dev set** (§3.7).
- **Pending cards after a reload** (§3.5): restore them, which needs a serialisable card (op id and input, catalog looked up again on load).
- **Drag-resize** of the panel on narrow screens.
- **Firefox ⌘J** `preventDefault` check, and the Ctrl+Shift+Space default on a Windows or Linux machine (not runnable on this Mac; the default was checked on macOS with the platform reported as Windows).
- **Version drift:** `package.json` pins 6.2.2-dev.47, but `node_modules/@powerhousedao/*` links a local monorepo build at 6.2.3-dev.78. The hooks M0 uses (`useDocumentSafe`, `useDocumentsByIds`, `useGetDocument`) were checked only in that build; recheck them at 6.2.2-dev.47 or after the M1 reinstall. The reinstall has happened (`d2950ef4`), but Studio does not start on it yet (above).

## 4. Later milestones, vault side

### M1: consume `nl-runtime`

The file disposition is the framework's `02-m1-runtime-extraction.md`; this list is the vault's side of it.

- [ ] **Install first.** Switch the vault to pnpm: replace `bun.lock` with `pnpm-lock.yaml` and reinstall at the start of M1. Before the reinstall, record what `node_modules/document-model` and `node_modules/@powerhousedao/*` point at (they link a local monorepo build at 6.2.3-dev.78 today, §3.9), and rerun the §6 bars on the fresh install as the M1 baseline.
- [ ] Depend on the framework through `"nl-runtime": "link:../powerhouse-nl/packages/nl-runtime"` (and the same for the other packages), with a `powerhouse-nl` directory resolving beside the vault checkout. `pnpm -r build` in `powerhouse-nl` before the link resolves.
- [ ] Inject the vault's hand-written manifest (`chat/vault-manifest.ts`), field overrides, artifact manifest (`chat/vault-artifacts.ts`, from today's `C_*` constants) and the `dispatch` executor. Generic core and UI files leave `editors/knowledge-vault/chat/`; every moved or split file keeps a re-export shim at its old path, so the training scripts and `tests/unit/chat-*` keep their imports until M3.
- [ ] `chat/core/model-source.ts` is configuration C's live URL resolver (per-model URL → base URL → `VITE_CHAT_*` env → same-origin dev path), not Round 8 code. It moves to `nl-runtime` `core/`, with optional headers and its "CORS + Range required" comment corrected. Only `ROUND8_GGUF_STEM` and the legacy-URL drop in the settings code stay in the vault, until M5.
- [ ] The v1 retrieval leaves the chat's import graph: no editor or `nl-runtime` file imports `gte-embedder.ts`, `op-embedding-index.ts`, `op-embeddings*.ts`, the v1 gate or `createOpRetriever`. **The files stay until M3**, because `training/gen/prompt-format.ts` and four `tests/unit/chat-*` suites import them. `vendor/onnxruntime-web/` stays too (the v1 embedder and `scripts/gte-wasm-node.ts` use it).
- [ ] Give the M0 files the framework's table does not name yet a disposition before moving anything: `hooks/use-chat-context.ts` (its reactor-browser half → `nl-runtime/reactor-browser`), `hooks/use-chat-session.ts`, `chat/context/chat-session.ts`, `chat/context/chat-document.ts`, `chat/context/candidates.ts`, and `components/ChatPanel.tsx`, which now exists (M0 renamed `ChatView.tsx` to it).
- [ ] Keep the parity item fixtures (`tests/fixtures/chat-c/`, `chat/dev/parity-c-items.json`) here; the harness comes from `nl-runtime`, and `npm run chat:parity-c` stays a vault wrapper with the same env variables.
- [ ] Acceptance: the §6 bars against `nl-runtime`, and no chat-side ORT or gte-small in the browser build.

### M2: generated manifest

- [ ] Run `nl generate`; write `chat.overrides.ts` with only what cannot be derived.
- [ ] Fill the 30 empty spec descriptions (`bai/project`, `bai/wbs`) via MCP from `backup-documents/*.phd`, reconciled with `OP_DESCRIPTIONS`. Diff `document-models/` after regeneration.
- [ ] Deep-equal tests against today's tables, then delete `catalog-models.ts`, the hand tables in `op-catalog`, `ref-candidates` and `vocabularies`, and `op-descriptions.ts` (after Kev's text equality check).

### M2b and M3: training data

- [ ] Retarget rows (another document named as the one to change), deictic and ordinal rows, and ref lists of up to 10 with near misses. Include the cases M0's rule asks on (§3.9): "add this to *X*" (change *X*, the open note as the ref) next to "link this note to *X*" (change the open note), and a pronoun after a name.
- [ ] Grow M0's retarget and deictic dev set (§3.7) and report two numbers on it: verbatim-switch precision, and how often the pointer-plus-name ask fires (with how often its intent was clear). The switch rule stands only at about 95% precision or better; below that the user decides whether it becomes "always ask".
- [ ] Fix `moc:ADD_CORE_IDEA.noteRef` (a free `String!` with no extractor) and add the `ADD_CORE_IDEA` / `ADD_CHILD_MOC` extractors.
- [ ] The vault's `training/` becomes an `nl` config plus its recipes, pools, fixtures and eval sets.

### M5: 6.2.3, drive ops, new weights

- [ ] Bump 6.2.2-dev.47 → 6.2.3 (on the pnpm install from M1); `git diff document-models/`; tsc, lint, tests, coverage. Check that a failed dispatch is not reported as a success (6.2.3 fires callbacks on failure).
- [ ] Mount the document-drive adapter (drive ops in the vault).
- [ ] Ship retrained weights; an isolated writer writes a new vault confirmatory blind set into `BAI_BLIND_DIR` (`powerhouse-nl`'s `training/artifacts/blind/`), run once on the pre-registered weights (held-out-6 is spent).
- [ ] Remove the spike-only paths left by M1: `ROUND8_GGUF_STEM` and the Round 8 URL check, `dropLegacyModelUrl` / `legacyModelNotice`, and `__baiChat*` globals outside dev builds. `model-source.ts` itself moved to `nl-runtime` and stays.

## 5. What stays app-specific in the vault

- `chat.overrides.ts`: field overrides, non-derivable ref targets, cross-document kinds, labels, the `bai/project` branch, vocabularies that are not enums.
- The context provider pieces that read vault UI state (`vault-context-store.ts`, the graph and search views publishing to it).
- The semantic-search candidate source (`knowledgeGraphSemanticSearch`), which depends on the vault's subgraph.
- Training inputs: `training/gen/ref-scenarios.ts`, `ref-pools.ts`, teacher fixtures, person fields.
- Eval sets (dev sets in the repo under `spike/llm-harness/eval/`; blind sets in `powerhouse-nl`'s gitignored `training/artifacts/blind/`, never in the vault's git), parity item fixtures, GGUFs and their artifact manifest.
- The mount in `DriveExplorer` and the `spike/` harness.

## 6. Regression bars (every vault change on the chat path)

| Bar | Command or check |
|---|---|
| Node parity | `npm run chat:parity-c`: template 228/228, loraPick 228/228, gate 216/216 exact and branch, decideOp 216/216, fillArgs 196/196, trie max \|d\| ≤ 1e-3 nat on a fresh full run |
| Browser parity | `await window.__baiChatParityC()` (debug flag): picks 20/20, gate 20/20, args 18/18, Kev \|Δp\| ≤ 0.05, trie median ≤ 0.08 nat |
| Prompt bytes | `tests/unit/training-prompt-format.test.ts` |
| Chat unit tests | `npx vitest run tests/unit/chat-*` |
| Types and lint | `npm run tsc`, `npm run lint:fix`: no new errors over the baseline. Where `oxlint` is not on `PATH`, run the npx-cached `oxlint` with its `tsgolint` on `PATH`, as M0 did |
| Reducer coverage | `npm run test:coverage` ≥ 95% whenever a reducer changes (the M2 description work and the M5 bump) |
| Accuracy (after retraining) | the bars in `training/docs/NEW-DOCUMENT-MODEL.md` §4, on a new confirmatory set, plus paired McNemar on the old dev items |

## 7. Not in this plan

- The `hooks/use-drive-init.ts` race that creates duplicate HealthReport, VaultConfig and PipelineQueue documents on each load. It predates the chat; it needs its own fix.
- An editor focused-item bridge ("this goal" inside the project editor).
- Pinning the tag.
- Multi-device history.
