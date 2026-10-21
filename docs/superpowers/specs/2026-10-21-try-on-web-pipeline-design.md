# Try on web: sources become notes in the browser — design

Date: 2026-10-21 · Repos: `bai-knowledge-note` (the vault package, `browser/`, `pieces/`, `editors/`) and
`knowledge-vault-landing` (`/try`, which installs the package). Follows `2026-10-20-try-on-web-design.md`.

## Why

The browser vault at oskv.vetra.io/try opens on a finished guide (30 notes, 2 maps, 1 source), but the
product's core promise does not work there: a source the visitor adds is queued and never processed. On
the desktop, the workflow engine inside the app's local Switchboard runs the pipeline; the browser has no
such engine. A visitor who connects their own AI should watch their source become notes, step by step,
within about a minute — that is the moment they "get" Knowledge Vault. The guide itself should also look
made for them: today it is dated 2026-10-20, the day it was built, and its health check is empty.

## Goals

1. **A new source is processed by the visitor's AI.** A source added in the browser (paste or file) is
   picked up within 30 s and taken through the queue's four phases — create (extract notes), reflect
   (link them), reweave (place them in a map), verify — by the AI the visitor connected in the chat
   (OpenRouter or a local AI). *(user)*
2. **Progress is visible as it happens.** The Processing queue shows the task moving through the phases
   with a handoff line per phase; the source shows its status; the timeline shows the source as waiting,
   then processed. *(user)*
3. **The guide is dated to the visit.** Every date in the guide — documents' creation, the source's
   ingest and extraction, the queue task and its four steps, notes' provenance and lifecycle — reads as
   the minutes just before the vault was opened. *(user)*
4. **The queue shows the guide's job as done** (four steps, today), then real jobs live. *(user)*
5. **The health check is filled in** after the guide is written and after every processed source. *(user)*

## Non-goals

- Desktop quality. The browser has no embeddings: no duplicate check against existing notes, no search
  by meaning. Notes link within their own source (plus whatever keyword matching finds; see latitude).
- Processing while /try is closed. The pipeline runs only in an open tab and resumes on the next visit.
- The desktop's other workflows (the 5-minute reweave), integrations, MCP.
- Any change to how the desktop app or a Switchboard processes sources.

## Anti-goals (would be failure even if it "works")

- Spending the visitor's credits unexpectedly: nothing runs without a connected AI; one task at a time;
  the text sent per source is capped; no retry loops beyond the existing one retry per model call.
- A silent stall: every waiting or failed state says why, in plain words, and what to do.
- Breaking the desktop: shared pipeline code must keep working in the Node workflow runtime.
- A guide whose links break: every reference must follow a document's new id.

## Constraints

- The browser vault is reached only through `loadBrowserVault()` / `#browser-vault`; `editors/`,
  `subgraphs/`, `processors/`, `document-models/` and `index.ts` must never import `browser/*`.
  `scripts/check-server-build.mjs` must keep passing (no WebAssembly or browser code in the server build).
- The landing's browser bundle maps `node:*` to an empty module, so code the browser runs must not use
  `node:crypto` and friends.
- Every write in the browser vault flushes PGlite's files to IndexedDB (~1 MB per flush, see
  `browser/engine.ts` FlushGate). A run makes dozens of writes.
- A local AI must allow the page's origin (Ollama `OLLAMA_ORIGINS`, LM Studio's CORS toggle).
  OpenRouter allows any origin.

## Design (decided)

### 1. The guide, dated to the visit — `browser/seed.ts`

Verified facts: the seed stores 168 full ISO-8601 timestamps in 17 known fields (the documents'
`created.createdAtUtcIso`, and in states: note `provenance.createdAt/updatedAt`, `updatedAt`,
`lifecycleEvents[].timestamp`; map `createdAt/updatedAt`; source `createdAt`,
`extractionStats.extractedAt`; queue `lastProcessedAt`, task `createdAt/updatedAt`,
`handoffs[].completedAt`). No dates appear inside note text. They span 16:06:38 → 16:12:45 on
2026-10-20. Document ids are content-addressed: `deriveDocumentId({documentType, createdAtUtcIso,
nonce, protocolVersions})` from `@powerhousedao/shared/document-model`, which reproduces all 36 seed ids.

On a first visit, before the guide is written:

- `shift = visit time − latest seed timestamp`, applied to every whole-string ISO timestamp in the seed
  (created params and states). The guide's processing ends "just now"; its source was added ~6 minutes
  before. Nothing lands in the future. *(my call: anchor the end, not the start)*
- Each document gets the id derived from its shifted creation time. Every occurrence of every old id in
  the seed (states, relationships, drive file nodes) is replaced by the new one before jobs are built.
  Folder ids are not document ids and stay.
- Operation timestamps are already the visit time (operations are signed when the guide is written).
- `BootedVault` exposes the map from the seed's ids to this vault's ids, for the guided tour to find a
  given guide note or map. *(my call)*

### 2. The pipeline runner — `browser/pipeline/` (started by `browser/boot.ts`)

- **Pickup.** The runner looks for work when the vault changes (the existing live feed) and every 10 s.
  Work is a `claim` task that is PENDING at `create`, or one this vault left IN_PROGRESS when the tab
  closed (resumed from its current phase). One task at a time. *(user: within 30 s; cadence my call)*
- **The AI.** The chat's active connection and model (`editors/knowledge-vault/lib/chat/provider.ts`:
  `activeProvider`, `endpointFor`): the same OpenRouter key or local endpoint the visitor connected in
  Ask. Calls go through the pipeline's `completeJson` with a `fetchImpl` that sends that endpoint's
  headers (OpenRouter's `HTTP-Referer`/`X-Title` only to OpenRouter). *(my call)*
- **No AI connected.** The task waits; the source and the queue say so and point to Ask (see §4), and the
  add panels say in one line that a connected AI turns sources into notes. Adding is never blocked. When
  a connection appears, waiting tasks start within 30 s. *(my call)*
- **AI unreachable** (local server down, CORS not allowed, offline — the browser's "Failed to fetch"):
  the task does not fail; it waits like "no AI", the status says "Can't reach your AI — check it is
  running and allows this page", and the runner tries again every 30 s. Queued tasks are not burned
  through one after another. *(my call)*
- **The phases**, reusing the desktop's steps from `pieces/knowledge-vault/lib/agent/` against the
  in-page REST routes (`KnowledgeVaultClient` at the page's local origin, with a bound `fetch`):
  1. *create* — `readSourceStage` (text capped to one window: 24k characters for a hosted model, 8k for
     a local one), `candidatesStage`, `draftStage`, `writeStage` (notes, `DERIVED_FROM` links, the
     source's extracted claims and stats, status EXTRACTED). `checkVaultStage` stays: it makes no model
     call, and without search by meaning it simply finds no existing note to merge with.
  2. *reflect* — `gatherCandidates` + `proposeLinksStage` + `writeLinksStage` among the source's notes.
  3. *reweave* — `readMocs` + `planStage` + `writePlacementsStage`: into an existing topic map, else a new
     one under the hub. In the browser only, notes that fit no existing map go into a new map named
     after their source — or after the file, when a file's sections came in as several sources — at any
     count. The desktop keeps its rule (a new map needs 3+ notes from one run). Without this, a short
     paste lands in the guide's unrelated map or in none. *(my call; the option must leave the desktop
     unchanged)*
  4. *verify* — no model call: plain checks per note (title, description ≤ 200 characters, type,
     topics, at least one link, in a map). *(my call: saves the visitor a model call)*
  Each phase claims the task, does its work, and advances with a handoff line (`pipeline.ts`
  `claimPhase` / `advancePipeline`); the last advance completes the task. About 3–6 model calls for a
  short source.
- **Failures and repeats.** The stages keep their own second passes (an empty window asked again or
  split, the draft and placement repair rounds), but each source gets a budget of model calls (about 12)
  enforced in the runner's `fetchImpl`; past it, the phase fails. After the one retry `completeJson`
  already makes, a phase fails with a plain reason ("Your AI did not answer in time", "Your AI's answer
  could not be used", "Your AI refused the key"), and the task can be started again from the source or
  the queue. A phase whose writes only partly land (some links or placements refused) advances with a
  handoff that says what did not land — the desktop leaves it to be rerun, which the browser's 10 s
  pickup would turn into a loop. *(my call)*
- **Writes.** The runner holds the store's flushes during a phase and releases them after its handoff:
  one IndexedDB write per phase, and a tab closed mid-phase loses only that phase, which is redone on
  the next visit. *(my call)*
- **Shared code.** `randomUUID` from `node:crypto` in `write.ts`, `verify.ts`, `pipeline.ts` becomes
  `globalThis.crypto.randomUUID()` (Node ≥ 19 and browsers), so the desktop keeps working.

### 3. The health check — shared computation, written by the browser host

- The checks `HealthDashboard.tsx` computes inline (orphans, link health, description quality, schema
  compliance, map coherence, pending observations, open tensions) move into a pure function in
  `editors/knowledge-vault/lib/`, used by the dashboard and by the browser vault. It also computes what
  the report's graph metrics need and the dashboard lacks: dangling links and map coverage.
- The browser vault writes the vault's health report (`GENERATE_REPORT`, then `ADD_CHECK` per check)
  after the guide is written and after every processed source. *(user)*
- Results are honest — the vault's own rule is never to buy a pass with a lie. The guide is made to pass
  for real (§5). After a visitor's own sources are processed, a warning is possible and stays a warning:
  a small, young vault is not expected to be perfect. *(user)*

### 5. The guide passes its health check — `browser/seed/guide-vault.json`

The guide should show, on its first health check, that the vault is in good shape. *(user)* With the
dashboard's rules that means every note has a link from another note (today 5 have none: a fail) and at
least 2 links per note on average (today 45 links for 30 notes: a warning). The guide gets the missing
links — at least 15, including one into each of the 5 unlinked notes — each a real relationship with a
written reason that holds against both notes' text, as the vault's links require. *(user; the links
themselves are my call, reviewed against the notes)* The queue's "connected" step in the guide counts
the new total. The seed's version changes, so a visitor who already has the guide is offered a reset.
The rules themselves do not change: the desktop uses the same dashboard.

### 4. Words the browser shows

- `source-editor/lib/queue-status.ts` gets a browser branch: "Waiting for your AI — connect one in Ask"
  when no AI is connected, "Queued — your AI starts in a moment", then "Processing — <phase words>".
  The "run /powerhouse-knowledge:pipeline in Claude Code" hint never shows in the browser.
- The paste form's lede in the browser: "Paste the text. Once added, your AI turns it into notes."

## Decided with the user (after review)

1. **A big file:** every section a visitor adds is processed, one after another. The intake's review
   panel says how many sources the AI will process before they add them. *(user)*
2. **The guide's health check:** the guide gets real links so it passes (§5), rather than showing a
   fail or bending the rules. *(user)*

## Left to the builder

- Whether the reflect step also offers existing notes found by keyword search as link targets.
- Exact wording of handoffs and failure reasons (simple, direct, few words).
- How "start again" is offered after a failure.
- Test strategy. Expected: headless end-to-end runs against the landing with the AI answered by a stub
  (Playwright route interception of the completions endpoint), checking pickup within 30 s, each phase
  in the queue, notes written and linked, the health report written, the guide dated today with every
  link resolving; plus unit tests for re-dating and the health computation.
