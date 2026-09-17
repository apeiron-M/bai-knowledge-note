# Convert subgraph — design

**Status:** the **conversion capability** (out-of-process service + `subgraphs/convert`) is **approved** — 2026-09-17 — and implemented by `docs/superpowers/plans/2026-09-17-convert-subgraph.md`, running inline, no subagents. Nothing in the React app or the subgraph tree has been changed yet.
**Scope of this spec:** the *conversion capability* — an out-of-process document-conversion service plus a `subgraphs/convert` that proxies it and turns its output into a source-shaped **plan**. It creates no documents and ships no UI.
**Downstream (separate plan, not covered here):** the Intake view in `editors/knowledge-vault/`. Its three concepts are drafted but **not approved**; they are recorded in §12 so this spec and that design stay consistent. §13.1's backend question is open and may change which service is primary.

---

## 1. The problem

A human can add a `bai/source` to the vault today only by **pasting plain text** into the source editor's `IngestForm` (`title`, `description`, `sourceType`, `author`, `url`, one `content` textarea). Everything upstream of that paste is done by hand in another application: open the PDF, select, copy, hope the tables survive. Three consequences, all already documented elsewhere in this repo:

- **Format loss.** Tables, headings, footnotes and page structure are what a PDF *is*; `textContent` is what survives a copy-paste. A note extracted from a flattened table cites a source whose table no longer exists.
- **One paste, one document.** A 300-page book becomes a single `bai/source`, and `AGENT.md` is explicit about the cost: *"every operation stores a full JSON copy of the document's state, so each `ADD_EXTRACTED_CLAIM` on a book-sized source re-serialises the whole book."*
- **Provenance is never filled.** `method` and `tool` are exactly the fields a hand-paste cannot supply, and `INGEST_SOURCE` builds the provenance object only when one of `url`/`author`/`publishedAt` is present — so they are silently discarded rather than merely missing.

## 2. Goal

One capability, callable from every surface the vault already has: **bytes in, structured text and a proposed source split out.**

- Nothing about the file's format should require a decision from the user.
- The split must follow the document's own authored structure, and the user must see it *before* anything is written.
- The agent path (`powerhouse-knowledge` plugin, `switchboard` CLI, REST) and the app path should reach the same implementation.

**Non-goals for this spec:** creating documents, queueing tasks, the Intake UI, OCR-quality tuning, transcription of audio/video (the format is *accepted* by the backend; nothing in this plan exercises it).

## 3. Decision record

Five shapes were considered. The rejected ones are recorded with the evidence, because four of them look reasonable until you check this codebase.

**Chosen: an out-of-process conversion service, behind a `subgraphs/convert` proxy.**

| Rejected shape | Why |
|---|---|
| **In-process native binding inside the Switchboard** (`require("docling.rs")` in a subgraph) | It works — verified on this host, see §11 — and it dies in the image you deploy. `docling.rs@1.55.0` publishes `linux-x64-gnu`, `linux-arm64-gnu`, `win32-x64-msvc` only: **no musl**, and the switchboard image is `node:24-alpine`. Worse, this package has already paid for this lesson once: `processors/graph-indexer/embedder.ts` documents that from a bundled dist the native binding's relative `require` *"can never resolve"*, and that deployed Switchboards *"stub native modules"*. Their escape was to run the **wasm** build under Node with four empirical tricks — and for docling the wasm build is the weak one (no headings, lists or tables for PDF; no chunking API at all). |
| **`subgraphs/convert` spawns the service itself** | A subgraph has no process control. `BaseSubgraph` provides `http`, `reactorClient`, `relationalDb`, `graphqlManager`, `syncManager`, the auth services, and exactly two lifecycle methods (`onSetup`, `onDisconnect`); the whole package contains no `child_process` reference. The service is a compose/deployment concern; the subgraph is only its client. |
| **Browser-side wasm (`docling.rs-wasm`)** | ~11 MB raw / ~3.4 MB gzip for the *declarative* converters and **PDF without structure** — "flat, line-grouped paragraphs in reading order; no headings/lists/tables/pictures, since those need the layout model". Full PDF structure in-page means the layout model (~68 MB) + TableFormer (~260 MB) + OCR (~10 MB) over ONNX Runtime Web, with COOP/COEP for threads, inside Connect. Not defensible as a default; revisit as a later enhancement for the cheap formats only. |
| **A new route inside `subgraphs/http`** | Would work, and this is the one genuinely close call. Rejected because `subgraphs/http` is already ~15 route modules and an auth/lint/placement pipeline; conversion has a different failure surface (an external dependency, long jobs, big bodies) and a different lifecycle. A sibling subgraph keeps `http`'s blast radius where it is. |

**Decision — the default backend is the local service over `docling.rs`** (endorsed 2026-09-17). The reasons are measured, not aesthetic:

- It is the **only backend whose behaviour is known** — every number in §11 came from it.
- It is **stateless**, so scaling out is replica count behind `CONVERT_SERVICE_URL`: no queue, no task registry, and no sticky sessions. (`docling-serve`'s own deployment docs require sticky sessions for replicas, because its async task state is node-local.)
- It runs **under Node as well as Bun**, which the vault's Vetra deployment needs (verified: `ready: true` on Node v26.8.1, no slower than Bun).
- Its cost is **~700 MB of models on a volume** against a **15.1 GB image** (measured).

`docling-rs-serve` is **out**: it is the same Rust pipeline as the local binding, so it inherits the same flat headings and adds only packaging. `docling-serve` is **an adapter to add only if its heading hierarchy proves worth the extra container** — that comparison is queued, and §13.1 records what it would take to change the decision.

**The `{markdown, chunks}` contract is a requirement on the backend, not a fact about it.** docling-serve answers a *different* shape — `{ document: { md_content, json_content, html_content, … }, status, processing_time, timings, errors }` — so it cannot be pointed at directly. Any backend is expected to be fronted by a small adapter that speaks this contract: the local Bun service *is* that adapter for `docling.rs`, and a ~40-line Bun adapter would do the same for `docling-serve` (map `document.md_content`, then issue the chunking request with `chunking_options`). That keeps the vault package backend-agnostic — one client, one shape — and it means adopting docling-serve later costs an adapter, not a change to `subgraphs/convert`.

## 4. Architecture

```
                          ┌──────────────────────────────────────────┐
  Connect / vault app ────▶│  Switchboard  (node)                     │
                          │                                          │
                          │  subgraphs/convert                       │
                          │    POST convert   (raw body, auth)       │
                          │    GET  convert/health                   │
                          │      │                                   │
                          │      ├── deriveSections()  ← vault shape │
                          │      └── ConversionService (client)      │
                          └──────────┬───────────────────────────────┘
                                     │  HTTP  (CONVERT_SERVICE_URL)
                          ┌──────────▼───────────────────────────────┐
                          │  conversion service (one of three)        │
                          │    bun + docling.rs      ← built here     │
                          │    docling-rs-serve      (container)      │
                          │    docling-serve         (container)      │
                          │      → markdown + chunk structure         │
                          └──────────────────────────────────────────┘
```

The boundary is deliberate: **the service knows formats; the subgraph knows the vault.** The service returns markdown and docling's chunk structure verbatim. It never sees `bai/source`, never decides what a source is, and holds no vault vocabulary. The subgraph owns `deriveSections()` (§6) and all vault policy.

### Data flow

```
bytes + filename
  → ConversionService.convert()            (service: markdown + chunks)
    → deriveSections(chunks)               (subgraph: sections + cut level)
      → 200 { sections, plan, backend }    (preview — nothing written)
        → [downstream, not in this spec]   create one bai/source per section,
                                            in /sources/<work>/, then queue
```

**Convert and create are separate on purpose.** A single call that both converted and wrote would make the preview impossible and the failure modes ambiguous. `POST convert` is read-only with respect to the vault: it authenticates, converts, and answers.

## 5. Contracts

### 5.1 The conversion service

Built at `scripts/docling-serve/`. Local only; bound to loopback by default.

```
GET  /health
  → 200 { ok, backend: "docling.rs", version, ready, missing: string[], formats: string[] }

POST /convert?filename=<url-encoded>
     content-type: application/octet-stream
     body: the file's bytes
  → 200 { markdown, chunks: [{ text, headings?, docItems?, contextualized? }],
          format, inputName, timings: { convertMs, chunkMs }, backend }
  → 400 FILENAME_REQUIRED | EMPTY_BODY
  → 415 UNSUPPORTED_FORMAT          (not in supportedFormats(), or an ML format without models)
  → 500 CONVERT_FAILED              (docling threw; message passed through)
```

Implementation notes that matter:

- **The filename's extension is the format.** docling's `formatFromName` dispatches on it, so the service writes the upload to a temp file **preserving the extension**, converts, and removes it. A temp file without its extension converts as garbage or not at all.
- **Model resolution is CWD-relative, and that is not a shortcut.** `docling.rs` publishes an `exports` map containing only `"."`, so its own helpers — `deps.js`'s `resolvePaths` / `exportEnv` — **cannot be imported by subpath** (`Cannot find module 'docling.rs/deps.js'`, verified). The binding's documented resolution is `.models/` and `.pdfium/lib` relative to the process's working directory, so the service resolves its model home (`DOCLING_RS_HOME`, else CWD) and changes into it at startup. `GET /health` reports `ready` and `missing` from `checkDependencies()`, so a mis-set model home is visible rather than silent.
- **`GET /health` is the readiness probe the subgraph reports through**, and it distinguishes "no models" (declarative formats still fine) from "broken".
- Chunking uses the file-based API (`chunkFileAsync`); `chunkDocument()` wants the docling-core **JSON string** — the `content` of a `convert*` call made with `to: "json"`, not that call's result object (passing the object throws `Failed to convert JavaScript value`).
- **Chunk with `chunkFile()` — the cheaper JSON path was tried and rejected on fidelity.** The binding's typing invites the shortcut: *"a document converted once … chunks without re-converting"*, via `chunkDocument(jsonContent)`, and it is genuinely faster — on the same 2-page CV, JSON-chunking measured **890 + 885 ms** against `chunkFile`'s **1 480 + 1 510 ms**, ~1.6×. But the fidelity check the plan made mandatory **failed on real content**: the two paths agree on chunk *count* (55 each) and on every heading path, and then diverge at character 4 145 of the normalised text, inside the CV's education table —

  | path | same region |
  |---|---|
  | `chunkDocument(json)` | `Copenhagen Business Academy = AP Degree in Computer Science. , Copenhagen, Denmark = 201…` |
  | `chunkFile()` | `🟤, 1 = Copenhagen Business Academy. 🟤, 2 = Copenhagen, Denmark. , 1 = AP Degree in Compu…` |

  — the table's cells come back **associated differently**, which is the one thing embeddings must not get wrong. That is the plan's explicit stop condition ("a paragraph, a table row"), so the service uses `chunkFile()`.

  **What that costs, at the two scales measured.** On the 2-page CV it is invisible: `chunkFile`'s internal re-conversion does not reload models (three consecutive calls: **1 630 / 1 522 / 1 580 ms**), and the implemented service does the whole job in **3.0 s** — so the rejected path's 1.6× did not survive contact with a warm process. **On a 238-page book it does not hold**: the service measured **160.6 s** converting and **172.7 s** chunking, i.e. the chunk half costs a second full conversion and the rejected JSON path would have saved roughly **170 s of 333 s**. Correct tables are still the right trade — a mis-associated table is unrecoverable once embedded, while half of five minutes is a one-off ingest cost — but the honest statement is "about 2× the conversion work", not "0.6 s". It is also the strongest argument for the streaming API (`streamFileMarkdown`, §5.2) and for a longer-lived job shape if ingest throughput ever matters.

- **The chunker's output depends on the JavaScript runtime.** The same `chunkFileAsync` call on the same file returns **55 chunks / 4 928 normalised chars under Node** and **54 / 4 910 under Bun**, differing in real text (`Powerhouse Remote` vs `Powerhouse`; `Co-Founder` present under Node only). This is not a reason to distrust either — it is a reason to **pin the runtime and record which one produced a given source's chunks**, because re-ingesting the same document on a different runtime would silently produce different sections. Node is both the deployed runtime (§7.1) and the one whose chunking keeps more content, so the service standardises on it.
- **The real efficiency lever is the warm pipeline.** The package exports a `Pipeline` class that *"keeps the ONNX models loaded across calls"*. A long-lived service should hold one, rather than calling the module-level functions per request and paying model load each time. Measured on the second and later requests, this is the difference between per-request constant overhead and actual conversion cost.
- `ConvertOptions` exposes a **PDF page window** (`pages: "A-B"`, or `"N"`, 1-based inclusive) — the only way to convert *part* of a book without rewriting the file, and therefore the tool for a fast fidelity check on a 238-page document.
- **A PDF that pdfium refuses needs a normalising retry — now verified, though the original trigger stopped reproducing.** During the spike a valid, unencrypted, 238-page O'Reilly PDF failed at load with `pdfium error: PdfiumLibraryInternalError(FormatError)` while `pdfinfo` read it happily, and converting a `gs -sDEVICE=pdfwrite` rewrite of the same pages succeeded. So the service treats a rewrite as a retry path, not a default (`convert → refusal → rewrite with qpdf, then gs → convert after each → still failing ⇒ 415`), because rewriting every PDF up front costs time for no benefit on the files that already work.

  **The retry path is now verified end-to-end — against purpose-built fixtures, because the original failure stopped reproducing.** The book that motivated it (md5-verified, mtime 2026-09-08) converts cleanly today under both Node and Bun, and every real-book run through the service returns `normalised: null`. So the trigger was reconstructed: small hand-built PDFs that tolerant readers accept and pdfium refuses, committed as `scripts/docling-serve/fixtures/` with their own README.

  | fixture | malformation | tolerant readers | pdfium | repaired by |
  |---|---|---|---|---|
  | `dangling_kid.pdf` | `/Kids [3 0 R 42 0 R]`, object `42` absent | 2 pages, `qpdf --check` clean | **refused** | `qpdf` → `200 normalised=qpdf` |
  | `count_mismatch.pdf` | `/Pages` declares `/Count 7`, has two pages | 2 pages, `qpdf --check` clean | **refused** | `gs` → `200 normalised=gs` |

  **The fixtures immediately found a bug in the first implementation**, which is the argument for having built them rather than moving on. That version tried `qpdf`, treated **exit code 0 as proof of success**, and handed the still-broken file back to the converter:

  ```
  original       THREW  PdfiumLibraryInternalError
  qpdf rewrite   THREW  PdfiumLibraryInternalError   ← exit code 0, no cure (it preserves the bad /Count)
  gs rewrite     OK     19 chars
  ```

  So `count_mismatch.pdf` answered **`500` with a raw pdfium error** while `gs` sat right there able to cure it. The repair loop now **converts after each rewrite and takes the first that works**, and answers **`415`, not `500`**, when none does — the rule being *the tool exiting 0 is not the test; the rewritten file converting is*. A second correction from the same exercise: the trigger is not a literal `FormatError` match. Both fixtures throw `PdfiumLibraryInternalError(Unknown)`, so the check matches the whole `PdfiumLibraryInternalError` family.

  One honest limit: with `gs` in the loop, a file it can recover will now succeed where a `415` might have been clearer. A 214-byte random "PDF" came back `200 normalised=gs` with empty markdown. Whether the *route* should treat an empty result as a failure is open — but it cannot be decided in the service, because an image-only PDF scanned without OCR legitimately yields little text (§13).

### 5.2 The subgraph route

```
GET  /api/@powerhousedao/knowledge-note/convert/health      auth: renown
POST /api/@powerhousedao/knowledge-note/convert             auth: renown
     ?filename=<url-encoded>&markdown=1&minSectionChars=<int>
     body: raw octets
  → 200 {
      filename, format, chars, chunks: <count>,
      sections: [{
        title, headingPath, text, charCount, chunks: number[],
        mergedFrom: [{ title, headingPath, charCount }],   // every group folded in; [] for a single group
        markdownRange: { start, end } | null              // [start,end) of `markdown`, UTF-16 units
      }],
      plan: { cutLevel, splitSections, mergedSections, rejoinedSections, ceiling, minSectionChars },
      markdown?: string,            // only with &markdown=1
      timings
    }
  → 400 FILENAME_REQUIRED | EMPTY_BODY | INVALID_MIN_SECTION_CHARS
  → 413 PAYLOAD_TOO_LARGE
  → 502 CONVERT_UNAVAILABLE   (service unreachable / non-2xx)
  → 500 CONVERT_FAILED
```

- `body: "raw"` with `maxBodyBytes`, because the octets are needed byte-for-byte (`ctx.rawBody`). `"parsed"` is for JSON, which is what the existing routes use; a file is not JSON.
- The markdown is omitted by default: the sections carry the same text, and a book-sized document would otherwise round-trip through the app twice. **But `text` is chunk text, and chunk text flattens tables** (measured: a CV's education table came back as `🟤, 1 = Copenhagen Business Academy. 🟤, 2 = …` triplets while the markdown holds a correct 3-column table). So every section also carries `markdownRange`, located from its heading line in the markdown, and a client that asks for `&markdown=1` can slice a table-correct body with it. Ranges are UTF-16 offsets (JS `String.length`), tile the markdown when every heading is found, and are `null` for a section whose heading could not be located (the preceding range then extends over it) and for ceiling-split parts. Measured on the 238-page book: **117 of 117 sections located, ranges contiguous, covering 398 051 of 398 051 characters**.
- `minSectionChars` overrides the folding floor of §6 (default 2 000; integer 0–200 000, `0` = do not fold). It is a granularity dial — see the sweep in §6.1 — exposed so the Intake view can offer it.
- **Registration order:** routes match in registration order across the package's single HTTP namespace, so `convert/health` is registered before nothing conflicting and there is no `convert/:id`; the paths are `convert` and `convert/health` only, and both are free today.

## 6. The section rule

This is the part that is genuinely a design decision rather than plumbing.

**A docling chunk is not a vault source.** Measured, not assumed: an HTML page of one `h1`, three paragraphs and one table produced **5 chunks, one per document element**, each carrying its heading path:

```json
{"text":"Intro paragraph.","headings":["The Vault"],
 "docItems":["#/texts/1"],"contextualized":"The Vault\nIntro paragraph."}
```

A 400-page book scales that to thousands. Sources at that granularity would recreate inside the vault exactly the dilution `AGENT.md` warns about — *"noise never announces itself, it just dilutes every query that touches its topic forever."*

**The rule:**

0. Group chunks into **contiguous runs** by heading path — not into one group per distinct path. Measured on the book: `[ SIDE NOTE ]` recurs sixteen times, and keying on the path stitched text from sixteen places into one out-of-order section (and did the same to `Memory`, `Decision Making` and `Emotion`, whose chapter-1 overview paragraphs were pulled into the chapters). A run ends when the path changes; a headless chunk after the first heading continues the run it appears in. Only leading headless chunks are front matter. Runs are also what make `markdownRange` possible: a section that is one span of the document has one span of the markdown.
1. Cut at **the shallowest heading depth that actually divides the document.** Try depth 1: if every chunk's `headings` is `["The Vault"]`, that yields one section, so try depth 2, and so on to depth 3. First depth producing ≥ 2 sections wins; if none does, the document is one section. (`cutLevel` records which.)
2. **Fold sections smaller than the floor into a neighbour** — `SECTION_MIN_CHARS`, 2 000 characters. Forward by default (a title page belongs at the top of the chapter after it, and reading order is preserved); a trailing undersized section folds back into the last survivor; a document where *every* section is undersized collapses to one section named after the document. `mergedSections` counts them. **This rule exists because of measurement, not taste — see §6.1.**
3. Chunks before the first heading become a leading section titled `<document name> — front matter`.
4. A section over the **ceiling (40 000 chars)** is subdivided at chunk boundaries. `splitSections` counts them. The ceiling is a safety valve for the re-serialisation cost above, not a target.
5. No headings at all (`cutLevel: 0`): one section titled `<document name>`.

2b. **A merged section is named after its largest part**, not the group that tipped it over the floor. Measured on a two-page CV: forward folding with "last group names the section" produced a section titled `MakerDAO SES` — an employer's name read as a heading — for text that was mostly *Core Competencies*; the fix names it `Core Competencies`. Furniture is small by definition, so the largest part is what the section is about. Every absorbed group is kept in `mergedFrom` (title, path, chars), so the Intake view can show "contains: front matter · Core Competencies · Professional Experience · MakerDAO SES" rather than losing them.
2c. **Rejoin adjacent sections with the same heading path** after folding. Contiguous runs cut a chapter in two wherever a boxed note with its own heading interrupts it; once the note has folded away (it is small), the halves sit side by side under one path and are one section again. `rejoinedSections` counts them (1 on the book at the default floor).

Order matters and is deliberate: **group → fold → rejoin → split.** Folding before splitting is what stops a title page from becoming a source; rejoining after folding is what stops a sidebar leaving a chapter in two; splitting last means a section that grew past the ceiling while absorbing neighbours is still divided.

Re-measured after these changes (2026-09-17), same book: 972 chunks → 383 runs → **117 sections** at the default floor (106 under the keyed grouping; the difference is the stitched sections coming apart into their chapters), every chunk in exactly one section, ~6 ms. Floor sweep: 0 → 383 · 2 000 → 117 · 4 000 → 68 · 8 000 → 36 · 12 000 → 25. What the floor still cannot do is recognise furniture that is *large*: `[ contents ]` survives at 13.7k chars, and a `FIGURE 2-6` caption can be the largest part of a merged section and so name it. Those are triage problems for the review step, not sizing problems.

Both thresholds are named constants (`SECTION_CHAR_CEILING`, `SECTION_MIN_CHARS`) so they can be tuned against real documents. They have been — §6.1.

### 6.1 What the whole-book measurement did to this rule

Implementing rule 1 faithfully and running it on a real 238-page book produced the exact failure the rule was written to prevent:

| document | chunks | sections from rule 1 alone |
|---|---|---|
| CV (2 pages) | 55 | **11** |
| Book pp 1–20 | 99 | **19** |
| **Book (238 pages)** | 998 | **290** — more than one per page |

The first twenty were a title page, `Praise for …`, a second title variant, `Revision History for the First Edition:`, `[ contents ]`, `PART III …` in one of its two spellings, `[ SIDE NOTE ]` and `Warning`. Rule 1 reduces 998 chunks to 290 sections and calls it structure; the vault would be handed 290 sources, several of them 92 characters of cover blurb. **A cut level cannot separate authored structure from furniture when the heading list is flat** — that is §6.2's finding, now measured all the way to its consequence.

Rule 2 (the floor) is the fix, and its dial was measured on the real function rather than modelled:

| floor | book (238 pp) | book (20 pp) | CV (2 pp) | largest section |
|---|---|---|---|---|
| 2 000 *(default)* | **107** | 10 | 2 | 12 770 |
| 3 000 | 80 | 7 | 1 | 13 473 |
| 4 000 | 62 | 5 | 1 | 12 770 |
| 6 000 | 45 | 4 | 1 | 17 385 |
| 8 000 | 35 | 3 | 1 | 17 385 |
| 12 000 | 24 | 2 | 1 | 23 195 |
| 20 000 | 16 | 1 | 1 | 23 195 |

**2 000 is defensible as the default because of what survives, not how many.** At that floor the furniture is gone: of the book's 107 sections only **4** read as boilerplate (`[ contents ]`, `[ SIDE NOTE ]`, `How to Contact Us`, a stray drop cap `P`) — the rest are the book's actual sections (`Emotion`, `Concrete Recommendations`, `Language`, `Decision Making`), each a few pages, each something a human could reasonably open. The remaining dial is therefore a *granularity* choice — 107 fine sections against 35 chapter-sized ones — not a choice between clean and noisy. It is exposed as `minSectionChars` precisely so the Intake view can offer it rather than hard-coding one answer.

Two smaller consequences: the **ceiling never fires** on this book at any floor (the largest section, 23 195, stays well under 40 000), so it remains an unexercised safety valve; and a **2-page CV becomes 2 sections, not 1**, which is right — a CV has a genuine two-part shape.

### 6.2 What the measurements did to this rule

Two real documents were converted during the spike, and both damage the assumption that a heading path is trustworthy. Recorded here rather than in §11 because they are arguments about *the rule*, not about the pipeline.

**A 20-page PDF sample of a published book** (238 pages total, O'Reilly trim size; see §11 for the numbers) came back with **97 of 99 chunks at heading depth 1 and 2 at depth 0** — the hierarchy is *flat*. Every chapter heading, every part title, and every piece of front matter is level 1, so there is no depth at which to nest. Worse, the level-1 set includes furniture: `[ contents ]`, `[ SIDE NOTE ]`, `Warning`, `Conventions Used in This Book`, `Praise for …`, and two spellings of `PART III …` differing by a colon. Cutting at depth 1 would mint a section per heading, several of them noise.

**The whole book makes that worse, not better.** All 238 pages: **996 of 998 chunks at depth 1**, and **289 distinct heading paths** — against a book whose table of contents has roughly fifteen chapters. The headings that would become sections include `Emotion` (33 chunks), `DESIGN FOR HOW PEOPLE THINK` (18), `Part I` (18), `[ SIDE NOTE ]` (16), `Revision History for the First Edition:` (15), `TRASH TALK` (15), `Further Reading` (17) — and, damningly, **`E` (20 chunks) and `V` (12)**: drop caps, read as headings. A rule that cuts at depth 1 would produce a 289-source vault from one book, a quarter of which are single letters and furniture.

**A two-page two-column CV** returned 54 chunks and 5 552 characters, and its heading paths are actively wrong: chunks under the employer `Powerhouse` carry `headings: ["Remote"]`, and chunks under two later employers carry `["Copenhagen, Denmark"]` — the *location* column was read as a heading. Cutting at depth 1 would produce sections named after cities.

Neither is a bug in docling; both are the layout model doing exactly what it says, on documents that are not written for it. Three consequences for the rule:

1. **The heading path is a hint, not an authority.** `deriveSections` must not treat its output as ground truth, which is precisely why the spec insists the section list is *visible and editable before anything is created* (Task 3's preview-only route, §12). That requirement is now load-bearing rather than a nicety.
2. **The nesting question is a backend question.** The Rust binding's `ConvertOptions` has **no heading-hierarchy inference** — verified against its typings; there is no `do_pdf_heading_hierarchy` equivalent, while docling-serve exposes one that infers levels from bookmarks, outline numbering *and* font style. Flat output is therefore expected from the local service and is a reason to keep docling-serve as a second backend rather than a fallback.
3. **The ceiling may be doing nothing.** 20 pages produced 46 107 characters across 99 chunks, mean 362 and max 3 443. Nothing came close to 40 000, so at chunk granularity the ceiling only ever fires on documents with no detectable structure at all. It stays as a safety valve; §11's full-book number decides whether it should be tighter.

## 7. Configuration

Two settings, declared the way this package already declares its five (`powerhouse.manifest.json` → `config[]`), never in `.env`:

| Name | Required | Meaning |
|---|---|---|
| `CONVERT_SERVICE_URL` | no | Base URL of the conversion service, e.g. `http://127.0.0.1:5007`. Unset is a supported state: `GET convert/health` reports `configured: false` and `POST convert` answers `503 CONVERT_NOT_CONFIGURED`. |
| `CONVERT_SERVICE_API_KEY` | no | Sent as `X-Api-Key` when the backend requires one (the `docling-serve` container does). |

Model storage (`DOCLING_RS_HOME`) is a property of the *service*, not the vault, and stays out of this package's config.

**The upload cap is 30 MB**, declared per-route (`maxBodyBytes`) rather than as a config variable, so it does not depend on deployment. It is not the house default: `subgraphs/http`'s routes take 2 MB, and the measured documents are a 47 KB CV, a 20 KB purchase order, and a **17.4 MB book** — so the 2 MB default would `413` the file this feature exists for. 30 MB clears the measured worst case with room to spare while staying a bound an operator can hold in their head; the body is buffered per request in the Switchboard, which is why it is not larger. The service's own `CONVERT_MAX_BYTES` (256 MB) deliberately stays higher: it is the last line, not the policy. `MAX_UPLOAD_BYTES` is the single constant, and the browser upload path has no smaller limit of its own.

### 7.1 Distribution and first run

**What the published package contains today:** `package.json` has `files: ["/dist"]` — `dist/` only — and **no `postinstall`**. So `scripts/docling-serve/` would not ship unless it is added, and nothing runs a download at install time today. Both of those are the right starting point; the decision is how to keep them.

**The models are deployment state, not package payload.** ~700 MB of ONNX weights plus pdfium plus a 68 MB native binding. Putting them in the tarball would grow the registry, every `bun install`, and the deployment image, and would ship a snapshot of third-party model files that the binding already downloads from its own releases. The package should ship **the service** and the *means* to fetch models — never the models. Shipping the service does follow an existing pattern: `scripts/copy-runtime-assets.mjs` already copies runtime assets the build does not know about into `dist/` from both `build` and `prepack`, and its header records why that matters — when the copying silently stopped, *"server-side embedding broke and the system fell back to computing embeddings in the browser."* A service shipped the same way gets the same protection.

**Nothing fetches 700 MB at install or at boot.** Two distinct costs have to stay off the startup path, and the second is the one that bites:

| Cost | Measured | Why it must not be at boot |
|---|---|---|
| The download | 700 MB `.models` + 7.5 MB `.pdfium` | Boot becomes network-bound; a failed fetch leaves a half-working deployment; air-gapped installs break |
| Resident memory once models are loaded | **~1.36 GB (Node)** after a PDF; **~2.78 GB (Bun)** on the same workload | It competes with the Switchboard's own Prisma/migration/model boot on the same box |

Three places the fetch can happen, best first. **For this deployment the answer is (2)** — the vault is deployed without Docker, so nothing is baked at image build and there is no entrypoint to hook; a one-time documented command into `DOCLING_RS_HOME` is the path, with (3) available so a running vault can offer the fetch to whoever is waiting. (1) is recorded for completeness and for anyone who *does* deploy in containers.

1. **Baked at image build** (Docker deployments). A `convert` stage runs `download_dependencies.sh --no-asr` at build time; the runtime then never downloads, startup is instant, and the models are versioned with the image. This is what `docling-rs-serve` does ("models pre-installed"), and it is the only option with no first-run cliff.
2. **A one-time prefetch into a volume** (VM / bare metal). A documented command — `node scripts/docling-serve/fetch-models.mjs --no-asr`, or a `ph`-adjacent one — run once after install, writing to `DOCLING_RS_HOME` on a mounted volume. This is exactly the shape the `powerhouse-knowledge` plugin uses for its 249 methodology claims: *"Unpack them once: `node scripts/methodology.mjs`"*, a deliberate step rather than a postinstall.
3. **On demand, from the running service, behind an explicit action.** The service starts with no models loaded, reports `ready: false, missing: [...]` from `/convert/health`, and the Intake view offers *"PDF support needs 700 MB — fetch now?"*. Progress is streamed; nothing is surprised. This is the only option that is also *observable* to the person waiting.

**The degradation is already free, which is what makes option 3 sensible.** Declarative formats need **no models at all** — measured: HTML → markdown with an aligned table in **1 ms** — so a fresh install is useful for `md`, `html`, `docx`, `epub`, `csv`, `xlsx`, `pptx` and the rest immediately, and only `pdf` and `image` need the download. `GET convert/health` already distinguishes "no models" from "broken", so the UI can say *what* is unavailable instead of failing.

**One container caveat.** The repo's `Dockerfile` is `node:24-alpine` in every stage, and the Rust binding publishes **`linux-x64-gnu` / `arm64-gnu` / `win32-msvc` — no musl**. So a conversion container cannot follow the existing alpine pattern: it needs a glibc base (`node:24-slim` or equivalent), or the prebuilt `docling-rs-serve` image. Keeping it as its **own** container is the recommendation anyway — it isolates both the 700 MB and the ~1.4 GB of resident memory from the Switchboard image.

## 8. Error handling

| Condition | Answer | Why this code |
|---|---|---|
| No `CONVERT_SERVICE_URL` configured | `503 CONVERT_NOT_CONFIGURED` | The capability is absent, not the caller's fault. Mirrors how the http subgraph treats an unroutable scope. |
| Service unreachable, or non-2xx | `502 CONVERT_UNAVAILABLE` | Upstream failure, and — like the existing `502 CREATE_FAILED` — the caller must know nothing was written. Here that is trivially true: this route never writes. |
| Body over the cap | `413` | Set by `maxBodyBytes` on the route, before the handler runs. |
| Missing/empty filename or body | `400 FILENAME_REQUIRED` / `400 EMPTY_BODY` | Both fire before any service call. |
| docling failed on the bytes | `500 CONVERT_FAILED`, message passed through | A scan without models is the common case: the service reports `missing: ["pdfium","layout_heron.onnx"]` and the route surfaces it, so the UI can say *why* rather than "failed". |

The route **never creates a document**, so no rollback logic is needed — and that is a deliberate property to preserve when the create half is added: keep the write in a separate route so its rollback stays the concern of the code that does the creating.

## 9. Constraints honoured

Copied from this repo's own rules, because they are constraints and not preferences:

- Relative imports carry **`.js`** (`"module": "nodenext"`); no `@/*` alias — the `subgraphs/*` alias in `tsconfig.json` is the only one used, and only from outside the subgraph.
- `bun run tsc` must pass. **`tsconfig.json` includes `**/*`**, so every file added here is type-checked, including `scripts/docling-serve/server.ts`.
- `bun run lint:fix` (oxlint, type-aware) and `bun run format` (oxfmt).
- **Tests are colocated** `*.test.ts` beside the module, as `subgraphs/http/lib/` does, with `tests/helpers/` for shared fakes. `bun run test` (vitest) must pass.
- **Coverage:** `vitest.config.ts` includes `subgraphs/http/lib/**` in the 95% threshold set. `subgraphs/convert/lib/**` is added to that include list in the same change, so the new code meets the same floor as its sibling rather than quietly opting out.
- The subgraph's HTTP scope is namespaced and cannot mount outside `/api/@powerhousedao/knowledge-note/` — no route here tries to.

## 10. Testing

| Layer | Test | Style |
|---|---|---|
| `deriveSections()` | cut level chosen, front matter, ceiling subdivision, no-heading fallback | table-driven unit, colocated |
| `service.ts` client | request shape (URL, headers, bytes), 2xx mapping, non-2xx → `HttpError`, timeout | injected `fetchImpl`, no network |
| `routes.ts` | auth/param validation, `FILENAME_REQUIRED`, `EMPTY_BODY`, `CONVERT_NOT_CONFIGURED`, section payload shape | `createFakeHttpScope()` from `tests/helpers/` |
| `index.ts` | `name === "convert"`, both routes registered with the right options | registration assertions |
| the service itself | `curl` smoke test, documented in its README | manual, with expected output |
| the PDF path | the measurement in §11 | manual, recorded numbers |

No test calls a live conversion service; the client is tested against an injected fetch, so the suite stays hermetic.

## 11. What is already verified

Measured on this host before writing this spec — so the plan builds on facts, not expectations:

- `bun add docling.rs` → 1.55.0 + `docling.rs-linux-x64-gnu`, **105 MB, 2.05 s**; the package states it works under Bun.
- **HTML → markdown, zero models, 1 ms**: heading hierarchy preserved, table rendered as an aligned markdown table.
- `supportedFormats()` → **29 formats**, including `epub`, `csv`, `xlsx`, `pptx`, `latex`, and `audio`/`video`/`vtt`.
- `checkDependencies()` → model home `~/.cache/docling.rs`, `ready: false`, `missing: ["pdfium","layout_heron.onnx"]`: declarative formats need nothing; PDF and images need the download.
- `chunkFileAsync()` → chunks with `headings` and `docItems`, **without** the chunk tokenizer present.
- Model download completed with `--no-asr`: `.pdfium/lib/libpdfium.so` plus `.models/` (layout heron fp32 **and** int8, OCR recognition + detector + dictionaries, TableFormer `encoder_fp16`/`decoder_int8`/`decoder_kv`/`bbox`, the chunk tokenizer, and the picture classifier).
- **The service works end to end.** `GET /health` → `ready: true`, `missing: []`, 29 formats, with the model home resolved from CWD.
- **A real PDF, measured.** A 1-page purchase-order PDF → 2 209 chars of markdown with headings (`## Brenner Automotive GmbH`) and the line-items table intact as a markdown table, **14 chunks** each carrying its heading path, `convertMs: 1 655`, `chunkMs: 1 009`, **total 2.66 s** including the HTTP round trip. That is the PDF path verified for fidelity of headings and tables, on one document.

**Verified since, through the committed service** (Node, `docling.rs`): the full 238-page book end to end — **HTTP 200 in 5 m 33 s**, 398 051 characters of markdown, **972 chunks** — and section counts at book scale (§6.1: 290 sections from the cut rule alone, 107 with the floor). **Still not verified:** the deployed behaviour of any of the three service backends, and the `FormatError` retry path (§5.1).

### The book that would not load, and the workaround

The 17.4 MB, 238-page O'Reilly PDF failed immediately and completely:

```json
{"error":"parse error: pdf: pdfium error: PdfiumLibraryInternalError(FormatError)","code":"UNSUPPORTED_FORMAT"}
```

It is **not** encrypted (`qpdf --show-encryption` → "File is not encrypted"), not malformed to other readers (`pdfinfo` reads it: 238 pages, 432×648 pt, PDF 1.7, Ghostscript 9.26 producer), and it declares an outline. pdfium — which the Rust binding depends on for every PDF — simply refuses it. This is a class of failure the UI must surface honestly, and it is the argument for the `415 UNSUPPORTED_FORMAT` code being distinct from `500 CONVERT_FAILED`.

**A rewrite fixes it.** `gs -sDEVICE=pdfwrite` over the first 20 pages produced a file that converts cleanly, and `qpdf --linearize --object-streams=disable` produced a lossless-ish 238-page rewrite (17.4 MB) that converts in full. So the service needs a **normalisation step for a PDF that pdfium rejects**, with the honest caveat that running every PDF through a rewrite "just in case" costs time for no benefit — it should be a *retry on FormatError*, not the default path:

```
convert → FormatError → rewrite (qpdf, then gs) once → convert again → still failing ⇒ 415
```

**But the failure itself has since gone unreproducible, so that path is defensive rather than demonstrated** — the same original file (md5-verified, mtime 2026-09-08) now converts under both Node and Bun, and every real-book run through the service returns `normalised: null`. The full account, and what would be needed to close it, is §5.1.

### Measured results

| Document | Bytes in | Out | Timing |
|---|---|---|---|
| `main_example.pdf` — 2 pages, two-column CV | 47 KB | 5 552 chars, **54 chunks** | convert 1.95 s + chunk 1.64 s = **3.6 s** |
| PO PDF — 1 page, dense table | 20 KB | 2 209 chars, 14 chunks | convert 1.66 s + chunk 1.01 s = **2.7 s** |
| Book pages 1–20 (after a gs rewrite) | 2.7 MB | 46 107 chars, **99 chunks**; chunk chars min 4 / mean 362 / max 3 443 | convert 11.1 s + chunk 11.9 s = **22.9 s** |
| Book, all 238 pages (after a qpdf rewrite) | 17.4 MB | **367 840 chars, 998 chunks, 289 heading paths**; chunk chars min 1 / mean 332 / max 3 443 | convert 112.6 s + chunk 100.5 s = **3 m 33 s** |
| Book, all 238 pages — **through the committed service**, original file | 17.4 MB | 398 051 chars, **972 chunks**, `normalised: null` | convert 160.6 s + chunk 172.7 s = **5 m 33 s** |

**The extrapolation was wrong in an instructive direction.** Paging the 20-page sample (~2.3 s/page) across 238 pages predicted ~9 minutes; the real figure is **3 m 33 s, about 0.9 s per page**. The difference is content, not measurement: those twenty pages are front matter — praise, contents, dense multi-column layout, images — while the body is single-column prose. Per-page cost therefore varies by roughly 2.5× with page complexity, so any progress estimate the UI shows must be derived from *pages converted so far on this document*, never from a constant.

Two further readings from the same run:

- **The ceiling never fires.** The largest single chunk in the book is 3 443 characters, against a `SECTION_CHAR_CEILING` of 40 000. It stays as a safety valve for documents with no detectable structure; §13.2 now has the number it needs to decide whether it should exist at all.
- **Chapter-sized is the right *size*, even though detection is unreliable.** 367 840 characters across a book with roughly fifteen chapters averages ~24 500 characters per chapter — comfortably under the ceiling, and about the size a human would want to open and read. That validates the granularity in §6 while leaving its *detection* as the open problem: 289 heading paths is not fifteen chapters.

The run used the module-level functions rather than a warm `Pipeline`, so a service holding one (§5.1) should beat these numbers on the second and later documents.

Heading fidelity, from the samples: tables survive as markdown tables (`main_example.pdf`'s Education block, the PO's line items) — but see §6.2 for what the *heading paths* did on both, which is the more consequential finding.

### Head-to-head: the Rust binding vs `docling-serve`

The comparison §13.1 asked for, run on the same file — book pages 1–20 — with `docling-serve`'s level inference switched on (`do_pdf_heading_hierarchy=true`). Both sides read as docling-core JSON, so the metric is identical: the `section_header` level histogram.

| | Rust binding (`docling.rs`) | `docling-serve` (Python) |
|---|---|---|
| Output | 46 107 chars, 99 chunks | 46 291 chars, 151 texts |
| **`section_header` levels** | **`{"1": 22}`** — every heading flat | **`{"1": 8, "2": 2, "3": 1, "4": 1, "6": 15}`** |
| Time, same 20 pages | **22.9 s** (wall, markdown + chunks) | 40.9 s wall — 39.5 s of it `processing_time` |
| Footprint | ~700 MB models + 105 MB binding | **15.1 GB image** |
| Response shape | `{ markdown, chunks }` | `{ document: { md_content, json_content, … }, status, timings }` |

**Level inference is real, and it is not clean.** `docling-serve` genuinely nests: `[ Preface ]` at L1 with `Why I Wrote This Book` at L4 beneath it is *correct*, and `[ contents ]` and `PART III …` land sensibly at L1. But **15 of its 27 headers sit at level 6** — a grab bag containing cover blurbs (`LAURA CUOZZO GUARNOTTA, USER EXPERIENCE RESEARCH LEAD…`), the author's name, the book title, **and** real sections (`Revision History for the First Edition:`). The Rust binding's flat list contains the same furniture; it simply calls it all level 1.

**Verdict: not material enough to displace the default.** Neither engine turns a 238-page book into ~15 chapters automatically — one flattens, the other nests but mislabels a third of the headings. What the comparison actually settles is a *design* conclusion, not a backend one:

> **The section list must be user-editable regardless of which engine runs.** The level inference improves the starting point; it does not make the starting point trustworthy. §6.2's finding stands, and §12's "visible and editable before anything is created" is the requirement that carries the design.

So the decision in §3 holds: the Rust service stays the default (faster here, 20× smaller, stateless, Node-compatible), and `docling-serve` stays available as a ~40-line adapter for anyone who wants its other capabilities — OCR presets, ASR, enrichment — or its level inference *in a future where the sections UI is built to exploit it*.

## 12. Downstream: the Intake view (not this plan)

Recorded here so the two designs do not drift. The app's route in today is `+New → Add Source` → `CreateDocumentDialog` (name only) → `createDocumentRemote` → an empty `bai/source` → `IngestForm` (paste). The Intake view replaces the last two steps: drop → convert → **review sections** → publish.

Three concepts were drafted under the six-minds audit; the selected blend is **A's asset queue as the shell, C's extraction-and-segments review when an asset is expanded, B's field vocabulary for the metadata step.** They are unapproved and untouched. The one hard requirement this spec places on them: **the section list must be visible and editable before anything is created**, which is why `POST convert` writes nothing.

### 12.1 The original file is kept, not consumed

Conversion is lossy in exactly the way that matters: a `bai/source` today keeps the *derived* markdown and loses the artefact. The vault's own doctrine says the source is the unrecoverable anchor — the thing that cannot be reconstructed once it is gone — so the original bytes belong on the source document, not on a filesystem somewhere.

The reactor's attachment store makes that practical, and the mechanism is **proven in a sibling project in this workspace**: `umh-production-ledger/editors/production-ledger-editor` uploads a source PDF and previews it. Porting its `lib/attachments.ts`, `lib/useFileUpload.ts` and `lib/useAttachmentViewer.ts` is the path of least invention.

**What `bai/source` gains** (the model change itself is the plan's Task 8, dispatched over the reactor MCP): `originalFile: AttachmentRef`, plus `originalFileName`, `originalMimeType`, `originalSizeBytes`, and `convertedBy` recording what produced `content` from it. `scalar AttachmentRef` is already declared in the schema — no scalar work.

**Three properties of the store that shape the UI:**

1. **It is content-addressed, so the ref is known before the bytes are uploaded.** The upload is deliberately `preprocess(file)` → dispatch the action with the yielded ref → `upload(result)`. The source can therefore exist and be opened while a 30 MB upload is still streaming. Dispatching *after* the upload resolves is the mistake this ordering exists to prevent.
2. **It is drive-independent, at `<switchboard-origin>/attachments/*`.** Nothing about it is per-drive or per-document, which is why the ref must be stored on the document that owns it and why wiring a ref to the wrong source is easy.
3. **Connect only provides a service when a default drive is configured.** For a document in a local, browser-only drive, reading an attachment otherwise fails with `AttachmentClient not available`; the editor installs its own service at mount, pointed at the paired Switchboard, with a short-lived Renown bearer token.

**Render-or-download is a rule, not a display preference.** docling accepts 29 formats, so a source may hold anything. The rule: preview inline when the browser can genuinely render the type — `application/pdf`, `text/plain`, `text/markdown`, `image/*`, `audio/*`, `video/*` — and **download everything else**, with `text/html` and `image/svg+xml` deliberately in the download bucket because rendering untrusted markup injects it into the editor's origin. A `.docx`, `.xlsx`, `.epub` or `.csv` gets a file card with name, size, type and a Download button: honest about what the browser can do, rather than an empty preview pane.

**A failed fetch must not look like an absent attachment** — those are different states with different remedies, and the panel needs both.

## 13. Open questions

1. ~~Does the PDF path give heading structure with `layout_heron.onnx` alone, or does structure need TableFormer too?~~ **Answered by §6.2:** the Rust binding returns headings but no *hierarchy* — 97 of 99 chunks at depth 1 on a 20-page sample, 996 of 998 across a 238-page book — and its `ConvertOptions` exposes no level inference at all. So depth is a docling-serve capability (`do_pdf_heading_hierarchy`), not a local-service one.
   **Closed — the default stays the Rust service** (§3). The head-to-head in §11 shows level inference is real but not clean: `docling-serve` nested `Why I Wrote This Book` under `[ Preface ]` correctly, yet put **15 of its 27 headers at level 6** — cover blurbs and the author's name mixed in with real sections. Neither engine derives ~15 chapters from a 238-page book automatically, so the conclusion is a *design* one: **the section list is user-editable whichever engine runs.** `docling-serve` remains a ~40-line adapter for its other capabilities, or for a future sections UI built to exploit its levels.
2. 40 000 characters per source — right ceiling, or should it be expressed in pages for PDFs?
3. Should `POST convert` accept a URL as well as bytes (`http_sources` is a real docling-serve feature), and if so, whose SSRF policy applies?
4. Where do models live in a deployment — a volume on the service container, or baked into the image?
5. Does the section plan belong in the response only, or should it be recorded on the source as provenance (`method`/`tool` already anticipate this)?
