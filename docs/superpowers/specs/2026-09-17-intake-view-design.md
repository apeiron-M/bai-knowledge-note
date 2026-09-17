# Intake view — design

**Status:** approved for execution 2026-09-17, with the amendments recorded at the head of the plan (`plans/2026-09-17-intake-view.md`). Nothing in the React editor has been changed yet.
**Date:** 2026-09-17
**Depends on:** `specs/2026-09-17-convert-subgraph-design.md` (the conversion
subgraph), whose §12 defers exactly this view.
**Supersedes:** plan Task 9's "intake attachment surface" heading only — the
attachment work moves here, since this is the flow that owns it.

---

## 1. The problem

A vault can only take knowledge in through text somebody pastes. `+New → Add
Source` opens `CreateDocumentDialog` (a name), creates an empty `bai/source` in
`/sources`, opens `IngestForm`, and the user pastes. Every document the team
already has — the PDF, the .docx, the book — must be opened elsewhere, copied,
and pasted, losing its structure on the way in.

Meanwhile the conversion subgraph exists and is verified: it takes a file and
returns a *section plan* (title, heading path, char count, chunk indexes) plus
the markdown, and creates nothing. Nothing in the app calls it.

## 2. Goal

**Bring a document in and get correctly-shaped sources out**, without pasting:
choose files → convert → see what each file would become → approve → sources are
created in the vault, in a folder per document, each carrying its original file,
each queued for extraction.

## 3. Decision record

Answers given by the product owner, 2026-09-17. The plan implements these.

| # | Decision |
|---|---|
| 1 | **A folder per uploaded document.** `/sources/<document name>/`, holding that document's sections. |
| 2 | **The user selects and deselects sections** in the review step before anything is created. |
| 3 | **Auto-queue on publish** — a created source enters the pipeline as `EXTRACTING`, as the source editor's "Queue for processing" does. |
| 4 | **`SourceType` is chosen per file and shared by all its sections** (one book ⇒ every section is `BOOK_CHAPTER`). |
| 5 | **The tab must stay open.** In-flight conversions live only in the tab; a reload loses them, and the UI says so. |
| 6 | *Proposed, not yet answered:* **Tier 1 progress** (§9) — per-file state, free today; page-level progress is a later service change. |
| 7 | **`SourceType` default is by format, never `BOOK_CHAPTER`** — `html`/`htm` ⇒ `WEB_PAGE`, `vtt`/audio/video ⇒ `TRANSCRIPT`, everything else ⇒ `ARTICLE`; overridable per file. Decided 2026-09-17: a section count is a shape, not a genre — a two-section CV is not a book. |
| 8 | *Proposed:* creation provenance — `tool: "docling.rs"`, `method: "converted"`, and `convertedBy: "docling.rs"` on the attachment. |

## 4. Architecture

Not a new editor. It is a view inside the existing drive app
(`editors/knowledge-vault/`), because it is not a document and has no document
model — exactly like Sources, Search or Pipeline. Four touchpoints:
`ViewMode` (`components/DriveExplorer.tsx:40`), a `TABS` entry, the content
switch (`:476-504`), and new components.

```
empty vault ──▶ Intake landing        "Welcome to your knowledge vault…"
                     │ click
                     ▼
                Upload surface        file picker, multi-file, size checks
                     │ "Upload & convert"
                     ▼
                Conversion queue      per file: queued → converting → converted | failed
                     │ click a converted file
                     ▼
                Section review        the file's sections, ticked; per-file SourceType
                     │ "Add N sources"
                     ▼
                Publish               folder → sources (queued) → original attached
                     │
                     ▼
                Sources view          /sources/<document>/ with the new sources inside
```

### 4.1 What each step calls — all of it verified against the running server

| step | call | returns |
|---|---|---|
| supported formats | `GET …/convert/health` | `{configured, ok, ready, backend, formats[29], missing}` |
| convert | `POST …/convert?filename=<name>&markdown=1` (raw body) | `{filename, format, chars, chunks, sections[{…, mergedFrom[], markdownRange}], plan{…, rejoinedSections}, markdown, timings}` — each source's `content` is the markdown sliced at the section's `markdownRange` (tables intact); chunk `text` is the fallback |
| folder per document | `POST <vault>/sources/folders` `{drive, name}` | `{id, name, path, created}` — **idempotent on name within `/sources`** |
| create each section | `POST <vault>/sources` `{drive, title, content, sourceType, parentFolder, queue, method, tool}` | `{id, path, status, task, …}` |
| attach the original | `POST <vault>/actions` with `ATTACH_ORIGINAL_FILE` | the source's revision |
| upload the bytes | attachment client `preprocess` → `upload` | the ref is known *before* the upload |

Base URLs come from `resolveSwitchboardOrigin()` / `resolveReactorEndpoint()`
(`editors/shared/subgraph-endpoint.ts`) and `authHeaders()`
(`editors/shared/authed-fetch.ts`) — the pattern `lib/boot.ts` already uses. The
measured shape is `<origin>/api/@powerhousedao/knowledge-note<path>`.

### 4.2 Why publish is two REST calls and not document plumbing

`POST sources` already does the work: it resolves `/sources`, accepts
`parentFolder` **within `/sources` only** ("a book's chapters grouped under
one"), creates the document, verifies containment by reading it back, rolls back
if containment failed, and — because `queue` defaults to `true` — sets the
source to `EXTRACTING` and files a task on the pipeline queue. Building this
client-side with `createDocumentRemote` + a manual queue dispatch would be a
second implementation of rules the server already enforces, with its own way to
leave orphans.

## 5. Contracts

**Consumes** (exists today, verified live):

- `POST convert` — the summary shape above; `?markdown=1` adds `markdown` for
  the preview. 30 MB cap, bearer required, creates nothing.
- `POST sources/folders {drive, name}` — `name` cannot contain `/`; idempotent
  on name within `/sources`.
- `POST sources {drive, title, content, sourceType, parentFolder, queue, method, tool}`
  — `title` and `content` required, `sourceType` validated against the model's
  own zod enum, `queue !== false` ⇒ `EXTRACTING` + task.
- `POST actions {drive, documentId, actions[]}` — for `ATTACH_ORIGINAL_FILE`,
  whose input is `{originalFile, originalFileName, originalMimeType,
  originalSizeBytes, convertedBy}`.
- Attachment client: `preprocess(file)` → ref → dispatch → `upload(result)`,
  with `withByteProgress` for a real byte percentage.

**Produces** (new, all in `editors/knowledge-vault/`):

- `lib/intake-model.ts` — the pure flow model: file rows, per-file state
  machine, section selection, what to publish. Tested.
- `lib/intake-publish.ts` — folder name derivation, and the publish plan (which
  sources, in which folder, with which titles). Tested.
- `lib/vault-api.ts` — one authenticated call helper for the vault REST routes
  above. Tested with an injected fetch.
- `components/intake/IntakeView.tsx` — the shell that owns the state.
- `components/intake/IntakeLanding.tsx` — the empty-vault welcome.
- `components/intake/UploadSurface.tsx` — the drop/pick surface.
- `components/intake/ConversionQueue.tsx` — per-file progress rows.
- `components/intake/SectionReview.tsx` — the section list, selection, types.
- `components/OriginalFilePanel.tsx` — render-or-download, on the source editor.

## 6. The empty-vault landing

Same shape as the chat's, because the chat already solved this: `LandingStage`
(`components/chat/LandingStage.tsx`) anchors a block so the primary control's
centre lands at `ANCHOR_Y = 0.53` of the pane with a radial glow centred on it,
and takes a `tail` for secondary content that must not move the control. The
intake landing reuses it with the upload control as the anchor.

**When it shows.** `viewMode`'s default becomes conditional: an *empty* vault
opens on intake, everything else opens on chat as today.

**Empty is a claim about the server, not about the cache.** `useDriveInit`
already learned this the hard way — an unreadable tree is not an empty tree, and
treating it as one produced twelve refused folder creates and a toast each. So
the landing requires: the drive tree has been read from the reactor, the note
fetch has settled, and both are genuinely empty. While anything is still
loading, or the tree was unreadable, the default stays chat.

**Copy:** a heading naming the vault, one line saying it is empty, and the
primary control. "Add sources" — the vault's word for this is *source*.

## 7. The review step

One panel per converted file, listing the sections `deriveSections` produced:
title, heading path, char count, chunk count, and — for a merged section — what
it contains (`mergedFrom`). Ticked by default **except furniture**: the section
rule already folded the undersized and split the oversized, so the default is
"this is right"; but a title such as `[ contents ]`, `Praise for …`, `Index` or
`Copyright` arrives unticked (`isLikelyFurniture`, a heuristic the user can
override by re-ticking). Measured on the 238-page book at the default floor, the
first two sections were exactly those. The step exists so the user can
*disagree*, not so they must assemble the result by hand.

The file-level controls sit above the list and apply to every section in it:

- **`SourceType`** — one value per file (decision 4), defaulting per §3.
- **Folder name** — the derived `/sources/<name>` for that file, editable.
- **Select all / none**, and a live "N of M selected".

Editing is deliberately limited: tick/untick, the file's type, the folder name.
Renaming or merging *sections* is not in this plan (§12).

## 8. Publish

Per file, in order:

1. Sanitise the folder name (no `/`; the route refuses one) and
   `POST sources/folders`. Idempotent, so re-publishing the same document reuses
   its folder instead of making a second one.
2. For each **selected** section: `POST sources` with `parentFolder` = that
   folder, `title` = the section title (falling back to `<document> · part N`
   when a section has none — `title` is required), `content` = the section text,
   `sourceType` = the file's type, `queue: true`, `method`/`tool` per §3.
3. Attach the original to **every** created source from that file, then upload
   the bytes **once** for the file. The store is content-addressed, so one blob
   serves all N refs, and the ref is known before the upload — the ordering the
   convert spec §12.1 requires. Uploading per source would be N copies of the
   same bytes.

The original is attached to every section, not just the first, because each
source is an independent document that has to answer "where did this come
from?" on its own.

## 9. Progress

Two tiers, and the plan builds the first.

- **Tier 1, free today.** Per-file state — `queued → converting → converted |
  failed` — with elapsed time and position in the batch ("file 2 of 5"). Honest
  and available with no service change: the batch is converted **sequentially**,
  because the service's warm pipeline is single-threaded and queues overlapping
  calls in submission order anyway, so the client's order is the engine's order.
- **Tier 2, later.** `Pipeline.convertFileStreaming` streams Markdown **as pages
  finish converting** (the typings call page-parallel conversion "the headline
  win for PDF"), and `chunkFileStreaming` does the same for the chunking pass. So
  "page 84 of 238" is reachable — but it needs the service moved to the streaming
  call, a progress channel to the browser, and a re-run of the fidelity check,
  because our own measurement already caught the *cheaper* chunking call
  disagreeing with `chunkFileAsync` on real content. Not in this plan; the
  progress component is shaped so the feed can slot in behind it.

A percentage that is not measured must never be shown. Tier 1 shows elapsed
time, never a fake bar.

## 10. Styling and theming

The view must be indistinguishable from what is there now:

- **Colour only from the CSS variables** — `--bai-bg`, `--bai-deep`,
  `--bai-surface`, `--bai-hover`, `--bai-border`, `--bai-text` and its
  `-secondary` / `-tertiary` / `-muted` / `-faint` steps, `--bai-accent` — as
  inline `style={{ color: "var(--bai-text-secondary)" }}`.
- **Tailwind for layout and size only** (`flex-1`, `px-3 py-2`, `text-xs`,
  `rounded-2xl`, `truncate`), never for colour.
- **Pseudo-classes in a scoped `<style>` block**, as every existing component
  does, because inline styles cannot express `:hover` / `:focus` /
  `:placeholder-shown`. Stable class names, one block per component.
- **Modals** are `fixed inset-0 z-50` + a `bg-black/60` click-catcher +
  `relative z-10 rounded-2xl p-6 shadow-2xl` on `--bai-surface` with
  `1px solid var(--bai-border)`.
- **Reuse** `LoadingStates` (Spinner, SidebarSkeleton, LoadingLine),
  `EmptyState`, `Notifications`, `markdown-preview.tsx`, and the chat's
  `LandingStage` — a second spinner or a third empty state would be a new
  dialect.

## 11. Error handling and states

| state | behaviour |
|---|---|
| service unconfigured (`configured: false`) | the landing says conversion is unavailable and points at the service; no dead file picker |
| file over 30 MB | refused client-side, before the upload, with the limit named |
| unsupported extension | refused against the server's own `formats` list, not a hard-coded copy |
| conversion fails | that file's row shows failed + the server's message; the batch continues; retry on the row |
| conversion succeeds, nothing is published | nothing was ever created — `POST convert` writes nothing |
| tab closed or reloaded mid-conversion | work is lost; decision 5, warned up front |
| publish partially fails | per-file publish is sequential; the folder is idempotent by name but **`POST sources` is not idempotent on content** (only the queue task is deduped per `documentRef`). The row records what landed (`publishedIds`) and refuses a second publish rather than duplicating; a partial failure is reported with the count that landed, and the remainder is a manual step |
| attachment upload fails | the sources exist and are queued; the panel offers retry — a missing original must not read as an absent one (convert spec §12.1) |

## 12. Not in this plan

- Tier 2 progress (§9).
- Editing section text, merging or renaming sections — tick and untick only.
- Drag-and-drop from the OS file manager beyond the picker's own drop zone.
- Batch-level folder nesting (per-part subfolders) — a document gets one folder.
- Deleting or replacing an already-attached original.

## 13. Open questions

1. Should a section that is one of many be marked as part of a set in its own
   data (a `partOf` link to the folder's first source), or is the folder enough?
   The folder is navigation-only today.
2. `SourceType` defaults (§3): is `ARTICLE` right for a single-section document,
   or does the model want a neutral `DOCUMENT` value?
3. Does the section plan belong on each source as provenance (`method`/`tool`
   already anticipate this), or is the attachment's `convertedBy` enough?
4. ~~Should a title that is obviously furniture be dropped by default?~~
   **Answered 2026-09-17: unticked by default, not dropped** — `isLikelyFurniture`
   in `intake-model.ts` (§7). Kept in the list so the user can re-tick. The
   calibrated version of the same step (a per-section judgement with a
   confidence) is a later enhancement.
5. The folding floor (`?minSectionChars=`, now on the route) is a real dial —
   measured on the book: 2 000 → 117 sections, 4 000 → 68, 8 000 → 36. Offering
   it in the review step needs either a re-conversion or a pure
   `POST convert/sections` route over the chunks the client already holds.
   Not in this plan.

## 14. Testing

The repo's convention, and the plan follows it: **logic in `lib/` is tested with
vitest; components are not tested** (52 test files under `editors/`, all of them
`lib/` or `hooks/`). So the flow model, the publish plan and the API helper carry
the tests; the components stay thin enough that reading them is the test.

Editor code is **not** in the coverage denominator (`vitest.config.ts` covers
reducers, `tree-utils`, `subgraphs/*/lib`), but `bun run test:coverage` still has
to stay green repo-wide, and `bun run tsc` / `bun run lint` have to pass with no
new errors — the lint gate is errors, not warnings.
