# Intake view — design proposal (Six Minds)

**Stage:** design proposal, awaiting green light. Nothing in the React editor has been changed.
**Method:** `.claude/skills/six-minds-design-skill.md` — cognitive audit → three Buxton concepts → evidence-based blend.
**Spec / plan:** `docs/superpowers/specs/2026-09-17-intake-view-design.md`, `docs/superpowers/plans/2026-09-17-intake-view.md` (Task 1).

Open `index.html` (`file://` is enough; no build step). Self-contained HTML, live `--bai-*` tokens from `style.css`, light/dark toggle bottom-right.

| file | what |
|---|---|
| `final.html` | **the blended design.** One screen, five states via the switcher bottom-left: `#landing` (empty vault / drop zone), `#batch` (files at different steps + the review pane), `#done` (one file published, others converting), `#complete` (every file in the vault → a summary card with **Finish**), `#finished` (panel closed; the Sources view is the folder list again, new folders chipped) |
| `a-minimal.html` · `b-conventional.html` · `c-immersive.html` | the three Buxton sketches the final was blended from |
| `index.html` | everything side by side, and what was taken from each |

## The two requirements the final is built around

1. **N + 1 uploads.** The drop zone never leaves the screen (goal header, right); files arrive at any time and join the queue; the batch converts one at a time (the service serialises anyway) and the header counts stay honest.
2. **Always show where each file is on the way to the goal.** Every row carries a four-step *journey strip* — Chosen → Converted → Reviewed → In the vault — with its current step lit (or red where it halted). The review pane says "Step 3 of 4". The goal header says how many sources are already in the vault and how many files still need the user. "Done" is never a word: it is "8 sources in /sources/<document>/ · queued for extraction · Open in Sources".

## Where it lives (decided 2026-09-17)

**No new tab.** The intake panel is part of the **Sources view**: "＋ Add sources" in the Sources header opens the drop zone; the batch panel and the review pane sit above the folder list; an empty vault's Sources view *is* the landing. The **Sources tab carries a notification badge** with the number of files waiting for the user (ready for review, or failed) — so the user can go to Chat while a book converts and be called back by the badge. That requires the batch state to live above the view switch (in `DriveExplorer`, or a small store), not inside the Sources view component.

## Decisions the mock takes (override any)

- Files are **grouped by what they need**: *Needs you* (ready for review, failed) → *Converting* (converting, waiting) → *In the vault*. A row moves between groups as its state changes.
- Furniture (`Praise for…`, `[ contents ]`, `How to Contact Us`) is **present but unticked**, with the reason on the row.
- A merged section shows **"contains: …"** so its name is explicable.
- **Every section opens (▸) to show exactly what the source will contain** — the rendered markdown slice, tables intact — so the tick is decided on evidence, not on a title. Two are open in the mock with their *real* content: "Wayfinding" (which turns out to open with *The Six Minds of Experience*, folded in) and "Praise for …" (which is the cover blurb). Keyboard: ↑↓ move, space ticks, → opens. **"⤢ Full screen"** in the preview footer opens the whole part in a reader overlay — the app's modal pattern — with the tick in its header and ← / → to read on to the previous or next part; Esc, ✕, "Back to review" or a click outside returns to the review exactly as it was (the overlay never disturbs the view behind it).
- The review pane opens beside the list, never instead of it; the next file that becomes ready opens there when nothing is selected.
- After publish the row stays, green, linking to Sources and Pipeline; it cannot be published twice.
- **The batch has an end.** When no file is queued, converting, waiting for review or failed — every one is in the vault (or was removed) — the whole panel collapses to a completion card: the count of sources and folders, the journey strip fully green, one row per folder created, and **Finish**. Finish clears the batch and closes the panel; the Sources view shows the folder list with the new folders chipped *new*; the tab badge is gone. "＋ Add sources" opens a fresh batch. A failed file blocks completion until it is retried or removed — the panel never quietly drops a file.
- **Folders and sources are cards, and they differ.** A folder card: lifted surface, accent folder glyph, bold name with a trailing `/`, a count and a status pill, *Open*. A source card: indented under its folder, page glyph in grey, the section title, chars, a status pill (`extracting` warm, `extracted` green). Same card language as the completion summary, so "what just landed" and "what was already there" read as one list.
- The inline preview is a fixed-height *glimpse* ("is this what I think it is?"); **"⤢ Read the whole part"** is the one way to read all of it (the reader overlay, with ← / → across parts). "Show all" was removed: two controls for one microgoal, and an inline expansion of a 13,687-char part pushed the rest of the list off-screen.
- No percentages anywhere (nothing is measured that would justify one); elapsed time and "file 4 of 5" instead.
