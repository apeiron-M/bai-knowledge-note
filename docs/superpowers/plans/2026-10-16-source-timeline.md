# Source Timeline Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans) with TDD per task, a fresh reviewer per milestone, and a final whole-branch review. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sources › Timeline and Graph › Over time, as approved in the mocks (`docs/design/source-timeline/final.html`).

**Architecture:** One pure builder (`processors/graph-indexer/source-timeline.ts`) turns sources, folders, graph nodes and edges into additions; the knowledge-graph subgraph serves it (`knowledgeGraphSourceTimeline`), the HTTP subgraph mirrors it (`GET timeline`), and the editor calls the query — or, against an older server, builds the same timeline in the browser. The index gains `graph_nodes.added_at` (arrival time). The editor adds a `timeline` view under the Sources place (WorkTabs pattern) and an Over time mode on the graph.

**Tech Stack:** TypeScript (nodenext), Kysely on the processor's relational DB, GraphQL subgraphs, React 19, hand-written SVG, vitest (Node env, `renderToStaticMarkup` for components), oxlint.

**Spec:** `docs/superpowers/specs/2026-10-16-source-timeline-design.md`

## Global Constraints

- Work only in the worktree `../bai-knowledge-note-timeline` (branch `source-timeline`), outside the repo directory — inside it, the main checkout's Vitest collects the worktree's tests; nothing is committed without the user's go-ahead; nothing is published.
- No document-model change, no template change, no new sidebar place (`GuideSources.test.tsx` pins the place list).
- `graph_nodes.added_at` is nullable (tests insert node rows with explicit columns).
- Every colour is a theme token (`--bai-*`, `--v-*` via `role()`); reduced motion stops the pulse and autoplay.
- Quality gates: `bun run tsc`, `bun run lint:fix`, `bun run test`; subgraph changes need `bun run build` before a Switchboard sees them.
- Graph work lands after the other agent's graph find/filter (app-polish Tasks 18–23) and builds on its `scene.visible` mask; merge `ui-upgrade` into this branch first.

## Review Focus

1. A vault whose sources came in one huge burst (921 sources in 7 minutes) — one addition, not 921 rows.
2. A server without the new query (older package) — the timeline still renders, from the browser fallback.
3. Notes older than the vault (imported) — ordered by arrival, written date shown.
4. Notes with no source — shown as such, not dropped.
5. An empty vault, and a vault still processing (waiting sources, notes arriving) — clear states, live progress.

---

### Task 1: The timeline builder — DONE
**Files:** Create `processors/graph-indexer/source-timeline.ts`; Test `tests/processor/source-timeline.test.ts` (16 tests).
**Produces:** `buildSourceTimeline(input: TimelineInput): SourceTimeline`; types `TimelineInput`, `TimelineFolder`, `TimelineSource`, `TimelineNode`, `TimelineEdge`, `SourceTimeline`, `TimelineAddition`, `AdditionKind`, `TimelineArrival`, `TimelineTopic`; constants `NOTE_LINK_TYPES`, `ADDITION_GAP_MS`.

### Task 2: `graph_nodes.added_at` and `KnowledgeGraphNode.addedAt`
### Task 3: `knowledgeGraphSourceTimeline` (GraphQL)
### Task 4: `GET timeline` (HTTP) and docs
### Task 5: Timeline maths for the editor — folded axis, strata, runs, words, day groups
### Task 6: `useSourceTimeline` with the browser fallback
### Task 7: The strata chart component
### Task 8: The ledger and the open row
### Task 9: The Timeline view and its place under Sources
### Task 10: Graph › Over time — visibility by time, spotlight, ring overlay
### Task 11: The time dock
### Task 12: Wiring Over time into GraphView and DriveExplorer (Show in graph)
### Task 13: Docs, full gates, visual check, final review
