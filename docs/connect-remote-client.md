# Running the vault on Connect's remote client

Since Powerhouse 6.2.3-dev.62, Connect can run as a pure client of one
Switchboard (`connect.instance.reactorClient: "remote"`). No reactor and no
PGlite run in the browser: Connect's `window.ph.reactorClient` is a router
whose one backend is the Switchboard's GraphQL API, with Connect's own document
cache, drive list and live updates over it.

That is what this package's remote-first layer used to build by hand inside a
normal Connect (stop the local replica, swap the client and cache, rebuild the
drive list). When Connect runs its remote client the layer stands down
(`editors/shared/connect-client-mode.ts`), and the vault's own requests —
the knowledge-graph subgraph, the REST routes, the live feed — go to the
Switchboard Connect was configured with instead of one guessed from the
hostname.

## Turning it on

Connect reads the mode from its runtime config, `powerhouse.config.json`, and
the Switchboard from the first default drive's URL (`…/d/<slug>` → `…/graphql`):

```json
{
  "connect": {
    "instance": { "namespace": null, "reactorWorker": false, "multiReactor": false, "reactorClient": "remote" },
    "drives": { "defaultDrives": [{ "url": "https://switchboard.example.io/d/<vault-slug>" }] }
  }
}
```

- **The config schema does not know the key yet** (6.2.3-dev.66): `ph connect
  config` and `ph connect build --json` reject `instance.reactorClient`. Edit
  the served `powerhouse.config.json` (in the build output) by hand, or pass it
  to the Docker image through `PH_CONNECT_CONFIG_JSON`, which is merged without
  a schema check.
- **For a quick look** on any Connect: add `?reactorClient=remote` to the URL.
  It is not kept: a reload without it goes back to the configured mode.
- The default drive must be on the Switchboard that serves the vault. Connect
  then lists every drive on that Switchboard the user may read.

## What changes for users

Measured on 2026-10-20 against a 1,002-note, 1,044-source vault (Liberuum),
Connect 6.2.3-dev.66 production builds, a fresh browser each run:

| | Old layer (default Connect) | Remote client |
|---|---|---|
| Home tile appears | 51.6 s | 1.5 s |
| Loaded before the vault shows | 12.9 MB | 6.6 MB |
| Reload a vault page, open a vault link | "Drive … not found" | works |
| Edit from the note editor reaches the server | 0.9 s | 0.9 s |
| Another client's edit shows in an open note | 0.2 s | 0.2 s |
| Server-side sync remote per browser session | one each (a queue of the whole vault's operations) | none |
| Switchboard after a restart, once the browser reconnects | busy rebuilding those queues: a request timed out after 20 s | answers at once |

The regression suite (29 checks: places, editors, writes on each path, live
updates, reload, links) passes in full on the remote client.

- `?driveUrl=` share links are ignored, and adding drives from another
  Switchboard is not available: the remote client has one backend.

## Known gaps of the remote client (6.2.3-dev.66)

- **Starting while the Switchboard is down** shows Connect's error screen
  ("… switchboard-remote: Failed to fetch") and does not recover on its own:
  reload once the Switchboard is back. Connect builds its drive list at boot
  and has no retry there; the vault package loads too late to change it.
- **Live updates after a long outage.** Connect's own socket gives up after
  five reconnect attempts. The vault keeps one subscription on Connect's client
  and renews it (every 30 s, and when its own feed reconnects), which reopens
  that socket, and re-reads the open document after a reconnect. Measured: back
  in 0.3 s after a 15 s outage, in about a minute after a 75 s one, no reload.
- No request timeouts or retries in Connect's GraphQL client; nothing works
  offline.

## Still on the old layer

A Connect without the remote client (in-process, worker or router mode) keeps
the remote-first layer unchanged, as does the desktop app (its host declares
its own Switchboard client). On Connect 6.2.3-dev.62 and later that path cannot
reload a vault page or open a vault link, so deployments should switch.
