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

The only piece of genuine vault semantics in this feature, so it is pure, standalone and tested first.

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
 * The HTTP client for whichever conversion backend is configured — the local
 * `bun` service over docling.rs, `docling-rs-serve`, or `docling-serve`. All
 * three answer this shape, which is why the subgraph holds no backend
 * knowledge beyond a base URL.
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

/** Matches the `POST actions` / `POST sources` cap: documents, not media. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

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
    expect(convert?.options?.maxBodyBytes).toBe(2 * 1024 * 1024);
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

**Files:**
- Create: `scripts/docling-serve/server.ts`
- Create: `scripts/docling-serve/README.md`

**Interfaces:**
- Produces: the HTTP contract in the spec §5.1, consumed by `createHttpConversionService` through `CONVERT_SERVICE_URL`.

- [ ] **Step 1: Install the binding (in the repo, with bun)**

```bash
cd /home/beast/Documents/Powerhouse/bai-knowledge-note
bun add docling.rs
```
Expected: `installed docling.rs@1.55.0` plus `docling.rs-linux-x64-gnu`; `node_modules` grows by ~105 MB.

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
      const source = await openConvertible(file, dir);

      // Markdown for the source's own content: chunk text is NOT
      // markdown-quality for tables (a PDF invoice's line items come back as
      // `PART-X, QUANTITY = 480 pcs` triplets), so this call is not redundant
      // with the chunker's, and the binding exposes no json→markdown export
      // to derive it from one conversion.
      const convertStart = Date.now();
      const converted = await source.pipeline.convertFileAsync(source.path, {
        to: "markdown",
      });
      const convertMs = Date.now() - convertStart;

      const chunkStart = Date.now();
      const asJson = await source.pipeline.convertFileAsync(source.path, {
        to: "json",
      });
      // chunkDocument takes the docling-core JSON STRING, not a result object.
      const chunks = await chunkDocumentAsync(asJson.content);
      const chunkMs = Date.now() - chunkStart;

      return json({
        markdown: converted.content,
        chunks,
        format: extname(filename).replace(/^\./, "") || null,
        inputName: filename,
        timings: { convertMs, chunkMs, totalMs: Date.now() - started },
        backend: "docling.rs",
        normalized: source.normalized,
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
 * The file to convert, and whether it had to be rewritten first.
 *
 * pdfium refuses some valid PDFs at load — measured on a 238-page O'Reilly
 * book: `PdfiumLibraryInternalError(FormatError)`, on a file that is neither
 * encrypted nor malformed to any other reader. A rewrite with qpdf (fast,
 * lossless) and failing that gs (slower, re-renders) fixes it. This runs on
 * the FormatError path only: rewriting every PDF up front costs time for no
 * benefit on the files that already work.
 *
 * `Bun.spawn` is right here — this is the service, not a subgraph, and a
 * subgraph has no process control by design.
 */
async function openConvertible(
  file: string,
  dir: string,
): Promise<{ path: string; pipeline: Pipeline; normalized: boolean }> {
  if (!file.toLowerCase().endsWith(".pdf")) {
    return { path: file, pipeline, normalized: false };
  }
  try {
    // Page 1 is enough to learn whether pdfium can open the file at all.
    await pipeline.convertFileAsync(file, { to: "markdown", pages: "1" });
    return { path: file, pipeline, normalized: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/FormatError|pdfium error/i.test(message)) throw error;
  }

  const rewritten = join(dir, "normalized.pdf");
  const qpdf = Bun.spawn(
    ["qpdf", "--linearize", "--object-streams=disable", file, rewritten],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await qpdf.exited) === 0) {
    return { path: rewritten, pipeline, normalized: true };
  }
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
  if ((await gs.exited) === 0) {
    return { path: rewritten, pipeline, normalized: true };
  }
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

- [ ] **Step 5: Type-check and lint**

Run: `bun run tsc && bun run lint:fix`
Expected: exits 0. `tsconfig.json` includes `scripts/**`, so the service is type-checked; `docling.rs` ships its own `.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add scripts/docling-serve package.json bun.lock
git commit -m "feat(convert): a local conversion service over docling.rs"
```

---

### Task 6: Register the subgraph and the settings

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

## Self-review

Run this against the spec before dispatching anything.

**1. Spec coverage.** Every §2 goal has a task: bytes in and structured text out (Tasks 1–5), every surface reaching the same implementation (`CONVERT_SERVICE_URL` + the route, Tasks 4–6), the split following authored structure and visible before anything is written (Task 1's rule, Task 3's preview-only route). §7's two settings are Task 6. §10's test table maps one-to-one onto the test steps. §11's unverified claims are Task 7.

**2. Placeholder scan.** No task contains "TBD", "similar to Task N", or a step without its content. The one conditional instruction — Task 6 Step 2's fallback if codegen misses the new subgraph — states the exact edit and how to verify it survives regeneration.

**3. Type consistency.** `SourceChunk` (Task 1) and `ConversionChunk` (Task 2) have identical shapes on purpose: the route passes `result.chunks` straight into `deriveSections`. `ConvertRouteDeps` is defined once (Task 3) and consumed by Tasks 4 and 6. `MAX_UPLOAD_BYTES` is defined once and asserted in the test that reads it. `SECTION_CHAR_CEILING` appears in the plan only as the exported constant.

**Known gap, deliberate:** nothing here creates a document, queues a task, or renders UI — that is the follow-up plan, and `POST convert` is shaped so the create half can be added as its own route without changing this one.

## Execution handoff

**1. Subagent-Driven (recommended)** — a fresh subagent per task, task review between, and a whole-branch review at the end. Task order matters: 1 and 2 are independent and pure; 3 depends on both; 4 depends on 3; 5 is independent (the backend) and can run in parallel with 1–4; 6 depends on 4; 7 depends on 5.

**2. Inline Execution** — work the tasks in this session in order, with checkpoints after Task 4 (the subgraph is complete and type-checks) and after Task 6 (registered), before the measurement.

Which approach?
