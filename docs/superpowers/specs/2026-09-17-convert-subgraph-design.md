# Convert subgraph — design

**Status:** design proposal, awaiting green light. Nothing in the React app or the subgraph tree has been changed.
**Scope of this spec:** the *conversion capability* — an out-of-process document-conversion service plus a `subgraphs/convert` that proxies it and turns its output into a source-shaped **plan**. It creates no documents and ships no UI.
**Downstream (separate plan, not covered here):** the Intake view in `editors/knowledge-vault/`. Its three concepts are drafted but not approved; they are recorded in §12 so this spec and that design stay consistent.

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

**Backend service, deliberately deferred:** three interchangeable implementations sit behind the same route — a local `bun` service over `docling.rs` (§5.1), the `docling-rs-serve` container, or the `docling-serve` container. This spec builds the *first* and keeps the other two as configuration, because the proxy route is what the rest of the work depends on.

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
- **Convert once, not twice — and why the measurement says that is *not* available.** The binding's typing shows the intent: *"a document converted once … chunks without re-converting"*, via `chunkDocument(jsonContent)`. The natural implementation therefore looks wasteful — `convertFileAsync(to:"markdown")` for the text plus `chunkFileAsync(path)` for the chunks, where the latter converts again. It is wasteful, but it is also **unavoidable**, and the measurements say so: chunk text is *not* markdown-quality for tables (a PDF invoice's line items come back as `FRAME-WELD-A, QUANTITY = 480 pcs` triplets, a CV's education table as `🟤, 1 = Copenhagen Business Academy`), so the markdown export is needed for the source's own content, and the binding exposes no json→markdown export to derive it from a single conversion. Keep both calls; do not "optimise" them into one.
- **The real efficiency lever is the warm pipeline.** The package exports a `Pipeline` class that *"keeps the ONNX models loaded across calls"*. A long-lived service should hold one, rather than calling the module-level functions per request and paying model load each time. Measured on the second and later requests, this is the difference between per-request constant overhead and actual conversion cost.
- `ConvertOptions` exposes a **PDF page window** (`pages: "A-B"`, or `"N"`, 1-based inclusive) — the only way to convert *part* of a book without rewriting the file, and therefore the tool for a fast fidelity check on a 238-page document.
- **A PDF that pdfium refuses needs one normalising retry.** Measured: a valid, unencrypted, 238-page O'Reilly PDF failed at load with `pdfium error: PdfiumLibraryInternalError(FormatError)`, and converting a `gs -sDEVICE=pdfwrite` rewrite of the same pages succeeded. The service should treat this as a retry path, not a default: `convert → FormatError → rewrite with qpdf, then gs → convert once more → still failing ⇒ 415 UNSUPPORTED_FORMAT`. Rewriting every PDF up front would cost time for no benefit on the files that already work.

### 5.2 The subgraph route

```
GET  /api/@powerhousedao/knowledge-note/convert/health      auth: renown
POST /api/@powerhousedao/knowledge-note/convert             auth: renown
     ?filename=<url-encoded>&markdown=1
     body: raw octets
  → 200 {
      filename, format, chars, chunks: <count>,
      sections: [{ title, headingPath, text, charCount, chunks: number[] }],
      plan: { cutLevel, splitSections, ceiling },
      markdown?: string,            // only with &markdown=1
      backend, timings
    }
  → 400 FILENAME_REQUIRED | EMPTY_BODY
  → 413 PAYLOAD_TOO_LARGE
  → 502 CONVERT_UNAVAILABLE   (service unreachable / non-2xx)
  → 500 CONVERT_FAILED
```

- `body: "raw"` with `maxBodyBytes`, because the octets are needed byte-for-byte (`ctx.rawBody`). `"parsed"` is for JSON, which is what the existing routes use; a file is not JSON.
- The markdown is omitted by default: the sections carry the same text, and a book-sized document would otherwise round-trip through the app twice.
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

1. Cut at **the shallowest heading depth that actually divides the document.** Try depth 1: if every chunk's `headings` is `["The Vault"]`, that yields one section, so try depth 2, and so on to depth 3. First depth producing ≥ 2 sections wins; if none does, the document is one section. (`cutLevel` records which.)
2. Chunks before the first heading become a leading section titled `<document name> — front matter`.
3. A section over the **ceiling (40 000 chars)** is subdivided at the next depth down its own heading path, and failing that at a paragraph boundary. `splitSections` counts them. The ceiling is a safety valve for the re-serialisation cost above, not a target.
4. No headings at all (`cutLevel: 0`): one section, ceiling-split at paragraph boundaries, titled `<document name> · part N`.

The ceiling is a named constant (`SECTION_CHAR_CEILING`) so it can be tuned once the PDF measurement in §11 produces real character counts.

### 6.1 What the measurements did to this rule

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
| `CONVERT_SERVICE_URL` | yes | Base URL of the conversion service, e.g. `http://127.0.0.1:5007`. Unset ⇒ `POST convert` answers `503 CONVERT_NOT_CONFIGURED`. |
| `CONVERT_SERVICE_API_KEY` | no | Sent as `X-Api-Key` when the backend requires one (the `docling-serve` container does). |

Model storage (`DOCLING_RS_HOME`) is a property of the *service*, not the vault, and stays out of this package's config.

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

**Not yet verified:** the full 238-page book end to end (converting when this was written), section counts at book scale, and the deployed behaviour of any of the three service backends.

### The book that would not load, and the workaround

The 17.4 MB, 238-page O'Reilly PDF failed immediately and completely:

```json
{"error":"parse error: pdf: pdfium error: PdfiumLibraryInternalError(FormatError)","code":"UNSUPPORTED_FORMAT"}
```

It is **not** encrypted (`qpdf --show-encryption` → "File is not encrypted"), not malformed to other readers (`pdfinfo` reads it: 238 pages, 432×648 pt, PDF 1.7, Ghostscript 9.26 producer), and it declares an outline. pdfium — which the Rust binding depends on for every PDF — simply refuses it. This is a class of failure the UI must surface honestly, and it is the argument for the `415 UNSUPPORTED_FORMAT` code being distinct from `500 CONVERT_FAILED`.

**A rewrite fixes it.** `gs -sDEVICE=pdfwrite` over the first 20 pages produced a file that converts cleanly, and `qpdf --linearize --object-streams=disable` produced a lossless-ish 238-page rewrite (17.4 MB) whose conversion is the full-book test now running. So the service needs a **normalisation step for a PDF that pdfium rejects**, with the honest caveat that running every PDF through a rewrite "just in case" costs time for no benefit — it should be a *retry on FormatError*, not the default path:

```
convert → FormatError → rewrite (qpdf, then gs) once → convert again → still failing ⇒ 415
```

### Measured results

| Document | Bytes in | Out | Timing |
|---|---|---|---|
| `main_example.pdf` — 2 pages, two-column CV | 47 KB | 5 552 chars, **54 chunks** | convert 1.95 s + chunk 1.64 s = **3.6 s** |
| PO PDF — 1 page, dense table | 20 KB | 2 209 chars, 14 chunks | convert 1.66 s + chunk 1.01 s = **2.7 s** |
| Book pages 1–20 (after a gs rewrite) | 2.7 MB | 46 107 chars, **99 chunks**; chunk chars min 4 / mean 362 / max 3 443 | convert 11.1 s + chunk 11.9 s = **22.9 s** |
| Book, all 238 pages (after a qpdf rewrite) | 17.4 MB | **367 840 chars, 998 chunks, 289 heading paths**; chunk chars min 1 / mean 332 / max 3 443 | convert 112.6 s + chunk 100.5 s = **3 m 33 s** |

**The extrapolation was wrong in an instructive direction.** Paging the 20-page sample (~2.3 s/page) across 238 pages predicted ~9 minutes; the real figure is **3 m 33 s, about 0.9 s per page**. The difference is content, not measurement: those twenty pages are front matter — praise, contents, dense multi-column layout, images — while the body is single-column prose. Per-page cost therefore varies by roughly 2.5× with page complexity, so any progress estimate the UI shows must be derived from *pages converted so far on this document*, never from a constant.

Two further readings from the same run:

- **The ceiling never fires.** The largest single chunk in the book is 3 443 characters, against a `SECTION_CHAR_CEILING` of 40 000. It stays as a safety valve for documents with no detectable structure; §13.2 now has the number it needs to decide whether it should exist at all.
- **Chapter-sized is the right *size*, even though detection is unreliable.** 367 840 characters across a book with roughly fifteen chapters averages ~24 500 characters per chapter — comfortably under the ceiling, and about the size a human would want to open and read. That validates the granularity in §6 while leaving its *detection* as the open problem: 289 heading paths is not fifteen chapters.

The run used the module-level functions rather than a warm `Pipeline`, so a service holding one (§5.1) should beat these numbers on the second and later documents.

Heading fidelity, from the samples: tables survive as markdown tables (`main_example.pdf`'s Education block, the PO's line items) — but see §6.1 for what the *heading paths* did on both, which is the more consequential finding.

## 12. Downstream: the Intake view (not this plan)

Recorded here so the two designs do not drift. The app's route in today is `+New → Add Source` → `CreateDocumentDialog` (name only) → `createDocumentRemote` → an empty `bai/source` → `IngestForm` (paste). The Intake view replaces the last two steps: drop → convert → **review sections** → publish.

Three concepts were drafted under the six-minds audit; the selected blend is **A's asset queue as the shell, C's extraction-and-segments review when an asset is expanded, B's field vocabulary for the metadata step.** They are unapproved and untouched. The one hard requirement this spec places on them: **the section list must be visible and editable before anything is created**, which is why `POST convert` writes nothing.

## 13. Open questions

1. ~~Does the PDF path give heading structure with `layout_heron.onnx` alone, or does structure need TableFormer too?~~ **Answered by §6.1:** the Rust binding returns headings but no *hierarchy* — 97 of 99 chunks at depth 1 — and its `ConvertOptions` exposes no level inference at all. Structure at the chapter level is therefore a docling-serve capability (`do_pdf_heading_hierarchy`), not a local-service one. The remaining question is narrower: **is a flat heading list good enough for the Intake view, given the sections are user-editable before anything is created?** If yes, the local service stands alone; if not, docling-serve becomes the primary backend rather than an alternative.
2. 40 000 characters per source — right ceiling, or should it be expressed in pages for PDFs?
3. Should `POST convert` accept a URL as well as bytes (`http_sources` is a real docling-serve feature), and if so, whose SSRF policy applies?
4. Where do models live in a deployment — a volume on the service container, or baked into the image?
5. Does the section plan belong in the response only, or should it be recorded on the source as provenance (`method`/`tool` already anticipate this)?
