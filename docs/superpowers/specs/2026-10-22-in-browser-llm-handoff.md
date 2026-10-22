# In-Browser LLM: Handoff (2026-10-22, 16:30 CDT)

Branch `explore/in-browser-llm`. Nothing has been pushed. Work paused for the org usage limit, and a spin-up is scheduled for after the reset. The coordinator does all work through subagents.

## Read first

- `docs/superpowers/specs/2026-10-22-in-browser-llm-findings.md`: the team write-up. It is committed but not yet published as a page.
- `docs/superpowers/specs/2026-10-20-in-browser-llm-spike-results.md`: Rounds 1–10 in full.
- `training/README.md`: the teacher, training, Constantine and export pipeline.
- `docs/superpowers/notes/in-browser-llm/`: copies of the plans and reports that used to live in the session scratchpad. They include the spike, LoRA and remote-training plans, the remote run log, the constrained-decoding and decision-model research, `status-v1.md`, and the four held-out README files.

## Where things stand

**Best setup:** the Round 8 LoRA in the R2c pipeline. R2c has no pre-gate, gives the model every op of the current document's model in catalog order, fills args with grammar constraints and label-scored refs, and requires a Confirm.

| Held-out set | Op accuracy | Fully correct |
|---|---|---|
| held-out-3 | 85.9% | 72.8% |
| held-out-4 | 80.8% | 68/104 |

Natural wording scores about 92–98% and paraphrase about 69–74%. The bars are op ≥90% and args exact ≥80%, and neither is met. The Round 10 targeted retrain did not beat Round 8, so Round 8 stays the v1 model. Unscoped requests, where the document type isn't known, fail at 37–39%, so v1 must ask for a document.

## Open workstreams

1. **v1 Chat tab (partly done).**
   - Done: `b97299cc` makes R2c the default in the shared core, and `5698ad45` builds ref candidates from document state for all 44 ref ops, with parity tests.
   - Still to do:
     - generalise the tab beyond knowledge notes. The WBS type is `bai/wbs`;
     - a document picker, plus the "ask for a document" path;
     - a configurable model URL with a label for which model is loaded, and a warning that the base model has never been measured with R2c;
     - proposal-card polish;
     - Connect E2E checks (a)–(e), with load times and CSP notes;
     - `npm test`;
     - a "v1 default" section in the results doc.

   The exact next steps and pitfalls are in `notes/in-browser-llm/status-v1.md`.
2. **Publish the findings page** after v1 lands. Fold in the v1 E2E results first. The write-up's author flagged 6 unverifiable points; the main one is that the LoRA with R2c had not yet run in Connect.
3. **Split-model evaluation** (the user's idea: a generic reactor layer plus a document-model layer, or a verb/target frame mapped to ops by code).
   - Report: `notes/in-browser-llm/split-model-evaluation.md`. The analysis is complete.
   - Errors: across 73 pooled misses, the verb is already right on 91–96% of items, while the target (entity or field) is right on only 81–85%. A perfect verb module would fix at most 28 of the 73. 85 of the 99 ops map cleanly to a (verb, target) frame.
   - Recommendation: keep the reactor/document-model split as code. That means a frame table shipped with the catalog plus a reusable drive/scope layer, with the frame format trained into the same LoRA, so there's no extra download.
   - **Next experiment, which needs no training:** a top-3 confirm using the Round 8 LoRA. In 16 of 19 Round 8 scored misses, the right op was ranked 2nd or 3rd. Estimate: half a day of harness code plus a ~10-minute run.
   - User decisions:
     - whether to accept "right op among the offered choices, plus how often we ask" in place of the 90% one-shot bar;
     - a fresh blind set for any retrain;
     - a drive-level eval set for unscoped requests.
4. **Decision-model ("jev") research (partial).**
   - "Jev" is TypeSafe AI's System One decision model: it answers typed choice, score and yes/no questions in one forward pass by reading option probabilities.
   - Liquid's `d1-omni-600M` (407 MB) is built on LFM2.5.
   - wllama 3.8.1 can't load d1 or Laya; its WASM build only has openjev, lev, kev and nimble. Kev-0.8B (812 MB) is the closest that loads.
   - Unfinished: fine-tuning tooling, WASM latency, ONNX support.
   - First experiment: zero-shot Kev-0.8B or d1-omni on the held-out sets with the llama.cpp CLI, about half a day, plus 1–2 days for a custom wllama build.

## Decisions waiting on the user

- **Where to host the fine-tuned GGUF.** It is local only today, at `training/artifacts/round8/gguf/` (gitignored).
- **Whether to add the `kysely-pglite-dialect` dependency.** Two processor test suites and 3 tsc errors depend on it.
- **Next research direction:** the split model, the decision model, LFM2.5-1.2B, or collecting real user phrasing.

## Environment notes

- **This Mac:** never run training here. MPS once hit 44 GB.
- **Constantine (`ssh trainbox`):** an M4 Max with 64 GB, workspace `~/bai-training/`. Training uses screen, caffeinate, a watchdog, the MPS cap `HIGH=0.5`/`LOW=0.45`, and checkpoints. Keep the laptop plugged in with the lid open.
- **Checks:** tsc baseline is 203 errors. `npm test` is green apart from the 2 `kysely-pglite-dialect` suites. oxlint runs from the npx cache.
- **Teacher:** `claude -p` with isolation flags; batch size 10, label batch 8. It stops on any 429. The injected CLI context contains the account email, and a filter drops any row containing it.
- **Held-out sets:** held-out-1 and held-out-2 are retired. held-out-3 has had 2 uses and held-out-4 has had 1. Write a fresh blind set before more tuning.
- **Rules:** never push, and don't create branches.
