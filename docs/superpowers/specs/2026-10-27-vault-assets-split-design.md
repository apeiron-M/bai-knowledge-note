# Splitting the embedding runtime out of the vault package

Date: 2026-10-27 · Status: approved by Liberuum on 2026-10-27 ("let's go and do this fix")

## Why

Two problems, one cause.

1. **The cloud vault has had no semantic search since about 2026-10-07.** On
   `switchboard.knowledge-vault.vetra.io` (same server as
   `light-colt-c497cfbd-switchboard.vetra.io`; stack 6.2.3-dev.73, vault
   package 1.0.54-dev.46, checked 2026-10-27) a sentence query returns `[]`,
   short terms come back `matchedBy: ["keyword"]`, and 29 notes have no
   embedding. The Switchboard imports the package from its registry cache
   (`file://`), and the embedder looks for the model next to itself and for
   `@huggingface/transformers` in `node_modules`. The cache has neither. The
   embedder's registry-CDN branch only runs when the module was imported over
   `http(s)`, so it never runs there either.
2. **Publishing the vault package is slow and fails.** The dev.46 tarball is
   44.6 MB. Uploads to registry.vetra.io run at about 0.2 MB/s, and the token
   `ph publish` mints lives 5 minutes. dev.46 failed twice (expired token,
   then a network timeout) before it got through with a hand-made 2-hour
   token and a 30-minute fetch timeout.

About two thirds of that tarball is runtime that never changes between vault
releases: the embedding model, the ONNX runtime, and the transformers web
bundle.

## What was verified before writing this (2026-10-27)

| Check | Result |
|---|---|
| Size of the dev.46 tarball, by kind of file (compressed) | model 24.6 MB · source maps 6.3 · ORT wasm (node) 5.6 · other wasm (docling) 5.0 · other 4.1 · transformers bundle 0.2. Without the model, the ORT wasm and the transformers bundle: about **15.5 MB** |
| Registry CDN download speed | model (34 MB) in 1.6 s, ORT wasm (23 MB) in 3.4 s; `cache-control: public, max-age=31536000, immutable` |
| The existing CDN loader in node | dev.46's cached embedder, with `EMBEDDER_CDN_BASE` set to dev.46's CDN `node/` folder, loaded the model from the registry and returned a 384-dimension embedding in 14.6 s (node 26, first load including downloads) |
| CDN for a package that is not a reactor package | `@powerhousedao/config@6.2.3` is served: `index.js` and `dist/index.js` both return 200 |
| How the Switchboard learns its registry | it reads `PH_REGISTRY_URL` (and `PH_REGISTRY_PACKAGES`) |
| Where consumers install `@powerhousedao/*` from | desktop app (`bunfig.toml`) and landing (`.npmrc`): registry.vetra.io. **This repo: npmjs**, because `.npmrc` only maps `@jsr` |
| Who embeds | Switchboard processor and query embedder (server); desktop sidecar (offline, native onnxruntime via installed `@huggingface/transformers`). The browser vault never embeds: `browser/engine.ts` builds the indexer without `embed` |

## Goals

- Semantic search works on the cloud, and new notes get embeddings there.
- A vault release publishes about 15.5 MB instead of 44.6 MB.
- Nothing that works today stops working:
  - local `ph vetra` keeps semantic search;
  - the desktop app still embeds offline;
  - the Try page (https://oskv.vetra.io/try) is unchanged.

## Non-goals

- The docling converter and its wasm stay in the vault package (decided by Liberuum).
- Dropping source maps from the tarball (6.3 MB; a separate, later change).
- Changing the model (`Supabase/gte-small`, q8, 384 dimensions) or the transformers/ORT versions.
- Telling the user when search falls back to keyword (decided by Liberuum: not wanted).

## Anti-goals (failure even if it "works")

- Runtime dependence on Hugging Face. Every model download comes from our registry, or from disk.
- A vault package that only works if the Switchboard installs `node_modules`. The cloud never does.
- Anything new in `dist/powerhouse.manifest.json` `externalDependencies`, or any import of the assets
  package from vault JS. Per CLAUDE.md, the registry loader refuses the subgraphs and processors of a
  package with externals it hasn't installed.
- Touching `browser/`, the landing, or how Connect/desktop convert files.
- Bun-only APIs in anything under `dist/`.

## Decided by Liberuum

- Split the heavy runtime into its own package (one repo, not a new one).
- Docling stays in the vault package; the Try page is not touched.
- No fallback warning in the vault.
- Order of work: publish the assets package, then test the vault package that uses it on the deployed
  Vetra environment.

## Design (my calls unless marked above)

### 1. The assets package: `@powerhousedao/knowledge-vault-assets`

Lives in this repo at `packages/knowledge-vault-assets/`. Version `1.0.0`. No JS that anyone imports,
no dependencies, `files: ["/dist"]`.

```
packages/knowledge-vault-assets/
  package.json
  models/Supabase/gte-small/…            ← moved here with `git mv` from the repo-root models/
  scripts/build.mjs                       ← assembles dist/
  dist/                                   ← built, git-ignored, what gets published
    models/Supabase/gte-small/…          (config, tokenizer files, onnx/model_quantized.onnx)
    wasm/ort-wasm-simd-threaded.asyncify.mjs
    wasm/ort-wasm-simd-threaded.asyncify.wasm
    transformers.web.bundle.mjs           (self-contained, no bare imports; built with rolldown)
    assets.json                           (model id, dtype, transformers + onnxruntime-web versions it was built from)
```

`dist/` has **exactly the layout `dist/node/` has today**, so the CDN base
`<registry>/-/cdn/@powerhousedao/knowledge-vault-assets@1.0.0/` works with
the existing `loadFromCdn(base)` unchanged.

`scripts/build.mjs` takes over steps 1, 2 and 4 of today's
`scripts/copy-runtime-assets.mjs`: the model copy, the ORT helpers, and the
rolldown transformers bundle. It runs from the repo root and uses the root
`node_modules` (`@huggingface/transformers`, `onnxruntime-web`, `rolldown`),
so the runtime versions stay pinned by this repo's `bun.lock`. It fails
loudly on any missing input, as the current script does.

**Publishing it:** rare, done by Liberuum with the long-token /
long-fetch-timeout npm command that worked for dev.46. That means a 2-hour
`ph access-token --audience https://registry.vetra.io` in a temporary
`--userconfig`, plus `--fetch-timeout=1800000`. It's about 30 MB packed.
`ph publish` is not required; this is not a reactor package.

### 2. The vault package

- `package.json`:
  - `peerDependencies["@powerhousedao/knowledge-vault-assets"] = "1.0.0"`, marked optional in
    `peerDependenciesMeta`.
  - `@huggingface/transformers` stays a dependency: the desktop's native path needs it.
- **Why an optional peer and not a dependency (my call):**
  - The cloud never installs it, and the landing doesn't need it.
  - This repo resolves `@powerhousedao/*` from npmjs, where the assets package won't exist. A
    regular dependency would break `bun install` here, or force mapping the whole scope to
    registry.vetra.io, which changes every `@powerhousedao` URL in `bun.lock` and puts `ph use dev`
    behind the registry's mirror.
  - Only the desktop app needs it installed, and it lists it explicitly (§5).
- `scripts/copy-runtime-assets.mjs` drops the model, ORT wasm and transformers-bundle steps. It
  keeps:
  - the browser ORT strip (step 3);
  - the pipeline templates.
- A guard (in `check-server-build.mjs` or the copy script) fails the build if any of these
  reappear in `dist/node`:
  - `models/`
  - `wasm/ort-*`
  - `transformers.web.bundle.mjs`

  Then they can't creep back and re-inflate the tarball.
- One constant names the assets package and version, e.g. `processors/graph-indexer/assets.ts`
  with `ASSETS_PACKAGE` and `ASSETS_VERSION`. A unit test asserts it equals the peer pin in
  `package.json`.

### 3. How the embedder finds the runtime (`processors/graph-indexer/embedder.ts`)

`getExtractor()` tries these in order, and stops at the first that loads:

1. **`EMBEDDER_CDN_BASE` is set:** CDN at that base. Unchanged; kept for tests and emergencies.
2. **The module was imported over `http(s)`:** CDN of the assets package. The registry origin
   comes from the module URL (the part before `/-/cdn/`).
3. **The module is on disk (`file://`), and a copy of the model is on disk.** Two places to look:
   - findUp `node_modules/@powerhousedao/knowledge-vault-assets/dist/models`, for an installed copy
     (the desktop);
   - the repo folder `packages/knowledge-vault-assets/models`, when running from this repo
     (`ph vetra`, tests).

   With a model found, it tries `loadNative(modelPath)`, then `loadWasm(moduleDir, modelPath)`.
   `loadWasm` also accepts the assets package's `dist/wasm` as an ORT location. This is today's
   logic with new paths.
4. **Nothing loaded yet:** CDN of the assets package,
   `<registry>/-/cdn/@powerhousedao/knowledge-vault-assets@${ASSETS_VERSION}/`. The registries are
   tried in order, each once:
   - the one the module was served from;
   - `PH_REGISTRY_URL`;
   - `packageRegistryUrl` in the working directory's `powerhouse.config.json`;
   - `https://registry.vetra.io`.

   The Switchboard resolves its own registry from a constructor option, then the env var, then that
   config file. The embedder can see only the last two, so it tries them all, and the public
   registry, where the assets are published, comes last.
   This is the cloud's case: a registry cache on `file://`, with no model and no `node_modules`.
5. **Everything failed:** throw, as today. The query embedder's back-off and the keyword fallback
   are unchanged.

`loadNative` must no longer fall through to the Hugging Face hub when no
model path was found: with no local model, the native path is skipped. Fix
any trailing slash on `PH_REGISTRY_URL`.

### 4. Local development (this repo)

- `models/` moves to `packages/knowledge-vault-assets/models/`. `scripts/fetch-model.mjs` points
  at the new place.
- `ph vetra` runs the package from this repo's `dist/`. Step 3 finds the repo folder and loads
  natively from the root `node_modules`, so semantic search stays offline, as today.
- `bun install` is unchanged, because the optional peer is not installed. Confirm this; if bun
  does install it, revisit §2.

### 5. Desktop app (`knowledge-vault-app`), when it next moves to a vault version with this change

- `sidecar/package.json` adds `@powerhousedao/knowledge-vault-assets` at the version the vault's
  peer pin names. Its `bunfig.toml` already maps the scope to registry.vetra.io.
- The desktop embeds on the **wasm** path: `prune.mjs` drops `onnxruntime-node`, so `loadNative`
  throws, and `loadWasm` runs on the installed `transformers.web.js` and `onnxruntime-web/dist`, with
  the model from the assets package. Expect the "wasm onnxruntime" log line.
- `scripts/lib/prune.mjs` drops the assets package's `dist/wasm` and `transformers.web.bundle.mjs`,
  which the desktop never loads because it uses the installed onnxruntime. It keeps `dist/models`.
  This replaces today's `alsoDrop` of `@powerhousedao/knowledge-note/dist/node/wasm`.
- **Mandatory** (not optional): a check fails the desktop build when the assets pin doesn't match the
  vault's peer pin, or the assets package is missing. Without it, a desktop would quietly download
  the model from the registry on first use, and offline it would fall to keyword search.
- The pending desktop 0.2.5 on dev.46 is not affected.

### 6. Landing / Try page

No change. It imports only the browser build, which never embeds, and the
optional peer is not installed there. When the landing next bumps its vault
pin, the Try page gets the normal smoke test.

## Rollout

0. **Optional, today, no code:** set `EMBEDDER_CDN_BASE=https://registry.vetra.io/-/cdn/@powerhousedao/knowledge-note@1.0.54-dev.46/node/`
   on the cloud Switchboard and restart it. This is the path verified above, so the cloud gets
   semantic search on dev.46. Remove it at step 4.
1. Build `packages/knowledge-vault-assets`, then check the result:
   - `dist/` has the layout above;
   - with `EMBEDDER_CDN_BASE` pointed at a local static server over that `dist/`, the dev.46
     embedder produces a 384-dimension vector.

   **Liberuum publishes 1.0.0.** Then:
   - `curl -I` the model on the assets CDN: expect 200 and 34,014,426 bytes;
   - re-run the embed probe against the real CDN base.
2. Change the vault package (§2–4). Then:
   - run `bun run tsc`, `lint:fix`, `test`, `test:coverage` (≥ 95%), and `build`;
   - `check-server-build` passes;
   - the packed tarball is about 15.5 MB;
   - the embedder from `dist/node`, copied to a temp directory outside the repo (no
     `node_modules`, no `models` above it), embeds through step 4. This reproduces the cloud's
     situation.
3. Liberuum publishes the vault package (next dev version).
4. Liberuum switches the cloud environment (Connect and Switchboard) to it, and removes
   `EMBEDDER_CDN_BASE` if it was set.
5. Check on the cloud:
   - a sentence query returns results with `matchedBy` containing `"semantic"`;
   - `knowledgeGraphMissingEmbeddings` reaches `[]`. The processor backfills missing embeddings at
     boot (docs/ARCHITECTURE.md); run a `knowledgeGraphReindex` only if it doesn't, and **ask before
     running it on the shared drive.**
6. Locally: `ph vetra`, then search in my-personal-vault answers semantically with 0 missing.

## Success checks

- **Cloud:** a sentence query returns results matched semantically; new notes get embeddings; 0
  missing after the reindex.
- **Local `ph vetra`:** semantic, 0 missing.
- **Desktop:** embeds offline, verified when it moves to the new vault version.
- **Try page:** unchanged.
- **Size:** a vault publish is about 15.5 MB.

## Left to the builder

- Script names, and whether `copy-runtime-assets.mjs` is renamed.
- Exact findUp candidate lists.
- Where the guard lives.
- Test layout.
- How the assets build is wired into root scripts (e.g. a `bun run assets:build`).
- The exact `.gitignore` entry.

## Risks

- **First load after a Switchboard restart.** It downloads about 58 MB and compiles wasm: about
  15 s measured locally. A search during that window waits on the shared load promise, and a
  gateway timeout is possible. This is acceptable; there is no warm-up in scope.
- **The cloud's node version is unknown.** The CDN loader imports via `data:` URL and was measured
  on node 26. Confirm on the deployed Switchboard at step 5; step 0 confirms it early.
- **The CDN rule for non-reactor packages** was verified on `@powerhousedao/config`, and is
  confirmed for the real package at step 1, before the vault depends on it.

## Calls made after the builder check

- **The registry:** step 4 tries several sources rather than trusting `PH_REGISTRY_URL` alone (§3).
- **Desktop:** in scope now, per Liberuum's go-ahead. The version check is mandatory (§5), and the
  desktop is verified on the wasm path.
- **Other installs** that have `node_modules` (`ph install`, the Dockerfile, `PH_PACKAGES`):
  - they reach step 4 and fetch the model from the registry they installed from;
  - offline self-hosting is not a goal.
- **The stale symlink** `processors/graph-indexer/models`, which pointed at `/home/p/…`, is
  removed with the move.
