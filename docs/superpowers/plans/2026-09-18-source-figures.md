# Source Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `bai/source` shows the figures and display formulas of the document it came from — as images, inline, where the text had `<!-- image -->` and `<!-- formula-not-decoded -->` — so a person reads the source the way they read the PDF, and the extract agent can open the same pictures and derive claims from them.

**Why images, not decoding (measured 2026-09-18):** docling's formula decoder (CodeFormulaV2) did not finish 79 formulas in 10 minutes on CPU — more than 7.5 s per formula; there is no GPU path on this machine. A vision model reads a formula crop for ~1 000 tokens. So the vault stores the picture and lets whoever reads it — human or model — do the reading.

**Architecture:** The conversion service already asks docling for the document; asking for JSON as well gives every **picture** with its PNG embedded (`image.uri`, 72 dpi, with page and box) and every **formula** as a text item with no box (`prov: []`). Formulas are located by the gap between their positioned neighbours in reading order (72 of 79 on the paper; 7 straddle a page break and are skipped), the page rendered once with Ghostscript at 200 dpi (156 ms) and the region cropped with `sharp` (13 ms; coordinates validated against a text box). Crops travel to the client in the convert response; the client uploads each once through the attachment service (content-addressed), registers it on the source with a new `ADD_FIGURE` operation, and rewrites the placeholder to `![…](attachment://v1:<hash>)`. The markdown preview resolves `attachment://` images through the attachment loader. The extract skill fetches them over `GET <origin>/attachments/<hash>` with the bearer (verified: 401 without, 200 with) and opens them with Read.

**Why a model change:** the reactor's attachment reference read model is **schema-driven** — it registers only fields typed `AttachmentRef` in operation inputs. An `attachment://` string inside `content` is invisible to it, so an inline figure would be a blob no document claims. The `figures` list is how a source _claims_ its pictures.

**Tech stack:** docling.rs JSON output, Ghostscript (`gs`, already a detected capability and in the Dockerfile), `sharp` (npm, prebuilt for glibc and musl; today a transitive dependency — add it), `@powerhousedao/reactor-attachments`, the source document model via reactor-mcp, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-convert-subgraph-design.md` §5.1 (ladder, progress, score) and this plan.

## Decisions

- **Opt-in on the wire:** `POST /convert?figures=1`. Crops are base64 in JSON (~10 KB a formula, tens of KB a picture); the intake asks for them, other callers are not made to carry them.
- **Placeholders stay in the service's markdown.** The response lists figures with a `placeholderIndex` (the n-th `<!-- image -->` or n-th `<!-- formula-not-decoded -->`) and the _client_ substitutes after upload, because only the client knows the attachment ref. No `figure://` interim scheme.
- **Alt text says what it is:** `figure 3, page 8 — Caption text` / `formula 12, page 7 — not decoded`. An agent reading `content` as text knows it is looking at a picture; the extraction score keeps counting undecoded formulas.
- **Degradation, never failure:** no `gs` → pictures still come (embedded), formulas stay placeholders; no `sharp` → same; a formula whose neighbours are on different pages → placeholder. `/health.capabilities` gains `gs` and `sharp`; the review says "N formulas could not be located".
- **Budget:** total figure bytes per file capped (8 MB default, `CONVERT_FIGURES_MAX_BYTES`); over it, formulas are dropped first, then pictures, and the response says how many.
- **Tables are not this plan.** Filling docling's cell grid with pdf.js text (correct digits, no OCR) is the natural next step and is recorded in the spec as a follow-up.

## File structure

- `scripts/docling-serve/figures.mjs` (+ `.d.mts`, `.test.ts`) — pure: reading order from `body.children`, formula regions from neighbour gaps, page→pixel maths, placeholder indexing, budget.
- `scripts/docling-serve/server.ts` — `?figures=1`: JSON pass, `gs` render per needed page, `sharp` crops, `figures[]` in the response, capabilities.
- `subgraphs/convert/lib/service.ts`, `routes/convert.ts` — passthrough (`figures` opt-in forwarded).
- `document-models/source` — `SourceFigure`, `figures`, `ADD_FIGURE` (via MCP), reducer in `src/`, tests.
- `editors/knowledge-vault/lib/intake-service.ts`, `intake-model.ts`, `hooks/use-intake-batch.ts` — upload figures once per file, `ADD_FIGURE` per source, placeholder rewrite, progress "attaching N figures".
- `editors/shared/markdown-preview.tsx` — `![alt](attachment://…)` → `<img data-attachment-ref>`; resolver effect in `MarkdownPreview`.
- `skills/extract/SKILL.md` (plugin) — read the source's figures.

### Task 1: `figures.mjs` — locate, index, budget (pure, tested) — DONE 2026-09-18 (13 tests; +`interiorRows` for crop tightening)

- [ ] `readingOrder(doc)` walks `body.children` through `texts/pictures/tables/groups` refs.
- [ ] `formulaRegions(doc)` → `{ page, box:{l,t,r,b}, placeholderIndex }[]` from neighbour gaps; skips cross-page; pads 4 pt.
- [ ] `pictureFigures(doc)` → `{ page, box, placeholderIndex, png(base64), caption }[]` from `image.uri` + `captions[]` refs.
- [ ] `toPixels(box, pageSize, dpi)` (BOTTOMLEFT origin) — the maths validated on `texts/5`.
- [ ] `applyBudget(figures, maxBytes)` — formulas dropped first.
- [ ] Tests on a fixture cut from the paper's JSON (3 pictures, a page of formulas, one cross-page).

### Task 2: the service — `?figures=1` — DONE 2026-09-18 (measured: 73 figures, 213 KB, +12 s on the paper; pictures from the 200 dpi render)

- [ ] `probeBinary("gs")` and `import("sharp")` behind the capabilities cache; `/health.capabilities.gs`, `.sharp`.
- [ ] After the plain pass, when `figures=1` and the format is PDF: `warm.convertFile(file, {to:"json"})` (measure — if it re-runs layout, ask docling for both in one call or accept the cost and record it); pictures from JSON; formula pages rendered once each with `gs -r200 -dFirstPage -dLastPage`, cropped with `sharp.extract`; phase `"figures"` on the job with `figuresDone/figures`.
- [ ] Response: `figures: [{ id, kind, page, placeholderIndex, alt, mimeType, width, height, bytesBase64 }]`, `figureStats: { pictures, formulas, located, skipped, droppedForBudget }`.
- [ ] Live check on the paper (3 pictures + 72 formulas) and the Sky report (25 pictures); record timings in the spec.

### Task 3: the model — `attachments` on `bai/source` — DONE 2026-09-18 (general, not figure-specific: `SourceAttachment { id ref mimeType fileName sizeBytes role page alt width height attachedAt }`, `role` free text; `ADD_ATTACHMENT` / `REMOVE_ATTACHMENT`; dispatched to model doc `3b8c5de9…` through the signed CLI because reactor-mcp did not connect; `ph-cli generate document-model --document` regenerated gen + src; 41 model tests, reducers 98.9 % / 95.5 %; a latent manifest error — `CONVERT_SERVICE_AUTOSTART` without `type: "var"` — was fixed on the way)

- [ ] `enum FigureKind { PICTURE FORMULA }`, `type SourceFigure { id: OID! ref: AttachmentRef! kind: FigureKind! page: Int alt: String mimeType: String width: Int height: Int }`, `figures: [SourceFigure!]!` on `SourceState` (initial `[]`).
- [ ] `ADD_FIGURE { id: OID!, ref: AttachmentRef!, kind: FigureKind!, page: Int, alt: String, mimeType: String, width: Int, height: Int }` with `DuplicateFigureIdError`; `REMOVE_FIGURE { id: OID! }` with `FigureNotFoundError`.
- [ ] `src/reducers` + tests to ≥ 95 %; `git diff document-models/` shows only these lines; `bun run tsc && bun run test`.

### Task 4: publish — upload once, claim per source, rewrite — DONE 2026-09-18 (`intake-attachments.ts`, 8 tests; `Section.placeholderBase` counted at convert time so the whole markdown is not kept; `publishFile` hashes figures with the original, rewrites each source's slice, batches `ADD_ATTACHMENT` with `ATTACH_ORIGINAL_FILE`, uploads once each; a figure that fails to hash keeps its placeholder; `PublishResult.attachments` / `attachmentErrors`)

- [ ] `convertFile(…, { figures: true })` → `ConvertedFile.figures`.
- [ ] `publishFile`: after the folder, `prepare`+`upload` each figure once (dedupe by hash); per source, rewrite the placeholders inside its `markdownRange` to `![alt](ref)`; `INGEST_SOURCE` with the rewritten content; `ADD_FIGURE` for each figure in that source (one `POST actions` batch per source).
- [ ] Row progress: "attaching 12 figures"; `attachError` path covers figures too; a figure upload failure leaves the placeholder and reports it — never blocks the publish.
- [ ] Tests: placeholder rewrite by index within a slice; budget-dropped figures leave placeholders; the body-shape test for `POST actions` extended to `ADD_FIGURE`.

### Task 5: preview — inline images — DONE 2026-09-18 (renderer + resolver; 3 tests)

- [ ] `inlineFormat`: `![alt](url)` before the link rule; `attachment://v1:<hex>` → `<img class="md-img" data-attachment-ref="…" alt="…" loading="lazy">`; `https:` images allowed through `safeUrl`; everything else renders the alt text.
- [ ] `MarkdownPreview`: effect finds `img[data-attachment-ref]`, resolves via `useAttachmentLoader` (blob URLs, revoked on unmount), shows alt while loading, alt + "unavailable" on failure. Styles: max-width 100 %, `--bai-surface` backing for formula crops.
- [ ] Source editor and intake review both render through it — no other change; verify a Sky source with 25 figures scrolls without jank.

### Task 2b: figures for the text-layer rung — DONE 2026-09-18 (`documentToBlocks` + `insertFigurePlaceholders`, 4 tests; Sky: 25/25 charts placed, +39 s)

### Task 6: the extract skill reads figures

- [ ] In `skills/extract/SKILL.md`: before extracting, list `figures[]` on the source; download each **picture** with `curl -H "Authorization: Bearer $(switchboard auth token)" <origin>/attachments/<hash> -o <scratch>/<id>.png` and `Read` it; open **formula** crops when a section's text refers to one or a claim needs it; put `figure N, page P` in the `DERIVED_FROM` reason; report `figuresRead` in the extraction stats message.

### Task 7: acceptance

- [ ] Paper: 3 figures + 72 formulas visible in the source editor; Sky: 25 charts visible; `Extraction:` line unchanged in meaning; publish time recorded; attachments deduplicated across the file's sources (one upload per figure).
- [ ] Spec §5.1 amended with the measurements; README ladder table notes figures.

## Execution handoff

Inline, one session, no subagents. Stop after Task 2 (measurements decide the budget default) and before Task 3 (the model change needs the owner's approval and a connected reactor-mcp). Nothing is committed without the owner's say-so.
