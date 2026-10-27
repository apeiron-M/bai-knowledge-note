# Vault-side plan: chat context from UI state, then the move onto powerhouse-nl

Date: 2026-10-27. Branch `explore/in-browser-llm`. Status: plan, nothing implemented.

Tags: **[src]** read in code, **[inf]** inferred, **[unverified]** needs a test.

This plan has no time or effort estimates, on purpose.

**Companion plans.** These live in the `powerhouse-nl` repo (private, AGPL-3.0), under `docs/plans/`:
- `00-overview.md`: goal, demo definition, resolved decisions, open items, milestone map, global acceptance criteria, risks;
- `01-m0-vault-context-ux.md`: the cross-repo view of M0, the interfaces M0 must leave clean for extraction;
- `02-m1-runtime-extraction.md` through `07-m5-vault-on-framework-and-release.md`: the later milestones;
- `ph-drive-integration.md`: the ph-drive side.

This file holds the vault's own task list: M0 in full, and what the vault does in M1, M2, M2b, M3 and M5.

## 1. Decisions this plan follows

| Topic | Decision |
|---|---|
| Target tag (the user's, binding) | Always visible in the sheet. With a document open: "Acting on: *title* (*type*)". With no document open: the drive name. It updates live as the viewed document changes, including while the sheet is open. A pending proposal card keeps, and shows, the target it was created for. **The tag shows the context target; the card shows the action target.** |
| Retargeting | Switch without asking only when exactly one other supported document's title appears verbatim; the card names both documents and highlights the switch, and the tag stays on the viewed document. Otherwise ask with the top 3. Nothing dispatches without Confirm. |
| Pinning | Not in M0 (the tag follows the viewed document). |
| Shortcut | ⌘J on macOS, Ctrl+Shift+Space on Windows and Linux, rebindable. Capture-phase `window` listener. |
| History | One thread per drive, per browser, in IndexedDB, capped, with Clear. Each turn stores its context frame. A ring of about 20 recent documents. The model gets no history. |
| Candidates | Deictic and ordinal first, then visible results and recents, then a lexical index over `useFileNodesInSelectedDrive()`, then the optional `knowledgeGraphSemanticSearch` with a deadline at the end of step 1. Cap at 10 per ref path. Drop gte-small. |

## 2. Current state [src]

- `components/DriveExplorer.tsx` has a `ViewMode` that includes `"chat"`, a `TABS` entry labelled "Chat", and renders `<ChatView documents={documents ?? []} />` in that tab.
- `DriveExplorer` calls `useDocumentsInSelectedDrive()` (full state of every document) for two things: the project badge count, which needs project status, and the chat's `documents` prop.
- `components/ChatView.tsx` keeps `docId` from a `<select aria-label="Target document">` listing every supported document, and its messages in `useState`, so history is lost when the tab changes.
- `chat/core/target-document.ts` `resolveTargetDocument`: the `<select>` pick, else the one supported document whose title appears verbatim, else ask with every supported document.
- `chat/core/ref-candidates.ts`: `driveRefContext` makes every note, WBS and project a ref candidate, and step 2 prints them all (`args-step.ts`).
- The drive app persists while an editor is open, because Connect renders the editor as `DriveExplorer`'s `children`. So a sheet rendered from `DriveExplorer` survives navigation.
- `useSelectedDocumentSafe`, `useSelectedDocumentId`, `useSelectedFolder`, `useNodePathById`, `useFileNodesInSelectedDrive`, `useDocumentById` and `resolveDriveSwitchboard` all exist in reactor-browser at 6.2.2-dev.47.
- Vault UI state that the chat could use is component-local: `GraphFocus {selectedId, focusedIds}`, `SearchView` results, `viewMode`.

## 3. M0: bottom sheet and UI-state context

### 3.1 Sheet and shortcut

- [ ] New `components/ChatSheet.tsx`, rendered from `DriveExplorer` beside the content area, `position: fixed` at the bottom. Collapsed, it is a pill ("Ask or change… ⌘J", with the platform's shortcut label). Expanded, it is a panel of about 40% of the viewport height over the editor, with a drag handle on narrow screens. Esc collapses it and returns focus.
- [ ] If Connect's `overflow-auto` `DropZoneWrapper` clips it, render it through a portal [inf].
- [ ] Keep it clear of upstream Connect's chat FAB (`fixed bottom-6 right-6 z-40`). That FAB landed after the dev.47 pin; whether it is present at 6.2.3 is **[unverified]**.
- [ ] New `chat/ui/hotkey.ts`: default ⌘J on macOS and Ctrl+Shift+Space elsewhere, rebindable in chat settings, stored per browser (localStorage, wrapped in try/catch). A capture-phase `window` `keydown` listener installed by `DriveExplorer`, so it works while typing in an editor field. Record whether Firefox lets the page `preventDefault` ⌘J **[unverified]**.
- [ ] Move `ChatView`'s body into the sheet (`ChatView` becomes the sheet's content, or is renamed `ChatPanel`). Keep the model status rows and settings.

### 3.2 Target tag and context frame

- [ ] New `chat/context/context-frame.ts`: the `ContextFrame` type, `{ target: {kind: "document", id, title, type} | {kind: "drive", id, name}, folderId?, visibleIds[], focusedItem?, recentIds[] }`. Keep the target's shape close to reactor-browser's `ai` `ChatContext` (`driveId`, `nodeId`, `nodeKind`, `documentType`).
- [ ] New `chat/context/use-chat-context.ts`: builds the frame each render from `useSelectedDocumentSafe()` (the open document, or `undefined` on a folder or the root), `useSelectedFolder()`, the selected drive's name, and the vault store (§3.4). It implements `ChatContextProvider` (`current()`, `candidates(q, k)`, `resolveOrdinal(n)`).
- [ ] New `components/ChatTargetTag.tsx`: always rendered in the sheet header, collapsed or expanded. With a document: "Acting on: *title* (*type name*)", the type name from `documentTypeName()`. With no document: the drive name. It reads only `current().target`, so it follows navigation live.
- [ ] Proposal and choice cards store a `target` when created and render "On: *title* (*type*)". On a retarget, the card names both documents ("On: *CRDTs* (MOC) · you are viewing *CRDT merge semantics*") and highlights the switch. Confirm dispatches to the card's `target.id`, never to the tag's current value.
- [ ] Rewrite `resolveTargetDocument`'s entry so that its input is the context frame instead of a `<select>` id:
  1. deictic ("this", "it", "this note") → the frame's target;
  2. ordinal ("the second result") → `resolveOrdinal`;
  3. exactly one other supported document's title verbatim in the request → retarget, flagged for the card;
  4. a document type with no ops, or nothing open and nothing resolved → ask with the top 3 candidates;
  5. otherwise → the frame's target.
- [ ] With no document open and a request that is drive-level (create a document, a folder), keep the current path: open `CreateDocumentDialog` pre-filled. Drive ops arrive with M2b.

### 3.3 Removals and the scale fix

- [ ] Remove `"chat"` from `ViewMode`, its `TABS` entry and the render branch in `DriveExplorer`.
- [ ] Remove the `<select aria-label="Target document">` and the `docId` state from `ChatView`, and remove the `documents` prop.
- [ ] **Scale fix:** nothing in the chat reads `useDocumentsInSelectedDrive()`. The target document loads with `useDocumentById(target.id)`; candidates come from file nodes (id, name, type).
- [ ] **Scale fix, project badge:** the badge needs project status, so it still reads documents. Load only the `bai/project` documents (their ids from `useFileNodesInSelectedDrive()`, filtered by `documentType`) instead of every document in the drive. If no reactor-browser hook loads a list of ids, add a small vault hook over `useDocumentById` per project id **[unverified: check for a multi-id hook at 6.2.2-dev.47 and 6.2.3]**.
- [ ] Remove `useDocumentsInSelectedDrive` from `DriveExplorer` once both are done.

### 3.4 Visible results and recents (a small vault store)

- [ ] New `chat/context/vault-context-store.ts`: lift `GraphFocus` (`selectedId`, `focusedIds`) and `SearchView`'s current results into a store the views publish to, plus the active list view's visible ids. `use-chat-context` reads it.
- [ ] The recent ring: about 20 ids of documents opened or dispatched to, most recent first, persisted with the history (§3.5).

### 3.5 History

- [ ] New `chat/context/history-store.ts`: IndexedDB database per origin, one object store keyed by `driveId`. Each turn: the user text, the assistant result (proposal, choice, answer, error), the context frame at send time, and the outcome (confirmed, cancelled, none). Capped per drive (oldest dropped), with Clear in the sheet's menu. Fall back to memory when IndexedDB throws (private windows), and say so in the sheet.
- [ ] Load the drive's thread when the sheet mounts or the drive changes. Pending cards are restored with their stored target.
- [ ] The pipeline stays single-turn: no history goes into any prompt.

### 3.6 Bounded candidates

- [ ] New `chat/context/candidates.ts`: (1) deictic and ordinal; (2) visible results and recents; (3) a lexical index over `useFileNodesInSelectedDrive()` names and types; (4) when `resolveDriveSwitchboard(driveId)` returns a URL, `knowledgeGraphSemanticSearch` with a deadline at the end of step 1, merged by id. Cap at 10.
- [ ] `driveRefContext` takes the bounded candidates instead of every document. Step 2 never lists more than 10 choices per ref path.
- [ ] Node names can be stale (nothing sends UPDATE_NODE after SET_TITLE). Where a loaded document's title differs from its node name, index the title too.

### 3.7 Tests and eval

- [ ] Unit tests for the context frame, target resolution order, the history store (fake IndexedDB), the candidate cap, the hotkey parser, and card-target retention.
- [ ] A retarget and deictic dev set, about 60 items, written by an isolated writer under the eval-set rules (`training/docs/NEW-DOCUMENT-MODEL.md` §3). Items carry a context frame and score the target and the op. Stored with the dev sets, so `dedup.py` filters training against it.

### 3.8 M0 acceptance

- [ ] **Tag on open:** opening the sheet with a document open shows its title and type.
- [ ] **Tag on navigation:** with the sheet open, navigating to another document updates the tag without reopening the sheet.
- [ ] **Tag at drive level:** with no document open, the tag shows the drive name.
- [ ] **Card keeps its target:** create a proposal on note A, navigate to note B; the tag shows B and the card still shows A. Confirm: A's global revision +1, B unchanged.
- [ ] **Retarget:** a verbatim single-title mention of a MOC while viewing a note gives a card naming both, and the tag stays on the note. A non-verbatim mention asks with the top 3.
- [ ] **Shortcut:** opens on macOS and on Windows or Linux, also while typing in an editor field. Esc collapses.
- [ ] **History:** survives navigation and reload; separate per drive; Clear empties it.
- [ ] **Removals:** no Chat tab, no target `<select>`; no chat code calls `useDocumentsInSelectedDrive()`.
- [ ] **Regression bars:** `npm run chat:parity-c` PARITY OK (template 228/228, gate 216/216, decideOp 216/216, fillArgs 196/196); in-browser `__baiChatParityC()` picks 20/20, gate 20/20, args 18/18; `tests/unit/chat-*` and `tests/unit/training-prompt-format.test.ts` green.
- [ ] Connect E2E rerun of E1, E2, E3, E5, E6, E7, E8, E10 and E11 from `docs/superpowers/notes/in-browser-llm/connect-c/E2E.md`, through the sheet.
- [ ] `npm run tsc` and `npm run lint:fix` add no new errors over the baseline.

## 4. Later milestones, vault side

### M1: consume `nl-runtime`

- [ ] Depend on `nl-runtime` through `link:` in development. Check that bun resolves it **[unverified]**.
- [ ] Inject the vault's hand-written manifest, overrides and artifact manifest, and the `dispatch` executor. Generic core and UI files leave `editors/knowledge-vault/chat/`.
- [ ] Remove the v1 retrieval (gte-small, op embeddings, `vendor/onnxruntime-web`) and Round 8's `model-source`.
- [ ] Keep the parity item fixtures (`tests/fixtures/chat-c/`, `chat/dev/parity-c-items.json`) here; the harness comes from `nl-runtime`.
- [ ] Acceptance: the regression bars in §3.8, rerun against `nl-runtime`.

### M2: generated manifest

- [ ] Run `nl generate`; write `chat.overrides.ts` with only what cannot be derived.
- [ ] Fill the 30 empty spec descriptions (`bai/project`, `bai/wbs`) via MCP from `backup-documents/*.phd`, reconciled with `OP_DESCRIPTIONS`. Diff `document-models/` after regeneration.
- [ ] Deep-equal tests against today's tables, then delete `catalog-models.ts`, the hand tables in `op-catalog`, `ref-candidates` and `vocabularies`, and `op-descriptions.ts` (after Kev's text equality check).

### M2b and M3: training data

- [ ] Retarget rows (another document named as the one to change), deictic and ordinal rows, and ref lists of up to 10 with near misses.
- [ ] Fix `moc:ADD_CORE_IDEA.noteRef` (a free `String!` with no extractor) and add the `ADD_CORE_IDEA` / `ADD_CHILD_MOC` extractors.
- [ ] The vault's `training/` becomes an `nl` config plus its recipes, pools, fixtures and eval sets.

### M5: 6.2.3, drive ops, new weights

- [ ] Bump 6.2.2-dev.47 → 6.2.3; `git diff document-models/`; tsc, lint, tests, coverage.
- [ ] Mount the document-drive adapter (drive ops in the vault).
- [ ] Ship retrained weights; write and run a new vault confirmatory blind set once (held-out-6 is spent).

## 5. What stays app-specific in the vault

- `chat.overrides.ts`: field overrides, non-derivable ref targets, cross-document kinds, labels, the `bai/project` branch, vocabularies that are not enums.
- The context provider pieces that read vault UI state (`vault-context-store.ts`, the graph and search views publishing to it).
- The semantic-search candidate source (`knowledgeGraphSemanticSearch`), which depends on the vault's subgraph.
- Training inputs: `training/gen/ref-scenarios.ts`, `ref-pools.ts`, teacher fixtures, person fields.
- Eval sets (dev in the repo; blind sets outside git), parity item fixtures, GGUFs and their artifact manifest.
- The mount in `DriveExplorer` and the `spike/` harness.

## 6. Regression bars (every vault change on the chat path)

| Bar | Command or check |
|---|---|
| Node parity | `npm run chat:parity-c`: template 228/228, loraPick 228/228, gate 216/216 exact and branch, decideOp 216/216, fillArgs 196/196, trie max \|d\| ≤ 1e-3 nat on a fresh full run |
| Browser parity | `await window.__baiChatParityC()` (debug flag): picks 20/20, gate 20/20, args 18/18, Kev \|Δp\| ≤ 0.05, trie median ≤ 0.08 nat |
| Prompt bytes | `tests/unit/training-prompt-format.test.ts` |
| Chat unit tests | `npx vitest run tests/unit/chat-*` |
| Types and lint | `npm run tsc`, `npm run lint:fix`: no new errors over the baseline |
| Reducer coverage | `npm run test:coverage` ≥ 95% whenever a reducer changes (the M2 description work and the M5 bump) |
| Accuracy (after retraining) | the bars in `training/docs/NEW-DOCUMENT-MODEL.md` §4, on a new confirmatory set, plus paired McNemar on the old dev items |

## 7. Not in this plan

- The `hooks/use-drive-init.ts` race that creates duplicate HealthReport, VaultConfig and PipelineQueue documents on each load. It predates the chat; it needs its own fix.
- An editor focused-item bridge ("this goal" inside the project editor).
- Pinning the tag.
- Multi-device history.
