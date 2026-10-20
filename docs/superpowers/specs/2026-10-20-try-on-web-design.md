# Try on web: a Knowledge Vault that runs in the visitor's browser

Date: 2026-10-20 · Status: design, awaiting approval · Repos: `bai-knowledge-note` (the vault package), `knowledge-vault-landing` (oskv.vetra.io)

## 1. Intent

The landing page at https://oskv.vetra.io offers "Download for Linux". We are adding **Try on web**, in the spirit of Codex's and ChatGPT's "Try on web": one click from the hero, no install, no sign-up, and the visitor is inside a real Knowledge Vault of their own.

The vault opens pre-populated with the **guide vault**: the source "How Knowledge Vault works" (the same guide the desktop app's setup wizard uses), the notes extracted from it, its maps of content and their links. The visitor explores it with the real vault interface, edits it, adds their own sources and watches them become notes.

The vault runs **entirely in the visitor's browser**. Nothing the visitor stores reaches our servers, which keeps the page's own promise ("Your data stays yours"), costs nothing per visitor, and needs no cleanup, quotas or accounts. It is the web counterpart of the desktop app: the desktop runs the engine on your computer, the web runs it in your tab.

## 2. Decisions made by the product owner

1. **Browser-local, not a vault per visitor on a server.** The visitor's vault lives in their browser's storage. No server-side vault, sync or account.
2. **No Connect shell, inside the landing site.** The playground is a page of `knowledge-vault-landing` (Next.js) at `/try`, rendering the vault app directly, the way the desktop app's host page does.
3. **Pre-populated** with the guide vault, taken from a desktop vault after its pipeline ran (see §6).
4. **File intake uses docling's WebAssembly build** (`docling.rs` wasm).
5. **Added sources become notes**: the extraction pipeline (extract claims → connect notes → place in maps → verify) runs in the browser.
6. **AI only through the visitor's own connection, exactly as today**: they connect OpenRouter (browser sign-in) or an OpenAI-compatible API key in the vault's existing connect panel. **No funded allowance.**
7. **No "Connect with ChatGPT"** in the web app. OpenAI's plan-usage programme is open to open-source and locally hosted apps only; a hosted site must apply through https://openai.com/form/sign-in-with-chatgpt-interest/, and the website integration is sign-in only, approval-gated and needs a server-side code exchange.
8. Shipping means **a new release of the vault package and of the landing site**.

## 3. Goals, non-goals, anti-goals

**Goals**
- One click from the landing hero to a working vault. First visit ready in **under ~5 s** on broadband; a return visit in **under 1 s**.
- The real vault package: Notes, Topics, Contradictions, Graph (and "over time"), Search and the Ctrl-K palette, Sources and their timeline, and the note, map and source editors — on the in-browser engine.
- Add a source (paste text, or drop a supported file) → converted → turned into notes, linked and placed in maps, with the visitor's AI.
- Ask works with the visitor's AI.
- Nothing about the visitor's vault leaves the browser, except the AI requests they make to the provider they chose.
- A **Reset** that restores the starting vault.

**Non-goals for the first version**
- Server-side storage, sync, sharing, access control, accounts.
- **Renown sign-in** (my call): with no allowance and no server, it has nothing to unlock. Revisit with "keep this vault" (copy the playground into a hosted vault or the desktop app), which is also out of this version.
- Export of the playground vault (my call).
- OCR and scanned PDFs, images, audio; structure in PDFs (docling wasm reads PDFs as flat paragraphs).
- Original files and figures of added sources (my call): there is no attachment store in the browser. Sources keep their text.
- The vault's HTTP API for agents and MCP, the workflow runtime and its starters (RSS, arXiv…), the Access settings.

**Anti-goals** — a version that technically works but fails if it:
- sends the visitor's content to our servers;
- is a separate demo that drifts from the product instead of the real vault package;
- slows down the landing site's other pages;
- asks for a login before the visitor sees anything.

## 4. What we know (verified in spikes on 2026-10-20)

**The engine runs in the landing site.** A throwaway `/try` route in the landing's production build (`next build` + `next start`, Next.js 16.3.5 / Turbopack, React 19.2.8), branch `spike/try-on-web` in the worktree `knowledge-vault-landing-try-spike`, headless Chromium, fresh profile:

| Step | Result |
|---|---|
| PGlite (IndexedDB) ready | 0.94 s |
| Engine ready (ReactorBuilder + ReactorClientBuilder, anonymous `did:key` signer) | 1.08 s |
| Graph indexer registered as a processor | 1.48 s |
| 36 documents written through the engine (drive + `drives.addFile` with final state) | 3.0 s |
| 106 links written (`addRelationshipAction` via `execute`) | 3.7 s |
| Index caught up after the last write | 3 ms |
| Whole first visit / download | 8.3 s / ~9 MB |
| Return visit (seed skipped, vault from IndexedDB) | 0.5 s |
| Landing home page | unchanged: 0.3 s, 1.85 MB (the engine loads only on `/try`) |

The index matched the desktop Switchboard exactly (32 nodes, 30 notes, 2 maps, 106 links, 75 with reasons, 1 orphan); topics, full-text search, backlinks, history, triangles and neighbourhoods answered (13 ms for all queries). The vault's **real note editor** rendered on a seeded note with the package CSS; an edit typed into it reached the engine and the index live, and survived a reload.

**What the landing build needed**
- `turbopack.resolveAlias` mapping `pg`, `pg-native` and 17 Node built-ins (`node:path`, `node:fs`, `node:crypto`, `node:url`, `node:os`, `node:fs/promises`, `node:worker_threads`, `node:util`, `node:module`, `node:child_process`, `node:buffer`, `node:stream/promises`, `node:stream`, `node:https`, `node:http`, `node:events`, `node:diagnostics_channel`) to an empty module **for the browser only**. The engine packages contain server code paths; Vite stubs them silently, Turbopack refuses them.
- `@powerhousedao/design-system` installed: the vault's editors import `@powerhousedao/design-system/connect`, which Connect normally provides.
- Its own root layout (`app/(try)/layout.tsx`): the landing already has one root layout per language (`(en)`, `(de)`, `(sl)`), so the landing's CSS stays out of the playground.
- One copy of each Powerhouse package, pinned to the package's stack (the spike used 6.2.3-dev.60 with `@powerhousedao/knowledge-note@1.0.54-dev.40`; the repo is now on dev.66). `@powerhousedao` resolves from `https://registry.vetra.io` (`.npmrc`).

**What the vault package assumes today** (it cannot run on a local drive yet; opening one shows "Could not reach the vault")
- `AuthGate` probes the Switchboard before rendering anything (`editors/knowledge-vault/components/AuthGate.tsx`).
- `useRemoteFirst` swaps Connect's client and cache for Switchboard-backed ones for every selected drive (`editors/knowledge-vault/hooks/use-remote-first.ts`, `lib/remote-first.ts`); it stands down for a declared desktop host and for Connect's remote client (`editors/shared/connect-client-mode.ts`), not for a local drive.
- Drive setup and every create/delete use hand-written core GraphQL (`editors/shared/remote-reactor.ts`: `createDocument`, `addFolder`/`moveNode`, `deleteDocument`), as do about 14 readers (`document`, `findDocuments`, `documentOperations`, `mutateDocument`) and a graphql-ws `documentChanges` socket.
- 10 of the 13 vault views, and the note, map and source editors' links/neighbourhoods, read the **knowledgeGraph** subgraph, i.e. the graph indexer's tables (`graph_nodes`, `graph_edges`, `graph_topics`, `graph_operations`, `graph_sources`, `note_embeddings`). Roughly 75–80 % of what a visitor sees.
- File intake and the extraction pipeline use the package's REST routes under `<origin>/api/@powerhousedao/knowledge-note/`; conversion uses `convert/*` and an external docling service.
- Every endpoint is derived from one place: the host declaration (`editors/shared/host-config.ts`) via `resolveSwitchboardOrigin()` (`editors/shared/subgraph-endpoint.ts`).

**What ports to the browser**
- **Graph indexer** (`processors/graph-indexer/`): Kysely over the reactor's relational DB plus `client.get`. Its factory already has a browser branch (`processorApp === "connect"`: no source rows, no automation). It ran inside Connect until 2026-04-15; codegen currently registers it for the Switchboard only (`processors/connect.ts` is empty). Node-only code is confined to `embedder.ts`.
- **knowledgeGraph resolvers** (`subgraphs/knowledge-graph/resolvers.ts`) are thin wrappers over `createGraphQuery` (`processors/graph-indexer/query.ts`); only the subgraph class (`extends BaseSubgraph` from node-only `reactor-api`) does not port. The tests already drive the resolvers with a stand-in subgraph object.
- **REST routes** (`subgraphs/http/`): handlers take a Fetch `Request` and return a `Response`; they need an in-page HTTP scope and `lib/authorize.ts` stops reading `process.env` directly.
- **Extraction pipeline core** (`pieces/knowledge-vault/lib/agent/*`): framework-free; uses `node:crypto` in four files (`ingest.ts`, `pipeline.ts`, `verify.ts`, `write.ts`), talks to the vault through the REST client (`lib/common/client.ts`: `notes`, `notes/:id/similar`, `actions`, `relationships`, `hub`, `search`, `sources`, `sources/folders`, `tasks/*`) and to an OpenAI-compatible chat endpoint (`lib/agent/llm.ts`). The workflow-framework wrappers (`lib/actions`, `lib/triggers`) stay server-side.
- **Embeddings**: model `Supabase/gte-small@q8`; the transformers.js web build runs it on onnxruntime-web, ~28 MB compressed on first use (24.3 MB model + 2.3–3.2 MB wasm). Embedding every note when a drive opened is what broke Connect in August; embedding the query, and new notes in the background, is fine. `searchSimilar` is plain cosine over stored vectors.
- **AI connection**: the chat's providers (`editors/knowledge-vault/lib/chat/provider.ts`): `openrouter` (OAuth PKCE in the browser), `custom` (OpenAI-compatible URL, key, model), `connect`, `host`.
- **docling wasm**: ~11 MB raw / ~3.4 MB gzip; Office, HTML, Markdown, EPUB and the other declarative formats with structure; PDF as flat, line-grouped paragraphs; **no chunking API** (`docs/superpowers/specs/2026-09-17-convert-subgraph-design.md`, rejected-shapes table).

**Hazards found**
- Operations replayed from history carry no resulting state; the indexer builds nodes only from live operations. **Register the indexer before writing the seed.**
- The relational PGlite in relaxed-durability mode reaches IndexedDB a moment after each write: a reload right after a write lost the index in the spike. Durable mode kept it but indexing took 12 s instead of 1 s.
- Connect's in-process engine has no cross-tab lock: two tabs can overwrite each other's store.
- Nothing asks the browser to persist storage, so it may be evicted (Safari's 7-day rule).
- The desktop guide's wording includes desktop-only claims ("computed on this computer", "a model on this computer"), and some extracted notes inherit them.

## 5. Design

### 5.1 Shape

```
oskv.vetra.io/try                     landing: Next.js route, own root layout, client-only
└── <BrowserVault/>                   from the vault package (new subpath export)
    ├── engine                        ReactorBuilder + PGlite (IndexedDB) + anonymous did:key signer
    ├── graph indexer                 registered as a processor on a relational PGlite, before any write
    ├── local origin                  the vault's HTTP surface answered inside the page:
    │   ├── /graphql/knowledgeGraph   → knowledgeGraph resolvers (graphql-js execute)
    │   ├── /api/.../knowledge-note/* → the http subgraph's route handlers
    │   └── /api/.../convert/*        → docling wasm (worker)
    ├── extraction                    pipeline core, against the local origin, with the visitor's AI
    ├── embeddings                    query + new notes in a worker; the seed ships its vectors
    └── vault app                     editors/knowledge-vault under a host declared as kind "browser"
```

The engine code lives in **the vault package**, not the landing (my call), so it is versioned with the document models and the stack it was built against; the landing mounts one component.

### 5.2 Vault package

1. **A browser host.** Extend the host contract (`editors/shared/host-config.ts`) with `kind: "browser"`. For it, every endpoint resolves to a local origin answered in the page; `AuthGate` renders without probing; `useRemoteFirst` and the package-load boot (`lib/boot.ts`) stand down, as they already do for the desktop host and for Connect's remote client.
2. **Documents through the host's reactor client.** Replace the hand-written core GraphQL (`remote-reactor.ts` creates, folders, moves, deletes; the `document` / `findDocuments` / `documentOperations` readers; drive setup in `use-drive-init.ts`) with calls on `window.ph.reactorClient`. This is also the unfinished half of the Connect remote-mode migration: it makes creates and deletes signed there too.
3. **The local origin.** My call: the browser host installs a `fetch` wrapper that answers requests to its own origin in the page and passes everything else through, so the vault's ~40 call sites stay as they are. Behind it:
   - knowledgeGraph: `graphql()` over the subgraph's type definitions and resolvers, with a context of `{ relationalDb, reactorClient, no-op read/write checks }`. Split the resolver and schema modules from the `BaseSubgraph` class so they import without `reactor-api`; supply the base types the schema's `extend type Query` expects.
   - REST: the http subgraph's handlers registered on an in-page HTTP scope; `authorize.ts` treats the browser visitor as the vault's owner (as desktop open mode does) through a parameter rather than `process.env`.
   - convert: §5.4.
   - The builder may choose explicit transport injection through the host contract instead of a `fetch` wrapper, if it proves cleaner.
4. **Live updates.** No socket: the local reactor client's `subscribe` feeds the same `vault:remote-change` bus (`editors/shared/vault-live.ts`) the socket feeds today.
5. **The graph indexer in the browser.** Register it for the browser build (codegen `--processor-apps connect switchboard`). The browser host registers it before any write. Because relaxed durability can lose the last rows on reload, **rebuild the index from the documents at startup** when it is missing or behind (0.3 s for the seed vault); the builder may choose a cheaper consistency check if rebuild time grows.
6. **Embeddings.** A browser embedder (transformers.js web build in a Worker, loaded on the first semantic search or the first extraction), embedding queries and new notes in the background. The seed ships with its notes' vectors, computed at build time with the same model. Keyword search stands in while the model loads.
7. **Extraction.** Run `pieces/knowledge-vault/lib/agent/*` in the page (in a Worker if the builder finds the main thread suffers) against the local origin, with the AI connection the chat uses (OpenRouter or OpenAI-compatible key). Replace the four `node:crypto` uses with Web Crypto. When a source is added and no AI is connected, the source is saved and queued and the visitor is asked to connect their AI; the queue runs once they do. Progress shows in the existing queue status UI.
8. **The `BrowserVault` export.** A new browser-only subpath (for example `@powerhousedao/knowledge-note/browser`) exporting a component that boots the engine, registers the indexer, seeds on first visit, fills the `window.ph` slots (reactor client, document cache, package manager with the vault package, drives, selection — what the desktop host's `host/src/reactor.ts` does), declares the browser host and renders the vault app.
9. **Seed.** The package ships the seed file (§6) and seeds through the engine on first visit. Target: under ~5 s first visit; the spike's 6.7 s of sequential writes must come down — batch the writes (`executeBatch`) or load a build-time PGlite data directory (`loadDataDir`), builder's choice. The seed must be applied after the indexer is registered.
10. **One tab, persistent storage, reset.** Take a Web Lock for the vault; a second tab shows "This vault is open in another tab" with a button to move it here. Call `navigator.storage.persist()` once the vault is created. **Reset** deletes the browser vault's databases and seeds again.

### 5.3 Landing site

- Route group `app/(try)/try/` with its own root layout; the page renders `BrowserVault` through `next/dynamic` with `ssr: false` (client only).
- `next.config.ts`: the browser-only `turbopack.resolveAlias` list from §4.
- Dependencies: the vault package and the Powerhouse packages it peers on, `@powerhousedao/design-system`, pinned to one stack version; `.npmrc` for the `@powerhousedao` scope, available to the Docker build (`npm ci`).
- If docling wasm or onnxruntime-web need threads (`SharedArrayBuffer`), send `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` **on `/try` only**.
- The **Try on web** button sits in the hero call-to-action row next to Download (`components/landing/Landing.tsx:282-290`), with strings in `lib/i18n/{en,de,sl}.ts`. It links to `/try` from every language; the playground itself is in English (my call; the vault app is English).
- A first-visit loading screen ("Setting up your vault in this browser — nothing leaves your device"), and a slim banner in the playground: "This vault lives only in this browser", **Reset**, **Download the desktop app**.
- Deployment: the existing pipeline (`.github/workflows/build-and-push.yml` → `cr.vetra.io/bai/oskv` → ArgoCD). The vault package release goes out first.

### 5.4 Adding sources

- Paste text, or drop/pick a file in the formats docling wasm supports. docling wasm runs in a Worker behind the local origin's `convert/*`, answering the existing contract (`{ markdown, chunks: [{ text, headings }] }`, plus health with `configured`, `formats`, `maxUploadBytes`). Chunks are derived from the Markdown headings, since the wasm build has no chunking API. `browserDeps` in `intake-store.ts` (a module constant today) becomes selectable for the browser host.
- PDFs come out as flat paragraphs. Scanned PDFs, images and audio are refused with a short message pointing to the desktop app, which reads them.

## 6. Seed content

- A **web wording** of the guide "How Knowledge Vault works" (desktop copy: `knowledge-vault-app/sidecar/src/sample-source.ts`, 4.8 KB): the desktop-only claims rewritten for the browser (data stays in this browser; the AI is the one you connect).
- Run the desktop pipeline once on it, review the resulting notes and maps for leftover desktop-only claims, then export the vault with the read-only export script used in the spike (drive, documents with state and operations, relationships). The current desktop export, from the unchanged guide: 36 documents (the source, 30 notes, 2 maps, config, queue, health report), 494 operations, 106 links (30 `DERIVED_FROM`, 28 `RELATES_TO`, 17 `BUILDS_ON`, 30 `CORE_IDEA`, 1 `CHILD_MOC`), 440 KB.
- Add the notes' embedding vectors at build time.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Stack upgrades add new server-only imports and break the landing's Turbopack build | The alias list lives in one place; a CI build of `/try` catches it; fallback: the package ships the playground as a prebuilt static bundle the landing serves at `/try` |
| Version skew between the landing and the vault package | Pin both to the package's stack; one copy of each Powerhouse package (checked in CI) |
| First-visit time | Batched seed or a prebuilt data directory; loading screen with progress |
| Lost index rows after a quick reload | Rebuild at startup (§5.2.5) |
| Two tabs | Web Lock (§5.2.10) |
| Storage eviction | `navigator.storage.persist()`; the vault is a playground, Reset restores it |
| Visitor's AI costs | Their own account and choice; the pipeline shows what it is doing |
| The OpenRouter sign-in redirect returns to `/try` mid-session | The chat's existing PKCE flow; the builder verifies it restores the playground state |

## 8. Left to the builder

- Wrapping `fetch` versus explicit transport injection (§5.2.3).
- Batched writes versus a build-time data directory for the seed (§5.2.9).
- Main thread versus Worker for extraction; the embedder and docling wasm run in Workers.
- Index rebuild versus a cheaper consistency check at startup.
- Where the playground opens (the guide source, the hub map or the default view), loading-screen and banner design within the landing's style.
- Test strategy; the spike harnesses (headless Chromium driving `next start`) are a starting point.

## 9. Suggested order

1. Documents through the host's reactor client (§5.2.2): useful on its own for Connect's remote mode.
2. Browser host, local origin with knowledgeGraph and REST, graph indexer in the browser, live updates (§5.2.1, 3–5).
3. `BrowserVault` export, seed, one tab, persistence, Reset (§5.2.8–10, §6).
4. Landing route, aliases, button, deployment (§5.3).
5. Adding sources with docling wasm (§5.4).
6. Extraction in the browser (§5.2.7).
7. Browser embeddings and seed vectors (§5.2.6).
