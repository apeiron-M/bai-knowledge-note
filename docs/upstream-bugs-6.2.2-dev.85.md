# Upstream bug report — Powerhouse `6.2.2-dev.85`

Five defects in the Powerhouse stack found while building vault authorization
(`feat/vault-authorization`). Each is reported in the shape of upstream's
`.github/ISSUE_TEMPLATE/bug_report.md` so a section can be pasted into an issue
as-is. Together they produce the user-visible failure *"a protected drive
disappears on sign-out / a share link does not survive Renown login, the console
error that appears instead is about `#level`, and a share link opened signed out
shows an inescapable 'Log in to access this drive' card"*.

| | Field | Value |
|-|-------|-------|
| Reported against | `@powerhousedao/*` `6.2.2-dev.85` (`v6.2.2-dev.85` = `b5035f5`, published 2026-09-09 10:15 UTC) |
| Re-verified against | published `6.2.3-dev.0` tarballs (2026-09-10 09:18 UTC) **and** `main` @ `4f706b7` (2026-09-10 09:34 UTC) |
| Verdict | **all four are still present** in both — nothing between `dev.85` and `main` touches the defective lines |
| Existing issues | none found for any of the four (searched issue titles/bodies for the error strings and file names) |
| Reporter environment | Connect `6.2.2-dev.85` in Chrome on Arch Linux; Switchboard via `ph reactor` with `AUTH_ENABLED=true`, `DEFAULT_PROTECTION=true`, `DOCUMENT_PERMISSIONS_ENABLED=true`, `REQUIRE_AUTHENTICATED_CALLER=true`; `graphql-ws` 6.0.7 |

## Verification summary

| # | Defect | Package · file (on `main`) | In `6.2.3-dev.0` dist? | On `main` `4f706b7`? | Last commit touching the file |
|---|--------|----------------------------|------------------------|----------------------|-------------------------------|
| 1 | Unbound `logger.error` in `.catch` → `TypeError … '#level'` | `reactor-browser` · `packages/reactor-browser/src/hooks/dispatch.ts:35-37` | yes (`dist/document-by-id-*.js:498`) | yes | `86cf174` 2026-03-18 |
| 2 | Tokenless WS `context()` throws → graphql-ws closes **4500**, client never retries | `reactor-api` · `packages/reactor-api/src/services/auth.service.ts:182` via `src/graphql/graphql-manager.ts:817-863` | yes | yes | `235829f` 2026-09-09 (touched the file; the throw is unchanged) |
| 3 | `SyncManager.startup()` drops a remote on `init()` failure, no retry; `add()` also deletes it from storage | `reactor` · `packages/reactor/src/sync/sync-manager.ts:219-228` and `:429-434` | yes | yes | `6181322` 2026-08-24 |
| 4 | Renown `returnUrl` built from `pathname`+`origin`, query string dropped | `reactor-browser` · `packages/reactor-browser/src/renown/session.ts:29-30` | yes (`dist/renown-*.js:127-128`) | yes | `7f40b48` 2026-08-27 |

How this was checked is in the appendix. Short version: the four release commits
since `dev.85` (`dev.86`, `dev.87`, `dev.88`, `6.2.3-dev.0`) and the sixteen
commits after them are packaging, docs, ph-cli/update tooling, webhook hosting
and design-system work; none of the four files changed in a relevant way, and
the published `6.2.3-dev.0` bundles still contain the exact patterns.

---

## 1. `useDispatch` passes an unbound `logger.error` to `.catch` — every dispatch failure surfaces as `TypeError: Cannot read properties of undefined (reading '#level')`

**Package:** `@powerhousedao/reactor-browser` (the logger comes from `document-model`)

**Describe the bug**

`useDispatch` swallows the real rejection of `dispatchActions` and replaces it
with an unrelated `TypeError`. `logger` is a `ConsoleLogger` instance whose
methods read the private field `this.#level`; passed as a bare callback the
method runs with `this === undefined`, so the *error handler itself throws*.
The original error — a `Forbidden`, a reducer error, a network failure — is
lost.

```ts
// packages/reactor-browser/src/hooks/dispatch.ts:35-37 (main @ 4f706b7)
dispatchActions(actionOrActions, document, onErrors, onSuccess).catch(
  logger.error,
);
```

```js
// document-model ConsoleLogger (dist/index.js:162, :207)
#level = LOG_LEVELS.info;
…
error(message, ...replacements) {
  if (this.#level <= LOG_LEVELS.error) { … }   // `this` is undefined here
}
```

**To Reproduce**

Minimal, no UI:

```js
import { logger } from "document-model";
Promise.reject(new Error("the real error")).catch(logger.error);
// → Uncaught (in promise) TypeError: Cannot read properties of undefined (reading '#level')
```

In the app: sign in to Connect as an account that can read but not write a
protected document, open it in any editor built on the generated
`useSelected<Model>Document` hooks, and perform an edit. The reactor rejects the
write; the console shows the `#level` TypeError, not the rejection.

**Resulting behavior**

Console: `dist-DDHpdWkg.js:201 Uncaught (in promise) TypeError: Cannot read
properties of undefined (reading '#level')`. Nothing about *why* the dispatch
failed is logged anywhere.

**Expected behavior**

The original rejection is logged with the logger's normal formatting, and
nothing throws from the error path.

**Additional context**

- Every editor in every package uses this hook indirectly (the generated
  `useSelected*Document` / `use*DocumentById` hooks build on `useDispatch`), so
  the masking is universal rather than local to one editor.
- `logger` is exported as an instance and handed around widely; this is the
  only bare-method pass I found in the published bundles, but the class makes
  the mistake easy to repeat.

**Suggested fix**

Either at the call site —

```ts
.catch((error: unknown) => logger.error(error));
```

— or, more durably, make `ConsoleLogger`'s methods safe to detach (arrow-function
class fields, or `bind` in the constructor), since a logger is precisely the kind
of object people pass as a callback.

**How will regressions be avoided in the future**

- Unit test: `useDispatch` with a `dispatchActions` stub that rejects → the
  logger's `error` is called with the original error and no exception escapes.
- Enable `@typescript-eslint/unbound-method` in the repo's lint config; it flags
  this pattern at the call site.

---

## 2. A tokenless WebSocket against an auth-enabled Switchboard throws inside graphql-ws `context()` — socket closed **4500 Internal Server Error**, and the client will never retry

**Package:** `@powerhousedao/reactor-api`

**Describe the bug**

`AuthService.authenticateWebSocketConnection` throws a plain `Error` when a
connection carries no `authorization` in its connectionParams and auth is
enabled:

```ts
// packages/reactor-api/src/services/auth.service.ts:182
throw new Error("Missing authorization in connection parameters");
```

It is called from `GraphQLManager.#createWebSocketContext`
(`src/graphql/graphql-manager.ts:817-826`). `#makeWsContextFactory` (`:862-863`)
hands that function to `GatewayAdapter.attachWebSocket`, and both adapters
(`src/graphql/gateway/adapter-gateway-apollo.ts`,
`adapter-gateway-mercurius.ts`) install it as the graphql-ws **`context`**
option — with **no `onConnect`** configured:

```ts
return useServer({
  schema,
  context: async (ctx) => contextFactory(ctx.connectionParams ?? {}),
}, wsServer);
```

Two properties of graphql-ws (6.0.7) turn that throw into a hard failure:

1. `context()` is invoked **per operation**, not per connection
   (`graphql-ws/dist/server.js` — `execArgs.contextValue = typeof context === "function" ? await context(ctx, id, payload, execArgs) : context`).
   The handshake succeeds (`connection_ack`), and the first `subscribe` blows up.
2. Any exception escaping message handling is treated as a server fault:
   `use/ws.js` logs *"Internal error occurred during message handling"* and
   calls `socket.close(CloseCode.InternalServerError /* 4500 */, …)`.
   On the client, 4500 is in the hard-coded fatal list
   (`client.js` `shouldRetryConnectOrThrow`) — the connection is abandoned
   **regardless of `retryAttempts` / `shouldRetry`**, and every subscription on
   that socket dies with it.

The same path fires for `"Invalid authorization format"`, `"Token verification
failed"`, `"Invalid credentials"` and `"Credentials no longer valid"` — all
client-side conditions, all reported as server errors.

**To Reproduce**

1. Switchboard with `AUTH_ENABLED=true`.
2. Open Connect without a Renown session (or open any graphql-ws client with no
   `connectionParams.authorization`) and subscribe to anything.
3. Watch the server log and the socket close code.

**Resulting behavior**

- Switchboard log: an error-level line `Missing authorization in connection
  parameters` plus graphql-ws's *Internal error occurred during message
  handling*, once per anonymous subscription attempt.
- Client: socket closed with code **4500**; the live change feed is dead until
  something recreates the socket (in Connect, a page reload). Signing in does
  not revive it because the client has given up.

**Expected behavior**

An authentication refusal is a client condition. The socket should close with
`CloseCode.Unauthorized` (**4401**) — or `Forbidden` (4403), which graphql-ws
deliberately keeps *retryable* ("might grant access after retry") — and be
logged at `info`/`warn`, not `error`.

Also note the inconsistency with the HTTP path: `AuthService.verifyBearer`
returns `{ user: undefined, … }` for a tokenless request and lets each resolver
authorize per document (this is what makes `DEFAULT_PROTECTION` work per
document over HTTP). The WebSocket path refuses the *connection* before any
resolver can decide. An anonymous WS caller should get the same
`user: undefined` context and be authorized per subscription.

**Suggested fix**

Move the credential check to `onConnect`, once per connection, and return a
proper close code; keep `context()` pure:

```ts
useServer({
  schema,
  onConnect: async (ctx) => {
    try {
      const user = await authService.authenticateWebSocketConnection(ctx.connectionParams ?? {});
      (ctx.extra as { user?: User | null }).user = user;
      return true;
    } catch {
      ctx.extra.socket.close(CloseCode.Unauthorized, "Unauthorized"); // 4401
      return false;
    }
  },
  context: (ctx) => ({ headers: ctx.connectionParams, db, user: ctx.extra.user ?? undefined, … }),
}, wss);
```

Or, to match the HTTP behaviour exactly: have `authenticateWebSocketConnection`
return `null` for a *missing* header (anonymous), and reserve the refusal for
a header that is present but invalid.

**How will regressions be avoided in the future**

- reactor-api integration test: graphql-ws client with no `authorization`
  against an auth-enabled server → close code 4401 (or 4403) and no
  error-level log line; with a valid bearer → subscription delivers.
- Test that a tokenless subscription to an *unprotected* document succeeds,
  matching the HTTP path.

---

## 3. `SyncManager.startup()` drops a remote whose channel fails to initialise, with no retry — and `add()` deletes the remote from storage on the same failure

**Package:** `@powerhousedao/reactor`

**Describe the bug**

```ts
// packages/reactor/src/sync/sync-manager.ts:219-228 (startup)
try {
  await channel.init();
} catch (error) {
  this.logger.error("Error initializing channel for remote (@name, @error)", record.name, …);
  this.remotes.delete(record.name);   // gone for the life of this process
  continue;
}

// :429-434 (add)
try {
  await channel.init();
} catch (error) {
  this.remotes.delete(name);
  await this.remoteStorage.remove(name);   // gone from storage too
  throw error;
}
```

`channel.init()` for a GraphQL request channel calls the remote's
`touchChannel` mutation, which `reactor-api` gates on read access to the drive
(`src/graphql/reactor/subgraph.ts` → `assertCanReadCanonical(driveId)` unless
the caller is a supreme admin). With `DEFAULT_PROTECTION=true` an anonymous or
signed-out Connect is refused (HTTP 401 with `REQUIRE_AUTHENTICATED_CALLER`, or
a `Forbidden` GraphQL error without it), so `init()` rejects — and a *credential*
problem is handled as if the remote's configuration were permanently invalid.

**To Reproduce**

A. Startup path
1. Sign in, add a protected remote drive, confirm it syncs.
2. Sign out in Connect (or reload while signed out).
3. The drive is gone from the drive list. Sign in again — it stays gone until
   a full reload while the session exists.

B. Add path
1. Signed out, open `http://localhost:3000/?driveUrl=http://localhost:4001/d/<protected-drive>`.
2. `addRemoteDrive` → `sync.add` → `init()` 401 → the remote record is removed
   from storage. Even a later reload with a session restores nothing.

**Resulting behavior**

Console: `Error initializing channel for remote (<name>, GraphQL request
failed: 401 Unauthorized)` and the drive disappears. There is no later attempt,
no health state a UI could show ("locked — sign in"), and no hook that re-runs
`init()` when a token appears.

**Expected behavior**

- A refused or transient `init()` keeps the remote registered in a degraded
  health state (`status.pull = error`) and retries with backoff; a credential
  change (sign-in) triggers re-initialisation.
- Storage is only removed for a permanently invalid configuration (malformed
  URL, unknown channel type) — never for `http` 401/403 or `network` failures.
  `GraphQLRequestError` already carries `kind` (`network | http | graphql |
  parse | missing-data`) and `status`, so the classification is available at the
  catch site.

**Suggested fix**

```ts
} catch (error) {
  if (isPermanentConfigError(error)) { this.remotes.delete(name); await this.remoteStorage.remove(name); throw error; }
  remote.channel.markUnhealthy(error);   // keep it; surface via getStatus()
  this.scheduleReinit(name);             // backoff, and on auth-token change
}
```

**How will regressions be avoided in the future**

- Unit tests with a channel whose `init()` rejects with `GraphQLRequestError("http", 401)`:
  `startup()` keeps the remote listed with error health and re-initialises it on
  the next retry; `add()` retains the storage record and rejects without
  deleting.
- A test that a `kind: "parse"`/config error still removes the record, so the
  distinction is pinned.

---

## 4. `openRenown()` builds `returnUrl` from `pathname` + `origin` only — the query string is dropped, so `?driveUrl=…` share links do not survive login

**Package:** `@powerhousedao/reactor-browser` (consumer: `apps/connect`)

**Describe the bug**

```ts
// packages/reactor-browser/src/renown/session.ts:29-30
const returnUrl = new URL(window.location.pathname, window.location.origin);
url.searchParams.set("returnUrl", returnUrl.toJSON());
```

`window.location.search` (and `hash`) are never copied. Connect reads
`?driveUrl` exactly once, at reactor creation
(`apps/connect/src/store/reactor.ts`: `const remoteUrl = getDriveUrl(); if (remoteUrl) addRemoteDrive(remoteUrl)`),
so after the Renown round-trip lands on the bare origin there is nothing left
to add the drive. `?user=` (read by `getDidFromUrl`) is lost the same way.

**To Reproduce**

1. Signed out, open `http://localhost:3000/?driveUrl=http://localhost:4001/d/<id>`
   (the format Connect itself produces for sharing).
2. Click **Sign in** → Renown → complete login.
3. You return to `http://localhost:3000/`. The drive is not there. Paste the
   original link again (or reload with it) and it appears.

**Resulting behavior**

Silent: no error, just a URL without its parameters and a drive list without
the drive. Combined with #3 the first visit *also* wiped any record of the
drive, so the user has nothing to click.

**Expected behavior**

The user returns to the URL they left, parameters included, and the share link
completes.

**Suggested fix**

```ts
const returnUrl = new URL(window.location.href);   // keeps search + hash
url.searchParams.set("returnUrl", returnUrl.toJSON());
```

If some parameters must not round-trip through Renown, strip those explicitly
rather than dropping all of them.

**How will regressions be avoided in the future**

- Unit test: with `location.search = "?driveUrl=http%3A%2F%2Fx%2Fd%2F1"`,
  `openRenown()` opens a URL whose `returnUrl` still contains `driveUrl`.
- Connect e2e: share-link → sign-in → drive present without reload.

---

## 5. `DriveAuthRequiredModal` has no way out — no close control, no backdrop dismissal, no `onClose`

**Package:** `@powerhousedao/connect` (renders `DriveAuthGate` from
`@powerhousedao/design-system`)

**Found in:** installed `6.2.2-dev.85` dist —
`connect/dist/DriveAuthRequiredModal-Cw9eCAQ_.js` and
`design-system/dist/connect/index.js`. Not re-verified against `main` with the
same method as the four above.

**Describe the bug**

Opening a share link (`?driveUrl=…`) at a protected drive while signed out makes
Connect call `addRemoteDrive`; the 401 makes `reactor-browser` do
`showPHModal({ type: "driveAuthRequired" })`. The modal it renders has only one
interactive element — the login button:

```tsx
// packages/connect/src/components/modal/modals/DriveAuthRequiredModal.tsx
<div
  role="dialog"
  aria-modal="false"
  className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-primary/30"
>
  <DriveAuthGate mode={mode} onLogin={…} onLogout={…} className="pointer-events-auto" />
</div>
```

`DriveAuthGate` (design-system) accepts `mode`, `onLogin`, `onLogout` and
`className` — there is no `onClose` and no close button — and the backdrop is
`pointer-events-none`, so clicking it does nothing (it neither blocks nor
dismisses). The rename from `onLogin` is not an option: it calls `closePHModal()`
and then `openLogin()`, so the only way to make the card go away is to start the
Renown flow and cancel it on the Renown side.

**To Reproduce**

1. Signed out, open `http://localhost:3000/?driveUrl=http://localhost:4001/d/<protected-drive>`.
2. The "Log in to access this drive" card appears.
3. Try to dismiss it without signing in — click the dimmed area, press Escape,
   look for a close button. There is none.

**Resulting behavior**

The visitor is stuck on the card until they enter the Renown flow and cancel it,
or reload without the drive link. Connect itself is still reachable under the
`pointer-events-none` backdrop, but the card cannot be removed.

**Expected behavior**

The card is dismissible — an explicit Cancel/close control, a click on the
backdrop, or Escape — and dismissing it leaves Connect usable. Declining to sign
in should not be a dead end.

**Suggested fix**

Give `DriveAuthGate` an optional `onClose` (rendered as a top-right control when
provided) and pass it from `DriveAuthRequiredModal` as `closePHModal`. Make the
backdrop clickable to close as well, and treat Escape as a dismissal. Keep the
login button's current `closePHModal()` + `openLogin()` behaviour.

**How will regressions be avoided in the future**

- Component test: with the modal open, Escape / backdrop click / the close
  control each call `onClose` once, and `onLogin` is untouched.
- Connect e2e: open `?driveUrl=…` signed out, dismiss the card, confirm the home
  screen is interactive and no login flow started.

---

## How the five compound

```
share link ?driveUrl=…            (4) Renown returnUrl drops the query → drive never added after login
      │                           (5) and the login card that appears has no way out
      ▼
sync.add / startup → init() 401   (3) remote deleted from memory (+storage on add) → drive vanishes, no retry
      │
      ▼
live feed subscribe, no token     (2) context() throws → 4500 → client never reconnects, even after sign-in
      │
      ▼
any dispatch rejection            (1) real error replaced by "reading '#level'" → the trail goes cold
```

Fixing #4 and #3 restores the share-link and sign-out/sign-in flows; #5 lets a
visitor decline the login and keep using Connect; #2 keeps the live feed alive
across a login; #1 makes the remaining failures diagnosable.

## Local mitigations in this repo (to remove once upstream fixes land)

| # | Where | What it does |
|---|-------|--------------|
| 1 | — | Not fixable from outside `reactor-browser`. We avoid the pattern in our own code. |
| 2 | `editors/knowledge-vault/lib/live-feed-policy.ts`, `hooks/use-remote-first.ts` | `refusedForMissingToken(closeCode, hadToken)` reads a 4500-with-no-token as "sign in", sets `anonymousRefused`, and suppresses reconnects until a session exists; 4500 *with* a token stays a real error. |
| 3 | `editors/knowledge-vault/lib/boot.ts` (`recover`, `probeDriveReadable`, `RECOVERY_GRACE_MS`), `lib/remote-memory.ts`, `lib/drive-stub.ts` | Remembers adopted drives in localStorage, re-adds a remote the SyncManager dropped (same name, `SYNC_NOTHING` filter, manual polling) and shows a locked drive tile until the user signs in. |
| 4 | `lib/remote-memory.ts` (`stashDriveUrl` / `pendingDriveUrl`, 24 h TTL), `lib/boot.ts` (`startRemoteFirstBoot`) | Stashes `?driveUrl` before the Renown redirect and replays it through `addRemoteDrive` on return. |
| 5 | `lib/dismiss-drive-auth-modal.ts`, installed from `lib/boot.ts` (`startRemoteFirstBoot`) | Reads `window.ph.modal` and adds a `✕` Cancel control to Connect's `driveAuthRequired` modal, whose only call is `closePHModal()`. Dismissal is button-only on purpose: an outside-click/Escape handler also fired when the cookie banner was clicked, closing the card. No `node_modules` change; remove once upstream adds `onClose`/backdrop dismissal. |

## Appendix — verification method

1. **Installed version:** `package.json` and `node_modules/@powerhousedao/*/package.json` all `6.2.2-dev.85`.
2. **Published artefacts:** downloaded `@powerhousedao/{reactor,reactor-api,reactor-browser}@6.2.3-dev.0` tarballs from the npm registry and grepped the built `dist/` for each pattern — all four present at the same lines as in `dev.85`.
3. **Source on `main`:** fetched each file at `4f706b7` via the GitHub contents API and located the defective lines (numbers in the summary table). `dispatch.ts` on `main` has prettier split the call across lines (`.catch(\n  logger.error,\n)`), which is why a one-line grep misses it; the built bundle still contains `.catch(logger.error)`.
4. **Per-file history:** `GET /repos/powerhouse-inc/powerhouse/commits?path=<file>&since=2026-09-09T10:00Z` — only `auth.service.ts` changed (`235829f`, webhook hosting) and the throw is untouched.
5. **Releases in the window:** `v6.2.2-dev.86` `5dd5406`, `v6.2.2-dev.87` `1537bf3`, `v6.2.2-dev.88` `bceb508`, `v6.2.2` `13b2fca`, `v6.2.3-dev.0` `1bdf48a`.
6. **graphql-ws semantics** were read from the installed `graphql-ws@6.0.7` (`dist/server*.js`, `dist/use/ws.js`, `dist/client.js`, `dist/common*.js`), not from memory.
7. **Duplicate check:** GitHub issue search on the repo for `logger.error catch`, `Missing authorization in connection parameters`, `4500 websocket`, `returnUrl driveUrl`, `renown returnUrl`, `sync remote 401 startup`, `Error initializing channel` — no matching issue.
