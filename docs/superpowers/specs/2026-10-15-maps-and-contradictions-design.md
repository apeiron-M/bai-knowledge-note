# Maps and contradictions — design

**Date:** 2026-10-15 · **Status:** draft; awaits review
**Repos:** `bai-knowledge-note` (the MoC model, the workflow piece, the graph indexer, the hub route, the editors) and `knowledge-vault-app` (installing one more background workflow per vault). Docs only in `powerhouse-knowledge`.

## Why

Measured on the Liberuum vault in the desktop app on 2026-10-15 at about 19:30 UTC, while its pipeline was working (drive `t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM`). Earlier the same day it had 29 maps; the evening's runs added 10. The design targets the desktop app's default model, gpt-oss-20b on llama.cpp, with a 32k context and one slot.

- **Maps are written once and never again.**
  - 39 maps: 1 HUB, 1 DOMAIN, 37 TOPIC. `updatedAt` equals `createdAt` on all 39, and none has an open question.
  - 26 of the 39 orientations are under 300 characters. 3 mention a disagreement, and all 3 were written by hand on 2026-09-17. None of the 31 the vault wrote does.
  - Place writes an orientation only inside `CREATE_MOC` (`pieces/knowledge-vault/lib/agent/synthesize.ts:160`). Nothing in the piece or the REST routes sends `UPDATE_ORIENTATION`, `ADD_OPEN_QUESTION` or `ADD_TENSION`.
  - The HUB has 29 child maps. Its orientation is still the hub route's default sentence (`subgraphs/http/routes/hub.ts:77`, 98 characters).
- **Topics outgrow their tier, and nothing groups them.**
  - Six topic maps hold 64, 41, 33, 30, 26 and 25 notes. The design's topic holds 3–9, and past about 10 it becomes a domain (`powerhouse-knowledge/AGENT.md:780-791`).
  - Place creates only TOPIC maps (`synthesize.ts:53`, `:160`). The one DOMAIN was made by hand on 2026-09-17.
  - No top-level topic shares a note with another. The links between their notes do cluster: AI System Resources and ML Systems Reasoning have 21 links between their notes, Inference Runtime and ML Systems Reasoning 13, Protocol Financial Metrics and European Crypto 7.
- **Membership has no "why", and the editors would not show one anyway.**
  - 127 of 512 `CORE_IDEA` links carry a reason, and 8 of 38 `CHILD_MOC` links do. All 127 sit on seven of the eight hand-written maps.
  - The 30 maps Place made have none, because Place links without a reason (`synthesize.ts:174`, `:188`). That leaves 385 memberships and 30 child-map links with no phrase.
  - The editors drop the phrases that do exist. `use-knowledge-mocs.ts:116` sets every `contextPhrase` to `""`, although the graph data carries the edge's reason (`use-graph-metadata.ts:90-99`).
  - The map editor's "Why it matters here" field is never sent (`editors/moc-editor/editor.tsx:236-256`, `:522-527`).
- **Contradictions are recorded and then hidden.**
  - There are 2 open contradictions. The indexer opened both on 2026-10-10 from Connect's `CONTRADICTS` links, and both involve "Legacy systems and processes diminish the effectiveness of technology investment".
  - Both links carry a reason ("…indicating a conflict in achieving ROI"). The tension's content is a template that leaves the reason out (`processors/graph-indexer/automation.ts:154-178`), although the indexer has it when it opens the tension (`processors/graph-indexer/index.ts:274-300`). No note's text mentions either contradiction. Read side by side, both pairs look compatible.
  - Only "Technology Investment Strategy" lists them. "AI Enterprise Strategy and Workforce Enablement" holds the other two notes and lists nothing. The indexer adds a tension to the maps that hold either note at the moment the link lands (`automation.ts:361-396`). Connect runs before Place, so a new note's map is never told.
  - The map's Tensions tab shows plain text, with no link and no status (`moc-editor/editor.tsx:585-609`).
  - The Contradictions place, which has the Resolved and Dissolved filters, disappears while none is open (`editors/knowledge-vault/components/DriveExplorer.tsx:184-188`). A closed contradiction is then reachable only from its notes, whose panel calls every tension "Open tensions" (`knowledge-note-editor/components/graph-position.tsx:110`).
- **The hierarchy cannot be seen or changed.**
  - Topics is a flat list sorted by size (`components/TopicsView.tsx:76-93`, `lib/vault-lookups.ts:33-38`).
  - Nothing moves a map or adds or removes a child map.
  - An orientation's paragraphs and italic titles render as one plain paragraph (`moc-editor/editor.tsx:346`).
- **Triangles and bridges exist but are not shown.** `GET triangles` reaches its maximum of 100 pairs, 48 of them inside one map. `GET bridges` returns 59 nodes: 40 notes and 19 maps. No screen shows either (`subgraphs/http/routes/structure.ts:90-95`, `:150-158`).

## Goals

- In the desktop app, on the local model, every orientation the vault wrote stays current. It says what the notes agree on, names every open contradiction involving them, and says where to start. It is rewritten when its map changes.
- The vault never rewrites an orientation that a person or an agent wrote.
- Every membership and child-map link carries a phrase. The 385 + 30 missing ones are filled once, and the editors show, save and edit them.
- An open contradiction is visible wherever its notes are read: on the note, on the map and in Contradictions, with the reason it was recorded. Closed ones stay reachable.
- The maps form a visible tree, and a person can move a topic or group topics under an area.
- `templates/pipeline.json` does not change. There is one additive, replay-safe model field.
- Every screen works in Connect as well. Only the writing work needs a model, and it runs in a workflow.

## Non-goals

- **Changing note text:** no "Contradicts" paragraph in a note and no backward pass that rewrites older notes. The user chose "link only" when a note gains a second source; the same holds here. The backward pass is B's or C's business.
- **Resolving, dissolving or drafting resolutions** with a model. Which side is right is a person's call (`automation.ts:24-26`).
- **Restructuring by the vault:** creating areas, splitting the 64-note topics, merging small maps. The vault config's `mocOversize` (default 40) stays read by nothing.
- **Other writing by the vault:** open questions, and map descriptions.
- **Other homes for triangles and bridges:**
  - automation, which is B's;
  - a warning before archiving, which belongs to C's retire flow;
  - a graph-wide lens.

## Design

### 1. The vault rewrites only orientations it wrote

- **The record:** `bai/moc` gains a nullable `orientationMark: { by: String!, at: DateTime!, members: Int! }`.
  - `CREATE_MOC` and `UPDATE_ORIENTATION` gain an optional `orientationMark` input.
  - Each stores the mark when the input carries one and leaves the field alone when it does not.
  - Each refuses a mark whose `at` is not the operation's own time (`createdAt`, `updatedAt`) or whose `members` is negative: `InvalidOrientationMarkError`.
- **The rule:** an orientation is the vault's while its mark's `at` equals the map's `updatedAt`. Every other writer stamps its own `updatedAt`: `UPDATE_ORIENTATION`, `UPDATE_DESCRIPTION` and `SET_METADATA_FIELD` all set it (`document-models/moc/v1/src/reducers/moc-management.ts:20-27`, `:117`). So the first edit by a person or an agent ends the vault's claim, and they have nothing to do. Relationship writes and `ADD_TENSION` leave `updatedAt` alone, so phrases and the indexer's entries do not end it.
- **Who writes a mark** (`by`, then `members` counts what the map held):
  - Place's `CREATE_MOC`: `place-in-mocs · <model>`.
  - The hub route's `CREATE_MOC`: `hub`.
  - Update maps (§2): `update-maps · <model>`.
  - The map editor's "Let the vault keep it current" (§7): `handed back`, with the current text.
  - The tree's "New area" (§5): `new area`.
- **Existing maps carry no mark.** Update maps adopts a map once when both hold:
  - it was never edited (`updatedAt == createdAt`);
  - it was made by Place (`parentRef` is set: Place is its only writer, `synthesize.ts:160`, and the plugin is told never to write it, `skills/synthesize/SKILL.md:66`), or it is the HUB with the hub route's default text.

  On Liberuum that is 31 maps: 30 topics and the HUB. The 8 maps written by hand (7 topics and the domain, 894–1,934 characters) are left as written.
- **Replay:** no stored operation carries the new input, so every past `CREATE_MOC` and `UPDATE_ORIENTATION` replays to the same state and hash.
  - A snapshot without the field reads as `null`. The generated zod is `.nullish()`, as it is for `orientation` (`v1/gen/schema/zod.ts:115`).
  - The model stays at specification v1, as notes' `updatedAt` and the source's original-file fields did (`docs/superpowers/specs/2026-09-18-document-model-versioning-design.md` §1).
  - The new `initialValue` (`orientationMark: null`) reaches only documents created after the change.
- **Why a field:**
  - Signatures cannot tell writers apart on the desktop engine: the maps Place wrote over REST and the work breakdowns written from the app carry the same `signerKey`.
  - A record kept in the workflow would be lost each time the app sets the pipeline up again, which deletes its side workflows (`knowledge-vault-app/sidecar/src/pipelines.ts:184-186`). The editor could not read it either.
  - A marker inside the text would reach search and the embedding, because the indexer projects the orientation as the map's content (`processors/graph-indexer/project.ts:222`).

### 2. When maps are updated: an Update maps workflow, while the pipeline is idle

- **Not in Place.** During a backlog, the same big topic gains notes from source after source. Revising it inside Place would spend the one local slot again and again and lengthen every source's run. Idle time batches it: each map that changed is rewritten once.
- **The trigger, `maps-to-update` (Maps to update):** it polls every 300 s.
  - It returns nothing while the pipeline is busy, by the Unwoven notes rule (`lib/triggers/unwoven-notes.ts:52-59`).
  - It asks the activity feed (`GET activity?since=<its last check>`) whether anything changed. When nothing did and no map was left due, it stops there.
  - Otherwise it reads `graph.json`, each map, and the contradictions that involve its notes. It then hands over up to "Maps per run" due maps (default 3, range 1–10): the HUB last, the others longest since their orientation was written first.
  - The payload carries `map_ids` and `maps` (`id`, `title`, `why`).
- **A map is due for phrases** when a membership or child-map link it owns has no phrase. This applies to any map, because filling an empty phrase replaces nobody's words.
- **A map is due for its orientation** only when the vault may write it: its mark holds (§1) or it qualifies for adoption. On top of that, one of these must hold:
  - it has no `update-maps` mark yet: it is adopted, carries only Place's creation text, was handed back, or is a new area;
  - the mark's `members` differs from what the map holds now: notes, plus child maps for an area or the HUB;
  - a contradiction involving one of its notes was opened (`observedAt`), resolved or dissolved (`resolvedAt`) after the mark's `at`.
- **Pacing:** a map whose run failed waits an hour and gets at most 3 tries until the map changes again. This is kept in the trigger's store, like Unwoven notes' tried notes (`unwoven-notes.ts:36-43`).
- **The action, `update-maps` (Update maps):**
  - Props: drive, map ids, model and mode (write or dry run).
  - Stages: read, phrases (§4), orientation (§3), write.
  - It takes one map at a time on a local model and up to 3 at once on a hosted one (`isLocalModel`, `lib/agent/llm.ts:63`).
  - Just before writing an orientation it reads the map again. If `updatedAt` has moved since its first read, it writes nothing and reports "edited during the run".
- **The template, `templates/maps.json`:** the trigger and one step on the vault pipeline's connection, written by hand like `reweave.json`.
  - Policy: `QUEUE`, `NOTIFY` on failure, no run deadline, a step timeout of 3600 s.
  - `pipeline.json` and `reweave.json` do not change.
  - On a hosted vault, the same two blocks are built in Workflow Studio, as the templates README says for Reweave.
- **The app installs it** like Reweave: at start and whenever it sets a pipeline up, it is disabled with it, and it is made again from a newer template (§ What changes).

### 3. What an orientation says, and how the local model writes it

- **One model call per map**, which is sent:
  - the map's title, description and tier, and its current orientation, with "keep what still holds";
  - its notes, each with its title, description and phrase, and "built on by N notes here" (its incoming `BUILDS_ON` and `SUPERSEDES` from inside the map), most built-on first;
  - every `CONTRADICTS` and `SUPERSEDES` link among its notes, and up to 30 `BUILDS_ON` links, each with its reason cut to 160 characters;
  - every contradiction involving its notes: the two titles, the status, the link's reason, and the resolution of a closed one;
  - for an area or the HUB, its child maps, each with its title, description, size and phrase;
  - the three maps with the most links between their notes and this map's notes, with the counts.
- **Size:**
  - The note listing gets 12,000 characters on a local model and 40,000 on a hosted one. When the context size is known, it gets at most a quarter of that context at 3.5 characters per token, as Extract's windows do (`2026-10-15-extraction-quality-design.md` §1).
  - Notes past the budget are listed by title only, and then counted.
  - On Liberuum the median listing is 1,676 characters. Only "ML Systems Reasoning and Education" (64 notes, 15,220 characters) is cut.
- **The answer:** `{ "orientation": "…" }`, 2–4 plain paragraphs of 500–1,800 characters (400–1,500 for the HUB). It covers, in this order:
  - what the map covers and what it leaves to other maps;
  - two or three things its notes agree on, stated as claims, not listed;
  - where they disagree: every open contradiction listed, named by its two notes' titles (the other note may sit in another map), with what would settle it. With none listed, it says what the notes leave open. It never invents a disagreement.
  - where to start: the note to read first and why, a pair that together make an argument, and a superseded note to skip;
  - the most related map, and what following it gets the reader.
  - Note and map titles are written in `*asterisks*`, exactly as listed.
- **The HUB's answer** says instead how the maps divide the territory, which ones interlock (it is sent the 8 pairs of child maps with the most links between them) and where to start. An area's answer covers both its own notes and its topics.
- **Checks before anything is written**, in the harness, like Connect's articulation check:
  - the length is in range;
  - every `*title*` matches a note, map or contradiction that the call listed, ignoring case and punctuation;
  - each open contradiction involving one of its notes is named by at least one of its two notes' titles;
  - at least two notes are named, or two maps for the HUB.
- **Repair:** a failed check gets one repair round listing exactly the failures, as Place does (`synthesize.ts:103-109`). If it fails again, nothing is written: the run reports it and the trigger's pacing retries later.
- **The write:** `POST actions` with `UPDATE_ORIENTATION { orientation, updatedAt: T, orientationMark: { by: "update-maps · <model>", at: T, members } }`.
- **The call itself:**
  - `completeJson` with low reasoning and a 6,000-token budget. It uses the active model's timeout and the resend after a model switch (extraction-quality §1a).
  - On the local model a call should take roughly 20–60 s.

### 4. Context phrases

- **From now on, Place writes them**, and Reweave too, through the same code:
  - each placement in `PLACE_SYSTEM`'s answer gains `"why"`: what this note settles or adds in that map, in 6–15 words;
  - each new map gains `"place_phrase"`: what it covers within its parent, in 6–15 words;
  - `writePlacementsStage` sends them as the `reason` of the `CORE_IDEA` and `CHILD_MOC` links it writes.

  This needs no extra model call. A phrase that fails the check below is dropped and its placement kept, and Update maps fills it later.
- **Update maps fills the missing ones**, for every link a map owns: its notes and, for an area or the HUB, its child maps.
  - Calls take up to 20 links each. A call sends the map's title, description and orientation, and each target's title and description.
  - The answer is `{"phrases":[{"target":"<id>","phrase":"…"}]}`. For a child map, the phrase says what it covers within this map.
- **The check:**
  - 20–140 characters;
  - does not start with "This note", "The note" or "About";
  - at least 60% of its words are not in the target's title;
  - contains no ids.

  A failing phrase is not written, and it is tried again on later runs, at most 3 times.
- **The write:** `PATCH relationships` (`UPDATE_RELATIONSHIP`, `subgraphs/http/routes/relationships.ts:25-26`, `:88`). The edge stays; only its reason is set. An existing phrase is never replaced.
- **The backlog on Liberuum:** 385 memberships on 30 maps, and 30 child-map links on the HUB and the domain. That is about 41 calls.
- **The editors show and save phrases** (§7).

### 5. Areas (domain maps): grouped by hand, not by the vault

- **The vault does not create areas.**
  - Moving maps changes where a person finds things.
  - The design's measured signals are weak here. No top-level topic shares a note with another. Grouping by links pulls in 7 topics at 3 links or more, including "Knowledge vault design". At 5 or more it forms {AI System Resources, ML Systems Reasoning, Inference Runtime, Open Models} and {Protocol Financial Metrics, European Crypto}.
  - The defect a person feels most, the 64-note topic, is fixed by splitting, not grouping.
- **A person groups topics in the tree (§7):**
  - "New area" asks for a title and an optional description. It creates the map with `CREATE_MOC { tier: "DOMAIN", orientation: <the description or "">, orientationMark: { by: "new area", … } }` and links it under the HUB.
  - "Move to…" puts topics into the area. Its picker lists the overview and each area, sorted by the number of links between the topic's notes and theirs ("29 links"). That is the design's measured rule, shown as a hint.
- **Update maps then writes** the new area's orientation and its child-link phrases.
- **Place already puts** a new topic under an existing area when one fits (`synthesize.ts:53`, `:71`).

### 6. Contradictions

- **6.1 Visible where the notes are read, without touching their text.**
  - **A "Contested" banner on the note** while a contradiction involving it is open, in the place and style of the superseded banner (`knowledge-note-editor/components/superseded-banner.tsx`). It shows the other note (as a link), the reason on the `CONTRADICTS` link, "Both stand until it is resolved or dissolved", and Open the contradiction.
  - **The note's graph panel** lists all its contradictions under "Contradictions", each with its status, and with its resolution once closed. That list replaces "Open tensions" (`graph-position.tsx:108-111`).
  - **The orientation** names every open one (§3).
- **6.2 The tension carries its reason.**
  - When a `CONTRADICTS` link with a reason opens a tension, the indexer adds "## Why they conflict" with that reason to the content. `index.ts:300` passes the normalised metadata's reason, and `tensionContent` (`automation.ts:154`) gains it.
  - For tensions opened before this, the tension editor's Analysis starts with "Why they disagree", read from the link between its notes, as the Contradictions cards already do (`ContradictionsView.tsx:161-165`, `lib/contradictions.ts:73-85`).
- **6.3 Closed ones stay reachable.** Contradictions is listed while the vault has any contradiction, whatever its status. Its amber count shows only while some are open. A vault that never had one still shows no entry.
- **6.4 A map lists the contradictions among its notes.** The Details tab is renamed "Contradictions" and built from the graph rather than from the map's own `tensions[]`:
  - every contradiction that involves one of the map's notes (`INVOLVES` edges), with its status, its reason and a link that opens it;
  - entries in `tensions[]` without a contradiction document, added by hand, stay as text with their ×.
  - The map's header gains "N open contradictions" when there are any.

  This lists Liberuum's two contradictions on "AI Enterprise Strategy and Workforce Enablement" too, without writing to the map. The indexer's `ADD_TENSION` stays as it is.

### 7. The map UI

- **Topics becomes a tree:**
  - the overview (the HUB) first, as today;
  - then each area, with its topics indented under it;
  - then the topics that hang directly from the overview;
  - each level by size.

  A "New area" button sits beside "New topic", and each topic row has "Move to…". The sidebar's list inside a topic follows the same order (`lib/sidebar-context.ts:149-153`), from a new `topicTree` beside `rankedTopics` (`lib/vault-lookups.ts`).
- **The map editor, Map view:**
  - The orientation renders as Markdown (`MarkdownPreview`), and a note title it names opens that note (`shared/mentions.ts`).
  - Under it, one line says who wrote it. For the vault: "Written by the vault (gpt-oss-20b) on 15 Oct, from 64 notes". For anyone else: "Written on 17 Sep by a person or an agent; the vault leaves it as written". In the desktop app (`isDesktopHost`, `editors/shared/host-config.ts:158`) the vault's line adds "It is rewritten as the topic changes". The other line adds a "Let the vault keep it current" button, shown only there, because only the desktop installs Update maps on every vault.
  - Core ideas show their phrase.
  - Child maps show their phrase. An area gets "Add a topic" and, on each child, "Move out" (back to the overview). Each child of the overview gets "Move to…".
  - "Part of <parent>" gains "Move…".
  - The tier reads "Overview", "Area" or "Topic". The design keeps HUB, DOMAIN and TOPIC out of the reader's words (`docs/design/vault-view/README.md:97`).
- **Details › Ideas:**
  - A phrase can be edited in place, with `UPDATE_RELATIONSHIP`.
  - A note is added through the note finder (`editors/shared/note-finder.tsx:48`) instead of by pasting its id. Its "Why it matters here" is saved as the link's reason, with `ADD_RELATIONSHIP` and `metadata`, as the note editor does (`knowledge-note-editor/editor.tsx:516-529`).
- **Edit:** while the orientation is the vault's, it says: "The vault wrote this and rewrites it as the topic changes. Saving here makes it yours, and the vault will leave your text alone."
- **Moving:**
  - A topic moves under the overview or an area. An area stays under the overview, so the tree keeps three levels.
  - The new parent's `CHILD_MOC` is added first, carrying the old link's phrase, and then the old one is removed. Each write is on its parent's document, and the map is never left without a parent.
- **`use-knowledge-mocs.ts:116`** keeps `edge.reason` as `contextPhrase`, and `childRefs` keep theirs.

### 8. Triangles and bridges: in the note's graph panel

- **Where:** the panel under a note that answers "where does this sit" (`graph-position.tsx`), which is where notes are read and reviewed.
- **"Could link to":** up to 5 notes that link to a note this one also links to, with no link between them. That is the triangles route's shape (`processors/graph-indexer/query.ts:617`). The route counts all seven knowledge link types; this panel counts only the four between notes (`RELATES_TO`, `BUILDS_ON`, `CONTRADICTS`, `SUPERSEDES`), so a shared source or map does not make a pair.
  - It is computed from the graph data the editor already loads, most shared notes first.
  - Each names the note they share. "Link…" opens the existing Add link form (`links-section.tsx:462`) with the target filled in. Type, reason and confidence are asked for as for any link.
- **"Bridge":** shown when `GET bridges` lists the note (fetched once per drive per session; it needs write access, so a reader without it sees nothing). The line reads: "The only route between two parts of the vault: archiving or merging it cuts them apart. A second link from its neighbours removes the risk." "Could link to" is that second link.
- **Why here and nothing more:** both invite one act, a link with a reason, and the note is where a person writes one. Feeding triangles to Reweave is B's. Guarding an archive is C's.

### 9. Testing and measuring

- **The model** (≥ 95% reducer coverage):
  - the mark stored by both operations and kept when absent;
  - each `InvalidOrientationMarkError` case;
  - replay of an operation without the mark gives the same state as before the change.
- **The piece:**
  - every due rule, including adoption: on a fixture shaped like Liberuum, 31 maps adopted and 8 left;
  - the activity short-circuit and the idle check;
  - the listing budget;
  - the checks (titles, contradictions, length) and the repair round;
  - "edited during the run";
  - the writes;
  - Place's phrases and mark;
  - `maps.json` against the template rules.
- **The indexer:** a tension's content with and without a reason.
- **The editors:**
  - the tree and the move rules;
  - phrases shown, saved and edited;
  - the ownership line;
  - the map's contradictions, including the Liberuum case of two maps;
  - when Contradictions is listed;
  - the banner;
  - "Could link to".
- **The app:** Update maps installed, upgraded, disabled and discarded alongside Reweave.
- **Live, on the local model:** the first pass on Liberuum. Measure:
  - the time;
  - orientation lengths;
  - how many name their contradictions;
  - phrase coverage (target: all 512 memberships and 38 child links);
  - a spot-check of 10 maps;
  - both contradictions visible on both maps and on all three notes.

## Decisions for review

1. **Who may rewrite an orientation.**
   - **Recommended:** the vault keeps current only what it wrote, which here means 31 maps, the 30 from Place and the HUB. A person's or an agent's edit makes the map theirs, and one click hands it back.
   - **Alternatives:**
     - The vault rewrites every orientation, which overwrites the 8 hand-written ones (up to 1,934 characters) with the local model's text.
     - Nothing is automatic, with a "Draft an update" button in the editor. That makes model calls from the page, which wait behind the pipeline for the one local slot, and maps go stale unless someone clicks.
   - **Why:** it is the user's no-silent-edits preference applied to maps. History keeps every earlier version either way (`moc-editor/lib/revisions.ts`).
2. **How ownership is recorded.**
   - **Recommended:** a nullable `orientationMark` on `bai/moc`, dispatched through reactor-mcp, additive, at specification v1, with the same replay for every past operation.
   - **Alternatives:**
     - a marker inside the orientation, which reaches search and the embedding;
     - a record in the workflow's store, which is lost when the app sets the pipeline up again and cannot be read by the editor;
     - no record, which leaves no way to honour 1.
   - **Why:** the editor must know whose text it shows, and the record must outlive the workflow.
3. **Where upkeep runs.**
   - **Recommended:** a separate Update maps workflow while the pipeline is idle, installed by the app.
   - **Alternatives:**
     - Place revises the maps it touched, which needs no app change but repeats calls per source during a backlog;
     - a step added to Reweave, which is B's workflow and only fires when notes are unwoven.
   - **Why:** each changed map is written once, and pipeline runs get no slower.
   - **Coordination:** B's scheduled health checks may want the same app mechanism. Whichever lands first generalises `ensureReweave`.
4. **Areas.**
   - **Recommended:** by hand, in the tree, with the link counts as hints.
   - **Alternative:** the vault groups top-level topics with 5 or more links between their notes and has the model name the area. On Liberuum that would create 2 areas and move 6 topics.
   - **Why:** it is a visible restructure on weak signals, and the bigger defect is oversized topics, which grouping does not fix.
5. **Contradictions in note text.**
   - **Recommended:** shown, not written. The banner, the map's list, the orientation and the reason in the tension carry it.
   - **Alternative:** the methodology's "Contradicts" paragraph in both notes (`skills/connect/SKILL.md:121-126`).
   - **Why:** it changes a claim's text without the person, which the user declined for second sources.
6. **The Contradictions place.**
   - **Recommended:** listed while any contradiction exists, with the count only while some are open.
   - **Alternative:** the approved design's "only while a vault has open ones" (`docs/design/vault-view/README.md:132`), with closed ones reached through their notes.
   - **Why:** the Resolved and Dissolved filters are only reachable there.
7. **Filling the missing phrases.**
   - **Recommended:** fill all 385 + 30, never replacing a phrase.
   - **Alternative:** phrases only for new placements.
   - **Why:** the phrase is what lets a reader choose a note without opening it. The Place-made maps, which hold most notes, have none.
8. **Triangles and bridges.**
   - **Recommended:** in the note's graph panel only.
   - **Alternatives:** graph lenses, a map tab, or leaving them out.
   - **Why:** this is the one place the act they invite, a link with a reason, already exists.

## What changes, by file

- **`bai-knowledge-note`:**
  - `document-models/moc`, through reactor-mcp in Vetra, with `backup-documents/Moc.phd` loaded:
    - the state type `MocOrientationMark` and the field `orientationMark`;
    - the inputs `CreateMocOrientationMarkInput` and `UpdateOrientationMarkInput`;
    - `InvalidOrientationMarkError`;
    - the two reducers;
    - `initialValue`.

    Regenerated: `moc.json`, `v1/schema.graphql`, `v1/gen/`. By hand: `v1/src/reducers/moc-management.ts`, `v1/tests/moc-management.test.ts`.
  - `pieces/knowledge-vault/lib/agent/synthesize.ts`: `why` and `place_phrase` in `PLACE_SYSTEM`, `checkPlan` and `writePlacementsStage`; the mark on `CREATE_MOC`.
  - `pieces/knowledge-vault/lib/agent/maps.ts` (new): reading, due rules, adoption, the listing budget, prompts, checks, the repair round, writes.
  - `pieces/knowledge-vault/lib/actions/update-maps.ts` and `lib/triggers/maps-to-update.ts` (new), registered in `pieces/knowledge-vault/index.ts`.
  - `pieces/knowledge-vault/templates/maps.json` (new) and `templates/README.md`.
  - `pieces/knowledge-vault/test/maps.test.ts` (new); Place's existing tests gain phrases and the mark.
  - `processors/graph-indexer/automation.ts` and `index.ts`: the reason in a new tension's content. `tests/processor/tension-automation.test.ts`.
  - `subgraphs/http/routes/hub.ts`: the mark on the HUB's `CREATE_MOC`. `hub.test.ts`.
  - `editors/knowledge-vault/hooks/use-knowledge-mocs.ts`: phrases kept.
  - `editors/knowledge-vault/lib/vault-lookups.ts` (`topicTree`) and `lib/sidebar-context.ts`.
  - `editors/knowledge-vault/components/TopicsView.tsx`: the tree, New area, Move to.
  - `editors/knowledge-vault/components/DriveExplorer.tsx`: when Contradictions is listed.
  - `editors/knowledge-vault/lib/contradictions.ts`: export the reason between two notes.
  - `editors/moc-editor/editor.tsx`, plus new `components/` for moving and the contradictions list: rendering, the ownership line and hand-back, phrases, the note finder, child maps, Move, the contradictions tab, the header count, tier words.
  - `editors/knowledge-note-editor/components/contested-banner.tsx` (new), `editor.tsx`, `components/graph-position.tsx` and `lib/neighbourhood.ts`: the banner, contradictions by status, "Could link to", "Bridge".
  - `editors/tension-editor/editor.tsx`: "Why they disagree".
  - `docs/plans/workflow-piece.md` §18.2: the Update maps row.
- **`knowledge-vault-app`:**
  - `sidecar/src/pipelines.ts`: `maps?` beside `reweave?` on the record. `ensureReweave` becomes one routine for both side workflows, called from `ensure` (`:322`) and at start (`:474-482`); `discard` (`:185`) and `disableAll` (`:517`) cover both. `sidecar/src/pipelines.test.ts`.
  - `sidecar/src/main.ts`: load `maps.json` beside `reweave.json` (`:82-88`) and pass it (`:307`).
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.
- **`powerhouse-knowledge`** (docs):
  - `AGENT.md` § `bai/moc`: the mark, and that an agent's `UPDATE_ORIENTATION` makes the map the agent's.
  - `skills/synthesize/SKILL.md` §6: the same.

## Rollout

1. **The model change.** It needs `ph vetra` running and the Moc document in the vetra drive (import `backup-documents/Moc.phd` if it is not there; your step). Dispatch through reactor-mcp, regenerate, then check `git diff document-models/` for unrelated changes. Then `bun run tsc`, `bun run test:coverage`.
2. **The piece, indexer, hub route and editors.** Build, then test. The hub route is a subgraph, so `bun run build` and a Switchboard restart are needed before it takes effect. Publish a dev version of `@powerhousedao/knowledge-note` (`ph publish --tag dev`; needs your registry login).
3. **The app.** Move it to that version with the side-workflow change, and test.
4. **Restart the app.** Every vault gets Update maps, and Liberuum shows no "needs update".
   - At the first idle window, the first pass begins: 31 orientations and about 41 phrase calls. That is about 72 calls of 20–60 s each on the local model, so roughly 25–70 minutes, 3 maps per run.
5. **Measure and report** as in §9.

## Risks

- **A 20B model writes bland or wrong orientations.**
  - The checks reject invented titles and missed contradictions.
  - History keeps every earlier version, and one edit makes a map a person's.
  - Choosing a hosted model improves every rewrite after the switch.
- **A description edit ends the vault's claim.** This is deliberate and conservative. The ownership line says so, and "Let the vault keep it current" undoes it.
- **The one local slot is shared** with Reweave and the chat. Update maps runs only while the pipeline is idle, llama.cpp queues the requests, and each call has the 10-minute local timeout.
- **Regeneration can rewrite unrelated generated files** (`CLAUDE.md`, "ALWAYS diff after regenerating"). Step 1 checks the diff before anything else lands.
- **Neighbouring specs:**
  - B: the side-workflow mechanism, and Reweave sharing `writePlacementsStage`'s phrases.
  - C: its review list can reuse the contested derivation, and bridges belong in its archive flow.
  - F: Topics view polish.
- **The 64-note topics stay too big.** Their orientations become reading guides, not catalogues. Splitting stays open.
