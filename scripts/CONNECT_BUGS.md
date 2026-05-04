# Connect / `reactor-browser` Bug Report

## 1. Summary

This document collects Connect-side issues we hit while exercising the `switchboard import` → Connect roundtrip on a 398-doc vault drive. None of these are CLI bugs (those live in [SWITCHBOARD_CLI_BUGS.md](SWITCHBOARD_CLI_BUGS.md)). They live in `@powerhousedao/connect` and `@powerhousedao/reactor-browser` and surface when a drive is populated server-side (via the CLI or any external tool) and then opened in Connect.

## 2. Environment

| Item            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Connect         | `localhost:3001` (Vite dev server, watch mode)             |
| Reactor         | `localhost:4001/graphql` (running under `ph vetra --watch`) |
| Drive under test | `my-vault` (398 docs imported via `switchboard import` 1.0.23) |
| Date            | 2026-04-30                                                 |

## 3. Bugs

### Bug 1 — Drive opened by URL doesn't register a sync channel; `KyselyDocumentView` throws on every `reactor.get(id)`

**Severity:** Blocker for any drive populated outside Connect (CLI imports, external API writes).

**Symptom:** Open `localhost:3001/d/<slug>` for a drive that was created or populated server-side. The drive document loads (sidebar shows the entry, drive node tree is correct), but `reactor.get(id)` for every per-doc lookup throws `Error: Document not found: <uuid>` from `KyselyDocumentView.resolveIdOrSlug`. Network tab shows ONE 200 OK for the drive doc, then silence — no GraphQL polling, no per-doc fetches, no IndexedDB writes.

**Root cause:** `reactor-browser`'s `SyncManager` (`dist-CN7N2cd0.js:13164`) only spins up a `GqlRequestChannel` polling loop for a drive when `addRemoteDrive(url)` is called explicitly. The three call sites are:

1. The "Add Drive" / "Add Public Drive" UI modal in the sidebar.
2. URL query param `?driveUrl=<url>` (handled by `getDriveUrl()` at boot).
3. `PH_CONNECT_DEFAULT_DRIVES_URL` env var (boot only).

**Browsing to `/d/<slug>` does NOT call `addRemoteDrive`.** Connect's drive registry shows the drive (because Connect mirrors the reactor's drive list at boot), but there's no polling channel, so per-doc operations never stream into PGlite. `reactor.get(docId)` then hits an empty `DocumentSnapshot` table and throws.

**Reproduction:**

```bash
# 1. Create a drive via CLI (no Connect involvement)
switchboard --profile local drives create --name "test" --preferred-editor knowledge-vault

# 2. Import docs into it
switchboard --profile local import ./vault-dump --drive <id>

# 3. Open localhost:3001/d/<slug> directly
# → Drive renders, all reactor.get(id) calls throw "Document not found"
```

**Workaround:** Use Connect's "+ Add Drive" sidebar dialog with `http://localhost:4001/d/<slug>` (or whatever the reactor's drive HTTP endpoint is — returns `{id, slug, graphqlEndpoint, meta, name}`). That fires `addRemoteDrive`, registers the GqlRequestChannel, and polling backfills IndexedDB from `sinceTimestampUtcMs=0`.

**Expected:** Either:

- (a) Browsing to `/d/<slug>` should auto-call `addRemoteDrive` for any drive that has an associated `graphqlEndpoint` in its registry entry. The drive metadata already contains everything `addRemoteDrive` needs.
- (b) When the user navigates to a drive that has no sync channel, prompt them to add it via the "Add Drive" flow (or surface a clear "this drive has no sync subscription — click here to subscribe" affordance).

The current behavior (silent failure with thousands of `Document not found` rejections in the console) is the worst of both worlds.

---

### Bug 2 — `KyselyDocumentView.resolveIdOrSlug` rejects synchronously on `id-in-tree-but-not-yet-replicated`, surfacing as React render crashes

**Severity:** Major. Manifests as both unhandled promise rejection floods and as Suspense-triggered render crashes.

**Symptom:** Even when `addRemoteDrive` has registered the sync channel and polling is firing, there's a window during initial sync where the drive node tree is in IndexedDB but per-doc payloads haven't arrived yet. During this window:

1. **Console flood**: hundreds of `Uncaught (in promise) Error: Document not found: <uuid>` from `KyselyDocumentView.resolveIdOrSlug`. These come from Connect's eager prefetch loop walking the drive's node tree and calling `reactor.get(id)` for each id without a `.catch()`.
2. **Render crash**: hooks like `useDocumentsInSelectedDrive` use Suspense to fetch docs; the resolveIdOrSlug rejection propagates synchronously through the Suspense boundary and crashes whatever component called it. With our knowledge-vault editor, this manifests as the entire `DriveExplorer` subtree crashing into Connect's outer `ErrorBoundary`.
3. **Re-add cycle reproduces it**: removing the drive from Connect (which drops its IndexedDB cache) and re-adding it via "Add Drive" puts us back in the same race window — render crashes again until sync catches up.

**Reproduction:**

After Bug 1 workaround (drive added via "Add Drive"), the editor crashes during initial sync with `Error: Document not found: <uuid>`. Stack trace:

```
at KyselyDocumentView.resolveIdOrSlug (dist-CN7N2cd0.js:9886:34)
at async KyselyDocumentView.getByIdOrSlug (dist-CN7N2cd0.js:9814:22)
at async Reactor.getByIdOrSlug (dist-CN7N2cd0.js:13786:10)
at async ReactorClient.get (dist-CN7N2cd0.js:5674:10)
```

**Expected:**

1. `KyselyDocumentView.resolveIdOrSlug` should distinguish "id is present in the drive's node tree but not yet in `DocumentSnapshot`" (transient — wait for replication, or return `undefined`/throw a Suspense-compatible promise to trigger a re-render once it lands) from "id is genuinely absent from both the tree and the snapshot" (real error).
2. Whoever calls `reactor.get(id)` during eager prefetch should `.catch()` and either retry or surface a single aggregate "syncing N documents…" message instead of N individual rejections.
3. Suspense-using hooks should tolerate transient absence — wait for the next polling cycle rather than throwing.

**Workaround in our editor:** [editors/knowledge-vault/components/DebugErrorBoundary.tsx](../editors/knowledge-vault/components/DebugErrorBoundary.tsx) catches the throw and shows a "Loading vault…" UI while retrying. This is fragile in React 19 — `setState` inside `componentDidCatch` doesn't reliably remount children when the same throw fires immediately on retry, so the boundary often gets stuck at attempt 1 even though sync is making progress.

---

### Bug 3 — Connect's outer `ErrorBoundary` template-stringifies the caught error, dropping `error.message`

**Severity:** Minor (DX papercut, but compounds debugging time on the bugs above).

**Symptom:** When the knowledge-vault editor crashes (Bug 2), Connect's `handleError` (`@powerhousedao_connect.js:6927`) logs:

```
[Connect][App] {} {"componentStack":"\n    at DriveExplorer ..."}
```

The first arg — the actual `Error` object — renders as `{}`. There's nothing to expand in DevTools because `JSON.stringify(new Error('foo'))` returns `"{}"` (`Error.message` isn't enumerable). The componentStack object stringifies fine.

Without the error message, the only way to debug a render crash is to wrap our own `componentDidCatch` and log the error properly (which is what [DebugErrorBoundary](../editors/knowledge-vault/components/DebugErrorBoundary.tsx) does).

**Expected:** `console.error('[Connect][App]', error, errorInfo)` — pass the error as a separate arg, not template-string concatenated. Chrome's DevTools renders raw error objects with the full message + stack expandably.

---

### Bug 4 — `useDriveInit` re-seeds singletons on every mount; each "Add Drive" of an already-populated drive creates more duplicates

**Severity:** Major.

**Symptom:** Our knowledge-vault drive-app calls `useDriveInit` in its top-level `Editor` component. The hook's purpose is to ensure a fresh drive has the four singleton docs (`bai/vault-config`, `bai/knowledge-graph`, `bai/health-report`, `bai/pipeline-queue`) plus the standard folder skeleton (`/knowledge/`, `/ops/`, `/self/`, `/sources/`, etc.).

The hook fires on every mount, and apparently doesn't check whether the drive already has docs of those types before creating new ones. Combined with `switchboard import`'s singleton handling (which produces `(copy) 1` renames — see CLI Bug 9), repeatedly opening a populated drive can compound duplicates over time.

This is partly an editor-side bug (we wrote `useDriveInit`), but Connect's mount/unmount/remount lifecycle drives it. Cleaning up requires cooperation from both layers.

**Expected (editor side):** `useDriveInit` should query the drive for existing singletons by type before creating new ones, and skip creation if any are present.

**Expected (Connect side):** Drive-app mount/unmount semantics should clearly distinguish "first ever open of this drive" from "re-open after a remove-and-readd cycle" — currently a remove-and-readd looks identical to first-open from the editor's perspective.

---

## 4. Suggested fixes (in priority order)

1. **Bug 1: auto-`addRemoteDrive` on URL navigation** for drives that have a `graphqlEndpoint` in their registry entry. Closes the silent-no-sync failure mode entirely.
2. **Bug 2: make `KyselyDocumentView.resolveIdOrSlug` tolerant** of pending-replication ids — return Suspense-compatible promise or undefined for ids in the drive tree, only throw `Document not found` for genuinely-missing ids.
3. **Bug 3: pass error as a console.error arg**, not template-stringified.
4. **Bug 4: standardize a `useDriveInit`-style idempotency contract** (Connect or shared docs) so editor authors know how to safely seed defaults.
