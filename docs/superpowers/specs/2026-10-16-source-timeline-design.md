# Source timeline — design

**Date:** 2026-10-16 · **Status:** approved 2026-10-16 ("I like it! Go and build it!") — the blend in the mocks, both surfaces
**Repo:** `bai-knowledge-note` (graph index, knowledge-graph and HTTP subgraphs, the vault editor)
**Mocks:** `docs/design/source-timeline/` (git-ignored, local): `index.html` overview, `final.html` the approved blend, `README.md` the decisions

## Why

People cannot see their vault's history. The Sources view lists folders and statuses with no dates; the Graph shows only the present; Activity lists note edits and never sees a source. Checked on Liberuum (2026-10-16):

- 1,044 sources came from 8 additions — one PDF became 921 sources in 7 minutes. The unit people think in is the **addition**, not the source.
- Everything arrived on two evenings five days apart, so a linear axis renders two slivers.
- An addition keeps producing notes for hours after it lands (283 notes from the book at the snapshot, 345 an hour later), while 851 of its sources still waited.
- Two clocks: the graph index's `created_at` is when a note was *written* (`global.createdAt ?? provenance.createdAt`); 64 notes an agent imported say 17 September but reached the vault on 15 October (the header's `createdAtUtcIso`).
- 2 notes extracted on 15 Oct have no `DERIVED_FROM` edge and no source lists them.

## Goals

1. **Sources › Timeline** — a second tab beside the folder list ("Folders | Timeline"). It answers in seconds: what did I add and when, what did each thing become, is anything still being worked on, how has the vault grown.
2. **Graph › Over time** — a `Now | Over time` switch on the graph: scrub or play through time and the graph shows what existed at that moment, ringing what just arrived. **Show in graph** on an addition opens this mode with its notes lit.
3. One server call serves the timeline; an editor talking to an older server still works (builds the same timeline in the browser from data it already loads).
4. Times are when things **arrived in this vault**; the written date shows when it is a day or more earlier.

## Non-goals

- Dated links (`graph_edges.created_at`). The blend never plots links over time; in Over time a link shows once both its notes exist. Deferred.
- Replacing the Activity view (open question for later).
- A sidebar place (the guide's test pins the place list), a document-model change, or a template change.
- Fixing the `findDocuments(type, parentId)` paging bug (separate finding; the timeline does not depend on it).

## What an addition is

Computed from data that exists today, by one pure function shared by server and browser:

1. **A folder under `/sources`**: its sources, split where consecutive arrivals are more than 60 minutes apart (a file upload is one addition; a workflow's `Feeds` folder gives one addition per burst; adding to an old folder later makes a new addition).
2. **A source directly in `/sources` (or outside any folder)**: its own addition, except sources sharing one exact state `createdAt` instant — a `sources/batch` call — which form one.
3. **Notes with no source** (no `DERIVED_FROM` to a known source and named in no source's `extractedClaims`) are grouped by origin — *written here* (`MANUAL`, `SESSION_MINE`), *imported* (`IMPORT`) or *no recorded source* (everything else) — and split, like folders, where consecutive arrivals are more than 60 minutes apart (timezone-free, unlike a calendar day).

An addition's time is its earliest source header `createdAtUtcIso` (state `createdAt` is rewritten by every `INGEST_SOURCE`). Its kind for display comes from the original file's MIME type, `provenance.method`/`tool` (`rss`, `arxiv`, `granola`, the knowledge agent), and folder.

## What each addition carries

Title (folder or source title), file name / type / size, who added it, when (first and last source), sources total / extracted / waiting (INBOX + EXTRACTING) / archived, its notes (via `DERIVED_FROM`, then `extractedClaims`), the topics it started (MoCs whose `CORE_IDEA` members are mostly its notes; else the latest addition before the MoC arrived), links among its own notes, links to notes of earlier additions (per earlier addition), its top tags, its most linked notes.

## Data and API

- **Index:** a nullable `graph_nodes.added_at` (varchar, ISO), set to the time the document entered the vault: the header's `createdAtUtcIso` where the processor or reindex can see it, else the document's first operation's time; never overwritten once set. Exposed as `KnowledgeGraphNode.addedAt`.
- **GraphQL:** `knowledgeGraphSourceTimeline(driveId: ID!): KnowledgeGraphSourceTimeline` — additions plus every note's and topic's `{ documentId, addedAt, writtenAt, additionId }` so both views draw from one payload. Read access, same guard as the other read queries.
- **REST:** `GET timeline?drive=<id>` returns the same JSON.
- **Browser fallback:** when the server answers that the field does not exist, the editor builds the timeline from the drive tree, the source states the Sources view already loads, and the graph nodes and edges, using `createdAt` where `addedAt` is missing.

## Sources › Timeline

As in `final.html#timeline` and `#selected`:

- Header: Sources + count, `Folders | Timeline` (`.vault-seg`, the WorkTabs pattern), Paste text, Add sources.
- A summary sentence: "Since <day>, N additions became N notes in N topics…", plus the addition still being read.
- **Strata chart** (hand-written SVG): notes accumulate per addition, oldest addition at the bottom; ◆ where a topic was started; quiet stretches longer than 1/40 of the span (and ≥ 90 min) fold to a labelled break, at most the three longest; labels at *Now* on layers ≥ 17 px; a pulse on the addition still producing notes (none under reduced motion). Runs of consecutive additions under 2.5 % of all notes are drawn as one layer named by what dominates them. Axes over two months tick by month. Hover shows the moment, the layer and the totals; click opens the addition.
- **Ledger:** newest first, sticky day headers ("Today", "Yesterday", weekday + date), one row per addition on a spine: time, kind glyph, title (serif), kind and size, a sentence of what it became, "Linked to N notes from earlier additions", a progress bar while sources wait ("70 of 921 extracted, more arriving now" for the live one). Chips filter by route (Files, Text, Feeds, Agents, Written here, Imported, No source) with counts; a name filter.
- **Open row:** facts (added when, by whom, file, split time, written date), topics it started (first 6, then "and N more"), top tags, how it connected (per earlier addition, links among its own), its 3 most linked notes, actions: Show in graph, Open its sources (the folder in Folders), See its notes.
- **Empty:** "Nothing added yet" with Add sources and Paste text.
- Rows and chart link: hovering one lights the other.

## Graph › Over time

As in `final.html#graph` and `#graph/pick=…`:

- `Now | Over time` switch on the graph. In Over time a dock sits at the bottom: play/pause, the moment (day + time), the strata as a scrubber with ticks at each arrival, and counts (notes, topics). A caption above the dock narrates the latest arrival or the quiet stretch.
- The graph shows only nodes whose `addedAt` ≤ the moment (links when both ends show), combined with the legend's own visibility mask; nodes that arrived in the last 30 minutes get a ring.
- Play runs 15 s across folded time; dragging and arrow keys scrub; space plays/pauses.
- **Show in graph** opens Over time at *Now* with that addition's notes and topics lit and the rest dimmed; "Show everything" clears it.

## Testing

TDD throughout. Pure functions (addition grouping and joins, folded axis, strata stacking and run merging, sentences, day groups) carry most of the logic and the tests. The indexer column, the resolver (with a fake reactor and the test database), the REST route, and the React views (testing-library, canvas mocked) each get their own tests. Quality gates per CLAUDE.md: `bun run tsc`, `bun run lint:fix`, `bun run test`.

## Changes after the final review (2026-10-16)

- **Topics it started** credits a MoC to the addition that supplied most of its notes only when the MoC did not exist before that addition; otherwise it goes to the latest addition at or before the MoC. A topic filled later by a big book is no longer counted as one the book started.
- **Imported notes** (`IMPORT` provenance, no source) are their own group, *Imported notes*, rather than reading as notes whose source was lost. *No recorded source* says the source may have been removed, or the notes were added without one.
- **Source rows in the index.** The graph indexer (on the server) keeps one small row per `bai/source` in `graph_sources` (what the timeline reads, never the text). A refresh reads that table instead of every source document in full; a source without a row yet is read once from the reactor and its row kept. Each row carries the document revision it was read at, and no write replaces a higher one, so a slow read (the backfill, a reindex) never undoes the indexer's newer row; a row of an older `version` is read again. Widening the indexer's filter does not replay history — the first timeline load fills the rows. Writes go in chunks of 1,000 rows; reads ask for a page of ids at a time.
- **A topic made moments before its notes** (within the one-hour burst window) still counts as started by their addition.
- **Arrival times on upgrade.** Rows older than `added_at` start from their first recorded operation's time (migration, ISO times only); the live write keeps the earliest time any operation's header gives, so their next operation — or a reindex — brings the header's own time.
- **Dates in en-US by default,** in the viewer's own time zone, because the copy around them is English. Axis keys and hours are read in a fixed locale with Latin digits, so any locale keeps its ticks.
- **Loads per vault are coalesced:** a refresh asked for while a load runs gets exactly one more load after it; a view that merely opens joins the newest load. The Graph view no longer loads its own copy of the graph; it uses the vault's.
- **The ledger pages** by whole days (about 60 rows, then *Show earlier days*); an addition opened beyond the page widens it for good. Rows are memoised so hovering re-renders two rows, not all.
- **See its notes** opens the Notes list narrowed to the addition's notes, with *Show all notes* to go back. The empty state offers *Paste text*.
- **Over time:** a node the timeline does not know arrives at the dock's *Now*; an addition with nothing in the graph yet no longer dims the whole graph; a failed read says so with *Try again*; the dock announces arrivals, not every frame; the toggle keeps one name; the dock measures itself so the legend stays above it, and narrows at small widths.
