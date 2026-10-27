# Chat: context from UI state, bottom sheet

[src] code · [inf] inferred · [est] estimate · [spec] speculation

## 1. Current state

- **The drive app persists while an editor is open.** Connect's `AppContainer` renders the drive app with the editor as `children`, and `DriveExplorer` shows `{children}` where the tab content goes (`@powerhousedao/connect/dist/settings-tabs-*.js`) [src]. A sheet there survives navigation. Per-editor sheets unmount on navigation; Connect plugins register drive apps, not overlays [spec].
- **Target resolution** (`target-document.ts`):
  1. the `<select>` pick;
  2. else the one supported document whose title appears verbatim in the request;
  3. else ask, listing every supported document [src].

  No type means 37–39% op accuracy, so it never guesses.
- **Unbounded:**
  - `ChatView` gets `useDocumentsInSelectedDrive()`, the full state of every document.
  - `driveRefContext` makes every note, WBS and project a ref candidate.
  - Step 2 prints them all as `Choices for …` (`args-step.ts:86`) [src].
- **Available state** [src]:
  - `useSelectedDocumentId()` / `useSelectedDocumentSafe()` return the open document inside a drive app and `undefined` on a folder; `useSelectedFolder` and `useNodePathById` also exist.
  - Vault state is component-local: `GraphFocus {selectedId, focusedIds}`, `SearchView` results and `viewMode`.
  - Selection inside an editor (a goal, a link) is below `EditorDocumentProvider`, and no hook exposes it.

## 2. Context model

**The context stack, rebuilt each turn:**
- **Primary:** the open document; its type picks the op catalog.
- **Secondary:**
  - the current folder;
  - visible results, in order: search hits, graph `focusedIds`, the list view;
  - the editor's focused item (needs the bridge in §5);
  - ~20 recently opened or dispatched documents.

**Resolution:**
- "This", "it" and "this note" bind to the open document; `training/data` already has 17× "this note" and 11× "this one" [src].
- A request that names another document as the one to change ("add this to the CRDT MOC") retargets to that document, and the open one becomes a ref [inf].
- Named references ("the note about CRDTs") resolve over visible + recent + top-k search hits, never the whole drive.
- Ordinals ("the second result") index the visible list.

**UI:**
- A header chip, "Acting on: *Title* (Knowledge note) ▾", follows navigation; pin or change it by type-ahead. A retargeted proposal card names both documents.

**Ask only when:**
- nothing is open and nothing resolves;
- the top two candidates are within a small score margin;
- the document type has no ops.

The ask is a top-3 choice.

**Drive-level:** there are no drive ops today [src]; create requests open a pre-filled `CreateDocumentDialog`.

## 3. Scale

- **Never enumerate the drive:** title type-ahead uses `useFileNodesInSelectedDrive()` (id, name, type; already in drive state), and `useDocumentById` loads the target only [inf].
- **Candidates from the existing subgraph** [src]:
  - `knowledgeGraphSemanticSearch` (HYBRID, server-embedded).
  - `knowledgeGraphSearchByEmbedding` with the browser's gte-small: one extra wasm pass, since C's step 1 does not embed [inf].
  - `…Similar`, `…Backlinks`, `…Recent` for the neighbourhood.
- **Coverage gaps:** the indexer covers notes and MOCs only (`graph-indexer/factory.ts:73`), and Connect runs no processors (`processors/connect.ts` is empty). Other document types fall back to node-name matching [src].
- **Cap at ≤10 choices per ref path** [src]: Kev has `nCtx` 1024 (~350 tokens free), and training ref lists are single-digit (`ref-scenarios.ts`).
- **Latency budget:** ≤150 ms for candidates, run in parallel with step 1 (~300 ms) [est].

## 4. UI pattern

**The sheet:**
- A bottom pill ("Ask or change… ⌘J") expands to a ~40%-height panel over the editor; Esc collapses it.
- `position: fixed`, rendered from `DriveExplorer` beside the content area; portal if Connect's `overflow-auto` `DropZoneWrapper` clips it [inf].
- History persists per drive, each turn records its context, and cards and Confirm stay inline. Full-width with a drag handle on mobile [spec]. Remove the Chat tab.

**Borrow:** VS Code Copilot's removable implicit "current file" chip; Cursor's `@`-mentions; Linear and Notion AI acting on whatever is open.

## 5. Framework and training

**A context-provider interface for a reusable `<ChatPanel>`** [spec]:

```ts
interface ChatContextProvider {
  current(): ContextFrame; // primary doc, folder, visible ids, focused item
  candidates(q: string, k: number): Promise<CandidateDoc[]>;
  resolveOrdinal(n: number): CandidateDoc | undefined;
}
```

Editors publish focused items to a shared store that `current()` reads (open design question).

**Training and eval gaps:**
- Implicit targets are covered. Missing: retargeting, ordinal references ("the one above"), and top-k distractor ref lists.
- `moc:ADD_CORE_IDEA.noteRef` is a free `String!` with no `REF_EXTRACTORS` entry, so "this note" has nothing to bind to [src].

## 6. Plan

**M1: sheet and selected-document context, no dropdown (2–3 days [est])**
- Build `ChatSheet` in `DriveExplorer`, with the target from `useSelectedDocumentSafe`, and drop `documents={…}`.
- Bound `driveRefContext` to the top 10 semantic hits.
- Add the chip, the ask states and ⌘J.

**M2: references in the request (3–5 days [est])**
- Lift `GraphFocus` and the search results into a vault store, and add the recent ring.
- Resolve in this order: deictic → ordinal → title or semantic. Gate asks on the score margin.
- Add `@`-mentions and a ~60-item eval set.

**M3: cross-document and drive-level (1–2 weeks [est])**
- Retargeting with training rows, `ADD_CORE_IDEA` / `ADD_CHILD_MOC` extractors, a two-document card.
- Create through the dialog, then a `document-drive` manifest and adapter.

**Open questions:**
1. Should retargeting happen silently (shown on the card) or always be confirmed?
2. Is ⌘J the shortcut?
3. Should history be kept per document or per drive?
4. Server round-trip for candidates, or an in-browser title index for offline use?
