# NoteList Scaling Plan (500–1000+ notes)

Status: **Pending**
Created: 2026-04-02
Context: NoteList currently handles 38 notes with pagination (30/page) and memoized cards. This plan addresses bottlenecks that emerge at 500–1000+ notes.

## Current Architecture

```
DriveExplorer
├── VaultSidebar (has search input — filters sidebar only, NOT NoteList)
└── Main content
    ├── Tab bar (Notes, Graph, Sources, Pipeline, Health, Config)
    └── NoteList (receives full unfiltered notes array)
        └── NoteCard (memo'd, paginated at 30/page)
```

**Key files:**
- `editors/knowledge-vault/components/NoteList.tsx` — grid rendering + pagination
- `editors/knowledge-vault/components/DriveExplorer.tsx` — parent, passes `notes` to NoteList
- `editors/knowledge-vault/hooks/use-knowledge-notes.ts` — data fetching + transform
- `editors/knowledge-vault/components/VaultSidebar.tsx` — sidebar search (lines 141–160, 270–284)

**Data flow:**
`useDocumentsInSelectedDrive()` → loads ALL drive documents → `useKnowledgeNotes()` filters to `bai/knowledge-note` type → `.flatMap()` extracts state into `KnowledgeNoteInfo[]` → passed to `NoteList` as `notes` prop.

## Feature 1: Search/filter bar in NoteList

**Problem:** NoteList receives the full unfiltered array. The sidebar has search but it only filters the sidebar listing. At 1000 notes, users must click "Show more" repeatedly to find anything.

**Solution:** Add a search/filter bar above the grid inside NoteList. Filter by title, description, noteType, and topics. Apply filter before `.slice()` so only matching notes are paginated.

**Implementation notes:**
- Add `search` state and a text input above the grid in `NoteList`
- Filter with `useMemo` over `notes` array before slicing for pagination
- Reset `visibleCount` to `PAGE_SIZE` when search query changes
- Consider adding noteType dropdown filter alongside text search
- The sidebar search (VaultSidebar lines 141–160) has a working example of the filter logic: matches on `title`, `name`, `noteType`, and `topics[].name`

**Files to modify:** `editors/knowledge-vault/components/NoteList.tsx`

## Feature 2: Stabilize notes memo to prevent unnecessary rebuilds

**Problem:** `useKnowledgeNotes()` rebuilds the entire `KnowledgeNoteInfo[]` array whenever ANY document in the drive changes — not just knowledge notes. The dependency chain is:

```
useDocumentsInSelectedDrive() changes (any doc edit)
  → docMap rebuilt (line 39–47)
    → notes array rebuilt via flatMap (line 49–81)
      → all NoteCard components receive new note objects
```

At 1000 notes, that's 1000 map lookups + 1000 object allocations every time someone edits a source, MOC, or research claim.

**Solution:** Add structural comparison so the notes memo only updates when knowledge-note documents actually changed. Options:

- Option A: Track a revision hash per knowledge-note document. Only rebuild notes when any knowledge-note's revision changes. Compare previous vs current revision list before running flatMap.
- Option B: Split `useDocumentsInSelectedDrive()` filtering — build a separate memo that only extracts knowledge-note documents from the full list, with a custom equality check on document IDs + revision numbers. This isolates the knowledge-note memo from changes to other document types.

**Files to modify:** `editors/knowledge-vault/hooks/use-knowledge-notes.ts`

## Feature 3: Persist pagination across tab switches

**Problem:** `visibleCount` is React state inside NoteList. When the user switches from Notes tab to Graph tab and back, NoteList remounts and resets to showing 30 notes. If they had expanded to 150, they lose their position.

**Solution:** Lift `visibleCount` state to DriveExplorer (the parent that persists across tab switches) and pass it as a prop to NoteList alongside an `onShowMore` callback. Alternatively, store it in a ref at the DriveExplorer level.

**Implementation notes:**
- DriveExplorer already manages `viewMode` state (which tab is active) — add `noteListVisibleCount` alongside it
- Pass `visibleCount` and `setVisibleCount` to NoteList as props
- NoteList becomes controlled for pagination but keeps its own search state

**Files to modify:**
- `editors/knowledge-vault/components/DriveExplorer.tsx` — lift state
- `editors/knowledge-vault/components/NoteList.tsx` — accept props

## Feature 4 (Future): Paginated data fetching

**Problem:** `useDocumentsInSelectedDrive()` loads ALL documents in the drive into memory — every knowledge note, research claim, source, MOC, and singleton. At 1000 knowledge notes + 248 research claims + sources, that's 1300+ full document states with content, links, topics, and provenance all held in the React tree.

**Solution:** Replace bulk document loading with a paginated or metadata-only query for the NoteList view. Only fetch full document state when a card is clicked/opened.

**This is an API-level change** that depends on `@powerhousedao/reactor-browser` supporting paginated document queries or a metadata-only fetch mode. Not actionable until that API exists — document here for when it does.

**Workaround in the meantime:** The graph indexer subgraph (`knowledgeGraphNodes` query) already has title, description, noteType, and status indexed. NoteList could fetch card data from the subgraph instead of loading full documents, and only load the full document state when a note is opened for editing. This would decouple the list view from the full document store.

**Relevant subgraph query:**
```graphql
query { knowledgeGraphNodes(driveId: "<UUID>") { documentId title description noteType status } }
```

**Files to modify:**
- `editors/knowledge-vault/hooks/use-knowledge-notes.ts` — new data source
- Subgraph may need topics/links fields added to `KnowledgeGraphNode` type
