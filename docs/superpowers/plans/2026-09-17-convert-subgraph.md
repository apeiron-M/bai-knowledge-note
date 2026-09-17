# Convert Subgraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `subgraphs/convert` subgraph to `bai-knowledge-note` that converts any document to markdown plus a source-shaped section plan, backed by an out-of-process conversion service, without writing a single document.

**Architecture:** The service knows formats; the subgraph knows the vault. `scripts/docling-serve/` is a local Bun service over the `docling.rs` native binding — `POST /convert` takes bytes, returns markdown and docling's chunk structure. `subgraphs/convert` proxies it over HTTP via `CONVERT_SERVICE_URL`, derives **sections** from the chunk structure with `deriveSections()`, and answers a read-only preview. Creation of `bai/source` documents is a *later* plan and a *separate* route.

**Tech Stack:** TypeScript (`nodenext`, `strict`, `verbatimModuleSyntax`), Bun, `@powerhousedao/reactor-api` `BaseSubgraph` + `IHttpScope`, `docling.rs@1.55.0` (N-API, `linux-x64-gnu`), vitest, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-09-17-convert-subgraph-design.md` — the plan argues from the spec; where they disagree the spec wins, except for the measured numbers in Task 7, which feed back into §11 of the spec.

## Global Constraints

- Relative imports carry **`.js`** (e.g. `./sections.js`). `"module": "nodenext"`.
- **No `@/*` alias.** Inside the subgraph use relative paths; from outside it, the existing `subgraphs/*` alias. Do not add aliases to `tsconfig.json`.
- `tsconfig.json` **includes `**/*`** — every new file is type-checked by `bun run tsc`, including `scripts/docling-serve/server.ts`.
- Tests are **colocated** `*.test.ts` beside the module (as `subgraphs/http/lib/` does); shared fakes come from `tests/helpers/`. Runner is **vitest** (`bun run test`); globals are on, but import `describe/expect/it` explicitly as the sibling tests do.
- **Coverage floor 95%** on lines, branches, functions and statements for anything under `subgraphs/convert/lib/**` — added to `vitest.config.ts`'s `include` in Task 6, matching `subgraphs/http/lib/**`.
- Every commit message is lowercase `type(scope): sentence`, matching the repo's log (`fix: …`, `feat: …`, `test: …`).
- Use **bun** for package management and running scripts. Do not introduce npm/yarn/pnpm.
- The subgraph's HTTP scope is namespaced to `/api/@powerhousedao/knowledge-note/`; never attempt to mount elsewhere.
- `POST convert` **creates nothing**. If a step seems to need a document write, it belongs in the follow-up plan.

---

### Task 1: The section rule

> **Status: implemented and verified** (`subgraphs/convert/lib/sections.{ts,test.ts}` — **12 tests passing**, `tsc` and lint clean). The committed file is the source of truth; this task keeps the reasoning.
>
> **The plan's rule was not sufficient, and the fix is measured.** Implementing rule 1 exactly and running it on the real 238-page book produced **290 sections** — more than one per page, the first twenty being the title page, `Praise for …`, `Revision History…`, `[ contents ]`, `[ SIDE NOTE ]` and `Warning`. That is the dilution the rule exists to prevent, arrived at by following the rule, because docling's heading list is flat (§6.2).
>
> So the implementation adds a second mechanism the plan did not have: **`SECTION_MIN_CHARS` (2 000) folds undersized sections into a neighbour** — forward normally, backward for a trailing one, and a whole document smaller than the floor collapses to one section named after it. Order is **group → fold → split**. `minSectionChars` is an option and `mergedSections` a reported count, so the Intake view can expose the dial rather than inherit one answer.
>
> Measured on the real function after the change: **238-page book 290 → 107 sections** (largest 12 770), 20-page sample → 10, CV → 2. The full dial table, and why 2 000 is the defensible default (furniture gone; only 4 of 107 sections read as boilerplate), is spec §6.1.
>
> Two test-side corrections worth recording: the cut-rule tests now pass `minSectionChars: 0` so each mechanism is tested on its own, and one test of mine was simply wrong — it expected a single 300-char chunk to split into three under a 100-char ceiling, which the implementation deliberately refuses (no smaller authored boundary exists). It now uses three paragraph-sized chunks per section.

**Files:**
- Create: `subgraphs/convert/lib/sections.ts`
- Test: `subgraphs/convert/lib/sections.test.ts`

**Interfaces:**
- Consumes: `SourceChunk` — the service's chunk shape, `{ text, headings?, docItems?, contextualized? }`.
- Produces: `deriveSections(chunks, { documentName, ceiling? }) → SectionPlan`, plus the `SECTION_CHAR_CEILING` constant. Consumed by Task 3's route.

- [ ] **Step 1: Write the failing test**

`subgraphs/convert/lib/sections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SECTION_CHAR_CEILING, deriveSections } from "./sections.js";

const chunk = (text: string, headings: string[] = []) => ({ text, headings });

describe("deriveSections", () => {
  it("cuts at depth 1 when three H1s divide the document", () => {
    const plan = deriveSections(
      [
        chunk("one", ["Record"]),
        chunk("two", ["Reduce"]),
        chunk("three", ["Reflect"]),
      ],
      { documentName: "Book" },
    );
    expect(plan.cutLevel).toBe(1);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Record",
      "Reduce",
      "Reflect",
    ]);
    expect(plan.sections[0].headingPath).toEqual(["Record"]);
  });

  it("falls to depth 2 when one H1 covers every chunk", () => {
    const plan = deriveSections(
      [
        chunk("a", ["Book", "Record"]),
        chunk("b", ["Book", "Reduce"]),
        chunk("c", ["Book", "Reflect"]),
      ],
      { documentName: "Book" },
    );
    expect(plan.cutLevel).toBe(2);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Record",
      "Reduce",
      "Reflect",
    ]);
    expect(plan.sections[0].headingPath).toEqual(["Book", "Record"]);
  });

  it("keeps chunks before the first heading as a front-matter section", () => {
    const plan = deriveSections(
      [chunk("preface"), chunk("one", ["Record"]), chunk("two", ["Reduce"])],
      { documentName: "Book" },
    );
    expect(plan.sections[0].title).toBe("Book — front matter");
    expect(plan.sections[0].headingPath).toEqual([]);
    expect(plan.sections).toHaveLength(3);
  });

  it("returns one section when the document has no headings at all", () => {
    const plan = deriveSections([chunk("a"), chunk("b")], {
      documentName: "notes.md",
    });
    expect(plan.cutLevel).toBe(0);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].title).toBe("notes.md");
    expect(plan.sections[0].text).toBe("a\n\nb");
  });

  it("subdivides a section over the ceiling and counts it", () => {
    const big = "x".repeat(30);
    const plan = deriveSections(
      [
        chunk(big, ["Chapter"]),
        chunk(big, ["Chapter"]),
        chunk(big, ["Chapter"]),
        chunk("small", ["Other"]),
        chunk("small", ["Third"]),
      ],
      { documentName: "Book", ceiling: 40 },
    );
    expect(plan.splitSections).toBe(1);
    const parts = plan.sections.filter((s) => s.title.startsWith("Chapter"));
    expect(parts).toHaveLength(3);
    expect(parts.map((s) => s.title)).toEqual([
      "Chapter · part 1",
      "Chapter · part 2",
      "Chapter · part 3",
    ]);
    expect(parts.every((s) => s.charCount <= 40)).toBe(true);
  });

  it("reports charCount as the joined text length and keeps chunk indexes", () => {
    const plan = deriveSections(
      [chunk("abc", ["A"]), chunk("de", ["A"]), chunk("f", ["B"]), chunk("g", ["C"])],
      { documentName: "Book" },
    );
    const first = plan.sections.find((s) => s.title === "A");
    expect(first?.charCount).toBe("abc\n\nde".length);
    expect(first?.chunks).toEqual([0, 1]);
  });

  it("defaults the ceiling to the exported constant", () => {
    const plan = deriveSections([chunk("a", ["A"]), chunk("b", ["B"])], {
      documentName: "Book",
    });
    expect(plan.ceiling).toBe(SECTION_CHAR_CEILING);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test subgraphs/convert/lib/sections.test.ts`
Expected: FAIL — `Failed to resolve import "./sections.js"` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

`subgraphs/convert/lib/sections.ts`:

```ts
/**
 * Turning docling's chunk stream into vault sections.
 *
 * docling's chunker is tokenizer-shaped: it emits one chunk per document
 * element, each carrying the heading path it sits under. Measured on a
 * six-element HTML page: 5 chunks. A 400-page book scales that to thousands,
 * and a `bai/source` per chunk would dilute every query that touches the
 * topic — the failure AGENT.md names as the most damaging an agent can do to
 * a vault. So a section, not a chunk, is the unit that becomes a source.
 *
 * The rule is "cut at the shallowest heading depth that actually divides the
 * document": a book with three parts and no chapters cuts at depth 1; one
 * that is a single part with twelve chapters cuts at depth 2.
 */

/** A chunk as the conversion service returns it (docling's shape). */
export interface SourceChunk {
  text: string;
  headings?: string[];
  docItems?: string[];
  contextualized?: string;
}

/** One prospective `bai/source`. */
export interface Section {
  /** The section's own heading, or a generated name. */
  title: string;
  /** The full heading path, outermost first. Empty for front matter. */
  headingPath: string[];
  text: string;
  charCount: number;
  /** Indexes into the chunk array this section was built from. */
  chunks: number[];
}

export interface SectionPlan {
  sections: Section[];
  /** Heading depth the cut was made at; 0 when the document has no headings. */
  cutLevel: number;
  /** How many sections the ceiling forced into parts. */
  splitSections: number;
  ceiling: number;
}

/**
 * A safety valve, not a target. Every operation stores a full copy of the
 * document's state, so a source far above this re-serialises itself on every
 * claim added. Tuned in Task 7 against a real book.
 */
export const SECTION_CHAR_CEILING = 40_000;

/** Deepest heading depth we will cut at before giving up and not cutting. */
const MAX_CUT_DEPTH = 3;

const pathKey = (headings: string[], depth: number) =>
  headings.slice(0, depth).join("\u0000");

/** The shallowest depth (1..MAX_CUT_DEPTH) that yields at least two groups. */
function chooseCutLevel(chunks: readonly SourceChunk[], headed: number[]): number {
  if (headed.length === 0) return 0;
  for (let depth = 1; depth <= MAX_CUT_DEPTH; depth++) {
    const keys = new Set<string>();
    for (const i of headed) {
      const headings = chunks[i].headings ?? [];
      if (headings.length >= depth) keys.add(pathKey(headings, depth));
    }
    if (keys.size >= 2) return depth;
  }
  // One heading covers everything: cut at depth 1 and let it be one section.
  return 1;
}

/** Indexes grouped by their heading path at `depth`, in document order. */
function groupIndexes(
  chunks: readonly SourceChunk[],
  headed: number[],
  depth: number,
): number[][] {
  const groups: number[][] = [];
  const byKey = new Map<string, number[]>();
  for (const i of headed) {
    const headings = chunks[i].headings ?? [];
    const key = pathKey(headings, Math.min(depth, headings.length));
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
      groups.push(group);
    }
    group.push(i);
  }
  return groups;
}

function buildSection(
  title: string,
  headingPath: string[],
  indexes: number[],
  chunks: readonly SourceChunk[],
): Section {
  const text = indexes.map((i) => chunks[i].text).join("\n\n");
  return { title, headingPath, text, charCount: text.length, chunks: indexes };
}

/** Splits one over-ceiling section at chunk boundaries (paragraph-shaped). */
function splitByCeiling(
  section: Section,
  chunks: readonly SourceChunk[],
  ceiling: number,
): Section[] {
  const parts: Section[] = [];
  let current: number[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    parts.push(
      buildSection(
        `${section.title} · part ${parts.length + 1}`,
        section.headingPath,
        current,
        chunks,
      ),
    );
    current = [];
    currentChars = 0;
  };

  for (const i of section.chunks) {
    const size = chunks[i].text.length;
    // A single chunk larger than the ceiling is not split further: there is
    // no smaller authored boundary left to cut on.
    if (current.length > 0 && currentChars + size > ceiling) flush();
    current.push(i);
    currentChars += size;
  }
  flush();

  // A section that produced a single part is not reported as split.
  return parts.length > 1 ? parts : [section];
}

export function deriveSections(
  chunks: readonly SourceChunk[],
  options: { documentName: string; ceiling?: number },
): SectionPlan {
  const ceiling = options.ceiling ?? SECTION_CHAR_CEILING;
  const name = options.documentName;

  const headless: number[] = [];
  const headed: number[] = [];
  chunks.forEach((c, i) => {
    if ((c.headings?.length ?? 0) > 0) headed.push(i);
    else headless.push(i);
  });

  const cutLevel = chooseCutLevel(chunks, headed);
  const sections: Section[] = [];

  if (headless.length > 0) {
    const title = headed.length === 0 ? name : `${name} — front matter`;
    sections.push(buildSection(title, [], headless, chunks));
  }

  if (cutLevel > 0) {
    for (const indexes of groupIndexes(chunks, headed, cutLevel)) {
      const path = (chunks[indexes[0]].headings ?? []).slice(0, cutLevel);
      sections.push(
        buildSection(path[path.length - 1] ?? name, path, indexes, chunks),
      );
    }
  }

  let splitSections = 0;
  const out: Section[] = [];
  for (const section of sections) {
    if (section.charCount <= ceiling) {
      out.push(section);
      continue;
    }
    const parts = splitByCeiling(section, chunks, ceiling);
    if (parts.length > 1) splitSections++;
    out.push(...parts);
  }

  return { sections: out, cutLevel, splitSections, ceiling };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test subgraphs/convert/lib/sections.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Type-check and lint**

Run: `bun run tsc && bun run lint:fix`
Expected: tsc exits 0; oxlint reports no errors on the new files.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/convert/lib/sections.ts subgraphs/convert/lib/sections.test.ts
git commit -m "feat(convert): a section cut follows the document's own headings"
```

---

### Task 2: The conversion-service client

> **Status: implemented and verified** (`subgraphs/convert/lib/service.{ts,test.ts}` — **7 tests passing**, tsc and lint clean). Verified twice: against a fake `fetch` in the unit tests, and against the **live service** on `:5011` through the real wire (`health ok=true ready=true`; `my document.html` → 303 chars / 3 chunks; `main_example.pdf` → 5 551 chars / 55 chunks in 2.2 s; and `:5010` with no models → `CONVERT_UNAVAILABLE`, status 502, carrying the service's own `415` detail).
>
> **Three defects in the plan's version of this task, all fixed:**
>
> 1. **The default timeout was 2 minutes — shorter than the document we measured.** A 238-page book takes **5 m 33 s**, so the planned `DEFAULT_TIMEOUT_MS = 120_000` would have failed exactly the file this feature exists to ingest. Raised to 30 minutes: the timeout is a dead-peer detector, not a service-level objective.
> 2. **The URL expectation could never pass.** The test asserted `?filename=Book+chapter.pdf` while the implementation uses `encodeURIComponent`, which produces `Book%20chapter.pdf`. The test now expects `%20` — and the live check proves the round trip, since the service reads it back with `URLSearchParams` (which decodes both) and `basename`s it.
> 3. **A test literal read as `apiKey: ***` in the plan file.** It is `apiKey: "secret"`. Worth knowing generally: **tool output in this environment redacts secret-looking strings**, so `***` in a read is not evidence about file content — `grep -c '<literal>'` counts restore the truth.
>
> **Two tests added**, both closing gaps the plan's set left open: a body that is not the agreed shape (a `docling-serve` instance with no adapter) must raise `CONVERT_UNAVAILABLE` rather than mint an empty source; and no `x-api-key` header is sent when none is configured — the plan's second test *named* that case ("only when configured") but only ever checked the positive half.
>
> **Ordering note:** this task imports `HttpError` from `lib/respond.ts`, which the plan assigns to Task 3, so `respond.ts` was written first. It is Task 3's file in its final form, not a stub.

**Files:**
- Create: `subgraphs/convert/lib/service.ts`
- Test: `subgraphs/convert/lib/service.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ConversionService` (`{ convert, health }`), `createHttpConversionService({ baseUrl, apiKey?, fetchImpl?, timeoutMs? })`, and the `ConversionResult` / `ConversionHealth` types. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

`subgraphs/convert/lib/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHttpConversionService } from "./service.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createHttpConversionService", () => {
  it("posts the bytes with the filename and maps a 2xx body", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const service = createHttpConversionService({
      baseUrl: "http://convert.test/",
      fetchImpl: (async (url, init) => {
        seen = { url: String(url), init: init as RequestInit };
        return json({
          markdown: "# Hi",
          chunks: [{ text: "Hi", headings: ["Hi"] }],
          format: "md",
        });
      }) as typeof fetch,
    });

    const result = await service.convert({
      filename: "Book chapter.pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(seen?.url).toBe(
      "http://convert.test/convert?filename=Book+chapter.pdf",
    );
    expect(seen?.init.method).toBe("POST");
    expect(
      (seen?.init.headers as Record<string, string>)["content-type"],
    ).toBe("application/octet-stream");
    expect(result.markdown).toBe("# Hi");
    expect(result.chunks).toHaveLength(1);
    expect(result.format).toBe("md");
  });

  it("sends the api key only when configured", async () => {
    const headers: Record<string, string>[] = [];
    const withKey = createHttpConversionService({
      baseUrl: "http://convert.test",
      apiKey: "secret",
      fetchImpl: (async (_url, init) => {
        headers.push((init as RequestInit).headers as Record<string, string>);
        return json({ markdown: "", chunks: [] });
      }) as typeof fetch,
    });
    await withKey.convert({ filename: "a.md", bytes: new Uint8Array([1]) });
    expect(headers[0]["x-api-key"]).toBe("secret");
  });

  it("raises CONVERT_UNAVAILABLE when the service rejects", async () => {
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: (async () =>
        json({ error: "no models" }, 500)) as typeof fetch,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({
      code: "CONVERT_UNAVAILABLE",
      status: 502,
    });
  });

  it("raises CONVERT_UNAVAILABLE when the service is unreachable", async () => {
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "CONVERT_UNAVAILABLE" });
  });

  it("reports health verbatim", async () => {
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: (async () =>
        json({
          ok: true,
          backend: "docling.rs",
          ready: false,
          missing: ["pdfium"],
          formats: ["md", "pdf"],
        })) as typeof fetch,
    });
    const health = await service.health();
    expect(health.ready).toBe(false);
    expect(health.missing).toEqual(["pdfium"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test subgraphs/convert/lib/service.test.ts`
Expected: FAIL — `Failed to resolve import "./service.js"`.

- [ ] **Step 3: Write the implementation**

`subgraphs/convert/lib/service.ts`:

```ts
import { HttpError } from "./respond.js";

/** A chunk as the conversion service returns it (docling's shape). */
export interface ConversionChunk {
  text: string;
  headings?: string[];
  docItems?: string[];
  contextualized?: string;
}

export interface ConversionResult {
  markdown: string;
  chunks: ConversionChunk[];
  format?: string;
  timings?: Record<string, unknown>;
}

export interface ConversionHealth {
  ok: boolean;
  backend: string;
  ready: boolean;
  missing: string[];
  formats: string[];
}

export interface ConversionService {
  convert(input: {
    filename: string;
    bytes: Uint8Array;
  }): Promise<ConversionResult>;
  health(): Promise<ConversionHealth>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The HTTP client for whatever conversion backend is configured, behind ONE
 * shape: `{ markdown, chunks }`. That shape is a contract the backend must
 * meet, not a property it has — the local `bun` service over docling.rs meets
 * it natively, and `docling-serve` does not (it answers
 * `{ document: { md_content, … }, status, timings }`) so it needs a small
 * adapter. Keeping the adapter on the backend side is what lets this file —
 * and the subgraph — stay ignorant of which engine is running.
 */
export function createHttpConversionService(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ConversionService {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (options.apiKey) headers["x-api-key"] = options.apiKey;
    try {
      return await doFetch(`${base}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Unreachable, DNS failure, or our own timeout. The caller must not
      // retry blindly, so the distinction from a 5xx is kept in the message.
      throw new HttpError(
        502,
        "CONVERT_UNAVAILABLE",
        `Conversion service unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(
        502,
        "CONVERT_UNAVAILABLE",
        `Conversion service answered ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async convert({ filename, bytes }) {
      const response = await request(
        `/convert?filename=${encodeURIComponent(filename)}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: bytes as unknown as BodyInit,
        },
      );
      const body = await readJson<{
        markdown: string;
        chunks: ConversionChunk[];
        format?: string;
        timings?: Record<string, unknown>;
      }>(response);
      if (typeof body.markdown !== "string" || !Array.isArray(body.chunks)) {
        throw new HttpError(
          502,
          "CONVERT_UNAVAILABLE",
          "Conversion service returned an unexpected body",
        );
      }
      return {
        markdown: body.markdown,
        chunks: body.chunks,
        format: body.format,
        timings: body.timings,
      };
    },

    async health() {
      const response = await request("/health", { method: "GET" });
      return readJson<ConversionHealth>(response);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test subgraphs/convert/lib/service.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add subgraphs/convert/lib/service.ts subgraphs/convert/lib/service.test.ts
git commit -m "feat(convert): one client shape for whichever backend is configured"
```

---

### Task 3: The two routes

> **The subgraph scaffold now exists** (`subgraphs/{convert/index.ts,lib.ts,resolvers.ts,schema.ts}` + the registration in `subgraphs/index.ts`), generated by the framework's own generator rather than by this plan. Consequences for the remaining tasks:
>
> - **Tasks 3's file set is unchanged** — `lib/respond.ts`, `lib/deps.ts`, `lib/routes.ts` sit alongside the generated files, exactly as `subgraphs/http` keeps its route modules under `lib/`. But **`subgraphs/convert/lib.ts` is a generator placeholder with a "delete the file and run the code generator again to have it reset" header**, not a home for our code; nothing of ours goes in it.
> - **Task 4 changes shape.** The `ConvertSubgraph` class already exists (`name = "convert"`, `typeDefs = schema`, `resolvers = getResolvers(this)`, `additionalContextFields = {}`, `onSetup`/`onDisconnect`) — so Task 4 fills the *schema and resolvers* instead of writing the class.
> - **The schema must follow the generated convention**: a namespace type reached from the root, not flat root fields.
>
>   ```graphql
>   type ConvertQueries { health: …, preview(...): … }
>   type Query { convert: ConvertQueries! }
>   ```
>
>   The generator's stub ships `ConvertQueries { example(driveId: String!): String }` with `Query { convert: ConvertQueries! }` and a matching `resolvers.ts` returning `{ Query: { convert: () => ({}) }, ConvertQueries: { … } }`. Replace the `example` field; keep the namespace shape.
> - **Task 6's registration is already done** — `subgraphs/index.ts` exports `ConvertSubgraph`. What remains there is the manifest `config[]` entries, the coverage `include`, and re-running codegen.
> - **The generated stub's four lint warnings** (`reactor`, `parent`, `args` unused; `require-await`) disappear when `example` is replaced by a real resolver, so they are not worth fixing first.
>
> **Decided: the upload cap is 30 MB** (`MAX_UPLOAD_BYTES = 30 * 1024 * 1024`), and the convert routes declare it per-route — the `maxBodyBytes` the route already takes, so `subgraphs/http`'s 2 MB house default is unchanged elsewhere.
>
> Why 30 MB rather than the 2 MB house limit: the documents this feature exists for are bigger than the house limit. Measured — a CV is 47 KB, a purchase order 20 KB, and **the O'Reilly book is 17.4 MB**, which the service itself converted end-to-end in 5 m 33 s. A 2 MB cap would have answered `413` to exactly the file the intake view was designed around.
>
> Why not larger: it is **per-request memory in the Switchboard** (the body is buffered), and 30 MB comfortably clears the measured worst case while staying a bound an operator can reason about. The service's own cap (`CONVERT_MAX_BYTES`, 256 MB) stays higher on purpose — it is the last line, not the policy.
>
> Two consequences to carry into the UI and the docs: the **browser upload path must not have its own smaller limit**, and a 30 MB upload is slow enough that the intake view needs a real progress surface rather than a spinner (Task 9, Step 2). Raising the cap later is a one-line change; the number is in §7 of the spec so it is not a magic constant in one file.

**Files:**
- Create: `subgraphs/convert/lib/respond.ts`
- Create: `subgraphs/convert/lib/deps.ts`
- Create: `subgraphs/convert/lib/routes.ts`
- Test: `subgraphs/convert/lib/routes.test.ts`

**Interfaces:**
- Consumes: `ConversionService` and `deriveSections` (Tasks 1–2), `createFakeHttpScope` from `tests/helpers/fake-http-scope.js`.
- Produces: `ConvertRouteDeps`, `createConvertRoute(deps)`, `createHealthRoute(deps)`, `MAX_UPLOAD_BYTES`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

`subgraphs/convert/lib/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createConvertRoute, createHealthRoute } from "./routes.js";
import type { ConversionService } from "./service.js";

const ctx = (rawBody?: Buffer) =>
  ({ params: {}, user: undefined, authEnabled: true, rawBody }) as RouteContext;

const stubService = (over: Partial<ConversionService> = {}): ConversionService => ({
  convert: async () => ({
    markdown: "# The Vault\n\nRecord",
    chunks: [
      { text: "The Vault", headings: ["The Vault"] },
      { text: "Record", headings: ["Record"] },
      { text: "Reduce", headings: ["Reduce"] },
    ],
    format: "md",
  }),
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md", "pdf"],
  }),
  ...over,
});

const post = (filename: string, body = "abc") =>
  new Request(
    `http://vault.test/api/@powerhousedao/knowledge-note/convert?filename=${encodeURIComponent(filename)}`,
    { method: "POST", body },
  );

describe("createConvertRoute", () => {
  it("answers a preview with sections and no markdown by default", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.filename).toBe("Book.md");
    expect(body.markdown).toBeUndefined();
    expect(body.plan).toMatchObject({ cutLevel: 1, splitSections: 0 });
    expect((body.sections as unknown[]).length).toBe(2);
  });

  it("includes the markdown only when asked", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(
      new Request(
        "http://vault.test/x/convert?filename=Book.md&markdown=1",
        { method: "POST", body: "abc" },
      ),
      ctx(Buffer.from("abc")),
    );
    expect(((await res.json()) as Record<string, unknown>).markdown).toBe(
      "# The Vault\n\nRecord",
    );
  });

  it("requires a filename", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(
      new Request("http://vault.test/x/convert", { method: "POST", body: "abc" }),
      ctx(Buffer.from("abc")),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "FILENAME_REQUIRED",
    );
  });

  it("rejects an empty body", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.alloc(0)));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "EMPTY_BODY",
    );
  });

  it("answers 502 when the backend fails, and says nothing was written", async () => {
    const handler = createConvertRoute({
      service: stubService({
        convert: async () => {
          throw Object.assign(new Error("boom"), {
            status: 502,
            code: "CONVERT_UNAVAILABLE",
          });
        },
      }),
    });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    expect(res.status).toBe(502);
  });
});

describe("createHealthRoute", () => {
  it("passes the backend's readiness through", async () => {
    const handler = createHealthRoute({ service: stubService() });
    const body = (await (
      await handler(new Request("http://vault.test/x/convert/health"), ctx())
    ).json()) as Record<string, unknown>;
    expect(body.backend).toBe("docling.rs");
    expect(body.ready).toBe(true);
  });

  it("answers 503 when no backend is configured", async () => {
    const handler = createHealthRoute({});
    const res = await handler(
      new Request("http://vault.test/x/convert/health"),
      ctx(),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "CONVERT_NOT_CONFIGURED",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test subgraphs/convert/lib/routes.test.ts`
Expected: FAIL — `Failed to resolve import "./routes.js"`.

- [ ] **Step 3: Write `respond.ts`**

`subgraphs/convert/lib/respond.ts`:

```ts
/**
 * Mirrors `subgraphs/http/lib/respond.ts` rather than importing it.
 *
 * Subgraphs are independently deployable units — `subgraphs/http/lib.ts` is a
 * per-subgraph scaffold, not a shared library, and reaching across would make
 * one subgraph's refactor break another's routes.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const OK_CACHE = { "Cache-Control": "private, max-age=0" };

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    { error: message, code: "INTERNAL" },
    { status: 500 },
  );
}
```

- [ ] **Step 4: Write `deps.ts`**

`subgraphs/convert/lib/deps.ts`:

```ts
import type { ConversionService } from "./service.js";

/** Everything the convert routes need, injectable for tests. */
export interface ConvertRouteDeps {
  /** Absent when `CONVERT_SERVICE_URL` is unset: the routes answer 503. */
  service?: ConversionService;
}
```

- [ ] **Step 5: Write `routes.ts`**

`subgraphs/convert/lib/routes.ts`:

```ts
import type { RouteContext } from "@powerhousedao/shared/processors";
import { HttpError, OK_CACHE, jsonError } from "./respond.js";
import { deriveSections } from "./sections.js";
import type { ConvertRouteDeps } from "./deps.js";

/**
 * Deliberately NOT the 2 MB house cap that `POST actions` / `POST sources`
 * use: the documents this route exists for are bigger. Measured — 47 KB CV,
 * 20 KB purchase order, **17.4 MB book**. 30 MB clears the worst case with
 * room, and stays a bound an operator can hold; the body is buffered per
 * request in the Switchboard, which is why it is not larger. The service's own
 * cap (`CONVERT_MAX_BYTES`, 256 MB) is higher on purpose: last line, not policy.
 */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const notConfigured = () =>
  new HttpError(
    503,
    "CONVERT_NOT_CONFIGURED",
    "No conversion service is configured. Set CONVERT_SERVICE_URL in the package config.",
  );

export function createHealthRoute(deps: ConvertRouteDeps) {
  return async function handleConvertHealth(
    _request: Request,
    _ctx: RouteContext,
  ): Promise<Response> {
    if (!deps.service) return jsonError(notConfigured());
    try {
      const health = await deps.service.health();
      return Response.json(health, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}

export function createConvertRoute(deps: ConvertRouteDeps) {
  return async function handleConvert(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const filename = url.searchParams.get("filename")?.trim();
      if (!filename) {
        throw new HttpError(
          400,
          "FILENAME_REQUIRED",
          "Pass ?filename=<name with extension> — the extension is how the format is detected.",
        );
      }
      const bytes = ctx.rawBody;
      if (!bytes || bytes.byteLength === 0) {
        throw new HttpError(400, "EMPTY_BODY", "The request body is empty.");
      }
      if (!deps.service) throw notConfigured();

      const result = await deps.service.convert({ filename, bytes });
      const plan = deriveSections(result.chunks, { documentName: filename });

      return Response.json(
        {
          filename,
          format: result.format ?? null,
          chars: result.markdown.length,
          chunks: result.chunks.length,
          sections: plan.sections,
          plan: {
            cutLevel: plan.cutLevel,
            splitSections: plan.splitSections,
            ceiling: plan.ceiling,
          },
          // The sections carry the text; the whole markdown is opt-in so a
          // book-sized document does not round-trip through the app twice.
          ...(url.searchParams.get("markdown") === "1"
            ? { markdown: result.markdown }
            : {}),
          timings: result.timings ?? null,
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test subgraphs/convert/lib/routes.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/convert/lib/respond.ts subgraphs/convert/lib/deps.ts subgraphs/convert/lib/routes.ts subgraphs/convert/lib/routes.test.ts
git commit -m "feat(convert): a preview route that writes nothing"
```

---

### Task 4: The subgraph class

> **Not yet implemented, and the plan below is superseded in two places by the generated scaffold** — the code blocks in this task were written before `subgraphs/convert/` existed.
>
> **1. The schema must use the generated `ConvertQueries` namespace, not a flat root field.** The task body below exposes `convertHealth: ConvertHealth!` on `Query`; the generator's stub (and this plan's own Task 3 note) specify a namespace reached from the root. The scaffold already has:
>
> ```graphql
> type ConvertQueries { health: ConvertHealth! }
> type Query { convert: ConvertQueries! }
> ```
>
> with `ConvertHealth { ok: Boolean! backend: String ready: Boolean! missing: [String!]! formats: [String!]! configured: Boolean! }` replacing the stub's `example(driveId: String!)`. The resolver map keeps the namespace wrapper the stub established: `{ Query: { convert: () => ({}) }, ConvertQueries: { health } }`. GraphQL for this subgraph is then served at **`/graphql/convert`** (the repo's subgraphs mount at `/graphql/<name>` — measured for `knowledgeGraph`).
>
> **2. This is where the subgraph is connected to the docling service, and the connection is built once, at setup.** `onSetup()` is the only place that reads configuration:
>
> ```ts
> async onSetup(): Promise<void> {
>   const baseUrl = process.env.CONVERT_SERVICE_URL?.trim();
>   // `configured: false` is a first-class state, not an error: the vault works
>   // without conversion, and an unconfigured deployment must say so rather than
>   // fail on first upload.
>   this.routeDeps = baseUrl
>     ? {
>         service: createHttpConversionService({
>           baseUrl,
>           apiKey: process.env.CONVERT_SERVICE_API_KEY?.trim() || undefined,
>         }),
>       }
>     : {};
>   registerConvertRoutes(this.http, this.routeDeps);
> }
> ```
>
> Three properties of that block, each deliberate:
> - **The client is constructed once per subgraph, not per request** — it holds the base URL, the key and the timeout, and the service is long-lived.
> - **Reading config in `onSetup` rather than in a handler** matches how this repo already works: no subgraph under `subgraphs/` reads `process.env` per request (only processors do), and `live-deps.ts` builders take the subgraph instance, not the environment.
> - **`CONVERT_SERVICE_URL` unset is not an error.** `routeDeps = {}` makes the health route answer `configured: false` and `POST convert` answer **`503 CONVERT_NOT_CONFIGURED`** — a vault that has not been pointed at a service still works; only the new capability is absent.
>
> **3. The route paths, and the URL they answer on.** Routes register on the subgraph's http scope and surface under the package's base path — **`<origin>/api/@powerhousedao/knowledge-note/<path>`** (measured on the running server: `…/api/@powerhousedao/knowledge-note/health.json` reaches the http subgraph and answers `400 drive is required`, i.e. the prefix and auth both work). So:
>
> ```
> GET  http://localhost:4001/api/@powerhousedao/knowledge-note/convert/health
> POST http://localhost:4001/api/@powerhousedao/knowledge-note/convert?filename=<name>
> ```
>
> **4. A `public` route can still answer 401 on this host.** `GET ping` is declared `auth: "public"` in `subgraphs/http` and the running dev Switchboard answered **`401 {"error":"Authentication required"}`** to an anonymous request — the host's `REQUIRE_AUTHENTICATED_CALLER` (manifest `config[]`) rejects anonymous callers before any route runs. Every verification command below therefore sends a bearer token, which is why they start with `ph access-token`.
>
> **5. The build step is not optional, and I measured the failure.** `subgraphs/convert/` is loaded from **`dist/node/subgraphs/index.mjs`**, so until `bun run build` runs, the running Switchboard has no `/convert` route at all — measured today: **`…/convert/health` → `404`** while the source tree already had `index.ts`, `schema.ts` and `resolvers.ts`. `ph vetra --watch` does not cover this (CLAUDE.md, and its own note that this has bitten the project twice).

**Files:**
- Create: `subgraphs/convert/schema.ts`
- Create: `subgraphs/convert/resolvers.ts`
- Create: `subgraphs/convert/index.ts`
- Create: `subgraphs/convert/lib.ts`
- Test: `subgraphs/convert/resolvers.test.ts`

**Interfaces:**
- Consumes: `createConvertRoute`, `createHealthRoute`, `MAX_UPLOAD_BYTES`, `ConvertRouteDeps`, `createHttpConversionService`.
- Produces: `ConvertSubgraph` with `name = "convert"`; the barrel `subgraphs/index.ts` gains `ConvertSubgraph` (Task 6).

- [ ] **Step 1: Write the failing test**

`subgraphs/convert/resolvers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeHttpScope } from "../../tests/helpers/fake-http-scope.js";
import { registerConvertRoutes } from "./resolvers.js";
import type { ConversionService } from "./lib/service.js";

const service: ConversionService = {
  convert: async () => ({ markdown: "", chunks: [] }),
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md"],
  }),
};

describe("registerConvertRoutes", () => {
  it("registers health and convert, with the raw body and a cap", () => {
    const fake = createFakeHttpScope();
    registerConvertRoutes(fake.scope, { service });

    const health = fake.routes.find((r) => r.path === "convert/health");
    const convert = fake.routes.find((r) => r.path === "convert");

    expect(health?.method).toBe("GET");
    expect(health?.options?.auth).toBe("renown");
    expect(convert?.method).toBe("POST");
    expect(convert?.options?.auth).toBe("renown");
    expect(convert?.options?.body).toBe("raw");
    expect(convert?.options?.maxBodyBytes).toBe(30 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test subgraphs/convert/resolvers.test.ts`
Expected: FAIL — `Failed to resolve import "./resolvers.js"`.

- [ ] **Step 3: Write `schema.ts`**

`subgraphs/convert/schema.ts`:

```ts
import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

/**
 * Conversion is an HTTP capability — GraphQL cannot carry a file body — so
 * the schema exposes readiness only, for a client that wants to know whether
 * the capability is live without issuing an upload.
 */
export const schema: DocumentNode = gql`
  type ConvertHealth {
    ok: Boolean!
    backend: String
    ready: Boolean!
    missing: [String!]!
    formats: [String!]!
    configured: Boolean!
  }

  extend type Query {
    """Whether a conversion backend is configured and what it can do."""
    convertHealth: ConvertHealth!
  }
`;
```

- [ ] **Step 4: Write `resolvers.ts`**

`subgraphs/convert/resolvers.ts`:

```ts
import type { IHttpScope } from "@powerhousedao/shared/processors";
import type { ConvertSubgraph } from "./index.js";
import { createConvertRoute, createHealthRoute, MAX_UPLOAD_BYTES } from "./lib/routes.js";
import type { ConvertRouteDeps } from "./lib/deps.js";

/** Registers the package-namespaced routes. Exported for its own test. */
export function registerConvertRoutes(
  http: IHttpScope,
  deps: ConvertRouteDeps,
): void {
  // Registered in this order because routes match in registration order
  // across the package's single namespace; neither path can shadow the other.
  http.get("convert/health", { auth: "renown" }, createHealthRoute(deps));
  http.post(
    "convert",
    { auth: "renown", body: "raw", maxBodyBytes: MAX_UPLOAD_BYTES },
    createConvertRoute(deps),
  );
}

export function getResolvers(subgraph: ConvertSubgraph) {
  return {
    Query: {
      convertHealth: async () => {
        const deps = subgraph.routeDeps;
        if (!deps.service) {
          return { ok: false, backend: null, ready: false, missing: [], formats: [], configured: false };
        }
        try {
          const health = await deps.service.health();
          return { ...health, configured: true };
        } catch {
          return { ok: false, backend: null, ready: false, missing: [], formats: [], configured: true };
        }
      },
    },
  };
}
```

- [ ] **Step 5: Write `index.ts`**

`subgraphs/convert/index.ts`:

```ts
import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { schema } from "./schema.js";
import { getResolvers } from "./resolvers.js";
import { registerConvertRoutes } from "./resolvers.js";
import { createHttpConversionService } from "./lib/service.js";
import type { ConvertRouteDeps } from "./lib/deps.js";

export class ConvertSubgraph extends BaseSubgraph {
  name = "convert";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  /** Read by the resolvers; also what `onSetup` hands the routes. */
  routeDeps: ConvertRouteDeps = {};

  async onSetup(): Promise<void> {
    const baseUrl = process.env.CONVERT_SERVICE_URL?.trim();
    this.routeDeps = baseUrl
      ? {
          service: createHttpConversionService({
            baseUrl,
            apiKey: process.env.CONVERT_SERVICE_API_KEY?.trim() || undefined,
          }),
        }
      : {};
    registerConvertRoutes(this.http, this.routeDeps);
  }

  async onDisconnect(): Promise<void> {}
}
```

- [ ] **Step 6: Write `lib.ts`**

`subgraphs/convert/lib.ts` — the per-subgraph scaffold file the codegen expects:

```ts
/**
 * This is a scaffold file meant for customization.
 * Delete the file and run the code generator again to have it reset
 */
export * from "./lib/sections.js";
export type { ConversionService, ConversionResult, ConversionHealth } from "./lib/service.js";
```

- [ ] **Step 7: Run the tests and the type-check**

Run: `bun run test subgraphs/convert && bun run tsc`
Expected: tests PASS (1 new + 19 from Tasks 1–3); tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add subgraphs/convert
git commit -m "feat(convert): a subgraph that proxies the conversion service"
```

---

### Task 5: The local conversion service

> **Status: implemented and verified** (`scripts/docling-serve/{server.ts,README.md,fetch-models.mjs}`). The committed file is the source of truth — this task keeps the reasoning, not a second copy of the code. Where the implementation diverged from the plan below, and why:
>
> 1. **Chunking uses `chunkFileAsync`, not `chunkDocumentAsync` on our own JSON.** The planned JSON shortcut was 1.6× cheaper but the mandatory fidelity check **failed on real content** — the CV's education table came back with its cells associated differently (spec §5.1). The plan's own stop condition applied: correctness beat the 1.6×, which in a warm process turned out not to exist anyway (3.0 s end-to-end vs the JSON path's promise).
> 2. **The binding and the models load lazily, and the service never loads models at start-up.** `/health` reports `modelsLoaded: false` until a PDF arrives, so a vault boot carries no conversion cost. Two distinct failures are reported separately: binding missing (`503`), models missing (`415` + `missing[]`).
> 3. **The warm `Pipeline` serves `pdf`/`image` only** — the typings say so, and routing a `.docx` through it would be wrong, not merely wasteful. Declarative formats go through the module functions.
> 4. **The service also ships `fetch-models.mjs`** (plan Step 7a) and the models-absent path (Step 7b), which were added after the first draft.
> 5. **`normalizePdf` uses `node:child_process`, not `Bun.spawn`** (`node:http` likewise), so one file runs on the Node the vault deploys with and on Bun.

**Files:**
- Create: `scripts/docling-serve/server.ts`
- Create: `scripts/docling-serve/README.md`
- Create: `scripts/docling-serve/fetch-models.mjs`

**Interfaces:**
- Produces: the HTTP contract in the spec §5.1, consumed by `createHttpConversionService` through `CONVERT_SERVICE_URL`.

- [ ] **Step 1: Install the binding — as an *optional* dependency**

```bash
cd /home/beast/Documents/Powerhouse/bai-knowledge-note
bun add docling.rs
```

Then **move the entry from `dependencies` to `optionalDependencies`** in `package.json` and add the service to `files`:

```jsonc
"optionalDependencies": {
  "docling.rs": "^1.55.0"
},
"files": [
  "/dist",
  "scripts/docling-serve"
]
```

Run `bun install` to refresh `bun.lock`, then confirm:

```bash
bun install
node -e "console.log(require('docling.rs/package.json').version)"
```

Expected: `1.55.0`, and `node_modules/docling.rs-linux-x64-gnu` (~68 MB) present.

**Why optional, and why not `dependencies`:** only the *conversion service* loads this binding — the Switchboard never does, and it is a 105 MB platform-specific native module. `optionalDependencies` is npm's own mechanism for exactly that, and it is the mechanism `docling.rs` already uses for its per-platform packages; it also means a Switchboard-only install tolerates the binding's absence instead of failing. `files` gains `scripts/docling-serve` precisely — not `scripts/`, which holds unrelated dev tooling (`atlas-sync`, `drive-sync`, `lead-import`, `reactor-repair`).

- [ ] **Step 2: Write the service**

`scripts/docling-serve/server.ts`:

```ts
/**
 * A local conversion service over the docling.rs native binding.
 *
 * The vault's `subgraphs/convert` talks to this over HTTP so that the
 * conversion pipeline never lands inside the Switchboard bundle: the binding
 * ships `linux-x64-gnu` only, and the switchboard image is alpine (musl).
 * Point the vault at it with CONVERT_SERVICE_URL.
 *
 * Models live outside this repo. `DOCLING_RS_HOME` points at the directory
 * holding `.models/` and `.pdfium/`; unset, the binding's own default
 * (~/.cache/docling.rs) applies. Declarative formats (md, html, docx, epub,
 * csv, …) need no models at all.
 *
 * Run: bun scripts/docling-serve/server.ts
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  Pipeline,
  checkDependencies,
  chunkDocumentAsync,
  supportedFormats,
} from "docling.rs";

/**
 * A warm pipeline, not the module-level functions: `Pipeline` keeps the ONNX
 * models loaded across calls, so requests after the first pay conversion cost
 * rather than model-load cost.
 */
const pipeline = new Pipeline();

/**
 * Model resolution, and why it is not a call to the package's own helper.
 *
 * `docling.rs` publishes an `exports` map containing only `"."`, so its
 * internals — `deps.js`'s `resolvePaths` / `exportEnv` — CANNOT be imported
 * by subpath (`Cannot find module 'docling.rs/deps.js'`, verified). The
 * binding's documented resolution is CWD-relative `.models/` and
 * `.pdfium/lib`, so the service changes into the model home rather than
 * reaching into the package's internals. `DOCLING_RS_HOME` overrides; unset,
 * the binding's own default (`~/.cache/docling.rs`) applies.
 */
const HOME = process.env.DOCLING_RS_HOME ?? process.cwd();
if (HOME !== process.cwd()) process.chdir(HOME);

const PORT = Number(process.env.CONVERT_SERVICE_PORT ?? 5007);
const MAX_BYTES = Number(process.env.CONVERT_SERVICE_MAX_BYTES ?? 64 * 1024 * 1024);

function health() {
  const deps = checkDependencies();
  return {
    ok: true,
    backend: "docling.rs",
    ready: deps.ready,
    missing: deps.missing,
    formats: supportedFormats(),
    cwd: process.cwd(),
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(health());
    }

    if (request.method !== "POST" || url.pathname !== "/convert") {
      return json({ error: "not found", code: "NOT_FOUND" }, 404);
    }

    const filename = url.searchParams.get("filename")?.trim();
    if (!filename) {
      return json(
        { error: "filename is required", code: "FILENAME_REQUIRED" },
        400,
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return json({ error: "the body is empty", code: "EMPTY_BODY" }, 400);
    }
    if (bytes.byteLength > MAX_BYTES) {
      return json({ error: "body too large", code: "PAYLOAD_TOO_LARGE" }, 413);
    }

    // docling dispatches on the EXTENSION, so the temp file keeps it.
    const dir = await mkdtemp(join(tmpdir(), "vault-convert-"));
    const file = join(dir, `upload${extname(filename) || ".bin"}`);
    const started = Date.now();
    try {
      await writeFile(file, bytes);

      // No pre-flight conversion. An unreadable PDF fails IMMEDIATELY —
      // measured: the 238-page book returned FormatError in 8 ms — so testing
      // page 1 first would only add a redundant ~0.9 s to every PDF that
      // works (measured as the unaccounted time in a 2.7 s request).
      let source = file;
      let normalized = false;
      let pass: Awaited<ReturnType<typeof convertOnce>>;
      try {
        pass = await convertOnce(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/FormatError|pdfium error/i.test(message) ||
          !file.toLowerCase().endsWith(".pdf")
        ) {
          throw error;
        }
        source = await normalizePdf(file, dir);
        normalized = true;
        pass = await convertOnce(source);
      }

      return json({
        markdown: pass.markdown,
        chunks: pass.chunks,
        format: extname(filename).replace(/^\./, "") || null,
        inputName: filename,
        timings: { ...pass.timings, totalMs: Date.now() - started },
        backend: "docling.rs",
        normalized,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /no embedded text layer|ML models|pdfium|FormatError/i.test(message)
        ? "UNSUPPORTED_FORMAT"
        : "CONVERT_FAILED";
      return json({ error: message, code }, code === "UNSUPPORTED_FORMAT" ? 415 : 500);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },
});

/**
 * One conversion pass: markdown for the source's own content, and the JSON the
 * chunker reads.
 *
 * Both calls are needed and neither is redundant. Chunk text is NOT
 * markdown-quality for tables (a PDF invoice's line items come back as
 * `PART-X, QUANTITY = 480 pcs` triplets), and the binding exposes no
 * json→markdown export — but chunking the JSON we already converted is
 * measurably cheaper than `chunkFile()`, which converts the document a second
 * time: on the 2-page CV, JSON-chunking took 890+885 ms against chunkFile's
 * 1 480+1 510 ms, a **1.6× difference** on identical input.
 *
 * It is not an identical *result*: the same file yields 5 529 chars / 55
 * chunks on this path against 5 552 / 54 on the chunkFile path, stable across
 * repeated runs of each. So one of the two is subtly the wrong one, and
 * Task 5's fidelity check exists to find out which.
 */
async function convertOnce(file: string) {
  const convertStart = Date.now();
  const converted = await pipeline.convertFileAsync(file, { to: "markdown" });
  const convertMs = Date.now() - convertStart;

  const chunkStart = Date.now();
  const asJson = await pipeline.convertFileAsync(file, { to: "json" });
  // chunkDocument takes the docling-core JSON STRING, not a result object.
  const chunks = await chunkDocumentAsync(asJson.content);
  const chunkMs = Date.now() - chunkStart;

  return {
    markdown: converted.content,
    chunks,
    timings: { convertMs, chunkMs },
  };
}

/**
 * Rewrites a PDF that pdfium refuses, and returns the new path.
 *
 * pdfium refuses some valid PDFs at load — measured on a 238-page O'Reilly
 * book: `PdfiumLibraryInternalError(FormatError)`, on a file that is neither
 * encrypted nor malformed to any other reader. qpdf (fast, lossless) is tried
 * first, gs (slower, re-renders) second. This runs on the FormatError path
 * only.
 *
 * `Bun.spawn` here, `spawnSync` in the repo's version: the vault's deployment
 * runs Node (Vetra), so the committed service uses `node:child_process` and
 * `node:http`, both of which Bun implements — one file, either runtime.
 */
async function normalizePdf(file: string, dir: string): Promise<string> {
  const rewritten = join(dir, "normalized.pdf");
  const qpdf = Bun.spawn(
    ["qpdf", "--linearize", "--object-streams=disable", file, rewritten],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await qpdf.exited) === 0) return rewritten;
  const gs = Bun.spawn(
    [
      "gs",
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${rewritten}`,
      file,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await gs.exited) === 0) return rewritten;
  throw new Error(
    "pdfium rejected this PDF and neither qpdf nor ghostscript could normalise it",
  );
}

console.log(`convert service on http://127.0.0.1:${server.port}`);
console.log(`cwd=${process.cwd()} models=${existsSync(join(process.cwd(), ".models"))}`);
console.log("deps:", JSON.stringify(checkDependencies()));
```

- [ ] **Step 3: Write the README**

`scripts/docling-serve/README.md` — one page: what it is, that models are needed only for PDF/image, `DOCLING_RS_HOME`, the two routes, and the smoke test from Step 4 verbatim.

- [ ] **Step 4: Smoke-test it**

```bash
# terminal 1
bun scripts/docling-serve/server.ts

# terminal 2
curl -s http://127.0.0.1:5007/health
printf '<h1>Record</h1><p>A source is the archive.</p><h1>Reduce</h1><p>Extraction is a transformation.</p>' > /tmp/sample.html
curl -s -X POST "http://127.0.0.1:5007/convert?filename=sample.html" \
  --data-binary @/tmp/sample.html | head -c 600
```

Expected: `/health` reports `ready` with `formats` listing ≥ 29 entries; `/convert` returns `markdown` containing `# Record` and a `chunks` array of 4 entries with `headings`.

- [ ] **Step 5: Confirm it runs under Node, and that the two chunk paths agree**

Two things measured in the spike that this step must not skip.

**5a — Node.** Vetra deploys the vault with Node, so the service has to run there. `node:http` and `node:child_process` are implemented by Bun too, which is why the committed version uses them rather than `Bun.serve` / `Bun.spawn` — one file, either runtime:

```bash
node scripts/docling-serve/server.ts &
curl -s http://127.0.0.1:5007/health | grep -o '"runtime":"[^"]*"'
```

Expected: `"runtime":"node v26.8.1"` (or whichever Node is installed), `ready: true`, 29 formats. **Verified working**, and Node measured no slower than Bun on identical files (PO invoice 3.0 s under Node vs 2.7 s under Bun; CV 2.9 s vs 3.6 s).

**5b — the fidelity check, because the two chunk paths do not agree.** On `main_example.pdf`, chunking the already-converted JSON produced **5 529 chars / 55 chunks**, while `chunkFile` produced **5 552 / 54** — each stable across repeated runs, so one of the two is subtly wrong and this service has provisionally chosen the JSON path for its 1.6× speed. Diff them on one real document:

```bash
curl -s -X POST "http://127.0.0.1:5007/convert?filename=cv.pdf&markdown=1" --data-binary @cv.pdf > /tmp/a.json
node -e "import('docling.rs').then(async d => console.log((await d.chunkFileAsync('cv.pdf')).length))"
```

Compare the markdown and the chunk `text` fields. **If the difference is real content — a paragraph, a table row — stop and switch `convertOnce` to `chunkFile`.** Correctness beats 1.6×. If it is whitespace or chunk-boundary placement, keep the JSON path and record the finding in the spec's §11.

> **Result (run against the committed service): the check FAILED, and the service uses `chunkFileAsync`.** Counts agree (55 each) and every heading path is identical, but the normalised text diverges at character 4 145 — inside the CV's education table, where the JSON path returns `Copenhagen Business Academy = AP Degree in Computer Science. , Copenhagen, Denmark = 201…` and `chunkFile` returns `🟤, 1 = Copenhagen Business Academy. 🟤, 2 = Copenhagen, Denmark. , 1 = AP Degree in Compu…`. Cells associated differently is precisely the named stop condition. Two further measurements from the same run: `chunkFileAsync` does **not** reload models per call (three consecutive calls: 1 630 / 1 522 / 1 580 ms), and the runtime changes the output — **Node gives 55 chunks to Bun's 54**, with real text differences (`Powerhouse Remote` vs `Powerhouse`). Both are in spec §5.1.

- [ ] **Step 6: Type-check and lint**

Run: `bun run tsc && bun run lint:fix`
Expected: exits 0. `tsconfig.json` includes `**/*`, so the service is type-checked; `docling.rs` ships its own `.d.ts`.

- [ ] **Step 7: The one-time model fetch, and the "models absent" path**

Two things the first-run story needs, neither of which was in the original task.

**7a — `scripts/docling-serve/fetch-models.mjs`**, a deliberate, inspectable one-time command (the shape `powerhouse-knowledge` uses for its methodology claims — *"Unpack them once: `node scripts/methodology.mjs`"*). It must:

- fetch docling.rs's `download_dependencies.sh` to a temp file and **print its byte size and sha256 before running it**, so the operator sees what will execute;
- run it with `--no-asr` (ASR is Whisper-tiny and out of scope) inside `DOCLING_RS_HOME` (default: the repo root, matching the binding's CWD-relative resolution);
- verify the outcome by calling `checkDependencies()` and exiting non-zero if `ready` is false;
- be safe to re-run (the upstream script skips files already present).

```bash
node scripts/docling-serve/fetch-models.mjs                                  # ~700 MB, once, into ./.models + ./.pdfium
DOCLING_RS_HOME=/var/lib/vault-models node scripts/docling-serve/fetch-models.mjs
```

Expected: prints the script's hash and size, downloads ~20 files, then `ready: true  missing: []`.

**7b — "models absent" must be a first-class state, not a failure.** The service starts with nothing loaded and says so:

```jsonc
// GET /health, before any models are fetched
{ "ok": true, "backend": "docling.rs", "runtime": "node v26.8.1",
  "ready": false, "missing": ["pdfium", "layout_heron.onnx"], "formats": [ /* 29 */ ] }
```

Assert the two behaviours that make this useful rather than decorative: **`/convert` still succeeds for a declarative format** (`md`, `html`, `docx`, `csv`, `epub`) while `ready: false` — measured at 1 ms for HTML with no models at all — and **a PDF returns `415 UNSUPPORTED_FORMAT` carrying the missing list in its message**, not a `500`. That is what lets the Intake view offer *"PDF support needs 700 MB — fetch now?"* instead of failing.

- [ ] **Step 8: Commit**

```bash
git add scripts/docling-serve package.json bun.lock
git commit -m "feat(convert): a local conversion service over docling.rs"
```

---

### Task 6: Register the subgraph and the settings

> **Partially done by the scaffold, and the settings half is still missing.** `subgraphs/index.ts` exports `ConvertSubgraph` and `powerhouse.manifest.json` lists `convert` among the subgraphs — both already in place. **What is missing is the `config[]` half**, and it is what makes the connection to the docling service deployable: the manifest currently declares only the five auth/permission vars (`AUTH_ENABLED`, `ADMINS`, `DOCUMENT_PERMISSIONS_ENABLED`, `DEFAULT_PROTECTION`, `REQUIRE_AUTHENTICATED_CALLER`).
>
> Add two entries, matching that shape:
>
> ```jsonc
> {
>   "name": "CONVERT_SERVICE_URL",
>   "type": "var",
>   "description": "Base URL of the conversion service, e.g. http://127.0.0.1:5011. Unset ⇒ POST convert answers 503 CONVERT_NOT_CONFIGURED.",
>   "required": false
> },
> {
>   "name": "CONVERT_SERVICE_API_KEY",
>   "type": "var",
>   "description": "Sent as X-Api-Key when the backend requires one (the docling-serve container does).",
>   "required": false
> }
> ```
>
> Both **`required: false`**, unlike the auth vars: a vault with no conversion service is a working vault, and `onSetup` treats absence as `configured: false` rather than a boot failure. The other half of this task is adding **`subgraphs/convert/lib/**` to `vitest.config.ts`'s coverage `include`** (today it lists only `document-models/**/src/reducers/**`, `tree-utils.ts` and `subgraphs/http/lib/**`), so the new subgraph code is actually measured by the floor rather than silently excluded.


**Files:**
- Modify: `powerhouse.manifest.json` (the `config[]` array)
- Modify: `vitest.config.ts` (coverage `include`)
- Regenerated by codegen: `subgraphs/index.ts`, `powerhouse.manifest.json` (`subgraphs[]`)

- [ ] **Step 1: Add the two config vars**

Append to `config[]` in `powerhouse.manifest.json`, matching the existing entries' shape:

```json
{
  "name": "CONVERT_SERVICE_URL",
  "type": "var",
  "description": "Base URL of the document conversion service, e.g. http://127.0.0.1:5007. Unset means POST /convert answers 503 CONVERT_NOT_CONFIGURED.",
  "required": false
},
{
  "name": "CONVERT_SERVICE_API_KEY",
  "type": "var",
  "description": "X-Api-Key sent to the conversion service when it requires one (the docling-serve container does).",
  "required": false
}
```

- [ ] **Step 2: Run codegen**

Run: `bun run generate`
Expected: `subgraphs/index.ts` gains `export * as ConvertSubgraph from "./convert/index.js";` and `powerhouse.manifest.json`'s `subgraphs[]` gains `{ "id": "convert", "name": "ConvertSubgraph" }`.

**If codegen does not pick it up:** add the export by hand with the same warning comment the repo already uses in `index.ts` for hand-added exports (`// Hand-added: codegen's template does not know about it…`), then re-run `bun run generate` to confirm it survives.

- [ ] **Step 3: Cover the new lib at the same floor as its sibling**

In `vitest.config.ts`, add `"subgraphs/convert/lib/**"` to `coverage.include` immediately after `"subgraphs/http/lib/**"`, and add `"subgraphs/convert/lib/deps.ts"` to `coverage.exclude` beside its http counterpart (it is types only).

- [ ] **Step 4: Verify the floor**

Run: `bun run test:coverage`
Expected: PASS with lines/branches/functions/statements ≥ 95% for `subgraphs/convert/lib/**`. If a branch is uncovered, do not lower the threshold — see the spec's §9 and the repo's coverage strategy.

- [ ] **Step 5: Commit**

```bash
git add powerhouse.manifest.json vitest.config.ts subgraphs/index.ts
git commit -m "feat(convert): register the subgraph and its service settings"
```

---

### Task 6b: Verify the whole path through the subgraph

This is the task that answers "does the subgraph actually reach the docling service" — end to end, through the running Switchboard, no unit tests and no fakes. Everything here is measured against the real server.

**Prerequisites, in order:**

```bash
cd /home/beast/Documents/Powerhouse/bai-knowledge-note
node scripts/docling-serve/server.ts &            # the service; or reuse a running one on :5011
export CONVERT_SERVICE_URL=http://127.0.0.1:5011  # what onSetup() reads
bun run build                                     # REQUIRED: dist/node/subgraphs/index.mjs is what the Switchboard loads
ph vetra                                          # restart, so the new bundle is picked up
```

Then every request carries a bearer token, because this host rejects anonymous callers:

```bash
TOKEN=$(ph access-token 2>/dev/null)
AUTH="authorization: Bearer $TOKEN"
BASE="http://localhost:4001/api/@powerhousedao/knowledge-note"
```

- [ ] **Step 1: the subgraph → service link, via the health route**

```bash
curl -s -H "$AUTH" "$BASE/convert/health" | python3 -m json.tool
```

Expected: `configured: true`, `ok: true`, `ready: true`, `missing: []`, `backend: "docling.rs"`, `formats` listing ~29 ids. **This single response proves the whole chain**: Switchboard → `ConvertSubgraph` → `createHttpConversionService` → the docling service. If it says `configured: false`, `onSetup` did not see `CONVERT_SERVICE_URL` — the value was exported in a different shell than the one running `ph vetra`, which is the failure mode to suspect first.

- [ ] **Step 2: a real conversion, through the same path**

```bash
curl -s -H "$AUTH" -X POST "$BASE/convert?filename=main_example.pdf" \
  --data-binary @/home/beast/Downloads/main_example.pdf -o /tmp/via-subgraph.json -w "http=%{http_code}\n"
python3 -c "
import json; d=json.load(open('/tmp/via-subgraph.json'))
print('markdown', len(d['markdown']), 'chars |', len(d['chunks']), 'chunks')
print('timings', d.get('timings'))
print('first heading path', d['chunks'][0].get('headings'))
"
```

Expected: **`http=200`**, ~5 551 characters of markdown, **55 chunks**, and timings. The numbers should match the direct-to-service measurements in §11 — if markdown length differs, something in the hop is mangling the body (the route reads a raw body, so a JSON-parsing default would corrupt it).

- [ ] **Step 3: the GraphQL surface**

```bash
curl -s -H "$AUTH" -H 'content-type: application/json' \
  -d '{"query":"{ convert { health { ok ready configured formats } } }"}' \
  http://localhost:4001/graphql/convert | python3 -m json.tool
```

Expected: the same health, nested under `convert` — the namespace shape, reachable at `/graphql/convert`.

- [ ] **Step 4: the negative paths, which are what make the happy path trustworthy**

| condition | how to produce it | expected |
|---|---|---|
| service down | stop the docling service, then `GET convert/health` | `configured: true`, `ok: false` — configured but unreachable, **not** a 500 |
| service down, conversion | same, then `POST convert` | **502 `CONVERT_UNAVAILABLE`**, and the message names the unreachable service |
| not configured | restart the Switchboard without `CONVERT_SERVICE_URL` | health `configured: false`; `POST convert` → **503 `CONVERT_NOT_CONFIGURED`** |
| no models | point `CONVERT_SERVICE_URL` at a service with an empty `DOCLING_RS_HOME` | `POST convert` with a PDF → **415**, and the service's own `missing[]` list survives the hop |
| too large | `POST convert` a body over 30 MB | **413**, from the route's `maxBodyBytes`, before the service is called |

The 413 case is worth doing once deliberately, because it is the boundary the cap decision lives on: a 17.4 MB book must pass and a 31 MB body must not.

- [ ] **Step 5: record what changed**

If any expected value differed, that is a finding — write it into the task's status block and into spec §11, with the number, rather than adjusting the expectation to match what happened.

---

### Task 6c: Autostart the conversion service from the subgraph

**Goal:** a single-box dev vault starts the engine it needs, without an operator
remembering a second terminal — while never fighting a service that is already
running.

**Files:**
- `subgraphs/convert/lib/autostart.ts` (new) + `autostart.test.ts`
- `subgraphs/convert/index.ts` — `onSetup()` calls it, `onDisconnect()` stops it
- `scripts/docling-serve/server.ts` — start-up sweep, optional idle release,
  model-home default

**Steps**
- [x] `CONVERT_SERVICE_AUTOSTART` (`true`/`1`/`yes`), default **off**, defaulting
      the URL to `http://127.0.0.1:5011` when unset.
- [x] **Probe `/health` first, always.** Anything answering is reused and nothing
      is spawned — this is what stops a child-per-`ph vetra`-reload leak and lets
      an externally managed service win.
- [x] Track the child **module-side**, not on the subgraph instance (a reload
      replaces the instance while the process lives on). `stopStartedService()`
      on `onDisconnect` plus `process.once("exit")`; it kills only a child this
      process started.
- [x] Resolve the script from `import.meta.url` with candidate paths, never CWD.
- [x] Never throw out of `onSetup`: a failed spawn degrades to unconfigured. A
      vault with no conversion capability is a supported state.
- [x] Wait for readiness by polling `/health`, not sleeping a fixed interval.

**Verification (measured, Node v26.8.1)**
- `GET convert/health` → `configured: True, ok: True, ready: True,
  backend: docling.rs, formats: 29`; the engine runs as pid child of the
  Switchboard with `rss ≈ 100 MB` before any conversion.
- A real conversion through the subgraph: `main_example.pdf` → **HTTP 200 in
  3.5 s**, 55 chunks, 2 sections, `plan.minSectionChars` applied.
- **Content integrity: every one of the 55 chunks' text appears in a section**
  (`absent from every section: 0`). The markdown is 5,529 code points versus
  4,956 of section text — the difference is markdown scaffolding (headings, list
  markers), not lost prose. *Do not read a markdown-vs-sections char gap as data
  loss without this check.*
- Deterministic: three runs, identical sha256 — within a process **and** across a
  fresh process.
- Killing the engine out from under the subgraph: health stays **200** with
  `ok: false, ready: false` (never a 500), and `POST convert` returns **502
  `CONVERT_UNAVAILABLE`** immediately rather than hanging.
- **A reload respawns exactly one child** (killed pid gone, no zombie, one
  process): the in-place replacement path recovered by itself.

**Corrections this task cost, worth more than the code**

1. **`onSetup` runs more than once per process.** The framework replaces
   subgraphs in place and re-runs setup; the http scope **throws** on a duplicate
   route path, and that throw took the **whole Switchboard down** —
   `Route GET …/convert/health is already registered by "@powerhousedao/knowledge-note"`.
   Registration is therefore once per scope (a module-level
   `WeakSet<IHttpScope>`), with a narrow `already registered` catch that
   re-throws anything else.
2. **Env vars for subgraph code come from the repo-root `.env`, not the shell
   you launch `ph vetra` in.** A shell `export` never reached the process. The
   CLI dotenv-loads `.env` at runtime — which is why `AUTH_ENABLED` is enforced
   while being absent from `/proc/<pid>/environ` (that file shows only the env at
   `execve`). `required: false` manifest vars are **not** auto-written to `.env`.
3. **The model home must not be the CWD.** It defaults to the package root in
   both `server.ts` and `fetch-models.mjs`, so a hand-started run, a foreign CWD
   and an autostarted child all resolve to `<package>/.models`. Verified by
   starting from `/tmp` with the var unset.
4. **`.models/` and `.pdfium/` are gitignored** — the fetch script defaults to
   the package root, so running it from the repo drops ~707 MB where `git add -A`
   sees it. Nothing was tracked, so the ignore was sufficient.
5. **`chars` in the route response is JS `String.length`** (UTF-16 code units),
   not code points: a CV with 22 astral characters reports 5,551 for a 5,529-code-point
   markdown. Correct as written; just don't diff it against a Python `len()`.

### Task 7: Measure the PDF path (the acceptance test)

This is the step that turns the spec's unverified claims into numbers, and it is the reason the whole spike exists.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-convert-subgraph-design.md` (§11 gains the measured results)

- [ ] **Step 1: Fetch the PDF models**

```bash
cd /home/beast/Documents/Powerhouse/bai-knowledge-note
curl -fsSL -o /tmp/download_dependencies.sh \
  https://raw.githubusercontent.com/docling-project/docling.rs/master/scripts/install/download_dependencies.sh
sh /tmp/download_dependencies.sh --no-asr          # pdfium + layout + OCR + TableFormer + chunk tokenizer
du -sh .models .pdfium
```
Expected: `.models` on the order of 1 GB, `.pdfium` ~8–40 MB. Record the exact totals. If the service is to run from the repo, point `DOCLING_RS_HOME` at the repo root so `resolvePaths` finds them; otherwise move them to a stable path outside `/tmp`.

- [ ] **Step 2: Convert a real book chapter**

Pick a document the vault would genuinely ingest — a chapter of *Building the Knowledge Vault* in whatever format it is actually held.

```bash
curl -s -X POST "http://127.0.0.1:5007/convert?filename=chapter.pdf" \
  --data-binary @/path/to/chapter.pdf > /tmp/convert.json
python3 -c "
import json; d=json.load(open('/tmp/convert.json'))
print('chars', len(d['markdown']), 'chunks', len(d['chunks']), 'timings', d['timings'])
print('first chunk:', d['chunks'][0])
"
```

- [ ] **Step 3: Judge fidelity, and write it down**

Check, and record each as a bullet in spec §11:

- Do headings appear in the markdown as `#`/`##`/`###` at the right levels? (This decides whether `do_pdf_heading_hierarchy`-equivalent structure arrives without TableFormer.)
- Do tables survive as markdown tables?
- How many chunks, and what do their `headings` arrays look like — is the path depth what `deriveSections` expects?
- Wall time, and the `convertMs` / `chunkMs` split.
- Do any sections exceed `SECTION_CHAR_CEILING`? If none do, say whether the ceiling is doing any work; if many do, propose a new value with the numbers behind it.

- [ ] **Step 4: Decide the model set for deployment**

From the numbers, answer spec §13.1: is `layout_heron.onnx` alone enough for structure, or is TableFormer required? Record the answer in §11 and update §13 if it closes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-convert-subgraph-design.md
git commit -m "docs(convert): measured fidelity and timings for a real book chapter"
```

---

### Task 8: Give `bai/source` an original-file attachment

> **Status: executed and verified.** Model document revision **21 → 26**; `source-management` now has **6 operations**; the tree regenerated cleanly (**every `document-models/` diff is the intended change — the four files with deletions were union/array closes gaining a member, nothing reverted**); `tsc` clean; `bun run test document-models/source` 25 → **31 passing**; lint clean under `document-models/source/`; coverage **99.02 / 95.28 / 99.73 / 99.2** against a 95 floor.
>
> **Six things executing it corrected in the steps below:**
>
> 1. **Codegen *does* write a new operation's reducer into `src/reducers/`** — the `OriginalAlreadyAttachedError` import and the `attachOriginalFileOperation` case appeared automatically, formatted to the repo's style. So Step 5's "manually add the case" was unnecessary *for an `ADD_OPERATION`*. **But it is necessary for a change to an existing operation's reducer**: after dispatching `SET_OPERATION_REDUCER` to fix the coercion below, the model document held the new body while `src/reducers/source-management.ts` still held the old one — that one had to be hand-edited. The rule is: new operations arrive with their body; *changed* bodies must be hand-synced.
> 2. **No `bun run build` and no Switchboard restart were needed.** The reactor serves the model document directly — it was live at revision 26 the moment `addActions` returned — and codegen refreshed the tree on its own. `CLAUDE.md`'s build-and-restart warning is about `subgraphs/`, which is what its own text describes. Step 7's build step was wrong for a document-model-only change.
> 3. **`ADD_OPERATION` takes `schema` *and* `reducer` inline**, so no separate `SET_OPERATION_SCHEMA` / `SET_OPERATION_REDUCER` is needed to create an operation. Four actions in one call, not six.
> 4. **`ADD_OPERATION_ERROR` keys on `operationId`**, not `id` — it carries its own `id` for the error itself. Getting this wrong silently attaches nothing.
> 5. **The generated error class sets `errorCode` to the *class name*** (`"OriginalAlreadyAttachedError"`), not the model's `ORIGINAL_ALREADY_ATTACHED`. That is the convention for **all four** pre-existing errors in this model, so it is not a bug — the SCREAMING code is stored on the model document and used in docs, while the runtime property is the class name.
> 6. **The `|| null` trap fired exactly as `CLAUDE.md` predicts.** `state.originalSizeBytes = action.input.originalSizeBytes || null` coerced a **valid `0`** to `null`. Fixed to `?? null` for the numeric field (the three strings keep `|| null`: an empty file name or mime type *should* become null). This cost a second dispatch plus a hand-edit of `src/`, and it is the kind of branch the coverage floor alone would not have caught.
>
> **Two things the run handed us for free:** the generated smoke test revealed the ref format — **`attachment://v1:<64 hex>`** — and the input type brands it as `` `attachment://v${number}:${string}` ``, so a test that builds a ref must type it as `NonNullable<SourceState["originalFile"]>` or it will not compile.

The vault's premise is that a source is the **unrecoverable artefact**. Today `content` holds pasted markdown and the artefact itself — the PDF, the DOCX, the scan — is lost at the moment of ingestion. The reactor has a content-addressed attachment store, so the original can be kept: `bai/source` gains a ref to it, and the user can open it in the browser when the browser can render it, or download it when it cannot.

**Files:**
- Modify **via MCP only**, then let codegen rewrite: `document-models/source/source.json`, `document-models/source/v1/schema.graphql`, `document-models/source/v1/gen/**` — these are **derived artifacts**; hand-editing them appears to work until the next regeneration overwrites it (`CLAUDE.md`).
- Modify by hand: `document-models/source/v1/src/reducers/source-management.ts`
- Create: `document-models/source/v1/tests/attachment.test.ts`

**Interfaces:**
- Consumes: the attachment scalar the codegen already emits in every model — **`scalar AttachmentRef` is already declared** in `source/v1/schema.graphql` line 4, so no scalar work is needed.
- Produces: state fields `originalFile` / `originalFileName` / `originalMimeType` / `originalSizeBytes` / `convertedBy`, the operation `ATTACH_ORIGINAL_FILE` (id `attach-original-file`), the action creator `actions.attachOriginalFile(...)`, and the error `MissingAttachmentRefError`. Consumed by Task 9.

**Measured starting point** (read from the live model document, `getDocument` over the reactor MCP — do not trust the tree, confirm it):

| | |
|---|---|
| document id | `3b8c5de9-38d8-47ab-a9ee-1a188cdb6957` |
| drive | `vetra-a933d854` |
| name / model id | `Source` / `bai/source` |
| specifications | 1 (v1), module `source-management` |
| operations | `ingest-source`, `set-source-status`, `add-extracted-claim`, `record-extraction-stats`, `remove-extracted-claim` |
| state schema | matches the committed `schema.graphql` **exactly** — no drift to reconcile |

- [ ] **Step 1: Authenticate to the reactor MCP and confirm the model**

Per `CLAUDE.md`, `reactor-mcp` is mandatory for document-model changes, and the server is the running Switchboard's `/mcp`. `ph access-token` mints a bearer token from the CLI's own DID — no credential needs to change hands:

```bash
cd /home/beast/Documents/Powerhouse/bai-knowledge-note
umask 077 && ph access-token 2>/dev/null > /tmp/.tok && \
  printf 'authorization: Bearer %s\n' "$(cat /tmp/.tok)" > /tmp/.mcp-auth
```

Then `initialize`, `tools/list` and `getDocument` over JSON-RPC. The twelve tools are `getDocument`, `createDocument`, `getDocuments`, `deleteDocument`, `addActions`, `getDrives`, `addDrive`, `getDrive`, `deleteDrive`, `addRemoteDrive`, `getDocumentModels`, `getDocumentModelSchema`.

Expected: `getDocument` returns `state.global.name == "Source"`, `id == "bai/source"`, and the five operations above. **If the document does not resolve, stop** — do not edit `Source.json` instead; `backup-documents/Source.phd` is the recovery path.

- [ ] **Step 2: Read the operation-input shapes before dispatching**

```jsonc
{"method":"tools/call","params":{"name":"getDocumentModelSchema",
 "arguments":{"type":"powerhouse/document-model"}}}
```

Expected: `SET_STATE_SCHEMA` takes `{ id, scope, schema }`; `ADD_OPERATION` takes `{ id, moduleId, name, description, scope, ... }`; `SET_OPERATION_SCHEMA` and `SET_OPERATION_REDUCER` are keyed by **operation id**; `ADD_OPERATION_ERROR` takes `{ id, errorCode, errorName, errorDescription }`. Confirm rather than assume — these have changed between releases.

- [ ] **Step 3: Dispatch the change as ONE batched `addActions`**

Build the new schema **from the document's current value** (Step 1's output), changing only the intended lines. Give the operation ids explicitly rather than letting the system generate them — the reducer file and every later diff are easier to reason about when the ids are stable and known.

**State schema — three edits to `SourceState`:**

```graphql
type SourceState {
    title: String
    description: String
    content: String
    sourceType: SourceType
    status: SourceStatus
    provenance: SourceProvenance
    extractedClaims: [String!]!
    extractionStats: ExtractionStats
    # the artefact this source was derived from — the thing that cannot be
    # recovered once it is gone, and the reason the source exists at all
    originalFile: AttachmentRef
    originalFileName: String
    originalMimeType: String
    originalSizeBytes: Int
    # what produced `content` from it, so a re-ingest can say what changed
    convertedBy: String
    createdAt: DateTime
    createdBy: String
}
```

**The operation's schema** (a new operation on the existing `source-management` module, so its input mirrors the state fields — input types may not reference state types, and `AttachmentRef` is a scalar, so it may be used directly):

```graphql
input AttachOriginalFileInput {
    originalFile: AttachmentRef!
    originalFileName: String
    originalMimeType: String
    originalSizeBytes: Int
    convertedBy: String
    attachedAt: DateTime!
}
```

**The reducer** (pure, every value from input, `|| null` for the `Maybe` fields):

```ts
const file = action.input.originalFile;
if (!file) {
  throw new MissingAttachmentRefError("An attachment ref is required to attach an original file");
}
state.originalFile = file;
state.originalFileName = action.input.originalFileName || null;
state.originalMimeType = action.input.originalMimeType || null;
state.originalSizeBytes = action.input.originalSizeBytes || null;
state.convertedBy = action.input.convertedBy || null;
```

One error on the operation, `MISSING_ATTACHMENT_REF` / `MissingAttachmentRefError` — `CLAUDE.md` requires a named error per rejection branch, and the branch is genuinely reachable (an input whose `AttachmentRef` is `null`).

Dispatch it all as a single call, every action with `scope: "global"`:

```jsonc
{"method":"tools/call","params":{"name":"addActions","arguments":{
  "documentId":"3b8c5de9-38d8-47ab-a9ee-1a188cdb6957",
  "actions":[
    {"type":"SET_STATE_SCHEMA","scope":"global","input":{ /* full schema, current + the 5 fields */ }},
    {"type":"ADD_OPERATION","scope":"global","input":{ /* id: "attach-original-file", moduleId: "source-management", name: "ATTACH_ORIGINAL_FILE" */ }},
    {"type":"SET_OPERATION_SCHEMA","scope":"global","input":{ /* id: "attach-original-file", ... the input type above */ }},
    {"type":"ADD_OPERATION_ERROR","scope":"global","input":{ /* id: "attach-original-file", errorCode: "MISSING_ATTACHMENT_REF", ... */ }},
    {"type":"SET_OPERATION_REDUCER","scope":"global","input":{ /* id: "attach-original-file", ... the reducer above */ }}
  ]}}}
```

- [ ] **Step 4: Let codegen run, then diff — before anything else**

Vetra's codegen rewrites `source.json`, `v1/schema.graphql` and `gen/` from the model document.

```bash
git diff --stat document-models/
git diff document-models/source/v1/schema.graphql
```

**Confirm only the intended lines changed.** A model document older than the working tree will silently revert unrelated parts, and regeneration also picks up scalar-registry and emit-order changes from the **stack** (real precedent in this repo: `scalar Attachment` → `scalar AttachmentRef`, and the local-state block moving from the bottom of the file to the top — neither came from the model JSON). An alarming diff can be legitimate codegen output; confirm the source before assuming a hand-edit.

- [ ] **Step 5: Update the reducer file by hand — the second half of the two-step process**

`document-models/source/v1/src/reducers/source-management.ts` is **not** generated. Add the `attachOriginalFile` case with the same body as Step 3, next to the existing operations.

Expected: the file's operation count goes 5 → 6 and the switch has no default that swallows the new action.

- [ ] **Step 6: Tests to the coverage floor**

Create `document-models/source/v1/tests/attachment.test.ts` covering the happy path (attach after ingest, ref and metadata land), the falsy-but-valid cases (a `0` byte size must survive `|| null` — use `??`-equivalent handling or assert the coercion deliberately), and the error branch via the **operation-index** pattern, never `.toThrow()`:

```ts
expect(doc.operations.global[1].error).toBe("An attachment ref is required to attach an original file");
expect(doc.state.global.originalFile).toBeNull(); // state untouched on error
```

```bash
bun run test:coverage          # ≥95% lines/branches/functions/statements on reducers
bun run tsc
bun run lint:fix
```

Expected: all three clean. Do not lower the threshold or exclude files to pass.

- [ ] **Step 7: Rebuild the subgraph bundle**

`CLAUDE.md`: the Switchboard loads `dist/node/subgraphs/index.mjs`, so a `document-models/` change reaches the running server only after:

```bash
bun run build && ph vetra          # restart the Switchboard
```

Skipping this is silent — tests pass against source while the running server serves the old bundle.

---

### Task 9: The intake attachment surface

The user-facing half: the file they dropped is attached to the source they just created, and it opens in the browser when the browser can render it.

**Files:**
- Create: `editors/knowledge-vault/lib/attachments.ts`, `…/lib/useFileUpload.ts`, `…/lib/useAttachmentViewer.ts`, `…/lib/mime.ts`
- Create: `editors/knowledge-vault/components/OriginalFilePanel.tsx`
- Modify: the Intake view (spec §12) and `editors/source-editor/editor.tsx`
- Test: `editors/knowledge-vault/lib/mime.test.ts`

**Interfaces:**
- Consumes: `SourceState["originalFile"]` and `actions.attachOriginalFile` (Task 8); `@powerhousedao/reactor-attachments/client` (already a dependency at `6.2.3-dev.11`); `useAttachmentService` / `useAttachmentUpload` / `setAttachmentService` from `@powerhousedao/reactor-browser`.
- Produces: `ensureAttachmentService()`, `useOriginalFileUpload()`, `useAttachmentViewer()`, `isBrowserRenderable(mimeType)`, `<OriginalFilePanel source={…} />`.

**The reference implementation is in this workspace, and it is proven** — port rather than invent:

| what to port | from | what changes |
|---|---|---|
| `ensureAttachmentService()` | `umh-production-ledger/editors/production-ledger-editor/lib/attachments.ts` | nothing but the origin comment |
| hash-first upload | `…/lib/useFileUpload.ts` | the state type; the action it dispatches |
| view + download | `…/lib/useAttachmentViewer.ts` | **the mime-type handling — see below** |
| the panel | `…/components/PdfPane.tsx`, `SourceDocumentCard.tsx` | the vault's own look, `--bai-*` tokens, and non-PDF formats |

- [ ] **Step 1: The mime rule, and why the ledger's version is not enough**

The ledger hard-codes PDF: `const type = response.header.mimeType || "application/pdf"`. That is correct there (a production ledger holds one scanned PDF) and wrong here — docling accepts 29 formats, so a source may hold a `.docx`, a `.xlsx`, an `.epub` or a `.csv`. The rule the user asked for is *"open it if the browser can render it, otherwise download it"*, so make that explicit and tested:

```ts
/** Mime types a browser can render inline, so the panel can preview them. */
export function isBrowserRenderable(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const [type] = mimeType.toLowerCase().split(";");
  const m = type.trim();
  if (m === "application/pdf" || m === "text/plain" || m === "text/markdown") return true;
  return m.startsWith("image/") || m.startsWith("audio/") || m.startsWith("video/");
}
```

Deliberately **excluded**, and tested as such: `text/html` (rendering untrusted HTML injects it into the editor's origin), `image/svg+xml` (scriptable), and every OOXML/OOXML-adjacent office format — `docx`, `xlsx`, `pptx`, `odt`, `epub` — which the browser cannot open even though it can hold the bytes. Those get the download button, which is the honest answer.

`mime.ts` also carries `extensionOf(fileName)`, so a browser that gives an empty or `application/octet-stream` type still lands somewhere: the extension decides, and an unknown extension downloads.

- [ ] **Step 2: The upload, in the order the store requires**

`useAttachmentUpload()` gives `{ preprocess, upload, stage, error }`, and the flow is deliberately split so the **ref is known before the bytes are in flight** (the store is content-addressed, so the hash *is* the ref):

```ts
const result = await preprocess(file);   // hashing → the ref exists
onRef?.(result.ref);                     // dispatch attachOriginalFile with it
await upload(result);                    // stream the bytes
```

That ordering is what lets the source exist and be openable while a 30 MB upload is still running, and it is why the intake flow must dispatch the action **between** those two awaits rather than after the upload resolves. Treat the dispatched ref as pending until the upload settles.

**The library already ships the progress surface — do not hand-roll one.** `@powerhousedao/reactor-attachments/client` exports `withByteProgress`, `progressFraction`, `DEFAULT_PROGRESS_THROTTLE_MS` and `DEFAULT_ATTACHMENT_BATCH_CONCURRENCY`, so the intake view can show real bytes and a real ETA rather than an indeterminate spinner. That matters at this size: 30 MB is long enough that "working" is not enough information, and the throttle constant exists precisely so a progress callback does not flood React with renders.

**The store's own size limit is server-side and independent of our 30 MB route cap.** The client takes `maxBytes` from its caller/reservation rather than hardcoding one, and throws `UploadTooLarge(maxBytes)` when it is exceeded. So the route's `MAX_UPLOAD_BYTES` is **not** necessarily the binding constraint for attachment-backed sources — probe the running Switchboard's limit once (upload something large and read the error, or read its config) before assuming 30 MB is what the user actually gets, and record the number here when found.

- [ ] **Step 3: `ensureAttachmentService()` runs at mount, not on demand**

Both hooks must call it in a `useEffect(…, [])`, for the reason the ledger's comment records: the callbacks close over the client resolved during *that* render, so a service registered mid-upload is invisible and the call fails with `AttachmentClient not available`. Connect only constructs a service when a default drive is configured — a document in a local, browser-only drive gets none — so the vault installs its own, pointed at the paired Switchboard, with `jwtHandler` minting a short-lived Renown bearer token. Never override a service Connect already provided.

- [ ] **Step 4: The panel — preview, or download**

`<OriginalFilePanel source={…} />` renders one of four states, all of which must exist as UI:

| state | when | what the user sees |
|---|---|---|
| no attachment | `state.originalFile` is null | the upload affordance, plus a note that a manually-pasted source has no original |
| renderable | `isBrowserRenderable(state.originalMimeType)` | inline preview via an object URL (`<iframe>` for PDF, `<img>` for images, `<pre>` for text) + a Download button |
| not renderable | a real file the browser cannot open | file name, size, mime type and a **Download** button — no preview, and no pretending |
| failed | `service.get(ref)` throws | the error, and a Retry — an attachment that cannot be fetched must not look like an attachment that is absent |

The failure states are already typed by the library, so map onto them rather than inventing strings: `AttachmentNotFound` (the ref is real but the bytes are gone), `AttachmentPending` (**the upload has not finished yet** — the expected state right after a hash-first dispatch, and the one that most needs to read as "still working" rather than "broken"), `InvalidAttachmentRef`, `HashMismatch` and `SizeMismatch` (corruption — worth a different message from "missing"), and `UploadTooLarge`. `AttachmentPending` in particular is not an error condition for the panel.

Object URLs are revoked on close, when superseded, and on unmount (the ledger's `useAttachmentViewer` shows the pattern). The download path uses an `<a download>` click and revokes on a delay, because revoking immediately can cancel the download.

- [ ] **Step 5: Ties into the intake flow**

The Intake view sequences: pick a file → convert (Tasks 3–5) → the user edits the derived sections → on **Create**: `preprocess` → dispatch the creates and the `ATTACH_ORIGINAL_FILE` together → `upload`. The upload must start **before** the user is asked to wait for section editing to finish, or a 30 MB file makes the whole view feel broken while nothing is happening.

- [ ] **Step 6: Verify**

```bash
bun run tsc && bun run lint && bun run test editors/knowledge-vault/lib/mime.test.ts
```

Then, in the running app: attach a PDF (previews), a `.docx` (downloads), a `.png` (previews), and a file whose mime type the browser reports as empty (extension decides) — and confirm a second source in the same drive sees its own attachment, since the store is drive-independent and it is easy to wire a ref to the wrong document.

---

## Self-review

Run this against the spec before dispatching anything.

**1. Spec coverage.** Every §2 goal has a task: bytes in and structured text out (Tasks 1–5), every surface reaching the same implementation (`CONVERT_SERVICE_URL` + the route, Tasks 4–6), the split following authored structure and visible before anything is written (Task 1's rule, Task 3's preview-only route). §7's two settings are Task 6. §10's test table maps one-to-one onto the test steps. §11's unverified claims are Task 7.

**2. Placeholder scan.** No task contains "TBD", "similar to Task N", or a step without its content. The one conditional instruction — Task 6 Step 2's fallback if codegen misses the new subgraph — states the exact edit and how to verify it survives regeneration.

**3. Type consistency.** `SourceChunk` (Task 1) and `ConversionChunk` (Task 2) have identical shapes on purpose: the route passes `result.chunks` straight into `deriveSections`. `ConvertRouteDeps` is defined once (Task 3) and consumed by Tasks 4 and 6. `MAX_UPLOAD_BYTES` is defined once and asserted in the test that reads it. `SECTION_CHAR_CEILING` appears in the plan only as the exported constant.

**Known gap, deliberate:** nothing here creates a document, queues a task, or renders UI — that is the follow-up plan, and `POST convert` is shaped so the create half can be added as its own route without changing this one. **Tasks 8 and 9 are that follow-up's first slice**, added after the original seven: the `bai/source` attachment field (MCP-only, per `CLAUDE.md`) and the intake surface that uploads the original and previews-or-downloads it. **Task 6b** is the end-to-end verification through the running Switchboard, and Task 4's block carries the corrected schema shape and the live wiring to the service.

**Tasks 8 and 9 were added later and are not yet written against a green tree.** Their starting point is measured (the live model document, its five operations, its schema matching the tree exactly) and their mechanism is ported from a working sibling editor, but neither has been executed. If they are dispatched before Tasks 1–7, the ordering claim above is untested.

## Execution handoff

**Decision: inline execution, no subagents** (chosen 2026-09-17). Work the tasks in this session, in order, with checkpoints after Task 4 (the subgraph is complete and type-checks) and after Task 6 (registered), before the measurement.

Task order: 1 and 2 are independent and pure; 3 depends on both; 4 depends on 3; **5 (the backend) is independent and can be done first, since the code for it already exists as a spike**; 6 depends on 4; 7 depends on 5.

Subagent-driven execution remains available if this session's context becomes the constraint rather than the work.
