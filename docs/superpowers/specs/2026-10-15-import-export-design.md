# Import and export — design

**Date:** 2026-10-15 · **Status:** draft; the decisions at the end await review
**Repos:** `bai-knowledge-note` (the import planner and dialog, the export route and dialog, three route changes, wiki links in the note preview) and `knowledge-vault-app` (native folder dialogs, reading and writing folders, "Start from your notes", Settings)

## Why

Read from the code and measured on the Liberuum vault in the desktop app's local engine (127.0.0.1:4201) on 2026-10-15: 453 notes, 39 maps, 1,613 graph edges.

- **There is no way to bring notes in as notes.**
  - The add menu offers "Write a note", "New topic" and "Paste text as a source" (`editors/knowledge-vault/components/DriveExplorer.tsx:1004-1026`). Files go through Add sources, where Markdown is a source format (`lib/intake-model.ts:753`).
  - So an Obsidian note dropped on the vault becomes a source. The pipeline re-extracts it into model-written claims, and its links, tags and folders are lost.
  - The procedure exists only for agents: `powerhouse-knowledge/skills/import/SKILL.md`. It covers batches of 25, wiki links as edges with the surrounding sentence as the reason, maps for groups of 3+ and `sourceOrigin: IMPORT`.
- **There is no way to take a vault out as something a person can read.**
  - Connect has no vault export.
  - The desktop's Settings › Vaults › "Export documents" (`knowledge-vault-app/host/src/settings/Vaults.tsx:204`) writes JSON states and operation logs in the drive-sync layout under the data folder (`sidecar/src/export.ts:6-19`).
  - Nothing in either app imports that dump. Its only restore path is `scripts/drive-sync/upload.py`, a developer's Python script, and it restores less than it seems:
    - operations are "informational; not replayed" (`scripts/drive-sync/README.md:116`);
    - source originals and figures are lost, because `export.ts` writes no attachments and `handlers/source.py` restores none.
- **The REST surface has pieces of both, not a whole.**
  - `GET notes/:id.md` renders one note, and it writes links as REST URLs, not wiki links (`subgraphs/http/lib/markdown.ts:54-58`).
  - The HTTP plan already anticipated a vault export: "`GET export.zip` (Obsidian vault)" (`docs/plans/http-surface.md:513`).
- **Four routes exist that no screen links to:** `llms.txt`, `llms-full.txt`, `health.json` and `badge.svg` (`subgraphs/http/index.ts:176-187`).
  - **`llms.txt`** is 42 lines of map titles. It is always titled "Knowledge Vault", whatever the vault is called (`routes/llms.ts:50`).
  - **`llms-full.txt`** is 101 KB by default, with only the 64 approved notes. With `includeDrafts=1` it is 342 KB, because 367 of the 453 notes wait for review. The default leaves out 86% of what the vault knows.
  - **`health.json`** has `generatedAt: null`, because no health report has been written. So `badge.svg` says `UNKNOWN` (`routes/health.ts:44-45`).
- **What an import would hit today:**
  - **Literal escapes.** `POST notes` lints with no `allowLiteralEscapes` option, before creating anything and again while writing (`routes/create.ts:118`, `:199`). A note whose code shows `\n` would fail its whole batch with `400 LINT_CONVENTION` (`lib/lint/index.ts:6`, `:96-98`).
  - **One link per request.** `POST relationships` takes a single edge (`docs/http-api.md:30`).
  - **Reasons are required.** A knowledge link needs a reason of at least 20 characters (`lib/articulation.ts:13`, `:38-41`). There is no bare form outside `CORE_IDEA` and `CHILD_MOC`.
  - **Wiki links show raw.** The note preview renders only the `[[cite:…]]` and `[[doc:id|title]]` tokens (`editors/shared/markdown-preview.tsx:233-247`), so an imported `[[wiki link]]` would show its brackets.
  - **Images cannot be kept.** Only `AttachmentRef`-typed fields claim an attachment (`docs/superpowers/specs/2026-09-17-convert-subgraph-design.md:162`), and `bai/knowledge-note` has none.
- **What the desktop is missing:**
  - **Folder drops.** WebKitGTK gives the page a dropped folder's address only, and the sidecar refuses folders (`sidecar/src/dropped-files.ts:40`).
  - **Folder dialogs.** The only native file dialogs are for `.kvbackup` files (`src-tauri/src/lib.rs:157`, `:178`).
- **The direction for this work:** the desktop runs everything; the web gets every part that can run in a browser.

## Goals

- **Bring a vault in.** In the desktop app or Connect, a person brings in an Obsidian vault, a folder of Markdown notes or a `.zip` of one.
  - Notes stay notes.
  - Tags stay on the notes, as their `topics`.
  - Folders and index notes become maps.
  - A link that sits in a sentence becomes a vault link, with that sentence as its reason.
  - Nothing is invented, and the report says what landed and what did not.
- **Take a vault out.** A person takes any vault out as Markdown that opens in Obsidian: a folder on the desktop, a `.zip` on both apps.
  - Every note and map comes with its typed links and their reasons.
  - Each source gets a page.
- **Round trip.** That Markdown imports back into another vault with its notes, maps, typed links and reasons.
- **AI tools.** `llms.txt` and `llms-full.txt` are one click from the vault, and who can read them is stated. The badge appears where a health report exists.
- **The desktop's per-vault export is the Markdown export.** The drive-sync dump is labelled as what it is.
- **No document model change.**

## Non-goals

- **Other import formats:** JSON, Logseq's `key:: value` properties, Notion's database CSVs, Evernote. Their Markdown files import as plain Markdown (§1).
- **Images and attachments inside notes.** They need an `AttachmentRef` field on `bai/knowledge-note`, a versioned model change (CLAUDE.md, "Versioning a document model").
- **Re-import and sync.** A re-import does not update notes already in the vault, and there is no two-way sync with an Obsidian folder.
- **Moving a vault with its history, sources and attached files to a server.** `.kvbackup` stays desktop-to-desktop, and the drive-sync scripts stay the developer path.
- **Other work:**
  - Connecting imported notes to the notes already in the vault by meaning (pipeline completeness, spec B; §3.6 names the one case it needs).
  - Finding near-duplicate notes (review and repair, spec C).
  - Writing the health report that the badge reads (spec B §2).
- **Anonymous note pages.** The map links in `llms.txt` point at `notes/:id.md`, which needs sign-in even when the vault is public. Making those pages readable anonymously is an access change, not part of this work.

## Design

### 1. One portable format, both ways

- **The format:** Markdown files with YAML frontmatter and `[[wiki links]]`, which is what Obsidian, and most tools that export notes, read and write.
- **Both directions:** the import reads it and the export writes it. The export adds a few `kv-` fields (§7) so its output imports back with typed links and reasons.
- **Other tools:** Notion, Logseq, Bear, Roam and Readwise all export Markdown folders, so they import too. Their own syntax beyond Markdown stays as text.
- **JSON is left out.** It has no common shape across tools, agents already have `POST notes`, and Markdown covers the vault's own round trip.

### 2. Import: where it runs

| step | where | how |
|---|---|---|
| choosing the files | **desktop** | "Choose a folder…" opens the native folder dialog (Tauri). The sidecar reads the folder's Markdown and hands it to the page. A folder dropped on the window goes the same way. |
| | **web** | "Choose a folder…" (`<input type="file" webkitdirectory>`), "Choose a .zip…" (unzipped in the page with `fflate`), or a folder dropped on the dialog (`webkitGetAsEntry`) |
| reading, planning, preview | the page, both apps | shared code in `editors/knowledge-vault/lib/import/`. Nothing leaves the computer until the person chooses Import. |
| writing | the vault's REST routes | the same routes the pipeline and the intake use (§4), with their lint, placement and rollback rules (`docs/http-api.md:59-133`) |

- **Not on the server.** A server route would take minutes per request: it would need a job protocol to show progress and a two-step protocol to show a preview, and an 8 MB body cap would split the upload anyway.
- **Not on the desktop only.** That would leave Connect without import, which the direction rules out.
- **The desktop does not depend on the webview's folder input.** It is unverified on WebKitGTK; the native dialog is used instead.
- **Limits per import:**
  - **Notes:** at most 5,000. A larger folder is refused with "Import up to 5,000 notes at a time — choose a subfolder." (§4 has the reason.)
  - **Markdown:** at most 50 MB in all.
  - **Over 5 MB:** a file is left out as too large.
- **Which files are read:**
  - `.md` files, plus `.obsidian/templates.json` and `.obsidian/daily-notes.json`, whose `folder` fields name the templates and daily-notes folders.
  - Skipped and counted: dot-folders (`.obsidian`, `.trash`, `.git`), `*.excalidraw.md` and files whose frontmatter has `excalidraw-plugin` or `kanban-plugin`.
  - Images, PDFs and canvases are counted only, as "Not imported".
  - A `.zip` whose entries share one top folder treats that folder as the vault.

### 3. Import: what becomes what

| in the folder | in the vault |
|---|---|
| a `.md` file | a knowledge note in `/knowledge/notes`, a **draft**, `sourceOrigin: IMPORT` (§3.6) |
| frontmatter `title`, else the file name without `.md` | the title |
| a first line `# <the title>` | dropped, so the title is not shown twice |
| `description` or `summary` | the description; over 200 characters it is cut at a word boundary and ends with "…" (the model's limit, `lib/lint/rules/knowledge-note.ts:59-71`) |
| `type` or `noteType` naming one of the ten note types (`CONCEPT` … `REFERENCE`, any case, spaces or dashes) | the note type; anything else leaves it unset |
| `tags`, and `#tags` in the text | the note's `topics` (`ADD_TOPIC`), named as written: `#area/sub` → `area/sub` |
| `aliases` | used to resolve links; not stored |
| `author` | the provenance author; otherwise `import · <folder name>` |
| other properties | one line at the end of the note (§3.5) |
| the file's path | `SET_METADATA_FIELD filePath`, for example `Zettelkasten/Atomic notes.md` |
| the body | the content, with every link kept as written |
| a link inside a sentence | a "Relates to" link whose reason is that sentence (§3.1) |
| a link with no sentence around it | stays in the text only (§3.1) |
| a folder, a note tagged `moc`, a folder note, a list of links | a map (§3.3) |
| a file over 20,000 characters | a source, queued for the pipeline (§3.4) |

- **The write.** Each note is written the way extraction writes its notes (`pieces/knowledge-vault/lib/agent/write.ts:69-87`):
  - `SET_TITLE`, `SET_DESCRIPTION`, `SET_NOTE_TYPE`, `SET_CONTENT`, `ADD_TOPIC`…, `SET_METADATA_FIELD filePath`;
  - `SET_PROVENANCE { author, sourceOrigin: "IMPORT", createdAt: <when the import started, UTC Z> }`;
  - no lifecycle action.
- **Its name** is slugged like the pipeline's (`write.ts:33-40`) and made unique within each request. `POST notes` refuses duplicate names in one request (`routes/create.ts:96-103`), so a clash gets `-2`, `-3`.
- **Dates.** The file's own dates do not become `createdAt`: an imported note would otherwise look years old to the vault's recent and stale checks, the mistake the import skill records for sources. They are kept as text (§3.5).
- **An empty file** (no text beyond its title) is skipped and counted.

#### 3.1 Links

- **What counts as a link:**
  - `[[target]]`, `[[target|shown text]]`, `[[target#heading]]`, `[[target#^block]]` and `![[target]]` (an embed);
  - Markdown links to a `.md` file in the folder: `[text](Other%20note.md)`.
  - Links inside code, inline code and `%% comments %%` are ignored.
- **Resolving a target,** as Obsidian does:
  1. the exact path;
  2. else the file name, ignoring case; when two files share it, the one in the same folder, then the shortest path;
  3. else an `aliases` entry;
  4. else the title of a note already in the vault (§4).
  - A target that resolves to nothing is counted as "points at notes that aren't in the folder".
  - A link to the note itself is ignored.
- **The sentence rule:**
  - **What counts as the sentence:** a link becomes a vault link only when the sentence it sits in says something besides the link. The sentence is cut from its paragraph, list item or table cell at `.`, `!` or `?` followed by a space.
  - **The test:** at least 20 characters must remain once that link's own text is taken out. Other links in the sentence count as taken out too.
  - **The stored reason** is the whole sentence: each link written as its shown text, Markdown marks removed, cut at 500 characters on a word boundary.
  - **Type and confidence:** the type is `RELATES_TO`, since the folder does not say more, and no confidence is set.
  - **Examples:**
    - "Atomic notes make [[links]] precise because each has one target." → a link, with that sentence as its reason.
    - "- [[Zettelkasten]] — the slip-box method this vault follows" → a link: the item's own words carry it.
    - "See also [[Zettelkasten]]", "- [[A]]", "Compare [[A]] with [[B]]" → no link; they stay in the text.
- **Edge identity:** one edge per source, target and type. When a note links the same target twice, the first sentence that passes wins.
- **Links in the text stay as written.** The note editor's preview draws them (§5.5), and the export writes them back (§7.3).

#### 3.2 Tags become the notes' `topics`

- **Where tags come from:** frontmatter `tags` (a list, or a string split at commas and spaces, `#` removed), and `#tags` in the body.
- **What a body tag looks like:** letters, digits, `_`, `-` and `/`, not only digits.
- **What is not a tag:** a heading `# `, a URL fragment, or anything inside code.
- **Duplicates** within a note (ignoring case) count once.
- **Markers:** `moc` marks a map (§3.3) and is not added as a topic.
- **From a vault export:** a file with a `topics` field takes its names from there verbatim, ignoring `tags` (§7.2).

#### 3.3 Maps

- **Folder maps:**
  - **When a folder becomes a map:** it holds 3 or more imported notes directly, and no more than the vault's map limit (`mocOversize`, 40 by default: `document-models/vault-config/v2/src/reducers/config-management.ts:147`). A folder with 2 or more maps below it is also a map, whatever its own count.
  - **The map** is named after the folder. Its own notes are its core ideas, unless they are over the limit.
- **Note maps** come from three kinds of note:
  - a note tagged `moc`, or with `type: moc` or `type: map`;
  - a folder note: a note named like its folder, which becomes that folder's map instead of a second one;
  - a list of links: at least 5 links, and lines with links are most of its non-empty lines.
    - The preview names these and offers "Make them topic maps", on by default.
  - The note's links to notes become core ideas.
    - A core idea's reason is the list item's own words, without the link, but only when they pass the maps spec's phrase check (its §4: 20–140 characters, at least 60% of the words not in the note's title, no ids).
    - Otherwise the link is bare, which `CORE_IDEA` allows, and the vault's Update maps can write the phrase later.
  - Its links to other maps make those maps its children.
  - Its body becomes the map's orientation.
- **Tier and parent: three levels, as the maps spec keeps them** (overview, area, topic: `2026-10-15-maps-and-contradictions-design.md` §7):
  - **"Above"** means the note map that lists it, else the map of its folder's nearest ancestor.
  - **A top-level map** (no map above it) with any map below it is an area (DOMAIN) under the HUB. A top-level map with nothing below it is a topic (TOPIC) under the HUB.
  - **Every map below an area** is a topic under that area, however deep its folder. Deeper nesting folds into the area, so no topic sits under a topic and no area under an area.
  - **Nothing becomes the HUB.** The vault has one, and `POST hub` creates it if it is missing (`routes/hub.ts`).
  - **Two maps that list each other:** the second is attached to the HUB instead, and the report says so.
- **The parent is the `CHILD_MOC` link alone; `CREATE_MOC` gets no `parentRef`.**
  - The maps spec takes a never-edited map with `parentRef` set as one Place made, and keeps its orientation current (its §1). An imported map must not pass for Place's, or the vault would rewrite a person's own index note.
  - The vault already reads parents from `CHILD_MOC` links (`synthesize.ts:42`).
  - If that spec's `orientationMark` has landed, a folder map's generated orientation carries `{ by: "import", at: <its createdAt>, members }`, so the vault may keep it current. An index note's body carries no mark and stays the person's.
- **Existing maps:** a map whose title matches one already in the vault is not created again. Its notes join the existing map, and the preview says "joins the topic map you already have".
- **Description and orientation:**
  - **Description:** the note map's own `description`, else "<n> notes imported from the folder <path>."
  - **Orientation:** the note's body, else "Imported from <path> in <folder name>. Each note below was in that folder."
- **Never maps:**
  - the templates folder;
  - the daily notes folder, and files named like a date (`2024-03-04.md`) anywhere;
  - folders over the limit. The report lists them, for example "Zettelkasten (612 notes): too many for one topic map, so its notes keep their tags instead."
- **Tags do not become maps.** They stay the notes' `topics`, so folders and tags never make two maps of the same theme, and the vault's Place step already files notes by meaning (`pieces/knowledge-vault/lib/agent/synthesize.ts:51-56`).

#### 3.4 Long files become sources

- **The rule:** a file over 20,000 characters is offered as a source, with "Add them as sources, so the pipeline reads them into notes" ticked.
- **Why 20,000:**
  - a vault note is short: the median is 560 characters and the longest 1,776, across Liberuum's 453;
  - 20,000 characters is about two and a half of the local model's extraction windows (8,000 characters, extraction spec §1);
  - a file that long holds many claims, which is what sources are for.
- **The write:**
  - they go into one folder, `/sources/<folder name>` (`POST sources/folders`);
  - then `POST sources/batch` with `queue: true`, `method: "imported"` and `tool: "markdown-import"`;
  - the frontmatter's `author`, and its `url` or `source` when that is a URL, go on the source.
- **Unticked:** they import as notes, up to 1,000,000 characters each, which keeps a request under the route's 2 MB cap (`subgraphs/http/index.ts:117`).
- **Links to them stay in the text.** A link from a note to a source is not a "Relates to" link.

#### 3.5 Properties the vault has no field for

- **Where they go:** a final line in the note, after a rule:

  ```markdown
  ---
  Imported properties — source: https://example.com/post · created: 2021-03-04 · rating: 5
  ```

- **What is written:** scalars, and lists of scalars joined with ", ", up to 1,000 characters.
- **What is left out:** objects, which the report names, and Obsidian's display properties `cssclasses`, `cssclass`, `publish` and `permalink`.
- **Never written:** the fields §3 and §7.2 map, so a vault export imports back without this line.

#### 3.6 Imported notes are drafts, outside review and the pipeline

- **Drafts:** an imported note is a `DRAFT` and gets no lifecycle action.
- **They are full members of the vault:**
  - search returns them and the chat reads them;
  - Connect, the pipeline's linking step, uses them as candidates, since it skips only `ARCHIVED` and maps (`pieces/knowledge-vault/lib/agent/connect.ts:55`).
- **Not in the review queue:**
  - review exists to check model-written claims, and these are the person's own;
  - the queue already holds 367 notes;
  - approving them all at import would skip the reading that the vault's self-approval rule exists to ensure (`SELF_APPROVAL`, `lib/lint/rules/knowledge-note.ts:118-131`).
  - A person can still submit any one of them from the note editor.
- **Not queued for the pipeline:**
  - its steps are driven by sources: they take a source and the notes it produced (`connect.ts:27-44`);
  - Connect judges a source's notes in one model call, sized for tens of notes, not a thousand.
  - Only the long files of §3.4 enter the pipeline, as sources.
- **Linking them to the rest of the vault needs one case in spec B.**
  - Spec B's Reweave links thin notes while the pipeline is idle. But it takes only notes that are IN_REVIEW or CANONICAL, and leaves drafts alone as work in progress or rejections (`2026-10-15-pipeline-completeness-design.md` §1.1).
  - An imported draft is neither. So that rule gains one case: a DRAFT whose `sourceOrigin` is `IMPORT` qualifies. That is readable from the graph index alone; superseded notes stay out as before.
  - Without it, imported notes keep only the links their own text gave them, and the report says so: "Your notes are linked to each other as your files linked them; the vault does not link them to its other notes."
- **The preview says so:** "Your notes arrive as drafts: searchable and used in answers, not in the review queue."

### 4. Import: matching, order of writes, failures

- **What the vault holds is read once,** at planning: `GET graph.json?drive=` returns every note's and map's id, title, status, `sourceOrigin` and type. It was 1.8 MB and 30 ms on Liberuum.
- **Matching** compares titles trimmed, with spaces collapsed, case ignored and a trailing `.!?…` ignored. That is `titleKey` (`lib/intake-publish.ts:33-35`) plus the trailing-mark rule of `same()` (`editors/shared/doc-refs.ts:16-19`).
  - **A title match.** A file whose title matches a live note is not created again. Links to that title go to the existing note, and the preview lists these files under "Already in the vault (same title)".
  - **Notes from an earlier import.** When the matching note's `sourceOrigin` is `IMPORT`, the file's own links and map memberships are still written. A second run therefore finishes a first run that was cut short. Any other existing note is never changed.
  - **Archived notes** do not match. A new draft is made, and the report counts it.
  - **A vault export imported into its own vault** matches by `kv-id`, whatever the note is called now.
  - **Two files with one title** in the folder are both imported. The drive renames the second node, and the response says so.
- **Writes, in order, one request at a time.** The reactor runs one job at a time, so parallel requests only queue (`routes/create.ts:132-136`).

  | step | route | per request |
  |---|---|---|
  | 1. notes | `POST notes`, `allowLiteralEscapes: true` (§6.1) | ≤ 25 notes and ≤ 1.5 MB; the route caps 25 and 2 MB |
  | 2. the HUB | `POST hub?drive=` | once |
  | 3. maps, areas before topics | `POST notes` with `documentType: "bai/moc"` and `CREATE_MOC { title, description, orientation, tier, createdAt }`, no `parentRef` (§3.3) | ≤ 25 |
  | 4. links: `CHILD_MOC` (HUB → top maps, parent → child), `CORE_IDEA` (map → note), `RELATES_TO` (note → note), and the `kv-links` of a vault export | `POST relationships/batch` (§6.2); on an engine without it (`404` with no code), `POST relationships` one at a time, as the intake falls back from `sources/batch` (`lib/intake-service.ts:613-617`) | ≤ 200 links |
  | 5. long files | `POST sources/folders`, then `POST sources/batch` | ≤ 25 sources and ≤ 1.5 MB |

  - **Sources go last** so the pipeline does not start reading them while the import is still writing.
- **Why 5,000 notes:**
  - every `POST notes` files its batch into the drive with one dispatch, and the reactor stores the drive's whole node list with each operation (`routes/create.ts:30-46`);
  - at 5,000 notes that is 200 dispatches against a drive past 6,000 nodes.
  - "Import a subfolder at a time" keeps each run predictable.
- **Failures:**
  - **`400`.** Every route checks a whole request before writing any of it, so nothing in that request was written. The planner's checks should make this impossible: description length, note type, metadata field, names and literal escapes. So a `400` stops the import, and the report names the file and the rule.
  - **`403`.** The import stops with "You can read this vault but not add to it." The dialog checks first with `GET drives`' new `canWrite` (§6.3), so this should not happen.
  - **A network error, or a 5xx.** The import stops, and what landed stays. "Run the import again on the same folder to finish: notes already in the vault are recognized and skipped."
  - **A note created with a refused field.** The note exists, and the report lists it with the field ("2 notes were added, but a field was refused — open them").
  - **A link refused.** It is counted with its reason.
  - **Stop.** It finishes the request in flight, then ends with the same report.
- **While it runs,** the page:
  - holds the intake's Web Lock (`holdWebLock`, `lib/intake-store.ts:1387-1408`);
  - tells the desktop it is busy (`setBusy("Notes are being imported.")`, so quitting asks first);
  - asks the browser before the tab is closed.
- **The estimate:** the first batch's measured time gives "about N minutes left". No constant is assumed.

### 5. Import: entry points, preview, report

#### 5.1 Entry points

| where | web (Connect) | desktop |
|---|---|---|
| the add menu beside "Add sources" (`CREATE_ITEMS`) | "Import notes…" | same |
| the empty Sources view (`IntakeLanding`) | a line under the drop area: "Moving from Obsidian? Import your notes instead." | same |
| Add a vault (`host/src/landing/AddVaultDialog.tsx:15-18`) | — (Connect makes drives its own way) | a third choice, "Start from your notes — An Obsidian vault or a Markdown folder" |

- **"Start from your notes"** on the desktop:
  1. **Choose a folder:** the native dialog, then the sidecar reads the folder.
  2. **Name the vault:** the dialog shows "<folder>: 812 notes" with the name prefilled from the folder.
  3. **"Create and import":** creates the vault and opens it on the import preview, with the folder already read. The host hands it over through `takeImportFolder(driveId)`, as `takeIntakeFiles` hands over files today (`host/src/onboarding/pending-files.ts`).
- **Who sees "Import notes…":**
  - Everyone who can open the vault.
  - A person who cannot write sees it disabled, with "You can read this vault but not add to it", from `GET drives`' `canWrite`.

#### 5.2 The dialog: choose

- Title: **Import notes**.
- Lead: "Bring in an Obsidian vault or any folder of Markdown notes. Notes stay notes; their tags, links and folders come with them. Nothing is added until you choose Import."
- **Buttons:**
  - desktop: "Choose a folder…";
  - web: "Choose a folder…" and "Choose a .zip…".
- **The drop area:** "or drop the folder, or a .zip of it, here". It uses the intake's drop handling, so Connect's outer drop zone leaves it alone.
- Footnote: "Reads .md files. Images, PDFs and canvases are left out."
- **The browser's own prompt:** a web browser asks to "upload" a chosen folder. The dialog says: "Your browser calls this an upload; the files are read here and nothing is sent until you choose Import."

#### 5.3 The dialog: preview

```
Obsidian Vault — 812 notes
  Notes      812 new · 34 already in the vault (same title), not imported again   [Show]
  Tags       96 tags stay on the notes
  Topics     14 topic maps from folders and index notes, in 2 areas
             1 joins a topic map you already have                                  [Show]
             Zettelkasten (612 notes) is too big for one topic map; its notes keep their tags.
             [x] Make the 8 notes that are lists of links topic maps                [Show]
  Links      1,240 become vault links, each with the sentence it sits in
             310 stay in the text only: no sentence around them
             57 point at notes that aren't in this folder
  Long files 12 over 20,000 characters
             [x] Add them as sources, so the pipeline reads them into notes
  Left out   Templates (8) · Daily notes (912) [Include] · 140 images and PDFs · 6 canvases
  Folders    [x] Projects (120)  [x] Areas (96)  [x] Resources (430) …              [Show]

Your notes arrive as drafts: searchable and used in answers, not in the review queue.
                                                        [Back]  [Import 812 notes]
```

- **The dialog's words** are the vault's own: a map is a "topic map", a DOMAIN an "area" and the HUB the "overview". The vault-view design keeps the methodology's words out of the reader's view (`docs/design/vault-view/README.md:32`, `:97`). Obsidian tags stay "tags", though they are stored as the note's `topics`.
- **Unticking a folder** leaves its notes out, and the counts update.
- **"Show"** lists the files or maps behind a count.
- **Running:**
  - the dialog shows one line per step: "Adding notes — 200 of 812 · about 9 minutes left", "Making topic maps — 6 of 14", "Linking — 400 of 1,240", "Adding long files as sources — 12";
  - with "Stop after this step".

#### 5.4 The report

- Heading: "Imported 812 notes". If it stopped: "Import stopped — 200 of 812 notes added".
- Each line appears only when its count is not zero:
  - "Topics: 14 topic maps made, in 2 areas; the notes from Resources joined your topic map Resources."
  - "Links: 1,240 in the vault, each with its sentence. 310 are in the text only (no sentence around them). 57 point at notes that weren't in the folder."
  - "Already in the vault: 34 notes with the same title were not imported again; links to them go to those notes."
  - "Changed on the way: 9 descriptions shortened to 200 characters. 5 notes renamed by the vault because another note had the same name."
  - "Kept as text: properties source, created and rating (at the end of each note)."
  - "Not imported: 140 images and PDFs (the vault can't attach files to notes yet), 6 canvases, the properties position and banner (not text)."
  - "Sent to the pipeline: 12 long files, as sources in Sources › Obsidian Vault."
  - "Problems: 2 notes were added, but a field was refused." Each is listed with a link to open it.
- Buttons: "Open notes", "Open topics", "Copy report", "Done".

#### 5.5 Wiki links in the note preview

- **The new prop:** `MarkdownPreview` gains an optional `wikiLinks` prop, `{ resolve(target: string): string | null; open(id: string): void }`. Only the knowledge-note editor passes it. The chat and other callers are unchanged.
- **With the prop:**
  - `[[target]]` and `[[target|shown text]]` are drawn as the shown text, styled as links;
  - a target that matches one of the note's own links, by target title, opens that note;
  - any other target is drawn with a dotted underline and the tooltip "Not linked in the vault yet";
  - `![[…]]` is drawn as a quiet line, "embedded: <target> — not in the vault".
- **The stored text is never rewritten.**
- **Why** links stay as written (decision 4):
  - nothing is lost;
  - the export writes them back unchanged;
  - agents read the convention without help;
  - a later linking job can find the links that are not in the graph yet.

### 6. Server changes for import

#### 6.1 `POST notes` takes `allowLiteralEscapes`

- **The field:** the body gains `allowLiteralEscapes?: boolean`, as `POST sources` has. It is passed to the up-front lint (`routes/create.ts:118`) and to the write (`:199`).
- **Why the import sends `true`:** the `LITERAL_ESCAPE` rule catches agents that send `\n` instead of a line break. A file read from disk never makes that mistake, and code in notes legitimately shows `\n`.

#### 6.2 `POST relationships/batch`

```jsonc
// request
{ "edges": [ { "source": "<id>", "target": "<id>", "type": "RELATES_TO",
               "reason": "Atomic notes make links precise because each has one target.",
               "confidence": "grounded" } ] }       // at most 200; confidence optional
// response: 200 when every edge applied, 207 when some were refused
{ "edges":  [ { "index": 0, "error": null } ],
  "writes": [ { "source": "<id>", "readBack": "confirmed", "jobId": "…" } ] }
```

- **Checked first:**
  - unknown fields;
  - link types (`UNKNOWN_LINK_TYPE`);
  - the articulation rule, per edge (`lib/articulation.ts`);
  - a source, target and type repeated in one request.
  - Then every source is authorised for writing and every target resolved.
  - Any failure is a `4xx` naming `edges[i].…`, and nothing is dispatched, as for every write route.
- **Then grouped by source document:** one read and one write per source, all its `ADD_RELATIONSHIP` actions together (`defaultScope: "document"`). A single edge costs a full read and a write today (`routes/relationships.ts:76-97`).
- **A failed group** marks its edges' `error`, and the other groups go on. The route only changes existing documents, so there is nothing to roll back (`docs/http-api.md:81-83`).
- **Edges are idempotent** on source, target and type, as through `POST relationships`.
- **Registered before `relationships`.** Routes match in registration order (`subgraphs/http/index.ts:120-121`).
- **Later users:** the pipeline's Connect and Place loops send one `POST relationships` per edge (`synthesize.ts:174`, `:188`) and can move to this route later; that is not part of this work.

#### 6.3 `GET drives` says whether you can write

- **The field:** each drive gains `canWrite`, one `authorization.canWrite` call per readable drive (`routes/drives.ts:35-52`).
- **Who uses it:** the import dialog uses it to disable itself honestly.

### 7. Export: Markdown for Obsidian

#### 7.1 The route

- **`GET export/markdown.zip?drive=<id>[&sourceText=1]`:** `renown`, `canonicalForRead` on the drive.
- **The answer:**
  - `application/zip`;
  - `Content-Disposition: attachment; filename="<vault slug>-<YYYY-MM-DD>.zip"`;
  - `Cache-Control: private, max-age=0`.
- **What it reads:**
  - the graph index's nodes and edges (`allNodes`, `allEdges`). Each holds the full text of notes and the orientation of maps (`processors/graph-indexer/project.ts:197-229`);
  - every topic in one query: a new `allTopics()` beside `topicsForNode` (`query.ts:840-847`);
  - the drive's tree;
  - each source document, for its page.
- **What it filters:**
  - every document is checked with `authorization.canRead`. A document the caller may not read is left out, and README.md counts it.
  - `graph.json` checks only the drive, but a zip is a copy that leaves the vault's access control, so the export is stricter.
- **The zip** is built with `fflate`'s `zipSync`.
- **Too large:** above 200 MB uncompressed, the answer is `413 EXPORT_TOO_LARGE`, "Export without the sources' text."
- **Its place in the plan:** the route is the HTTP plan's slice-5 "`GET export.zip`" (`docs/plans/http-surface.md:513`). The format is named in the path so other formats can sit beside it.

#### 7.2 What is in the zip

```
Liberuum/
  README.md          what this is, the counts, a link to the top map
  Notes/<title>.md   every note except archived ones
  Maps/<title>.md    every map
  Sources/<title>.md a page for every source: what it is and where it came from
                     (its full text too, with sourceText=1)
```

- **File names:**
  - a title with `* " \ / < > : | ? # ^ [ ]` replaced by spaces, spaces collapsed;
  - trailing dots and spaces removed, since Windows drops them and most note titles end with a full stop;
  - cut to 120 characters at a word;
  - "Untitled" when empty;
  - a Windows device name such as `CON` gets " (note)".
- **Unique names:** names are unique across the whole zip, ignoring case. A repeat gets " (2)", in order of creation and then id, so a bare `[[name]]` always resolves and exporting twice gives the same files.
- **A note file:**

  ```markdown
  ---
  title: "A knowledge link needs a stated rationale to convey a usable connection."
  aliases: ["A knowledge link needs a stated rationale to convey a usable connection."]
  description: "The rationale supplies the missing inferential step between notes instead of making readers reconstruct why an edge exists."
  type: concept
  status: in-review
  topics: ["Knowledge links"]
  tags: [Knowledge-links]
  author: "extract-claims · gpt-6.1-sol"
  origin: derived
  created: 2026-10-10T19:23:16.452Z
  updated: 2026-10-10T19:23:18.257Z
  kv-id: Jf2NZqAPp0Vc5HdZyRK_5oUrP94peyW4S-2xvaS-Aj4
  kv-links:
    - type: BUILDS_ON
      to: "[[Typed links give readers an advance interpretation of a note pair]]"
      reason: "The stated-link-rationale note supplies what the typed-links note's labels cannot convey alone: …"
      confidence: grounded
    - type: DERIVED_FROM
      to: "[[How Knowledge Vault works]]"
      reason: "Extracted from \"How Knowledge Vault works\": Links and maps of your topics, paragraph 1"
      confidence: grounded
  ---

  An edge identifies two endpoints but does not explain why they belong together. …

  ## Links
  <!-- Written by Knowledge Vault from kv-links above; edits here are not imported. -->
  - **Builds on** [[Typed links give readers an advance interpretation of a note pair|Typed links give readers an advance interpretation of a note pair.]] — The stated-link-rationale note supplies … *(grounded)*
  - **Derived from** [[How Knowledge Vault works]] — Extracted from "How Knowledge Vault works": … *(grounded)*
  ```

  - **`aliases`** is written when the file name differs from the title.
  - **`tags`** carries the topics in Obsidian's tag form: spaces become `-`, and other characters a tag cannot hold are dropped. `topics` keeps the names exactly.
  - **Link labels** are the note editor's (`editors/knowledge-note-editor/components/links-section.tsx:57-63`). Only outgoing links are written; Obsidian computes backlinks itself.
- **A map file:**
  - `kv-kind: map`, `tier: topic|domain|hub`, `tags: [map]`;
  - the orientation as the body;
  - a "## Notes" list of its core ideas and a "## Maps" list of its child maps, each with its reason when it has one;
  - its `kv-links` holds the same memberships, plus any other link the map makes.
- **A source page:**
  - `kv-kind: source`, `source-type`, `status`, `url`, `author`, `published`, `tags: [source]`;
  - the body says "Notes drawn from this source are listed in its backlinks", followed by "## Text" when `sourceText=1`.
- **README.md:**
  - frontmatter `kv-export: 1`;
  - the vault's name, the date and the counts;
  - "Start at [[<top map>]]";
  - what each folder holds;
  - a "Left out" line: archived notes, contradictions, projects and work breakdowns, documents you cannot read, the vault's settings and history;
  - one sentence on the `kv-` fields.
- **Left out, and why:**
  - **archived notes:** retired knowledge;
  - **contradictions, observations, scopes of work, work breakdowns, the queue, the health report and settings:** the vault's working documents, not knowledge. A contradiction still shows as its "Contradicts" links.
  - Everything is in a `.kvbackup`.

#### 7.3 Links inside note text

- **A link in a note's own text,** `[[X]]` or `[[X|shown]]`, is rewritten to `[[<file name>|<shown or title>]]` when X is the title or id of an exported document. An alias alone would not resolve an existing link in Obsidian.
- **Anything else is left as written.**
- **Notes the pipeline wrote** have no such links; theirs are in the "## Links" list.

#### 7.4 How the round trip reads it back

| field | the import does |
|---|---|
| `kv-export` (README.md) | skips the file |
| `kv-id` | matches a note already in this vault (§4) |
| `kv-kind: map` | makes a map with that `tier` (§3.3); the body minus its generated lists is the orientation |
| `kv-kind: source` | skips the page and counts it: sources are not part of a Markdown import |
| `kv-links` | restores each link with its type, reason and confidence; `DERIVED_FROM` to a source page is dropped and counted |
| `topics`, `type`, `description`, `author`, `aliases` | as in §3 |
| `status`, `origin`, `created`, `updated` | not restored: the notes arrive as drafts with `sourceOrigin: IMPORT` (decision 14) |
| the generated "## Links", "## Notes" and "## Maps" sections | removed from the content: they are a rendering of `kv-links` |

#### 7.5 Where it runs

- **Web:**
  - the page fetches the zip with its bearer (`VaultApi` gains `getBytes`; it reads JSON only today, `lib/vault-api.ts:28-43`);
  - it saves the zip through an object URL, as the source's original file is saved (`components/OriginalFilePanel.tsx:120-131`).
- **Desktop:**
  - **"Download .zip"** works as on the web. The shell already turns a page's download into the native Save dialog (`src-tauri/src/lib.rs:385-446`).
  - **"Save as a folder…"** makes the export one step to open in Obsidian. The page fetches the zip and calls the host's `saveExportFolder(zip, vaultName)`:
    1. Tauri's new `choose_export_folder` opens the native folder dialog;
    2. the sidecar's new `POST /export-folder?dest=` unpacks into `<chosen>/<vault name>`, or `<vault name> <date>` when that exists and is not empty;
    3. it refuses any path outside the home folder or a mounted drive (the roots of `dropped-files.ts:12-14`), entries with `..` or an absolute path, and anything but `.md` files;
    4. the chosen path joins the paths `reveal_path` may show (`lib.rs:194`).
  - The same code serves the desktop's server vaults: the page fetches the zip, the sidecar only writes files.
- **An engine older than the route** answers `404`, and the Markdown section then says "This vault's server doesn't offer Markdown export yet."

### 8. The desktop's "Export documents"

- **Settings › Vaults:** the row's button becomes "Export…". It opens that vault on its Export dialog, through `takeOpenView(driveId) === "export"` (`DriveExplorer.tsx:83-90`, `:474-481`).
- **The drive-sync dump moves** to Settings › Diagnostics, under a new subheading "Raw documents", beside "Connect your tools" (`host/src/settings/Diagnostics.tsx:63-67`).
  - There is one "Export raw documents" button per vault.
  - Its copy: "Writes the vault's documents, operation history and links as JSON files (the drive-sync layout) into the data folder's exports/. For developers and bug reports: the app does not import this. The vault repository's `scripts/drive-sync/upload.py` restores it to any engine, without history or attached files."
- **No import for the dump, in either app.** Three ways back in would confuse more than help, and this one is the weakest:
  - **The dump loses data:** it restores no history and no attached files, it makes new ids, and it can duplicate contradictions the indexer already opened (`scripts/drive-sync/README.md:305-311`).
  - **The other two paths cover it:** a `.kvbackup` restores everything, and the Markdown import covers a portable copy of one vault.
- **The vault-view design differs:** it puts "this vault's Export documents" in Vault settings › General (`docs/design/vault-view/README.md:80`). This spec puts the Markdown "Export…" there instead, and the raw dump in the app's Diagnostics.

### 9. llms.txt, llms-full.txt, health.json and the badge

- **The Export dialog's second section,** "For AI tools":
  - **Lead:** "Give an AI tool what this vault knows, as plain text."
  - **A choice:** "All notes except archived (453)" (the default) or "Approved notes only (64)". The first maps to `includeDrafts=1`. The route's own default stays as it is for existing callers.
  - **"llms-full.txt — every note as one text file":** Copy text, Download, Copy link.
  - **"llms.txt — the index of your topic maps, for agents that look for it":** Copy link.
  - **The access line** depends on the vault's origin:
    - **On this computer** (127.0.0.1): "These links work on this computer only. Agents here, such as Claude Code, can read them."
    - **On a server:** "Signed-in readers of this vault can open these links; an AI tool needs your sign-in token, so Copy or Download is usually easier. The index — topic map titles only — is open to anyone when the vault is public."
  - Copy and Download fetch with the page's bearer, so they work on both.
- **The Health view** (`components/HealthDashboard.tsx`), once a report exists (`generatedAt` set):
  - the badge image, with "Copy Markdown" giving `![Vault health](<origin>/api/@powerhousedao/knowledge-note/badge.svg?drive=<id>)`;
  - "Anyone with the badge link sees the status word — pass, warn or fail — and nothing else."
  - a "health.json" Copy link for tools.
  - The badge shows only for a vault on a server: a 127.0.0.1 link in a README reaches no one. Without a report the view keeps its empty state, because a badge that says UNKNOWN helps no one.
- **`llms.txt` gets a real title:** the drive's name as its heading, and the top map's description as its `>` line (`routes/llms.ts:45-67`).

| what | who can read it (unchanged) | where in the UI | who sees the entry |
|---|---|---|---|
| `llms.txt` | signed-in readers; anyone, titles only, when the vault is anonymously readable | Export › For AI tools | everyone who can open the vault |
| `llms-full.txt` | signed-in readers; the owner on an open local engine | Export › For AI tools | everyone who can open the vault |
| `health.json` | signed-in readers | Health view | same, once a report exists |
| `badge.svg` | anyone (status word only) | Health view | same, once a report exists, on a server |
| `export/markdown.zip` (new) | signed-in readers; each document checked | Export › Markdown | everyone who can open the vault |

### 10. Entry points at a glance

| | web (Connect) | desktop |
|---|---|---|
| Import notes | add menu; empty Sources view; folder, folder drop or .zip | the same, with the native folder dialog and folder drops; "Start from your notes" in Add a vault |
| Export | vault menu "Export…" (new `VAULT_MENU` entry, `DriveExplorer.tsx:991-998`); after the settings fold, Vault settings › General | the same; Settings › Vaults "Export…"; the vault tile's ⋯ menu "Export…" (`host/src/landing/VaultMenu.tsx`) |
| Markdown | Download .zip | Save as a folder…, Download .zip |
| For AI tools | Export dialog | Export dialog |
| Badge | Health view, on a server | Health view, for a server vault |
| Raw documents | — | Settings › Diagnostics |

### 11. Testing and measuring

- **The package (pure, vitest):**
  - **Parsing:**
    - frontmatter shapes: lists, strings, invalid YAML kept as text and counted;
    - title and H1;
    - tags in code, URLs and headings;
    - every link form and its resolution order;
    - the sentence rule's examples from §3.1;
    - the properties line.
  - **Planning:**
    - matching, including the `IMPORT` re-run case and archived notes;
    - map rules, tiers, parents, the limit and cycles;
    - long files;
    - batch sizes and unique names;
    - description cuts;
    - literal escapes.
  - **The report's sentences.**
  - **The export renderer:** file names, frontmatter, the generated lists, rewriting links in the text, and two exports giving the same files.
  - **The round trip:** export → parse → plan restores the notes, maps and typed links with reasons, minus links to sources.
- **Routes:**
  - `POST relationships/batch`: a 400 before dispatch, grouping, per-edge errors, `207`, idempotency;
  - `allowLiteralEscapes` on `POST notes`;
  - the export: authorisation, the per-document filter, `413`, `sourceText`;
  - `canWrite`;
  - the `llms.txt` title.
- **The fixture:** a committed Obsidian folder of about 20 notes: folders, a `moc` note, a folder note, a list of links, templates, daily notes, an embed, code with `\n`, links in sentences and in lists, two files with one name, and a long file.
- **The app:**
  - the sidecar's folder read: roots, symlinks, limits, files rather than folders;
  - unpacking: `..`, absolute paths, an existing folder;
  - the Tauri capability test's command list (`src-tauri/src/lib.rs`, `capability_tests`).
- **Live:**
  1. Import the public Obsidian Help vault (`github.com/obsidianmd/obsidian-help`, its `en` folder) into a new desktop vault. Record the time per step and every count of the report, and open some notes, maps and links.
  2. Export Liberuum as a folder and open it in Obsidian: links, maps and tags.
  3. Import that export into a new local vault, and compare the notes, maps and typed links with reasons against Liberuum's.
  4. Repeat import 1 in Connect, in Chrome and in Firefox.

## Decisions for review

1. **The import runs in the page, in both apps. The desktop reads folders natively, and the writes go through REST.**
   - **Alternatives:**
     - a server route that takes the upload;
     - a desktop-only import in the sidecar.
   - **Why:**
     - one implementation serves both apps, and the preview is local;
     - the writes reuse routes that already validate, place and roll back;
     - a server import needs a job protocol and runs into body caps;
     - a desktop-only import leaves Connect without one.
2. **Imported notes arrive as drafts, outside the review queue and the pipeline. Spec B's Reweave takes imported drafts (§3.6).**
   - **Alternatives:**
     - submit them all for review, which also brings them into spec B's linking as that spec stands;
     - approve them at import;
     - drafts with no automatic linking at all.
   - **Why:**
     - review checks model-written claims, and the queue already holds 367;
     - approving without reading defeats the self-approval rule's purpose;
     - drafts are already searched and used in answers;
     - a one-case change in spec B links them without filling the review queue.
   - **This decision and spec B §1.1 need one answer together.**
3. **A link with no sentence around it stays in the text, not in the graph.**
   - **Alternatives:**
     - a link whose reason records where it sat ("Listed under Related in X");
     - a model writes reasons during the import, which is slow on the local model.
   - **Why:**
     - the vault's rule is that a link says why it exists (`lib/articulation.ts`);
     - a "where it sat" reason could fit any pair, which the Connect prompt itself calls no reason;
     - the report counts these links, and spec B's Reweave links thin notes, imported drafts included (§3.6).
4. **Wiki links stay in the text as written, and the note preview draws them.**
   - **Alternative:** strip them to plain words.
   - **Why:**
     - nothing is lost;
     - the export writes them back unchanged;
     - agents read them;
     - unlinked ones stay findable.
5. **Maps come from folders (3–40 notes) and from index notes (`moc`, folder notes, lists of links), not from tags.**
   - **Alternatives:**
     - tags make maps too;
     - no maps at all, leaving it to Place.
   - **Why:**
     - folders and index notes are the person's own structure. That matches the maps spec, where areas are grouped by people, not by the vault (its §5);
     - tags too would double the maps;
     - oversized folders such as a flat Zettelkasten would make maps the health limit flags at once.
6. **Files over 20,000 characters become sources, ticked by default.**
   - **Alternatives:**
     - always notes;
     - a choice per file.
   - **Why:** a vault note is short (a median of 560 characters), and a file that long holds many claims, which is the pipeline's job.
7. **Properties without a field are kept as one line at the end of the note.**
   - **Alternative:** drop them and name them in the report.
   - **Why:** people lose source URLs and dates otherwise, and the line costs nothing on the round trip.
8. **Images are not imported.**
   - **Alternative:** add an `AttachmentRef` list to `bai/knowledge-note` now, as a new model version via MCP.
   - **Why:** it is a model change with a migration, and the import is useful without it. The report counts what was left out.
9. **Export is a server route. The desktop saves a folder and both apps download a `.zip`.**
   - **Alternatives:**
     - build the zip in the page from `graph.json`, which has no topics and no source pages;
     - a zip only on the desktop.
   - **Why:**
     - one renderer serves both apps and agents;
     - a folder opens in Obsidian in one step;
     - the desktop's save needs only a dialog and an unpack.
10. **The export holds notes except archived ones, maps, and a page per source; the sources' full text is an option.**
    - **Alternatives:**
      - everything;
      - approved notes only.
    - **Why:**
      - approved notes are 64 of Liberuum's 453;
      - the working documents are not knowledge;
      - full fidelity is the `.kvbackup`.
11. **The desktop's per-vault export becomes the Markdown export. The drive-sync dump moves to Diagnostics, for developers, with no import in the app.**
    - **Alternatives:**
      - build an import for the dump;
      - delete it.
    - **Why:**
      - an import of the dump would be a third way back, weaker than a `.kvbackup` (no history, no attached files);
      - the dump still serves bug reports and `upload.py`.
    - This departs from `docs/design/vault-view/README.md:80`.
12. **"For AI tools" defaults to all notes except archived.**
    - **Alternative:** approved only, the route's default.
    - **Why:** the default would leave out 86% of Liberuum.
13. **No JSON import.**
    - **Alternative:** accept an array of note objects.
    - **Why:**
      - there is no shared shape across tools;
      - agents have `POST notes`;
      - every common tool exports Markdown.
14. **On a round trip, approvals and sources do not travel. Notes arrive as drafts, and links to sources are dropped.**
    - **Alternatives:**
      - restore statuses;
      - import source pages as sources.
    - **Why:**
      - an approval belongs to the vault where someone read the note;
      - a source page without the original file and its extraction record would be a source in name only.
15. **Matching is by exact title, and by `kv-id` on a round trip; there is no check by meaning.**
    - **Alternative:** a semantic search per note before importing.
    - **Why:**
      - a thousand searches add minutes and still need a person's judgement;
      - near-duplicates are review-and-repair work (spec C).

## What changes, by file

- **`bai-knowledge-note`:**
  - `subgraphs/http/routes/create.ts`: `allowLiteralEscapes` in the accepted fields, the lint and the write.
  - `subgraphs/http/routes/relationships-batch.ts` (new), registered in `subgraphs/http/index.ts` before `relationships`.
  - `subgraphs/http/routes/export.ts` (new) and `subgraphs/http/lib/obsidian-export.ts` (new): file names, frontmatter, the generated lists, rewriting links in the text, README.md. Registered in `index.ts` with `getQuery`, as `llms.txt` is.
  - `processors/graph-indexer/query.ts`: `allTopics()`.
  - `subgraphs/http/routes/drives.ts`: `canWrite`.
  - `subgraphs/http/routes/llms.ts`: the vault's name and top map's description in `llms.txt`.
  - `docs/http-api.md`: the two new routes, `allowLiteralEscapes` on `POST notes`, and `canWrite` on `GET drives`.
  - `editors/knowledge-vault/lib/import/` (new):
    - `read-folder.ts`: a folder input, folder drop, `.zip` or host folder becomes paths and text, with the skip rules and limits;
    - `parse.ts`: one file becomes title, fields, topics, links with sentences, and the `kv-` fields;
    - `plan.ts`: matching, maps, edges, long files, batches;
    - `run.ts`: the writes of §4, progress, Stop, and the per-edge fallback;
    - `report.ts`: the report's sentences;
    - tests and the fixture folder.
  - `editors/knowledge-vault/components/import/ImportDialog.tsx`, `ImportPreview.tsx`, `ImportReport.tsx` (new).
  - `editors/knowledge-vault/components/export/ExportDialog.tsx` (new): Markdown, and For AI tools.
  - `editors/knowledge-vault/components/DriveExplorer.tsx`: "Import notes…" in `CREATE_ITEMS` and "Export…" in `VAULT_MENU`; the two dialogs; `takeImportFolder`; `takeOpenView("export")`.
  - `editors/knowledge-vault/components/intake/IntakeLanding.tsx`: the "Moving from Obsidian?" line.
  - `editors/knowledge-vault/components/HealthDashboard.tsx`: the badge and the health.json link.
  - `editors/knowledge-vault/components/vault-icons.tsx`: `import` and `export` icons.
  - `editors/knowledge-vault/lib/vault-api.ts`: `getBytes` and `getText`.
  - `editors/shared/markdown-preview.tsx`: the `wikiLinks` prop. `editors/knowledge-note-editor/editor.tsx` passes it, built from the note's own links.
  - `editors/shared/host-config.ts`: `readImportFolder(path?)`, `saveExportFolder(zip, name)` and `takeImportFolder(driveId)`, copied by `setHostConfig`.
  - `pieces/knowledge-vault/lib/agent/reweave.ts` (`weaveState`): imported drafts qualify (§3.6). That file belongs to spec B; it is listed here because decision 2 depends on it.
  - `package.json` and `bun.lock`: `fflate` 0.8.2 and `yaml` 2.8.3 as direct dependencies (`bun add`). Both are pure JavaScript and already installed as transitive dependencies; there are no Bun APIs in shipped code.
- **`knowledge-vault-app`:**
  - `src-tauri/src/lib.rs`: `choose_import_folder` and `choose_export_folder`, the second recording into `ChosenPaths`, in `generate_handler!` and `capability_tests`. Also `src-tauri/build.rs` and `src-tauri/capabilities/default.json`.
  - `sidecar/src/import-folder.ts` (new): reads a folder's Markdown and the two `.obsidian` files, with the roots of `dropped-files.ts`, symlinks resolved, at most 20,000 files and 50 MB of text.
  - `sidecar/src/export-folder.ts` (new): unpacks a Markdown zip safely (§7.5).
  - `sidecar/src/control.ts`: `GET /import-folder?path=` and `POST /export-folder?dest=`.
  - `host/src/api/import-folder.ts` (new) and `host/src/bootstrap.ts`: declare `readImportFolder`, `saveExportFolder` and `takeImportFolder` (`declareDesktopHost`, `:53`).
  - `host/src/onboarding/pending-files.ts`: the import-folder handover.
  - `host/src/landing/AddVaultDialog.tsx`: "Start from your notes". `host/src/landing/VaultMenu.tsx`: "Export…".
  - `host/src/settings/Vaults.tsx`: "Export…". `host/src/settings/Diagnostics.tsx`: "Raw documents".
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.

## Rollout

1. **Server.** Build and test the routes:
   - `POST relationships/batch`, `allowLiteralEscapes`, `GET export/markdown.zip`, `allTopics`, `canWrite`, the `llms.txt` title;
   - `bun run tsc`, `bun run lint:fix`, `bun run test`;
   - then `bun run build` and restart the Switchboard: subgraph changes are invisible until both (CLAUDE.md).
2. **Web UI.** The import and export dialogs, wiki links in the preview, and the badge, with the same checks.
3. **Publish** a dev version of `@powerhousedao/knowledge-note` (`bun run build`, `ph publish --tag dev`). Publishing needs your registry login.
4. **Desktop.** The Tauri commands, sidecar routes, host declarations, "Start from your notes" and Settings, on that version. Test.
5. **Measure** as in §11, and report each count beside what the report said.
6. **Separately,** in `powerhouse-knowledge`: the plugin's import and export skills can switch to `POST relationships/batch` and `GET export/markdown.zip`.

## Risks

- **Long imports.**
  - The link step is the largest, and no write timing for it has been measured yet.
  - The estimate comes from the first batch, Stop is always there, and a re-run finishes the job.
  - The 5,000-note limit keeps a run within reach.
- **Maps the person did not mean.** "Inbox" or "Archive" folders could become maps. The preview lists every map before anything is written, folders can be unticked, and a map is an ordinary map afterwards.
- **Generic titles.** "Index", "README" or "Untitled" may match an unrelated note in the vault. The preview lists every match before anything is written.
- **A thinner graph than in Obsidian.** Links with no sentence stay in the text. The report counts them, so nobody mistakes the gap for a failure.
- **Literal escapes.** The import turns off the `\n` check for its own requests only. The rule stays on for everyone else.
- **Wrong reasons.** Every reason is the person's own sentence, shown on the link and editable.
- **A copy outside the vault's access control.** Each document is checked before it goes in the zip, but whoever receives the file can read it. The Markdown section says: "Anyone you give the file to can read it."
- **Engines without the new routes.** The import falls back to one link per request. The export says the server doesn't offer it yet.
- **Memory.** Up to 50 MB of Markdown is parsed in the page, and a `.zip` is unpacked in memory. Both limits are checked before parsing.
- **Contradictions on a round trip.** `CONTRADICTS` links restored on a round trip open contradictions in the new vault (`processors/graph-indexer/automation.ts`). That is intended, and the report counts them.
