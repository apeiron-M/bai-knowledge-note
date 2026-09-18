# `bai/source` editor — design proposal (Six Minds)

**Stage:** design proposal, awaiting green light. Nothing in the React editor has been changed.
**Method:** `.claude/skills/six-minds-design-skill.md` — cognitive audit → three Buxton concepts → evidence-based blend.
**Analysis of the current editor:** `editors/source-editor/editor.tsx` (905 lines, read in full 2026-09-18; every control re-audited against the mock on 2026-09-18).

Open `index.html` (`file://` is enough; no build step). Self-contained HTML, live `--bai-*` tokens copied from `style.css`, light/dark toggle bottom-right.

| file | what |
|---|---|
| `final.html` | **the blended design.** One screen, seven states via the switcher bottom-left: `#read` (default — the source, full page), `#outline` (the outline rail open on a 117-part book), `#details` (claims + provenance + extraction drawer), `#history` (the source's own revisions, scrubbed), `#edit` (editing inline, not a page swap), `#original` (the document it was converted from), `#ingest` (a source that has no content yet — the paste form, with the toolbar still above it) |
| `a-minimal.html` · `b-conventional.html` · `c-immersive.html` | the three Buxton sketches the final was blended from |
| `index.html` | all four side by side, and what was taken from each |

## The surface, named first

**Command / Inspect** — the user has drilled into one object and is either reading it or checking a fact about it. Not a Monitor (nothing is watched over time), not Decide/Learn (there is no argument to make). Reading *is* the job; every other control is peripheral and must be reachable in one move without competing for the eye. That single commitment is what rules out cards, tiles and hero compositions before any colour is chosen.

## 🧠 COGNITIVE AUDIT CHECKPOINTS

1. **Vision / Attention.** The markdown text is the *only* thing allowed to occupy the optical centre: `78ch` at 16px/1.7, on the **darker `--bai-surface`** rather than inside a card, with everything else at `--bai-text-faint` or lower contrast. Today the text sits in a `max-h-[600px] overflow-y-auto` box *below* the title, description, original-file panel and tab bar — so the eye lands on chrome first and reads a 13,687-character chapter through a 600px window.
2. **Wayfinding.** Three questions must be answerable without scrolling: *which source is this?* (breadcrumb), *where is it in its life?* (one status pill: INBOX → EXTRACTING → EXTRACTED → ARCHIVED), *where am I in the text?* (outline rail + reading progress). A 117-part book needs the third one, which does not exist today.
3. **Memory / Semantics.** Users arrive with a reader's schema, not an admin's: a slim sticky bar, a text column, an outline, an inspector. Editing *in place* rather than a full-page form. Status is a **pill**; a `<select>` that mutates state is a form control wearing a badge's clothes.
4. **Language.** The vault's own words, unchanged: *source*, *source type*, *provenance*, *extracted claims*, *Queue for processing*, `INBOX`/`EXTRACTING`/`EXTRACTED`/`ARCHIVED`, *revisions*, *original document*, *status*. No "document insights", no "AI summary", no invented nouns. `skipRate` stays a number and is *narrated*, never scored.
5. **Decision making.** The microgoals, in the order a reader actually has them: ① *is this the text I think it is?* → read it; ② *did extraction get anything out of it?* → claims count, one drawer away; ③ *what do I do next?* → **Queue for processing** (or see that it already is); ④ *where did this text come from?* → the original document; ⑤ *what changed?* → revisions. Today ④ precedes ① on screen and ② is at the bottom of a 256px sidebar.
6. **Emotion.** The anxiety is *"did the machine take the right things out of my source?"* — so the claims list is reassurance, not metadata, and it must be one gesture away. The second anxiety is *"I opened this to read one paragraph"* — so nothing may require scrolling past anything to start reading. Calm, not clever: no gradients, no glow, no motion except a progress line.

## 🎨 DIVERGENT CONCEPTS EVALUATED

| | concept | what it optimises | what it costs |
|---|---|---|---|
| **A** | **Minimal** — `a-minimal.html` | Wayfinding and speed: a 40px bar, the text, nothing else. Details behind one button. | Under-serves a first-time reader who does not yet know what a *claim* is; hides the very thing a source exists for. |
| **B** | **Conventional** — `b-conventional.html` | Memory: the docs-reader schema everyone knows — sticky header, tabs, outline left, inspector right, cards. | Re-introduces exactly the problem: cards around the text, and the inspector's default-open state steals the centre. |
| **C** | **Immersive** — `c-immersive.html` | Attention and appeal: full-bleed type, chrome that recedes until summoned, a reading-progress line, the claims as a quiet rail. | Its strongest idea (summoned chrome) is hostile to the *checking* half of the job — a reader hunting for a control should never wonder where it went. |

**The blend (and why):** C's *page*, A's *bar*, B's *vocabulary*. Concretely — the text takes the whole width and height of the viewport minus a slim sticky bar (C); that bar carries identity, the status pill, the claims count and the source-only actions, with everything else behind labelled buttons (A); and the panels that open are the familiar ones, named in the vault's words — details, revisions, original (B). A's "one button" idea survives as **Details**, because the claims drawer is the answer to the source's own reason to exist; B's tabs survive *inside* that drawer rather than over the text.

## The four requirements, and where each is met

1. **Full page for reading.** The reader column is `78ch` centred, and the *page* is the reading surface: the reading column is painted `--bai-surface` (the darker ground) and the page scrolls — there is no inner scroller anywhere in `#read`. The bar is 44px so the text is never below a wall of chrome.
2. **Every control reachable.** Outline · Details · Edit sit in the bar's right cluster; Queue for processing is the accent action; the status pill is read-only and the status *change* lives in Details (where a state change belongs). The document controller (Connect's `DocumentToolbar`) sits directly above, untouched.
3. **Check, then back to work.** Nothing needs a second screen: `Esc` closes whatever opened, and the drawer/rail never unmount the text. Reading progress is visible, so "am I nearly done?" is a glance.
4. **This is the source the notes were derived from.** The claims are named as *extracted claims*, counted in the bar (`12 claims`), listed in the drawer with links straight into each note, with the extraction stats beside them. The original document is a first-class action, not a panel that pushes the text down.

## The document controller (Connect's `DocumentToolbar`)

The toolbar is **not redesigned** — it renders exactly as it does today, directly above the source bar, because it is the document controller and its controls are Connect's, not this editor's. From `@powerhousedao/design-system` (`documentToolbarControls`, in slot order): **undo · redo · download · [document name] · update · history · switchboard · close** — seven buttons plus the name control, grouped into a left slot, the name, and a right slot.

Two consequences for this design, both deliberate:

- **The bar no longer duplicates the toolbar.** *Revisions* and *Original* are gone from the source bar: revision history is the toolbar's `history` control, and Download is the toolbar's `download`. The source bar carries only what the toolbar cannot know — the breadcrumb, the status pill, the claims count, and the three source-specific actions.
- **The toolbar keeps its own `h1` document name** (shown truncating), so the source bar does not repeat the title either; it shows the breadcrumb path instead.

The mock renders the toolbar faithfully in both themes via `TOOLBAR_CLASS` (`editors/shared/theme-context.tsx`): `--bai-surface` ground, buttons on `--bai-bg` at `--bai-text-tertiary`, hover to `--bai-hover`/`--bai-text-secondary`.

## Findings in the current editor (the diagnosis this design answers)

| # | finding | evidence in `editor.tsx` |
|---|---|---|
| 1 | **The reading surface is a 600px window** | `max-h-[600px] overflow-y-auto` on the content box (:344) — a nested scroll for the main content, inside a page that already scrolls, inside Connect's own scroller |
| 2 | **The text is below the fold** | title (:279), description (:285), `OriginalFilePanel` (:295), tab bar (:304) all precede the content (:335) |
| 3 | **Everything is a card** | `--bai-surface` + border on the main column (:184) and again on the sidebar (:382); the content box adds a third level (`--bai-deep`, :345) |
| 4 | **Status is editable in two places** | a read-only status pill (:192) *and* a `<select>` that dispatches `setSourceStatus` (:248) — the same fact, two affordances, one of them a form control in the header |
| 5 | **The point of a source is in the smallest space** | extracted claims live in a `w-64` sidebar (:380) below provenance and stats, themselves scrollable |
| 6 | **No outline and no progress** | a 117-part book renders as one long scroll with no landmarks |
| 7 | **Editing replaces the page** | `if (editing) return <EditForm …/>` (:165) — an early return, so the header, status and claims vanish while editing; and `handleSave` re-dispatches `INGEST_SOURCE` wholesale and then sets status back to `INBOX` (:612–625), discarding pipeline state |
| 8 | **`skipRate` is painted as a failure** | `stats.skipRate > 0.1 ? "text-red-400" : "text-emerald-400"` (:510). The vault's own doctrine says the opposite: *"There is no coverage target. `skipRate` is a measurement, not a goal: a thin introduction or a recap chapter can legitimately yield zero claims."* A red number teaches the reader that a thin chapter broke something |

Items 7 and 8 are behaviour, not layout — they need a decision beyond this mock. Flagged, not fixed here.

## Control-by-control audit (every control in the current editor, and where it lands)

Re-audited after the first review, because the first pass missed flows. Nothing in the current editor is dropped: each control is either kept in the bar, moved into Details, delegated to the toolbar, or reachable through the state it belongs to.

| current control | where in `editor.tsx` | where it lands in the mock |
|---|---|---|
| Document name / header title | :276–283 | **the toolbar's `name` control** (`h1`), shown truncating; the source bar shows the breadcrumb instead |
| Description | :285 | under the title in the reading column, above the first heading — it is reading matter, not a field |
| **Source type** (`ARTICLE`…`MANUAL_ENTRY`) | :291 (`type-pill`) | the content caption at the top of the reading column (`BOOK_CHAPTER · converted from … · 13,687 characters · 117 parts`) |
| Status pill | :192 | **the bar's pill** (read-only, `EXTRACTED`) |
| Status `<select>` (dispatches `setSourceStatus`) | :248 | **Details → Extraction**, labelled *Status* — a deliberate, rare change, moved away from the pill that only reports |
| `OriginalFilePanel` — renderable, not renderable, failed (+ Retry), no original (+ Attach) | :295 | **`Original` action → overlay** (`#original`); all four states kept: renderable (the viewer), not renderable (card with name/size/type/Download), failed (explicit failure + Retry), no original (**Attach file…**, never silence) |
| Tab bar: Content / Claims / Stats | :304–333 | **gone as a bar over the text.** Content is the page; Claims, Provenance and Extraction are the Details drawer's tabs — the source no longer competes with its own metadata for the centre |
| Content markdown (or *No content*) | :335–365 | **the reading surface** (`#read`), full page; the empty state stays the page with one line of text and no invented placeholder |
| *Extracting…* hint | :370 | kept as the `EXTRACTING` pill in the bar (plus the progress line) |
| Sidebar: Provenance (Author, URL, method, Ingested by) | :445–470 | **Details → Provenance** |
| Sidebar: Stats (Claims, Skipped, `skipRate`) | :480–520 | **Details → Extraction**, narrated rather than scored (see finding 8) |
| Sidebar: Extracted Claims + "View note" links | :530 | **Details → Claims** (default tab), with the count also in the bar |
| *Queue for Processing* / *Queued — run `/pipeline`* | :239–244 | **the bar's accent action**, same copy, changing into its own queued state rather than disappearing |
| `EditForm` (title, description, author, URL, content) + *Ingest Source* | :165, :655–900 | **`#edit`** — the *same* fields, edited in place with the toolbar and bar intact instead of a full-page swap; the pre-content state is `#ingest`, which shows that form with the toolbar still above it |
| *Add Source Material* / *Paste raw content here…* | :792–795 | **`#ingest`**'s heading and lede, verbatim |
| Revisions (`RevisionScrubber` + `RevisionSnapshotPanel` + `RevisionOperationList`) | :390 | **`#history`** — a working port: the scrubber with its steppers, "N of M operations changed the text", the signed operation rows, the replayed snapshot with the revision's own chips, and `Show changes` → the real diff (heading, ±lines, `vs previous`/`vs current`, word-level marks, `Also changed`). Reachable from the bar's **History** button and from the toolbar's history control |
| Vault nav bar (Chat…Health) | drive app shell | unchanged, shown for context at the top |

## Schema coverage — every field in `document-models/source/v1/schema.graphql`

The rule the placement follows: **a field is shown where the question it answers is asked.** Content is what is read, so it takes the page; the three facts needed while reading (identity, status, how many notes came out) take the bar; everything checked rather than read takes Details. Nothing is displayed twice, and nothing is displayed where it would be scrolled past.

| `SourceState` field | where it renders in `final.html` |
|---|---|
| `title` | the toolbar's `name` control and the bar's breadcrumb — never repeated above the reading column |
| `description` | Details → Provenance, under "What this source is" (a sentence to *check*, not to read past) |
| `content` | **the reading surface** — the only thing on the page |
| `sourceType` | Details → Provenance (and the `Type` select in the ingest and edit states) |
| `status` | the bar's pill (read-only); the *change* in Details → Extraction; queueing moves the pill to `EXTRACTING` |
| `provenance.author` | Details → Provenance, "Where it came from" |
| `provenance.url` | same block, as a link |
| `provenance.publishedAt` | same block — added this pass |
| `provenance.method` | same block |
| `provenance.tool` | same block — added this pass (it is not `convertedBy`; one is the ingesting tool, the other made the text) |
| `extractedClaims[]` | Details → Claims, with the count in the bar; includes the **unresolved-reference** state (a ref whose note is not in the drive) |
| `extractionStats.claimCount` | Details → Extraction, and the bar's `12 claims` |
| `extractionStats.skippedCount` | Details → Extraction, and the bar's `47 not taken` |
| `extractionStats.skipRate` | Details → Extraction, **narrated, not scored** |
| `extractionStats.extractedAt` | Details → Extraction — added this pass |
| `extractionStats.extractedBy` | Details → Extraction — added this pass |
| `attachments[]` (`id`, `ref`, `mimeType`, `fileName`, `sizeBytes`, `role`, `page`, `alt`, `width`, `height`, `attachedAt`) | **two places, deliberately.** Rendered *inline in the reading path*, at the paragraph that references them — the model's own comment says they are referenced from `content` as `![alt](attachment://…)`, so they are content. And listed in Details → Provenance so the set is **checkable** (every figure cut from the page accounted for) |
| `originalFile` · `originalFileName` · `originalMimeType` · `originalSizeBytes` | Details → Provenance, "Original document", plus the viewer overlay |
| `originalAttachedAt` | same block — added this pass |
| `convertedBy` | Details → Provenance, "The text itself" |
| `createdAt` | Details → Provenance, "Who put it here" — added this pass |
| `createdBy` | same block ("Ingested by") |

**What the mock deliberately does not draw, because the model does not store it:**

- **No `parts` / chunk count.** The first pass of this mock showed `117 parts`. There is no such field — the count belonged to a conversion *run*, not to the document — so it was removed rather than left as a plausible-looking invention.
- **No character count as stored data.** `Characters: 13,687` is counted from `content`; the mock says so in the pane, because the model keeps the text itself, not a size for it.
- **No folder membership field.** A source's placement lives in the vault (its parent folder), not in `bai/source`; it is therefore shown as the bar's breadcrumb, and the outline rail names the folder without inventing a position (`1 of 117` was invented and is gone).
- **No claim↔paragraph anchoring**, because `extractedClaims` holds note refs with no source offsets.

Fields in the inputs that are **system-set, not user-edited** — `IngestSourceInput.method`/`tool`/`createdAt`/`createdBy`, `RecordExtractionStatsInput`, `AttachOriginalFileInput.convertedBy` — appear in Details as facts the reader can verify, and are never form fields. `AddAttachmentInput`/`RemoveAttachmentInput` and `RemoveExtractedClaimInput` have no home in this editor: attachments are produced by the conversion and claims by the agent, so exposing add/remove here would be a different product decision, not a layout one.

## Decisions the mock takes (override any)

- **The reading surface is the darker `--bai-surface`**, not the app's `--bai-bg`. It is the same decision `b-conventional.html` already made, and it separates the page you read from the chrome around it without adding a card, a border or a shadow. The bar and rail keep `--bai-bg` so the text column reads as the page.
- **The `OriginalFilePanel` moves behind one action.** A converted source's `originalFile` is an affordance, opening as an overlay — not a panel that pushes the text down. A source *without* an original keeps the same button and says so there, which is also where re-attaching lives.
- **Claims are a drawer, not a sidebar.** Closed by default; the bar shows the count (`12 claims`) so the fact is known without the space being spent. Inside, claims are the primary tab and provenance/extraction are its siblings.
- **`skipRate` is described, not scored.** `47 of 59 passages were not taken — a measurement, not a shortfall`, neutral colour. If a source yields *zero* claims that is stated plainly as a fine outcome, not as an error.
- **No claim↔paragraph anchoring.** The model stores `extractedClaims` as a flat list of note ids; there are no source offsets. The mock therefore never draws a claim beside the paragraph it came from — an invented association is worse than none.
- **Reading measure, not full-bleed text.** `78ch` at 16px/1.7. Full-window-width prose on a 27" monitor is unreadable; "full page" means the *page* is the reading surface, not that lines run to the edges.
- **Outline rail is optional and off by default**, because it costs measure; it opens on the bar's `Outline` action.
- **Dark and light are both mocked**, because the app ships both (`data-bai-theme`).

## 🔍 SIX MINDS MAPPING (the final)

- **Vision:** one column of text at `78ch` on the darker `--bai-surface`, no card; the bar is `--bai-bg` at 44px so it reads as a frame, not a wall; the only accent-coloured things are the queue action, the active panel and the progress line.
- **Wayfinding:** breadcrumb `Sources / design-for-how-people-think / Wayfinding` in the bar; status pill beside it; outline rail for position inside the text; a 2px progress line on the bar's bottom edge; `Esc` returns from anything opened.
- **Memory:** the docs-reader schema — sticky bar, text column, outline, inspector drawer, `Edit` to edit in place, tabs inside the drawer, the toolbar above doing what a toolbar does.
- **Language:** *source, source type, provenance, extracted claims, Queue for processing, INBOX/EXTRACTING/EXTRACTED/ARCHIVED, revisions, original document* — the vault's own vocabulary, never "chunks" or "AI summary".
- **Decision:** reading is never blocked by chrome; the claims count is in the bar so the extraction question is answered before it is asked; the queue action changes to its own state rather than disappearing; the drawer carries the status *change* so the pill can stay a pill.
- **Emotion:** the source reads like a document, not a database row; extraction is narrated neutrally so a thin chapter is not a failure; the progress line and the claims count both answer "how is this going?" without a spinner or a percentage.
