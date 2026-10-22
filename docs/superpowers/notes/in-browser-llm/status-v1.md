# v1 default: status at checkpoint (2026-10-22)

Branch `explore/in-browser-llm`. The tree is clean. Nothing is running: no server or Chrome tab was started.

## Done

- **`b97299cc` feat(chat): R2c is the v1 default in the shared core.**
  - `runV1(utterance, docType, refCandidates, deps, options?)` now runs R2c by default (`V1_DEFAULT_STEP1`):
    - a step-1 model call over every global op of the model, in catalog order;
    - `{"ops": []}` routes to no-action with `reason: "model"`;
    - no pre-gate and no embedding.
  - The old round 6/7 path is `{ step1: V1_EMBEDDING_TOP1 }`. Other round 9 lists are reachable via `{kind: "model", candidates, preGate}`.
  - `step1Grammar` and `step1Pick` moved into `chat/core/step1-candidates.ts`; harness `r8.ts` and `r9.ts` import them from there.
  - New exports: `v1Catalog()`, `v1NeedsEmbedding`, `v1Step1Label`.
  - `V1Deps.runtime` is `{catalog}` plus an optional `index` and `embedQuery`.
  - `V1Result` gained `pipeline`, `step1`, a nullable `gate`, and `reason` on no-action.
  - An unlisted step-1 answer throws `step 1 gave no listed op`.
  - Harness `v1.ts` (`v1Pipeline`) takes an optional `step1` and defaults to R2c.
  - `ChatView.tsx` got only a minimal compile fix: the no-action text now shows the reason.
  - Tests (`tests/unit/chat-v1-pipeline.test.ts`):
    - the served list equals training `scopedCandidates` for all 12 models;
    - the step-1 messages and grammar equal training `step1Prompt` bytes;
    - no embedding is used, no-action comes from the model, refs reach step 2, and junk is rejected.
- **`5698ad45` feat(chat): ref candidates from document state.**
  - `chat/core/ref-candidates.ts` has:
    - `REF_EXTRACTORS`, which mirrors training `RECIPES[op].paths` for all 44 ref ops;
    - `refCandidatesFor(op, state, ctx)`;
    - `driveRefContext(target, documents)`, covering note/knowledge/wbs/project kinds and a project's linked-WBS goals;
    - `documentTitle`;
    - the `ChatDocument` type.
  - Parity test `tests/unit/chat-ref-candidates.test.ts` (46 tests) replays each recipe's seeded states (3 seeds) and compares with training `candidatesFor`.
  - **Not wired into the tab yet.**
- Checks at `5698ad45`:
  - `npx tsc --incremental false --noEmit` gives 203 errors, the same as the baseline. The sorted list was diffed and is identical.
  - Chat and training vitest suites pass (13 files and 116 tests before ref-candidates, plus 46 new).
  - oxlint 1.70.0 from the npx cache (`~/.npm/_npx/57ace2855b35c0ab/node_modules/.bin`, which needs that dir on PATH for tsgolint) gives exit 0 on all changed files.
  - Full `npm test` has **not** been run yet.

## Remaining (exact next steps)

1. **Target resolution, pure** (planned `chat/core/target-document.ts` plus a test):
   - `resolveTargetDocument({selectedId, documents: ChatDocument[], supportedTypes, utterance})` returns `{kind: "document", doc, via: "selected" | "title"}` or `{kind: "ask", reason: "none" | "unsupported" | "ambiguous", options}`.
   - The title tie is an exact case-insensitive, whole-phrase title match in the utterance, with exactly one hit.
   - Routing:
     - with a document, run R2c with no question rule in front;
     - with no document, `looksLikeQuestion` sends the request to the answer path;
     - otherwise ask the user to pick a document, listing each one's title and type (`docTypeLabel`).
   - Don't add an unscoped G3 gate: it is unmeasured.
2. **Tab** (`hooks/use-chat-llm.ts`, `components/ChatView.tsx`, `ChatProposalCard.tsx`, `DriveExplorer.tsx` line 405 passes only `notes`):
   - use `useDocumentsInSelectedDrive()` to get all docs, map them to `ChatDocument` with `documentTitle(state.global, header.name)`, and keep the docs whose type is in the catalog;
   - keep a picker over all supported docs, labeled with their type, and pre-select the drive's selected node if it is supported;
   - build refs with `refCandidatesFor(entry.key, doc.state, driveRefContext(doc, docs))` in place of `noteRefCandidates`;
   - call `ensureLoaded`, which under R2c no longer needs `loadV1Runtime` (gte-small). Use `v1Catalog()` and drop the embedder load from the tab;
   - dispatch to `doc.id`.
   - Proposal card:
     - show the readable op (`readableOpName`), the args and the target doc title and type;
     - show "picked by the model from N ops";
     - offer Confirm and Cancel;
     - show the dispatch error in red;
     - add the note "Local model, may be wrong: check before confirming."
3. **Model source:**
   - add a localStorage setting in the tab (model URL) as the primary mechanism, with `VITE_CHAT_MODEL_URL` as secondary. There are no `vite/client` types, so access it through a cast, and verify it empirically under `ph connect studio` before documenting it.
   - The default stays base HF (`DEFAULT_MODEL`).
   - Changing the URL takes effect on reload: the module-level `clientPromise` and `scoreCache` are per model.
   - Show a clear label for the loaded model, and warn that base + R2c is unmeasured (round 8 dev smoke with base, C3 16/30).
   - Serving: first try same-origin `http://localhost:3100/training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf`. Studio's Vite served `/vendor/...` and `/models/...` at root in round 7. Check it with `curl -I` and a Range GET.
   - CSP has no `connect-src`/`default-src`, so cross-origin is only a CORS question. Fallback: a small `scripts/serve-model.mjs` (CORS, HEAD, Range). Do not use `npx http-server`.
4. **Harness agreement check** (optional, cheap):
   - run Vite on 5199 with `spike.run("load", "webgpu", false, "/lora/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf")` then `spike.run("v1Pipeline", "webgpu", {sets: ["dev", "devx", "devna"]})`;
   - expect Round 9 R2c dev numbers: op 46/49 and no-action 9/10.
5. **E2E in Connect: none of the checks (a)–(e) has been done.** Start `ph connect studio --port 3100` in the background, load chrome-devtools MCP via ToolSearch, load the Round 8 GGUF, then:
   - (a) a knowledge-note request goes Confirm → dispatch → history;
   - (b) a WBS or project request with a ref;
   - (c) a question is answered with no dispatch;
   - (d) with no doc selected, the tab asks for one;
   - (e) Cancel dispatches nothing.
   - Record load times and CSP and console output. Put screenshots in `scratchpad/v1-check/`.
   - Stop the servers and close the tabs afterwards.
6. Run `npm test`, excluding the 2 `kysely-pglite-dialect` suites.
7. **Docs:**
   - append "v1 default" to `docs/superpowers/specs/2026-10-20-in-browser-llm-spike-results.md`;
   - update `training/README.md` if relevant.
   - Another agent writes under `docs/` concurrently: touch only those two files, and retry on `.git/index.lock`.

## Gotchas

- The WBS docType is `bai/wbs`, not `bai/work-breakdown-structure`. `CatalogEntry.docType` is the full id; `model` is the short name.
- The harness loads with `jinja: false` and the default `nCtx: 4096`. The tab must match.
- The tab today supports knowledge notes only (`noteRefCandidates`, `notes` prop). Check (b) needs the generalization in step 2.
- Under R2c, `hits` is empty and `gate` is null. The old card's "Op by embedding" line has to go.
- `useDocumentsInSelectedDrive` may be stale. `use-reactor-docs.ts` exists because Connect's documentCache was seen failing; verify that the WBS/project doc state comes through in studio.
