# Configuration C in Connect: E2E results (E0-E13)

Date 2026-10-27, branch `explore/in-browser-llm` at `3a8c99dc` (no code changes, no commits from this run).
Setup: `ph connect studio --port 3100` (Vite dev path, as v1), started by the agent in the background, never `ph vetra`. Chrome 155 driven by the chrome-devtools MCP (Apple metal-3 adapter, `shader-f16`, `subgroups`, maxBufferSize 4 GiB, deviceMemory 32, `crossOriginIsolated` false, so wllama runs single-thread). Drive "Chat E2E Vault": note "CRDT merge semantics" (bai/knowledge-note) and project "Rooftop beehives" (bai/project).
All numbers come from one session on one machine; the models were served from localhost, so the "network" downloads are not representative of a real host.
The session was cut off once (org usage limit): Connect's background task died, so it was restarted, and the chrome-devtools MCP came back with the same profile (OPFS and localStorage intact). Checks finished before the cutoff were not redone.
Screenshots: `/Users/benjaminjordan/projects/powerhouse/bai-knowledge-note/.superpowers/c-e2e-shots/` (gitignored; the MCP cannot write into the scratchpad):
00-legacy-migrated-custom, 01-chat-tab-idle-C, 02-cold-proposal-add-topic, 03-warm-messy-proposal, 04-gated-choice, 05-chosen-ref-proposal, 06-kev-off-lora-alone, 07-kev-load-failure-fallback (.png).
Raw log: `e2e/progress.md`; memory script: `e2e/mem.sh`.

## Pass/fail

| # | Check | Result |
|---|---|---|
| render | Chat tab on a knowledge note and on a project | PASS. Status rows, config label "Configuration C: X5 × Kev-FT, gate τ 0.5 (held-out-6: 93.5% op one-shot, 15.9% asked)", settings (shot 01). |
| E0 | Serving | PASS. HEAD 200, Content-Length 229,312,224 (X5) and 529,595,072 (Kev) = manifest; `Range: bytes=0-15` returns 206 with 16 B. |
| E1 | CSP / origins | PASS. 0 CSP messages. Requests: GGUF HEAD+GET, `/vendor/wllama/3.8.1/wllama.js` and `.wasm`, all from localhost:3100; nothing to HF or jsdelivr. The only console noise is the known one (localhost:4001 refusals, `[useGraphSearch]`/`[useGraphMetadata]`, form-field id/name). |
| E2 | Cold load (after "Clear cached models", OPFS empty) | PASS. A question with no target document loaded the LoRA only: 1,101 ms, webgpu 17/17 layers, 229,312,224 B. **Kev stayed idle**, so lazy loading works. The first request to a document started Kev: downloading at +42 ms, ready at +2,812 ms (loadMs 2,767 incl. ~1.3 s download), webgpu **25/25** layers, 529,595,072 B. Send→card 4,016 ms (step 1 317, trie 128, first Kev call 1,035, fill 160). |
| E3 | Warm (reload, OPFS) | PASS. **No GGUF GET or HEAD** on the network after reload; OPFS holds both files at the manifest sizes. LoRA load 549 ms, Kev 1,227 ms (after a Chrome restart: 1,040 / 1,769 ms). `downloadBytes` (from OPFS) equals the manifest for both files, cold and warm; no "file differs" warning. Send→card on the first message after reload, models included: 3,125 ms. |
| E4 | Latency per stage, warm, C | Measured, 11 turns (below). Send→card median 834 ms, p90 1,016 ms: **within the 1.5 s budget**. Kev never fell back to CPU (25/25 layers every load). |
| E5 | Not gated + Confirm | PASS. "add the topic vector clocks" gave ADD_TOPIC `vector clocks`, "Chosen by X5 × Kev-FT (p 0.95)". Confirm: global revision 4→5, ADD_TOPIC, error null, topic present in state. The project's SET_TARGET_DATE was also confirmed: revision 4→5, `targetDate` set. |
| E6 | Gated + choose | PASS (own utterance, not a rig item). "we started on the hive inspection checklist today" opened `chat-choice`: Set deliverable status 37% / Add deliverable 18% / Create project 8% / None of these (shot 04). Option 0 gave the card in 203 ms (fill 184): id "Hive inspection checklist (a053be4f…)", status IN_PROGRESS, "You chose this from 3 options" (shot 05). Confirm: revision 5→6, SET_DELIVERABLE_STATUS, error null. The rig-order identity on dev items is covered by E12 (gate 20/20). |
| E7 | None of these | PASS. The same utterance re-gated with the same 3 options. None: revision 6→6, no proposal, message "Nothing changed. Try rephrasing, or name the change more directly." |
| E8 | No-action question | PASS with a deviation from the plan. "what is this note about?": step 1 chose none, the tab answered ("No document change…"), nothing dispatched, 761 ms. **`kevStarted: true`**: Kev is called in parallel with step 1 by design (IMPL), and the result is discarded. The plan's "no Kev call" criterion does not hold. |
| E9 | Relative date | PASS. "we're aiming to wrap this up by next friday, set that as the target date" gave SET_TARGET_DATE `2026-11-06T00:00:00Z` (p 0.98). This is the `date-resolve.ts` convention ("next <weekday>" means next week, weeks start Monday). The plan's expected 2026-10-30 was wrong. |
| E10 | Kev load failure | PASS via a closed port. Kev URL `http://localhost:9/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` (the manifest file name, so the config stays "C"). The label switched to "LoRA alone (decision model failed to load: load http://localhost:9/…: Failed to fetch): held-out-6 84.5% op, no ask step". The proposal still appeared, "Chosen by the LoRA alone (decision model unavailable: …)", and nothing was asked (shot 07). A real 404 cannot be produced on the Vite dev server (see issues). |
| E11 | Cancel | PASS. Revision 5→5, "Cancelled ADD_TOPIC; nothing dispatched." |
| E12 | In-browser parity in Connect (`__baiChatParityC("branch")`) | PASS, 18.4 s. Picks 20/20, gate 20/20, args 18/18, Kev max abs Δp 0.039, trie median 0.055 / max 0.39 nat, 0 errors. Same as the harness run in IMPL. |
| E13 | Memory | Measured (below): **about 5 GB for Kev on top of the LoRA; flag (> 3 GB).** |
| extra | Kev toggle off | PASS. The label became "LoRA alone (decision model off): …" and the card "Chosen by the LoRA alone (decision model turned off)" (shot 06). Config A; step 1 204–254 ms, send→card 364–436 ms (4 turns). |
| extra | Unload Kev, then lazy reload | PASS. The status returned to "loads on first request to a document". The next document request reloaded Kev from OPFS (1,195 ms) and ran C. |
| extra | "Use LoRA alone for this message" | PASS. Clicked during the wait for Kev: "decision model skipped for this message", config A, 515 ms. Kev kept loading in the background and was ready for the next turn. |

## Latency (warm, C, 11 turns, ms)

| stage | median | p90 | min–max |
|---|---|---|---|
| step 1 (runs in parallel with Kev) | 583 | 617 | 281–629 |
| Kev systemOne | 624 | 807 | 525–826 |
| trie (branch) | 113 | 235 | 90–267 |
| fusion + gate (decide total minus max(step1+trie, Kev)) | 4 | 4 | 3–4 |
| decide total | 710 | 852 | 552–859 |
| step 2 (fill; 7 non-gated) | 118 | 150 | 102–179 |
| send→card (proposal or choice) | 834 | 1,016 | 611–1,036 |
| send→proposal (non-gated) | 953 | 1,024 | |
| click option→proposal (gated) | 203 | | |

- **GPU contention.** Step 1 takes about 200–250 ms when Kev is not computing at the same time (Kev off: 204–254 ms; Kev still loading: 202 ms; parity runs it sequentially: 133–268 ms). It takes about 580 ms when Kev's call runs in parallel. Both instances share one GPU. The critical path is max(step1+trie, Kev), so a sequential order would cost about the same.
- **First Kev call after a load:** 977–1,160 ms.

Utterances (own, none from a held-out set):
- plain: "add the topic vector clocks", "add a deliverable called honey harvest plan", "add a team member named Priya as beekeeper", "set the description to how CRDTs merge concurrent edits";
- messy: "uhh can u tag this w/ like conflict resolution stuff pls", "pls make the descripton say hives on the east building roof" (gated: Update project info 61% / Update deliverable 37%);
- gated: "we started on the hive inspection checklist today", "the volunteer rota for june got cancelled" (gated: Set deliverable status 63% / Remove deliverable 16%);
- question: "what is this note about?", "what is a vector clock?" (no document);
- relative date: "…by next friday, set that as the target date";
- ref: the checklist and rota ones;
- also "rename this note to Merging CRDTs without conflicts" and "this one is basically a permanent note now".

Wrong outputs seen, all model quality rather than pipeline faults:
- SET_TITLE cut the title to "Merging CRDTs";
- "permanent note" became ARCHIVE_NOTE (p 0.63, not gated);
- a duplicate ADD_TOPIC was proposed for an existing topic.

## Memory (both models loaded, Connect's real non-COI mode)

- `performance.measureUserAgentSpecificMemory` is **not available** (not cross-origin isolated).
- `performance.memory`: used JS heap 363.5 MB / total 375.5 MB, flat across loads. The wasm heaps live in the wllama workers and are not counted there.
- Process memory is from `footprint` (phys_footprint, what Activity Monitor shows) and `ps` RSS for the MCP Chrome (pid 36309). The wllama workers run inside the tab's renderer process.
- Chrome Task Manager was not read; `footprint` covers the same processes.

| state | renderer footprint / RSS | GPU process footprint / RSS |
|---|---|---|
| page loaded, no models | 1,285 / 1,550 MB | 121 / 160 MB |
| X5 + Kev loaded, after 3 C turns | **4,174 / 3,278 MB** | **2,851 / 1,456 MB** |
| after "Unload decision model" (X5 only) | 1,567 / 619 MB | 499 / 191 MB |

- **Kev costs about 2.6 GB (renderer) + 2.35 GB (GPU) ≈ 5.0 GB.** X5 costs about 0.3 + 0.4 ≈ 0.7 GB.
- C in total is about **5.6 GB above the baseline page**: above Phase 0's 4.5–5 GB estimate and well over the E13 3 GB flag.
- Unloading Kev returns the memory immediately.

## Issues

1. **A v1 setting silently leaves the tab off C.** The profile still had v1's `bai.chat.modelUrl` = Round 8 GGUF. `readChatSettings` migrates it to `loraUrl`, so the tab ran "Custom models (r8 + Kev)" until the key was removed (shot 00). The behaviour follows the plan (§1.5), but every v1 user lands there. Consider dropping a legacy value that is the Round 8 dev path, or offering a reset in settings. Not changed: it is a product decision.
2. **No real 404 on the dev server.** A missing path returns Vite's SPA `index.html` with 200. A Kev URL with a wrong file name made `loadDecisionModel` resolve without error on an HTML 200 (6 KB; the parse was not verified), and then the guard refused it as "not a decision model (no decision head)". The guard catches it, but the message is misleading. A non-manifest Kev URL also switches the label to "Custom models…", which takes precedence over the "LoRA alone (failed)" label.
3. **Discarded Kev call on no-action turns (E8).** It costs about 0.6 s of GPU time, concurrent with the answer.
4. **Status text.** "cached" reflects the `useCache` setting, not an actual cache hit; the network trace is the evidence that the cache was used. `navigator.storage.persisted()` stayed false after `persist()` was requested (Chrome's heuristic); the cache can be evicted.
5. **Duplicate timing entries (dev only).** `__baiChatTimings` records each `load` entry twice after a reload.
6. **Duplicate singleton documents (not the chat).** Each page load of the vault editor creates another HealthReport, VaultConfig and PipelineQueue in the drive. This is a race in `hooks/use-drive-init.ts`, which reads existing nodes before the drive has synced. The target picker grew from 5 to 11+ entries. It predates C; worth its own fix.
7. **SET_DELIVERABLE_STATUS sends `deliveredAt`** for IN_PROGRESS; the reducer stores null. Harmless.

## Servers at the end

- Connect `ph connect studio --port 3100`: started by this agent and **stopped**. The tab was navigated to about:blank to free the models.
- The spike harness Vite on :5199 (pid 27839) was already running before this run, from an earlier agent. It was **left running**; stop it if it is not wanted.

## Profile side effects (MCP Chrome profile, origin localhost:3100)

- `bai.chat.modelUrl` (v1 Round 8 URL) and the migrated `bai.chat.loraUrl` were removed.
- `bai.chat.debug=1` is set.
- `bai.chat.kevUrl` is cleared and the Kev toggle is back on.
- OPFS holds the X5 and Kev GGUFs (cache).
- Drive changes made by the confirmed actions:
  - note: ADD_TOPIC "vector clocks";
  - project: SET_TARGET_DATE 2026-11-06, and SET_DELIVERABLE_STATUS checklist IN_PROGRESS.
