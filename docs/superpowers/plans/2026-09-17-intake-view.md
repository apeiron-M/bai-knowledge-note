# Intake View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user bring a document into the vault — pick files, convert them through the convert subgraph, review what each file would become, approve, and get correctly-shaped `bai/source` documents in a folder per document, each queued for extraction and carrying its original file.

**Architecture:** A new view inside the existing drive app (`editors/knowledge-vault/`), not a new editor: it is not a document and has no document model. The flow logic lives in pure, tested `lib/` modules (the repo's convention — 52 test files under `editors/`, all `lib/` or `hooks/`); the components stay thin. Publishing is two authenticated REST calls per file against routes that already exist, because `POST sources` already resolves `/sources`, enforces `parentFolder`-within-`/sources`, verifies containment, rolls back on failure, and queues by default.

**Tech Stack:** React 19 + TypeScript, Tailwind utility classes for layout with the vault's `--bai-*` CSS variables for all colour, vitest for `lib/`, the Switchboard REST API (`<origin>/api/@powerhousedao/knowledge-note/*`), `@powerhousedao/reactor-attachments` for the original file.

**Spec:** `docs/superpowers/specs/2026-09-17-intake-view-design.md`

> **Amended 2026-09-17, before execution**, after a review of the plan against the code and against the convert route as it now is (contiguous-run grouping, `mergedFrom`, `markdownRange`, `rejoinedSections`, `?minSectionChars`). Seven gaps closed, one default changed:
>
> 1. **Sources are built from the markdown, not from chunk text.** Chunk text flattens tables (measured: a CV's education table came back as `🟤, 1 = … , 2 = …` triplets; the markdown holds the correct 3-column table). `convertFile` asks for `&markdown=1` and gives each section a `content` sliced by its `markdownRange`, falling back to `text` only when the range is null. `publishPlan` sends `content`. (Tasks 4, 6)
> 2. **The `Section` type carries `mergedFrom` and `markdownRange`**, and the review shows what a merged section contains. Fixtures carry `plan.rejoinedSections`. (Tasks 3, 6, 7, 8)
> 3. **Task 10 expects 117 sections** for the book, not 107 — the number under the current rule.
> 4. **Re-publishing is refused, not duplicated.** `POST sources` is _not_ idempotent on content (only the queue task is deduped per `documentRef`); a row remembers what it published and the button is disabled afterwards. (Tasks 3, 8)
> 5. **Furniture is unticked by default.** `isLikelyFurniture(title)` — bracketed titles, praise, contents, index, copyright, colophon, revision history, "how to contact" — leaves those sections unticked; the user can re-tick. Measured on the book: the first two sections at the default floor are `Praise for …` (3.7k chars) and `[ contents ]` (13.7k). (Task 3, spec §13.4)
> 6. **`VaultApi.get` is defined in Task 2**, where it belongs, not forward-referenced from Task 8.
> 7. **Empty-vault detection is verified against what `fileNodes` holds** before it decides the default view: the drive app scaffolds twelve folders on first open. (Task 8 step 6)
>
> **Added after the design gate (2026-09-17):** the review's section rows **open to a rendered preview of the exact content that will be written** (`section.content` — the markdown slice, tables intact), because the tick was being decided on a title alone; real slices showed a section titled _Wayfinding_ opening with _The Six Minds of Experience_, and _Praise for …_ being the cover blurb. `SectionReview` renders the preview with the existing `markdown-preview.tsx`, collapsed to ~220 px with "Show all"; the content is already in memory from Task 6, so the preview costs no request. Keyboard: ↑/↓ move, space ticks, → opens. The preview footer also offers **"⤢ Full screen"**: a reader overlay (the app's modal pattern — `fixed inset-0 z-50`, `bg-black/60` click-catcher, `--bai-surface` panel) showing the whole part with the tick in its header and ← / → to move to the previous/next part; Esc, ✕, "Back to review" or a click outside closes it and the review is exactly as it was, because an overlay never touches the view behind it. Add a `SectionReader.tsx` component for it. (Task 8 step 4)
>
> **Placement changed (2026-09-17):** **no new tab.** The intake is a panel inside the **Sources view** — "＋ Add sources" in its header opens the drop zone, the batch and the review pane sit above the folder list, and an empty vault's Sources view _is_ the landing. The **Sources tab badge** shows how many files need the user (ready for review, or failed), so a book can convert while the user is in Chat and the badge calls them back. Consequence: the batch state (`files`, the bytes map, the running flag) lives **above the view switch** — a `useIntakeBatch()` hook instantiated in `DriveExplorer` and passed down — never inside the Sources view component, or a tab switch would unmount an in-flight conversion. `ViewMode` gains nothing. (Task 8 steps 5–6, spec §4/§6)
>
> **The batch has an end (2026-09-17):** when no file is queued, converting, ready for review or failed — every file is in the vault or was removed — the panel collapses to a **completion card**: sources and folders created, the journey strip fully green, one row per folder (linking into Sources), and **Finish**. Finish calls the hook's `reset()` (clears files and bytes, closes the panel); the Sources view is the folder list again with the new folders chipped _new_, and the tab badge is gone. "＋ Add sources" starts a fresh batch. A failed file blocks completion until retried or removed — the panel never quietly drops a file. Mid-batch (some published, others converting) is _not_ the end: published rows stay green in _In the vault_ and the review pane says what happens next. The **badge** counts files that need the user — review-ready + failed — never the batch size. **"Show all" is dropped** from the inline preview: it is a fixed-height glimpse, and "⤢ Read the whole part" (the reader overlay) is the one way to read all of it. (Task 8 steps 4–6; `use-intake-batch.ts` gains `isComplete`, `reset()`)
>
> **Card feel + fixes from the live test (2026-09-17):** `IntakePanel` is wrapped in one distinct frame (`--bai-deep` ground, an accent-tinted hairline, `box-shadow: 0 0 0 4px var(--bai-accent-soft)`) so it reads as a card sitting above the plain folder-list cards below it, not as loose sections on the same background. The goal header and the list/review split are laid out with inline flex styles rather than `sm:`/`lg:` utility variants — **this app does not generate responsive Tailwind classes** (measured: only 3 pre-existing uses in the whole editor, and the intake's `sm:flex-row` / `lg:flex-row` etc. rendered as if absent, stacking a header meant to be a row and putting the review pane below the list instead of beside it). Every `w-[Npx]` / `max-h-[…]` / `z-[100]` arbitrary-value class is inline `style` for the same reason — untested against this build. The section-review chevron became a labelled **Preview / Hide** button with a chevron icon (was a bare 10px glyph, too small to see as a control). `SectionReader`/`ConfirmDialog` render through `createPortal(…, document.body)` — inside the review pane they sat in the Sources list's own stacking context and its filter bar painted over them. Scroll containers (`SectionReview`'s list, `SectionReader`'s body) carry the app's `scrollbar-thin` class, matching every other scrollable panel.
>
> **OCR routing (2026-09-18).** The intake no longer waits on an automatic 163-second OCR pass. The service decides how to read a PDF from the file and the machine (convert spec §5.1, "How a PDF gets read"): a text layer pdfium cannot read is taken from pdf.js in under a second (`textSource: "pdfjs"`; the review says headings/tables were unavailable); a real scan goes to Tesseract when `ocrmypdf` is detected, else to docling's OCR when cheap enough, else it is **offered** — the row reads "Its text can't be read as it is — OCR would take ~N" with a **Run OCR** button (`forceOcr` on the row → `?ocr=1`), counted in the badge as needing the user. `CONVERT_BUSY` from the service re-queues the row after 8 s instead of failing it. The landing's capability line comes from `/health.ocrEngine`. (`intake-model.ts`: `needsOcr`, `forceOcr`, `needsOcrDecision`; `use-intake-batch.ts`: `onRunOcr`; `FileRow`, `IntakePanel`, `SectionReview`, `IntakeLanding`.)
>
> **Attachment failure, root-caused (2026-09-18).** A published source (`003a6db3…`) came out with `originalFile: null` and an operation log of exactly `INGEST_SOURCE`, `SET_SOURCE_STATUS` — no `ATTACH_ORIGINAL_FILE` at all. `publishFile` hashes once per file _before_ creating anything, so a throw in `prepare()` skipped the whole attach block for every source of that file. The throw was `"AttachmentClient not available"`: `setAttachmentService()` does not write `window.ph.attachmentService`, it dispatches a `ph:setAttachmentService` DOM event that a separately registered handler turns into the value `useAttachmentService()` reads; `useAttachmentUpload()`'s `preprocess` closes over the client of _that_ render, and the intake's port — memoised once in `DriveExplorer` — captured it before the round-trip landed. Proven the other way round headlessly: `createRemoteAttachmentService` → `createAttachmentClient` → `preprocess(File)` → `upload` against the live Switchboard succeeds with a bearer (`status: available`) and fails `401` without one, so server, auth and client are sound. **Fix:** `lib/attachments.ts` resolves the service at call time (`getAttachmentService()`: Connect's, else one this module created and keeps a reference to) and builds the client with `createAttachmentClient` inside `prepare`/`upload` — no hook timing, no dependency on the event handler. Also passes a named `File` instead of a bare `Blob`, which the client would have recorded as `fileName: "attachment"`. **And the missing half of the reference pattern:** `SourceDocumentCard` has a no-document branch (upload button); `OriginalFilePanel` rendered `null` for `originalFile == null`, leaving a source that lost its attachment with no way to get one — it now offers **Attach original file**, dispatched straight onto the document from the source editor through the same port. (Task 9)
>
> **Cancel flow (2026-09-17, from the live test):** the panel header carries **Cancel** whenever a batch exists and is not complete. Confirmed in the app's modal (`ConfirmDialog`, through a portal): with nothing published it discards every file and closes the panel; with some published it keeps those (they are documents now) and discards the rest, so the summary card with Finish is what remains. A review-ready row also has **Remove**. `discardUnpublished()` in the model (tested), `cancel()` on the hook. **Overlays go through `createPortal` to `document.body`**: rendered inside the review pane, the Sources filter bar painted over the section reader (measured in the live test). (Task 8 steps 4–5)
>
> **Default changed:** `defaultSourceType` is **format-driven and never `BOOK_CHAPTER`** — `html`/`htm` ⇒ `WEB_PAGE`, `vtt`/audio/video ⇒ `TRANSCRIPT`, everything else ⇒ `ARTICLE`; per file, overridable. A section count is a shape, not a genre: a two-section CV is not a book.
>
> Not in this plan, recorded as follow-ups: the folding-floor dial in the review step (needs a pure `POST convert/sections` route or a re-conversion), and `original*` fields on `POST sources` to fold the per-source attach pass into the create.

## Global Constraints

- **The vault's vocabulary wins at the UI surface.** _source_, _folder_, _Queue for processing_, `INBOX`/`EXTRACTING`/`EXTRACTED`/`ARCHIVED`. Never "chunk", never "document upload" — a raw chunk is a _part_, and what the user approves becomes _sources_.
- **Colour comes only from the CSS variables**: `--bai-bg`, `--bai-deep`, `--bai-surface`, `--bai-hover`, `--bai-border`, `--bai-text`, `--bai-text-secondary`, `--bai-text-tertiary`, `--bai-text-muted`, `--bai-text-faint`, `--bai-accent`. Tailwind is for layout and size only.
- **Pseudo-classes live in a scoped `<style>` block** with stable class names, because inline styles cannot express `:hover`.
- **`bun`, never npm or yarn.** Commands: `bun run test <path>`, `bun run tsc`, `bun run lint`, `bun run test:coverage`.
- **The lint gate is errors, not warnings.** `oxlint --type-aware --type-check` exits 0 with warnings; a new _error_ is a failure. Never add a suppression comment to get past it.
- **The upload cap is 30 MB per file** (`MAX_UPLOAD_BYTES = 30 * 1024 * 1024`) and the service's own cap is 256 MB. The browser must refuse an over-size file _before_ the request.
- **The file picker's formats come from the server** (`GET …/convert/health` → `formats`), never a hard-coded list.
- **Never show a percentage that was not measured.** Tier 1 progress is per-file state and elapsed time.
- **Nothing is created until the user approves** — `POST convert` writes nothing, and publish is the only write.
- **No new dependencies.** Everything needed is already installed.
- **Commits:** the user reviews before anything is committed to their branch; make the commit step's message descriptive and leave the decision to them.

---

## File Structure

New, all under `editors/knowledge-vault/`:

| file                                    | responsibility                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/vault-api.ts`                      | One authenticated call helper for the vault REST routes. Knows the URL shape, the bearer header, and how a refusal maps to a typed error.                                                                                                                                                                                 |
| `lib/intake-model.ts`                   | The pure flow model: file rows, their state machine, section selection, size/format validation, derived counts. No React, no fetch.                                                                                                                                                                                       |
| `lib/intake-publish.ts`                 | Pure publishing rules: folder-name derivation, section titles with fallbacks, the publish plan for a file.                                                                                                                                                                                                                |
| `lib/intake-service.ts`                 | The impure orchestration: convert one file, publish one file. Takes the api and attachment client as arguments so tests can assert the _call sequence_.                                                                                                                                                                   |
| `lib/mime.ts`                           | `isBrowserRenderable` — preview-or-download.                                                                                                                                                                                                                                                                              |
| `hooks/use-intake-batch.ts`             | The batch state and its scheduler (files, bytes, single-flight conversion, publish), hoisted so it survives view switches. Exposes `needsUser` (review-ready + failed) for the badge, `isComplete` (every file in the vault or removed, none failed) for the completion card, `open`/`reset()` for the panel's lifecycle. |
| `components/intake/IntakePanel.tsx`     | The panel inside the Sources view: goal header + drop zone, grouped file rows with journey strips, the review pane beside them. Renders from the hook's state.                                                                                                                                                            |
| `components/intake/IntakeLanding.tsx`   | The empty-vault welcome, on `LandingStage`.                                                                                                                                                                                                                                                                               |
| `components/intake/UploadSurface.tsx`   | Picker + drop zone + per-file validation feedback.                                                                                                                                                                                                                                                                        |
| `components/intake/ConversionQueue.tsx` | Per-file progress rows (Tier 1).                                                                                                                                                                                                                                                                                          |
| `components/intake/SectionReview.tsx`   | The section list, tick/untick, per-file type and folder name.                                                                                                                                                                                                                                                             |
| `components/OriginalFilePanel.tsx`      | Render-or-download for an attached original; used by the review and the source editor.                                                                                                                                                                                                                                    |

Modified:

| file                               | change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/DriveExplorer.tsx`     | instantiates `useIntakeBatch()` once (state above the view switch); passes it to `SourceList`; the Sources `TABS` entry gets `badge: batch.needsUser` (files ready for review or failed); the empty-vault default view becomes `"sources"`. **No new `ViewMode`, no new tab.**                                                                                                                                                                                                                                                                                                                           |
| `components/SourceList.tsx`        | hosts the intake: "＋ Add sources" beside "Ingest Source" (renamed "Paste text"); renders `<IntakePanel>` above the folder list when the batch is non-empty or the user opened the drop zone; the empty state becomes `<IntakeLanding>`. **Folder and source rows become cards** (design gate, `final.html#finished`): folder — lifted `--bai-surface`, accent folder glyph, bold name with trailing `/`, count, status pill, _Open_; source — indented under its folder, grey page glyph, title, chars, status pill (`extracting` warn / `extracted` ok). Same card language as the completion summary. |
| `components/GettingStarted.tsx`    | The quick-start step gains "or bring a document in".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `editors/source-editor/editor.tsx` | Renders `<OriginalFilePanel>` for a source that has an original.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Tests live beside the module they test (`lib/*.test.ts`), as every other test in this editor does.

---

### Task 1: The design gate — three concept HTMLs

The house pattern for a new view, and it comes first: three self-contained concept HTMLs plus an index, so the shape is approved before any React changes.

**Files:**

- Create: `docs/design/intake/index.html`
- Create: `docs/design/intake/a-queue-as-shell.html`
- Create: `docs/design/intake/b-stepper.html`
- Create: `docs/design/intake/c-inbox-and-detail.html`
- Create: `docs/design/intake/README.md`

**Interfaces:**

- Consumes: nothing. Static HTML, the vault's real tokens copied in.
- Produces: the approved shape for Tasks 7–8. **Nothing in the React editor changes until this is accepted** — the header of every file says so.

- [ ] **Step 1: Copy the real tokens into each file**

Each concept file is self-contained (no build step, no external CSS) and opens with the same token block, so what is approved is what will be built:

```html
<style>
  :root {
    --bai-bg: #0b0d10;
    --bai-deep: #0f1216;
    --bai-surface: #14181d;
    --bai-hover: #1b2027;
    --bai-border: #262c34;
    --bai-text: #e8eaed;
    --bai-text-secondary: #b9bfc7;
    --bai-text-tertiary: #8b929c;
    --bai-text-muted: #6b7280;
    --bai-text-faint: #4b525c;
    --bai-accent: #7dd3fc;
  }
</style>
```

The values above are a starting point: **read the live values out of
`editors/shared/theme-context.tsx` and use those**, so the proposal cannot
disagree with the app.

- [ ] **Step 2: Concept A — the queue as the shell**

One table of assets, each row a file with its state (queued, converting,
converted, failed) and its own controls. Expanding a row reveals that file's
sections. This is the shell candidate: the batch is always visible, and
per-file work happens in place.

- [ ] **Step 3: Concept B — the stepper**

Choose → Convert → Review → Done, one stage at a time, with a progress rail.
Cleanest for a single document; weakest for a batch, because the other files
disappear while one is reviewed.

- [ ] **Step 4: Concept C — inbox and detail**

A narrow left list of converted files (like the chat's history menu) and a wide
detail pane showing the selected file's sections. Best use of width for
reviewing a book; the batch state lives in the narrow column.

- [ ] **Step 5: `index.html` — the comparison, and the recommendation**

Three side-by-side scaled-down frames, the anatomy of each (header, queue row,
section row, primary control), and one paragraph naming the recommendation and
why. The convert spec §12 already records the blend under consideration: **A's
asset queue as the shell, C's extraction-and-segments review when a file is
expanded, B's field vocabulary for the metadata step** — the index should say
whether the mocks still support that, and what changed.

- [ ] **Step 6: The README, and the header line in every file**

`README.md` states the stage, the open decisions, and how to view the files
(`file://` is enough). Every HTML carries, in the document itself:

```html
<!-- design proposal, awaiting green light. Nothing in the React editor has been changed. -->
```

- [ ] **Step 7: Show them, and stop**

Do not proceed to Task 2 in the same session unless the user says the shape is
approved. The point of the gate is that the shape is theirs.

---

### Task 2: `lib/vault-api.ts` — one authenticated call helper

**Files:**

- Create: `editors/knowledge-vault/lib/vault-api.ts`
- Test: `editors/knowledge-vault/lib/vault-api.test.ts`

**Interfaces:**

- Consumes: `resolveSwitchboardOrigin()` from `editors/shared/subgraph-endpoint.ts`; `authHeaders()` from `editors/shared/authed-fetch.ts`.
- Produces:
  - `type VaultApiError = { status: number; code: string; message: string }`
  - `class VaultApiFailure extends Error { readonly status: number; readonly code: string; }`
  - `createVaultApi(options?: { fetchImpl?: typeof fetch; origin?: string }): VaultApi`
  - `type VaultApi = { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createVaultApi, VaultApiFailure } from "./vault-api.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("createVaultApi", () => {
  it("posts to the package-namespaced path on the switchboard origin", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(ok({ id: "abc" }));
    }) as unknown as typeof fetch;

    const api = createVaultApi({ fetchImpl, origin: "http://localhost:4001" });
    const result = await api.post<{ id: string }>("/sources/folders", {
      drive: "vetra-a933d854",
      name: "Design for How People Think",
    });

    expect(result.id).toBe("abc");
    expect(calls[0].url).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/sources/folders",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      drive: "vetra-a933d854",
      name: "Design for How People Think",
    });
  });

  it("trailing slashes on the origin do not double up", async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string) => {
      seen.push(url);
      return Promise.resolve(ok({}));
    }) as unknown as typeof fetch;
    await createVaultApi({ fetchImpl, origin: "http://localhost:4001//" }).post(
      "/sources",
      {},
    );
    expect(seen[0]).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/sources",
    );
  });

  it("turns a refusal into a VaultApiFailure carrying the server's code", async () => {
    // The routes answer `{ error, code }` — routes/sources.ts throws
    // BAD_REQUEST / CREATE_FAILED / CONTAINMENT_FAILED, source-folders.ts
    // BAD_REQUEST. The UI shows the code when there is one, so the caller must
    // not have to parse a Response.
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: "name is one folder, not a path",
            code: "BAD_REQUEST",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )) as unknown as typeof fetch;

    const api = createVaultApi({ fetchImpl, origin: "http://localhost:4001" });
    await expect(api.post("/sources/folders", {})).rejects.toBeInstanceOf(
      VaultApiFailure,
    );
    await expect(api.post("/sources/folders", {})).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: expect.stringContaining("one folder, not a path"),
    });
  });

  it("survives a refusal that is not JSON", async () => {
    // A proxy or a crashed Switchboard answers HTML or nothing at all.
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("<html>502</html>", { status: 502 }),
      )) as unknown as typeof fetch;
    const api = createVaultApi({ fetchImpl, origin: "http://localhost:4001" });
    await expect(api.post("/sources", {})).rejects.toMatchObject({
      status: 502,
      code: "UNKNOWN",
    });
  });

  it("turns a network failure into a typed failure rather than a raw TypeError", async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("fetch failed"))) as unknown as typeof fetch;
    const api = createVaultApi({ fetchImpl, origin: "http://localhost:4001" });
    await expect(api.post("/sources", {})).rejects.toMatchObject({
      status: 0,
      code: "UNREACHABLE",
    });
  });

  it("sends a GET with the bearer and no body", async () => {
    // `GET convert/health` is how the picker learns its formats (Task 8).
    const calls: RequestInit[] = [];
    const fetchImpl = ((_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(ok({ configured: true, formats: ["pdf"] }));
    }) as unknown as typeof fetch;
    const api = createVaultApi({ fetchImpl, origin: "http://localhost:4001" });
    const health = await api.get<{ formats: string[] }>("/convert/health");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].body).toBeUndefined();
    expect(health.formats).toEqual(["pdf"]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
cd ~/Documents/Powerhouse/bai-knowledge-note
bun run test editors/knowledge-vault/lib/vault-api.test.ts
```

Expected: FAIL — `Failed to resolve import "./vault-api.js"`.

- [ ] **Step 3: Implement it**

```ts
import { authHeaders } from "../../shared/authed-fetch.js";
import { resolveSwitchboardOrigin } from "../../shared/subgraph-endpoint.js";

/**
 * One authenticated call into the vault's own REST routes.
 *
 * The drives routes live under the package namespace on the Switchboard
 * (`<origin>/api/@powerhousedao/knowledge-note/...`, measured against a running
 * server), and every one of them needs the same bearer. This is that, in one
 * place, so no view grows its own fetch.
 *
 * A refusal is typed: the routes answer `{ error, code }` and the UI shows the
 * code when there is one. A refusal that is not JSON (a proxy, a dead
 * Switchboard) must still arrive as a failure the caller can render rather than
 * a SyntaxError.
 */
export class VaultApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VaultApiFailure";
  }
}

export type VaultApi = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
};

const PACKAGE = "@powerhousedao/knowledge-note";

const trimOrigin = (origin: string) => origin.replace(/\/+$/, "");

export function createVaultApi(
  options: { fetchImpl?: typeof fetch; origin?: string } = {},
): VaultApi {
  const doFetch = options.fetchImpl ?? fetch;
  const origin = trimOrigin(options.origin ?? resolveSwitchboardOrigin() ?? "");
  const url = (path: string) =>
    `${origin}/api/${PACKAGE}/${path.replace(/^\/+/, "")}`;

  // One send for every verb, so the error handling and the URL shape exist once.
  async function send<T>(fullUrl: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(fullUrl, init);
    } catch (error) {
      throw new VaultApiFailure(
        0,
        "UNREACHABLE",
        `Could not reach the vault: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let code = "UNKNOWN";
      let message = `The vault refused the request (${response.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.error) message = parsed.error;
      } catch {
        // Not JSON: keep the status-shaped message above.
      }
      throw new VaultApiFailure(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  return {
    async get<T>(path: string): Promise<T> {
      return send<T>(url(path), {
        method: "GET",
        headers: await authHeaders(),
      });
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      return send<T>(url(path), {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },
  };
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
bun run test editors/knowledge-vault/lib/vault-api.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run tsc && bun run lint
```

Expected: tsc silent; lint exit 0 with no **error** line mentioning `vault-api`.

- [ ] **Step 6: Commit**

```bash
git add editors/knowledge-vault/lib/vault-api.ts editors/knowledge-vault/lib/vault-api.test.ts
git commit -m "feat(vault): one authenticated helper for the vault REST routes"
```

---

### Task 3: `lib/intake-model.ts` — the flow model

The rules with no React and no fetch: what a file row is, how it moves through
its states, what is selected, and what is publishable. This is where the flow is
actually decided, so this is where the tests are.

**Files:**

- Create: `editors/knowledge-vault/lib/intake-model.ts`
- Test: `editors/knowledge-vault/lib/intake-model.test.ts`

**Interfaces:**

- Consumes: the convert route's `Section` shape (`title`, `headingPath`, `text`, `charCount`, `chunks`, `mergedFrom[]`, `markdownRange | null`) plus the `content` Task 6 derives from the markdown.
- Produces:
  - `type Section = { title; headingPath; text; content; charCount; chunks; mergedFrom: { title; headingPath; charCount }[]; markdownRange: { start; end } | null }`
  - `type ConvertedFile = { filename: string; format: string; sections: Section[]; plan: { cutLevel; splitSections; mergedSections; rejoinedSections; minSectionChars } }`
  - `type FileState = "queued" | "converting" | "converted" | "failed"`
  - `type IntakeFile = { id: string; name: string; size: number; mimeType: string; state: FileState; converted?: ConvertedFile; error?: string; sourceType: string; folderName: string; selected: boolean[]; publishedIds?: string[]; startedAt?: number; finishedAt?: number }`
  - `isLikelyFurniture(title: string): boolean` — what stays unticked by default
  - `markPublished(files, id, sourceIds): IntakeFile[]`
  - `const MAX_UPLOAD_BYTES = 30 * 1024 * 1024`
  - `addFiles(files: IntakeFile[], additions: { name; size; mimeType }[]): IntakeFile[]`
  - `validateFile(file: { name: string; size: number }, formats: string[]): { ok: true } | { ok: false; reason: string }`
  - `setState(files: IntakeFile[], id: string, patch: Partial<IntakeFile>): IntakeFile[]`
  - `toggleSection(files, id, index): IntakeFile[]`, `setAllSections(files, id, on: boolean): IntakeFile[]`
  - `selectedCount(file: IntakeFile): number`, `totalSelected(files: IntakeFile[]): number`
  - `canPublish(files: IntakeFile[]): boolean`, `nextQueued(files: IntakeFile[]): IntakeFile | undefined`
  - `defaultSourceType(fileName: string): string` — by format, never `BOOK_CHAPTER`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  addFiles,
  canPublish,
  defaultSourceType,
  isLikelyFurniture,
  markPublished,
  nextQueued,
  selectedCount,
  setAllSections,
  setState,
  toggleSection,
  totalSelected,
  validateFile,
  type Section,
} from "./intake-model.js";

const formats = ["pdf", "docx", "html", "md"];

describe("validateFile", () => {
  it("accepts a supported extension within the cap", () => {
    expect(validateFile({ name: "book.pdf", size: 1024 }, formats)).toEqual({
      ok: true,
    });
  });

  it("refuses an over-size file and names the limit", () => {
    const result = validateFile(
      { name: "book.pdf", size: MAX_UPLOAD_BYTES + 1 },
      formats,
    );
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("reason", expect.stringContaining("30 MB"));
  });

  it("accepts exactly the cap", () => {
    expect(
      validateFile({ name: "book.pdf", size: MAX_UPLOAD_BYTES }, formats).ok,
    ).toBe(true);
  });

  it("refuses an extension the server does not accept, and says which", () => {
    const result = validateFile({ name: "notes.pages", size: 10 }, formats);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("reason", expect.stringContaining("pages"));
  });

  it("is case-insensitive about the extension", () => {
    expect(validateFile({ name: "BOOK.PDF", size: 10 }, formats).ok).toBe(true);
  });

  it("refuses a name with no extension at all", () => {
    expect(validateFile({ name: "README", size: 10 }, formats).ok).toBe(false);
  });
});

describe("addFiles", () => {
  it("adds rows as queued, typed by format, with no sections yet", () => {
    const files = addFiles(
      [],
      [{ name: "book.pdf", size: 10, mimeType: "application/pdf" }],
    );
    expect(files).toHaveLength(1);
    expect(files[0].state).toBe("queued");
    expect(files[0].selected).toEqual([]);
    expect(files[0].folderName).toBe("book");
    expect(files[0].sourceType).toBe("ARTICLE");
  });

  it("gives each row a distinct id", () => {
    const files = addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );
    expect(new Set(files.map((f) => f.id)).size).toBe(2);
  });

  it("does not mutate the list it was given", () => {
    const before: never[] = [];
    addFiles(before, [{ name: "a.pdf", size: 1, mimeType: "application/pdf" }]);
    expect(before).toHaveLength(0);
  });
});

describe("the state machine", () => {
  const one = () =>
    addFiles([], [{ name: "book.pdf", size: 10, mimeType: "application/pdf" }]);

  const sec = (title: string, text: string): Section => ({
    title,
    headingPath: [title],
    text,
    content: text,
    charCount: text.length,
    chunks: [0],
    mergedFrom: [],
    markdownRange: null,
  });
  const plan = {
    cutLevel: 1,
    splitSections: 0,
    mergedSections: 0,
    rejoinedSections: 0,
    minSectionChars: 2000,
  };

  /** The same file, converted, with two sections. */
  const twoSections = () =>
    setState(one(), one()[0].id, {
      state: "converted",
      converted: {
        filename: "book.pdf",
        format: "pdf",
        plan,
        sections: [sec("One", "a"), sec("Two", "b")],
      },
    });

  it("carries a conversion result and ticks every section by default", () => {
    // All ticked is the default on purpose: the section rule already folded the
    // undersized and split the oversized, so the review exists so the user can
    // disagree, not so they must assemble the result by hand.
    const files = twoSections();
    expect(files[0].state).toBe("converted");
    expect(files[0].selected).toEqual([true, true]);
    expect(selectedCount(files[0])).toBe(2);
  });

  it("leaves furniture unticked by default, so the user re-ticks rather than culls", () => {
    // Measured on a 238-page book at the default floor: the first two sections
    // were `Praise for …` (3.7k chars) and `[ contents ]` (13.7k). Ticked by
    // default, both would have become sources.
    const files = setState(one(), one()[0].id, {
      state: "converted",
      converted: {
        filename: "book.pdf",
        format: "pdf",
        plan,
        sections: [
          sec("Praise for Design for How People Think", "…"),
          sec("[ contents ]", "…"),
          sec("Emotion", "…"),
        ],
      },
    });
    expect(files[0].selected).toEqual([false, false, true]);
  });

  it("remembers what it published and stops counting it as publishable", () => {
    const files = markPublished(twoSections(), one()[0].id, ["s1", "s2"]);
    expect(files[0].publishedIds).toEqual(["s1", "s2"]);
    expect(canPublish(files)).toBe(false);
  });

  it("keeps the error message on failure and leaves the row retryable", () => {
    const files = setState(one(), one()[0].id, {
      state: "failed",
      error: "Conversion service unreachable",
    });
    expect(files[0].error).toBe("Conversion service unreachable");
    // Retry means returning to queued — the scheduler picks it up again.
    expect(setState(files, files[0].id, { state: "queued" })[0].state).toBe(
      "queued",
    );
  });

  it("toggles one section without touching its neighbours", () => {
    const toggled = toggleSection(twoSections(), one()[0].id, 0);
    expect(toggled[0].selected).toEqual([false, true]);
    expect(selectedCount(toggled[0])).toBe(1);
  });

  it("can select none — publishing nothing is a legal state to be in", () => {
    const cleared = setAllSections(twoSections(), one()[0].id, false);
    expect(cleared[0].selected).toEqual([false, false]);
    expect(totalSelected(cleared)).toBe(0);
  });
});

describe("scheduling", () => {
  const two = () =>
    addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );

  it("picks the first queued file, so the batch runs in the order it was added", () => {
    const files = two();
    expect(nextQueued(files)?.name).toBe("a.pdf");
  });

  it("skips a file already converting", () => {
    const files = setState(two(), two()[0].id, { state: "converting" });
    expect(nextQueued(files)?.name).toBe("b.pdf");
  });

  it("has nothing to do once every file has settled", () => {
    let files = two();
    for (const f of files)
      files = setState(files, f.id, { state: "converted" });
    expect(nextQueued(files)).toBeUndefined();
  });

  it("counts only converted files with something ticked as publishable", () => {
    let files = two();
    files = setState(files, files[0].id, {
      state: "converted",
      converted: { filename: "a.pdf", format: "pdf", plan, sections: [] },
    });
    expect(canPublish(files)).toBe(false);
    expect(totalSelected(files)).toBe(0);
  });
});

describe("defaultSourceType", () => {
  // By format, never by section count: a two-section CV is not a book, and a
  // twelve-section PDF may be a report. BOOK_CHAPTER is a choice the user makes.
  it("calls a web page a web page", () => {
    expect(defaultSourceType("page.html")).toBe("WEB_PAGE");
    expect(defaultSourceType("PAGE.HTM")).toBe("WEB_PAGE");
  });

  it("calls captions and media transcripts", () => {
    expect(defaultSourceType("talk.vtt")).toBe("TRANSCRIPT");
    expect(defaultSourceType("talk.mp3")).toBe("TRANSCRIPT");
    expect(defaultSourceType("talk.mp4")).toBe("TRANSCRIPT");
  });

  it("calls everything else an article, and never a book chapter", () => {
    for (const name of [
      "book.pdf",
      "notes.md",
      "report.docx",
      "data.csv",
      "README",
    ]) {
      expect(defaultSourceType(name)).toBe("ARTICLE");
    }
  });
});

describe("isLikelyFurniture", () => {
  it("recognises the furniture a real book produced", () => {
    for (const title of [
      "[ contents ]",
      "[ SIDE NOTE ]",
      "Praise for Design for How People Think",
      "Contents",
      "Table of Contents",
      "Index",
      "Copyright",
      "Colophon",
      "Revision History for the First Edition:",
      "How to Contact Us",
      "About the Author",
      "Acknowledgments",
    ]) {
      expect(isLikelyFurniture(title)).toBe(true);
    }
  });

  it("does not flag a chapter", () => {
    for (const title of [
      "Emotion",
      "Wayfinding",
      "Core Competencies",
      "Selected Projects",
      "Design for How People Think — front matter",
    ]) {
      expect(isLikelyFurniture(title)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/intake-model.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * The model's own `SourceType` enum, copied once so the review's select cannot
 * drift from what `POST sources` accepts — it validates against the generated
 * zod schema and answers 400 for anything else.
 */
export const SECTION_TYPES = [
  "ARTICLE",
  "PAPER",
  "BOOK_CHAPTER",
  "TRANSCRIPT",
  "DOCUMENTATION",
  "CONVERSATION",
  "WEB_PAGE",
  "MANUAL_ENTRY",
] as const;

/** A group the section rule folded into a section — kept so the fold is visible. */
export type SectionPart = {
  title: string;
  headingPath: string[];
  charCount: number;
};

/**
 * A section as the convert route returns it, plus `content`.
 *
 * `text` is chunk text and flattens tables; `content` is the markdown slice at
 * `markdownRange` (Task 6 derives it), falling back to `text` when the range is
 * null. `content` is what becomes the source.
 */
export type Section = {
  title: string;
  headingPath: string[];
  text: string;
  content: string;
  charCount: number;
  chunks: number[];
  mergedFrom: SectionPart[];
  markdownRange: { start: number; end: number } | null;
};

export type SectionPlanSummary = {
  cutLevel: number;
  splitSections: number;
  mergedSections: number;
  rejoinedSections: number;
  minSectionChars: number;
};

export type ConvertedFile = {
  filename: string;
  format: string;
  sections: Section[];
  plan: SectionPlanSummary;
};

export type FileState = "queued" | "converting" | "converted" | "failed";

export type IntakeFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  state: FileState;
  converted?: ConvertedFile;
  error?: string;
  /** Per file, shared by every section it produces (spec §3, decision 4). */
  sourceType: string;
  /** The `/sources/<folderName>` this document's sources will land in. */
  folderName: string;
  /** One flag per section; converted files arrive ticked except for furniture. */
  selected: boolean[];
  /**
   * Set once this row has been published. `POST sources` is not idempotent on
   * content — only the queue task is deduped — so a second publish would create
   * a second set of sources in the same folder. The row refuses instead.
   */
  publishedIds?: string[];
  startedAt?: number;
  finishedAt?: number;
};

/**
 * Titles that are almost never a source: the book's own furniture, read as
 * headings by the layout model. A heuristic, not a verdict — these arrive
 * unticked and the user re-ticks. Measured on a 238-page book: at the default
 * floor the first two sections were `Praise for …` and `[ contents ]`.
 */
const FURNITURE = [
  /^\[.*\]$/, // `[ contents ]`, `[ SIDE NOTE ]`
  /^praise for\b/i,
  /^(table of )?contents$/i,
  /^index$/i,
  /^copyright\b/i,
  /^colophon$/i,
  /^revision history\b/i,
  /^how to contact\b/i,
  /^about the authors?$/i,
  /^acknowledg(e)?ments$/i,
  /^dedication$/i,
];

export function isLikelyFurniture(title: string): boolean {
  const t = title.trim();
  return FURNITURE.some((rule) => rule.test(t));
}

/** `/sources/<name>`: the file's name without its extension. */
export function folderNameFor(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || "Untitled";
}

let counter = 0;
const nextId = () => `intake-${++counter}`;

export function addFiles(
  files: IntakeFile[],
  additions: { name: string; size: number; mimeType: string }[],
): IntakeFile[] {
  return [
    ...files,
    ...additions.map((a) => ({
      id: nextId(),
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      state: "queued" as const,
      sourceType: defaultSourceType(a.name),
      folderName: folderNameFor(a.name),
      selected: [],
    })),
  ];
}

const MB = 1024 * 1024;

export function validateFile(
  file: { name: string; size: number },
  formats: string[],
): { ok: true } | { ok: false; reason: string } {
  if (file.size > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / MB);
    const size = (file.size / MB).toFixed(1);
    return {
      ok: false,
      reason: `${size} MB is over the ${limit} MB limit for one document.`,
    };
  }
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ext) {
    return {
      ok: false,
      reason: `“${file.name}” has no file extension, so its format cannot be told.`,
    };
  }
  if (!formats.some((f) => f.toLowerCase() === ext)) {
    return {
      ok: false,
      reason: `.${ext} is not one of the formats the converter reads.`,
    };
  }
  return { ok: true };
}

export function setState(
  files: IntakeFile[],
  id: string,
  patch: Partial<IntakeFile>,
): IntakeFile[] {
  return files.map((f) => {
    if (f.id !== id) return f;
    const next = { ...f, ...patch };
    // A conversion result arrives ticked — except for furniture: the review
    // exists so the user can disagree, not so they must do the work, and
    // culling `[ contents ]` by hand is work.
    if (patch.converted) {
      next.selected = patch.converted.sections.map(
        (s) => !isLikelyFurniture(s.title),
      );
    }
    return next;
  });
}

export function markPublished(
  files: IntakeFile[],
  id: string,
  sourceIds: string[],
): IntakeFile[] {
  return files.map((f) =>
    f.id === id ? { ...f, publishedIds: sourceIds } : f,
  );
}

export function toggleSection(
  files: IntakeFile[],
  id: string,
  index: number,
): IntakeFile[] {
  return files.map((f) =>
    f.id === id
      ? { ...f, selected: f.selected.map((on, i) => (i === index ? !on : on)) }
      : f,
  );
}

export function setAllSections(
  files: IntakeFile[],
  id: string,
  on: boolean,
): IntakeFile[] {
  return files.map((f) =>
    f.id === id ? { ...f, selected: f.selected.map(() => on) } : f,
  );
}

/** Ticked sections on a row that has not been published yet. */
export function selectedCount(file: IntakeFile): number {
  if (file.publishedIds) return 0;
  return file.selected.filter(Boolean).length;
}

export function totalSelected(files: IntakeFile[]): number {
  return files.reduce((n, f) => n + selectedCount(f), 0);
}

export function canPublish(files: IntakeFile[]): boolean {
  return totalSelected(files) > 0;
}

/** The next file to convert: first in, first out, one at a time. */
export function nextQueued(files: IntakeFile[]): IntakeFile | undefined {
  return files.find((f) => f.state === "queued");
}

const TRANSCRIPT_EXTENSIONS = new Set([
  "vtt",
  "srt",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mkv",
  "mov",
]);

/**
 * By format, never by section count. A two-section CV is not a book and a
 * twelve-section PDF may be a report; `BOOK_CHAPTER` is a choice the user makes
 * in the review, per file.
 */
export function defaultSourceType(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (ext === "html" || ext === "htm") return "WEB_PAGE";
  if (TRANSCRIPT_EXTENSIONS.has(ext)) return "TRANSCRIPT";
  return "ARTICLE";
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
bun run test editors/knowledge-vault/lib/intake-model.test.ts
```

Expected: PASS. If a test fails because the file mixes `require` with imports,
fix the test rather than the module — `lib/` is ESM throughout.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run tsc && bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add editors/knowledge-vault/lib/intake-model.ts editors/knowledge-vault/lib/intake-model.test.ts
git commit -m "feat(intake): the flow model — file states, section selection, validation"
```

---

### Task 4: `lib/intake-publish.ts` — the publishing rules

What actually gets created, and what the vault's routes will refuse. All pure,
because these are the rules a reviewer would reject the flow over.

**Files:**

- Create: `editors/knowledge-vault/lib/intake-publish.ts`
- Test: `editors/knowledge-vault/lib/intake-publish.test.ts`

**Interfaces:**

- Consumes: `folderNameFor` from `intake-model.ts` (Task 3); `IntakeFile`, `Section` types.
- Produces:
  - `sanitiseFolderName(raw: string): string`
  - `sectionTitle(section: Section, index: number, documentName: string): string`
  - `type PublishPlan = { folderName: string; sources: { title: string; content: string; sourceType: string; sectionIndex: number }[]; skipped: number }`
  - `publishPlan(file: IntakeFile): PublishPlan`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { IntakeFile, Section } from "./intake-model.js";
import {
  publishPlan,
  sanitiseFolderName,
  sectionTitle,
} from "./intake-publish.js";

const section = (title: string, text: string, content = text): Section => ({
  title,
  headingPath: [title],
  text,
  content,
  charCount: text.length,
  chunks: [0],
  mergedFrom: [],
  markdownRange: null,
});
const plan = {
  cutLevel: 1,
  splitSections: 0,
  mergedSections: 0,
  rejoinedSections: 0,
  minSectionChars: 2000,
};

const file = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Design for How People Think.pdf",
  size: 10,
  mimeType: "application/pdf",
  state: "converted",
  sourceType: "BOOK_CHAPTER",
  folderName: "Design for How People Think",
  selected: [],
  converted: {
    filename: "Design for How People Think.pdf",
    format: "pdf",
    plan,
    sections: [section("One", "first"), section("Two", "second")],
  },
  ...over,
});

describe("sanitiseFolderName", () => {
  it("removes the slash the route refuses, rather than letting it 400", () => {
    // source-folders.ts: name "is one folder, not a path: it cannot contain '/'".
    expect(sanitiseFolderName("Draft 1/2")).toBe("Draft 1-2");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitiseFolderName("  Design   for  How \n People Think ")).toBe(
      "Design for How People Think",
    );
  });

  it("falls back rather than sending an empty name", () => {
    expect(sanitiseFolderName("   ")).toBe("Untitled");
  });

  it("keeps a long name usable instead of letting a node name sprawl", () => {
    expect(sanitiseFolderName("x".repeat(400)).length).toBe(120);
  });
});

describe("sectionTitle", () => {
  it("uses the section's own title", () => {
    expect(sectionTitle(section("Record", "t"), 0, "Book")).toBe("Record");
  });

  it("falls back to the document and the part number, because title is required", () => {
    // POST sources answers 400 when title is empty, so a section the extractor
    // could not name must still arrive named.
    expect(sectionTitle(section("   ", "t"), 2, "Book")).toBe("Book · part 3");
  });
});

describe("publishPlan", () => {
  it("includes only the ticked sections, in document order", () => {
    const plan = publishPlan(file({ selected: [false, true] }));
    expect(plan.sources.map((s) => s.title)).toEqual(["Two"]);
    expect(plan.sources[0].sectionIndex).toBe(1);
  });

  it("carries the file's type onto every source", () => {
    const plan = publishPlan(file({ selected: [true, true] }));
    expect(plan.sources.every((s) => s.sourceType === "BOOK_CHAPTER")).toBe(
      true,
    );
  });

  it("skips a section with no content, and counts it, because content is required", () => {
    const result = publishPlan(
      file({
        selected: [true, true, true],
        converted: {
          filename: "b.pdf",
          format: "pdf",
          plan,
          sections: [
            section("One", "first"),
            section("Two", "   "),
            section("Three", "third"),
          ],
        },
      }),
    );
    expect(result.sources.map((s) => s.title)).toEqual(["One", "Three"]);
    expect(result.skipped).toBe(1);
  });

  it("sends the markdown slice as content, not the chunk text", () => {
    // The chunk text of a table is `🟤, 1 = … , 2 = …` triplets; the markdown
    // is the table. `content` is what Task 6 sliced from the markdown.
    const result = publishPlan(
      file({
        selected: [true],
        converted: {
          filename: "cv.pdf",
          format: "pdf",
          plan,
          sections: [
            section(
              "Education",
              "🟤, 1 = Academy. , 2 = 2016",
              "## Education\n\n| Academy | 2016 |",
            ),
          ],
        },
      }),
    );
    expect(result.sources[0].content).toBe(
      "## Education\n\n| Academy | 2016 |",
    );
  });

  it("produces an empty plan when nothing is ticked", () => {
    const plan = publishPlan(file({ selected: [false, false] }));
    expect(plan.sources).toEqual([]);
    expect(plan.skipped).toBe(0);
  });

  it("uses the sanitisable folder name the user may have edited", () => {
    const plan = publishPlan(file({ folderName: "Book / Vol 2" }));
    expect(plan.folderName).toBe("Book - Vol 2");
  });

  it("does not mutate the file it was given", () => {
    const f = file({ selected: [true, false] });
    const before = JSON.stringify(f);
    publishPlan(f);
    expect(JSON.stringify(f)).toBe(before);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/intake-publish.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
import type { IntakeFile, Section } from "./intake-model.js";

/**
 * What the vault will be asked to create, decided purely.
 *
 * Three of these rules are the routes' rules, not ours: a folder name cannot
 * contain `/` (source-folders.ts refuses it), a source cannot be created
 * without a `title` and a `content` (routes/sources.ts refuses both), and every
 * source from one document carries that document's `SourceType`. Getting them
 * wrong means a 400 part-way through a publish, with some of the batch already
 * written — so they are asserted here, before anything is sent.
 */

const MAX_NAME = 120;

export function sanitiseFolderName(raw: string): string {
  const cleaned = raw.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.slice(0, MAX_NAME).trim() || "Untitled";
}

export function sectionTitle(
  section: Section,
  index: number,
  documentName: string,
): string {
  const own = section.title.trim();
  if (own) return own.slice(0, MAX_NAME);
  return `${documentName} · part ${index + 1}`.slice(0, MAX_NAME);
}

export type PublishPlan = {
  folderName: string;
  sources: {
    title: string;
    content: string;
    sourceType: string;
    sectionIndex: number;
  }[];
  /** Ticked sections with no text, which cannot become a source. */
  skipped: number;
};

export function publishPlan(file: IntakeFile): PublishPlan {
  const sections = file.converted?.sections ?? [];
  const sources: PublishPlan["sources"] = [];
  let skipped = 0;

  sections.forEach((section, index) => {
    if (file.selected[index] !== true) return;
    if (!section.content.trim()) {
      skipped += 1;
      return;
    }
    sources.push({
      title: sectionTitle(section, index, file.folderName),
      // `content` is the markdown slice (tables intact), or the chunk text when
      // the section could not be located in the markdown. Untrimmed on purpose.
      content: section.content,
      sourceType: file.sourceType,
      sectionIndex: index,
    });
  });

  return {
    folderName: sanitiseFolderName(file.folderName),
    sources,
    skipped,
  };
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
bun run test editors/knowledge-vault/lib/intake-publish.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run tsc && bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add editors/knowledge-vault/lib/intake-publish.ts editors/knowledge-vault/lib/intake-publish.test.ts
git commit -m "feat(intake): what gets created — folder names, titles, the publish plan"
```

---

### Task 5: `lib/mime.ts` — preview or download

**Files:**

- Create: `editors/knowledge-vault/lib/mime.ts`
- Test: `editors/knowledge-vault/lib/mime.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `isBrowserRenderable(mimeType: string | null | undefined): boolean`, `formatFileSize(bytes: number | null | undefined): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { formatFileSize, isBrowserRenderable } from "./mime.js";

describe("isBrowserRenderable", () => {
  it("previews the document types a browser genuinely renders", () => {
    expect(isBrowserRenderable("application/pdf")).toBe(true);
    expect(isBrowserRenderable("text/plain")).toBe(true);
    expect(isBrowserRenderable("text/markdown")).toBe(true);
  });

  it("previews media", () => {
    expect(isBrowserRenderable("image/png")).toBe(true);
    expect(isBrowserRenderable("audio/mpeg")).toBe(true);
    expect(isBrowserRenderable("video/mp4")).toBe(true);
  });

  it("downloads html and svg on purpose, not by omission", () => {
    // Rendering untrusted markup injects it into the editor's origin.
    expect(isBrowserRenderable("text/html")).toBe(false);
    expect(isBrowserRenderable("image/svg+xml")).toBe(false);
  });

  it("downloads what the browser cannot render", () => {
    expect(
      isBrowserRenderable(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
    expect(isBrowserRenderable("application/epub+zip")).toBe(false);
    expect(isBrowserRenderable("text/csv")).toBe(false);
  });

  it("reads through a parameter and any casing", () => {
    expect(isBrowserRenderable("text/plain; charset=utf-8")).toBe(true);
    expect(isBrowserRenderable("APPLICATION/PDF")).toBe(true);
  });

  it("treats a missing type as not renderable", () => {
    expect(isBrowserRenderable(null)).toBe(false);
    expect(isBrowserRenderable(undefined)).toBe(false);
    expect(isBrowserRenderable("")).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("shows one decimal of a megabyte", () => {
    expect(formatFileSize(17_400_000)).toBe("16.6 MB");
  });

  it("says nothing rather than 'NaN' when the size is unknown", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/mime.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
/**
 * Render-or-download is a rule, not a display preference.
 *
 * docling accepts 29 formats, so a source may hold anything at all. A browser
 * can genuinely render PDFs, plain text, markdown and media; it must NOT be
 * given html or svg, because rendering untrusted markup injects it into the
 * editor's origin. Everything else downloads, so the panel is honest about what
 * the browser can do rather than showing an empty pane.
 */
const RENDERABLE = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

const RENDERABLE_PREFIXES = ["image/", "audio/", "video/"];

const DENIED = new Set(["text/html", "image/svg+xml"]);

export function isBrowserRenderable(
  mimeType: string | null | undefined,
): boolean {
  if (!mimeType) return false;
  const [rawType] = mimeType.toLowerCase().split(";");
  const type = rawType.trim();
  if (!type) return false;
  if (DENIED.has(type)) return false;
  if (RENDERABLE.has(type)) return true;
  return RENDERABLE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
bun run test editors/knowledge-vault/lib/mime.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run tsc && bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add editors/knowledge-vault/lib/mime.ts editors/knowledge-vault/lib/mime.test.ts
git commit -m "feat(intake): preview-or-download, and why html and svg still download"
```

---

### Task 6: Convert a file — the raw-body call, and `convertFile`

The convert route takes **bytes, not JSON**, so `vault-api.ts` grows a raw-body
method. The filename goes through `encodeURIComponent`, which yields `%20` and
not `+` — a mistake this plan's predecessor already made and recorded.

**Files:**

- Modify: `editors/knowledge-vault/lib/vault-api.ts`
- Modify: `editors/knowledge-vault/lib/vault-api.test.ts`
- Create: `editors/knowledge-vault/lib/intake-service.ts`
- Test: `editors/knowledge-vault/lib/intake-service.test.ts`

**Interfaces:**

- Consumes: `VaultApi` (Task 2), `ConvertedFile` (Task 3).
- Produces:
  - `VaultApi` gains `postRaw<T>(path: string, bytes: Uint8Array, options?: { contentType?: string }): Promise<T>`
  - `convertFile(input: { name: string; bytes: Uint8Array }, deps: { api: VaultApi }): Promise<ConvertedFile>`

- [ ] **Step 1: Write the failing test for the raw method**

Add to `vault-api.test.ts`:

```ts
it("percent-encodes the filename, and sends the bytes as the body", async () => {
  // `encodeURIComponent` gives %20 where a form encoder would give +, and the
  // service decodes the query parameter as a path component.
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(ok({ ok: true }));
  }) as unknown as typeof fetch;

  const bytes = new Uint8Array([37, 80, 68, 70]);
  await createVaultApi({ fetchImpl, origin: "http://localhost:4001" }).postRaw(
    "/convert?filename=Book%20chapter.pdf",
    bytes,
    { contentType: "application/octet-stream" },
  );

  expect(calls[0].url).toBe(
    "http://localhost:4001/api/@powerhousedao/knowledge-note/convert?filename=Book%20chapter.pdf",
  );
  expect(calls[0].init.body).toBe(bytes);
  expect(
    (calls[0].init.headers as Record<string, string>)["content-type"],
  ).toBe("application/octet-stream");
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/vault-api.test.ts
```

Expected: FAIL — `postRaw is not a function`.

- [ ] **Step 3: Implement `postRaw`**

Refactor the JSON path and the raw path onto one private `send`, so the error
handling and the URL shape exist once:

```ts
export type VaultApi = {
  post<T>(path: string, body: unknown): Promise<T>;
  postRaw<T>(
    path: string,
    bytes: Uint8Array,
    options?: { contentType?: string },
  ): Promise<T>;
};

export function createVaultApi(
  options: { fetchImpl?: typeof fetch; origin?: string } = {},
): VaultApi {
  const doFetch = options.fetchImpl ?? fetch;
  const origin = trimOrigin(options.origin ?? resolveSwitchboardOrigin() ?? "");
  const url = (path: string) =>
    `${origin}/api/${PACKAGE}/${path.replace(/^\/+/, "")}`;

  async function send<T>(fullUrl: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(fullUrl, init);
    } catch (error) {
      throw new VaultApiFailure(
        0,
        "UNREACHABLE",
        `Could not reach the vault: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let code = "UNKNOWN";
      let message = `The vault refused the request (${response.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.error) message = parsed.error;
      } catch {
        // Not JSON: keep the status-shaped message above.
      }
      throw new VaultApiFailure(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      return send<T>(url(path), {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },
    async postRaw<T>(
      path: string,
      bytes: Uint8Array,
      options: { contentType?: string } = {},
    ): Promise<T> {
      return send<T>(url(path), {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": options.contentType ?? "application/octet-stream",
        },
        body: bytes as unknown as BodyInit,
      });
    },
  };
}
```

- [ ] **Step 4: Write the failing test for `convertFile`**

```ts
import { describe, expect, it } from "vitest";
import type { VaultApi } from "./vault-api.js";
import { convertFile } from "./intake-service.js";

const markdown =
  "## Core Competencies\n\nskills\n\n## Education\n\n| Academy | 2016 |\n";
const summary = {
  filename: "Book chapter.pdf",
  format: "pdf",
  chars: markdown.length,
  chunks: 55,
  sections: [
    {
      title: "Core Competencies",
      headingPath: ["Core Competencies"],
      text: "skills",
      charCount: 6,
      chunks: [0],
      mergedFrom: [],
      markdownRange: { start: 0, end: markdown.indexOf("## Education") },
    },
    {
      title: "Education",
      headingPath: ["Education"],
      text: "Academy, 1 = 2016",
      charCount: 17,
      chunks: [1],
      mergedFrom: [],
      markdownRange: {
        start: markdown.indexOf("## Education"),
        end: markdown.length,
      },
    },
  ],
  plan: {
    cutLevel: 1,
    splitSections: 0,
    mergedSections: 0,
    rejoinedSections: 0,
    ceiling: 40000,
    minSectionChars: 2000,
  },
  markdown,
  timings: { convertMs: 1, chunkMs: 1, totalMs: 2 },
};

function recordingApi(response: unknown = summary) {
  const calls: { path: string; bytes: Uint8Array }[] = [];
  const api = {
    post: () => Promise.reject(new Error("not used")),
    postRaw: (_path: string, bytes: Uint8Array) => {
      calls.push({ path: _path, bytes });
      return Promise.resolve(response);
    },
  } as unknown as VaultApi;
  return { api, calls };
}

describe("convertFile", () => {
  it("asks the convert route for this filename and the markdown, with the bytes", async () => {
    const { api, calls } = recordingApi();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await convertFile(
      { name: "Book chapter.pdf", bytes },
      { api },
    );

    expect(calls[0].path).toBe(
      "/convert?filename=Book%20chapter.pdf&markdown=1",
    );
    expect(calls[0].bytes).toBe(bytes);
    expect(result.sections).toHaveLength(2);
    expect(result.format).toBe("pdf");
    expect(result.plan.rejoinedSections).toBe(0);
  });

  it("gives each section the markdown slice as content, so tables survive", async () => {
    const { api } = recordingApi();
    const result = await convertFile(
      { name: "cv.pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(result.sections[1].content).toBe(
      "## Education\n\n| Academy | 2016 |\n",
    );
    expect(result.sections[0].content).toBe(
      "## Core Competencies\n\nskills\n\n",
    );
    // The chunk text is kept beside it, for display and as the fallback.
    expect(result.sections[1].text).toBe("Academy, 1 = 2016");
  });

  it("falls back to the chunk text when a section has no markdown range", async () => {
    const { api } = recordingApi({
      ...summary,
      sections: [{ ...summary.sections[0], markdownRange: null }],
    });
    const result = await convertFile(
      { name: "cv.pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(result.sections[0].content).toBe("skills");
  });

  it("encodes a filename that would otherwise break the query string", async () => {
    const { api, calls } = recordingApi();
    await convertFile(
      { name: "Q&A #1 (final).pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(calls[0].path).toBe(
      `/convert?filename=${encodeURIComponent("Q&A #1 (final).pdf")}&markdown=1`,
    );
  });

  it("refuses a body the service did not answer with sections", async () => {
    // A CONVERT_SERVICE_URL pointing at something that is not our service
    // answers 200 with a shape we cannot use. Failing loudly here is what stops
    // a publish of zero sources reading as a success.
    const { api } = recordingApi({ markdown: "# hi" });
    await expect(
      convertFile({ name: "a.pdf", bytes: new Uint8Array() }, { api }),
    ).rejects.toThrow(/unexpected/i);
  });
});
```

- [ ] **Step 5: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/intake-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement `convertFile`**

```ts
import type {
  ConvertedFile,
  Section,
  SectionPlanSummary,
} from "./intake-model.js";
import type { VaultApi } from "./vault-api.js";

/**
 * The conversion half of the flow: one file in, its sections out.
 *
 * `POST convert` takes the document as its body and the name in the query, and
 * it *creates nothing* — which is what makes the review step possible. The
 * route refuses to answer with anything but `{ sections, ... }`, so a body
 * without them is a misconfigured URL rather than a document with no sections.
 */
type RouteSection = Omit<Section, "content">;

type ConvertSummary = {
  filename?: string;
  format?: string;
  sections?: RouteSection[];
  plan?: Partial<SectionPlanSummary>;
  markdown?: string;
};

/**
 * `&markdown=1` is asked for on purpose, even though it doubles the response
 * for a book: the markdown is where tables are rendered correctly, and each
 * section's `markdownRange` is the slice that becomes its `content`. The whole
 * markdown is dropped once the sections have their slices — only the slices
 * are kept, so a 400 000-character book does not sit in memory twice.
 */
export async function convertFile(
  input: { name: string; bytes: Uint8Array },
  deps: { api: VaultApi },
): Promise<ConvertedFile> {
  const path = `/convert?filename=${encodeURIComponent(input.name)}&markdown=1`;
  const body = await deps.api.postRaw<ConvertSummary>(path, input.bytes, {
    contentType: "application/octet-stream",
  });

  if (!Array.isArray(body?.sections)) {
    throw new Error(
      "The conversion service answered with an unexpected body — is CONVERT_SERVICE_URL pointing at this vault's convert route?",
    );
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : null;
  const sections: Section[] = body.sections.map((s) => ({
    ...s,
    mergedFrom: s.mergedFrom ?? [],
    markdownRange: s.markdownRange ?? null,
    content:
      markdown !== null && s.markdownRange
        ? markdown.slice(s.markdownRange.start, s.markdownRange.end)
        : s.text,
  }));

  return {
    filename: body.filename ?? input.name,
    format: body.format ?? "unknown",
    sections,
    plan: {
      cutLevel: body.plan?.cutLevel ?? 0,
      splitSections: body.plan?.splitSections ?? 0,
      mergedSections: body.plan?.mergedSections ?? 0,
      rejoinedSections: body.plan?.rejoinedSections ?? 0,
      minSectionChars: body.plan?.minSectionChars ?? 0,
    },
  };
}
```

- [ ] **Step 7: Run both test files, watch them pass**

```bash
bun run test editors/knowledge-vault/lib/vault-api.test.ts editors/knowledge-vault/lib/intake-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck and lint, then commit**

```bash
bun run tsc && bun run lint
git add editors/knowledge-vault/lib/vault-api.ts editors/knowledge-vault/lib/vault-api.test.ts editors/knowledge-vault/lib/intake-service.ts editors/knowledge-vault/lib/intake-service.test.ts
git commit -m "feat(intake): convert one file through the convert subgraph"
```

---

### Task 7: Publish a file — folder, sources, original

The write half, and the one with an ordering rule: the attachment ref is known
**before** the bytes are uploaded, so the ref is dispatched first and the upload
happens once for the whole document.

**Files:**

- Modify: `editors/knowledge-vault/lib/intake-service.ts`
- Modify: `editors/knowledge-vault/lib/intake-service.test.ts`

**Interfaces:**

- Consumes: `publishPlan` (Task 4), `VaultApi` (Task 2/6), `IntakeFile` (Task 3).
- Produces:
  - `type AttachmentPort = { prepare(file: { name: string; mimeType: string; bytes: Uint8Array }): Promise<{ ref: string }>; upload(prepared: { ref: string }): Promise<void>; }`
  - `type PublishResult = { folderId: string; folderCreated: boolean; sourceIds: string[]; skipped: number; attached: boolean }`
  - `publishFile(file: IntakeFile, bytes: Uint8Array, deps: { api: VaultApi; attachments?: AttachmentPort; driveId: string }): Promise<PublishResult>`

- [ ] **Step 1: Write the failing test**

```ts
function publishApi() {
  const calls: { path: string; body: unknown }[] = [];
  const api = {
    post: (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === "/sources/folders") {
        return Promise.resolve({
          id: "folder-1",
          name: "Book",
          path: "/sources/Book",
          created: true,
        });
      }
      if (path === "/sources") {
        const n = calls.filter((c) => c.path === "/sources").length;
        return Promise.resolve({
          id: `source-${n}`,
          status: "EXTRACTING",
          task: { id: "t1" },
        });
      }
      return Promise.resolve({ revision: 2 });
    },
    postRaw: () => Promise.reject(new Error("not used")),
  } as unknown as VaultApi;
  return { api, calls };
}

const convertedFile = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Book.pdf",
  size: 10,
  mimeType: "application/pdf",
  state: "converted",
  sourceType: "BOOK_CHAPTER",
  folderName: "Book",
  selected: [true, true],
  converted: {
    filename: "Book.pdf",
    format: "pdf",
    plan: {
      cutLevel: 1,
      splitSections: 0,
      mergedSections: 0,
      rejoinedSections: 0,
      minSectionChars: 2000,
    },
    sections: [
      {
        title: "Record",
        headingPath: ["Record"],
        text: "first",
        content: "first",
        charCount: 5,
        chunks: [0],
        mergedFrom: [],
        markdownRange: null,
      },
      {
        title: "Reduce",
        headingPath: ["Reduce"],
        text: "second",
        content: "second",
        charCount: 6,
        chunks: [1],
        mergedFrom: [],
        markdownRange: null,
      },
    ],
  },
  ...over,
});

describe("publishFile", () => {
  it("mints the folder once, then creates one source per ticked section", async () => {
    const { api, calls } = publishApi();
    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "vetra-a933d854",
    });

    const paths = calls.map((c) => c.path);
    expect(paths[0]).toBe("/sources/folders");
    expect(paths.filter((p) => p === "/sources")).toHaveLength(2);
    expect(result.sourceIds).toEqual(["source-1", "source-2"]);
    expect(result.folderCreated).toBe(true);
  });

  it("names the folder, and places every source in it", async () => {
    const { api, calls } = publishApi();
    await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });

    expect(calls[0].body).toEqual({ drive: "d", name: "Book" });
    const sourceBodies = calls
      .filter((c) => c.path === "/sources")
      .map((c) => c.body as Record<string, unknown>);
    expect(sourceBodies.every((b) => b.parentFolder === "folder-1")).toBe(true);
  });

  it("queues every source, so it reaches the pipeline as EXTRACTING", async () => {
    // `queue` defaults to true server-side; sending it explicitly means the
    // intent survives a change to that default.
    const { api, calls } = publishApi();
    await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });
    const sourceBodies = calls
      .filter((c) => c.path === "/sources")
      .map((c) => c.body as Record<string, unknown>);
    expect(sourceBodies.every((b) => b.queue === true)).toBe(true);
    expect(sourceBodies.every((b) => b.method === "converted")).toBe(true);
    expect(sourceBodies.every((b) => b.tool === "docling.rs")).toBe(true);
    expect(sourceBodies[0].title).toBe("Record");
    expect(sourceBodies[0].content).toBe("first");
    expect(sourceBodies[0].sourceType).toBe("BOOK_CHAPTER");
  });

  it("creates only the ticked sections", async () => {
    const { api, calls } = publishApi();
    const result = await publishFile(
      convertedFile({ selected: [false, true] }),
      new Uint8Array([1]),
      { api, driveId: "d" },
    );
    const sourceBodies = calls
      .filter((c) => c.path === "/sources")
      .map((c) => c.body as Record<string, unknown>);
    expect(sourceBodies).toHaveLength(1);
    expect(sourceBodies[0].title).toBe("Reduce");
    expect(result.sourceIds).toHaveLength(1);
  });

  it("dispatches the attachment ref before uploading the bytes, once per document", async () => {
    // The store is content-addressed, so the ref is known before the upload;
    // uploading per source would be N copies of the same bytes.
    const { api, calls } = publishApi();
    const order: string[] = [];
    const attachments: AttachmentPort = {
      prepare: () => {
        order.push("prepare");
        return Promise.resolve({ ref: "attachment://v1:abc" });
      },
      upload: () => {
        order.push("upload");
        return Promise.resolve();
      },
    };
    const apiWithOrder = {
      ...api,
      post: (path: string, body: unknown) => {
        order.push(path === "/actions" ? "attach" : path);
        return api.post(path, body);
      },
    } as unknown as VaultApi;

    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api: apiWithOrder,
      attachments,
      driveId: "d",
    });

    expect(order[0]).toBe("prepare");
    expect(order.filter((o) => o === "attach")).toHaveLength(2);
    expect(order.filter((o) => o === "upload")).toHaveLength(1);
    expect(order.indexOf("upload")).toBeGreaterThan(
      order.lastIndexOf("attach"),
    );
    expect(result.attached).toBe(true);

    const attachBodies = calls
      .filter((c) => c.path === "/actions")
      .map(
        (c) =>
          (
            c.body as {
              actions: { type: string; input: Record<string, unknown> }[];
            }
          ).actions[0],
      );
    expect(attachBodies.every((a) => a.type === "ATTACH_ORIGINAL_FILE")).toBe(
      true,
    );
    expect(attachBodies[0].input.originalFile).toBe("attachment://v1:abc");
    expect(attachBodies[0].input.convertedBy).toBe("docling.rs");
    expect(attachBodies[0].input.originalFileName).toBe("Book.pdf");
  });

  it("still publishes when there is no attachment port configured", async () => {
    // A vault whose attachment service is unavailable must still ingest the
    // content: a missing original is a degraded state, not a failed publish.
    const { api, calls } = publishApi();
    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });
    expect(result.attached).toBe(false);
    expect(calls.some((c) => c.path === "/actions")).toBe(false);
  });

  it("reports what it skipped, so the caller can say so", async () => {
    const { api } = publishApi();
    const result = await publishFile(
      convertedFile({
        converted: {
          filename: "Book.pdf",
          format: "pdf",
          plan: {
            cutLevel: 1,
            splitSections: 0,
            mergedSections: 0,
            rejoinedSections: 0,
            minSectionChars: 2000,
          },
          sections: [
            {
              title: "Record",
              headingPath: [],
              text: "first",
              content: "first",
              charCount: 5,
              chunks: [0],
              mergedFrom: [],
              markdownRange: null,
            },
            {
              title: "Blank",
              headingPath: [],
              text: "  ",
              content: "  ",
              charCount: 0,
              chunks: [1],
              mergedFrom: [],
              markdownRange: null,
            },
          ],
        },
      }),
      new Uint8Array([1]),
      { api, driveId: "d" },
    );
    expect(result.skipped).toBe(1);
    expect(result.sourceIds).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bun run test editors/knowledge-vault/lib/intake-service.test.ts
```

Expected: FAIL — `publishFile is not exported`.

- [ ] **Step 3: Implement `publishFile`**

Append to `intake-service.ts`:

```ts
import { publishPlan } from "./intake-publish.js";

export type AttachmentPort = {
  /** Content-addressed: resolves to a ref without sending the bytes. */
  prepare(file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ ref: string }>;
  upload(prepared: { ref: string }): Promise<void>;
};

export type PublishResult = {
  folderId: string;
  folderCreated: boolean;
  sourceIds: string[];
  skipped: number;
  attached: boolean;
};

const CONVERT_TOOL = "docling.rs";
const CONVERT_METHOD = "converted";

/**
 * The write half: folder, sources, original.
 *
 * Two calls per file plus one per source, all against routes that already
 * enforce the rules — `POST sources` resolves `/sources`, keeps `parentFolder`
 * inside it, verifies containment by reading it back, rolls back if it did not
 * land, and queues by default. Reimplementing that here would be a second set
 * of rules with its own way to leave orphans.
 */
export async function publishFile(
  file: IntakeFile,
  bytes: Uint8Array,
  deps: { api: VaultApi; attachments?: AttachmentPort; driveId: string },
): Promise<PublishResult> {
  const plan = publishPlan(file);

  const folder = await deps.api.post<{
    id: string;
    created: boolean;
  }>("/sources/folders", { drive: deps.driveId, name: plan.folderName });

  const sourceIds: string[] = [];
  for (const source of plan.sources) {
    const created = await deps.api.post<{ id: string }>("/sources", {
      drive: deps.driveId,
      title: source.title,
      content: source.content,
      sourceType: source.sourceType,
      parentFolder: folder.id,
      queue: true,
      method: CONVERT_METHOD,
      tool: CONVERT_TOOL,
    });
    sourceIds.push(created.id);
  }

  // No attachment port: publish the content anyway. A source with no original
  // is a degraded state the vault already supports; failing the publish over it
  // would throw away a conversion that may have taken minutes.
  if (!deps.attachments || sourceIds.length === 0) {
    return {
      folderId: folder.id,
      folderCreated: folder.created,
      sourceIds,
      skipped: plan.skipped,
      attached: false,
    };
  }

  // Ref first, bytes second — the ordering the convert spec §12.1 requires, so
  // a source can exist and be opened while the upload is still streaming.
  const prepared = await deps.attachments.prepare({
    name: file.name,
    mimeType: file.mimeType,
    bytes,
  });

  for (const documentId of sourceIds) {
    // Every source carries the original, not just the first: each is an
    // independent document that must answer "where did this come from?".
    await deps.api.post("/actions", {
      drive: deps.driveId,
      documentId,
      actions: [
        {
          type: "ATTACH_ORIGINAL_FILE",
          scope: "global",
          input: {
            originalFile: prepared.ref,
            originalFileName: file.name,
            originalMimeType: file.mimeType,
            originalSizeBytes: file.size,
            convertedBy: CONVERT_TOOL,
          },
        },
      ],
    });
  }

  await deps.attachments.upload(prepared);

  return {
    folderId: folder.id,
    folderCreated: folder.created,
    sourceIds,
    skipped: plan.skipped,
    attached: true,
  };
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
bun run test editors/knowledge-vault/lib/intake-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck and lint, then commit**

```bash
bun run tsc && bun run lint
git add editors/knowledge-vault/lib/intake-service.ts editors/knowledge-vault/lib/intake-service.test.ts
git commit -m "feat(intake): publish a document — one folder, its sources, its original"
```

---

### Task 8: The view — landing, upload, queue, review

Thin components over the tested model. Colour only from `--bai-*`, layout from
Tailwind, `:hover` in a scoped `<style>` block, exactly as `VaultSidebar` and
`CreateDocumentDialog` do.

**Files:**

- Create: `editors/knowledge-vault/components/intake/IntakeView.tsx`
- Create: `editors/knowledge-vault/components/intake/IntakeLanding.tsx`
- Create: `editors/knowledge-vault/components/intake/UploadSurface.tsx`
- Create: `editors/knowledge-vault/components/intake/ConversionQueue.tsx`
- Create: `editors/knowledge-vault/components/intake/SectionReview.tsx`
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx` (four edits)
- Modify: `editors/knowledge-vault/components/GettingStarted.tsx` (the copy)

**Interfaces:**

- Consumes: everything from Tasks 2–7; `LandingStage` from `../chat/LandingStage.js`; `Spinner`/`LoadingLine` from `../LoadingStates.js`; the attachment port (Task 9 supplies the real one).
- Produces: `export function IntakeView(props: { attachments?: AttachmentPort; formats: string[]; configured: boolean }): JSX.Element`

- [ ] **Step 1: `IntakeLanding.tsx` — the welcome, on the chat's stage**

```tsx
import { useRef } from "react";
import { LandingStage } from "../chat/LandingStage.js";

/**
 * The first thing an empty vault shows.
 *
 * Same shape as the chat's landing — `LandingStage` anchors the block so the
 * primary control's centre sits at 53% of the pane with the glow under it —
 * because two different centrepieces in one app is how a product starts to look
 * assembled rather than designed.
 */
export function IntakeLanding({
  vaultName,
  onStart,
  configured,
}: {
  vaultName: string;
  onStart: () => void;
  configured: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <LandingStage
      anchorRef={buttonRef}
      tail={
        configured ? undefined : (
          <p
            className="mt-4 text-xs"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Conversion is not configured on this vault yet. Set{" "}
            <code>CONVERT_SERVICE_URL</code> and restart the Switchboard.
          </p>
        )
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          Welcome to {vaultName}
        </h1>
        <p
          className="max-w-md text-sm"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          It is empty. Add your first sources — bring in a document and the
          vault turns it into sources you can read, review and process.
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={onStart}
          disabled={!configured}
          className="intake-primary mt-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-hover)",
            border: "1px solid var(--bai-border)",
            color: "var(--bai-accent)",
          }}
        >
          Add sources
        </button>
      </div>
      <style>{`
        .intake-primary:hover:not(:disabled) {
          border-color: var(--bai-accent);
        }
      `}</style>
    </LandingStage>
  );
}
```

- [ ] **Step 2: `UploadSurface.tsx` — pick or drop, and the refusals**

```tsx
import { useRef, useState } from "react";
import { validateFile } from "../../lib/intake-model.js";

/**
 * The picker and its drop zone.
 *
 * `accept` is built from the server's own `formats` rather than a copy of them,
 * and the size/extension check runs here so a file the service would refuse
 * never costs an upload.
 */
export function UploadSurface({
  formats,
  onFiles,
}: {
  formats: string[];
  onFiles: (
    files: { name: string; size: number; mimeType: string; data: Uint8Array }[],
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  async function accept(list: FileList | null) {
    if (!list) return;
    const accepted: Parameters<typeof onFiles>[0] = [];
    const rejected: string[] = [];

    for (const file of Array.from(list)) {
      const verdict = validateFile(
        { name: file.name, size: file.size },
        formats,
      );
      if (!verdict.ok) {
        rejected.push(`${file.name}: ${verdict.reason}`);
        continue;
      }
      accepted.push({
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }

    setRefused(rejected);
    if (accepted.length > 0) onFiles(accepted);
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void accept(e.dataTransfer.files);
        }}
        className="intake-drop rounded-2xl px-6 py-10 text-center"
        style={{
          border: `1px dashed ${over ? "var(--bai-accent)" : "var(--bai-border)"}`,
          backgroundColor: "var(--bai-surface)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--bai-text-secondary)" }}>
          Drop documents here, or
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="intake-primary mt-2 rounded-lg px-3 py-1.5 text-sm font-medium"
          style={{
            backgroundColor: "var(--bai-hover)",
            border: "1px solid var(--bai-border)",
            color: "var(--bai-accent)",
          }}
        >
          choose files
        </button>
        <p
          className="mt-3 text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {formats.length} formats · up to 30 MB each · several at once is fine
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={formats.map((f) => `.${f}`).join(",")}
          onChange={(e) => void accept(e.target.files)}
        />
      </div>

      {refused.length > 0 && (
        <ul className="mt-3 space-y-1">
          {refused.map((line) => (
            <li
              key={line}
              className="text-xs"
              style={{ color: "var(--bai-text-muted)" }}
            >
              {line}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .intake-drop { transition: border-color 120ms ease; }
        .intake-primary:hover { border-color: var(--bai-accent); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: `ConversionQueue.tsx` — Tier 1 progress, and only what is measured**

```tsx
import type { IntakeFile } from "../../lib/intake-model.js";
import { Spinner } from "../LoadingStates.js";

const LABEL: Record<IntakeFile["state"], string> = {
  queued: "Waiting",
  converting: "Converting…",
  converted: "Converted",
  failed: "Failed",
};

/**
 * One row per file. Elapsed time, never a percentage: the conversion is a single
 * blocking call, so a bar would be invented. Ticking the seconds is the honest
 * version of "live progress" until the service can report pages (spec §9).
 */
export function ConversionQueue({
  files,
  onOpen,
  onRetry,
}: {
  files: IntakeFile[];
  onOpen: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const dot: Record<IntakeFile["state"], string> = {
    queued: "var(--bai-text-faint)",
    converting: "var(--bai-accent)",
    converted: "#34d399",
    failed: "#f87171",
  };

  return (
    <ul className="mx-auto w-full max-w-2xl space-y-1">
      {files.map((file) => (
        <li
          key={file.id}
          className="intake-row flex items-center gap-3 rounded-lg px-3 py-2"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: dot[file.state] }}
          />
          <span
            className="min-w-0 flex-1 truncate text-xs"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            {file.name}
          </span>

          {file.state === "converting" && <Spinner className="h-3 w-3" />}
          <span
            className="shrink-0 text-[11px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {LABEL[file.state]}
            {file.converted
              ? ` · ${file.converted.sections.length} parts${
                  file.converted.plan.mergedSections > 0
                    ? ` (${file.converted.plan.mergedSections} folded)`
                    : ""
                }`
              : ""}
            {file.error ? ` · ${file.error}` : ""}
          </span>

          {file.state === "converted" && (
            <button
              type="button"
              onClick={() => onOpen(file.id)}
              className="intake-link shrink-0 text-[11px] font-medium"
              style={{ color: "var(--bai-accent)" }}
            >
              Review
            </button>
          )}
          {file.state === "failed" && (
            <button
              type="button"
              onClick={() => onRetry(file.id)}
              className="intake-link shrink-0 text-[11px] font-medium"
              style={{ color: "var(--bai-accent)" }}
            >
              Retry
            </button>
          )}
        </li>
      ))}
      <style>{`
        .intake-row:hover { background-color: var(--bai-hover); }
        .intake-link:hover { text-decoration: underline; }
      `}</style>
    </ul>
  );
}
```

- [ ] **Step 4: `SectionReview.tsx` — the editable list, the preview, and the file's own settings**

> **Design gate outcome (2026-09-17, `docs/design/intake/final.html`):** the approved shape is the blend — rows grouped by what they need from the user (_Needs you_ / _Converting_ / _In the vault_), a four-step **journey strip** on every row (Chosen → Converted → Reviewed → In the vault), a goal header with a segmented batch bar and an always-present drop zone for file N+1, the review pane beside the list (never instead of it) headed "Step 3 of 4", one accent-filled CTA per screen, and after publish a green row naming `/sources/<folder>/` with links to Sources and Pipeline. **Each section row carries a chevron that opens a rendered preview of `section.content`** (use `markdown-preview.tsx`; collapsed to ~220 px with a "Show all N chars" toggle; a line under it says whether the part is ticked). The code below is the pre-gate sketch and must be brought to that shape: add the `open` state per section, the preview block, the `contains:` line, the furniture reason on unticked rows, and the `SectionReader` overlay (`readerIndex: number | null` in the panel's state; ←/→/Esc handled while it is open).

```tsx
import {
  SECTION_TYPES,
  selectedCount,
  type IntakeFile,
} from "../../lib/intake-model.js";

/**
 * What this file would become. Every section ticked by default, because the
 * section rule already folded and split; this is where the user disagrees, not
 * where they assemble the result by hand.
 */
export function SectionReview({
  file,
  onToggle,
  onAll,
  onType,
  onFolderName,
  onPublish,
  publishing,
  driveId,
}: {
  file: IntakeFile;
  onToggle: (index: number) => void;
  onAll: (on: boolean) => void;
  onType: (type: string) => void;
  onFolderName: (name: string) => void;
  onPublish: () => void;
  publishing: boolean;
  driveId: string | undefined;
}) {
  const sections = file.converted?.sections ?? [];
  const chosen = selectedCount(file);

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {file.name}
        </h2>
        <span
          className="text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {chosen} of {sections.length} parts selected
        </span>
        <button
          type="button"
          onClick={() => onAll(true)}
          className="intake-link text-[11px]"
          style={{ color: "var(--bai-accent)" }}
        >
          select all
        </button>
        <button
          type="button"
          onClick={() => onAll(false)}
          className="intake-link text-[11px]"
          style={{ color: "var(--bai-accent)" }}
        >
          select none
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          className="flex items-center gap-2 text-[11px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Source type
          <select
            value={file.sourceType}
            onChange={(e) => onType(e.target.value)}
            className="rounded-md px-2 py-1 text-[11px]"
            style={{
              backgroundColor: "var(--bai-bg)",
              border: "1px solid var(--bai-border)",
              color: "var(--bai-text-secondary)",
            }}
          >
            {SECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex items-center gap-2 text-[11px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Folder
          <span style={{ color: "var(--bai-text-faint)" }}>/sources/</span>
          <input
            value={file.folderName}
            onChange={(e) => onFolderName(e.target.value)}
            className="intake-input rounded-md px-2 py-1 text-[11px]"
            style={{
              backgroundColor: "var(--bai-bg)",
              border: "1px solid var(--bai-border)",
              color: "var(--bai-text-secondary)",
            }}
          />
        </label>
      </div>

      <ul className="space-y-1">
        {sections.map((section, index) => (
          <li key={index}>
            <label
              className="intake-row flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <input
                type="checkbox"
                checked={file.selected[index] === true}
                onChange={() => onToggle(index)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-xs font-medium"
                  style={{ color: "var(--bai-text-secondary)" }}
                >
                  {section.title || `part ${index + 1}`}
                </span>
                <span
                  className="block truncate text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {section.headingPath.join(" › ") || "no heading"} ·{" "}
                  {section.charCount.toLocaleString()} chars
                  {section.markdownRange ? "" : " · from text"}
                </span>
                {section.mergedFrom.length > 1 && (
                  // What the section rule folded in — the titles a reader would
                  // otherwise never see, and the reason the section is named as it is.
                  <span
                    className="block truncate text-[10px]"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    contains:{" "}
                    {section.mergedFrom.map((p) => p.title).join(" · ")}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={
            chosen === 0 ||
            publishing ||
            !driveId ||
            file.publishedIds !== undefined
          }
          onClick={onPublish}
          className="intake-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-hover)",
            border: "1px solid var(--bai-border)",
            color: "var(--bai-accent)",
          }}
        >
          {publishing
            ? "Adding…"
            : file.publishedIds
              ? `Added ${file.publishedIds.length} source${file.publishedIds.length === 1 ? "" : "s"}`
              : `Add ${chosen} source${chosen === 1 ? "" : "s"} to the vault`}
        </button>
        <span
          className="text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {file.publishedIds
            ? "Already in the vault — publishing again would create duplicates"
            : "Queued for processing as soon as they are created"}
        </span>
      </div>

      <style>{`
        .intake-row:hover { background-color: var(--bai-hover); }
        .intake-link:hover { text-decoration: underline; }
        .intake-input:focus, select:focus { border-color: var(--bai-accent); outline: none; }
        .intake-primary:hover:not(:disabled) { border-color: var(--bai-accent); }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 5: `hooks/use-intake-batch.ts` + `IntakePanel.tsx` — the batch, hoisted**

> **Superseded shape (placement change):** the code below was written as a standalone `IntakeView` owning its state. Split it: everything stateful (`files`, `bytes`, `running`, the scheduling effect, `onFiles`, `onRetry`, `onPublish`, and a derived `needsUser = files.filter(f => f.state === "review-ready" || f.state === "failed").length` — "review-ready" meaning converted and not yet published) moves into `useIntakeBatch()`; the JSX becomes `IntakePanel` taking the hook's return as props. `DriveExplorer` calls the hook once and passes the result to `SourceList`, which renders `IntakePanel` above the folder list. The four stages collapse into two: the panel is either the landing/drop zone (empty batch) or the batch with the review pane beside it (rows grouped _Needs you / Converting / In the vault_, each with a journey strip — see the design-gate outcome under step 4).

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import {
  addFiles,
  markPublished,
  nextQueued,
  setAllSections,
  setState,
  toggleSection,
  type IntakeFile,
} from "../../lib/intake-model.js";
import {
  convertFile,
  publishFile,
  type AttachmentPort,
} from "../../lib/intake-service.js";
import { createVaultApi } from "../../lib/vault-api.js";
import { useVaultName } from "../../hooks/use-vault-name.js";
import { IntakeLanding } from "./IntakeLanding.js";
import { UploadSurface } from "./UploadSurface.js";
import { ConversionQueue } from "./ConversionQueue.js";
import { SectionReview } from "./SectionReview.js";

type Stage = "landing" | "upload" | "batch" | "review";

/**
 * The intake view: one batch, four stages.
 *
 * The batch is converted **one file at a time** on purpose. The service's warm
 * pipeline is single-threaded and queues overlapping calls in submission order,
 * so converting in parallel would only reorder work inside the engine while
 * making this component's progress a lie.
 */
export function IntakeView({
  formats,
  configured,
  attachments,
}: {
  formats: string[];
  configured: boolean;
  attachments?: AttachmentPort;
}) {
  const driveId = useSelectedDriveId();
  const vaultName = useVaultName();
  const api = useRef(createVaultApi()).current;
  const bytes = useRef(new Map<string, Uint8Array>());
  const running = useRef(false);

  const [stage, setStage] = useState<Stage>("landing");
  const [files, setFiles] = useState<IntakeFile[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  // The batch runs itself: whenever a file is queued and nothing is converting,
  // take the next one. Single-flight by `running`, not by state, so a re-render
  // cannot start two.
  useEffect(() => {
    if (running.current) return;
    const next = nextQueued(files);
    if (!next) return;
    const data = bytes.current.get(next.id);
    if (!data) return;

    running.current = true;
    setFiles((current) =>
      setState(current, next.id, {
        state: "converting",
        startedAt: Date.now(),
      }),
    );

    void convertFile({ name: next.name, bytes: data }, { api })
      .then((converted) =>
        setFiles((current) =>
          setState(current, next.id, {
            state: "converted",
            converted,
            finishedAt: Date.now(),
          }),
        ),
      )
      .catch((error: unknown) =>
        setFiles((current) =>
          setState(current, next.id, {
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      )
      .finally(() => {
        running.current = false;
        // Nudge the effect: state changed, but a queued file may remain.
        setFiles((current) => [...current]);
      });
  }, [files, api]);

  const onFiles = useCallback(
    (
      incoming: {
        name: string;
        size: number;
        mimeType: string;
        data: Uint8Array;
      }[],
    ) => {
      const additions = incoming.map(({ name, size, mimeType }) => ({
        name,
        size,
        mimeType,
      }));
      setFiles((current) => {
        const next = addFiles(current, additions);
        // `addFiles` mints the ids; pair each new id with the bytes, in order.
        const fresh = next.slice(current.length);
        fresh.forEach((file, index) =>
          bytes.current.set(file.id, incoming[index].data),
        );
        return next;
      });
      setStage("batch");
    },
    [],
  );

  const onRetry = useCallback((id: string) => {
    setFiles((current) =>
      setState(current, id, { state: "queued", error: undefined }),
    );
  }, []);

  const onPublish = useCallback(async () => {
    const file = files.find((f) => f.id === openId);
    const data = file ? bytes.current.get(file.id) : undefined;
    // A published row stays visible for its message but never publishes twice:
    // `POST sources` is not idempotent on content.
    if (!file || !data || !driveId || file.publishedIds) return;

    setPublishing(true);
    try {
      const result = await publishFile(file, data, {
        api,
        attachments,
        driveId,
      });
      setPublished(
        `${result.sourceIds.length} source${result.sourceIds.length === 1 ? "" : "s"} added to /sources/${file.folderName}${
          result.skipped > 0
            ? ` (${result.skipped} empty part${result.skipped === 1 ? "" : "s"} skipped)`
            : ""
        }${result.attached ? ", original attached" : ""}`,
      );
      setFiles((current) => markPublished(current, file.id, result.sourceIds));
      setOpenId(null);
      setStage("batch");
    } catch (error) {
      setPublished(
        `Could not add the sources: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPublishing(false);
    }
  }, [api, attachments, driveId, files, openId]);

  const open = files.find((f) => f.id === openId) ?? null;

  return (
    <div className="h-full overflow-auto px-6 py-8">
      {/* The tab must stay open: an in-flight conversion lives here and nowhere
          else, so a reload loses it. Said once, where the batch starts. */}
      {stage === "batch" &&
        files.some((f) => f.state === "converting" || f.state === "queued") && (
          <p
            className="mx-auto mb-4 w-full max-w-2xl text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Keep this tab open until the conversion finishes — the work is not
            saved anywhere yet.
          </p>
        )}

      {published && (
        <p
          className="mx-auto mb-4 w-full max-w-2xl text-xs"
          style={{ color: "var(--bai-accent)" }}
        >
          {published}
        </p>
      )}

      {stage === "landing" && (
        <IntakeLanding
          vaultName={vaultName}
          configured={configured}
          onStart={() => setStage("upload")}
        />
      )}

      {stage === "upload" && (
        <UploadSurface formats={formats} onFiles={onFiles} />
      )}

      {stage === "batch" && (
        <ConversionQueue
          files={files}
          onOpen={(id) => {
            setOpenId(id);
            setStage("review");
          }}
          onRetry={onRetry}
        />
      )}

      {stage === "review" && open && (
        <SectionReview
          file={open}
          driveId={driveId}
          publishing={publishing}
          onToggle={(index) =>
            setFiles((current) => toggleSection(current, open.id, index))
          }
          onAll={(on) =>
            setFiles((current) => setAllSections(current, open.id, on))
          }
          onType={(type) =>
            setFiles((current) =>
              setState(current, open.id, { sourceType: type }),
            )
          }
          onFolderName={(name) =>
            setFiles((current) =>
              setState(current, open.id, { folderName: name }),
            )
          }
          onPublish={() => void onPublish()}
        />
      )}

      {stage === "review" && (
        <button
          type="button"
          onClick={() => setStage("batch")}
          className="mx-auto mt-4 block text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          ← back to the batch
        </button>
      )}
    </div>
  );
}
```

`SECTION_TYPES` comes from `intake-model.ts` (Task 3), so the select cannot
drift from what `POST sources` will accept.

- [ ] **Step 6: Wire it into `DriveExplorer.tsx` and `SourceList.tsx`**

> **Superseded (placement change):** no `ViewMode` union change, no `TABS` entry, no content-switch branch. Instead: (1) `const batch = useIntakeBatch();` in `DriveExplorer`; (2) the existing Sources `TABS` entry gets `badge: batch.needsUser > 0 ? batch.needsUser : undefined` — rendered in the warn colour, not the accent, so it reads as "needs you" and not as a count; (3) `<SourceList … intake={batch} />`; (4) the empty-vault default becomes `setViewMode("sources")`, and `SourceList`'s empty state renders `<IntakeLanding>`. The `fileNodes` check below still applies to (4). The edits listed under 1–4 below are kept only for the `useConvertHealth` hook and the empty-vault rule.

1. The union (`:40`):

```ts
type ViewMode =
  | "chat"
  | "notes"
  | "graph"
  | "sources"
  | "projects"
  | "scope"
  | "search"
  | "activity"
  | "pipeline"
  | "health"
  | "access"
  | "config"
  | "intake";
```

2. The import and the empty-vault default, beside the existing state:

```tsx
import { IntakeView } from "./intake/IntakeView.js";
import { useConvertHealth } from "../hooks/use-convert-health.js";

const [viewMode, setViewMode] = useState<ViewMode>("chat");
// An empty vault opens on intake; everything else opens on chat, as before.
// "Empty" is a claim about the *server*: useDriveInit already learned that an
// unreadable tree is not an empty one, so this waits for both reads to settle
// and treats an unreadable tree as "not empty" rather than as "new".
const convert = useConvertHealth();
// CHECK FIRST (gap 7): the drive app scaffolds twelve folders on first open.
// If `fileNodes` (from `useFileNodesInSelectedDrive`) includes folder nodes,
// an empty vault is never "empty" and this landing never shows. Verify what it
// holds; if folders are present, count only nodes that carry a `documentType`.
const documentNodes = fileNodes.filter((n) => Boolean(n.documentType));
const settled = !notesLoading && convert.settled;
const vaultIsEmpty =
  settled && documentNodes.length === 0 && notes.length === 0;
const landedOn = useRef(false);
useEffect(() => {
  if (!landedOn.current && vaultIsEmpty) {
    landedOn.current = true;
    setViewMode("intake");
  }
}, [vaultIsEmpty]);
```

3. The `TABS` entry, after `sources`:

```tsx
{
  key: "intake",
  label: "Add sources",
  icon: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  ),
},
```

4. The content switch, before the `notes` fallback:

```tsx
) : viewMode === "intake" ? (
  <IntakeView
    formats={convert.formats}
    configured={convert.configured}
    attachments={attachments}
  />
) : (
  <NoteList notes={notes} isLoading={notesLoading} />
)}
```

- [ ] **Step 7: `hooks/use-convert-health.ts` — the formats, and whether intake can run**

```ts
import { useEffect, useState } from "react";
import { createVaultApi } from "../lib/vault-api.js";

type ConvertHealth = {
  configured: boolean;
  ok: boolean;
  ready: boolean;
  backend: string | null;
  formats: string[];
  missing: string[];
};

/**
 * What the conversion service can do, read once per mount.
 *
 * The formats drive the picker's `accept` — a hard-coded list would drift from
 * what the service actually reads, and an unconfigured vault should not offer a
 * picker that fails. `GET convert/health` deliberately answers 200 with
 * `configured: false` rather than 503, so the vault is never reported broken.
 */
export function useConvertHealth() {
  const [health, setHealth] = useState<ConvertHealth | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const api = createVaultApi();
    let cancelled = false;
    api
      .get<ConvertHealth>("/convert/health")
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        setHealth(result);
        setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    settled,
    configured: health?.configured === true && health?.ready === true,
    formats: health?.formats ?? [],
    missing: health?.missing ?? [],
  };
}
```

`VaultApi.get` is defined and tested in Task 2.

- [ ] **Step 8: The copy in `GettingStarted.tsx`**

The quick-start's first step becomes:

```tsx
<Step n={1} title="Add a source">
  Bring a document in — click &quot;Add sources&quot; in the top bar and drop a
  PDF, Word file, markdown or one of the other formats. The vault converts it
  and shows you the sources it would create before anything is written. Or paste
  raw text into a source if it is short.
</Step>
```

- [ ] **Step 9: The whole gate**

```bash
bun run test          # the new lib tests, and every existing test
bun run tsc
bun run lint          # exit 0, no error lines
bun run test:coverage # thresholds still met repo-wide
```

- [ ] **Step 10: Commit**

```bash
git add editors/knowledge-vault/components/intake editors/knowledge-vault/components/DriveExplorer.tsx editors/knowledge-vault/components/GettingStarted.tsx editors/knowledge-vault/hooks/use-convert-health.ts editors/knowledge-vault/lib
git commit -m "feat(intake): the view — landing, upload, convert queue, section review"
```

---

### Task 9: The original file, where a source can be opened

**Files:**

- Create: `editors/knowledge-vault/lib/attachments.ts`
- Create: `editors/knowledge-vault/components/OriginalFilePanel.tsx`
- Modify: `editors/source-editor/editor.tsx`
- Modify: `editors/knowledge-vault/components/intake/IntakeView.tsx` (pass the real port)

**Interfaces:**

- Consumes: `AttachmentPort` (Task 7); `isBrowserRenderable` / `formatFileSize` (Task 5); `SourceState["originalFile"]` and the other five fields (the model change, already dispatched).
- Produces:
  - `createAttachmentPort(): AttachmentPort` — the real implementation.
  - `export function OriginalFilePanel(props: { source: { originalFile?: string | null; originalFileName?: string | null; originalMimeType?: string | null; originalSizeBytes?: number | null; convertedBy?: string | null } }): JSX.Element | null`

- [ ] **Step 1: Read the reference implementation before writing any of it**

There is a proven implementation in this workspace. Read these four files in
full before typing:

```
../umh/umh-production-ledger/editors/production-ledger-editor/lib/attachments.ts
../umh/umh-production-ledger/editors/production-ledger-editor/lib/useFileUpload.ts
../umh/umh-production-ledger/editors/production-ledger-editor/lib/useAttachmentViewer.ts
../umh/umh-production-ledger/editors/production-ledger-editor/lib/mime.ts
```

Port `attachments.ts` almost verbatim into `lib/attachments.ts`, then wrap it in
our own interface:

```ts
import { ... } from "./attachments-port-internals.js"; // however the port lands

/**
 * The real attachment port: `prepare` is the content-addressed ref, `upload`
 * sends the bytes. Split in two because the ref is known before the upload —
 * the source can exist and be opened while 30 MB is still streaming (convert
 * spec §12.1).
 */
export function createAttachmentPort(): AttachmentPort { /* ported */ }
```

**One change from the ledger, and it is the point of the port:** the ledger
hard-codes `"application/pdf"` when the response has no mime type. A vault
source may be any of 29 formats, so the panel keeps whatever type it has and
falls back to downloading, via `isBrowserRenderable`.

- [ ] **Step 2: `OriginalFilePanel.tsx`**

Four states, all reachable and all different to the user:

| state           | what it shows                                                          |
| --------------- | ---------------------------------------------------------------------- |
| no original     | nothing (an older source is still valid — all six fields are nullable) |
| renderable mime | the file inline — PDF, text, markdown, image, audio, video             |
| not renderable  | a card: name, `formatFileSize(size)`, the type, and **Download**       |
| fetch failed    | an explicit failure with **Retry** — never the same as "there is none" |

```tsx
import { useEffect, useState } from "react";
import { formatFileSize, isBrowserRenderable } from "../lib/mime.js";

/**
 * The document a source was made from.
 *
 * `convertedBy` is shown because a reader is entitled to know what produced the
 * text they are reading — and because a source with no original must be visibly
 * different from one whose original could not be fetched.
 */
export function OriginalFilePanel({
  source,
  load,
}: {
  source: {
    originalFile?: string | null;
    originalFileName?: string | null;
    originalMimeType?: string | null;
    originalSizeBytes?: number | null;
    convertedBy?: string | null;
  };
  load: (ref: string) => Promise<{ url: string; mimeType: string }>;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; url: string; mimeType: string }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  const ref = source.originalFile ?? null;
  const mime = source.originalMimeType ?? "application/octet-stream";
  const name = source.originalFileName ?? "original";
  const renderable = isBrowserRenderable(mime);

  useEffect(() => {
    if (!ref || !renderable) return;
    let cancelled = false;
    setState({ kind: "loading" });
    load(ref)
      .then((result) => {
        if (!cancelled) setState({ kind: "ready", ...result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ref, renderable, load]);

  if (!ref) return null;

  return (
    <section
      className="original-panel rounded-xl p-3"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <header className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {name}
        </span>
        <span
          className="shrink-0 text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {mime}
          {source.originalSizeBytes
            ? ` · ${formatFileSize(source.originalSizeBytes)}`
            : ""}
          {source.convertedBy ? ` · converted by ${source.convertedBy}` : ""}
        </span>
        {!renderable && (
          <button
            type="button"
            onClick={() =>
              void load(ref).then((r) => window.open(r.url, "_blank"))
            }
            className="original-link shrink-0 text-[11px] font-medium"
            style={{ color: "var(--bai-accent)" }}
          >
            Download
          </button>
        )}
      </header>

      {renderable && state.kind === "loading" && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          Loading the original…
        </p>
      )}

      {renderable && state.kind === "failed" && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          The original could not be fetched: {state.message}{" "}
          <button
            type="button"
            className="original-link"
            style={{ color: "var(--bai-accent)" }}
            onClick={() => setState({ kind: "idle" })}
          >
            Retry
          </button>
        </p>
      )}

      {renderable && state.kind === "ready" && mime.includes("pdf") && (
        <iframe
          title={name}
          src={state.url}
          className="mt-2 h-[520px] w-full rounded"
        />
      )}
      {renderable && state.kind === "ready" && !mime.includes("pdf") && (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="original-link mt-2 block text-[11px]"
          style={{ color: "var(--bai-accent)" }}
        >
          Open the original in a new tab
        </a>
      )}

      <style>{`
        .original-link:hover { text-decoration: underline; }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 3: Render it in the source editor**

In `editors/source-editor/editor.tsx`, above the content tabs, for a source that
has an original:

```tsx
{
  doc.state.global.originalFile && (
    <OriginalFilePanel source={doc.state.global} load={loadOriginal} />
  );
}
```

`loadOriginal` comes from the same attachment viewer the ledger uses (its
`useAttachmentViewer`), installed at mount as the convert spec §12.1 describes:
the editor sets its own attachment service pointed at the paired Switchboard,
because Connect only provides one when a default drive is configured.

- [ ] **Step 4: The intake uses the real port**

In `DriveExplorer.tsx`, pass `attachments={createAttachmentPort()}` into
`<IntakeView …>` — created once, not per render.

- [ ] **Step 5: The gate, then commit**

```bash
bun run test editors/knowledge-vault/lib/mime.test.ts   # the rule the panel obeys
bun run tsc && bun run lint
git add editors/knowledge-vault/lib/attachments.ts editors/knowledge-vault/components/OriginalFilePanel.tsx editors/knowledge-vault/components/intake/IntakeView.tsx editors/knowledge-vault/components/DriveExplorer.tsx editors/source-editor/editor.tsx
git commit -m "feat(intake): keep the original, and open it when a browser can"
```

---

### Task 10: The acceptance test — the real book, through the UI

Everything before this is unit-tested; this is the only step that proves the flow
against the live vault with the document that has been the test case throughout.

**Files:** none. This is a verification task; its output is evidence.

**Interfaces:**

- Consumes: the running app, the running Switchboard, and the convert subgraph's health route.
- Produces: evidence — the measured conversion time, the section count, and the five properties every created source must satisfy.

- [ ] **Step 1: Confirm the two services are up and honest**

```bash
cd ~/Documents/Powerhouse/bai-knowledge-note
TOKEN=$(ph access-token | tr -d '\n')
curl -s -H "authorization: Bearer $TOKEN" \
  "http://localhost:4001/api/@powerhousedao/knowledge-note/convert/health" | python3 -m json.tool
```

Expected: `configured: true`, `ready: true`, `formats` with 29 entries. If
`configured: false`, `CONVERT_SERVICE_AUTOSTART` is missing from `.env` — that is
the whole diagnosis.

- [ ] **Step 2: Run the flow on the 238-page book, and time it**

In the app: an empty vault (or `+New` → the Add sources tab), drop the book, and
let it convert. **Measured expectation: about 5 m 33 s** for that document
(convert 160 s + chunk 173 s through the subgraph). Anything much faster means it
did not convert the whole file.

- [ ] **Step 3: The review shows real structure, and the selection works**

Expected for the book: **117 sections** with `minSectionChars` applied (the
contiguous-run rule; 106 under the old keyed grouping), chapter titles such as
`Emotion`, `Wayfinding`, `Revealing Words`; `Praise for …` and `[ contents ]`
present but **unticked** by default; merged rows show "contains: …"; unticking
one more and adding the rest creates one fewer source. After publish, the row
reads "Added N sources" and the button is disabled — a second click must not
create a second set.

- [ ] **Step 4: Verify what landed, from the server, not from the screen**

```bash
DRIVE=$(cat .ph/vetra-runtime.json | python3 -c "import json,sys; print(json.load(sys.stdin)['projectName'])") # for reference only
# The folder and its contents, read back from the drive:
curl -s -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"query($id:String!){document(identifier:$id){document{state}}}"}' \
  "http://localhost:4001/graphql" >/dev/null  # the drive id is the one selected in the app
```

Assert, per created source:

- exactly **one** new folder under `/sources`, named after the document;
- the number of sources equals the number of ticked sections;
- every source's `parentFolder` is that folder (not the drive root — an orphaned
  source answers `findDocuments` while appearing in no drive, which is the state
  nine test sources are already in);
- every source's `status` is `EXTRACTING`, and the pipeline queue holds a task
  per source with `documentRef` = that source;
- every source has `originalFile` set, and the same ref for all of them, with
  `convertedBy: "docling.rs"`;
- a source whose section held a table (the CV's _Education_, or any book table)
  has that table as a **markdown table** in `content` — not `🟤, 1 = …` triplets.

The fastest reliable way to check the last four is the vault's own REST surface
(`GET sources/:id` style reads, or the Switchboard CLI skill's document read),
not a screenshot.

- [ ] **Step 5: Open a source and open its original**

The Sources view shows the new folder with a status tally ("12 extracting"); a
source opens with the original available — PDF inline, a `.docx` as a card with
a working Download.

- [ ] **Step 6: The failure path, on purpose**

Stop the conversion service (`fuser -k 5011/tcp`, or kill the child of the
Switchboard) and:

- the landing says conversion is unavailable and does not offer a dead picker;
- a file row reports the failure with the server's message, and Retry works once
  the service is back.

- [ ] **Step 7: Record what happened**

Append the measured numbers to the spec's §9 (the Tier 1/Tier 2 decision is
easier to revisit with the real timings in hand), then commit the spec.

---

## Self-review

Against the spec, section by section:

| spec §                           | where it is implemented                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3 decisions 1–5                 | Task 4 (folder per document, sanitisable), Task 8 (selection UI), Task 7 (`queue: true`), Task 8 (per-file type selector), Task 8 step 6 (the keep-the-tab-open notice) |
| §4 architecture / the call table | Tasks 2, 6, 7 — every call in the table has a task step                                                                                                                 |
| §5 contracts                     | Task 2 builds the helper; Tasks 6–7 consume the routes; Task 7 defines the attachment port the panel and the intake share                                               |
| §6 the empty-vault landing       | Task 8 steps 1 and 6, including the "unreadable tree is not an empty tree" rule                                                                                         |
| §7 the review step               | Task 8 steps 4–5                                                                                                                                                        |
| §8 publish                       | Task 7, with the ordering rule asserted                                                                                                                                 |
| §9 progress                      | Task 8 step 3 (Tier 1 only; no invented percentage)                                                                                                                     |
| §10 styling                      | Task 1 (the token block is copied from the live theme), Task 8 (tokens inline, Tailwind for layout, scoped `<style>` blocks)                                            |
| §11 error states                 | Task 5 (the mime rule), Task 8 (validation, failures, retry), Task 9 (the failed-fetch state)                                                                           |
| §12 not in this plan             | nothing in the plan implements it — Tiers 2, section editing, OS drag-and-drop, per-part subfolders, replacing an original                                              |
| §13 open questions               | left open deliberately; Task 10 step 7 is where the evidence for them gets recorded                                                                                     |
| §14 testing                      | every `lib/` module has a test file in its own task; no component is tested, matching the repo                                                                          |

**Placeholder scan:** every code step carries the code. The two forward
references — `SECTION_TYPES` (Task 3) and `VaultApi.get` (Task 2) — are stated
with their exact definitions where they belong, and Task 8 says which import to
fix and which dead line to delete.

**Type consistency:** `IntakeFile`, `ConvertedFile`, `Section` (with `content`,
`mergedFrom`, `markdownRange`), `SectionPlanSummary`, `PublishPlan`,
`AttachmentPort`, `PublishResult` and `VaultApi` (with `get`) are defined once
(Tasks 3, 4, 2) and used with the same names and shapes in Tasks 6–9. `folderNameFor` lives in
`intake-model.ts` (Task 3) and is consumed by `publishPlan` (Task 4) — one
derivation, not two.

## Progress that is measured, and the extraction score (2026-09-18)

The row used to say "Converted" with a spinner while the file was still
converting. Two fixes: the journey labels are now tense-correct (`Converting…`
while it happens, `Converted` once done — `JourneyStrip.tsx`), and the spinner
is replaced by **measured progress**. `use-intake-batch.ts` mints a
`crypto.randomUUID()` job per conversion, sends it as `?job=`, and polls
`GET convert/progress/:job` every second while the row is `converting`;
`FileRow.tsx` renders the phase (`reading page 12 of 23`, `structuring the
text`, `reading the text layer`, `recognising text (OCR)`) and a thin bar
during `reading` only — the chunking phase has no page signal, so the bar
stops at full and the words change rather than a second bar being invented.
`IntakeFile.progress` holds the last poll; `conversionProgress()` in
`intake-service.ts` maps the 404 (job forgotten) to `null`.

The **extraction score** arrives on `ConvertedFile.quality` and is shown twice:
the review header (`Extraction: 96.9% of the file's text is here · 79 of 79
formulas not decoded · 3 figures not transcribed`, amber under 95 %, with a
tooltip saying it is a floor, not a proof) and the ready line on the row
(`· 97% of the text`). It is not persisted on the `bai/source` — that would be
a schema change, not approved. Formula decoding (docling's
`doFormulaEnrichment`, models present, cost unmeasured on the warm pipeline)
and a semantic score are deferred.

## Execution handoff

The plan's owner works **inline, in one session, with no subagents** — so the
sub-agent option is not offered here. Execute with
`superpowers:executing-plans`, task by task, and stop for review after Task 1
(the design gate) and again after Task 8 (the view is visible in the app for the
first time). Nothing is committed to the branch without the owner's say-so,
matching how the convert work was handled.
