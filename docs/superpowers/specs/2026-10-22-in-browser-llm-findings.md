# In-Browser LLM Chat: Findings

**Date:** 2026-10-22 (updated after v1 landed)
**Branch:** `explore/in-browser-llm` (128 commits ahead of `main` at `2991e101`; not merged)
**Question:** can a chat assistant run fully in the browser, answering vault questions and issuing reactor/vault commands with a small local LLM?
**Sources:** the exploration plan (`2026-10-20-in-browser-llm-exploration.md`), the spike results (`2026-10-20-in-browser-llm-spike-results.md`: Rounds 1–10 and "v1 default"), `training/README.md`, `training/results/*.json`, the split-model and decision-model notes in `docs/superpowers/notes/in-browser-llm/`, and git history. Every number below comes from one of these. Most were observed once, on one machine (Chrome, Apple `metal-3` WebGPU adapter). Estimates are marked as such.

## 1. Summary

- **v1 works end to end in Connect.** The Chat tab runs on any drive document whose type has operations. It runs LFM2.5-350M (a 350M-parameter model from Liquid AI) in the browser through wllama, a WebAssembly build of llama.cpp. It picks one document operation, fills its arguments under a grammar, shows a proposal card, and dispatches through the reactor only after the user clicks Confirm. With the fine-tuned model, all five Connect checks passed: model load 683–1,085 ms, send → proposal 377 ms with the model loaded, no CSP violations, and every proposal in the session right.
- **Best setup measured:** the Round 8 LoRA (a fine-tune, defined in section 4) with the "R2c" pipeline. This is what v1 runs. Measured on two different blind sets, which are not directly comparable:
  - held-out-3 (92 action requests): right operation 85.9%, fully right 72.8%;
  - held-out-4 (104, harder): right operation 80.8%, fully right 65.4%.
  - Median latency per request in the test harness: 443–459 ms warm on WebGPU.
- **Natural vs paraphrased requests:** natural phrasing is near or at the bar (92.3–97.8% op); paraphrased requests are not (69.2–74.5%).
- **The pre-registered bars were never met.** The bars were op accuracy ≥ 90% and exact args ≥ 80%. A targeted retrain (Round 10) did not improve on Round 8.
- **Where the errors are:** pooled over held-out-3 and -4, the verb (add, remove, set) is right on 91–96% of items and the target (which entity or field) on only 81–85%. Most misses are near-misses between sibling operations of one model.
- **Recommendation:** keep v1 as it is (Round 8 LoRA + R2c + Confirm, document required). The cheapest next step is a top-3 confirm experiment, which needs no training. Unscoped requests ("do X somewhere in my vault") are not usable with this model.

## 2. What works today (v1)

v1 landed in four commits: `b97299cc` (R2c is the pipeline default), `5698ad45` (reference candidates from document state), `b4c1889a` (a target document is required) and `fa7ea95a` (the tab). Details: "v1 default (2026-10-22)" in the results doc.

**The Chat tab on any drive document.** The document picker lists every drive document whose type has operations, labelled with its type. Reference candidates (goal descriptions, member names, deliverable titles, topic names, link targets) come from the document's state for all 44 reference ops in the training recipes. A parity test checks them against the training recipes.

**A document is required for a change.**

- The target is the picked document.
- If nothing is picked, the target is the one supported document whose title the request names as a whole phrase.
- Otherwise the tab asks "Which document should this change?" and lists the documents with their types.
- A question with no target goes straight to the answer path. With a target there is no question rule: the model decides.

**Loading the fine-tuned model.** The default is still the base model from Hugging Face, because the fine-tune has no public host yet. To use the Round 8 fine-tune:

- Chat tab → model line → "GGUF URL" → Use. The URL is saved in `localStorage`. It takes precedence over `VITE_CHAT_MODEL_URL`, which was not verified under `ph connect studio`.
- **Under `ph connect studio`:** use the same-origin path `/training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf`. Studio's Vite serves repo paths at the root. HEAD returned 200 and a Range request returned 206. The file is gitignored, so only the dev path serves it; a built package does not contain it.
- **Any other host** needs CORS (`Access-Control-Allow-Origin` for the Connect origin) and Range support. Connect's CSP has no `connect-src` or `default-src`, so CSP allows the fetch.
- The model line says which model is loaded. Anything other than the Round 8 GGUF carries the warning "not measured with this pipeline; expect more wrong proposals". **Base model + R2c was never measured.**

**Confirm and Cancel.** The proposal card shows the readable operation, the target document and its type, the arguments with reference labels, Confirm and Cancel, and "Local model, may be wrong: check before confirming." A dispatch failure shows in red. That error path was covered only by code review; no real failure was triggered.

**Connect end-to-end results** (`ph connect studio`, Round 8 GGUF, one session):

| Check | Result |
|---|---|
| (a) note, Confirm | "tag this note with eventual consistency" → Add topic `"eventual consistency"`, picked from 18 ops. Confirm dispatched; revision history shows `ADD_TOPIC`, no errors. Round 7's base model had cut this span to `"eventual"`. |
| (b) project, with a reference | "the volunteer rota is delivered" → Set deliverable status, the right deliverable, `DELIVERED`, from 16 ops. Dispatched, no errors. |
| (c) question | With no document: answered, no dispatch. On a note: the model chose no change and answered, but vaguely, because the answer path does not see the note. |
| (d) no document | Asked for a document and listed the 5 supported ones. No model load, no dispatch. |
| (e) Cancel | "Cancelled ADD_TOPIC; nothing dispatched." History unchanged. |
| Title in the request | "in Rooftop beehives, …" resolved the target by title; Cancel dispatched nothing. |

| Timing | Value |
|---|---|
| Model load (WebGPU, GGUF from `localhost`, OPFS cache off) | 1,085 ms first load, 683 ms after a reload |
| Send → proposal, model loaded | 377 ms |
| Send → proposal, including the model load | 1,548 ms |

The console showed no CSP violation, and there was no request to Hugging Face or jsdelivr. The 377 ms is one Connect observation; the 443–459 ms medians come from the harness over a full held-out set.

**Checks at v1:** tsc unchanged at the 203-error baseline; `npm test` 455 passed, 6 skipped, excluding the two `kysely-pglite-dialect` suites; oxlint clean on changed files.

**Not in v1:** the answer path is not grounded. It does not see the target document or retrieve vault notes (the `useGraphSearch` TODO in `use-chat-llm.ts` is still open). v1 emits at most one action per message.

## 3. What runs in the browser

| Piece | What | Where it loads from |
|---|---|---|
| LLM runtime | wllama 3.8.1, vendored unmodified in `vendor/wllama/3.8.1/` (JS 382,633 B, wasm 8,763,949 B) | package origin (`'self'`) |
| LLM | `LiquidAI/LFM2.5-350M-GGUF`, Q4_K_M quantization, 229,312,224 B. GGUF is llama.cpp's single-file model format. The fine-tuned GGUF is the same size. | Hugging Face by default; the fine-tune from a configured URL |
| Embeddings | gte-small (384-dimension, q8 ONNX, 34 MB) through onnxruntime-web 1.26.0-dev, also vendored. **Not loaded by the v1 tab**: R2c does not embed the utterance. The harness and the older pipeline still use it. | package origin |
| UI | `chat` tab in `DriveExplorer.tsx`, `ChatView.tsx`, `ChatProposalCard.tsx`, `hooks/use-chat-llm.ts` | — |

**v1 cold download (my arithmetic from the sizes above):** about 238 MB, nearly all of it the GGUF (229 MB + 8.8 MB wllama wasm + 0.4 MB JS). The earlier embedding pipeline needed about 296 MB.

**Earlier measurements (base model):** cold load from Hugging Face with an empty OPFS cache (the browser's origin-private file system) took 9.2–15.2 s, network-bound; warm reload 0.57–0.92 s (Rounds 3, 4, 7). Generation runs at 183–196 tok/s on WebGPU and about 32 tok/s on CPU (Round 1). The CPU figure is single-threaded, because Connect is not cross-origin isolated (no COOP/COEP headers).

Connect's CSP allows scripts only from `'self'`, inline scripts and one registry origin. That is why wllama and onnxruntime-web are vendored (section 8).

## 4. The pipeline (R2c, Round 8 LoRA)

Terms:

- **LoRA:** a small set of trainable low-rank weight matrices added to a frozen base model. Here that is 6.0M parameters (1.66% of the model), merged back into the weights and exported as GGUF.
- **Constrained decoding:** the sampler may only emit tokens that a grammar accepts. GBNF is llama.cpp's grammar format; JSON Schema is compiled to it.

Steps:

1. **Target document.** Resolved as in section 2. Requests are always scoped to that document's model (knowledge-note, project, wbs, and so on).
2. **Step 1, the op choice.**
   - The LoRA sees every global op of that model, in catalog order: 4–19 ops, median 16. Each line is `key: description (fields: …)`.
   - It generates `{"ops": ["<key>"]}` or `{"ops": []}` under a grammar that admits only those answers. `{"ops": []}` means no document change.
   - There is no separate no-action pre-gate and no embedding step; dropping both is part of R2c.
3. **No action → answer path.** The model answers in plain text, without constraints.
4. **Step 2, the arguments.**
   - The op's schema carries the app's canonical vocabularies as enums, for example note types and pipeline phases.
   - A "safe" gate drops optional fields the user did not mention.
   - Reference fields get a `Choices for <field>:` line with human labels. The first required reference is picked by calibrated likelihood, then fixed.
   - The arguments are then generated under a **copy-span grammar**: free-text values must be a contiguous span of the user's words.
5. **The app builds the action.** It maps labels to ids, adds new ids, timestamps and the `{type, input, scope}` envelope, and validates with the generated zod creator. The model never invents ids or dates, which matches the reducer-purity rule.
6. **Proposal card → Confirm → dispatch.** Nothing reaches the reactor without a click.

The prompt bytes ("format r6.1") are pinned by `tests/unit/chat-prompt-format.test.ts`. The training renderer calls the same builders, so training and runtime prompts are byte-identical, and `tests/unit/chat-v1-pipeline.test.ts` checks that the tab's step-1 list and grammar equal the training renderer's for all 12 models.

## 5. How we measured

- **A held-out set** is a set of test requests that nothing was tuned or trained on. Each set (1–4) was written separately from the implementer, by other agents (held-out-4 by the coordinating agent). Each holds 68–104 action requests plus 6–10 no-action requests, split into "natural" phrasing and "paraphrase" (no op-name words).
- **Blind:** before a run, the implementer printed only field names and counts. The results doc lists two exceptions: two utterances seen while checking held-out-1's structure, and one held-out-3 no-action utterance seen after Round 10's training set was fixed.
- **Pre-registration:** configurations, metrics, bars and decision rules were committed before each held-out run. Each config ran once per set, with no reruns unless a run broke (then both outcomes are reported).
- **Dev sets** were written by the implementer and reused heavily; dev numbers are optimistic.
- **Label corrections:** in Round 7, three expected values were changed to the canonical vocabularies, for example `taskType "extract"` → `"claim"`. No set was re-run after the change.

**Limits:**

- **Every test set is model-written.** So is the training data (teacher: `claude-sonnet-5`). None of it is real user traffic.
- **The sets differ in difficulty, so numbers from different sets are not comparable.** Held-out-1 deliberately avoided op words (BM25 keyword recall@5 fell to 63%). Held-out-3 was easier: the same code path scored 83.7% op there, against 57.4% and 73.6% on held-out-1 and -2. Compare rows within one set.
- **Sets were reused.** Held-out-1 and -2 were run again in Round 8 and are retired. Held-out-3 has been run 7 times and held-out-4 twice; only each set's first use is clean.
- **Noise:** with n ≈ 100, differences of 1–3 items are within noise. Two label runs on the same rows agreed only 86.4% exact.

## 6. Results by round

"Op" = right operation over action items. "Fully right" = right op, exact args and refs where scored. Base = stock LFM2.5-350M.

| Round | Set (action n) | Change | Op | Fully right |
|---|---|---|---|---|
| 1 | seed (30) | base, BM25 top 5 + enum-constrained pick | 43.3% | – |
| 2 | seed (30) | written descriptions for all 100 ops; candidate order | 40–63% (BM25 top-1 alone: 73.3%) | – |
| 5 | held-out-1 (68) | calibrated likelihood scoring + BM25 fusion | 32.4% (constrained enum pick: 13.2%) | – |
| 6 | held-out-2 (91) | every scoped op + gte-small: top-1, no LLM (O2) / fused with base LLM (O5) | 47.3% / 44.0% | – / 27.5% |
| 8 | held-out-1 (68) | v1 base (C0) → LoRA step 1 + step 2 (C3 k=5) | 33.8% → 57.4% | 20.6% → 42.6% |
| 8 | held-out-2 (91) | same | 46.2% → 73.6% | 27.5% → 57.1% |
| 9 | held-out-3 (92) | Round 8 LoRA: top 5 + gate (R0) → no gate (R1) → all scoped ops, catalog order (R2c) | 83.7% → 85.9% → 85.9% | 68.5% → 69.6% → 72.8% |
| 9 | held-out-3 (92) | unscoped, top 10 / top 15 over all 99 ops | 37.0% / 39.1% | 31.5% / 32.6% |
| 10 | held-out-4 (104) | R2c: Round 8 LoRA (E8) vs Round 10 retrain (E10) | 80.8% vs 78.8% | 65.4% vs 61.5% |

Args exact, given the right op: R2c on held-out-3 68.4%; E8 on held-out-4 76.4%, E10 78.2%; the Round 8 LoRA with the oracle op 66.0% (held-out-1) and 66.2% (held-out-2).

**Lessons:**

- **Constraints fix form, not choice.** Grammars held (0/20 violations in each of three modes, adversarial prompt, temperature 1.2; args 100% zod-valid), yet the op was right 43% of the time. The copy-span grammar removed every hallucinated extra field (12 items → 0) but cannot pick the right span.
- **Descriptions didn't help.** With candidates held fixed, new op descriptions were net negative (13 → 12 of 30). Candidate *order* mattered more (reversal: 13 → 17 of 30).
- **The base model added nothing over embeddings.** In Round 6, gte-small top-1 (43/91, 40 ms) matched the LLM-fused picks within noise (40–45/91, 1.6–4.6 s).
- **The LoRA roughly doubled fully-correct answers** (20.6% → 42.6%, 27.5% → 57.1%), was the first change to move paraphrases (held-out-2: 12/45 → 25/45), raised refs to about 95% given the right op (base 59–66%), and added about 150 ms.
- **The gate and the full scoped list helped, modestly.** Dropping the no-action pre-gate: +2 op, no-action precision 7/13 → 7/8 at equal recall. Listing every scoped op (R1 → R2c) removed the retrieval ceiling; op was flat, fully right +3 (within noise), for about 60 ms more.
- **A targeted retrain didn't help.** Round 10 added 1,324 rows aimed at Round 9's errors and gave op −2, args +1, fully right −4 vs Round 8 on held-out-4 (7 ops gained, 9 lost: a reshuffle). Both scored 53/73 on sibling-confusion items. Val loss kept falling (0.0126), and Round 8 scored about 93% on teacher-distribution validation rows against 57–86% op on held-out-1 to -4. The results doc reads this as a gap between the teacher's wording and the held-out writers', not a volume problem.
- **Unscoped requests fail:** 26.4% op (base, held-out-2), 37–39% (LoRA, held-out-3), where 31–34 misses were another model's op.
- **Remaining errors** are mostly sibling confusions within one model on paraphrases (e.g. `UPDATE_ORIENTATION` → `UPDATE_DESCRIPTION`, project status → deliverable status), plus args errors in span boundaries, lists, enum values, unnormalized dates, and meant-but-unnamed `owner`/`role`/`assignee` that the safe gate drops.

## 7. The training pipeline

**Teacher:** `claude-sonnet-5` through headless Claude Code (`claude -p` with no tools, MCP, settings or project context, an empty cwd and a replaced system prompt; no API key). `--json-schema` is a tool call, not constrained decoding, so every response is re-checked. Each item gets a wording spec (register, length, an invented name, a two-sided op-word quota of about 60% avoid). The ops that reference existing items (40 in the Round 8 teacher run; the training recipes now cover 44) get a document state built by replaying real creation actions.

**Validation chain** (`training/py/teacher.py`, `training/gen/*.ts`): grounding (arg values must appear in the utterance) → wording spec, ref echo and account-context leak filter → dedup and eval leak (normalized match, trigram Jaccard ≥ 0.5, or containment) → canonical vocabularies, zod, reducer replay and ref post-conditions → a **blind second teacher pass** that labels each utterance without seeing the intended op (only agreeing rows kept) → the r6.1 grammar gate.

**Batch size:** in a 325-items-per-arm comparison, 1, 10 and 25 items per call kept 84.3%, 77.8% and 72.0% at $0.0188, $0.0108 and $0.0096 per kept row. The recommendation is 10 per generation call and 8 per label call; batch 25 loses whole calls.

**Runs** (costs are the CLI-reported `total_cost_usd`, an API-list-price equivalent, not subscription usage):

| Run | Items → kept rows | Teacher time | Cost |
|---|---|---|---|
| Pilot 1 | 100 → 73 | ~206 s | $1.53 |
| Pilot 2 (ref ops) | 150 → 105 | ~284 s | $1.77 |
| Round 8 | 4,035 → 3,286 | 95 min generation + ~24 min labels | $38.30 ($0.0117/row) |
| Round 10 | 1,800 → 1,324 | ~51 min generation + ~8 min labels | $21.22 ($0.016/row) |

*Extrapolation, not measured:* 12,000 items at batch 10 would take about 5.2 h and cost about $100, for about 9.3k kept rows.

**Training:** TRL `SFTTrainer` + PEFT on Apple MPS, bf16, completion-only loss, r 16 / α 32; then merge, llama.cpp convert, the published chat template, Q4_K_M. Round 8: 3 epochs (81.5 min), val loss minimum 0.0143 at epoch 1.8, final 0.0161 (mild overfitting). Round 10: 2 epochs (52.3 min), val minimum = final (0.0126).

**MPS memory:** the first Round 8 attempt on the 36 GB Mac grew to about 44 GB and was stopped; both real runs moved to a second laptop (M4 Max, 64 GB) at a 16 GiB peak. The cause is **not confirmed** (the working theory is per-batch padding creating many tensor shapes). Emptying the MPS cache every step, padding to a multiple of 64 and a memory watchdog kept later runs flat.

## 8. Problems hit and how they were handled

- **Stale monorepo build (Round 3).** Connect rendered blank until the symlinked `../powerhouse` packages were rebuilt; no source changed.
- **CSP blocked the CDN imports (Rounds 3, 4, 7).** Connect's CSP is a `<meta>` from `builder-tools/connect-utils/vite-config.ts`. The fix vendored wllama (Round 4) and onnxruntime-web (Round 7). **Still open:** wllama's compat build (browsers without JSPI or wasm memory64) would still come from jsdelivr; Chrome did not need it.
- **`generateMock` moved upstream** (`180fd3b0`, from git history): the barrel export now throws at runtime, so 21 generated test files changed.
- **Spend limits.** The org's monthly spend limit (HTTP 429) interrupted teacher runs three times. Any 429 now stops `run` with its journal kept. A `--limit 1` probe once deleted a journal, and 18 finished results were re-run (fixed in `422460c1`).
- **Account details leaking through teacher context.** Headless Claude Code injects about 500 tokens of session context, including the logged-in account's email address, that no flag removes. The teacher copied it into 2 of 100 pilot-1 utterances and 2 pilot-2 `author` fields. Prompts now say to invent every name, email and date, and `rows` drops any item containing the account's identifiers; raw results were redacted. 0 occurrences in Rounds 8 and 10. Lesson: treat a teacher's ambient context as leakable and filter outputs, not just prompts.
- **The dedup gap.** Trigram Jaccard missed rows that embedded a whole held-out utterance in a longer message. `dedup.py` now rejects containment (`aeef1d3c`).
- **Smaller ones:** a 203-error pre-existing tsc baseline (so `npm run build` needs `--ignore-type-errors`), no GGUF sha256 recorded in Round 8 (recovered by reproducing dev results exactly), and one harness hang from two runs sharing a wllama instance.

## 9. Next directions

### Split model: verb and target (analysis done, nothing trained)

The question was whether to split the command model into a generic reactor layer plus a document-model layer, or a (verb, target) frame mapped to ops by code. Full report: `notes/in-browser-llm/split-model-evaluation.md`.

- **Frames:** 85 of the 99 ops map cleanly to a (verb, target) frame. 11 of the remaining 14 become regular with "virtual targets" (for example one target per metadata field); 3 need code logic.
- **Error classes,** from 73 pooled op misses across five R2c runs (dev, held-out-3 twice, held-out-4 twice; each set appears twice, about 50 unique missed items):
  - the verb is right on 91–96% of items, the target on only 81–85%;
  - 57 of 73 misses have the wrong target; 38 have the right verb and the wrong target;
  - a perfect verb module could fix at most 28 of 73;
  - 63 of 73 misses are paraphrases.
- **Recommendation:**
  1. keep the split as code architecture, not separate weights: a frame table shipped with the catalog, plus a reusable drive/scope layer trained into the same LoRA (no extra download);
  2. for accuracy now, confirm with alternatives, because the errors are near-misses within a model;
  3. for the next retrain, a target-first frame format with richer target context (current values and labels).

**Experiment 1: top-3 confirm** (pre-registered spec in the note, section 7; no training).

- **Why:** in Round 8's scored runs, the right op was ranked 2nd or 3rd in 16 of 19 misses. That comes from likelihood scoring over top-5 lists on the retired held-out-1/2, not from R2c; no R2c run has per-op scores yet.
- **What:** keep the R2c pick, score every op in the same prompt, and offer the pick plus the 2 best-scored frame neighbours (same verb or same entity) when the pick is not the top score or the margin is below τ = 0.2 (fixed in advance). A simulated user picks the right op if it is offered.
- **Bars (primary config K1):** right op among the offered choices ≥ 92%, ask rate ≤ 30%, and fully right after the simulated pick at least 8 items above the no-ask baseline per 100 action items. The baseline must reproduce E8 on held-out-4 exactly (84/104 op, 68/104 fully right).
- **Cost (estimate):** about half a day of harness code and a ~10-minute run; +0.3–1 s on asked items.
- **It changes the bar:** "right op among the choices, plus how often we ask" in place of 90% one-shot accuracy. That is a team decision.

### Decision models ("Jev", nothing run)

Full notes: `notes/in-browser-llm/decision-model-research.md`. Labels there separate what was checked in source from what was read on model cards.

- **What it is:** Jev is TypeSafe AI's hosted "System One" decision model (released 15 Sep 2026). Given a state and typed questions (choice, score, yes/no), it returns calibrated probabilities over the given options in one forward pass, with no generated tokens. A family of open "Jev-like" models exists, and llama.cpp serves them.
- **In wllama:** 3.8.1 exposes this as `createSystemOne()`. Checked in source and in the shipped wasm, it can load the `openjev`, `lev`, `kev`, `nimble` and `laya` types, which covers Julia-1 (144M, 168 MB), Laya (421M, 449 MB) and Kev-0.8B (812 MB). It cannot load Liquid's d1 models (d1-omni-600M, built on LFM2.5, 407 MB): their support landed in llama.cpp after 3.8.1 shipped, so they need a wllama rebuild (about 1–2 days, estimate) or a second runtime.
- **Fit:** it would replace step 1 (the op choice), with op descriptions as the options, and give per-option probabilities: a principled "ask the user" threshold we lack today. It produces no arguments, so LFM2.5-350M stays for step 2, at roughly +170–450 MB extra download.
- **Limits** (from model cards): zero-shot, expect no better than our 81–86%. Laya's base is near chance on typed decisions zero-shot; Kev-0.8B is weak on paraphrase; Julia-1 handles 2–20 options, and our models have up to 19. Laya-type models also cap the question plus options at 192–256 tokens, about 9–12 tokens per option for 19 ops. A `choice` question returns one op, so multi-op requests need more questions.
- **Fine-tune path:** Kev has the best tooling: `kev.train` from `jaredpalmer/kev-0.8b` on MPS, with our ~3.3k rows mapped one-to-one into its JSONL format. Estimate: one to a few hours on the M4 Max. llama.cpp's converter writes a Kev GGUF; that `kev.train` output matches its expected layout was not checked.
- **Cheapest experiment:** zero-shot, no browser. Run `llama-server` with Julia-1, Laya, Kev-0.8B and d1-omni in turn (about 1.8 GB of downloads), and score held-out rows with a `choice` question over the gold model's ops. Fine-tune Kev only if a model matches R2c's op accuracy or gives useful confidence. Estimate: half a day plus about an hour of compute; a Kev fine-tune and evaluation adds half a day to a day.

### Other directions

- **Real-user phrasing data.** Two training sets (3.3k and 4.6k rows) gave the same blind-set accuracy. Paraphrases written by people, or consented chat logs, would test and train on the real distribution.
- **LFM2.5-1.2B.** Proposed in the exploration plan and Round 1, and **never run.** Worth one eval with the same pipeline, against a latency budget (E10's median was 411 ms).
- **Ground the answer path** in the target document and vault search.

## 10. Recommendation and open questions

**Keep v1 as shipped:** the Round 8 LoRA + R2c (step 1 over every op of the document's model in catalog order, no pre-gate; step 2 with the safe gate and calibrated reference scoring) + Confirm before dispatch, with a document required. Expect, from model-written sets: right op about 81–86%, fully right about 65–73%, natural requests about 92–98% op, paraphrases about 69–75%. Confirm is what makes that acceptable. **Next:** run the top-3 confirm experiment; it is the cheapest test of whether near-misses can be recovered at the confirm step.

**Decisions and open questions:**

1. **Where to host the GGUF.** The Round 8 file (229,312,224 B, sha256 `6930e31e…510e00`) is local and gitignored. Any host needs CORS and Range support (section 2). Until it has one, the tab defaults to the base model.
2. **Base model + R2c was never measured.** The closest data point is Round 8's base-model dev smoke (16/30 op, a different pipeline). The UI warns when any other model is loaded.
3. **Which held-out set for the top-3 experiment.** The spec's primary is a fresh blind held-out-5, written by the coordinator. The fallback is held-out-4, which would be its third use: acceptable because nothing is trained or tuned on it, but it should be stated with the result. Not held-out-3, which has had 7 runs.
4. **What "Jev" means.** The research assumed TypeSafe's hosted API. A hosted call sends the user's request and document state off the device, which breaks the in-browser goal. The open Jev-like models in wllama keep everything local.
5. **Whether to add the `kysely-pglite-dialect` dependency.** It is missing from `node_modules`. The two processor suites that import it (`tests/processor/graph-query.test.ts` and `graph-indexer.test.ts`) cannot resolve it and are the only failing suites; 3 of the 203 tsc errors depend on it.
6. **Real-user phrasing data:** the biggest data lever left (section 9).
7. **The unscoped problem.** A vault-wide command needs either a routing step that works (routing by best embedding hit reached only 36/91 @1) or training rows over mixed-model lists, plus a drive-level eval set. The 37–39% figure comes from sets written for scoped use, so it is not a fair baseline for a router.
8. **Op descriptions in step 1.** Round 10's verdict proposed adding them (a new format, r6.2), but the r6.1 prompt already renders `key: description (fields: …)` per line, so that proposal was inaccurate. The descriptions are thin, and empty for the 30 project and wbs ops; those ops scored 25–26 of 30–34 against 51–58 of 62–70 for the rest, which shows no measurable effect at this n (uncontrolled). Richer target context (current values, UI labels) is the better-founded version of this idea.
9. **oxlint is declared but not installed.** `package.json` pins `oxlint` 1.70.0 and `oxlint-tsgolint` 0.23.0, but neither is in `node_modules/.bin`, so `npm run lint:fix` as documented cannot find the binary. Lint has run from the npx cache instead.
10. **The Q&A check is small:** 15 prompts judged once by the implementer. Round 8 vs base was 4 base-better / 9 same / 2 LoRA-better, a mild regression it cannot rule in or out.
11. **Format gaps:** the safe gate drops meant-but-unnamed `owner`/`role`/`assignee` (relaxing it at inference only invented values); `requireOneOf` clashes with an optional ref (`UPDATE_DELIVERABLE`); dates are not normalized.

## 11. Where things live

| What | Path |
|---|---|
| Plan and full results | `docs/superpowers/specs/2026-10-20-in-browser-llm-exploration.md`, `…-spike-results.md` |
| Research notes | `docs/superpowers/notes/in-browser-llm/` (`split-model-evaluation.md`, `decision-model-research.md`, held-out READMEs, plans) |
| Chat core | `editors/knowledge-vault/chat/core/`: `v1-pipeline.ts`, `target-document.ts`, `ref-candidates.ts`, `step1-candidates.ts`, `llm-client.ts`, `args-step.ts`, `args-grammar.ts`, `vocabularies.ts`, `prompt-format.ts` |
| Chat UI | `editors/knowledge-vault/components/{DriveExplorer,ChatView,ChatProposalCard}.tsx`, `editors/knowledge-vault/hooks/use-chat-llm.ts` |
| Vendored runtimes | `vendor/wllama/3.8.1/`, `vendor/onnxruntime-web/1.26.0-dev.20260416-b7804b056c/` (each with a README of checksums) |
| Harness | `spike/llm-harness/`; per-item results and held-out sets in `spike/llm-harness/eval/` |
| Training | `training/` (the README has every command, including how to reproduce Rounds 8 and 10); summaries in `training/results/`; GGUFs in `training/artifacts/` (gitignored) |
| Tests | `tests/unit/chat-*.test.ts`, `tests/unit/training-prompt-format.test.ts` |

**Scale (at `2991e101`):** 128 commits on the branch; the total diff against `main` is 236 files and about 1.1M insertions, mostly per-item eval JSON.
