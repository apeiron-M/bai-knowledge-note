# Configuration C in Connect: implementation log (Phases 1-4)

Branch `explore/in-browser-llm`, never pushed. `$SP` = this session's scratchpad. `exp/blind/` was not read.
QA per commit: `$SP/impl/qa.sh` (tsc filtered to repo paths and diffed against the pre-work baseline
`$SP/tsc-baseline-repo.txt` = 207 lines; the coordinator's "203" counts differently, the bar used is
"no new error lines"); oxlint (npx cache binary, `--type-aware --type-check --fix` on
editors/tests/scripts/spike only, never repo-wide because training/artifacts is in scope there),
errors diffed against `$SP/impl/lint-base-errors.txt` (132, all pre-existing); vitest `--dir tests/unit`
per commit and a full run per phase (only the 2 kysely-pglite-dialect suites may fail outside
training/artifacts).

Resumable state: all work is committed (list below); no servers left running (the X5 :18761 and Kev :18762 llama-servers this agent started were stopped). Nothing is half-done.

## Commits
1. `1035d3ef feat(chat): X6 args ship patch in core` - x6-args-ship.patch applied verbatim; editors/ and tests/unit byte-identical to rig tree x6. QA: tsc 207/207, lint 132/132, tests/unit 225 pass.
2. `2c758faf feat(chat): X9 args (today, state choices, list completion) in core and the tab` - x9-args2.patch verbatim on x6; editors/ + tests/unit byte-identical to rig tree x9 (diff -r empty). QA: tsc 207/207, lint 132/132 (4 new no-unnecessary-condition warnings live in the verbatim patched files; left as measured), tests/unit 265 pass.
3. `92dd6c6d test(chat): dev oracle fixtures for configuration C` - dev fixtures (h3/h4 only), expected decisions via rig evaluate.decide (exact metrics == rig dev-cv block; exact vs branch gate 216/216 identical), answer table (100 answers, ids == spike/lib.ts), template goldens (12), retok 1,685/1,685. QA: tsc 207/207, lint 132/132, tests/unit 265 pass.
4. `ba2d267e feat(chat): C fusion and margin gate` - fusion.ts + model-manifest.ts; fusion parity on 216/216 dev rows in exact and branch modes (|dp| <= 1e-9, 29 asked). QA: tsc 207/207, lint 132/132, tests/unit 280 pass.
5. `e06cc0af feat(chat): Kev System One request builder` - kev-request.ts; body byte-equal to decide.mjs (rebuilt from frozen catalog.json) for 12/12 models; OP_DESCRIPTIONS == override 99/99. QA: tsc 207/207, lint 132/132, tests/unit 297 pass.
6. `e98d101a feat(chat): canonical token-id trie for step-1 scores` - lora-trie.ts, lfm2-template.ts, decision-backend.ts; tests: answer table, 12/12 template goldens, trie bit-identical to lib.ts on mocks (12 models x 2 modes). (Plan listed separate template/answer-tokens test files; they live in chat-c-trie.test.ts.) QA: tsc 207/207, lint 132/132, tests/unit 340 pass.
7. `19bd07fe feat(chat): C pipeline (decideOp + fillArgs) with arm-A fallback` - c-pipeline.ts (decideOp/fillArgs, arm-A fallback incl. skip), runStep1 extracted from runV1 (bytes unchanged). QA: tsc 207/207, lint 132/132, tests/unit 348 pass.
8. `7192e86b feat(chat): wllama backend for two instances (LoRA + Kev)` - two-instance wllama loading (loadLlm/loadDecisionModel, jinja false, opt-in useCache, native-log errors, offload count), LoraBackend on LlmClient. QA: tsc 207/207, lint 132/132, tests/unit 354 pass.
9. `aceddf84 test(chat): node parity of C against llama-server 46ca246` - server-backend.ts + scripts/chat/parity-c.mts (`npm run chat:parity-c`). **Node parity: PARITY OK** on 228 dev items: template 228/228, string-vs-id prompt dists identical (5/5, max 0), loraPick 228/228, trie max |d| 7.6e-6 nat (exact and branch; bar 1e-3), 309 forced reads / 0 floored, Kev |dp| = 0 and |d logT1| = 0, gate 216/216 exact, 216/216 branch, decideOp 216/216, fillArgs(gold) 196/196 identical, evaluate.py on new rows == stored dev-cv metrics. Descriptive: refCandidatesFor-only args 183/196 (eval items carry drive refs without ctx). Summary at `$SP/parity-c/summary.json`. QA: tsc 207/207, lint 132/132, tests/unit 354 pass.
9b. `e0f6b3e1 fix(chat): parity-c trie tolerance follows the prompt-cache history` - finding: trie scores vary up to ~0.015 nat with llama-server prompt-cache history (reused server / subset order); fresh full in-order run is 7.6e-6. Bar 1e-3 for fresh full runs, 0.05 otherwise; decisions identical either way.
10. `0ca47781 feat(chat): in-browser parity check (dev only)` - chat/dev/parity-c.ts + 20-item fixture; node run of the module over llama-server: picks 20/20, gate 20/20, args 18/18, Kev |dp| 0, trie median 0.005 / max 0.09 nat (reused server; cache-history noise). Full node parity rerun after 9b: PARITY OK again (identical numbers).
11. `fafe4eff feat(chat): configuration C in the Chat tab (two models, gate picker, settings)` - hook + chat-models store + resolveCSources + ChatChoiceCard/ProposalCard/ChatView/ChatModelSettings + tests (plan commits 11-13 folded into one: the hook API change breaks the old ChatView, so they cannot compile separately). QA: tsc 207/207, lint 132/132, tests/unit 360 pass.
12. `8fcb9639 test(spike): browser parity of the shipped C core on WebGPU` - **Browser parity (WebGPU, shipped clients)**: branch: gate 20/20, args 18/18, Kev max |dp| 0.039, trie median 0.055 / max 0.39 nat, PASS; exact: gate 20/20, args 18/18, trie median 0.042 / max 0.28, PASS. Offload 17/17 + 25/25; identity checks pass. Warm medians: step1 192 ms, trie 67 ms, Kev 489 ms, step2 211 ms.

Phase QA (full `npx vitest run`, after phases 2, 3 and 4): failures outside training/artifacts are only
`tests/processor/graph-indexer` and `graph-query` (kysely-pglite-dialect), as at baseline.

13. `3a8c99dc feat(chat): persistent model storage and load timings for C` - storage.persist() before the first cached download; load entries (role, loadMs, downloadBytes, gpuLayers) in window.__baiChatTimings. Full QA on this HEAD: tsc 207/207, lint 132/132, full vitest = baseline (only the 2 kysely suites fail outside training/artifacts).

## Parity results (dev only, h3/h4)

| check | node (llama-server 46ca246, fresh servers, rig order) | browser (Chrome 155 WebGPU, shipped clients, 20 items) |
|---|---|---|
| gate decisions (pick, asked, offered order) | exact 216/216, branch 216/216, decideOp 216/216 | branch 20/20, exact 20/20 |
| step-1 pick | 228/228 | 20/20 |
| step-2 args on gold (args, raw, dateFixed, listsCompleted) | 196/196 | 18/18 |
| Kev option probabilities | max abs dp 0 (logT1 0) | max abs dp 0.039 (bar 0.05) |
| trie scores | max abs d 7.6e-6 nat (bar 1e-3) | median 0.055 / max 0.39 nat branch; 0.042 / 0.28 exact (bar: median 0.08) |
| template / string-vs-id prompt | 228/228 / 5/5 identical | n/a |
| rig evaluate.py on new rows | == stored dev-cv metrics (op 183, ask 29, wrong 11, eff 170) | n/a |

Documented nat tolerance: node 1e-3 nat when the run reproduces the rig's request order on fresh servers;
0.05 nat otherwise, because trie scores move up to ~0.015 nat (node) / 0.09 nat (reused server, 20-item run)
with llama-server's prompt-cache history. Browser bar is median <= 0.08 nat. Decisions never changed.
Run node parity: `npm run chat:parity-c` (~3 min, starts both servers itself). Browser: harness
`window.__cParity.start("branch")` (spike/llm-harness, Vite :5199), or in Connect with the debug flag:
`await window.__baiChatParityC()`.

## Deviations from PLAN.md

- Phase 0 overrides: string prompts (templated + answer pieces) instead of mixed token prompts; children
  outside top-64 (or under a node whose top-n dump fails) are read with a forced logit_bias call instead of
  the n_probs 8192 retry/floor. Node: 309 forced reads, 0 floored, bit-exact vs the rig.
- Branch-only trie is the default (`bai.chat.trieMode=exact` dev setting for exact).
- No N1 / dispatch-time normalisation at all (coordinator): args dispatched as produced.
- Answer-table identity uses X5 GGUF sha + tokenizer sha + pre + n_vocab + BOS/EOS (not general.name).
- `chat-c-template` and `chat-c-answer-tokens` tests live in `chat-c-trie.test.ts`; manifest/precedence
  tests in `chat-model-source.test.ts` and `chat-c-settings.test.ts`; plus `chat-c-pipeline`,
  `chat-c-wllama-backend`.
- Plan commits 11-13 folded into one (`feat(chat): configuration C in the Chat tab`): the hook API change
  breaks the old ChatView, so they could not compile separately. A new `hooks/chat-models.ts` store holds
  the per-page model singletons.
- Kev loads lazily on the first request to a document (coordinator: "Kev on first need"), in parallel with
  step 1, not right after the LoRA. While waiting, "Use LoRA alone for this message" skips it for that turn.
- Kev is refused (arm A, labelled) without WebGPU or when llama.cpp's log shows fewer than all layers
  offloaded; never run on CPU. Two consecutive failed Kev calls disable it for the page.
- deviceMemory < 16 GB shows a warning only; the toggle stays default ON (coordinator).
- `resolveModelSource` was replaced by `resolveCSources` (no HF base-model default any more); the dev
  default is the same-origin `/training/artifacts/...` paths. `VITE_CHAT_MODEL_URL` still maps to the LoRA;
  new `VITE_CHAT_LORA_URL`, `VITE_CHAT_KEV_URL`, `VITE_CHAT_MODEL_BASE_URL`.
- Speculative step 2 (plan §2.5, optional) not implemented.
- `npm run lint:fix` was run path-scoped (editors tests scripts spike/llm-harness) with the npx-cache
  oxlint, since repo-wide it also walks training/artifacts.

## Memory (report, not blocking)

Not re-measured here. Phase 0: ~4.5-5 GB for both models on Apple unified memory (X5 ~0.6 GB, Kev
~1.7 GB heap after load +1.1 GB on its first call, plus ~1.4 GB GPU buffers). Mitigations shipped: lazy
Kev, toggle, "Unload decision model" (exits the worker), settings note, <16 GB warning. Unloading/reloading
was not exercised in a browser.

## Left for the E2E phase (PLAN §5)

- Everything in Connect itself: E0-E13 have not been run. The tab has not been rendered in Connect;
  only tsc/lint/unit tests cover ChatView/ChatChoiceCard/ChatModelSettings/ChatProposalCard.
- Check Studio's Vite serves `/training/artifacts/x5-350m/gguf/...` and `/training/artifacts/kev-ft/gguf/...`
  (200 + 206 Range) - the default URLs depend on it.
- OPFS caching (`useCache: true` for manifest names), "Clear cached models", cold vs warm loads, the
  identity check with real download byte counts (in the harness bytes were 0 because the HTTP cache served
  the files, which the check tolerates).
- The 404 Kev fallback label (E10), "None of these" (E7), the gated choice order vs expected-decisions
  (E6), skip-Kev link, unload/reload of Kev, the 2-failure disable.
- Memory in Chrome Task Manager (E13), latency E4 (harness warm medians: step1 192 ms, trie 67 ms, Kev
  489 ms in parallel, step2 211 ms; first Kev call ~1.26 s).
- The byte-count identity check has only run with bytes = 0 (HTTP-cached harness loads); the first real Connect download is its first real test.
- `tests/fixtures/chat-c/manifest.json` keeps the rig's absolute /private/tmp provenance paths (harmless).
- `window.__baiChatTimings` (turn + load entries) / `window.__baiChatParityC` exist only in a dev build or with
  `localStorage["bai.chat.debug"]="1"`.
- Production model host is still open (base URL setting; needs CORS + Range).
