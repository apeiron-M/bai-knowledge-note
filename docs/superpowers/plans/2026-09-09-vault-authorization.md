# Vault Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Knowledge Vault from anonymous-everything to authenticated-read / granted-write, enforced at the Switchboard.

**Architecture:** Adopt the stack's Layer 2 (host document permissions). Every browser and script writer presents a Renown bearer; grants live on the drive document and inherit to all 1,467 documents; our own `knowledgeGraph*` subgraph gets its own gate because it reads the graph-indexer's Postgres tables and inherits no stack enforcement.

**Tech Stack:** `@powerhousedao/reactor-browser` (`ambientRenownTokenProvider`, `makeAuthMiddleware`, `makeAuthConnectionParams`), `@powerhousedao/reactor-api` (`BaseSubgraph.assertCanRead`), the core `/graphql/auth` subgraph, `ph access-token` for scripts.

**Spec:** `docs/superpowers/specs/2026-09-09-vault-authorization-design.md`

## Global Constraints

- Package manager is **bun** locally; the remote runtime is node. No `Bun.*` in anything shipping in `dist/`.
- Target env (already live locally): `AUTH_ENABLED=true`, `ADMINS="0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4"`, `DEFAULT_PROTECTION=true`, `DOCUMENT_PERMISSIONS_ENABLED=true`, `DATABASE_URL=.ph/read-storage`.
- Vault drive id (local): `cf9b51d2-2915-45be-be2c-0ad939bfc1ae`.
- Bearer tokens MUST be minted **without an `aud` claim** — the Switchboard verifier rejects tokens carrying an audience.
- Any authorization guard branches on `authorizationService.config.policy`, **never** on `isSupremeAdmin` — under `OPEN` that returns `true` for everyone including anonymous.
- Renown credentials expire in **7 days** and revocation lags the verification cache (default 60s). No API keys exist.
- `bun run tsc` and `bun run lint:fix` must pass at the end of every task.

## Status and measured baseline (2026-09-09, verified against localhost:4001)

Rings 0 and 1 are **live and enforcing**. Measured with the admin bearer vs anonymous:

| Probe | Anonymous | Admin bearer |
|---|---|---|
| `document(identifier: <drive>)` on `/graphql/r` | `FORBIDDEN: insufficient permissions to read this document` | `powerhouse-knowledge` |
| `knowledgeGraphStats(driveId:)` | **1067 nodes, 982 notes, 4691 edges** | same |
| `knowledgeGraphRecent(driveId:, limit: 1)` | **full note body — 12,696 chars** | same |

**Task 6 is therefore reprioritised to run first.** The reactor's own read path is closed,
but our subgraph is an open door onto the same content: it reads the graph-indexer's
Postgres tables, so no amount of Layer 2 configuration reaches it. Until it is gated, the
vault's protection is cosmetic — anyone with the URL still reads every note in full.

Revised order: **Task 6 → Task 1 (done) → 2 → 3 → 4 → 5.**

### Task 6 — COMPLETE (ran first, per the reorder)

`subgraphs/knowledge-graph/resolvers.ts`: `withCanonicalDriveIds` became
`withDriveGuards` — it authorizes the caller against the drive, then canonicalizes
the id. One wrapper, both application sites (`Query`, `Mutation`), all 32 resolvers,
so a new resolver cannot be added ungated by omission.

Two tiers: `PRIVILEGED_RESOLVERS` (`Reindex`, `UpsertEmbedding`, `Debug`, `History`,
`Activity`, `ActivityByType`) require `assertCanWrite`; everything else
`assertCanRead`. No policy branching — the assert helpers already answer correctly
per policy, and `isSupremeAdmin` would have been wrong (true for everyone under
`OPEN`). `ForbiddenError` is not in reactor-api's public type surface, so the
no-driveId fail-closed path throws `GraphQLError` with `extensions.code = "FORBIDDEN"`
to match the wire shape.

Measured live (hot-reloaded, no restart):

| Probe | Before | After |
|---|---|---|
| anon `knowledgeGraphStats` | 1067 nodes | `FORBIDDEN` |
| anon `knowledgeGraphRecent` | **12,696 chars of note body** | `FORBIDDEN` |
| anon `knowledgeGraphDebug` | namespace + raw tables | `FORBIDDEN` (write tier) |
| anon, drive named by **slug** | — | `FORBIDDEN` (no slug bypass) |
| admin, all of the above | — | ALLOWED (12,696 chars) |

`bun run tsc` exit 0; full suite 972 passed / 6 skipped; no lint findings in the file.
Not yet committed.

### Task 2 — COMPLETE

**The plan's inventory was wrong: ten call sites, not five.** A full sweep of
`fetch(` across `editors/` found `ActivityView`, `use-graph-metadata` (x2),
`use-graph-search`, `use-drive-init`, `vault-tools`, `boot`,
`use-vault-doc-index` (x2) and `document-state` — each a credential-free POST to
the reactor or our own subgraph, i.e. each its own bypass. Anyone repeating this
work should inventory before planning, not after.

Added `authHeaders()` beside `authedGraphQLFetch`. Nine sites take the headers
helper (one `headers:` line changed, every query and response path untouched);
`document-state.ts` uses the wrapper since its call was already uniform.

The chat's third-party endpoints are deliberately excluded — `completions-client`,
`provider`, `openrouter-auth`. Sending a Renown credential to an arbitrary
user-configured LLM base URL would leak it. `openrouter-auth`'s own token
exchange matches the same header shape, so the transform excluded it by name.

The subscription needed `connectionParams`, not a header:
`REQUIRE_AUTHENTICATED_CALLER` is a fetch middleware and never sees the WS
upgrade, while `AUTH_ENABLED=true` refuses a tokenless connection outright.
That was the cause of the `pollSyncEnvelopes … Forbidden` log spam.

`bun run tsc` exit 0; suite 974 passed / 6 skipped. Committed.

### Tasks 4, 5 and the dashboard — COMPLETE

**Task 4** — `scripts/drive-sync/lib/gql.py` and `reindex.py` send
`PH_ACCESS_TOKEN` when set. The bearer sits on gql.py's shared header dict, so
all six mutations and both reads inherit it. Absent is left absent so the
scripts still work against an open reactor. README documents
`export PH_ACCESS_TOKEN="$(ph access-token | tail -1)"` and the 7-day expiry.

**Task 5** — `scripts/drive-sync/grants.py`. Dry run by default, idempotent,
and it writes on the *drive* so one row per person covers every document.
Verified live: list on an empty drive, dry run writing nothing, apply,
idempotent re-run, READ→WRITE upsert producing one row not two, revoke, and a
no-op revoke.

**Dashboard** (was deferred; pulled forward on request) — `AccessView.tsx` under
the gear in `SettingsMenu`, plus `resolveAuthEndpoint()`. Verdict-first layout,
inheritance stated in words, lockout prevention, confirm-then-revoke, and an
explicit note that the model is allow-only.

**An extra fix that was not in the plan.** `editors/knowledge-vault/lib/remote-first.ts`
built the app's `GraphQLReactorClient` with `createClient(endpoint)` and no
middleware, so every read through it was anonymous and a logged-in admin still
got FORBIDDEN at boot. Easy to miss because that client already *signs* the
actions it pushes — but a signature is provenance on the payload, not
authentication of the request. Fixed with `makeAuthMiddleware(getBearerToken)`.

Remaining: **Task 3** (the Renown login gate). Everything else is done.

### Task 1 — COMPLETE

`editors/shared/authed-fetch.ts` + 4 passing tests; `remote-reactor.ts:gqlRequest` now
routes through `authedGraphQLFetch`, so all four writers (`mutateDocumentRemote`,
`createDocumentRemote`, `createFolderRemote`, `deleteDocumentRemote`) carry a bearer.
`bun run tsc` exit 0; full suite 972 passed / 6 skipped; no new lint findings.
Not yet committed.

---

### Task 1: One authed GraphQL fetch for the browser

**Files:**
- Create: `editors/shared/authed-fetch.ts`
- Modify: `editors/shared/remote-reactor.ts:59-69` (the single `fetch` all four writers share)
- Test: `editors/shared/authed-fetch.test.ts`

**Interfaces:**
- Produces: `getBearerToken(): Promise<string | undefined>`, `authedGraphQLFetch(endpoint: string, body: unknown): Promise<Response>`
- Consumed by: Tasks 2, 3, 6 and every other browser fetch site.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { authedGraphQLFetch } from "./authed-fetch.js";

describe("authedGraphQLFetch", () => {
  it("attaches the bearer when a token is available", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await authedGraphQLFetch("http://x/graphql/r", { query: "{a}" }, async () => "tok123");
    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("omits the header entirely when no token is available", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await authedGraphQLFetch("http://x/graphql/r", { query: "{a}" }, async () => undefined);
    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect("Authorization" in headers).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- editors/shared/authed-fetch.test.ts`
Expected: FAIL — cannot resolve `./authed-fetch.js`.

- [ ] **Step 3: Implement the module**

```ts
/**
 * The one place a browser write or read attaches its identity.
 *
 * Every `bai/*` write from the app goes through the raw GraphQL surfaces
 * (`/graphql`, `/graphql/r`) rather than Connect's authenticated reactor,
 * because remote-first exists to dodge Chrome's IndexedDB cap. That decision
 * is why the bearer has to be attached here by hand.
 *
 * The token carries NO `aud` claim: the Switchboard verifier rejects tokens
 * that declare an audience unless it has an app address configured.
 */
import { ambientRenownTokenProvider } from "@powerhousedao/reactor-browser";

export type TokenProvider = () => Promise<string | undefined>;

export const getBearerToken: TokenProvider = async () => {
  try {
    return await ambientRenownTokenProvider();
  } catch {
    return undefined;
  }
};

export async function authedGraphQLFetch(
  endpoint: string,
  body: unknown,
  tokenProvider: TokenProvider = getBearerToken,
): Promise<Response> {
  const token = await tokenProvider();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `bun run test -- editors/shared/authed-fetch.test.ts`

- [ ] **Step 5: Route `remote-reactor.ts` through it**

Read `editors/shared/remote-reactor.ts:55-75` first. Replace the inline `fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: ... })` with `authedGraphQLFetch(endpoint, bodyObject)`, importing from `./authed-fetch.js`. Do not change the function's signature or error handling — the `HTTP ${res.status}` throw stays.

- [ ] **Step 6: Verify and commit**

Run: `bun run tsc && bun run lint:fix && bun run test`

```bash
git add editors/shared/authed-fetch.ts editors/shared/authed-fetch.test.ts editors/shared/remote-reactor.ts
git commit -m "feat(auth): attach a Renown bearer to every browser GraphQL write"
```

---

### Task 2: The remaining browser read sites and the WebSocket

**Files:**
- Modify (actual, 10 sites): `editors/shared/document-state.ts`, `editors/shared/use-vault-doc-index.ts` (x2), `editors/knowledge-vault/components/ActivityView.tsx`, `editors/knowledge-vault/hooks/use-graph-metadata.ts` (x2), `editors/knowledge-vault/hooks/use-graph-search.ts`, `editors/knowledge-vault/hooks/use-drive-init.ts`, `editors/knowledge-vault/lib/boot.ts`, `editors/knowledge-vault/lib/chat/vault-tools.ts` — note `use-document-revisions.ts` has no fetch of its own
- Modify: `editors/knowledge-vault/hooks/use-remote-first.ts:355` (the `graphql-ws` client)

**Interfaces:**
- Consumes: `authedGraphQLFetch`, `getBearerToken` from Task 1.

- [ ] **Step 1: Replace each raw `fetch(` with `authedGraphQLFetch`**

In each of the five files, swap the raw POST for `authedGraphQLFetch(endpoint, body)`. `boot.ts` runs at package load, so it must tolerate `undefined` (no logged-in user yet) — it already swallows failures; keep that.

- [ ] **Step 2: Authenticate the subscription**

`createWsClient` accepts `connectionParams`. Wire the token in:

```ts
import { makeAuthConnectionParams } from "@powerhousedao/reactor-browser";
import { getBearerToken } from "../../shared/authed-fetch.js";

const client = createWsClient({
  url: wsUrl,
  connectionParams: makeAuthConnectionParams(getBearerToken),
});
```

`authenticateWebSocketConnection` throws on a tokenless connection while `AUTH_ENABLED=true`, so without this the live change feed stays dead.

- [ ] **Step 3: Verify**

Run: `bun run tsc && bun run lint:fix && bun run test`
Then with `ph vetra --watch` running and logged in: the `pollSyncEnvelopes … Forbidden` error should stop once Task 5's grants exist.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(auth): authenticate the remaining browser reads and the subscription"
```

---

### Task 3: Renown login gate in the vault app

**Files:**
- Create: `editors/knowledge-vault/components/AuthGate.tsx`
- Modify: the `knowledge-vault` editor root (wrap content in `<AuthGate>`)

**Interfaces:**
- Consumes: `useRenownAuth`, `RenownAuthButton` from `@powerhousedao/reactor-browser`; `authedGraphQLFetch` from Task 1.
- Produces: `<AuthGate>{children}</AuthGate>` — renders children only for a signed-in address holding at least READ.

- [ ] **Step 1: Implement the gate**

Three states: checking, signed-out (show `RenownAuthButton`), signed-in-but-unauthorized (show the address and what to ask for). The read check uses the caller's **own** grants — `documentAccess` requires ADMIN and would fail for exactly the users being gated:

```ts
const CAN_READ = `query { userDocumentPermissions { documentId permission } }`;
```

Treat a non-empty result, or supreme-admin status, as authorized. A GraphQL `FORBIDDEN`/`UNAUTHENTICATED` error means unauthorized, not broken.

- [ ] **Step 2: Verify manually**

Signed out → gate. Signed in as `0xadbA…` (supreme admin) → vault renders. Signed in as an ungranted address → the unauthorized state.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(auth): require a Renown login before the vault renders"
```

---

### Task 4: Bearer for the scripts

**Files:**
- Modify: `scripts/drive-sync/lib/gql.py:120-124` (the header dict)
- Modify: `scripts/drive-sync/reindex.py`
- Modify: `scripts/drive-sync/README.md`

- [ ] **Step 1: Send the token when present**

```python
headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Connection": "keep-alive",
}
_token = os.environ.get("PH_ACCESS_TOKEN")
if _token:
    headers["Authorization"] = f"Bearer {_token}"
```

- [ ] **Step 2: Document how to obtain it**

```bash
export PH_ACCESS_TOKEN="$(ph access-token | tail -1)"
```

Note in the README that Renown credentials expire in ~7 days, so the export is per-session.

- [ ] **Step 3: Verify**

Run `python3 -m py_compile scripts/drive-sync/lib/gql.py scripts/drive-sync/reindex.py`, then a read-only `download.py` against localhost with and without the token — with it, data; without it, `Forbidden`.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(auth): drive-sync sends PH_ACCESS_TOKEN when set"
```

---

### Task 5: Grant bootstrap on the drive

**Files:**
- Create: `scripts/drive-sync/grants.py`

**Interfaces:**
- Produces: `python3 scripts/drive-sync/grants.py --drive <id> --read <addr>… --write <addr>… [--dry-run]`

- [ ] **Step 1: Implement, idempotent, dry-run by default**

Grants go on the **drive document**, because `#hasGrantInHierarchy` walks the parent chain — one row per person covers all 1,467 documents. Mutations against `/graphql/auth`:

```graphql
mutation Grant($doc: String!, $addr: String!, $perm: DocumentPermissionLevel!) {
  grantDocumentPermission(documentId: $doc, userAddress: $addr, permission: $perm) {
    documentId userAddress permission
  }
}
```

Read current state first with `documentAccess(documentId:)` (needs ADMIN — run as `0xadbA…`) and skip addresses already at the right level. Print a before/after table.

- [ ] **Step 2: Verify each role**

For a granted reader: a `document(identifier:)` read succeeds and a `mutateDocument` fails. For a granted writer: both succeed. For an ungranted address: both fail.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(auth): grant bootstrap script for drive-level READ/WRITE"
```

---

### Task 6: Gate our own subgraph (Ring 2)

**Files:**
- Modify: `subgraphs/knowledge-graph/resolvers.ts:33` (`withCanonicalDriveIds`)
- Test: `subgraphs/knowledge-graph/resolvers.auth.test.ts`

**Interfaces:**
- Consumes: `BaseSubgraph.assertCanRead(identifier, ctx)`, `authorizationService.config.policy`, `ForbiddenError`.

- [ ] **Step 1: Write the failing test**

Three tiers, asserted separately: ordinary reads require READ on the drive; `knowledgeGraphDebug` / `History` / `Activity` / `ActivityByType` require ADMIN (raw tables and contributor addresses); `knowledgeGraphReindex` / `knowledgeGraphUpsertEmbedding` require ADMIN. Also assert a **slug** is gated identically to a UUID — `resolveCanonicalDriveId` accepts both.

- [ ] **Step 2: Implement inside the existing wrapper**

`withCanonicalDriveIds` already wraps all 32 resolvers and already holds the `driveId`, so the guard goes there rather than into 32 bodies. Branch on the policy — under `OPEN` the stack's own check is a no-op and ours must still refuse the admin tiers:

```ts
if (authorizationService.config.policy !== AuthorizationPolicy.DOCUMENT_PERMISSIONS) {
  // ADMIN tiers are refused outright; ordinary reads fall through.
}
```

- [ ] **Step 3: Verify**

Run: `bun run test -- subgraphs/knowledge-graph` then `bun run tsc && bun run lint:fix`.
Manually: anonymous `knowledgeGraphNodes` → `FORBIDDEN`; admin → data.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(auth): gate the knowledgeGraph subgraph per drive"
```

---

## Deferred to its own spec → plan cycle

The admin dashboard (spec §7: six-minds design, Exposure / People / Documents tabs, inside
`SettingsMenu` at `editors/knowledge-vault/components/DriveExplorer.tsx:442`). It depends on
Ring 1 being live — the `/graphql/auth` subgraph only registers under
`DOCUMENT_PERMISSIONS_ENABLED=true`, which is now true. Also deferred: the chat's
`localStorage` LLM keys (spec §5.6, decision 6).

## Known upstream bug, worth filing

`DOCUMENT_PERMISSIONS_ENABLED=true` crashes at boot on any database where the attachments
subsystem migrated first: reactor-api builds its migrator with no schema
(`new Migrator({ db, provider })`), and Kysely's existence check
(`tables.some(it => it.name === tableName && (!schema || it.schema === schema))`) finds
`attachments.kysely_migration_lock` and skips creating `public.kysely_migration_lock`. The
migration transaction's unqualified `SELECT … FOR UPDATE` then fails. Worked around locally
by creating the two tables in `public`. Postgres is affected identically — the remote will
hit this when document permissions are enabled there.
