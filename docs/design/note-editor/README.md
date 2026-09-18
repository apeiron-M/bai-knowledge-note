# `bai/knowledge-note` editor — design proposal (Six Minds)

**Stage:** design proposal, awaiting green light. **Nothing in the React editor has been changed.**
**Method:** `.claude/skills/six-minds-design-skill.md` — cognitive audit → three Buxton concepts → evidence-based blend.
**Analysis of the current editor:** `editors/knowledge-note-editor/` read in full 2026-09-18 — `editor.tsx` (661 lines) and its seven components (2,338 lines): `status-bar`, `links-section`, `metadata-panel`, `provenance-info`, `topics-bar`, `superseded-banner`, `lifecycle-timeline`.
**Measured against the live vault** (drive `c60679ae`, 2026-09-18), not against an imagined one — every number below is from `knowledgeGraphNodes` / `knowledgeGraphEdges`.

Open `final.html` (`file://` is enough; no build step). Eight states via the switcher bottom-left; light/dark toggle bottom-right. The content is a **real note** — `c661bdd5`, its real body, its real two outgoing and three incoming edges with their real articulations.

## What the vault actually looks like

| | |
|---|---|
| notes | **241**, every one `CANONICAL` |
| edges | **1,135**, **100 % articulated** (every one carries a reason) |
| by type | 462 `CORE_IDEA` · 372 `BUILDS_ON` · 260 `DERIVED_FROM` · 23 `CHILD_MOC` · 18 `RELATES_TO` |
| outgoing links per note | median **3**, mean 2.7, max 7 |
| **incoming links per note** | median **1**, mean 1.6, max **15** |
| maps of content per note | median **2** |
| notes with no topics / no description / description > 200 chars | **0 / 0 / 0** |

Two things follow, and they set the whole design.

**First: there is no hygiene problem to solve.** Every note is complete by the vault's own definition of done. A "this note is unfinished" checklist — the obvious thing to build — would be green 241 times out of 241. It is not worth the screen.

**Second: half of every note's meaning is invisible.** A note's value is its position in the graph, and the editor shows only the outgoing half. 462 `CORE_IDEA` edges mean the median note is held by **two** maps of content and the editor never names one. The median note is pointed at by another note, and for **43 of the 241** more notes point at it than it points out. All of that is *already in memory* — `useKnowledgeNotes` receives every edge in the drive and groups them by source, discarding the rest — so this costs one `filter`, not one query.

## The surface, named first

**Command / Create + Inspect.** Unlike a source (which is read), a note is *authored and curated*: you are stating one claim and wiring it into a graph. The editor must therefore do two jobs at once — let the claim be written and read comfortably, and show where it sits. Today it does the first adequately and the second not at all.

## 🧠 COGNITIVE AUDIT CHECKPOINTS

1. **Vision / Attention.** The claim is the note; it must occupy the optical centre and read as a sentence you can agree or disagree with. Today it is a `text-2xl` textarea with no affordance saying it is a *claim*, sitting above a 400px content box nested in a card inside a card, with a 256px sidebar of metadata permanently taking measure from it.
2. **Wayfinding.** Three questions: *what does this note claim?* (the title), *where does it sit?* (its maps of content and its neighbours — **unanswerable today**), *what state is it in?* (the status pill, which is good). The second is the whole point of a knowledge vault and is the one the editor cannot answer.
3. **Memory / Semantics.** The reader arrives with the source editor's schema — header card, tabs, a sheet — because they have just come from one. Matching it is free comprehension. The link vocabulary (`Builds on`, `Derived from`, `because …`, `grounded`) is already excellent and is kept verbatim.
4. **Language.** The vault's own words, unchanged: *claim, note type, topics, provenance, links, builds on, derived from, contradicts, supersedes, core idea, map of content, grounded / established / speculative, draft → in review → canonical → archived*. No "tags", no "relations", no "metadata score".
5. **Decision making.** The microgoals in order: ① *what does this claim?* → read the title; ② *is it sound?* → read the body; ③ *what does it rest on and who relies on it?* → its edges, **both directions**; ④ *is it filed properly?* → its maps of content; ⑤ *should it advance?* → the lifecycle action; ⑥ *what changed?* → history. Today ③ is half-answered behind a tab and ④ is not answered at all.
6. **Emotion.** The anxiety is not "is my note tidy" — the vault is tidy. It is **"if I change this claim, what breaks?"** Fifteen notes may build on the one you are editing. Showing the incoming edges *before* the edit is the reassurance that matters, and it is exactly what is missing.

## 🎨 DIVERGENT CONCEPTS EVALUATED

| | concept | optimises | costs |
|---|---|---|---|
| **A** | **Minimal** — the claim and the body, everything else behind one "Context" button | Attention: nothing competes with the sentence being written. | Hides the graph again. Re-creates today's central fault in a prettier way. |
| **B** | **Conventional** — the docs-app schema: sticky header, left outline, right inspector, links as a tab | Memory: everyone knows it. | The inspector's permanent width is what already squeezes the note, and the tab is what already hides the edges. |
| **C** | **Graph-first** — the note as a node: neighbours rendered around the body, in/out rails either side | Wayfinding and Emotion: the note's position is the page. | Two rails cost more measure than a sidebar. On a note with 15 incoming edges the claim itself becomes a minority of the screen. |

**The blend:** **C's insight, A's restraint, B's vocabulary, in the source editor's furniture.** The graph belongs on the page, not in a tab — but as a *strip beneath the body*, not as rails beside it. The reading order then matches the microgoals exactly: claim → body → where it sits → (one click) every edge with its reason. Measure is untouched, and a 15-edge note grows the strip instead of crushing the claim.

## Findings in the current editor (the diagnosis this design answers)

| # | finding | evidence |
|---|---|---|
| 1 | **The incoming half of the graph is invisible** | `editor.tsx:63` takes `noteMap.get(id)?.links` — outgoing only. The data for the rest is in the same hook. 462 `CORE_IDEA` + median-1 incoming edges are never shown |
| 2 | **No note ever names its map of content** | nothing in the editor reads `CORE_IDEA`; the median note is in 2 |
| 3 | **`Set provenance first →` renders the escape literally** | `status-bar.tsx:154` — the arrow is JSX *text*, not a string literal, so the screen shows `→`. Confirmed byte-wise: no non-ASCII on that line |
| 4 | **Provenance is write-once through the UI** | `provenance-info.tsx` — the read view has no edit control, so the form is reachable only from the empty state. Once set, author and origin can never be corrected here |
| 5 | **Metadata offers all 27 fields to every note** | `metadata-panel.tsx` never reads `noteType`. A bug pattern is offered `Cardinality`, `Hooks Used`, `Dispatch Targets` |
| 6 | **Changing a link's target silently discards its reason** | `links-section.tsx` `onChangeTarget` passes `{ reason: "", confidence: null }` — the articulation, the thing the vault values most, is dropped without a word |
| 7 | **Removing a link has no confirmation and no undo** | a single `×`; the parent dispatches `REMOVE_RELATIONSHIP` immediately |
| 8 | **Lifecycle and provenance are mutually exclusive** | the sidebar swaps: on History you get the lifecycle timeline, everywhere else provenance + metadata. Neither view shows both |
| 9 | **Provenance dates are date-only** | `toLocaleDateString()` — “17 Sep 2026” cannot distinguish this morning's edit from this evening's |
| 10 | **Two vocabularies for one thing** | the status bar says `In Review`; the lifecycle timeline says `IN_REVIEW → CANONICAL` |
| 11 | **An archived note stays fully editable** | no component tests status for editability |
| 12 | **The note is a box in a card in a card** | `min-h-[400px]` content box (`editor.tsx:410`) inside the `rounded-xl` main card (`:206`) inside `max-w-6xl`, beside a permanent `w-64` sidebar |

Items 6, 7 and 11 are behaviour, not layout. Flagged; the mock does not pretend to fix them.

## Control-by-control audit — nothing is dropped

| current control | where in the code | where it lands |
|---|---|---|
| Status pill (`Draft`/`In Review`/`Canonical`/`Archived`) | `status-bar.tsx` | **header card**, same four labels and tones |
| Flow hint (`Draft → In Review → Canonical`) | `status-bar.tsx` | **header card**, right-aligned beside the action |
| `Submit for Review` / `Approve` / `Reject` / `Archive` / `Restore to Draft` + their actor/comment form | `status-bar.tsx` | **header card** — one action at a time, as today. In `#review` the form is inline and names the author, because the reducer refuses a self-approval |
| `Set provenance first →` nag | `status-bar.tsx:154` | kept, **spelled with a real arrow** |
| Title textarea (auto-growing) | `editor.tsx:255` | **the claim** — same textarea, same auto-grow, now labelled as the claim it is |
| Description textarea, `maxLength 200` | `editor.tsx:275` | **header card**, with a live `188 / 200` budget — the only hard limit in the model deserves to be visible |
| Note-type `<select>` (10 values, lowercased labels) | `editor.tsx:291` | **header card** as a chip-select beside the pill |
| `TopicsBar` chips + `Add topic...` | `topics-bar.tsx` | **header card**, unchanged behaviour; the add field widens from `w-24` |
| Tabs `Content` / `Links` (+count) / `History` | `editor.tsx:324` | **`Note` · `Links` · `Details` · `History`**, counts kept |
| Preview / Edit toggle, content textarea | `editor.tsx:370–443` | `Note` reads, `Edit` writes **the same sheet** — same surface, same width, so switching moves nothing |
| `LinksSection`: type select, target button + kind badge, change-target, remove, `because …`, confidence chip, `+ why does this link exist?`, add form (search / manual, reason required) | `links-section.tsx` | **`Links` view**, all of it, plus two new read-only groups: *what others say about this* and *held as a core idea by* |
| `ProvenanceInfo` (author, source, created, updated, session) | `provenance-info.tsx` | **`Details` view**, with times as well as dates and an edit control that exists after the first save |
| `MetadataPanel` — 18 string fields, 9 list fields, collapsed with a count | `metadata-panel.tsx` | **`Details` view**: the handful that belong to *this* note type first, all 27 behind one disclosure that keeps the count |
| `LifecycleTimeline` | `lifecycle-timeline.tsx` | **`History` view**, beside the revisions rather than instead of provenance; friendly labels, matching the status bar |
| `SupersededBanner` (both variants, verbatim) | `superseded-banner.tsx` | **above the header card**, wording unchanged |
| `RevisionScrubber` / `RevisionSnapshotPanel` / `RevisionOperationList` | `shared/revision-history.tsx` | **`History` view**, unchanged components |

## Schema coverage — every field in `knowledge-note/v1/schema.graphql`

`title` → the claim · `description` → header card + budget · `noteType` → header chip · `content` → the sheet · `status` → pill + lifecycle action · `topics[]` → header row · `provenance{author,sourceOrigin,sessionId,createdAt,updatedAt}` → Details · `lifecycleEvents[]` → History · `updatedAt` → Details · the 18 string and 9 list metadata fields → Details, type-relevant first · `links[]` → **legacy, not read**: edges come from the relationship table, which is also where the incoming ones live.

## Decisions the mock takes (override any)

- **The graph goes on the page, not in a tab.** A strip under the body names the maps of content, counts both directions, and shows what the note was derived from. The full list with every reason is one click away.
- **Incoming edges are read-only here.** They belong to the notes that made them; the `×` is deliberately absent, and opening one takes you to the note that can change it.
- **The sheet is the source editor's sheet.** Same surface, same padding, same `--bai-deep` ground, and the editing textarea is identical to it — so `Note` ↔ `Edit` moves nothing on screen. The two editors are siblings on purpose.
- **The description shows its budget.** 200 characters is the one hard limit in the entire model and it is currently invisible until the field stops accepting keys.
- **Metadata is ordered by the note's type**, not by the model's field order. Nothing is removed — the other fields are one disclosure away, with the count the panel already shows.
- **No "completeness" score.** All 241 notes already pass; a green checklist on every note would be decoration, and inventing a metric to make it interesting would be worse.
- **The claim gets one line of guidance**, not a validator. "A reader should be able to agree or disagree with it" is the rule; enforcing it in code would be guessing.
- **Dark and light are both mocked**, because the app ships both.

## 🔍 SIX MINDS MAPPING (the final)

- **Vision:** the claim at 22px on the surface, the body on the darker sheet, everything else at `--bai-text-faint`; the only accent-coloured things are the active tab, the lifecycle action and the topic chips.
- **Wayfinding:** status pill and flow hint say where the note is in its life; the *Where this sits* strip says where it is in the graph; tabs never move.
- **Memory:** the source editor's furniture, the link vocabulary unchanged, Connect's toolbar untouched above.
- **Language:** *claim, builds on, derived from, core idea, map of content, grounded* — the vault's words, and `because` still introduces every articulation.
- **Decision:** the page answers the six microgoals in the order they are asked, and the destructive ones (archive, remove a link) stay one deliberate step away.
- **Emotion:** the fear is "what breaks if I change this?" — so the notes that build on this one are on the page before you start editing, not behind a tab you would only open afterwards.
