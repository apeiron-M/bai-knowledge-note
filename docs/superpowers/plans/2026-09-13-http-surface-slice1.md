# Vault HTTP Surface — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated, attributable HTTP write path (`POST actions`, `POST/PATCH/DELETE relationships`) and two LLM-shaped reads (`GET search`, `GET notes/:id[.md]`) to the vault, served by the Switchboard under `/api/@powerhousedao/knowledge-note/…`.

**Architecture:** A new REST-only `subgraphs/http/` subgraph registers handlers in `onSetup()` against `this.http`. Handlers are factories over a narrow `HttpRouteDeps` interface so they are tested with fakes. Pure `lib/` modules do envelope stamping, linting, articulation and error shaping; `lib/lint/` validates every action via the models' generated zod schemas plus hand rules. The shared search body is extracted from the knowledge-graph resolver so REST and GraphQL cannot drift.

**Tech Stack:** TypeScript (nodenext, ESM, `.js` import suffixes), `@powerhousedao/reactor-api` `BaseSubgraph` + `IHttpScope`, `@powerhousedao/reactor` `IReactorClient`, generated zod schemas under `document-models/*/v1/gen/schema/zod.js`, vitest, oxlint/oxfmt, bun.

**Spec:** `docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md`

**Scope note (owner direction, 2026-09-13):** this plan now covers **slice 1 (Tasks 1–13), the
atomic claim guard, and slice 2 (Tasks 14–19)**. Slice 2's endpoint design is the parent plan's
slice 2 (`docs/plans/http-surface.md` §Slice 2), amended here where the probe and this
architecture require it. The slice-1 spec remains the design of record for Tasks 1–13; Tasks
14–19 follow the parent plan plus the amendments below.

**Amendments to the spec discovered while planning (the spec is updated in Task 13):**

1. **The read routes take a `drive` query parameter (UUID).** The graph index is namespaced per drive (`getDb(subgraph, driveId)`), and the GraphQL API likewise requires `driveId` on every query. `GET search` requires `drive`; `GET notes/:id[.md]` requires `drive` (markdown links carry it). There is no safe server-side "the vault drive" default on a package that can serve several.
2. **`POST actions` accepts `allowLiteralEscapes?: boolean`** (default `false`), the server-side equivalent of the CLI's `--allow-literal-escapes`, matching the spec's lint escape hatch.
3. `GET notes/:id` accepts UUID only; slug resolution is deferred with the rest of the GraphQL identifier conveniences.
4. **The atomic claim guard moves into this branch** (Task 14). It changes the `bai/pipeline-queue` document model: `ADD_TASK` gains `DuplicateTaskIdError`, `ASSIGN_TASK` gains `TaskAlreadyAssignedError`, both via the two-step model change (MCP or CLI) before the reducer source is touched.
5. **Slice 2 routes reuse `HttpRouteDeps`** and the `drive` parameter; graph-backed reads call the same `createGraphQuery` the GraphQL surface uses. `activity`, `notes/:id/history`, `access-map` and `admin/*` are privileged (see Task 18).

**Prerequisites for the atomic claim guard (Task 14), neither met yet:**

- The running reactor has **no Vetra drive containing the document models** (`powerhouse` is
  empty), so the `bai/pipeline-queue` model document must be imported before its model can be
  changed: in Connect, drag `backup-documents/PipelineQueue.phd` into a Vetra drive and record its
  document id (`switchboard docs list --format json` will show it).
- This OpenCode session has **no `reactor-mcp` tools** — `.mcp.json` configures the server for
  Claude Code only. To run the model change through MCP, add to the project `opencode.json`:
  ```json
  "mcp": { "reactor-mcp": { "type": "remote", "url": "http://localhost:4001/mcp", "enabled": true } }
  ```
  and restart opencode. The fallback is the `switchboard` CLI (`switchboard docs apply`), already
  installed and pointed at `http://localhost:4001/graphql`; it cannot import the `.phd`, only the
  Connect drag-and-drop can.

## Global Constraints

- Local toolchain is **bun**: `bun install`, `bun run tsc`, `bun run lint:fix`, `bun run test`, `bun run build`, `bunx`. Never `npm`/`pnpm` locally. Do not rewrite `node …` invocations in `package.json` scripts.
- `module: nodenext`, `verbatimModuleSyntax: true`, `strict: true`: every relative import ends in `.js`; type-only imports use `import type`.
- Path aliases exist only for `document-models`, `editors`, `processors/*`, `subgraphs`, `subgraphs/*`. Deep imports (e.g. a model's `gen/schema/zod.js`) use relative paths — importing a model's top-level barrel pulls in `hooks.js` and `@powerhousedao/reactor-browser`, which must not enter the node subgraph bundle.
- Never edit files in `gen/` folders or the codegen-owned `subgraphs/index.ts` by hand; `ph-cli generate subgraph` updates the barrel.
- Subgraph changes only reach the running Switchboard after `bun run build` and a `ph vetra` restart.
- Route paths are relative; `auth` defaults to `renown`; routes match in registration order; registering the same method+path twice throws.
- Reducer coverage floor stays 95%; new `subgraphs/http/lib/**` modules target 100% line/branch coverage.
- Commit style: conventional commits (`feat(http): …`, `test(http): …`, `docs(http): …`).
- Never commit tokens or secrets; the integration smoke uses `$TOKEN` from the environment (`TOKEN=$(ph access-token)` or the user's test token).

---

### Task 1: Scaffold `subgraphs/http` and prove the route namespace

**Files:**
- Create (codegen): `subgraphs/http/{index.ts,schema.ts,resolvers.ts,lib.ts}`
- Modify (codegen): `subgraphs/index.ts`
- Modify: `subgraphs/http/index.ts` (add the `ping` route)

**Interfaces:**
- Consumes: `BaseSubgraph` (`@powerhousedao/reactor-api`), `this.http` (`IHttpScope`).
- Produces: `HttpSubgraph` exported in the barrel as `HttpSubgraph`; route namespace `/api/@powerhousedao/knowledge-note/`.

- [ ] **Step 1: Scaffold the subgraph**

Run:
```bash
ph-cli generate subgraph --name http
```
Expected: `subgraphs/http/index.ts`, `schema.ts`, `resolvers.ts`, `lib.ts` created; `subgraphs/index.ts` gains `export * as HttpSubgraph from "./http/index.js";`.

- [ ] **Step 2: Add the `ping` route to `onSetup`**

Replace `subgraphs/http/index.ts` with:
```ts
import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { getResolvers } from "./resolvers.js";
import { schema } from "./schema.js";

export class HttpSubgraph extends BaseSubgraph {
  name = "http";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  async onSetup(): Promise<void> {
    try {
      this.http.get("ping", { auth: "renown" }, (_request, ctx) =>
        Response.json({ ok: true, subgraph: "http", user: ctx.user?.address ?? null }),
      );
    } catch (error) {
      // An UnroutableScope throws here; the GraphQL surface must survive it.
      console.warn(
        `[http] route registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onDisconnect(): Promise<void> {}
}
```

- [ ] **Step 3: Type-check and run the existing suite**

Run: `bun run tsc && bun run test`
Expected: both pass; the only changes are the new files.

- [ ] **Step 4: Build and restart the Switchboard**

Run: `bun run build`
Expected: `dist/node/subgraphs/index.mjs` re-export list includes `HttpSubgraph`.
Then restart the local reactor (`ph vetra`) in its terminal.

- [ ] **Step 5: Verify the route live**

```bash
TOKEN=$(ph access-token)   # or the token the user supplied
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4001/api/@powerhousedao/knowledge-note/ping
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4001/api/%40powerhousedao/knowledge-note/ping"
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:4001/api/@powerhousedao/knowledge-note/ping
```
Expected: the first two return `{"ok":true,"subgraph":"http","user":"0x…"}`; the third returns `401`.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/http subgraphs/index.ts
git commit -m "feat(http): scaffold the http subgraph and prove the route namespace"
```

---

### Task 2: `lib/envelope.ts` — deterministic action stamping

**Files:**
- Create: `subgraphs/http/lib/envelope.ts`
- Test: `subgraphs/http/lib/envelope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RawAction { id?: string; timestampUtcMs?: string; scope?: string; type: string; input: Record<string, unknown>; context?: Record<string, unknown>; }
  export function stampActions(actions: RawAction[], now: () => Date, uuid: () => string, defaultScope: string): RawAction[];
  ```
  Fills `id`/`timestampUtcMs` only when absent/blank; sets `scope` to `defaultScope` only when absent; never touches `input`.

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/envelope.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { stampActions } from "./envelope.js";

const now = () => new Date("2026-09-13T12:00:00.000Z");
let n = 0;
const uuid = () => `uuid-${++n}`;

describe("stampActions", () => {
  it("fills id, timestampUtcMs and scope when absent", () => {
    const [out] = stampActions([{ type: "SET_TITLE", input: { title: "x" } }], now, uuid, "global");
    expect(out.id).toBe("uuid-1");
    expect(out.timestampUtcMs).toBe("2026-09-13T12:00:00.000Z");
    expect(out.scope).toBe("global");
  });

  it("preserves values the caller supplied", () => {
    const [out] = stampActions(
      [{ id: "agent-id", timestampUtcMs: "2026-01-01T00:00:00.000Z", scope: "document", type: "ADD_RELATIONSHIP", input: {} }],
      now, uuid, "global",
    );
    expect(out.id).toBe("agent-id");
    expect(out.timestampUtcMs).toBe("2026-01-01T00:00:00.000Z");
    expect(out.scope).toBe("document");
  });

  it("preserves an input object byte-for-byte, including key order", () => {
    const input = { zebra: 1, alpha: { two: 2, one: 1 } };
    const [out] = stampActions([{ type: "X", input }], now, uuid, "global");
    expect(JSON.stringify(out.input)).toBe('{"zebra":1,"alpha":{"two":2,"one":1}}');
    expect(out.input).toBe(input);
  });

  it("does not mutate the caller's array or objects", () => {
    const action = { type: "X", input: {} };
    const actions = [action];
    const out = stampActions(actions, now, uuid, "global");
    expect(out).not.toBe(actions);
    expect(out[0]).not.toBe(action);
    expect(action).toEqual({ type: "X", input: {} });
  });

  it("treats an empty string id as absent", () => {
    const [out] = stampActions([{ id: "", timestampUtcMs: "", scope: "", type: "X", input: {} }], now, uuid, "global");
    expect(out.id).toBe("uuid-1");
    expect(out.timestampUtcMs).toBe("2026-09-13T12:00:00.000Z");
    expect(out.scope).toBe("global");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test subgraphs/http/lib/envelope.test.ts`
Expected: FAIL — `Cannot find module './envelope.js'`.

- [ ] **Step 3: Implement**

`subgraphs/http/lib/envelope.ts`:
```ts
export interface RawAction {
  id?: string;
  timestampUtcMs?: string;
  scope?: string;
  type: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export function stampActions(
  actions: RawAction[],
  now: () => Date,
  uuid: () => string,
  defaultScope: string,
): RawAction[] {
  return actions.map((action) => ({
    ...action,
    id: action.id ? action.id : uuid(),
    timestampUtcMs: action.timestampUtcMs ? action.timestampUtcMs : now().toISOString(),
    scope: action.scope ? action.scope : defaultScope,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test subgraphs/http/lib/envelope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add subgraphs/http/lib/envelope.ts subgraphs/http/lib/envelope.test.ts
git commit -m "feat(http): stamp action envelopes without touching signed input"
```

---

### Task 3: `lib/articulation.ts` — the reason rule on edges

**Files:**
- Create: `subgraphs/http/lib/articulation.ts`
- Test: `subgraphs/http/lib/articulation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BARE_LINK_TYPES: ReadonlySet<string>;          // CORE_IDEA, CHILD_MOC
  export const EDGE_CONFIDENCE: readonly ["grounded", "established", "speculative"];
  export function checkArticulation(input: { type: string; reason?: string; confidence?: string }): string | null; // null = ok, string = message
  ```

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/articulation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkArticulation } from "./articulation.js";

const reason = "The note extends the target's claim about operation storage to the write cache.";

describe("checkArticulation", () => {
  it("accepts a long, specific reason on a knowledge edge", () => {
    expect(checkArticulation({ type: "BUILDS_ON", reason, confidence: "established" })).toBeNull();
  });

  it("rejects a knowledge edge without a reason", () => {
    expect(checkArticulation({ type: "RELATES_TO" })).toMatch(/reason/);
  });

  it("rejects a reason shorter than 20 characters", () => {
    expect(checkArticulation({ type: "RELATES_TO", reason: "relates to it" })).toMatch(/20/);
  });

  it("rejects placeholder reasons", () => {
    for (const r of ["because", "TODO", "tbd", "related", "RELATES_TO is why this exists here"]) {
      expect(checkArticulation({ type: "RELATES_TO", reason: r })).not.toBeNull();
    }
  });

  it("allows bare CORE_IDEA and CHILD_MOC", () => {
    expect(checkArticulation({ type: "CORE_IDEA" })).toBeNull();
    expect(checkArticulation({ type: "CHILD_MOC" })).toBeNull();
  });

  it("rejects an unknown confidence", () => {
    expect(checkArticulation({ type: "RELATES_TO", reason, confidence: "certain" })).toMatch(/confidence/);
  });

  it("accepts each of the three confidence levels and no confidence", () => {
    for (const c of ["grounded", "established", "speculative", undefined]) {
      expect(checkArticulation({ type: "RELATES_TO", reason, confidence: c })).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test subgraphs/http/lib/articulation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`subgraphs/http/lib/articulation.ts`:
```ts
export const BARE_LINK_TYPES: ReadonlySet<string> = new Set(["CORE_IDEA", "CHILD_MOC"]);

export const EDGE_CONFIDENCE = ["grounded", "established", "speculative"] as const;
export type EdgeConfidence = (typeof EDGE_CONFIDENCE)[number];

const MIN_REASON_LENGTH = 20;
const PLACEHOLDERS = new Set(["because", "todo", "tbd", "related", "relates to", "n/a", "none"]);

export function checkArticulation(input: {
  type: string;
  reason?: string;
  confidence?: string;
}): string | null {
  if (input.confidence !== undefined && !(EDGE_CONFIDENCE as readonly string[]).includes(input.confidence)) {
    return `confidence must be one of ${EDGE_CONFIDENCE.join(", ")}`;
  }
  if (BARE_LINK_TYPES.has(input.type)) return null;

  const reason = input.reason?.trim() ?? "";
  if (!reason) return `a reason is required for ${input.type} edges`;
  if (reason.length < MIN_REASON_LENGTH) {
    return `reason must be at least ${MIN_REASON_LENGTH} characters`;
  }
  const normalized = reason.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (PLACEHOLDERS.has(normalized) || normalized === input.type.toLowerCase()) {
    return "reason must articulate why the link exists, not restate the link type";
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test subgraphs/http/lib/articulation.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add subgraphs/http/lib/articulation.ts subgraphs/http/lib/articulation.test.ts
git commit -m "feat(http): enforce the link articulation rule server-side"
```

---

### Task 4: `lib/respond.ts` — one error envelope and reactor error mapping

**Files:**
- Create: `subgraphs/http/lib/respond.ts`
- Test: `subgraphs/http/lib/respond.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class HttpError extends Error { constructor(status: number, code: string, message: string, details?: unknown[]); }
  export function jsonError(error: unknown): Response;
  export const OK_CACHE: Record<string, string>;  // { "Cache-Control": "private, max-age=0" }
  ```
  `jsonError` maps `HttpError` to `{ error, code, details? }`; `CanonicalDocumentIdResolutionError`-shaped errors (name check) to 404 `NOT_FOUND`; names containing `permission`/`Forbidden` to 403; anything else to 500 `INTERNAL` with a generic message.

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/respond.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HttpError, jsonError } from "./respond.js";

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("jsonError", () => {
  it("shapes an HttpError with status, code and details", async () => {
    const res = jsonError(new HttpError(400, "LINT_REACTOR", "2 findings", [{ path: "actions[0].input.content" }]));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await body(res)).toEqual({
      error: "2 findings",
      code: "LINT_REACTOR",
      details: [{ path: "actions[0].input.content" }],
    });
  });

  it("maps a document-not-found error to 404", async () => {
    const err = new Error("missing");
    err.name = "CanonicalDocumentIdResolutionError";
    const res = jsonError(err);
    expect(res.status).toBe(404);
    expect((await body(res)).code).toBe("NOT_FOUND");
  });

  it("maps a permission refusal to 403", async () => {
    const err = new Error("insufficient permissions to execute operation on this document");
    err.name = "ForbiddenError";
    const res = jsonError(err);
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("FORBIDDEN");
  });

  it("maps anything else to 500 without echoing the message", async () => {
    const res = jsonError(new Error("secret token abc123 leaked here"));
    expect(res.status).toBe(500);
    const payload = await body(res);
    expect(payload.code).toBe("INTERNAL");
    expect(JSON.stringify(payload)).not.toContain("abc123");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test subgraphs/http/lib/respond.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`subgraphs/http/lib/respond.ts`:
```ts
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const OK_CACHE = { "Cache-Control": "private, max-age=0" };

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
      { status: error.status },
    );
  }
  if (error instanceof Error && error.name === "CanonicalDocumentIdResolutionError") {
    return Response.json({ error: "Document not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (error instanceof Error && /forbidden|permission/i.test(`${error.name} ${error.message}`)) {
    return Response.json({ error: "Insufficient permissions", code: "FORBIDDEN" }, { status: 403 });
  }
  return Response.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test subgraphs/http/lib/respond.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add subgraphs/http/lib/respond.ts subgraphs/http/lib/respond.test.ts
git commit -m "feat(http): one JSON error envelope with reactor error mapping"
```

---

### Task 5: `lib/deps.ts` and `lib/authorize.ts`

**Files:**
- Create: `subgraphs/http/lib/deps.ts`
- Create: `subgraphs/http/lib/authorize.ts`
- Test: `subgraphs/http/lib/authorize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // deps.ts
  export interface HttpRouteDeps {
    reactorClient: Pick<IReactorClient, "get" | "getOperations" | "execute" | "executeAsync" | "waitForJob">;
    resolveCanonicalDocumentId: BaseSubgraph["resolveCanonicalDocumentId"];
    authorization: Pick<IAuthorizationService, "canRead" | "canWrite" | "canMutate" | "isSupremeAdmin">;
    now(): Date;
    uuid(): string;
  }
  // authorize.ts
  export function requireUser(ctx: RouteContext): NonNullable<RouteContext["user"]>;
  export async function canonicalForRead(deps, identifier: string, ctx): Promise<string>;
  export async function canonicalForWrite(deps, identifier: string, ctx): Promise<string>;
  ```

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/authorize.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { canonicalForRead, canonicalForWrite, requireUser } from "./authorize.js";

const ctx = {
  user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:zTest" },
  params: {}, authEnabled: true, transport: { proto: "http", host: "x", prefix: "", baseUrl: "http://x" },
} as unknown as RouteContext;

function deps(overrides: Partial<HttpRouteDeps> = {}): HttpRouteDeps {
  return {
    reactorClient: {} as HttpRouteDeps["reactorClient"],
    resolveCanonicalDocumentId: vi.fn(async () => "canonical-id") as unknown as HttpRouteDeps["resolveCanonicalDocumentId"],
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    uuid: () => "uuid",
    ...overrides,
  };
}

describe("authorize", () => {
  it("throws 401 when no user is present", () => {
    expect(() => requireUser({ ...ctx, user: undefined } as unknown as RouteContext))
      .toThrowError(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });

  it("returns the canonical id when the caller may read", async () => {
    await expect(canonicalForRead(deps(), "doc", ctx)).resolves.toBe("canonical-id");
  });

  it("throws 403 when canRead is false", async () => {
    const d = deps();
    d.authorization.canRead = vi.fn(async () => false);
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("throws 403 when canWrite is false", async () => {
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    await expect(canonicalForWrite(d, "doc", ctx)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test subgraphs/http/lib/authorize.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`subgraphs/http/lib/deps.ts`:
```ts
import type { IReactorClient } from "@powerhousedao/reactor";
import type { BaseSubgraph, IAuthorizationService } from "@powerhousedao/reactor-api";

export interface HttpRouteDeps {
  reactorClient: Pick<
    IReactorClient,
    "get" | "getOperations" | "execute" | "executeAsync" | "waitForJob"
  >;
  resolveCanonicalDocumentId: BaseSubgraph["resolveCanonicalDocumentId"];
  authorization: Pick<IAuthorizationService, "canRead" | "canWrite" | "canMutate" | "isSupremeAdmin">;
  now(): Date;
  uuid(): string;
}
```

`subgraphs/http/lib/authorize.ts`:
```ts
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";

export function requireUser(ctx: RouteContext): NonNullable<RouteContext["user"]> {
  if (!ctx.user) {
    throw new HttpError(401, "UNAUTHENTICATED", "A verified bearer is required");
  }
  return ctx.user;
}

async function canonical(deps: HttpRouteDeps, identifier: string, ctx: RouteContext): Promise<string> {
  const id = await deps.resolveCanonicalDocumentId(identifier, ctx);
  return id;
}

export async function canonicalForRead(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<string> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canRead(id, user.address))) {
    throw new HttpError(403, "FORBIDDEN", `No read access to ${identifier}`);
  }
  return id;
}

export async function canonicalForWrite(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<string> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canWrite(id, user.address))) {
    throw new HttpError(403, "FORBIDDEN", `No write access to ${identifier}`);
  }
  return id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test subgraphs/http/lib/authorize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add subgraphs/http/lib/deps.ts subgraphs/http/lib/authorize.ts subgraphs/http/lib/authorize.test.ts
git commit -m "feat(http): route dependencies and canonical authorization helpers"
```

---

### Task 6: `lib/lint/` — generic validation (unknown actions, zod inputs, escapes)

**Files:**
- Create: `subgraphs/http/lib/lint/types.ts`
- Create: `subgraphs/http/lib/lint/model-registry.ts`
- Create: `subgraphs/http/lib/lint/index.ts`
- Test: `subgraphs/http/lib/lint/index.test.ts`

**Interfaces:**
- Consumes: generated zod modules by relative path, e.g. `../../../../document-models/source/v1/gen/schema/zod.js`.
- Produces:
  ```ts
  export interface LintFinding { path: string; rule: string; class: "REACTOR_REJECTS" | "VAULT_CONVENTION"; message: string; }
  export interface LintOptions { allowLiteralEscapes?: boolean; }
  export function lintActions(documentType: string, state: unknown, actions: RawAction[], options?: LintOptions): LintFinding[];
  ```

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/lint/index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { lintActions } from "./index.js";

const state = { global: {} };

describe("lintActions — generic rules", () => {
  it("rejects an action type the model does not define", () => {
    const findings = lintActions("bai/source", state, [{ type: "NOT_A_REAL_ACTION", input: {} }]);
    expect(findings).toEqual([
      expect.objectContaining({ path: "actions[0].type", rule: "UNKNOWN_ACTION", class: "REACTOR_REJECTS" }),
    ]);
  });

  it("rejects an input the model's zod schema refuses", () => {
    const findings = lintActions("bai/source", state, [
      { type: "INGEST_SOURCE", input: { title: "x", sourceType: "MANUAL_ENTRY" } },
    ]);
    expect(findings.some((f) => f.rule === "INVALID_INPUT" && f.path.startsWith("actions[0].input"))).toBe(true);
  });

  it("accepts a valid action", () => {
    const findings = lintActions("bai/source", state, [
      {
        type: "INGEST_SOURCE",
        input: {
          title: "x",
          content: "body",
          sourceType: "MANUAL_ENTRY",
          createdAt: "2026-09-13T12:00:00.000Z",
        },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("rejects literal \\n escapes and honours allowLiteralEscapes", () => {
    const action = { type: "INGEST_SOURCE", input: { title: "x", content: "line\\nline", sourceType: "MANUAL_ENTRY", createdAt: "2026-09-13T12:00:00.000Z" } };
    expect(lintActions("bai/source", state, [action]).some((f) => f.rule === "LITERAL_ESCAPE")).toBe(true);
    expect(lintActions("bai/source", state, [action], { allowLiteralEscapes: true })).toEqual([]);
  });

  it("rejects an unknown document type", () => {
    const findings = lintActions("bai/nope", state, [{ type: "SET_TITLE", input: {} }]);
    expect(findings).toEqual([expect.objectContaining({ rule: "UNKNOWN_DOCUMENT_TYPE", class: "REACTOR_REJECTS" })]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test subgraphs/http/lib/lint/index.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `types.ts`**

```ts
import type { RawAction } from "../envelope.js";

export interface LintFinding {
  path: string;
  rule: string;
  class: "REACTOR_REJECTS" | "VAULT_CONVENTION";
  message: string;
}

export interface LintOptions {
  allowLiteralEscapes?: boolean;
}

export type ModelRule = (
  action: RawAction,
  index: number,
  state: Record<string, unknown>,
) => LintFinding[];
```

- [ ] **Step 4: Implement `model-registry.ts`**

The registry imports each model's zod module relatively (never the barrel — it pulls browser hooks) and builds `actionType → schema factory` from every exported `*InputSchema` function.

```ts
import * as knowledgeNote from "../../../../document-models/knowledge-note/v1/gen/schema/zod.js";
import * as moc from "../../../../document-models/moc/v1/gen/schema/zod.js";
import * as source from "../../../../document-models/source/v1/gen/schema/zod.js";
import * as pipelineQueue from "../../../../document-models/pipeline-queue/v1/gen/schema/zod.js";
import * as healthReport from "../../../../document-models/health-report/v1/gen/schema/zod.js";
import * as vaultConfig from "../../../../document-models/vault-config/v1/gen/schema/zod.js";
import * as observation from "../../../../document-models/observation/v1/gen/schema/zod.js";
import * as tension from "../../../../document-models/tension/v1/gen/schema/zod.js";
import * as researchClaim from "../../../../document-models/research-claim/v1/gen/schema/zod.js";
import * as derivation from "../../../../document-models/derivation/v1/gen/schema/zod.js";
import * as scopeOfWork from "../../../../document-models/scope-of-work/v1/gen/schema/zod.js";
import * as wbs from "../../../../document-models/work-breakdown-structure/v1/gen/schema/zod.js";

type SchemaFactory = () => { safeParse: (input: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } };

const MODULES: Record<string, Record<string, unknown>> = {
  "bai/knowledge-note": knowledgeNote,
  "bai/moc": moc,
  "bai/source": source,
  "bai/pipeline-queue": pipelineQueue,
  "bai/health-report": healthReport,
  "bai/vault-config": vaultConfig,
  "bai/observation": observation,
  "bai/tension": tension,
  "bai/research-claim": researchClaim,
  "bai/derivation": derivation,
  "powerhouse/scopeofwork": scopeOfWork,
  "bai/wbs": wbs,
};

export function pascalToScreamingSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function schemaFor(documentType: string, actionType: string): SchemaFactory | undefined {
  const module = MODULES[documentType];
  if (!module) return undefined;
  for (const [key, value] of Object.entries(module)) {
    if (typeof value !== "function" || !key.endsWith("InputSchema")) continue;
    const action = pascalToScreamingSnake(key.slice(0, -"InputSchema".length));
    if (action === actionType) return value as SchemaFactory;
  }
  return undefined;
}

export function operationsFor(documentType: string): Set<string> | undefined {
  const module = MODULES[documentType];
  if (!module) return undefined;
  const out = new Set<string>();
  for (const key of Object.keys(module)) {
    if (key.endsWith("InputSchema")) out.add(pascalToScreamingSnake(key.slice(0, -"InputSchema".length)));
  }
  return out;
}

export function hasDocumentType(documentType: string): boolean {
  return documentType in MODULES;
}
```

- [ ] **Step 5: Implement `index.ts`**

```ts
import type { RawAction } from "../envelope.js";
import { hasDocumentType, operationsFor, schemaFor } from "./model-registry.js";
import { RULES } from "./rules.js";
import type { LintFinding, LintOptions } from "./types.js";

const LITERAL_ESCAPE = /\\(n|t|r)/;

function scanEscapes(value: unknown, path: string, findings: LintFinding[]): void {
  if (typeof value === "string") {
    if (LITERAL_ESCAPE.test(value)) {
      findings.push({
        path,
        rule: "LITERAL_ESCAPE",
        class: "VAULT_CONVENTION",
        message: "string contains a literal \\n/\\t/\\r; send real line breaks or pass allowLiteralEscapes",
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanEscapes(item, `${path}[${i}]`, findings));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) scanEscapes(item, `${path}.${key}`, findings);
  }
}

export function lintActions(
  documentType: string,
  state: unknown,
  actions: RawAction[],
  options: LintOptions = {},
): LintFinding[] {
  const findings: LintFinding[] = [];
  if (!hasDocumentType(documentType)) {
    return [{
      path: "documentType",
      rule: "UNKNOWN_DOCUMENT_TYPE",
      class: "REACTOR_REJECTS",
      message: `No lint rules registered for ${documentType}`,
    }];
  }
  const operations = operationsFor(documentType) ?? new Set<string>();
  const global = (state as { global?: Record<string, unknown> } | undefined)?.global ?? {};

  actions.forEach((action, index) => {
    const base = `actions[${index}]`;
    if (!operations.has(action.type)) {
      findings.push({
        path: `${base}.type`,
        rule: "UNKNOWN_ACTION",
        class: "REACTOR_REJECTS",
        message: `${action.type} is not an operation of ${documentType}`,
      });
      return;
    }
    const factory = schemaFor(documentType, action.type);
    if (factory) {
      const parsed = factory().safeParse(action.input);
      if (!parsed.success) {
        for (const issue of parsed.error?.issues ?? []) {
          findings.push({
            path: `${base}.input.${issue.path.join(".")}`.replace(/\.$/, ""),
            rule: "INVALID_INPUT",
            class: "REACTOR_REJECTS",
            message: issue.message,
          });
        }
        return;
      }
    }
    if (!options.allowLiteralEscapes) scanEscapes(action.input, `${base}.input`, findings);
    for (const rule of RULES[documentType] ?? []) {
      findings.push(...rule(action, index, global));
    }
  });

  return findings;
}

export type { LintFinding, LintOptions } from "./types.js";
```

- [ ] **Step 6: Create the empty rules table and run tests**

`subgraphs/http/lib/lint/rules.ts` for now:
```ts
import type { ModelRule } from "./types.js";

export const RULES: Record<string, ModelRule[]> = {};
```
Run: `bun run test subgraphs/http/lib/lint/index.test.ts`
Expected: PASS (5 tests) — the hand rules arrive in Task 7.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/http/lib/lint
git commit -m "feat(http): lint actions against generated zod schemas and model operation sets"
```

### Task 7: Hand lint rules (conventions the reducers do not check)

**Files:**
- Create: `subgraphs/http/lib/lint/rules/knowledge-note.ts`
- Create: `subgraphs/http/lib/lint/rules/moc.ts`
- Create: `subgraphs/http/lib/lint/rules/pipeline-queue.ts`
- Create: `subgraphs/http/lib/lint/rules/scope-of-work.ts`
- Create: `subgraphs/http/lib/lint/rules/wbs.ts`
- Modify: `subgraphs/http/lib/lint/rules.ts`
- Test: `subgraphs/http/lib/lint/rules.test.ts`

**Interfaces:**
- Consumes: `ModelRule` from `../types.js`, `RawAction` from `../../envelope.js`.
- Produces: exported rule arrays; `RULES: Record<documentType, ModelRule[]>` aggregates them.

- [ ] **Step 1: Write the failing tests**

`subgraphs/http/lib/lint/rules.test.ts` — each case is one `it`, calling `lintActions` with the model's document type and asserting the rule code:
```ts
import { describe, expect, it } from "vitest";
import { lintActions } from "./index.js";

const note = (input: Record<string, unknown>, type: string, state: Record<string, unknown> = { status: "DRAFT" }) =>
  lintActions("bai/knowledge-note", { global: state }, [{ type, input }]);

describe("knowledge-note rules", () => {
  it("rejects a description longer than 200 UTF-16 units", () => {
    expect(note({ description: "x".repeat(201), updatedAt: "t" }, "SET_DESCRIPTION").map((f) => f.rule)).toContain("DESCRIPTION_TOO_LONG");
  });
  it("accepts exactly 200 units", () => {
    expect(note({ description: "x".repeat(200), updatedAt: "t" }, "SET_DESCRIPTION")).toEqual([]);
  });
  it("rejects a metadata field outside the whitelist", () => {
    expect(note({ field: "nope", value: "v", updatedAt: "t" }, "SET_METADATA_FIELD").map((f) => f.rule)).toContain("INVALID_METADATA_FIELD");
  });
  it("rejects a list field outside the whitelist", () => {
    expect(note({ field: "nope", values: [], updatedAt: "t" }, "SET_METADATA_LIST_FIELD").map((f) => f.rule)).toContain("INVALID_METADATA_LIST_FIELD");
  });
  it("flags a foreign noteType as a vault convention", () => {
    const found = note({ noteType: "WRONG_CASE", updatedAt: "t" }, "SET_NOTE_TYPE");
    expect(found).toEqual([expect.objectContaining({ rule: "NOTE_TYPE_CONVENTION", class: "VAULT_CONVENTION" })]);
  });
  it("rejects a negative PATCH_CONTENT offset", () => {
    expect(note({ offset: -1, removeCount: 0, insert: "", updatedAt: "t" }, "PATCH_CONTENT").map((f) => f.rule)).toContain("PATCH_OFFSET");
  });
  it("rejects a lifecycle step from the wrong status", () => {
    expect(note({ id: "x", actor: "0x1", timestamp: "t" }, "APPROVE_NOTE", { status: "DRAFT" }).map((f) => f.rule)).toContain("INVALID_STATUS_TRANSITION");
  });
  it("rejects self-approval", () => {
    const found = note({ id: "x", actor: "0x1", timestamp: "t" }, "APPROVE_NOTE", { status: "IN_REVIEW", provenance: { author: "0x1" } });
    expect(found.map((f) => f.rule)).toContain("SELF_APPROVAL");
  });
});

describe("moc rules", () => {
  it("allows only version on SET_METADATA_FIELD", () => {
    const bad = lintActions("bai/moc", { global: {} }, [{ type: "SET_METADATA_FIELD", input: { field: "owner", value: "v", updatedAt: "t" } }]);
    expect(bad.map((f) => f.rule)).toEqual(["INVALID_METADATA_FIELD"]);
    const good = lintActions("bai/moc", { global: {} }, [{ type: "SET_METADATA_FIELD", input: { field: "version", value: "v", updatedAt: "t" } }]);
    expect(good).toEqual([]);
  });
});

describe("pipeline-queue rules", () => {
  it("accepts claim and enrichment, rejects anything else", () => {
    const base = { id: "t1", target: "doc", createdAt: "t" };
    expect(lintActions("bai/pipeline-queue", { global: {} }, [{ type: "ADD_TASK", input: { ...base, taskType: "claim" } }])).toEqual([]);
    expect(lintActions("bai/pipeline-queue", { global: {} }, [{ type: "ADD_TASK", input: { ...base, taskType: "other" } }]).map((f) => f.rule)).toContain("TASK_TYPE_CONVENTION");
  });
});

describe("wbs rules", () => {
  it("requires a blockReason when BLOCKED", () => {
    const blocked = lintActions("bai/wbs", { global: {} }, [{ type: "SET_GOAL_STATUS", input: { id: "g", status: "BLOCKED" } }]);
    expect(blocked.map((f) => f.rule)).toContain("MISSING_BLOCK_REASON");
  });
});

describe("scope-of-work rules", () => {
  it("bounds progress percentage and story points", () => {
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "SET_DELIVERABLE_PROGRESS", input: { id: "d", workProgress: { percentage: 120 } } }]).map((f) => f.rule)).toContain("PROGRESS_OUT_OF_RANGE");
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "SET_DELIVERABLE_PROGRESS", input: { id: "d", workProgress: { storyPoints: { total: 3, completed: 5 } } } }]).map((f) => f.rule)).toContain("STORY_POINTS_INVALID");
  });
  it("rejects negative money", () => {
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "SET_PROJECT_TOTAL_BUDGET", input: { projectId: "p", totalBudget: -1 } }]).map((f) => f.rule)).toContain("NEGATIVE_AMOUNT");
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "SET_PROJECT_EXPENDITURE", input: { projectId: "p", actuals: -1 } }]).map((f) => f.rule)).toContain("NEGATIVE_AMOUNT");
  });
  it("requires exactly one of milestoneId or projectId on ADD_DELIVERABLE_IN_SET", () => {
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId: "d" } }]).map((f) => f.rule)).toContain("DELIVERABLE_SET_AMBIGUOUS");
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId: "d", milestoneId: "m", projectId: "p" } }]).map((f) => f.rule)).toContain("DELIVERABLE_SET_AMBIGUOUS");
    expect(lintActions("powerhouse/scopeofwork", { global: {} }, [{ type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId: "d", projectId: "p" } }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run subgraphs/http/lib/lint/rules.test.ts`
Expected: FAIL — the rule codes are not produced yet.

- [ ] **Step 3: Implement the model rule modules**

`rules/knowledge-note.ts`:
```ts
import type { LintFinding, ModelRule } from "../types.js";

const NOTE_TYPES = ["concept", "decision", "pattern", "observation", "procedure", "architecture", "bug-pattern", "integration", "workflow", "reference"];
const METADATA_FIELDS = ["scope", "confidence", "severity", "editor", "modelId", "version", "filePath", "computes", "context", "decisionStatus", "model", "sourceType", "targetType", "relationType", "cardinality", "errorMessage", "rootCause", "correctPattern"];
const METADATA_LISTS = ["models", "hooksUsed", "dispatchTargets", "modules", "inputs", "outputs", "consumedBy", "alternatives", "consequences"];
const TRANSITIONS: Record<string, string> = { SUBMIT_FOR_REVIEW: "DRAFT", APPROVE_NOTE: "IN_REVIEW", REJECT_NOTE: "IN_REVIEW", ARCHIVE_NOTE: "CANONICAL", RESTORE_NOTE: "ARCHIVED" };

const fail = (index: number, field: string, rule: string, message: string, cls: LintFinding["class"] = "REACTOR_REJECTS"): LintFinding => ({
  path: field ? `actions[${index}].input.${field}` : `actions[${index}]`,
  rule,
  class: cls,
  message,
});

export const knowledgeNoteRules: ModelRule[] = [
  (a, i) => (a.type === "SET_DESCRIPTION" && typeof a.input.description === "string" && a.input.description.length > 200
    ? [fail(i, "description", "DESCRIPTION_TOO_LONG", "description exceeds 200 characters")] : []),
  (a, i) => (a.type === "SET_METADATA_FIELD" && typeof a.input.field === "string" && !METADATA_FIELDS.includes(a.input.field)
    ? [fail(i, "field", "INVALID_METADATA_FIELD", `metadata field ${a.input.field} is not allowed`)] : []),
  (a, i) => (a.type === "SET_METADATA_LIST_FIELD" && typeof a.input.field === "string" && !METADATA_LISTS.includes(a.input.field)
    ? [fail(i, "field", "INVALID_METADATA_LIST_FIELD", `metadata list field ${a.input.field} is not allowed`)] : []),
  (a, i) => (a.type === "SET_NOTE_TYPE" && typeof a.input.noteType === "string" && !NOTE_TYPES.includes(a.input.noteType)
    ? [fail(i, "noteType", "NOTE_TYPE_CONVENTION", `noteType must be one of ${NOTE_TYPES.join(", ")}`, "VAULT_CONVENTION")] : []),
  (a, i) => (a.type === "PATCH_CONTENT" && typeof a.input.offset === "number" && a.input.offset < 0
    ? [fail(i, "offset", "PATCH_OFFSET", "offset must be zero or positive")] : []),
  (a, i, state) => {
    const from = TRANSITIONS[a.type];
    const status = typeof state.status === "string" ? state.status : "DRAFT";
    return from && status !== from
      ? [fail(i, "", "INVALID_STATUS_TRANSITION", `${a.type} requires status ${from}, current is ${status}`)] : [];
  },
  (a, i, state) => {
    const author = (state.provenance as { author?: string } | null | undefined)?.author;
    return a.type === "APPROVE_NOTE" && author && author === a.input.actor
      ? [fail(i, "actor", "SELF_APPROVAL", "the actor may not approve their own note")] : [];
  },
];
```

`rules/moc.ts`:
```ts
import type { ModelRule } from "../types.js";

export const mocRules: ModelRule[] = [
  (a, i) => (a.type === "SET_METADATA_FIELD" && typeof a.input.field === "string" && a.input.field !== "version"
    ? [{ path: `actions[${i}].input.field`, rule: "INVALID_METADATA_FIELD", class: "REACTOR_REJECTS", message: 'moc SET_METADATA_FIELD only accepts "version"' }] : []),
];
```

`rules/pipeline-queue.ts`:
```ts
import type { ModelRule } from "../types.js";

export const pipelineQueueRules: ModelRule[] = [
  (a, i) => (a.type === "ADD_TASK" && typeof a.input.taskType === "string" && a.input.taskType !== "claim" && a.input.taskType !== "enrichment"
    ? [{ path: `actions[${i}].input.taskType`, rule: "TASK_TYPE_CONVENTION", class: "VAULT_CONVENTION", message: "taskType must be claim or enrichment" }] : []),
];
```

`rules/wbs.ts`:
```ts
import type { ModelRule } from "../types.js";

export const wbsRules: ModelRule[] = [
  (a, i) => (a.type === "SET_GOAL_STATUS" && a.input.status === "BLOCKED" && !(typeof a.input.blockReason === "string" && a.input.blockReason.trim())
    ? [{ path: `actions[${i}].input.blockReason`, rule: "MISSING_BLOCK_REASON", class: "REACTOR_REJECTS", message: "BLOCKED requires a non-blank blockReason" }] : []),
];
```

`rules/scope-of-work.ts`:
```ts
import type { LintFinding, ModelRule } from "../types.js";

const bad = (index: number, field: string, rule: string, message: string): LintFinding => ({ path: `actions[${index}].input.${field}`, rule, class: "REACTOR_REJECTS", message });
const negative = (v: unknown) => typeof v === "number" && v < 0;

export const scopeOfWorkRules: ModelRule[] = [
  (a, i) => {
    if (a.type !== "SET_DELIVERABLE_PROGRESS") return [];
    const wp = a.input.workProgress as { percentage?: number; storyPoints?: { total?: number; completed?: number } } | undefined;
    const out: LintFinding[] = [];
    if (typeof wp?.percentage === "number" && (wp.percentage < 0 || wp.percentage > 100)) out.push(bad(i, "workProgress.percentage", "PROGRESS_OUT_OF_RANGE", "percentage must be between 0 and 100"));
    const sp = wp?.storyPoints;
    if (sp && ((typeof sp.total === "number" && sp.total < 0) || (typeof sp.completed === "number" && (sp.completed < 0 || (typeof sp.total === "number" && sp.completed > sp.total))))) out.push(bad(i, "workProgress.storyPoints", "STORY_POINTS_INVALID", "story points must be non-negative with completed <= total"));
    return out;
  },
  (a, i) => {
    if (a.type === "SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT" && (negative(a.input.unitCost) || negative(a.input.quantity) || negative(a.input.margin))) return [bad(i, "unitCost", "NEGATIVE_AMOUNT", "budget anchor values must be zero or positive")];
    if ((a.type === "ADD_PROJECT" || a.type === "UPDATE_PROJECT") && negative(a.input.budget)) return [bad(i, "budget", "NEGATIVE_AMOUNT", "budget must be zero or positive")];
    if (a.type === "SET_PROJECT_MARGIN" && negative(a.input.margin)) return [bad(i, "margin", "NEGATIVE_AMOUNT", "margin must be zero or positive")];
    if (a.type === "SET_PROJECT_TOTAL_BUDGET" && negative(a.input.totalBudget)) return [bad(i, "totalBudget", "NEGATIVE_AMOUNT", "total budget must be zero or positive")];
    if (a.type === "SET_PROJECT_EXPENDITURE" && (negative(a.input.actuals) || negative(a.input.cap))) return [bad(i, "actuals", "NEGATIVE_AMOUNT", "actuals and cap must be zero or positive")];
    return [];
  },
  (a, i) => {
    if (a.type !== "ADD_DELIVERABLE_IN_SET") return [];
    const hasMilestone = a.input.milestoneId !== undefined && a.input.milestoneId !== null;
    const hasProject = a.input.projectId !== undefined && a.input.projectId !== null;
    return hasMilestone === hasProject ? [bad(i, "milestoneId", "DELIVERABLE_SET_AMBIGUOUS", "exactly one of milestoneId or projectId must be set")] : [];
  },
];
```

- [ ] **Step 4: Aggregate in `rules.ts`**

```ts
import { knowledgeNoteRules } from "./rules/knowledge-note.js";
import { mocRules } from "./rules/moc.js";
import { pipelineQueueRules } from "./rules/pipeline-queue.js";
import { scopeOfWorkRules } from "./rules/scope-of-work.js";
import { wbsRules } from "./rules/wbs.js";
import type { ModelRule } from "./types.js";

export const RULES: Record<string, ModelRule[]> = {
  "bai/knowledge-note": knowledgeNoteRules,
  "bai/moc": mocRules,
  "bai/pipeline-queue": pipelineQueueRules,
  "powerhouse/scopeofwork": scopeOfWorkRules,
  "bai/wbs": wbsRules,
};
```

- [ ] **Step 5: Run tests, typecheck and commit**

Run: `bunx vitest run subgraphs/http/lib/lint/rules.test.ts && bun run tsc`
Expected: PASS; tsc clean.
```bash
git add subgraphs/http/lib/lint
git commit -m "feat(http): lint the vault's conventions the reducers do not check"
```

---

### Task 8: Extract the shared search body from the GraphQL resolver

**Files:**
- Create: `subgraphs/knowledge-graph/helpers/search.ts`
- Modify: `subgraphs/knowledge-graph/resolvers.ts` (imports, delete the private `searchWithEmbedding`, delegate `knowledgeGraphSemanticSearch`)

**Interfaces:**
- Produces:
  ```ts
  export type SearchMode = "SEMANTIC" | "HYBRID";
  export interface VaultSearchHit { node: Record<string, unknown>; similarity: number; score: number; matchedBy: string[]; }
  export function searchWithEmbedding(subgraph: ISubgraph, driveId: string, query: string, embedding: number[], mode: SearchMode, limit: number, includeArchived?: boolean): Promise<VaultSearchHit[]>;
  export function keywordSearch(subgraph: ISubgraph, driveId: string, query: string, limit: number, includeArchived?: boolean): Promise<VaultSearchHit[]>;
  export function searchVault(subgraph: ISubgraph, driveId: string, query: string, mode?: SearchMode, limit?: number, includeArchived?: boolean): Promise<VaultSearchHit[]>;
  ```
- Consumes: `getDb`, `getQuery` (`./db.js`), `searchSimilar` (`processors/graph-indexer/embedding-store.js`), `embedQuery` (`./query-embedder.js`), `RRF_K`, `isCurrentNode`, `normalizeFusedScore` (`processors/graph-indexer/query.js`).

- [ ] **Step 1: Create `helpers/search.ts`**

Move the body of `resolvers.ts:131-178` (`searchWithEmbedding`) and the fallback mapping at `:530-545` verbatim into the new file, exporting both, then add the orchestrator:
```ts
export async function searchVault(
  subgraph: ISubgraph,
  driveId: string,
  query: string,
  mode: SearchMode = "HYBRID",
  limit = 20,
  includeArchived = false,
): Promise<VaultSearchHit[]> {
  const embedding = await embedQuery(query);
  if (embedding) {
    try {
      return await searchWithEmbedding(subgraph, driveId, query, embedding, mode, limit, includeArchived);
    } catch (err) {
      console.warn(
        `[knowledgeGraph] embedding store unavailable, keyword fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return keywordSearch(subgraph, driveId, query, limit, includeArchived);
}
```
`keywordSearch` is the former fallback body, mapped exactly as today:
```ts
export async function keywordSearch(
  subgraph: ISubgraph,
  driveId: string,
  query: string,
  limit: number,
  includeArchived = false,
): Promise<VaultSearchHit[]> {
  const graphQuery = getQuery(subgraph, driveId);
  const keywordHits = await graphQuery.fullSearch(query, limit, { includeArchived });
  return keywordHits.map((node, rank) => {
    const score = 1 / (RRF_K + rank);
    return {
      node: { ...node, _driveId: driveId },
      similarity: normalizeFusedScore(score, 1),
      score,
      matchedBy: ["keyword"],
    };
  });
}
```

- [ ] **Step 2: Rewire the resolver**

In `resolvers.ts`:
- Add `import { searchVault, searchWithEmbedding } from "./helpers/search.js";`
- Delete the private `searchWithEmbedding` function (`:131-178`) and its doc comment.
- Remove now-unused imports: `embedQuery`, `RRF_K`, `normalizeFusedScore` (keep `isCurrentNode`, `getDb`, `searchSimilar`, `getEmbedding` — still used by `knowledgeGraphSimilar` and other resolvers).
- `knowledgeGraphSearchByEmbedding` keeps calling `searchWithEmbedding(subgraph, ...)` — now the imported one.
- Replace the body of `knowledgeGraphSemanticSearch` from `const limit = args.limit ?? 20;` through the end of its keyword-fallback `return` with:
  ```ts
  const limit = args.limit ?? 20;
  return searchVault(
    subgraph,
    args.driveId,
    args.query,
    args.mode ?? "HYBRID",
    limit,
    args.includeArchived ?? false,
  );
  ```

- [ ] **Step 3: Verify**

Run: `bun run tsc && bun run test`
Expected: clean; the existing suite passes. With the reactor up, GraphQL smoke:
```bash
switchboard query '{ knowledgeGraphSemanticSearch(driveId:"<UUID>", query:"reactor storage", mode:HYBRID, limit:3){ score matchedBy node{ documentId title } } }'
```
Expected: unchanged hit shape (`score`, `matchedBy`, `similarity` no longer exposed on the HYBRID GraphQL type — check the schema; it never was).

- [ ] **Step 4: Commit**

```bash
git add subgraphs/knowledge-graph/helpers/search.ts subgraphs/knowledge-graph/resolvers.ts
git commit -m "refactor(knowledge-graph): one search implementation for GraphQL and REST"
```

---

### Task 9: Test fakes + `GET search`

**Files:**
- Create: `tests/helpers/fake-http-scope.ts`
- Create: `tests/helpers/fake-reactor-client.ts`
- Create: `subgraphs/http/routes/search.ts`
- Test: `subgraphs/http/routes/search.test.ts`
- Create: `subgraphs/http/live-deps.ts` (assembles `HttpRouteDeps` from the subgraph)
- Modify: `subgraphs/http/index.ts` (register `search`)

**Interfaces:**
- Produces:
  ```ts
  // routes/search.ts
  export interface SearchHit { node: Record<string, unknown>; similarity: number; score: number; matchedBy: string[]; }
  export interface SearchRouteDeps extends HttpRouteDeps { search(driveId: string, query: string, mode: "SEMANTIC" | "HYBRID", limit: number, includeArchived: boolean): Promise<SearchHit[]>; }
  export function createSearchRoute(deps: SearchRouteDeps): (request: Request, ctx: RouteContext) => Promise<Response>;
  // live-deps.ts
  export function buildHttpRouteDeps(subgraph: BaseSubgraph): HttpRouteDeps;
  ```

- [ ] **Step 1: Write the fakes**

`tests/helpers/fake-http-scope.ts` — records registrations and invokes handlers without a server:
```ts
import type { IHttpScope, RouteContext, RouteHandler, RouteOptions, RouteSpec, ScopedRouteHandle } from "@powerhousedao/shared/processors";

export interface RecordedRoute { method: string; path: string; handler: RouteHandler; options?: RouteOptions; }

export interface FakeHttpScope {
  scope: IHttpScope;
  routes: RecordedRoute[];
  invoke(method: string, path: string, request: Request, ctx: RouteContext): Promise<Response>;
}

export function createFakeHttpScope(): FakeHttpScope {
  const routes: RecordedRoute[] = [];
  const handle = (): ScopedRouteHandle => ({ dispose: () => {} }) as unknown as ScopedRouteHandle;
  const register = (method: string) => (path: string, a: RouteOptions | RouteHandler, b?: RouteHandler) => {
    const handler = (typeof a === "function" ? a : b) as RouteHandler;
    routes.push({ method, path, handler, options: typeof a === "function" ? undefined : a });
    return handle();
  };
  const scope = {
    get: register("GET"), post: register("POST"), put: register("PUT"),
    patch: register("PATCH"), delete: register("DELETE"), head: register("HEAD"),
    route: (spec: RouteSpec) => { for (const method of spec.method) routes.push({ method, path: spec.path, handler: spec.handler, options: spec }); return handle(); },
    nodeRoute: () => { throw new Error("nodeRoute is not faked"); },
    webhooks: { register: () => { throw new Error("webhooks are not faked"); } },
    dispose: () => {},
  } as unknown as IHttpScope;
  return {
    scope, routes,
    invoke: async (method, path, request, ctx) => {
      const route = routes.find((r) => r.method === method && r.path === path);
      if (!route) throw new Error(`no route ${method} ${path}`);
      return route.handler(request, ctx);
    },
  };
}
```

`tests/helpers/fake-reactor-client.ts` — a minimal in-memory client configurable per test:
```ts
import { vi } from "vitest";
import type { HttpRouteDeps } from "../../subgraphs/http/lib/deps.js";

export function createFakeReactorClient(overrides: Partial<HttpRouteDeps["reactorClient"]> = {}): HttpRouteDeps["reactorClient"] {
  return {
    get: vi.fn(async () => ({ header: { id: "doc", documentType: "bai/source", revision: { global: 0, document: 0 } }, state: { global: {} } })) as never,
    getOperations: vi.fn(async () => ({ results: [] })) as never,
    execute: vi.fn(async () => ({})) as never,
    executeAsync: vi.fn(async () => ({ id: "job-1" })) as never,
    waitForJob: vi.fn(async () => ({ id: "job-1", status: "READ_READY", error: null })) as never,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing route tests**

`subgraphs/http/routes/search.test.ts` — includes the missing-`drive` 400, the content stripping, the `content=1` pass-through, the markdown branch and the 403 passthrough:
```ts
import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { SearchRouteDeps } from "./search.js";
import { createSearchRoute } from "./search.js";

const ctx = { user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" }, params: {}, authEnabled: true, transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" } } as unknown as RouteContext;

function deps(overrides: Partial<SearchRouteDeps> = {}): SearchRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(async () => "drive") as never,
    authorization: { canRead: vi.fn(async () => true), canWrite: vi.fn(async () => true), canMutate: vi.fn(async () => true), isSupremeAdmin: vi.fn(() => false) },
    now: () => new Date(), uuid: () => "u",
    search: vi.fn(async () => [{ node: { documentId: "n1", title: "T", content: "body" }, similarity: 0.9, score: 0.03, matchedBy: ["semantic"] }]),
    ...overrides,
  };
}

describe("GET search", () => {
  it("400s without drive or q", async () => {
    const res = await createSearchRoute(deps())(new Request("http://h/search?q=x"), ctx);
    expect(res.status).toBe(400);
  });
  it("strips content unless content=1", async () => {
    const res = await createSearchRoute(deps())(new Request("http://h/search?drive=d&q=x"), ctx);
    const body = (await res.json()) as { hits: { node: Record<string, unknown> }[] };
    expect(body.hits[0].node).not.toHaveProperty("content");
  });
  it("passes content through with content=1", async () => {
    const res = await createSearchRoute(deps())(new Request("http://h/search?drive=d&q=x&content=1"), ctx);
    const body = (await res.json()) as { hits: { node: Record<string, unknown> }[] };
    expect(body.hits[0].node.content).toBe("body");
  });
  it("renders markdown when asked", async () => {
    const res = await createSearchRoute(deps())(new Request("http://h/search?drive=d&q=x&content=1", { headers: { accept: "text/markdown" } }), ctx);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("# Search: x");
  });
  it("returns 403 when the caller cannot read the drive", async () => {
    const d = deps(); d.authorization.canRead = vi.fn(async () => false);
    const res = await createSearchRoute(d)(new Request("http://h/search?drive=d&q=x"), ctx);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run subgraphs/http/routes/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route and the live deps**

`routes/search.ts`:
```ts
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export interface SearchHit {
  node: Record<string, unknown>;
  similarity: number;
  score: number;
  matchedBy: string[];
}

export interface SearchRouteDeps extends HttpRouteDeps {
  search(
    driveId: string,
    query: string,
    mode: "SEMANTIC" | "HYBRID",
    limit: number,
    includeArchived: boolean,
  ): Promise<SearchHit[]>;
}

const MAX_LIMIT = 25;

function withoutContent(node: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, ...rest } = node;
  return rest;
}

function renderMarkdown(query: string, hits: SearchHit[]): string {
  const lines = [`# Search: ${query}`, ""];
  hits.forEach((hit, i) => {
    const node = hit.node as { documentId?: string; title?: string; description?: string; content?: string };
    lines.push(`${i + 1}. [${node.title ?? node.documentId}](${node.documentId}) — ${(hit.similarity * 100).toFixed(0)}% (${hit.matchedBy.join("+")})`);
    if (node.description) lines.push(`   ${node.description}`);
    if (node.content) lines.push("", node.content, "");
  });
  return lines.join("\n");
}

export function createSearchRoute(deps: SearchRouteDeps) {
  return async function handleSearch(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      const q = url.searchParams.get("q");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      if (!q) throw new HttpError(400, "BAD_REQUEST", "q is required");
      const rawMode = (url.searchParams.get("mode") ?? "hybrid").toLowerCase();
      if (rawMode !== "hybrid" && rawMode !== "semantic") {
        throw new HttpError(400, "BAD_REQUEST", "mode must be hybrid or semantic");
      }
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(url.searchParams.get("limit") ?? 6) || 6),
      );
      const includeContent = url.searchParams.get("content") === "1";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      await canonicalForRead(deps, drive, ctx);
      const hits = await deps.search(
        drive,
        q,
        rawMode === "semantic" ? "SEMANTIC" : "HYBRID",
        limit,
        includeArchived,
      );
      const shaped = hits.map((hit) => ({
        ...hit,
        node: includeContent ? hit.node : withoutContent(hit.node),
      }));
      if ((request.headers.get("accept") ?? "").includes("text/markdown")) {
        return new Response(renderMarkdown(q, shaped), {
          headers: { "Content-Type": "text/markdown; charset=utf-8", ...OK_CACHE },
        });
      }
      return Response.json({ query: q, mode: rawMode, hits: shaped }, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}
```

`live-deps.ts`:
```ts
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { HttpRouteDeps } from "./lib/deps.js";

export function buildHttpRouteDeps(subgraph: BaseSubgraph): HttpRouteDeps {
  return {
    reactorClient: subgraph.reactorClient,
    resolveCanonicalDocumentId: (identifier, ctx) =>
      subgraph.resolveCanonicalDocumentId(identifier, ctx),
    authorization: subgraph.authorizationService,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}
```

Register in `subgraphs/http/index.ts` inside the existing `try`:
```ts
import { searchVault } from "../knowledge-graph/helpers/search.js";
import { buildHttpRouteDeps } from "./live-deps.js";
import { createSearchRoute } from "./routes/search.js";
// …
const deps = buildHttpRouteDeps(this);
this.http.get(
  "search",
  { auth: "renown" },
  createSearchRoute({
    ...deps,
    search: (driveId, query, mode, limit, includeArchived) =>
      searchVault(this, driveId, query, mode, limit, includeArchived),
  }),
);
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bunx vitest run subgraphs/http/routes/search.test.ts && bun run tsc`
Expected: PASS; clean.

- [ ] **Step 6: Live smoke (when the reactor is up)**

After `bun run build` and a Switchboard restart:
```bash
TOKEN=$(ph access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4001/api/@powerhousedao/knowledge-note/search?drive=cf9b51d2-2915-45be-be2c-0ad939bfc1ae&q=reactor%20storage&content=1" | head -c 600
```
Expected: JSON with ranked hits and content.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers subgraphs/http
git commit -m "feat(http): GET search over the shared search implementation"
```

---

### Task 10: `GET notes/:id` and `GET notes/:id.md`

**Files:**
- Create: `subgraphs/http/lib/markdown.ts`
- Test: `subgraphs/http/lib/markdown.test.ts`
- Create: `subgraphs/http/routes/notes.ts`
- Test: `subgraphs/http/routes/notes.test.ts`
- Modify: `subgraphs/http/index.ts` (register both routes)

**Interfaces:**
- Produces:
  ```ts
  // lib/markdown.ts
  export interface EdgeView { direction: "out" | "in"; documentId: string; linkType: string; title?: string | null; reason?: string | null; confidence?: string | null; }
  export function renderNoteMarkdown(doc: { id: string; name: string; documentType: string; state: unknown }, edges: EdgeView[], baseUrl: string): string;
  // routes/notes.ts
  export interface NotesRouteDeps extends HttpRouteDeps {
    edges(driveId: string, documentId: string): Promise<EdgeView[]>;
  }
  export function createNotesRoute(deps: NotesRouteDeps): (request: Request, ctx: RouteContext) => Promise<Response>;
  ```
- The handler serves `notes/:id.md` and `notes/:id`; `drive` is a required query parameter.

- [ ] **Step 1: Write the failing markdown tests**

`subgraphs/http/lib/markdown.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderNoteMarkdown } from "./markdown.js";

const doc = {
  id: "n1", name: "Reactors store operations", documentType: "bai/knowledge-note",
  state: { global: { title: "Reactors store operations", description: "The reactor appends actions as operations.", noteType: "concept", status: "CANONICAL", topics: [{ name: "reactor" }], provenance: { author: "knowledge-agent", sourceOrigin: "DERIVED", createdAt: "2026-09-01T00:00:00.000Z" } } },
};

describe("renderNoteMarkdown", () => {
  it("emits YAML frontmatter and the content", () => {
    const md = renderNoteMarkdown(doc, [], "http://h/api/x");
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Reactors store operations"');
    expect(md).toContain("status: CANONICAL");
    expect(md).toContain("topics: [reactor]");
    expect(md).toContain("sourceOrigin: DERIVED");
  });
  it("renders edges as absolute markdown links with the reason", () => {
    const md = renderNoteMarkdown(doc, [{ direction: "out", documentId: "n2", linkType: "BUILDS_ON", title: "Other", reason: "Extends the claim", confidence: "grounded" }], "http://h/api/x");
    expect(md).toContain("[Other](http://h/api/x/notes/n2.md?drive=)");
  });
});
```
Note: the link URL includes the `drive` the caller asked for — pass it into the renderer via `baseUrl` containing the query string, or extend the signature with `drive`. **Decide:** `renderNoteMarkdown(doc, edges, linkBase, drive)`, where `linkBase` is `ctx.transport.baseUrl + "/api/@powerhousedao/knowledge-note"` and links append `?drive=<drive>`. Adjust the test accordingly.

- [ ] **Step 2: Run to fail, implement, run to pass**

Run: `bunx vitest run subgraphs/http/lib/markdown.test.ts` → FAIL.
Implement `renderNoteMarkdown`:
```ts
export interface EdgeView { direction: "out" | "in"; documentId: string; linkType: string; title?: string | null; reason?: string | null; confidence?: string | null; }

const yamlString = (v: string) => JSON.stringify(v);
const yamlList = (v: string[]) => `[${v.map((x) => (x.includes(" ") ? yamlString(x) : x)).join(", ")}]`;

export function renderNoteMarkdown(
  doc: { id: string; name: string; documentType: string; state: unknown },
  edges: EdgeView[],
  linkBase: string,
  drive: string,
): string {
  const global = ((doc.state as { global?: Record<string, unknown> } | undefined)?.global ?? {}) as Record<string, unknown>;
  const lines: string[] = ["---"];
  const title = typeof global.title === "string" ? global.title : doc.name;
  lines.push(`title: ${yamlString(title)}`);
  if (typeof global.description === "string") lines.push(`description: ${yamlString(global.description)}`);
  if (typeof global.noteType === "string") lines.push(`noteType: ${global.noteType}`);
  if (typeof global.status === "string") lines.push(`status: ${global.status}`);
  const topics = Array.isArray(global.topics) ? (global.topics as { name?: string }[]).map((t) => t.name ?? "").filter(Boolean) : [];
  if (topics.length) lines.push(`topics: ${yamlList(topics)}`);
  const prov = global.provenance as { author?: string; sourceOrigin?: string; createdAt?: string } | null | undefined;
  if (prov?.author) lines.push(`author: ${yamlString(prov.author)}`);
  if (prov?.sourceOrigin) lines.push(`sourceOrigin: ${prov.sourceOrigin}`);
  if (prov?.createdAt) lines.push(`createdAt: ${prov.createdAt}`);
  lines.push("links:");
  for (const edge of edges) {
    const suffix = edge.direction === "in" ? "backlink" : "link";
    lines.push(`  - type: ${edge.linkType}`);
    lines.push(`    ${suffix}: ${edge.documentId}`);
    if (edge.title) lines.push(`    title: ${yamlString(edge.title)}`);
    if (edge.reason) lines.push(`    reason: ${yamlString(edge.reason)}`);
    if (edge.confidence) lines.push(`    confidence: ${edge.confidence}`);
  }
  lines.push("---", "");
  for (const edge of edges) {
    lines.push(`> ${edge.direction === "in" ? "Backlink" : "Link"} ${edge.linkType}: [${edge.title ?? edge.documentId}](${linkBase}/notes/${edge.documentId}.md?drive=${drive})${edge.reason ? ` — ${edge.reason}` : ""}`);
  }
  if (edges.length) lines.push("");
  lines.push(typeof global.content === "string" ? global.content : "");
  return lines.join("\n");
}
```
Run again → PASS.

- [ ] **Step 3: Write the failing route tests, then implement `routes/notes.ts`**

Cases: `.md` route returns `text/markdown` with frontmatter; JSON route returns `{ id, documentType, state, edges }`; missing `drive` → 400; unknown id → resolved error → 404; `resolveCanonicalDocumentId` mocked to throw `CanonicalDocumentIdResolutionError` for the 404 case.
Implementation skeleton:
```ts
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForRead } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { renderNoteMarkdown, type EdgeView } from "../lib/markdown.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";

export interface NotesRouteDeps extends HttpRouteDeps {
  edges(driveId: string, documentId: string): Promise<EdgeView[]>;
}

export function createNotesRoute(deps: NotesRouteDeps) {
  return async function handleNote(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const rawId = ctx.params.id ?? "";
      const wantsMarkdown = rawId.endsWith(".md");
      const id = wantsMarkdown ? rawId.slice(0, -3) : rawId;
      if (!id) throw new HttpError(400, "BAD_REQUEST", "id is required");
      const canonicalId = await canonicalForRead(deps, id, ctx);
      const doc = await deps.reactorClient.get(canonicalId);
      const header = doc.header as { id: string; documentType: string; name?: string };
      const edges = await deps.edges(drive, canonicalId);
      if (wantsMarkdown) {
        const linkBase = `${ctx.transport.baseUrl}/api/@powerhousedao/knowledge-note`;
        return new Response(
          renderNoteMarkdown({ id: header.id, name: header.name ?? header.id, documentType: header.documentType, state: doc.state }, edges, linkBase, drive),
          { headers: { "Content-Type": "text/markdown; charset=utf-8", ...OK_CACHE } },
        );
      }
      return Response.json({ id: header.id, name: header.name, documentType: header.documentType, state: doc.state, edges }, { headers: OK_CACHE });
    } catch (error) {
      return jsonError(error);
    }
  };
}
```

- [ ] **Step 4: Register the routes (order matters)**

In `index.ts`, register `notes/:id.md` **before** `notes/:id`. The `edges` dep calls `getQuery(this, driveId).forwardLinks(documentId)` and `backlinks(documentId)` and maps to `EdgeView[]` (out: `targetDocumentId`, in: `sourceDocumentId`).

- [ ] **Step 5: Tests, typecheck, live smoke, commit**

Run: `bunx vitest run subgraphs/http/routes/notes.test.ts && bun run tsc`
Live smoke (reactor up): `curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4001/api/@powerhousedao/knowledge-note/notes/<note-id>.md?drive=<UUID>"`.
```bash
git add subgraphs/http tests/helpers
git commit -m "feat(http): GET notes/:id and markdown note rendering"
```

---

### Task 11: `POST actions`

**Files:**
- Create: `subgraphs/http/lib/write.ts`
- Test: `subgraphs/http/lib/write.test.ts`
- Create: `subgraphs/http/routes/actions.ts`
- Test: `subgraphs/http/routes/actions.test.ts`
- Modify: `subgraphs/http/index.ts` (register `actions`)

**Interfaces:**
- Produces:
  ```ts
  // lib/write.ts
  export interface WriteResult {
    revision: unknown;
    operations: { index: number; type: string; error: string | null; attribution: "agent" | "server" }[];
    jobId?: string;
  }
  export async function executeWrite(deps: HttpRouteDeps, options: {
    documentId: string; documentType: string; state: unknown; actions: RawAction[];
    ctx: RouteContext; wait: boolean; allowLiteralEscapes?: boolean; defaultScope?: string;
  }): Promise<WriteResult>;
  // routes/actions.ts
  export function createActionsRoute(deps: HttpRouteDeps): (request: Request, ctx: RouteContext) => Promise<Response>;
  ```
- `executeWrite` runs lint → stamp → attribution check → per-action `canMutate` for lifecycle ops → `executeAsync` (+ `waitForJob` when `wait`) → `getOperations` read-back matched by action id. Lint findings throw `HttpError(400, "LINT_REACTOR" | "LINT_CONVENTION", …)` with `details = findings`.

- [ ] **Step 1: Write the failing `write.ts` tests**

Cases: (1) lint failure throws 400 with `details` and never calls `executeAsync`; (2) a stamped action reaches `executeAsync` with `id`, `timestampUtcMs`, `scope: "global"`; (3) read-back filters to the dispatched action ids and carries `error`; (4) an action signed by a different address → 403; (5) `wait: false` returns `{ jobId }` without `waitForJob`.

- [ ] **Step 2: Implement `lib/write.ts`, run tests to pass**

Use `stampActions(actions, deps.now, deps.uuid, options.defaultScope ?? "global")`; find the document's revision before dispatch via `Object.values((doc.header as { revision?: Record<string, number> }).revision ?? { global: 0 })` and `Math.min(...)`; read back `getOperations(documentId, undefined, { sinceRevision: prior }, { limit: 200 })`; match `page.results` by `operation.action?.id` against the stamped ids; report `{ index, type, error ?? null, attribution: action.context ? "agent" : "server" }`.

- [ ] **Step 3: Write the failing route tests, implement, pass**

Route cases: 400 `documentId`/`actions` shape; happy path returns `{ revision, operations }`; signed action from another address → 403; `allowLiteralEscapes` flows into lint; `wait: false` → 202 `{ jobId }`. The route fetches the document first (`deps.reactorClient.get`) for `documentType` and `state`, then calls `executeWrite`.

- [ ] **Step 4: Register, typecheck, live smoke (regression case), commit**

Register `this.http.post("actions", { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 }, createActionsRoute(deps))`.
Live smoke (reactor up): replicate the probe's failing batch — one invalid `REMOVE_EXTRACTED_CLAIM` plus a valid `SET_SOURCE_STATUS` — and confirm **400 with the invalid action's path and nothing dispatched**.
```bash
git add subgraphs/http
git commit -m "feat(http): POST actions with lint, attribution and read-back"
```

---

### Task 12: `POST` / `PATCH` / `DELETE relationships`

**Files:**
- Create: `subgraphs/http/routes/relationships.ts`
- Test: `subgraphs/http/routes/relationships.test.ts`
- Modify: `subgraphs/http/index.ts` (register all three verbs)

**Interfaces:**
- Produces:
  ```ts
  export interface RelationshipBody { source: string; target: string; type: string; reason?: string; confidence?: string; }
  export function createRelationshipRoute(deps: HttpRouteDeps, method: "POST" | "PATCH" | "DELETE"): (request: Request, ctx: RouteContext) => Promise<Response>;
  ```
- Action shapes: `ADD_RELATIONSHIP { sourceId, targetId, relationshipType, metadata? }`, `UPDATE_RELATIONSHIP { … metadata }`, `REMOVE_RELATIONSHIP { … }`. **Scope is `"document"`** (`executeWrite` with `defaultScope: "document"`). Authorization is on the **source** document.

- [ ] **Step 1: Write the failing tests**

Cases: (1) `POST` with a bare `BUILDS_ON` → 400 `LINT_CONVENTION`/articulation message; (2) `POST` with a valid reason → dispatch with `scope: "document"` and metadata `{ reason, confidence }`; (3) `PATCH` sends `UPDATE_RELATIONSHIP`; (4) `DELETE` sends `REMOVE_RELATIONSHIP`; (5) one of `source`/`target`/`type` missing → 400; (6) `CORE_IDEA` without reason → allowed.

- [ ] **Step 2: Implement, run tests to pass**

`POST`/`PATCH` call `checkArticulation({ type, reason, confidence })` before dispatch; `PATCH` requires the edge to exist (the reactor records a rejection if not — surface it in the read-back). `executeWrite` handles lint (the zod input schema accepts all three actions) and authorization on the canonical source; `DELETE` skips articulation.

- [ ] **Step 3: Register, typecheck, live smoke, commit**

Register `this.http.post("relationships", …)`, `this.http.patch("relationships", …)`, `this.http.delete("relationships", …)`.
Live smoke (reactor up): create a scratch note, link it with a reason, read `knowledgeGraphForwardLinks` for the reason/confidence, `PATCH` the reason, `DELETE` it, delete the scratch note.
```bash
git add subgraphs/http
git commit -m "feat(http): relationship routes with server-side articulation"
```

---

### Task 13: Docs, coverage, spec amendment, slice-1 close-out

**Files:**
- Create: `docs/http-api.md`
- Modify: `vitest.config.ts` (coverage include for `subgraphs/http/lib/**`)
- Modify: `package.json` (add `test:coverage`)
- Modify: `docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md` (apply the three amendments from the plan header)
- Modify: `subgraphs/knowledge-graph/resolvers.ts` and `editors/shared/remote-reactor.ts`/`scripts/drive-sync/lib/gql.py` comments (per-action isolation, already corrected in the slice-1 spec — check each)

- [ ] **Step 1: Add `test:coverage` and the coverage include**

`package.json` scripts: `"test:coverage": "vitest run --coverage"`.
`vitest.config.ts` coverage `include`:
```ts
include: [
  "document-models/**/src/reducers/**",
  "document-models/**/src/tree-utils.ts",
  "subgraphs/http/lib/**",
  "!subgraphs/http/lib/**/*.test.ts",
],
```

- [ ] **Step 2: Run the full local gates**

Run: `bun run tsc && bun run test:coverage && bun run lint:fix`
Expected: clean; reducer coverage ≥95% and `subgraphs/http/lib/**` at or near 100%.

- [ ] **Step 3: Write `docs/http-api.md`**

One table: method, path, `auth`, parameters/body, response shape, notes. Cover all seven registrations plus the reserved `ping`. Explicitly list the deferred endpoints so the doc is honest. State that both namespace spellings answer.

- [ ] **Step 4: Apply the spec amendments**

Edit the committed spec to fold in: `drive` on read routes, `allowLiteralEscapes` on `POST actions`, UUID-only identifiers, per-action isolation, and the claim-guard scope move.

- [ ] **Step 5: Final live smoke, with the reactor up**

Re-run the Task 1 `ping`, Task 9 search, Task 10 notes, Task 11 actions-regression and Task 12 relationship smokes in one pass; record the transcript in the PR.

- [ ] **Step 5b: CORS check**

```bash
curl -si -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4001/api/@powerhousedao/knowledge-note/ping" | grep -i 'access-control'
```
Expected: if the header is absent, add origin-aware `Access-Control-Allow-Origin` to `lib/respond.ts` (allowed origin from the request's `Origin` when it matches the vault host) and note it upstream; if present, record that and add no code.

- [ ] **Step 6: Commit**

```bash
git add docs/http-api.md vitest.config.ts package.json docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md
git commit -m "docs(http): the route table, coverage gate and amended spec"
```

### Task 14: Atomic claim guard — pipeline-queue reducer errors (model change + source)

**Prerequisite (both must be true before starting):**
1. `backup-documents/PipelineQueue.phd` has been imported into a Vetra drive; its document id is known.
2. The executor can run model operations via `reactor-mcp` (OpenCode) or the `switchboard` CLI pointed at the running reactor.

**Files:**
- Modify (via MCP/CLI): the `bai/pipeline-queue` document model document — `ADD_OPERATION_ERROR` ×2, `SET_OPERATION_REDUCER` ×2
- Modify: `document-models/pipeline-queue/v1/src/reducers/queue-management.ts`
- Test: `document-models/pipeline-queue/v1/tests/queue-management-guards.test.ts`

**Interfaces:**
- Produces: `DuplicateTaskIdError` on `ADD_TASK`; `TaskAlreadyAssignedError` on `ASSIGN_TASK`. The route in Task 15 maps their messages to 409.

- [ ] **Step 1: Confirm the model document and operation ids**

```bash
switchboard docs list --format json | grep -i pipeline   # or mcp getDocuments on the vetra drive
mcp__reactor-mcp__getDocumentModelSchema({ type: "powerhouse/document-model" })   # confirm ADD_OPERATION_ERROR / SET_OPERATION_REDUCER input shapes
mcp__reactor-mcp__getDocument({ id: "<model-doc-id>" })   # read specifications[0].modules[].operations[] ids for ADD_TASK and ASSIGN_TASK
```
Expected: the two operation ids (`<add-task-op-id>`, `<assign-task-op-id>`). If the document is absent, **STOP** and ask the user to import the `.phd`.

- [ ] **Step 2: Dispatch the model change in one batch (scope `global`)**

Two `ADD_OPERATION_ERROR` actions:
```json
{ "operationId": "<assign-task-op-id>", "errorCode": "TASK_ALREADY_ASSIGNED", "errorName": "TaskAlreadyAssignedError", "errorDescription": "The task is already assigned to another actor" }
{ "operationId": "<add-task-op-id>", "errorCode": "DUPLICATE_TASK_ID", "errorName": "DuplicateTaskIdError", "errorDescription": "A task with this id already exists" }
```
Two `SET_OPERATION_REDUCER` actions carrying the full new bodies:
```ts
addTaskOperation(state, action) {
  if (state.tasks.some((t) => t.id === action.input.id)) {
    throw new DuplicateTaskIdError(`Task ${action.input.id} already exists`);
  }
  const phaseEntry = state.phaseOrder.find(
    (p) => p.taskType === action.input.taskType,
  );
  const firstPhase =
    action.input.currentPhase || (phaseEntry ? phaseEntry.phases[0] : null);
  state.tasks.push({
    id: action.input.id,
    taskType: action.input.taskType,
    status: "PENDING",
    target: action.input.target,
    batchId: action.input.batchId || null,
    documentRef: action.input.documentRef || null,
    currentPhase: firstPhase || null,
    completedPhases: [],
    handoffs: [],
    assignedTo: null,
    createdAt: action.input.createdAt,
    updatedAt: null,
  });
  state.activeCount = (state.activeCount || 0) + 1;
},
assignTaskOperation(state, action) {
  const task = state.tasks.find((t) => t.id === action.input.taskId);
  if (!task) throw new TaskNotFoundError("Task not found");
  if (task.assignedTo) {
    throw new TaskAlreadyAssignedError(
      `Task ${task.id} is already assigned to ${task.assignedTo}`,
    );
  }
  task.assignedTo = action.input.assignedTo;
  task.status = "IN_PROGRESS";
  task.updatedAt = action.input.updatedAt;
  state.lastProcessedAt = action.input.updatedAt;
},
```
Do not import the error classes — the generator wires them from the model.

- [ ] **Step 3: Let codegen regenerate, then diff**

Wait for the Vetra watcher, then:
```bash
git diff document-models/pipeline-queue/
```
Expected: `pipeline-queue.json` gains the two error definitions; `v1/schema.graphql` unchanged (errors live in the model JSON); `v1/gen/queue-management/error.ts` gains the classes and the operation error maps. **Any other change is a regression — stop and inspect.**

- [ ] **Step 4: Apply the same change in `src/`**

`document-models/pipeline-queue/v1/src/reducers/queue-management.ts` is hand-written and not regenerated: add the two guards (exact bodies from Step 2) and extend the import:
```ts
import {
  DuplicateTaskIdError,
  InvalidTaskStatusError,
  TaskAlreadyAssignedError,
  TaskNotFoundError,
} from "../../gen/queue-management/error.js";
```

- [ ] **Step 5: Write the guard tests**

`document-models/pipeline-queue/v1/tests/queue-management-guards.test.ts`:
```ts
import {
  addTask,
  assignTask,
  reducer,
  utils,
} from "document-models/pipeline-queue/v1";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("queue guards", () => {
  it("rejects a duplicate task id and leaves state unchanged", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    const before = document.state.global.tasks.length;
    const count = document.state.global.activeCount;

    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T2 }),
    );

    expect(document.operations.global).toHaveLength(2);
    expect(document.operations.global[1].error).toBe("Task t1 already exists");
    expect(document.state.global.tasks).toHaveLength(before);
    expect(document.state.global.activeCount).toBe(count);
  });

  it("rejects claiming an already-assigned task", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "0xaaa", updatedAt: T2 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "0xbbb", updatedAt: T3 }),
    );

    expect(document.operations.global).toHaveLength(3);
    expect(document.operations.global[2].error).toBe(
      "Task t1 is already assigned to 0xaaa",
    );
    expect(document.state.global.tasks[0].assignedTo).toBe("0xaaa");
  });
});
```

- [ ] **Step 6: Run all gates**

Run: `bun run tsc && bun run test:coverage`
Expected: clean; pipeline-queue reducer coverage stays ≥95% (the two new branches are covered by the tests above).

- [ ] **Step 7: Commit**

```bash
git add document-models/pipeline-queue
git commit -m "feat(pipeline-queue): atomic task claim and duplicate-id guards"
```

---

### Task 15: `POST tasks/:id/claim`

**Files:**
- Modify: `subgraphs/http/lib/deps.ts` (add `find` to the reactor client Pick)
- Create: `subgraphs/http/routes/tasks.ts`
- Test: `subgraphs/http/routes/tasks.test.ts`
- Modify: `subgraphs/http/index.ts` (register `tasks/:id/claim`)

**Interfaces:**
- Produces:
  ```ts
  export function createClaimRoute(deps: HttpRouteDeps): (request: Request, ctx: RouteContext) => Promise<Response>;
  ```
- Flow: `?drive=` required → locate the queue (`reactorClient.find({ type: "bai/pipeline-queue", parentId: drive }, undefined, { limit: 1 })`) → `canonicalForWrite(queueId)` → `executeWrite` one `ASSIGN_TASK { taskId, assignedTo, updatedAt }` → map the read-back: message matching `/already assigned/i` → 409 `CONFLICT`; `/Task not found/i` → 404; otherwise 200 `{ taskId, assignedTo }`.

- [ ] **Step 1: Write the failing tests**

With fake deps whose `find` returns a queue document and whose `getOperations` returns a canned operation: (1) success returns 200 and the `assignedTo` default is `ctx.user.address`; (2) a body `assignedTo` overrides it; (3) op error "already assigned" → 409; (4) `find` empty → 404; (5) no `drive` → 400.

- [ ] **Step 2: Implement the route, run tests to pass**

Dispatch via `executeWrite(deps, { documentId: queueId, documentType: "bai/pipeline-queue", state: queue.state, actions: [stamped], ctx, wait: true })` — the atomic guard is in the reducer, so no pre-read of task assignment is allowed.

- [ ] **Step 3: Register, typecheck, live smoke (once Task 14 is done), commit**

Live smoke: two curl calls in parallel for the same task id → one 200, one 409; read the queue back with `switchboard docs get <queue-id> --state`.
```bash
git add subgraphs/http tests/helpers
git commit -m "feat(http): atomic POST tasks/:id/claim"
```

---

### Task 16: Structure reads

**Files:**
- Create: `subgraphs/http/routes/structure.ts`
- Test: `subgraphs/http/routes/structure.test.ts`
- Modify: `subgraphs/http/live-deps.ts` (add `getQuery`, `similar`, `reindex`, `accessMap`)
- Modify: `subgraphs/http/index.ts` (registrations)

**Interfaces:**
- ```ts
  export type StructureKind = "stats" | "density" | "topics" | "byTopic" | "orphans" | "triangles" | "bridges" | "graph.json" | "embeddings/missing" | "similar" | "links" | "backlinks" | "connections" | "activity" | "history" | "access-map" | "admin/reindex";
  export interface StructureRouteDeps extends HttpRouteDeps {
    getQuery(driveId: string): GraphQuery;
    similar(driveId: string, documentId: string, limit: number): Promise<unknown[]>;
    reindex(driveId: string): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }>;
    accessMap(driveId: string): Promise<unknown>;
  }
  export function createStructureRoute(deps: StructureRouteDeps, kind: StructureKind): (request: Request, ctx: RouteContext) => Promise<Response>;
  ```
- `GraphQuery` is `ReturnType<typeof createGraphQuery>` from `processors/graph-indexer/query.js`.

- [ ] **Step 1: Write the failing tests**

Cover: `stats` returns the query result and requires `renown`; `byTopic` reads `ctx.params.name`; `triangles` caps `limit` at 100 with default 20; `activity` and `history` call `canWrite` (mock both ways); `access-map` calls `canManage`; a caller without read access gets 403 before any query call. Use fake `getQuery` returning `vi.fn` per method.

- [ ] **Step 2: Implement, run tests to pass**

Handler shape (one factory, switch on kind; the registration supplies auth):
```ts
export function createStructureRoute(deps: StructureRouteDeps, kind: StructureKind) {
  return async function handleStructure(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const query = () => deps.getQuery(drive);
      const id = ctx.params.id ?? "";
      switch (kind) {
        case "stats": await canonicalForRead(deps, drive, ctx); return Response.json(await query().stats());
        case "density": await canonicalForRead(deps, drive, ctx); return Response.json({ density: await query().density() });
        case "topics": await canonicalForRead(deps, drive, ctx); return Response.json(await query().topicStats());
        case "byTopic": await canonicalForRead(deps, drive, ctx); return Response.json(await query().nodesByTopic(ctx.params.name ?? ""));
        case "orphans": await canonicalForRead(deps, drive, ctx); return Response.json(await query().orphanNodes());
        case "triangles": await canonicalForRead(deps, drive, ctx); return Response.json(await query().triangles(Math.min(100, Number(url.searchParams.get("limit") ?? 20) || 20)));
        case "graph.json": await canonicalForRead(deps, drive, ctx); return Response.json({ nodes: await query().allNodes(), edges: await query().allEdges() });
        case "embeddings/missing": await canonicalForRead(deps, drive, ctx); return Response.json(await query().documentIdsWithoutEmbeddings());
        case "similar": await canonicalForRead(deps, drive, ctx); return Response.json(await deps.similar(drive, id, Math.min(50, Number(url.searchParams.get("limit") ?? 10) || 10)));
        case "links": await canonicalForRead(deps, drive, ctx); return Response.json(await query().forwardLinks(id));
        case "backlinks": await canonicalForRead(deps, drive, ctx); return Response.json(await query().backlinks(id));
        case "connections": await canonicalForRead(deps, drive, ctx); return Response.json(await query().connections(id, Math.min(4, Number(url.searchParams.get("depth") ?? 2) || 2)));
        case "activity": await canonicalForWrite(deps, drive, ctx); return Response.json(await query().activity({ since: url.searchParams.get("since") ?? undefined, limit: 50 }));
        case "history": await canonicalForWrite(deps, drive, ctx); return Response.json(await query().history(id, 50));
        case "bridges": await canonicalForManage(deps, drive, ctx); return Response.json(await query().bridges());
        case "access-map": await canonicalForManage(deps, drive, ctx); return Response.json(await deps.accessMap(drive));
        case "admin/reindex": await canonicalForManage(deps, drive, ctx); return Response.json(await deps.reindex(drive));
      }
    } catch (error) { return jsonError(error); }
  };
}
```
Add `canonicalForManage` to `lib/authorize.ts` (same as read but `canManage` → 403). Check the exact `query.ts` method names before writing this switch (`activity`, `history`, `bridges` take no args; `connections(documentId, depth)`), and adjust.

- [ ] **Step 3: Register (order and auth per the parent plan)**

```ts
this.http.get("stats", { auth: "renown" }, createStructureRoute(deps, "stats"));
this.http.get("density", { auth: "renown" }, createStructureRoute(deps, "density"));
this.http.get("topics", { auth: "renown" }, createStructureRoute(deps, "topics"));
this.http.get("topics/:name", { auth: "renown" }, createStructureRoute(deps, "byTopic"));
this.http.get("orphans", { auth: "renown" }, createStructureRoute(deps, "orphans"));
this.http.get("triangles", { auth: "renown" }, createStructureRoute(deps, "triangles"));
this.http.get("bridges", { auth: "renown" }, createStructureRoute(deps, "bridges"));
this.http.get("graph.json", { auth: "renown" }, createStructureRoute(deps, "graph.json"));
this.http.get("embeddings/missing", { auth: "renown" }, createStructureRoute(deps, "embeddings/missing"));
this.http.get("notes/:id/similar", { auth: "renown" }, createStructureRoute(deps, "similar"));
this.http.get("notes/:id/links", { auth: "renown" }, createStructureRoute(deps, "links"));
this.http.get("notes/:id/backlinks", { auth: "renown" }, createStructureRoute(deps, "backlinks"));
this.http.get("notes/:id/connections", { auth: "renown" }, createStructureRoute(deps, "connections"));
this.http.get("activity", { auth: "renown" }, createStructureRoute(deps, "activity"));
this.http.get("notes/:id/history", { auth: "renown" }, createStructureRoute(deps, "history"));
this.http.get("access-map", { auth: "renown" }, createStructureRoute(deps, "access-map"));
this.http.post("admin/reindex", { auth: "renown", body: "parsed" }, createStructureRoute(deps, "admin/reindex"));
```
`live-deps.ts` wires `similar` from `getDb` + `getEmbedding` + `searchSimilar`, `reindex` from `reindexDrive(subgraph, driveId)`, `accessMap` from `readAccessMap(subgraph, driveId)`.

- [ ] **Step 4: Tests, typecheck, live smoke, commit**

```bash
bunx vitest run subgraphs/http/routes/structure.test.ts && bun run tsc
git add subgraphs/http
git commit -m "feat(http): structure reads, privileged activity/history and admin routes"
```

---

### Task 17: `GET llms.txt` and `GET llms-full.txt`

**Files:**
- Create: `subgraphs/http/lib/llms.ts`
- Test: `subgraphs/http/lib/llms.test.ts`
- Modify: `subgraphs/http/index.ts` (register both, auth `renown-optional`)

**Interfaces:**
- ```ts
  export function renderLlmsTxt(vault: { mocLines: { tier: string; title: string; id: string }[] }, drive: string, base: string): string;
  export function renderLlmsFull(vault: { sections: { title: string; body: string }[] }): string;
  ```

- [ ] **Step 1: Pure tests for both renderers** (frontmatter-free plain text; HUB → DOMAIN → TOPIC ordering; `llms-full` concatenates bodies with separators).

- [ ] **Step 2: Handler**

Reads `knowledgeGraphNodes` filtered to `status === "MOC"` (parse `noteType` as `MOC (TIER)`) and CANONICAL notes plus SCOPE/WBS node `content` for the full file. For `renown-optional`: signed-in → `canonicalForRead`; anonymous → `canRead(drive, undefined)`; readable (OPEN) → MoC titles only; otherwise `HttpError(401, "UNAUTHENTICATED", "Sign in to read this vault")`.

- [ ] **Step 3: Register, tests, typecheck, live smoke, commit**

```bash
this.http.get("llms.txt", { auth: "renown-optional" }, createLlmsRoute(deps, false));
this.http.get("llms-full.txt", { auth: "renown-optional" }, createLlmsRoute(deps, true));
```
```bash
git add subgraphs/http
git commit -m "feat(http): llms.txt discovery and llms-full.txt"
```

---

### Task 18: `GET health.json` and `GET badge.svg`

**Files:**
- Create: `subgraphs/http/routes/health.ts`
- Test: `subgraphs/http/routes/health.test.ts`
- Modify: `subgraphs/http/index.ts` (register health `renown`, badge `public`)

**Interfaces:**
- ```ts
  export function createHealthRoute(deps: HttpRouteDeps): handler;   // GET health.json — last health report
  export function createBadgeRoute(deps: HttpRouteDeps): handler;    // GET badge.svg — PASS | WARN | FAIL | UNKNOWN
  export function badgeSvg(status: string): string;
  ```

- [ ] **Step 1: `badgeSvg` pure tests** — color per status (`PASS` green, `WARN` amber, `FAIL` red, `UNKNOWN` grey), valid `<svg>` with the status word, `Cache-Control: public, max-age=300` set by the handler.

- [ ] **Step 2: Handlers**

`health.json`: `?drive=` → locate `bai/health-report` via `find({ type, parentId })` → `canonicalForRead` → return `{ checks, summary, generatedAt }` from the document's global state (read the actual field names from `document-models/health-report/v1/src/`). `badge.svg`: `public`, reads the report with the **host** reactor client (no caller identity); on a read refusal return `UNKNOWN` with 200 and warn in the log — never a fabricated PASS. **Verify this live**: if the host read is refused on the protected drive, record it and ship `UNKNOWN` (the badge is honest rather than green).

- [ ] **Step 3: Register, tests, typecheck, live smoke, commit**

`curl -s http://localhost:4001/api/@powerhousedao/knowledge-note/badge.svg` (no bearer) → SVG with a truthful status word.
```bash
git add subgraphs/http
git commit -m "feat(http): health.json and a public honest status badge"
```

---

### Task 19: Slice close-out — docs, coverage, full smoke, spec/plan reconciliation

**Files:**
- Modify: `docs/http-api.md` (add every slice-2 route with `auth` and parameters)
- Modify: `docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md` (note the slice-2 directive)
- Modify: `powerhouse.manifest.json` if `PUBLIC_URL` is required by the badge/llms absolute links — check and add as `config` var (do not add secrets)

- [ ] **Step 1: Docs** — extend `docs/http-api.md`; list `badge.svg` under `"public"` (the grep test: grepping the doc for `"public"` lists every unauthenticated route).

- [ ] **Step 2: Full local gates** — `bun run tsc && bun run test:coverage && bun run lint:fix && bun run build`.

- [ ] **Step 3: Full live smoke** — every route in `docs/http-api.md`, both namespace spellings for one of them; record the transcript.

- [ ] **Step 4: Commit** — `docs(http): slice 2 route table and final smoke notes`.

