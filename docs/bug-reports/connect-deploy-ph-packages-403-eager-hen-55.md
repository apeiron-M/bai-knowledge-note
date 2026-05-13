# Connect deployment on `eager-hen-55` serves `ph-packages.json` as 403, blocking app bootstrap

**Affected deployment:** `https://connect.eager-hen-55.vetra.io`
**Reactor:** dev.245 (matches our local; doesn't appear to be a version issue)
**Symptom:** Connect frontend crashes at boot. Drive contents are intact server-side; the user cannot reach them through Connect at all.

---

## Summary

On every page load the Connect app at `connect.eager-hen-55.vetra.io` fetches `/ph-packages.json` to determine which document-model packages are installed in this environment. The deployment's nginx returns **HTTP 403** for that one specific path while returning **200** for the rest of the site (including non-existent paths via the SPA `try_files` fallback). Because the response body is an nginx HTML error page rather than the expected JSON, the React tree that consumes the manifest throws a `SyntaxError: Unexpected token '<', "<html>` and Suspense's `Lazy` initializer dies with no recovery.

End-user effect: the entire app fails to render — no sidebar, no drives, no editors — on a freshly-loaded session. A user reaches `https://connect.eager-hen-55.vetra.io/` and sees the Connect chrome briefly before the React tree throws.

This appears to be a deployment configuration / file permissions issue, **not** a Connect code defect: with one-character path changes the same nginx serves correctly. Filing it here so whoever owns the eager-hen-55 deploy can fix it (and so the same misconfiguration can be checked on sibling deployments).

## Repro

1. Open Connect in a clean browser session: <https://connect.eager-hen-55.vetra.io/>.
2. Observe in DevTools → Network: `GET /ph-packages.json → 403 Forbidden`, `content-type: text/html`.
3. Observe in DevTools → Console:
   ```
   GET https://connect.eager-hen-55.vetra.io/ph-packages.json 403 (Forbidden)
   SyntaxError: Unexpected token '<', "<html>\n<h"... is not valid JSON
   [Connect] {} {"componentStack":"\n    at Lazy (<anonymous>)\n    at Suspense ..."}
   ```
4. The React tree under `<La>` / `<wo>` / `<Ss>` (in `index-CN7hNMFj.js`) unmounts. No fallback UI is rendered.

## Why this is a deploy/nginx issue (not a code issue)

Direct comparison of paths on the same host shows the misbehavior is scoped to a single file:

| Path | Response | Notes |
|---|---|---|
| `GET /` | **200** `text/html` | Static `index.html`, OK |
| `GET /assets/index-CN7hNMFj.js` | **200** `application/javascript` | Hashed bundle, OK |
| `GET /ph-packages.json` | **403** `text/html` | nginx error page |
| `GET /packages.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /manifest.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /api/ph-packages.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /.well-known/ph-packages.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /ph-config.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /ph-manifest.json` | **200** `text/html` | SPA fallback serves `index.html` |
| `GET /ph-something.json` | **200** `text/html` | SPA fallback serves `index.html` |

If `ph-packages.json` were simply missing from the deploy artifact, nginx's SPA `try_files` would catch it and return the index.html with a 200 (the same way `/ph-config.json` does). The fact that we get **403 specifically for `/ph-packages.json`** means the file **exists on disk** but nginx **cannot read it**.

Response headers for the failing request confirm nginx is the one rejecting (not an upstream):

```
HTTP/2 403
content-type: text/html
date: Wed, 13 May 2026 13:22:36 GMT
server: nginx/1.29.8
vary: Accept-Encoding
content-length: 153
```

The 153-byte body is the canonical nginx default 403 page (`<html><head><title>403 Forbidden</title>...`).

## Most likely root cause

The vetra deployment pipeline writes `ph-packages.json` into the static-site root at deploy time, but the file ends up with permissions that the nginx worker process cannot read — e.g. mode `0600` instead of `0644`, or owned by a user/group nginx isn't in. With unreadable contents, nginx returns 403 rather than falling through to the SPA's `try_files /index.html` rule.

Less likely (but worth checking): a specific `location = /ph-packages.json { deny all; }` rule in the nginx config, or a parent directory with the wrong execute bit (`o+x` not set).

## Suggested fixes (deployment side)

1. **Check the file permissions on the deploy host:**
   ```bash
   stat /var/www/connect.eager-hen-55/ph-packages.json
   # Expected: -rw-r--r-- root www-data (or whatever owns the rest of /var/www)
   ```
2. **If perms are wrong, fix in the build/deploy step:**
   ```bash
   chmod 0644 ph-packages.json
   ```
   And update the deploy script that writes the file so it sets the right mode.
3. **Add a CI check** that issues `curl -fsS https://<host>/ph-packages.json | jq .` against every new deploy. Today this would catch the regression on day zero.
4. **If `ph-packages.json` is supposed to be missing on this deploy** (because no packages are installed), have the deploy publish an empty `{}` instead — the SPA already tolerates an empty config but cannot tolerate an HTML 403.

## Connect-side defensive recommendation (separate code change)

The crash blast radius is much larger than it has to be. The Lazy/Suspense component at `index-CN7hNMFj.js:36:35115` (`<La>`) doesn't have an error boundary that knows how to handle "manifest fetch failed." It would be safer to:

1. Catch fetch failures from `getPackagesConfig()` (in `packages.config-CiH8KJVN.js`) and treat them as "no packages registered" rather than re-throwing.
2. Render a `<DeployMisconfiguredBanner />` (or similar) instead of unmounting the whole app, with the underlying status code and URL surfaced. A 403 in particular is recoverable from the user's side only if they know what's failing.

That would turn this from a complete outage into a degraded mode where at least the drive shell is reachable.

## Environment

- Connect bundle: `/assets/index-CN7hNMFj.js` (deployed 2026-05-13 ~12:30 UTC)
- nginx version: `1.29.8` (per `Server` header)
- Reactor/Switchboard on this same host: dev.245 (the switchboard at `https://switchboard.eager-hen-55.vetra.io/graphql` works fine — only the Connect frontend is broken)
- Browser: Chromium-based, clean session, IndexedDB cleared

## What's NOT the cause (already ruled out)

- ✗ Not a CORS or origin issue — the request is same-origin.
- ✗ Not a code defect in the Connect bundle — the bundle is identical to working deployments; just a missing/unreadable asset.
- ✗ Not a missing file — if it were missing, the SPA fallback would have returned 200/index.html (verified with siblings paths above).
- ✗ Not a Switchboard / reactor issue — `/graphql` and `/graphql/r` on the sibling switchboard host work fine.
- ✗ Not a dev.X version drift — local `ph vetra` on dev.245 boots fine; the same Connect bundle code works against localhost.
