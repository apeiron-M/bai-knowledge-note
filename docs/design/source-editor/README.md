# `bai/source` editor — design proposal (Six Minds)

**Stage:** design proposal, awaiting green light. Nothing in the React editor has been changed.
**Method:** `.claude/skills/six-minds-design-skill.md` — cognitive audit → three Buxton concepts → evidence-based blend.
**Analysis of the current editor:** `editors/source-editor/editor.tsx` (905 lines, read in full 2026-09-18).

Open `index.html` (`file://` is enough; no build step). Self-contained HTML, live `--bai-*` tokens copied from `style.css`, light/dark toggle bottom-right.

| file | what |
|---|---|
| `final.html` | **the blended design.** One screen, six states via the switcher bottom-left: `#read` (default — the source, full page), `#outline` (the outline rail open on a 117-part book), `#details` (claims + provenance + extraction drawer), `#history` (revisions, scrubbed), `#edit` (editing inline, not a page swap), `#original` (the document it was converted from) |
| `a-minimal.html` · `b-conventional.html` · `c-immersive.html` | the three Buxton sketches the final was blended from |
| `index.html` | all four side by side, and what was taken from each |

## The surface, named first

**Command / Inspect** — the user has drilled into one object and is either reading it or checking a fact about it. Not a Monitor (nothing is watched over time), not Decide/Learn (there is no argument to make). Reading *is* the job; every other control is peripheral and must be reachable in one move without competing for the eye. That single commitment is what rules out cards, tiles and hero compositions before any colour is chosen.

## 🧠 COGNITIVE AUDIT CHECKPOINTS

1. **Vision / Attention.** The markdown text is the *only* thing allowed to occupy the optical centre: measured at ~72 characters per line, on the page background rather than inside a card, with everything else at `--bai-text-faint` or lower contrast. Today the text sits in a `max-h-[600px] overflow-y-auto` box *below* the title, description, original-file panel and tab bar — so the eye lands on chrome first and reads a 13,687-character chapter through a 600px window.
2. **Wayfinding.** Three questions must be answerable without scrolling: *which source is this?* (breadcrumb + title), *where is it in its life?* (one status pill: INBOX → EXTRACTING → EXTRACTED → ARCHIVED), *where am I in the text?* (outline rail + reading progress). A 117-part book needs the third one, which does not exist today.
3. **Memory / Semantics.** Users arrive with a reader's schema, not an admin's: a slim sticky bar, a text column, an outline, an inspector. Editing *in place* rather than a full-page form. Status is a **pill**, not a `<select>` — a dropdown that edits state is a form control wearing a badge's clothes.
4. **Language.** The vault's own words, unchanged: *source*, *source type*, *provenance*, *extracted claims*, *Queue for processing*, `INBOX`/`EXTRACTING`/`EXTRACTED`/`ARCHIVED`, *revisions*, *original document*, *status*. No "document insights", no "AI summary", no invented nouns.
5. **Decision making.** The microgoals, in the order a reader actually has them: ① *is this the text I think it is?* → read it; ② *did extraction get anything out of it?* → claims count, one drawer away; ③ *what do I do next?* → **Queue for processing** (or see that it already is); ④ *where did this text come from?* → the original document; ⑤ *what changed?* → revisions. Today ④ precedes ① on screen and ② is at the bottom of a 256px sidebar.
6. **Emotion.** The anxiety is *"did the machine take the right things out of my source?"* — so the claims list is reassurance, not metadata, and it must be one gesture away. The second anxiety is *"I opened this to read one paragraph"* — so nothing may require scrolling past anything to start reading. Calm, not clever: no gradients, no glow, no motion except a progress line.

## 🎨 DIVERGENT CONCEPTS EVALUATED

| | concept | what it optimises | what it costs |
|---|---|---|---|
| **A** | **Minimal** — `a-minimal.html` | Wayfinding and speed: a 40px bar, the text, nothing else. Details behind one button. | Under-serves a first-time reader who does not yet know what a *claim* is; hides the very thing a source exists for. |
| **B** | **Conventional** — `b-conventional.html` | Memory: the docs-reader schema everyone knows — sticky header, tabs, outline left, inspector right, cards. | Re-introduces exactly the problem: cards around the text, and the inspector's default-open state steals the centre. |
| **C** | **Immersive** — `c-immersive.html` | Attention and appeal: full-bleed type, chrome that recedes until summoned, a reading-progress line, the claims as a quiet rail. | Its strongest idea (summoned chrome) is hostile to the *checking* half of the job — a reader hunting for a control should never wonder where it went. |

**The blend (and why):** C's *page*, A's *bar*, B's *vocabulary*. Concretely — the text takes the whole width and the whole height of the viewport minus a slim sticky bar (C); that bar carries exactly the identity, the status pill and the one action, with everything else behind labelled buttons (A); and the panels that open are the familiar ones, named in the vault's words — details, revisions, original (B). A's "one button" idea survives as **Details**, because the claims drawer is the answer to the source's own reason to exist; B's tabs survive *inside* that drawer rather than over the text.

## The four requirements, and where each is met

1. **Full page for reading.** The reader column is `min(78ch, 100%)` centred in the full viewport, and the *page* scrolls — there is no inner scroller anywhere in `#read`. The bar is `position: sticky` and 44px tall, so the text is never below a wall of chrome.
2. **Every control reachable.** Outline · Details · Revisions · Original · Edit sit in the bar's right cluster; Queue for processing is the accent action; the status pill is read-only and the status *change* lives in Details (where a state change belongs) plus the queue action. All are one click from any scroll position.
3. **Check, then back to work.** Nothing needs a second screen: `Esc` closes whatever opened, and the drawer/rail never unmount the text. Reading progress is visible, so "am I nearly done?" is a glance.
4. **This is the source the notes were derived from.** The claims are named as *extracted claims*, counted in the bar (`12 claims`), listed in the drawer with links straight into each note, with the extraction stats beside them. The original document is a first-class action (`Original`), not a panel that pushes the text down.

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

## Decisions the mock takes (override any)

- **The `OriginalFilePanel` moves behind one action.** A converted source's `originalFile` is an affordance (`Original`, with the size and type on hover), opening as an overlay — not a panel that pushes the text down. A source *without* an original keeps the same button and says so there, which is also where re-attaching lives.
- **Claims are a drawer, not a sidebar.** Closed by default; the bar shows the count (`12 claims`) so the fact is known without the space being spent. Inside, the claims list is the drawer's primary column and provenance/extraction are its tabs.
- **`skipRate` is described, not scored.** `47 of 59 passages not taken · a recap chapter can legitimately yield none`, neutral colour. If a source yields *zero* claims that is stated plainly as a fine outcome, not as an error.
- **No claim↔paragraph anchoring.** The model stores `extractedClaims` as a flat list of note ids; there are no source offsets. The mock therefore never draws a claim beside the paragraph it came from — an invented association is worse than none.
- **Reading measure, not full-bleed text.** `78ch` at 16px/1.7. Full-window-width prose on a 27" monitor is unreadable; "full page" means the *page* is the reading surface, not that lines run to the edges.
- **Provenance stays visible as one line** under the title (author · method · ingested by) rather than in a panel — it is the answer to "is this text trustworthy", which is a reading concern, not an admin one.
- **Outline rail is optional and off by default**, because it costs 220px of measure; it opens on the bar's `Outline` action and on a wide viewport it can dock.
- **Dark and light are both mocked**, because the app ships both (`data-bai-theme`).

## 🔍 SIX MINDS MAPPING (the final)

- **Vision:** one column of text at 78ch on the page background, no card; the bar is `--bai-surface` at 44px so it reads as a frame, not a wall; the only accent-coloured things are the queue action, the status pill and the progress line.
- **Wayfinding:** breadcrumb `Sources / Design for How People Think / Wayfinding` in the bar; status pill beside it; outline rail for position inside the text; a 2px progress line on the bar's bottom edge; `Esc` returns from anything opened.
- **Memory:** the docs-reader schema — sticky bar, text column, outline, inspector drawer, `⌘E`/`Edit` to edit in place, tabs inside the drawer.
- **Language:** *source, source type, provenance, extracted claims, Queue for processing, INBOX/EXTRACTING/EXTRACTED/ARCHIVED, revisions, original document* — the vault's own vocabulary, never "chunks" or "AI summary".
- **Decision:** reading is never blocked by chrome; the claims count is in the bar so the extraction question is answered before it is asked; the queue action changes to its own state rather than disappearing; the drawer carries the status *change* so the pill can stay a pill.
- **Emotion:** the source reads like a document, not a database row; extraction is narrated neutrally so a thin chapter is not a failure; the progress line and the claims count both answer "how is this going?" without a spinner or a percentage.
