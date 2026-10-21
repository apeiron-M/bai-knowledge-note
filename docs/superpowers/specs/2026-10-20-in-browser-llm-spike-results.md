# In-Browser LLM Spike: Results

**Date:** 2026-10-20
**Branch:** `explore/in-browser-llm`
**Plan:** spike plan from the exploration doc (`2026-10-20-in-browser-llm-exploration.md`)

Every number below was observed in one run on the machine described under Environment. Raw per-item data is in `spike/llm-harness/eval/`.

## Summary

- **The runtime works.** LFM2.5-350M Q4_K_M loads in wllama 3.8.1 from jsdelivr and Hugging Face, and streams at about 183–196 tok/s on WebGPU and about 32 tok/s on single-threaded CPU. A warm load (cached in OPFS) takes about 0.55 s.
- **The constraints hold.** There were 0 violations out of 20 in each of the three modes (json_schema, GBNF and op-enum), even with an adversarial prompt at temperature 1.2.
- **ADD_TOPIC works end to end in the harness.** utterance → args → `buildAction` → reducer, with no operation error.
- **Picking the operation is the weak point.** With scoped retrieval (k=5), the model picked the right op 43.3% of the time overall, and 48.1% of the time when the right op was among the candidates. That is far below the 90–95% bar, so **the fine-tune trigger is met** (see Verdict).
- **Round 5 (held-out, 68 items): decoding-time techniques are not enough.** Calibrated likelihood scoring fused with BM25 picks the right op 32.4% of the time scoped (51.2% when the op is in the top 5), against 13.2% for today's enum generation. Retrieval reaches only 63.2% recall@5. Args are 46–48% exact even with the oracle op. A fine-tune is justified, but retrieval, ref-id context and schema enums need fixing too (see Round 5).
- **Round 6 (held-out-2, 91 items): code fixes reach their targets, op choice does not move.** Scoring every op of the scoped model plus gte-small embeddings gives 44–49% scoped op accuracy; gte-small top-1 alone (43/91, 47.3%) matches the LLM-fused pick at 40 ms instead of 1.6 s, so the base model's step-1 call is dropped. Unscoped is 26.4%. Paraphrased requests stay at 10–13/45. Calibrated ref-label scoring doubled ref accuracy (31% → 66%); args exact 43%; the best no-action gate reaches 61.5% precision / 100% recall. The r6.1 prompt format for a LoRA is fixed and test-pinned (see Round 6).
- **Round 7 (cleanup): the Chat tab, the harness and the training renderer share the v1 pipeline (r6.1).** gte-small op vectors are precomputed (bit-identical to the browser), onnxruntime-web and gte-small load from the package origin, and in Connect an action was dispatched and a question was answered with no CSP violation and nothing from jsdelivr (see Round 7).
- **The Chat tab is verified in Connect (round 3).** Two blockers were found and cleared: the monorepo's stale Connect `dist`, and Connect's CSP blocking the wllama CDN import. ADD_TOPIC then dispatched through the in-browser reactor with no errors (see Round 3).

## Environment

| | |
|---|---|
| Browser | Chrome 155.0.0.0 (the chrome-devtools MCP instance), macOS |
| CPU threads (`hardwareConcurrency`) | 14 |
| `crossOriginIsolated` | false, so CPU runs single-threaded (`isMultithread()` false, 1 thread) |
| WebGPU adapter | vendor `apple`, architecture `metal-3`, `shader-f16` yes, maxBufferSize 4294967292 |
| `isSupportWebGPU()` | true |
| libllama | `b11364-46ca246` |
| wllama | 3.8.1 (ESM + wasm from jsdelivr, loaded at runtime; no package.json change) |
| Model | `LiquidAI/LFM2.5-350M-GGUF` / `LFM2.5-350M-Q4_K_M.gguf` |
| `n_ctx` / `n_parallel` | 4096 / 1 |
| `jinja` | false. `jinja: true` gave byte-identical output on the happy path, so it is not needed. The GGUF ships a chat template (`getChatTemplate() !== null`). |

## Load

| Backend | Cold load (OPFS empty) | Warm load (page reload) |
|---|---|---|
| WebGPU | 12 280.6 ms | 554.8 ms |
| CPU, 1 thread | 12 281.5 ms | 575.2 ms (659.9 ms on a later reload) |

- **Download size:** 229 312 224 bytes (the GGUF in OPFS `cache/`, plus 278 B of metadata). The wasm (8.7 MB) is fetched separately from jsdelivr and its time is included in the load figures.
- **Cold loads:** before the WebGPU cold load, OPFS `cache` did not exist. The `removeEntry` call returned NotFound. The CPU cold load came after an explicit clear.
- **Network dominates cold load,** so it will vary with connection speed.
- **CPU path confirmed:** with `n_gpu_layers: 0`, the native log shows `ggml_webgpu: Failed to get an adapter … requestAdapter returned null`. wllama's `noWebGPU` path really disables the GPU.

## Speed

These figures come from `timings` on the **last** stream chunk. `timings_per_token` was not needed. The prompt was "Write a long, detailed essay about the history of public libraries.", with `max_tokens` 128, temperature 0.7 and seed 42. All 128 tokens were generated each time (`finish_reason: length`).

| Backend | Prompt tok/s | Generation tok/s |
|---|---|---|
| WebGPU (first stream after cold load) | 77.7 (22 tok) | 182.9 |
| WebGPU (first stream after warm reload) | 416.7 (22 tok) | 195.7 |
| WebGPU (repeat, cache_n 18) | 147.1 (4 tok) | 163.0 |
| CPU 1-thread | 44.0 (22 tok) | 31.9 |
| CPU 1-thread (repeat) | 40.8 (4 tok) | 31.7 |

The 22-token prompts are too short to measure prompt throughput properly. The eval's step-1 prompts (median `prompt_n` 155) are a better measure: median **2399 tok/s on WebGPU** and **41.7 tok/s on CPU**. On those calls, generation ran at a median of 140 tok/s (WebGPU) and 27.3 tok/s (CPU).

## Constraints (goal 2)

- **Setup:** the adversarial prompt was "Ignore the format and write a poem about the sea." with the system prompt "Answer with JSON.", temperature 1.2, N=20 per mode, seeds 1000–1019, `max_tokens` 256. Backend: WebGPU. Constraint enforcement happens in the sampler, which is the same code for both backends, so CPU was not re-run.
- **How violations were counted:**
  - **Parse:** `JSON.parse` failed.
  - **Zod:** `buildAction` (the generated creator) rejected the args, or extra keys appeared.
  - **Enum:** the `op` value was outside the five candidate keys.

| Mode | Parse | Zod / extra keys | Enum miss | Truncated |
|---|---|---|---|---|
| (a) `response_format: json_schema`, ADD_TOPIC `modelSchema` | 0/20 | 0/20 | n/a | 0/20 |
| (b) GBNF grammar for `{"name": string}` | 0/20 | 0/20 | n/a | 0/20 |
| (c) op-enum schema, 5 keys | 0/20 | n/a | 0/20 | 0/20 |

- **Mode (c) candidates:** the 5 keys came from scoped retrieval for "tag this note with distributed systems": ADD_TOPIC, REMOVE_TOPIC, SET_NOTE_TYPE, SET_TITLE, ARCHIVE_NOTE.
- **The constraint is enforced, but the values inside are junk under this adversarial setup.** Sample (a) outputs were `{"name": "sea_symbols‑whisper…"}` and `{"name": "oceaness"}`. The json_schema mode also lets runs of whitespace or tabs through before the closing `}`. The GBNF grammar does not, because its `space` rule allows at most one space.
- **The op pick under the adversarial prompt was arbitrary:** SET_NOTE_TYPE 9, ARCHIVE_NOTE 7, ADD_TOPIC 2, SET_TITLE 1, REMOVE_TOPIC 1.
- **`json_schema_to_grammar` accepted `anyOf [string, null]` from `.nullish()`.** Eval ops with nullish fields (for example `comment` and `role`) produced valid output, so collapsing nullish to optional (the `collapseNullable` option) was not needed.
- **Raw data:** `spike/llm-harness/eval/constraints-webgpu.json`.

## Happy path (ADD_TOPIC)

The utterance "tag this note with distributed systems" goes through `fillArgs` → `buildAction` → `KnowledgeNote.reducer(utils.createDocument(), action)`.

- **Result: pass.** `operations.global[0].error` is undefined, and `state.global.topics[0].name` is `"distributed_systems"`.
- **The final raw output was `{"name": "distributed_systems"}`,** using the step-2 prompt with an `Arguments: {"name": string}` signature line. The snake_case is the model's choice. The utterance said "distributed systems".
- **The first prompt had no signature line.** It produced `{"name": "distributed_systems_example_1_2_3_4_5" …tabs…}`. That output was still structurally valid and also passed the reducer. Adding the signature line is a deviation from the plan; see Deviations.
- **Raw data:** `spike/llm-harness/eval/happy-path-webgpu.json`. The first-prompt output is in `constraints-webgpu.json` under `happyPath`.

## Retrieval

- **Method:** BM25 over the op name, description, module name and semantic field names. Local-scope ops are excluded. Measured by `tests/unit/chat-retriever.test.ts` on 30 utterances covering 13 ops across 5 models.

| | recall@1 | recall@5 | recall@10 |
|---|---|---|---|
| Scoped to the doc's model | 73.3% | 90.0% | 93.3% |
| Unscoped (99 global ops) | 66.7% | 83.3% | 86.7% |

- **Scoped recall@5 is 90%, which is exactly the bar,** so the retrieval text was left as specified. One more miss would drop it below.
- **Misses outside the scoped top-5:**
  - "label this as epistemology" (rank 12)
  - "describe this note as notes from the Raft paper" (rank 8)
  - "untag this note" (rank 17)
- All three misses are vocabulary gaps (label/tag, describe/description, untag/remove topic).

## Seed eval (goal 3)

- **Setup:** retrieve(k=5) → step 1 (op enum) → step 2 (semantic args under `modelSchema`), temperature 0, run on both backends.
- **How args were scored:**
  - **Args valid:** the selected op's args passed through `buildAction`. App-supplied ids and timestamps were filled in, and dummy values were used for ref-ids.
  - **Exact:** strict equality on every `expectedArgs` field. Scored only when the op was right and `expectedArgs` is given.
  - **Loose:** the same check after lowercasing and treating `_` as a space.

| | WebGPU scoped | WebGPU unscoped | CPU scoped | CPU unscoped |
|---|---|---|---|---|
| Expected op in candidates | 27/30 (90%) | 25/30 (83.3%) | 27/30 | 25/30 |
| **Op accuracy, overall** | **43.3%** (13/30) | 33.3% (10/30) | 43.3% | 33.3% |
| **Op accuracy, conditional on in-candidates** | **48.1%** (13/27) | 40.0% (10/25) | 48.1% | 40.0% |
| Args zod-valid | 100% (30/30) | 100% (30/30) | 100% | 100% |
| Args exact | 44.4% (4/9) | 37.5% (3/8) | 33.3% (3/9) | 37.5% (3/8) |
| Args loose | 66.7% (6/9) | 62.5% (5/8) | 55.6% | 62.5% |
| Step 1 latency, median / p95 | 207 / 364 ms | 347 / 375 ms | 4584 / 5641 ms | 4424 / 5435 ms |
| Step 2 latency, median / p95 | 145 / 271 ms (n=26) | 152 / 451 ms (n=25) | 2528 / 3511 ms (n=26) | 2148 / 3903 ms (n=26) |

- **Ops with no semantic fields skip step 2,** which is why step 2 has fewer than 30 samples.
- **CPU and WebGPU reached the same op-accuracy totals, but not the same per-item results.** The op pick, the args, or both differed on 10 items per mode, because temperature-0 numerics differ between the backends. For example, "label this as epistemology" (scoped) picked SET_TITLE on CPU and SET_NOTE_TYPE on WebGPU.
- **"Args zod-valid 100%" is a weak signal.** The constraints guarantee the shape, zod only checks types, and ref-ids were app-filled.

### Per-utterance outcomes (WebGPU)

"Exact" is `yes` when the args match exactly, `loose` when they match only after normalization, `no` otherwise, and `-` when not scored. The CPU rows are in `results-cpu.json`.

| # | Utterance | Expected | Scoped: in top-5? | Scoped: picked | Scoped: args | Exact | Unscoped: picked |
|---|---|---|---|---|---|---|---|
| 1 | tag this note with distributed systems | ADD_TOPIC | yes | ADD_TOPIC (yes) | `{"name": "distributed_systems"}` | loose | ADD_TOPIC (yes) |
| 2 | add the topic machine learning | ADD_TOPIC | yes | ADD_TOPIC (yes) | `{"name": "machine learning"}` | yes | ADD_TOPIC (yes) |
| 3 | label this as epistemology | ADD_TOPIC | no | SET_NOTE_TYPE (no) | `{"noteType": "epistemology"}` | - | GENERATE_REPORT (no) |
| 4 | file this note under productivity | ADD_TOPIC | yes | SET_NOTE_TYPE (no) | `{"noteType": "set"}` | - | SET_TITLE (no) |
| 5 | rename this note to Spaced repetition beats cramming | SET_TITLE | yes | RESTORE_NOTE (no) | `{"comment": "This note outlines the importance of spaced repetition fo…` | - | SET_TITLE (yes) |
| 6 | set the title to CAP theorem tradeoffs | SET_TITLE | yes | SET_TITLE (yes) | `{"title": "CAP Theorem Tradeoffs"}` | loose | SET_TITLE (yes) |
| 7 | change the heading of the note to Why caches lie | SET_TITLE | yes | UPDATE_LINK_TYPE (no) | `{"linkType": "BUILDS_ON"}` | - | UPDATE_LINK_TYPE (no) |
| 8 | set the description to A short argument for writing every day | SET_DESCRIPTION | yes | SET_DESCRIPTION (yes) | `{"description": "A short argument"}` | no | SET_TITLE (no) |
| 9 | update the summary: explains how consensus protocols tolerate faults | SET_DESCRIPTION | yes | UPDATE_LINK_TYPE (no) | `{"linkType": "BUILDS_ON"}` | - | UPDATE_DESCRIPTION (no) |
| 10 | describe this note as notes from the Raft paper | SET_DESCRIPTION | no | ARCHIVE_NOTE (no) | `{"comment": "This note describes the transition from the Raft paper to…` | - | REMOVE_NOTE (no) |
| 11 | submit this note for review | SUBMIT_FOR_REVIEW | yes | SUBMIT_FOR_REVIEW (yes) | `{"comment": "This is a draft note for review."}` | - | REJECT_NOTE (no) |
| 12 | send it to review, it's ready | SUBMIT_FOR_REVIEW | yes | REJECT_NOTE (no) | `{"comment": "ready"}` | - | REJECT_NOTE (no) |
| 13 | I'm done drafting, request a review | SUBMIT_FOR_REVIEW | yes | REJECT_NOTE (no) | `{"comment": "I'm done drafting, request a review"}` | - | RESTORE_NOTE (no) |
| 14 | remove the topic tag | REMOVE_TOPIC | yes | REMOVE_TOPIC (yes) | `{}` | - | REMOVE_TOPIC (yes) |
| 15 | untag this note | REMOVE_TOPIC | no | RESTORE_NOTE (no) | `{"comment": "Untag this note for future reference."}` | - | SET_TITLE (no) |
| 16 | add an open question: does spacing help procedural memory? | ADD_OPEN_QUESTION | yes | ADD_CHILD_MOC (no) | `{"childRef": "MOC_001"}` | - | ADD_TENSION (no) |
| 17 | note an unexplored direction: how do CRDTs handle deletes | ADD_OPEN_QUESTION | yes | REMOVE_CORE_IDEA (no) | `{}` | - | SET_NOTE_TYPE (no) |
| 18 | rewrite the synthesis paragraph to say memory is reconstructive | UPDATE_ORIENTATION | yes | UPDATE_DESCRIPTION (no) | `{"description": "Memory is a reconstructive process, shaped by persona…` | - | UPDATE_ORIENTATION (yes) |
| 19 | update the orientation of this map | UPDATE_ORIENTATION | yes | UPDATE_ORIENTATION (yes) | `{"orientation": "North"}` | - | UPDATE_ORIENTATION (yes) |
| 20 | queue a new extraction task for the Raft paper | ADD_TASK | yes | UNBLOCK_TASK (no) | `{}` | - | UNBLOCK_TASK (no) |
| 21 | add a task to reflect on the CRDT notes | ADD_TASK | yes | ADD_TASK (yes) | `{"taskType": "reflect", "target": "CRDT_notes", "documentRef": "CRDT_n…` | - | ADD_INVOLVED_REF (no) |
| 22 | mark the task as blocked because the source is missing | BLOCK_TASK | yes | UNBLOCK_TASK (no) | `{}` | - | SET_SOURCE_STATUS (no) |
| 23 | the task is stuck waiting on review, block it | BLOCK_TASK | yes | FAIL_TASK (no) | `{"reason": "task is stuck waiting on review, block it"}` | - | SUBMIT_FOR_REVIEW (no) |
| 24 | add Alice to the team as designer | ADD_MEMBER | yes | ADD_MEMBER (yes) | `{"name": "Alice", "role": "designer", "kind": "AGENT"}` | yes | ADD_OPEN_QUESTION (no) |
| 25 | add a team member named Bob | ADD_MEMBER | yes | ADD_MEMBER (yes) | `{"name": "Bob", "role": "HUMAN", "kind": "HUMAN"}` | yes | ADD_OPEN_QUESTION (no) |
| 26 | put the project on hold | SET_PROJECT_STATUS | yes | SET_OWNER (no) | `{"owner": "null"}` | - | SET_PROJECT_REF (no) |
| 27 | mark the project as completed | SET_PROJECT_STATUS | yes | SET_OWNER (no) | `{"owner": "unknown"}` | - | IMPLEMENT_OBSERVATION (no) |
| 28 | create a goal to write the onboarding guide | CREATE_GOAL | yes | CREATE_GOAL (yes) | `{"description": "Develop a comprehensive onboarding guide to ensure ne…` | no | CREATE_GOAL (yes) |
| 29 | new goal: ship the beta | CREATE_GOAL | yes | CREATE_GOAL (yes) | `{"description": "Ship the beta version of the product", "assignee": "d…` | no | CREATE_GOAL (yes) |
| 30 | set the goal status to in progress | SET_GOAL_STATUS | yes | SET_GOAL_STATUS (yes) | `{"status": "IN_PROGRESS", "outcome": "IN_REVIEW"}` | yes | SET_GOAL_STATUS (yes) |

### Failure patterns

1. **Lifecycle confusion:**
   - "send it to review" picked REJECT_NOTE.
   - "I'm done drafting, request a review" picked REJECT_NOTE (scoped) and RESTORE_NOTE (unscoped).
   - "untag this note" picked RESTORE_NOTE.
2. **Negation and polarity:** "mark the task as blocked…" picked UNBLOCK_TASK.
3. **Field-name pull:** the model picks an op whose field name echoes a word in the request.
   - "put the project on hold" picked SET_OWNER, with `owner: "null"`.
   - "change the heading…" and "update the summary…" picked UPDATE_LINK_TYPE.
   - "add an open question" picked ADD_CHILD_MOC.
4. **Thin op descriptions.**
   - The project and wbs ops have **empty** descriptions in the model, and the rest average about 38 characters.
   - The step-1 prompt therefore sees only `opName` and field names for project and wbs. Even so, those ops did comparatively well in the scoped pass (wbs 3/3, project 2/4).
5. **Arg paraphrase and hallucinated optionals:**
   - Paraphrased values: CREATE_GOAL "Develop a comprehensive onboarding guide…", and SET_DESCRIPTION truncated to "A short argument".
   - Invented optional fields: ADD_MEMBER `kind: "AGENT"` for Alice, and SET_GOAL_STATUS `outcome: "IN_REVIEW"`.

## Chat tab (step 6)

- **What was built:** the `chat` ViewMode and tab in `DriveExplorer`, `ChatView` + `ChatProposalCard`, and `use-chat-llm` (lazy load, one client per page).
  - Command mode: pick a note → retrieve (scoped to `bai/knowledge-note`) → generate → proposal card → Confirm → `dispatchActions(action, noteId)`.
  - REMOVE_TOPIC, REMOVE_LINK and UPDATE_LINK_TYPE get the note's topic and link ids as ref-id enums.
  - Ask mode is a plain unconstrained chat stub with a `useGraphSearch` TODO.
- **Checks:** tsc shows no new errors and lint is clean on the new files.
- **End-to-end check: not done.** `ph connect studio --port 3100` started, but the page rendered blank. The server log shows: `Failed to resolve import "react-router-dom" from "../powerhouse/apps/connect/dist/app-loader-D3o2A9KV.js"`.
  - The symlinked monorepo's `apps/connect/dist` was built on Oct 12. The monorepo source has since moved to `@tanstack/react-router`, and `react-router-dom` is installed nowhere.
  - This is an environment problem that comes before our tab. It is fixed by rebuilding Connect in the monorepo (or running `ph vetra` against a matching build), which needs the user. So ADD_TOPIC dispatch through the real reactor is **not measured**. Only the in-harness reducer path is verified.

## Verdict: fine-tune trigger

**Triggered.** Conditional op accuracy was 48.1% scoped and 40.0% unscoped, against a bar of 90–95%.

The seed set is small (30 items) and was written by hand by the implementer, so treat the number as directional. The gap is too large to be noise.

Before paying for a LoRA, two cheap experiments are worth running. Neither was tried in this spike:

1. Write real op descriptions (project and wbs have none) and add one example utterance per op to the step-1 prompt.
2. Rerun the same eval on LFM2.5-1.2B-Instruct.

The harness can do both without code changes beyond the model id and the descriptions. Argument quality (exact 33–44%) is the second problem, and a fine-tune would address it at the same time.

## Deviations from the plan

1. **Pre-existing errors.**
   - **tsc:** `npm run tsc` is not clean at HEAD. There are 204 pre-existing errors, in the generated `v1/tests/*.test.ts`, in `processors/graph-indexer/factory.ts`, and in tests that import the missing `kysely-pglite-dialect`. "tsc clean" here means zero new errors against that baseline, and none in the new files.
   - **oxlint:** oxlint is not installed in `node_modules`. Lint ran as `npx -p oxlint@1.70.0 -p oxlint-tsgolint@0.23.0 oxlint --type-aware --type-check --fix <new paths>`, which uses only the npx cache and leaves `node_modules` untouched. oxfmt 0.55.0 was also run through npx.
2. **Field classification.**
   - **SET_ ops:** `new-id` covers `ADD_`/`CREATE_` only, not `SET_`. Every `SET_*` op with `id: OID!` (wbs, project) refers to an existing entity, so it is `ref-id`.
   - **Overrides:** the five knowledge-note lifecycle ops' `id` (a new lifecycle event) and wbs `ADD_NOTE.noteId` become `new-id`; wbs `ADD_DEPENDENCIES.id` becomes `ref-id`.
   - **Other types:** `PHID` is a ref-id. `*Ref` String fields stay semantic, as the plan says. This is the same invented-document-id gap as ADD_LINK, so those ops were kept out of the seed set.
   - **Nested inputs** are classified by path (`ADVANCE_PHASE.handoff.*`).
3. **"No semantic fields" count:** 22 ops, not the plan's estimated 15. This count also includes ops whose only fields are timestamps or PHIDs.
4. **Catalog key for WBS:** the model segment is the docType without `bai/`, so WBS ops are keyed `wbs:…`, not `work-breakdown-structure:…`.
5. **Model schemas:** they carry `additionalProperties: false` and a filtered `required`.
6. **Step-2 prompt:** it gained an `Arguments: {…}` signature line after the first happy-path output ran on inside the string. This is the only prompt change, and it was made before the seed eval.
7. **Harness HMR:** HMR is disabled in the harness, because a Vite full reload dropped the loaded model and in-page results once. The constraint run was redone, and the redo is the one recorded.
8. **CPU constraint run:** skipped. See Constraints.

## Open issues

- **Reactor dispatch:** the Chat tab still needs to be checked against a working Connect build (see Chat tab).
- **ADD_LINK:** links are made through the system action `ADD_RELATIONSHIP`, which is not in the catalog, and `*Ref` string fields would let the model invent document ids. Neither is solved.
- **Ref-ids:** these need document state at generation time. The chat tab covers only topic and link ids on the selected note.
- **Prompt-throughput figures are approximate:** wllama prompt caching (`cache_n`) changes `prompt_n` between calls.
- **Packaging:** jsdelivr pinning, self-hosting for COEP, and packaging are unchanged and out of scope.

## Round 2: op descriptions (2026-10-20)

**Question:** does giving every op a real description move op selection on LFM2.5-350M?

**Short answer: no, not by itself.** The description text did not help when the model saw the same five candidates. What moved accuracy was the *order* of the candidates in the step-1 prompt, and even the best configuration is still below a plain "take BM25's top hit" rule.

### What changed

- **Descriptions:** `editors/knowledge-vault/chat/core/op-descriptions.ts` holds a description for all 100 ops, keyed `<model>:<OP>`. Project and wbs had none; the rest averaged about 38 characters. Each one says what the op does to the document, when a user would want it, and what sets it apart from its siblings.
  - **Opt-in:** they are applied with `buildVaultCatalog({ descriptionOverrides: OP_DESCRIPTIONS })`. The default stays the models' own text, because the overrides lowered retrieval recall (below) and did not help selection on the same candidates. `tests/unit/chat-catalog.test.ts` checks that every op has an override and that there are no stray keys.
  - **Not durable:** `<m>.json`, `schema.graphql` and `gen/` were not touched. The durable fix is `SET_OPERATION_DESCRIPTION` on each document model document through reactor-mcp, which was not reachable in this session.
- **Harness:** `evalSeed(backend, scoped, variant, order)`.
  - `variant` controls which text each stage sees:
    - `original`: the models' text everywhere.
    - `override`: the new descriptions for BM25 retrieval and both prompts.
    - `prompt-only`: the original text for retrieval, the new descriptions in the prompts. This keeps the candidate set identical to `original`, so any change comes from the text alone.
  - `order: "reversed"` lists the step-1 candidates with BM25's lowest-ranked hit first and its top hit last.
  - A dev-only `POST /__save` route writes results into `spike/llm-harness/eval/`.
- **Step-1 prompt:** it already included each candidate's description, so the "add the description text to step 1" run was not needed as a separate experiment. `prompt-only` is the closest equivalent. Note that the step-2 prompt also renders the op's description, so a variant can change the args as well as the op choice.

### How the descriptions were written

- **Sources used:** each op's name, its input SDL, and its reducer in `document-models/<m>/v1/src/reducers/`. Nothing else.
- **What I had seen beforehand:** the 30 eval utterances appear in the round-1 per-utterance table above, so I had read them before writing.
- **What I did about it:**
  - I did not open `seed-utterances.json` while writing.
  - I then removed any wording that matched a round-1 failure utterance unless the schema or an enum backed it: "heading", "label", "file under", "untag", "finished drafting", "on hold" in BLOCK_TASK, and the example task types "extract"/"reflect". "On hold" stayed in SET_PROJECT_STATUS because `ON_HOLD` is an enum value.
- **Ordering:** the descriptions were committed (`2181d4d1`) before any eval was run.

### Setup

- **Configuration:** identical to round 1. Same 30-item seed set, k=5, scoped and unscoped, WebGPU, temperature 0, same model and wllama/libllama versions. CPU was not rerun.
- **Baseline reproduced:** the same-session `original` runs matched round 1 item for item, op and args, on 30/30 items in both modes. After a page reload, a rerun of scoped `original` gave the same summary metrics again. The before/after comparison is therefore like for like.
- **Raw data:** `spike/llm-harness/eval/`:
  - `results-webgpu-r2-original.json`
  - `results-webgpu-r2-override.json`
  - `results-webgpu-r2-prompt-only.json`
  - `results-webgpu-r2-reversed.json`

### Retrieval

BM25 recall on the seed set, from `tests/unit/chat-retriever.test.ts`:

| Retrieval text | Scoped r@1 / r@5 / r@10 | Unscoped r@1 / r@5 / r@10 |
|---|---|---|
| Models' own (round 1) | 73.3 / **90.0** / 93.3 | 66.7 / 83.3 / 86.7 |
| Overrides | 66.7 / **86.7** / 90.0 | 66.7 / 80.0 / 80.0 |

- **Why it dropped:** the longer descriptions dilute BM25. "change the heading of the note to Why caches lie" fell out of the scoped top 5 (rank 12), and "tag this note…", "send it to review…" and "add a team member named Bob" fell from rank 1 to rank 2. Unscoped, "file this note under productivity" fell out of the top 5.
- **Effect on the gate:** with the overrides, scoped recall@5 is below the 90% gate. That is the second reason they are opt-in.

### Seed eval, WebGPU

- **Rank order:** BM25's top hit is listed first (the round-1 layout).
- **Reversed:** the top hit is listed last.
- **"BM25 top-1":** no LLM at all; the action is BM25's rank-1 op. The n for args exact changes from row to row, because args are scored only when the op is right.

**Scoped (the doc's model only):**

| Configuration | Recall@5 | Op overall | Op given in-candidates | Args exact | Args loose | Step 1 median / p95 |
|---|---|---|---|---|---|---|
| original, rank order (= round 1) | 90.0% | 43.3% (13/30) | 48.1% (13/27) | 44.4% (4/9) | 66.7% | 202 / 367 ms |
| override, rank order | 86.7% | 50.0% (15/30) | 57.7% (15/26) | 44.4% (4/9) | 66.7% | 209 / 394 ms |
| prompt-only, rank order | 90.0% | 40.0% (12/30) | 44.4% (12/27) | 37.5% (3/8) | 62.5% | 209 / 396 ms |
| original, reversed | 90.0% | 56.7% (17/30) | 63.0% (17/27) | 45.5% (5/11) | 63.6% | 215 / 377 ms |
| override, reversed | 86.7% | **63.3%** (19/30) | **73.1%** (19/26) | 50.0% (6/12) | 66.7% | 256 / 419 ms |
| BM25 top-1, original text | n/a | **73.3%** (22/30) | n/a | n/a | n/a | n/a |
| BM25 top-1, override text | n/a | 66.7% (20/30) | n/a | n/a | n/a | n/a |

**Unscoped (all 99 global ops):**

| Configuration | Recall@5 | Op overall | Op given in-candidates | Args exact | Args loose | Step 1 median / p95 |
|---|---|---|---|---|---|---|
| original, rank order (= round 1) | 83.3% | 33.3% (10/30) | 40.0% (10/25) | 37.5% (3/8) | 62.5% | 324 / 372 ms |
| override, rank order | 80.0% | 40.0% (12/30) | 50.0% (12/24) | 28.6% (2/7) | 57.1% | 311 / 434 ms |
| prompt-only, rank order | 83.3% | 30.0% (9/30) | 36.0% (9/25) | 50.0% (3/6) | 50.0% | 267 / 407 ms |
| original, reversed | 83.3% | 40.0% (12/30) | 48.0% (12/25) | 12.5% (1/8) | 50.0% | 220 / 439 ms |
| override, reversed | 80.0% | 50.0% (15/30) | 62.5% (15/24) | 44.4% (4/9) | 66.7% | 317 / 494 ms |
| BM25 top-1 (either text) | n/a | 66.7% (20/30) | n/a | n/a | n/a | n/a |

- **Args valid:** zod-valid stayed at 100% in every run.
- **Latency:** the step-1 median barely moved even though the prompt now carries more description text.

### Per-item flips (op correct ↔ incorrect, rank order, against `original`)

**override, scoped (+4 / −2, plus one item lost from the candidates):**
- Gains:
  - #4 "file this note under productivity": SET_NOTE_TYPE → ADD_TOPIC
  - #12 "send it to review, it's ready": REJECT_NOTE → SUBMIT_FOR_REVIEW
  - #16 "add an open question…": ADD_CHILD_MOC → ADD_OPEN_QUESTION
  - #20 "queue a new extraction task…": UNBLOCK_TASK → ADD_TASK
- Losses:
  - #28 "create a goal…": CREATE_GOAL → UPDATE_GOAL_DESCRIPTION
  - #29 "new goal: ship the beta": CREATE_GOAL → UPDATE_GOAL_DESCRIPTION
- Already wrong, now also out of the candidates: #7 "change the heading…" (UPDATE_LINK_TYPE → REJECT_NOTE).

**override, unscoped (+5 / −3):**
- Gains: #11 and #12 (→ SUBMIT_FOR_REVIEW), #16 (→ ADD_OPEN_QUESTION), #20 (→ ADD_TASK), #24 "add Alice to the team…" (→ ADD_MEMBER).
- Losses:
  - #5 "rename this note…": SET_TITLE → SET_NOTE_TYPE
  - #28 and #29: CREATE_GOAL → UPDATE_GOAL_DESCRIPTION

**prompt-only (same candidates as original, so the text is the only change):**
- Scoped, +1 / −2:
  - Gain: #16.
  - Losses: #28 and #29.
- Unscoped, +2 / −3:
  - Gains: #8 (→ SET_DESCRIPTION) and #11 (→ SUBMIT_FOR_REVIEW).
  - Losses: #1 "tag this note…" (→ REMOVE_TOPIC), #28 and #29.

### Reading the per-item data

1. **Most override gains come from a different candidate set, not from the text.**
   - #4: SET_TITLE left the top 5.
   - #12: SUBMIT_FOR_REVIEW and REJECT_NOTE swapped positions.
   - #20: UNBLOCK_TASK left the top 5.
   - With the candidates held fixed (`prompt-only`), the same descriptions came out net negative in both modes.
2. **The model is strongly order-sensitive.**
   - Reversing the candidate list, with nothing else changed, took scoped `original` from 13/30 to 17/30.
   - Under reversal it chose the last-listed op (BM25's top hit) 12 to 17 times out of 30, across the four reversed runs. In rank order it chose that same op, then listed first, 9 to 14 times, across the six rank-order runs.
   - Flips under reversal follow position, not meaning:
     - Gains: "mark the task as blocked" now gives BLOCK_TASK, and "mark the project as completed" now gives SET_PROJECT_STATUS.
     - Losses: "tag this note…" and "add the topic machine learning" now give REMOVE_TOPIC.
3. **Field-name pull outweighs description text.**
   - The only effect that can be pinned on the text is CREATE_GOAL → UPDATE_GOAL_DESCRIPTION (#28, #29). It appears in both override and prompt-only. CREATE_GOAL's only semantic field is `description`, and the sibling's name now sits next to a description that talks about rewording a goal.
   - In rank order, "put the project on hold" still picked SET_OWNER, even though SET_PROJECT_STATUS's description now names "on hold" explicitly.
4. **The args move with the variant too,** because the step-2 prompt renders `entry.description`.
   - ADD_MEMBER "add Alice to the team as designer" went from exact (`role: "designer"`) to wrong (`role: "HUMAN"`, `kind: "AGENT"`) under override.
   - Unscoped original-reversed exact fell to 1/8.
   - The args-exact sample is 6–12 items, which is too small to read a trend from.
5. **No LLM configuration beat BM25's own top-1.**
   - BM25's rank-1 op is correct for 22/30 scoped (73.3%) and 20/30 unscoped (66.7%).
   - The best LLM configuration (override, reversed) reached 19/30 scoped and 15/30 unscoped.
   - That best figure was chosen after trying five LLM configurations (ten runs) on the same 30 items, so it is optimistic.

### Verdict after round 2

- **Descriptions alone:** they do not close the gap. The fine-tune trigger still stands.
- **What step 1 must beat:** the honest baseline for any step-1 change is now "BM25 top-1", at 73.3% scoped, not round 1's 43.3%.
- **What I'd try next, cheapest first:**
  1. Use BM25 top-1 when its score margin over rank 2 is large, and call the LLM only for near-ties.
  2. Randomize or score each candidate independently, for example by comparing per-candidate log-likelihood, so that list position stops driving the pick.
  3. Run the same harness on LFM2.5-1.2B-Instruct.
  4. Fine-tune.
- **Before tuning on this seed set again:** a held-out utterance set is needed. Fifteen LLM runs have now been made against these same 30 items: four in round 1 (WebGPU and CPU), and eleven in round 2 (including the reload check).

## Round 3: Connect end-to-end (2026-10-20)

Goal: load the model in the Chat tab inside a real Connect and dispatch ADD_TOPIC to a real knowledge-note document through the reactor.

### Blocker 1: stale monorepo build

- `node_modules/@powerhousedao/*` and `document-model` are symlinks into the local monorepo at `../powerhouse` (HEAD `b16bae3c7e`, branch `main`, `git status --short` empty before and after).
- Connect's source no longer references `react-router-dom`. It uses `@tanstack/react-router`, which is installed. The `dist` was simply stale. Every linked package's `dist` dated from Oct 12–13 (reactor from Oct 19), while sources had commits through Oct 19.
- The monorepo's install (`node_modules/.modules.yaml`, Oct 19 09:45 CDT) postdates the last `pnpm-lock.yaml` commit, so no `pnpm install` was run.
- Rebuilt with `pnpm --filter "@powerhousedao/connect..." --filter "@powerhousedao/ph-cli..." run build`: 35 package builds, exit 0, 20.6 s wall. Afterwards `apps/connect/dist` has no `react-router-dom` import, and the monorepo's `git status --short` is still empty. The build outputs are git-ignored.
- `npm run tsc` here still reports 204 errors against the rebuilt `.d.ts` files, the same as before.

### Blocker 2: Connect's CSP

- After the rebuild, `ph-cli connect studio --port 3100` rendered Connect. A drive was created with the KnowledgeVault app, a knowledge note was created, and the Chat tab rendered.
- The first send failed with `Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js`.
- Console: `Loading the script '…/esm/index.js' violates the following Content Security Policy directive: "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://registry.vetra.io"`.
- The CSP is a `<meta>` built in `packages/builder-tools/connect-utils/vite-config.ts`: `script-src 'self' 'unsafe-inline' 'unsafe-eval'[ <packageRegistryUrl>]; worker-src 'self' blob:; object-src 'none'; base-uri 'self';`. Its only configurable slot is the single `packageRegistryUrl` origin. `connect-src` is unset, so a plain `fetch` of the same URL returned 200 (382 633 bytes).
- **Fix (spike-grade, commit `e20f698b`):** `importWllama` now falls back to fetching the bundle and running it as an inline `<script type="module">`, which `'unsafe-inline'` allows. The bundle's single trailing `export { … }` is rewritten into a callback. A rejected import is no longer cached. The wllama worker (blob URL) and wasm compile ran without further CSP errors.
- **Production fix (needs a dependency change):** add `@wllama/wllama` as a package dependency so it is served from `'self'`. The other option is a Connect CSP that admits the CDN.

### Result

| | Cold (OPFS empty for `localhost:3100`) | Warm (after reload) |
|---|---|---|
| `loadMs` (client timer, shown in the status label since `bd46a8cf`) | 15 167 ms | 570 ms |
| Send → "Model ready" (DOM observer) | 15 180 ms | 582 ms |
| "Model ready" → proposal card (retrieve + generate) | 444 ms | 454 ms |
| Backend | webgpu | webgpu |

- Environment: `crossOriginIsolated` false, `navigator.gpu` present. After the cold load, OPFS `cache/` held the GGUF (229 312 224 bytes) plus 278 B of metadata.
- **Utterance:** "tag this note with distributed systems", with the target note "CRDT merge semantics" (no topics before).
- **Proposed action:** ADD_TOPIC `{"name": "distributed_systems", "id": "3fed44eb-9cff-4925-a2ae-e84927c47f16"}`. The name came back in snake_case rather than "distributed systems".
- **Dispatch:** after Confirm, the tab reported `Dispatched ADD_TOPIC to "CRDT merge semantics".`
  - The note's own editor showed the topic chip `distributed_systems`.
  - Revision history showed revision 1, `ADD_TOPIC`, "1/1 signature verified", "No errors".
- **Second utterance (warm):** "add the topic consensus" gave ADD_TOPIC `{"name": "consensus", …}`. It was discarded, not dispatched.

### Console

- **Expected:** one CSP violation per page load, from the first `import()` attempt before the fallback. There were no worker, wasm or cross-origin errors.
- **Unrelated to chat:**
  - `net::ERR_CONNECTION_REFUSED` with `[useGraphSearch]` / `[useGraphMetadata] Fetch failed`. These are the vault's subgraph requests to `http://localhost:4001`, where no Switchboard was running.
  - One Chrome issue: "A form field element should have an id or name attribute" (count 4).

## Round 4: vendored wllama (2026-10-20)

Goal: serve wllama from the package's own origin instead of jsdelivr, and drop the round 3 inline-module workaround.

### What changed

- `vendor/wllama/3.8.1/` (commit `bdf5e60c`) holds unmodified files from the npm tarball. Its shasum `e0353359…` matches `npm view @wllama/wllama@3.8.1 dist.shasum`.
  - `wllama.js`, 382 633 bytes, from `package/esm/index.js`. It was renamed so the chunk is named `wllama-<hash>.js`.
  - `wllama.wasm`, 8 763 949 bytes.
  - `LICENCE` (MIT).
  - A README with the sha256 of each file, plus a hand-written `wllama.d.ts` (`export declare const Wllama: unknown`).
  - `vendor/**` is excluded from oxlint and oxfmt.
- `llm-client.ts` (commit `e9e29ada`):
  - `importWllama()` is a relative `import("../../../../vendor/wllama/3.8.1/wllama.js")`.
  - The wasm path passed to `new Wllama({ default })` is `new URL("../../../../vendor/wllama/3.8.1/wllama.wasm", import.meta.url).href`.
  - `WLLAMA_ESM_URL`, `WLLAMA_WASM_URL` and the inline-script fallback are removed. No jsdelivr opt-in was kept, because the harness loads the vendored files too (see below).
- Not vendored: `@wllama/wllama-compat`, which is 16 180 363 bytes unpacked. The `Wllama` constructor still calls `setCompat('default')`. In a browser where `needCompat()` is true (no JSPI or no wasm memory64), wllama fetches the compat worker JS and wasm from `cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.8.1/`. This was not exercised; Chrome did not log wllama's compat-mode warning.

### Checks

- `npm run tsc`: 204 errors, the same count as before.
- oxlint (`--type-aware --type-check`, project config) on `llm-client.ts`: exit 0, no diagnostics. With `-D all` the same command reports diagnostics on the file, which shows it is linted.
- `tests/unit/chat-*.test.ts`: 3 files, 19 tests passed.

### Build

- `npm run build` (stdin `/dev/null`): exit 1. It stopped after tsc with `✘ tsc reported the type errors above. … --ignore-type-errors skips this check`, before the bundler ran. Both blockers predate this round: this gate and the `copy-runtime-assets.mjs` failure below.
- `npx ph-cli build --ignore-type-errors`: exit 0. The listings below come from this build.
- `dist/browser/wllama-D2PxRQAA.js`: 368 997 bytes, plus a 444 148-byte `.map`.
- `dist/browser/assets/wllama-DrYkKwf9.wasm`: 8 763 949 bytes, the same size as the vendored file.
- `dist/browser/editor-D3wdL8OZ.js` holds the wasm reference as `new URL("assets/wllama-DrYkKwf9.wasm", import.meta.url)` and imports `wllama-D2PxRQAA.js`.
- The only `cdn.jsdelivr` strings in `dist/browser/**/*.js` are the two compat URLs inside the wllama chunk.
- `dist/node/wllama-D2PxRQAA.mjs` is also emitted. The node build does not set `resolveNewUrlToAsset`, so its wasm `new URL` keeps the source-relative path. That URL is only computed when a model loads, which is browser-only.
- `node scripts/copy-runtime-assets.mjs` failed at step 2 with `cannot locate onnxruntime-web/dist`. `onnxruntime-web` is at neither candidate path in this pnpm-linked `node_modules`. This is unrelated to wllama.
  - Because of that failure, step 3 (the `ort-wasm-*` strip) did not run. Its glob does not match `wllama-*`.
  - This build emitted no `ort-wasm-*` asset into `dist/browser/assets`.

### Connect (`ph-cli connect studio --port 3100`)

- Studio serves the package from source through Vite. Requests went to `.ts` URLs such as `/editors/knowledge-vault/chat/core/op-catalog.ts`. This run tested the Vite path. It did not test `dist/browser`.
- The page's CSP meta was the same as in round 3: `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://registry.vetra.io; worker-src 'self' blob:; …`.
- wllama requests:
  - `GET http://localhost:3100/vendor/wllama/3.8.1/wllama.js` [200]
  - `GET blob:http://localhost:3100/…` [200] (the wllama worker)
  - `GET http://localhost:3100/vendor/wllama/3.8.1/wllama.wasm` [200]
- No request went to `cdn.jsdelivr.net`.
- The console had no CSP violation and no wllama warnings. Its only errors and warnings were the round 3 ones: `localhost:4001` connection refusals with the `[useGraphSearch]` / `[useGraphMetadata]` warnings, and the form-field id/name issue (count 4).
- Load: the status read "Model ready (webgpu, 844 ms)". The GGUF was already in OPFS from round 3.
- **Utterance:** "add the topic replication", with the target note "CRDT merge semantics".
- **Proposed action:** ADD_TOPIC `{"name": "add_topic_replication", "id": "33d7751f-97c0-45f6-a149-98a64f55a10c"}`. The name included the words of the instruction.
- **Dispatch:** after Confirm, the tab reported `Dispatched ADD_TOPIC to "CRDT merge semantics".`

### Harness (`spike/llm-harness`, port 5199)

- "load webgpu" completed: `loadMs` 703.9, `libllamaVersion` b11364-46ca246, `webgpu` true.
- wllama requests:
  - `/@fs/…/bai-knowledge-note/vendor/wllama/3.8.1/wllama.js` [200]
  - a `blob:http://localhost:5199/…` worker [200]
  - `/@fs/…/vendor/wllama/3.8.1/wllama.wasm` [200]
- No request went to `cdn.jsdelivr.net`.

## Round 5: scoring & constrained content (held-out) (2026-10-20)

**Question:** can decoding-time techniques (likelihood scoring, calibration, order averaging, readable labels, BM25 fusion, copy-span args) get LFM2.5-350M to the 90–95% bar on a fresh held-out set, or is a LoRA fine-tune needed?

### What was built

- `llm-client.ts`: `scoreText(messages, grammar)`, a non-streaming greedy completion with `logprobs: true` (llama.cpp `n_probs`). `wllama-types.ts` gained the non-streaming request/response types.
- `op-scorer.ts`: forces each candidate's answer `{"op": "<label>"}` with a one-literal GBNF grammar and sums its token logprobs; content-free calibration (`N/A`), rotation averaging, readable labels, a "none" pseudo-candidate, and `fuse` (LLM score + λ × BM25 / max BM25).
- `args-grammar.ts`: per-request GBNF for args. Free-text strings must be a contiguous word span of the utterance (original casing; the first word may drop leading quotes, the last may drop trailing quotes or punctuation); optional fields the utterance does not mention are dropped; ref-id fields are an enum of candidate labels, mapped back to ids.
- Harness: `spike/llm-harness/r5.ts` (`r5Ops`, `r5Args`, `probeLogprobs`). Every op-scoring method comes from the same forced-literal requests of one pass, so S1/S2/S3/H1 differ only in arithmetic; each method's latency is the summed wall time of the requests it needs.
- Tests: `tests/unit/chat-scorer.test.ts`, `tests/unit/chat-args-grammar.test.ts`, and a test-only GBNF recognizer (`tests/unit/gbnf-recognizer.ts`) so grammar tests assert accept/reject.
- Held-out set: `spike/llm-harness/eval/heldout-eval.json`, committed unchanged (`35bf2b70`, sha256 `e71ce178…`). Its own validator reported 0 errors and every item passed the generated zod input schemas.

### Logprob probe (dev utterance "tag this note with distributed systems", WebGPU)

- **Pre-grammar, confirmed.** Under a single-literal grammar the forced tokens have negative logprobs, and each position's `top_logprobs` lists tokens the grammar forbids (e.g. "```" at −0.02 when `{"` is forced at −4.86).
- **Forcing the greedy text reproduces the greedy logprobs** token for token (24/24 identical).
- **Deterministic.** The shared prefix `{"op": "knowledge-note:` has identical per-token logprobs across all five candidates, and re-scoring a candidate gives identical numbers.
- **EOS is reported** as an empty-text token at the end (e.g. −0.003). It is included in every score.
- **The prompt KV is reused:** forced requests after the first show `cache_n` 147, `prompt_n` 4, and take 123–160 ms for 17–18 forced tokens.
- **Assistant prefill was tried and dropped.** Putting `{"op": "` in an assistant prefill saved about 30 ms per request but changed the scores at the token boundary (the label's first token became `k` at −19.0 instead of `know`, and `}` moved by about 3 nats).
- **Surface-form noise is large.** After `knowledge-note:ADD_TOPIC` the closing `"` costs −4.98 (the model expects `:` as in the list lines), against −0.30 after `REMOVE_TOPIC`. Raw sums therefore pick REMOVE_TOPIC here, which is the case calibration is meant to fix.

### Development on the dev (seed) set

All choices below were made on the 30-item seed set only (now used about 25 times; treat every dev number as optimistic). WebGPU, k=5, models' own descriptions.

| Dev, op correct /30 | Scoped key | Unscoped key | Scoped readable | Unscoped readable |
|---|---|---|---|---|
| B0 BM25 top-1 | 22 | 20 | 22 | 20 |
| B1 enum (reproduces round 1) | 13 | 10 | – | – |
| S1 raw, sum / mean | 7 / 5 | 6 / 4 | 10 / 6 | 4 / 4 |
| S2 calibrated, sum / mean | 18 / 18 | 13 / 11 | 11 / 12 | 10 / 10 |
| S3 calibrated, 3 rotations, sum / mean | 23 / 23 | 17 / 19 | 14 / 16 | 10 / 13 |
| H1 = S3-mean + 5 × BM25 | 23 | 22 | 22 | 20 |

- **Aggregate:** sum and mean are within 2 items everywhere; mean is better on S3 and on the fusion grid, so **mean** is primary. Sum is reported too, from the same requests.
- **Labels:** readable labels (`add topic`) were worse than catalog keys in every S2 and S3 cell (by 4–10 items). They were better only for raw S1 scoped (10 vs 7). S4 is run on held-out because it is pre-registered.
- **λ grid** {0, 0.5, 1, 2, 3, 5, 8, 13, 20, ∞} for S2/S3 × sum/mean × key/readable, scored on scoped + unscoped (60 items). The best was S3-mean-key at λ = 5 (23 + 22 = 45/60), against 42/60 for BM25 alone (λ = ∞). That is a 3-item margin picked from 40 grid points.
- **None candidate (dev, scoped, H1):** 0/30 action items were sent to "none"; op accuracy 22/30.
- **Args (dev, oracle op, 21 items with expected args):** A0 5/21 exact; A1 with no gating 11/21, gating enum/boolean fields only 12/21, gating every optional field 15/21. Gating every optional field is pre-registered.

### Pre-registration (written and committed before any held-out run)

Each configuration runs **once** on the held-out set, WebGPU, temperature 0, BM25 k=5 over the models' own descriptions, scoped (the item's `context.docType`) and unscoped unless noted.

| # | Config | Definition |
|---|---|---|
| 1 | B0 | BM25 rank-1 op. |
| 2 | B1 | Round-1 `selectOp` (json_schema enum over the 5 keys), rank order. |
| 3 | S1 | Forced-literal likelihood, catalog-key labels, rank order, **mean** token logprob (sum also reported). |
| 4 | S2 | S1 minus the same option's score under the content-free input `N/A`. |
| 5 | S3 | S2 averaged over 3 rotations of the list (offsets 0, 2, 3). |
| 6 | S4 | S3 with readable labels (op name in words; `(model)` appended on duplicates) in the list and the forced answer. |
| 7 | H1 | S3 (mean, key labels) + **λ = 5** × BM25 / max BM25 over the candidates. |
| 8 | None | Run 7 with a "none (no document change)" option appended to the list (BM25 term 0). Scoped: all 68 action items (false-positive rate) and the 6 `noAction` items. Unscoped: the 6 `noAction` items. S3-with-none is reported from the same requests. |
| 9 | A0 | Round-1 `fillArgs` (json_schema; ref-id fields as an enum of candidate ids). |
| 10 | A1 | Copy-span GBNF + drop every optional field not mentioned (field-name token or a full enum value) + ref-id fields as an enum of candidate labels mapped back to ids. |

- **N1 (native tool-call format):** not tested.
- **Args are scored with the oracle op** on all 68 items, so they do not depend on op selection. The subset where H1 scoped picked the right op is also reported.
- **Args exact** = every `expected.args` field matches under its `argMatch` comparator, **and** no non-empty semantic field appears outside `args`, `ambiguousArgs` and the ref paths (the README's "omitted or null" rule). "Fields match" (without the extras rule), `requiredPresent`, ref-id exact and zod validity are reported separately.
- **Latency:** median and p90 per utterance, summed over the requests each method needs.
- **Disclosure:** while checking the file structure I saw the utterances of kn-01 and kn-02 and the `refCandidates` of kn-08. I read no other held-out item before these runs.
- **If a run breaks** (for example, a grammar llama.cpp rejects), the bug is fixed, both numbers are reported, and nothing else changes.

### Held-out results

All ten pre-registered configurations ran once (WebGPU, one session, no errors, no reruns). Raw per-item data:

- Op selection: `spike/llm-harness/eval/results-r5-heldout-ops-{scoped,unscoped}-{key,readable}.json`
- The "none" run: `results-r5-heldout-ops-scoped-key-none.json` and `results-r5-noaction-ops-{scoped,unscoped}-key-none.json`
- Args: `results-r5-heldout-args-A0.json` and `results-r5-heldout-args-A1.json`
- Dev reference runs: `results-r5-dev-*.json`

**Item errors:** none found, none excluded. Three args items, kn-02, kn-03 and moc-03, fail exact match only because the expected value keeps the utterance's trailing period and both A0 and A1 drop it. They are kept and scored as misses.

#### Op selection, scoped (the document's model)

Held-out n = 68, recall@5 = 63.2% (43/68). Dev n = 30, recall@5 = 90.0%. Primary aggregate is mean; sum is in brackets.

| Config | Held-out overall | Held-out given in top-5 (n=43) | Dev overall | Held-out latency median / p90 |
|---|---|---|---|---|
| B0 BM25 top-1 | 13 (19.1%) | 30.2% | 22 (73.3%) | 0 ms |
| B1 enum (current) | 9 (13.2%) | 20.9% | 13 (43.3%) | 332 / 376 ms |
| S1 likelihood | 7 (10.3%) [sum 12] | 16.3% | 5 [7] | 610 / 766 ms |
| S2 + calibration | 16 (23.5%) [15] | 37.2% | 18 [18] | 1 258 / 1 622 ms |
| S3 + 3 rotations | 17 (25.0%) [17] | 39.5% | 23 [23] | 3 923 / 4 923 ms |
| S4 = S3, readable labels | 20 (29.4%) [18] | 46.5% | 16 [14] | 2 851 / 3 036 ms |
| **H1 = S3 + 5 × BM25** | **22 (32.4%)** | **51.2%** | 23 (76.7%) | 3 923 / 4 923 ms |
| H1 + "none" option | 18 (26.5%) | 41.9% | 22 | 4 244 / 4 835 ms |

#### Op selection, unscoped (all 99 global ops)

Held-out recall@5 = 13.2% (9/68). Dev recall@5 = 83.3%.

| Config | Held-out overall | Given in top-5 (n=9) | Dev overall | Latency median / p90 |
|---|---|---|---|---|
| B0 | 4 (5.9%) | 44.4% | 20 (66.7%) | 0 ms |
| B1 | 5 (7.4%) | 55.6% | 10 (33.3%) | 339 / 386 ms |
| S1 | 2 (2.9%) [2] | 22.2% | 4 [6] | 668 / 851 ms |
| S2 | 2 (2.9%) [3] | 22.2% | 11 [13] | 1 409 / 1 694 ms |
| S3 | 3 (4.4%) [3] | 33.3% | 19 [17] | 4 307 / 4 885 ms |
| S4 | 2 (2.9%) [3] | 22.2% | 13 [10] | 2 960 / 3 107 ms |
| H1 | 6 (8.8%) | 66.7% | 22 (73.3%) | 4 307 / 4 885 ms |

Latency is the sum of wall time over the requests each method needs, for one utterance (B0 runs no model). S3 and H1 make 30 forced requests per utterance (5 options × 3 orders × utterance and `N/A`), at about 130 ms each. S4's forced answers are shorter, which makes it about 1 s faster.

#### Why retrieval collapsed

- **Scoped:** on 51 of 68 held-out items, every scoped op scores 0 in BM25. On dev that happened for 1 of 30 items.
  - The candidate list is then simply the model's first five ops in catalog order, and B0 is the first op (SET_TITLE, CREATE_PROJECT, CREATE_GOAL, …).
  - 30 of the 43 "in top-5" items are there by this catalog-order accident.
  - On those 51 items the H1 BM25 term is 0, so H1 is S3 there.
- **Unscoped:** 22 items score 0 on every op.
- **Cause:** the held-out writer kept the op name's words out of every utterance, and the models' own descriptions are thin. Lexical retrieval has almost nothing to match.

#### Flips (scoped, op correct ↔ incorrect)

- **B1 → H1: +19 / −6.**
  - Gains: kn-03, moc-01, moc-02, moc-03, moc-05, src-03, prj-01, prj-04, prj-05, wbs-02, rc-01, obs-01, obs-02, obs-03, ten-01, ten-02, ten-03, pq-02, der-01.
  - Losses: kn-04, prj-03, rc-04, pq-04, vc-02, hr-01.
- **B0 → H1: +12 / −3.**
  - Gains: kn-10, moc-02, moc-03, src-03, prj-04, prj-05, wbs-02, wbs-03, obs-03, ten-02, pq-02, der-01.
  - Losses: kn-01, src-01, wbs-01.
- **S2 → S3: +5 / −4.** Order averaging bought one net item.
- **S3 key → S3 readable: +13 / −10.**
  - Readable labels were net positive on held-out, the reverse of dev, where they lost 8 and gained 1.
  - H1 with readable labels (not pre-registered, computed in the same run) is 23/68.
- **Unscoped:** B1 → H1 is +2 / −1, and B0 → H1 is +2 / −0.

#### Dev choices did not transfer

- Every choice selected on dev was within noise there: mean vs sum, key vs readable labels, λ = 5, and 3 rotations.
- On held-out, readable labels beat keys (S3 20 vs 17). Sum beat mean for scoped S1 (12 vs 7) and for unscoped S2 and S4 (3 vs 2), and tied for S3.
- What did hold across both sets:
  - Calibration is the large step: S1 → S2 is +9 scoped on held-out and +13 on dev.
  - Fusing BM25 adds a few items on top: S3 → H1 is +5 on held-out.
  - Scoped, every calibrated method beats the current B1 (9). Unscoped, only H1 does (6 vs 5), on 9 in-candidate items.

#### No-action

| | none-01 … none-06 picked "none" | Action items sent to "none" (false positives) |
|---|---|---|
| Scoped, H1 + none | 0/6 | 0/68 |
| Scoped, S3 + none | 0/6 | 0/68 |
| Scoped, S2 + none | 0/6 | 1/68 |
| Unscoped, H1 / S3 / S2 + none | 0/6 | not run |

- **"None" never won.** Its calibrated S3 score is below the best op on every no-action item: median −1.7 nats scoped (closest −0.4) and −2.65 unscoped. It ranks last or next to last.
- **It also cost op accuracy.** Adding the option dropped H1 from 22 to 18 on the action items.
- **Verdict:** a "none" candidate in the scoring list does not work at this size. No-action needs a separate gate, such as an intent classifier or "is this a request to change the document?".

#### Args (oracle op, all 68 held-out items)

50 items have exact-scored `args`, 22 have `refArgs`, and 23 have `requiredPresent`.

| | A0 current | A1 copy-span + gate + ref labels | Dev A0 / A1 |
|---|---|---|---|
| Exact (fields match and no extras) | 24/50 (48%) | 23/50 (46%) | 5/21 / 15/21 |
| Fields match (extras ignored) | 30/50 (60%) | 23/50 (46%) | 8/21 / 15/21 |
| Items with hallucinated extra fields | 12 | **0** | 12 / 4 |
| `requiredPresent` | 22/23 | 22/23 | – |
| Ref-id exact | 8/22 | 9/22 | – |
| Zod-valid | 67/68 | 68/68 | 30/30 / 30/30 |
| Latency median / p90 (model calls) | 178 / 337 ms (67 calls) | 137 / 262 ms (61 calls) | – |

- **Subset where H1 scoped picked the right op** (22 items; 16 with args, 5 with refs): A0 9/16 exact, A1 7/16, refs 1/5 for both.
- **What A1 fixed:**
  - All hallucinated optionals, e.g. `kind: "AGENT"`, invented `description`/`url`/`assignee`, `outcome: "TODO"`.
  - Paraphrase and truncation: moc-10 `involvedRefs`, pq-01 `target`.
  - Extras: prj-10 and wbs-01 became exact once the extras were gone.
  - pq-06's nested `phase`.
- **What A1 broke: the gate is too blunt.**
  - It removed every field of all-optional ops, so prj-03, prj-04, prj-05, wbs-08 and vc-03 came back as `{}`.
  - It dropped fields that were meant but not named: prj-06 `role`, wbs-07 `assignee`.
  - Dev had no all-optional op with an expected value, so this was not visible there.
  - **Counterfactual, not run:** if all seven of these became exact, A1 would reach at most 30/50 (60%).
  - The fix for a next round is to gate only beside a required field, and never empty an op.
- **Errors neither variant fixes:**
  - **Ref-id choice:** 8–9/22 correct, nearly always the first candidate (g-1, t-1, m-1, d-1). The prompt has no document state, so labels alone do not tell the model which goal is "the benchmarking item".
  - **Reducer vocabulary literals:** `rootCause`, `alternatives`, `staleNoteDays`, `topicMap`. They are not in the utterance, and the schema has no enum for them.
  - **Enum semantics:**
    - prj-02 ON_HOLD → ACTIVE
    - wbs-04 WONT_DO → BLOCKED
    - src-02 EXTRACTING → ARCHIVED (A1)
    - vc-05 `active: false` → true
    - kn-09 CONTRADICTS → BUILDS_ON (A1)
    - hr-01 LINK_HEALTH → ORPHAN_DETECTION
  - **Date normalization:** "December 15th" was not turned into an ISO date (A0 failed zod; A1 gated the field out).
  - **Values that live in document state:** moc-08's question text.

### Verdict: (c) not close; fine-tuning is justified, but a LoRA alone will not reach the bar

- **Best held-out op accuracy, scoped:** H1 at 32.4% overall and 51.2% when the right op is among the candidates. **Unscoped:** 8.8%. The bar is 90–95%.
- **Args exact:** 46–48% even with the oracle op.
- **The decoding techniques help but do not close the gap.**
  - Scored, calibrated selection beats today's sampled enum by +13 items scoped (9 → 22).
  - The cost is about 3.9 s median and 4.9 s p90 per utterance on WebGPU, against 0.33 s.
  - S2 alone (1.3 s) gets 16/68.
- **What remains, by owner:**
  1. **Retrieval (not a LoRA problem).** 25/68 scoped items, and 59/68 unscoped, never reach the candidates, because BM25 matches nothing on most held-out phrasings. Options:
     - Score every op of the scoped model directly (typically 10–20 ops; S2 over 18 ops would be about 36 forced requests, roughly 5 s).
     - Use embeddings.
     - Train the LoRA to emit the op directly over the full scoped list.
  2. **Op semantics (the LoRA's job).** Given the right candidates, about half are still wrong:
     - Lifecycle and status ops lose to a sibling: prj-02 → SET_TARGET_DATE, wbs-04/05 → UPDATE_GOAL_DESCRIPTION, pq-04/06 → ASSIGN_TASK, src-02.
     - Polarity: moc-04 ADD → REMOVE_CORE_IDEA, rc-03 REMOVE → ADD_RESEARCH_CONNECTION.
     - Create vs update and field-name pull: wbs-01, rc-02, rc-04, kn-01, kn-02, prj-03, hr-01.
     - Enum-value semantics inside args (ON_HOLD, WONT_DO, `active: false`, CONTRADICTS).
     - Training data should cover each op's paraphrases without the op's own words, since that is exactly where both BM25 and the base model fail.
  3. **Ref-ids (needs document state in the prompt, not just a LoRA).** Put the relevant entity rows (titles and statuses) into the step-2 prompt, or score ref labels by likelihood the way ops are scored.
  4. **Schema and gating (code, not a LoRA).**
     - Expose reducer vocabularies (metadata fields, threshold conditions, vocabulary keys) as enums.
     - Keep copy-span for free text; it removed every hallucinated extra.
     - Fix the gate so it never empties an op.
     - Normalize dates in the app.
  5. **No-action needs its own gate.** A "none" option was never chosen (0/6).

**Caveats:**
- The held-out set is 68 items written by one person, deliberately without op-name words. Real users will sometimes say "add a topic", which is the dev set's regime, where BM25 alone gets about 73%.
- The truth for real traffic is probably between the two sets.
- Every number above was observed once, on one machine (Chrome WebGPU, Apple `metal-3` adapter; see Environment).

## Round 6: non-LoRA fixes (held-out-2) (2026-10-20)

**Question:** after fixing the causes Round 5 attributed to code rather than to the model (retrieval, ref ids, reducer vocabularies, the optional-field gate, no-action), how close does the base LFM2.5-350M get, and what exact prompt format should a LoRA be trained on?

**Scope change from the coordinator:** multi-action is deferred to v2. The v1 format is zero or one action per message, there is no `Step: i of n` line, and held-out-2's `multiAction` items are reported only as "out of scope", with how often the system emits a plausible first action vs. no action.

### What changed (code)

- **Step 1, `op-scorer.ts`.**
  - `format: "ops"`: the system prompt says `{"ops": [...]}` lists the operations and `{"ops": []}` means no document change. Each candidate is scored by forcing `{"ops": ["<key>"]}`; no action is scored by forcing `{"ops": []}` (it is not a listed option).
  - A `ScoreCache` for the content-free (`N/A`) pass. That pass does not depend on the utterance, so in scoped mode it is paid once per document type and ordering and then costs 0.
  - A third label style, `op` (bare op name).
- **Scoped mode scores every global op of the model** (4–19 ops), not a BM25 top 5.
- **Embedding retrieval, `op-embeddings.ts` + `gte-embedder.ts`.** The committed `models/Supabase/gte-small` q8 ONNX model through `@huggingface/transformers` (already a dependency), on the wasm backend so it does not compete with wllama for the GPU. Each op is embedded once as `<op in words> (<model in words>): <OP_DESCRIPTIONS text>`; the utterance is embedded per query. The loader is a dynamic import, so nothing loads until it is first called. Also: RRF fusion with BM25, model routing by best op hit, and min–max fusion with the LLM score.
  - *Why transformers.js and not wllama `createEmbedding`:* the model is already committed and already used by the graph indexer, it needs no download, and a second wllama instance would need a second GGUF and its own memory.
- **Ref ids, `args-step.ts`.** `labelRefCandidates` makes labels unique (` (2)` suffix; a missing label becomes the id). The step-2 prompt gets a `Choices for <path>: "a", "b"` line and the signature shows `"<path>": choice`. The first required scalar ref field is emitted first, and its label is **chosen by calibrated likelihood**: each label is forced as the prefix `{"<field>": "<label>"`, scored by mean token logprob, minus the same prefix under `Request: N/A` (cached per document state). The args are then generated with that label fixed, and the app maps labels to ids.
- **Vocabularies, `vocabularies.ts`.** Thirteen String fields are narrowed to enums in the model schema at catalog build time (so the signature, the gate and the grammar all see them). See the table below.
- **Optional-field gate (`gate: "safe"`).** As Round 5's `all`, except:
  - when an op has no required semantic field and the utterance mentions none of its optional ones, all of them are kept and the grammar requires **exactly one** (at least one when some are mentioned);
  - `comment` on the knowledge-note lifecycle ops is an annotation and is never restored or required.
- **Enum choice (optional, `scoreEnums`).** With no ref field to score, the first required string enum with ≥ 3 values is chosen by the same calibrated prefix scoring.
- **Step-2 key order is fixed by the schema:** root ref fields, required enum fields, other required fields, the one-of fields, then the remaining optional fields.
- **No-action gates, `no-action-gate.ts`.** (G1) a yes/no "does the request change the document?" gate scored by calibrated log-odds; (G2) an embedding gate: best similarity to 16 generic no-action exemplars minus best similarity to an op of the scoped model; (G3) G2 with threshold 0.04, OR'd with a question rule (ends with `?` and does not start with "please" / "can|could|would|will you").
- **`PROMPT_FORMAT_VERSION = "r6.1"`** (`prompt-format.ts`), pinned with the exact bytes by `tests/unit/chat-prompt-format.test.ts`.
- **Harness:** `spike/llm-harness/r6.ts` (`r6Retrieval`, `r6OpsScoped`, `r6OpsUnscoped`, `r6Gate`, `r6GateEmb`, `r6Args`, `r6Pipeline`). Vite serves `models/` and transformers' own `onnxruntime-web/dist` locally, so the embedder makes no network request. Tests: `tests/unit/chat-round6.test.ts` (grammar builders, vocabularies, gate, labels and label→id mapping, ref/enum scoring with a fake model, no-action gates, embedding ranking and RRF fusion).

#### Vocabularies constrained

| Field | Values | Source |
|---|---|---|
| knowledge-note SET_METADATA_FIELD `field` | 18 names (`scope` … `rootCause`, `correctPattern`) | reducer throws `InvalidMetadataFieldError` (`knowledge-note/v1/src/reducers/content.ts:52`) |
| knowledge-note SET_METADATA_LIST_FIELD `field` | 9 names (`models` … `alternatives`, `consequences`) | reducer throws (`content.ts:85`) |
| moc SET_METADATA_FIELD `field` | `version` | reducer throws (`moc-management.ts:108`) |
| vault-config UPDATE_DIMENSION `dimension` | 8 dimension keys | reducer ignores others (`config-management.ts:22`) |
| vault-config UPDATE_VOCABULARY `key` | 9 keys incl. `topicMap` | reducer ignores others (`config-management.ts:55`) |
| vault-config UPDATE_MAINTENANCE_THRESHOLD `condition` | 7 keys incl. `staleNoteDays` | reducer ignores others (`config-management.ts:104`) |
| vault-config UPDATE_PIPELINE_CONFIG `depth` | quick, standard, deep | convention: reducer default `standard`, design doc |
| knowledge-note SET_NOTE_TYPE `noteType` | 10 lower-case types | editor select only (`knowledge-note-editor/editor.tsx:26`) |
| research-claim CREATE_CLAIM `kind` | research, foundation, methodology, principle, example | editor select only (`research-claim-editor/editor.tsx:487`) |
| health-report GENERATE_REPORT `mode` | quick, full, three-space | convention: design doc |
| pipeline-queue ADD_TASK `taskType` | claim, enrichment | seeded `phaseOrder` keys |
| pipeline-queue ADD_TASK `currentPhase`, ADVANCE_PHASE `handoff.phase` | create, enrich, reflect, reweave, verify | seeded `phaseOrder` values, editor phase colours |

Not constrained: `TOGGLE_FEATURE.feature` (no list anywhere) and the derivation dimension fields (the list would only be inferred from vault-config).

### Development on dev

Dev = the 30-item seed set plus `spike/llm-harness/eval/dev-extra.json`: 19 action items (13 with labeled `refCandidates`, 5 vocabulary items, 1 all-optional op) and 10 no-action items. **I wrote dev-extra myself, alongside the code, so every dev number below is optimistic.** WebGPU, temperature 0. Per-item data: `spike/llm-harness/eval/results-r6-dev-*.json`.

**Retrieval (49 action items, no LLM).**

| | @1 | @3 | @5 | @10 |
|---|---|---|---|---|
| BM25, unscoped | 26 | 33 | 37 | 39 |
| gte-small, unscoped | 33 | 39 | 41 | 42 |
| RRF(gte, BM25), unscoped | 32 | 35 | 36 | 43 |
| BM25, scoped | 29 | – | 42 | – |
| gte-small, scoped | 40 | – | 45 | – |

Model routing (model of the best op hit): 36/49 @1, 41/49 @2. Embedder load 621 ms; embedding all 99 ops 11 975 ms once (single-threaded wasm; deterministic, so it could be precomputed and shipped); per-query embed median 28 ms, p90 38 ms.

**Scoped op selection over all ops of the model (49 action items).** `+emb` / `+bm25` = calibrated mean score + 5 × min–max-normalized similarity (λ = 5 as in Round 5, not re-tuned). Latency is per utterance with the content-free pass cached.

| Prompt | S1 | S2 | S2, 2 orders | S3 (3 orders) | S2+bm25 | S2+emb | S3+emb | S2 / S3 latency median |
|---|---|---|---|---|---|---|---|---|
| `op` format, key labels, own descriptions | 5 | 17 | 19 | 25 | 32 | 39 | 40 | 2.6 s / 8.0 s |
| `ops` format, key labels, own descriptions | 11 | 17 | 22 | 20 | 30 | **40** | 40 | 2.0 s / 5.7 s |
| `ops` format, bare op-name labels | 12 | 13 | 18 | 20 | 29 | 35 | 39 | 1.6 s / 4.9 s |
| `ops` format, key labels, `OP_DESCRIPTIONS` (2 orders) | 13 | 14 | 17 | – | 33 | 37 | – | 2.3 s / – |
| No LLM: gte-small scoped top-1 | | | | | | **40** | | 28 ms |

- **The `ops` format is neutral under fusion** (S2+emb 40 vs 39, S3+emb 40 vs 40) but cost S3 alone 5 items (25 → 20). It is kept, because it is the LoRA plan's format and fusion is what runs.
- **Key labels beat bare op names** (S2+emb 40 vs 35) and **the models' own descriptions beat `OP_DESCRIPTIONS`** in the step-1 prompt (40 vs 37). The embeddings use `OP_DESCRIPTIONS` (no A/B was run for them).
- **The LLM adds nothing on dev.** S2+emb differs from gte-small top-1 on 5 items: the LLM is right on 1 and the embedding on 1. With λ = 5 over min–max similarity the embedding's top op gets +5 while calibrated mean scores span about ±1 nat, so the LLM only matters when the embedding's top two are nearly tied.
- **Content-free cost, paid once per document type and ordering:** 0.5 s (source, 4 ops) to 2.7 s (knowledge-note, 19 ops).

**Unscoped (49 action items).** gte-small top 5, 2 orderings, content-free not cacheable (the list differs per utterance): recall 41/49; gte top-1 33; S2 10; **S2+emb 34** (1.2 s median, 1.3 s p90); S2 (2 orders)+emb 33. Routing to the best model and scoring all its ops: recall 36/49, S2+emb 33. Routing is dropped.

**No-action (10 no-action + 49 action items).**

| Gate | Flags no-action | False positives on action items | Precision / recall |
|---|---|---|---|
| G1 LLM yes/no, calibrated, threshold 0 | 10/10 | 49/49 | 16.9% / 100% |
| G2 embedding, threshold 0 | 8/10 | 8/49 | 50% / 80% |
| G3 = question rule OR G2 > 0.04 | 10/10 | 1/49 | 90.9% / 100% |
| G4 `{"ops": []}` scored as a candidate (S2 or S3, mean) | 0/10 | 0/49 | – / 0% |

- **G1 does not separate at all:** calibrated log-odds are −11.4 … −13.8 on no-action items and −4.9 … −15.7 on action items, so no threshold works. Uncalibrated it is no better.
- **G4 behaves like Round 5's "none":** never chosen with mean aggregation; with sum it took 3/10 but sent 19 action items to no-action.
- **G3 is fitted to dev:** the threshold 0.04 sits 0.005 above the highest dev action score, and the question rule and the exemplars were written while looking at dev. Held-out-2 is its real test.

**Args, oracle op (49 items; 34 with exact-scored args, 13 with refs).**

| | Exact | Ref-id exact | Items with extras | Gen latency median | Ref scoring median / p90 |
|---|---|---|---|---|---|
| A0 = Round 5 A1 (gate `all`, labels only in the signature) | 20/34 | 3/13 | 4 | 113 ms | – |
| r6 prompt + `safe` gate, model picks the ref | 21/34 | 3/13 | 9 | 111 ms | – |
| **A2** = r6 + calibrated ref-label scoring | 23/34 | **11/13** | 5 | 109 ms | 305 / 368 ms |
| A3 = A2 + enum scoring | 24/34 | 11/13 | 5 | 103 ms | 256 / 969 ms |

- "Extras" on seed items count every filled field, because those items carry no expected args (e.g. ADD_TASK's `taskType`/`target`); they are not all hallucinations.
- The 9 → 5 drop came from the annotation rule (SUBMIT_FOR_REVIEW was being forced to fill `comment`).
- A3 fixed dx-16 (`staleNoteDays`) and broke dx-14 (`rootCause` → `relationType`): a net +1 within noise.

### Pre-registration (written and committed before held-out-2 is copied in)

Each configuration runs **once** on held-out-2 (`items` 91, `noAction` 8, `multiAction` 7), WebGPU, temperature 0, prompt format r6.1, catalog with vocabularies, models' own descriptions in prompts and `OP_DESCRIPTIONS` for embeddings.

| # | Config | Definition |
|---|---|---|
| R | Retrieval | BM25, gte-small and RRF recall@1/3/5/10 unscoped; scoped @1/@5; model@1/@2. No LLM. |
| O1–O8 | Scoped op selection, one run | All global ops of the item's model in catalog order, `ops` format, key labels, 3 orderings (offsets `rotationOffsets(n, 3)`), content-free cached, `includeNone`. From the same requests: O1 BM25 top-1, O2 gte-small top-1, O3 S2-mean, O4 S3-mean, **O5 S2-mean + 5 × emb (primary)**, O6 S3-mean + emb, O7 S2-mean + bm25, O8 S3-mean + bm25. |
| U1–U4 | Unscoped, one run | gte-small top 5, `ops`, key labels, 2 orderings, no cache. U1 gte top-1, U2 S2-mean, **U3 S2-mean + emb (primary)**, U4 S2 (2 orders) + emb. |
| G1–G4 | No-action | G1 LLM yes/no (threshold 0), G2 embedding (threshold 0), G3 question rule OR G2 > 0.04, G4 = O3/O5 with `{"ops": []}` as a candidate (from the O run). Scored on all 91 + 8 + 7 items. |
| A0, A2, A3 | Args, oracle op | As in the dev table. **A2 is primary.** |
| P | End to end, scoped | O5 then A2 on every item, no gate. Args are scored only when the op is right. End-to-end numbers *with* a gate are computed afterwards by intersecting P with the G2/G3 predictions from their own runs (no extra model calls). Determinism check: P's O5 picks must equal the O run's O5 picks; any mismatch is reported. |

- **Decision rule, stated now:** if O2 (gte-small top-1, no LLM) scores at least as well as O5 on held-out-2 scoped, the recommended v1 runtime skips the step-1 LLM call in scoped mode. The step-1 prompt format stays defined, because it is what a LoRA would be trained on. The same rule applies to U1 vs U3.
- **G3** is recommended only if its held-out precision holds up; otherwise G2 or "no gate" is reported as the honest best.
- **Latency:** per utterance, warm. That is the sum of wall time of the requests made for the utterance, excluding content-free requests (which the cache serves in a session). The one-time content-free cost per document type and ordering is reported separately. Steps are reported separately: embed, op, args (ref scoring + generation), gate.
- **Splits:** every accuracy is reported overall, by `style` (natural / paraphrase), and by style × difficulty.
- **Disclosure:**
  - Before writing these configs I printed held-out-2's *key structure only* (field names and value types, counts by `style` and `difficulty`; no utterances, labels or expected values), to write a loader.
  - The coordinator told me: 91 items over 79 ops, 46 natural / 45 paraphrase, 13 hard, and that the gold ref is the first candidate in only 10 of 43 cases.
  - I read held-out-1's README (its hard-case table, no-action gists and vocabulary hints) during orientation; held-out-1 was not run.
  - I will not read held-out-2's README until all runs are saved.
- **If a run breaks,** the bug is fixed, both numbers are reported, and nothing else changes.

### Held-out-2 results

`spike/llm-harness/eval/heldout2-eval.json`, committed unchanged (`039236ac`, sha256 `0c9cc44d…307c0b`): 91 action items (46 natural, 45 paraphrase; 31 easy, 47 medium, 13 hard; every easy item is natural), 8 no-action, 7 multi-action. All pre-registered configurations ran once (WebGPU, Apple `metal-3`, one session), with the exception below. Per-item data: `spike/llm-harness/eval/results-r6-h2-*.json`.

**Run incident (args).** My polling script matched a dev run's label, so A2 was started while A0 was still running. The two runs shared one wllama instance; A0 finished, and A2 hung with no output. Following the pre-registered rule, I reloaded the page and reran A0, A2 and A3 sequentially. The concurrent A0 (`results-r6-h2-args-A0-concurrent.json`) and the sequential A0 produced identical args on all 91 items. Only the sequential runs are reported. (The results commit message mentions a `results-r6-h2-args.json`; that file was never written.) The P run's O5 picks equal the O run's O5 picks on all 106 items.

#### Retrieval (91 action items, no LLM)

| | @1 | @3 | @5 | @10 | natural @5 | paraphrase @5 |
|---|---|---|---|---|---|---|
| BM25, unscoped | 30 (33.0%) | 42 | 44 (48.4%) | 47 | 42/46 | **2/45** |
| gte-small, unscoped | 24 (26.4%) | 41 | 49 (53.8%) | 58 (63.7%) | 35/46 | 14/45 |
| RRF(gte, BM25), unscoped | 29 | 46 | 50 (54.9%) | 56 | 43/46 | 7/45 |
| BM25, scoped | 41 (45.1%) | – | 75 (82.4%) | – | | |
| gte-small, scoped | 43 (47.3%) | – | 81 (89.0%) | – | | |

- BM25 scored 0 on every scoped op for 33 of 91 items.
- Model routing by best op hit: 36/91 @1, 57/91 @2.
- Embedder load 455 ms; embedding the 99 ops took 11 524 ms once; per-query embed median 40 ms, p90 71 ms.

#### Op selection, scoped (all ops of the model; one run)

Latency is warm per utterance (content-free cached; see the pre-registration). The one-time content-free cost per document type and ordering was 0.27 s (health-report, 2 ops) to 2.4 s (knowledge-note, 19 ops).

| Config | All (n=91) | Natural (46) | Paraphrase (45) | Nat. easy / med / hard (31/9/6) | Para. med / hard (38/7) | Latency median / p90 |
|---|---|---|---|---|---|---|
| O1 BM25 top-1 | 41 (45.1%) | 38 | 3 | 27 / 7 / 4 | 3 / 0 | 0 |
| **O2 gte-small top-1** | **43 (47.3%)** | 30 | 13 | 22 / 6 / 2 | 10 / 3 | 40 / 71 ms (embed) |
| O3 S2-mean | 29 (31.9%) | 21 | 8 | 16 / 3 / 2 | 8 / 0 | 1 562 / 2 284 ms |
| O4 S3-mean | 32 (35.2%) | 22 | 10 | 17 / 4 / 1 | 8 / 2 | 4 596 / 6 918 ms |
| O5 S2-mean + emb (primary) | 40 (44.0%) | 30 | 10 | 23 / 6 / 1 | 8 / 2 | 1 562 / 2 284 ms |
| O6 S3-mean + emb | 44 (48.4%) | 32 | 12 | 23 / 7 / 2 | 10 / 2 | 4 596 / 6 918 ms |
| O7 S2-mean + bm25 | 43 (47.3%) | 36 | 7 | 27 / 6 / 3 | 7 / 0 | 1 562 / 2 284 ms |
| O8 S3-mean + bm25 | 45 (49.5%) | 39 | 6 | 27 / 8 / 4 | 5 / 1 | 4 596 / 6 918 ms |

- **Recall is 100% here** (every op of the model is a candidate), so "given in candidates" equals overall.
- **Round 5 for comparison** (different set, 68 items): H1 scoped 32.4% overall, with recall@5 63.2%.
- **Decision rule outcome:** O2 (43) ≥ O5 (40). **The recommended v1 scoped runtime skips the step-1 LLM call and takes gte-small's top op** (about 40 ms instead of 1.6 s). O6 and O8 are 1–2 items above O2 at about 115× the latency, which is within noise on 91 items.
- **Paraphrase items fail for every method:** at most 13/45. Lexical BM25 gets 3/45. The calibrated LLM alone (O3/O4) is below both retrievers in every cell.

#### Op selection, unscoped (gte-small top 5; one run)

Recall@5 = 49/91. Latency includes the embed and the uncached content-free pass.

| Config | All | Given in top 5 (n=49) | Natural | Paraphrase | Latency median / p90 |
|---|---|---|---|---|---|
| **U1 gte-small top-1** | **24 (26.4%)** | 24 | 20 | 4 | 40 / 71 ms |
| U2 S2-mean | 18 (19.8%) | 18 | 14 | 4 | 1 254 / 1 349 ms |
| U3 S2-mean + emb (primary) | 24 (26.4%) | 24 | 21 | 3 | 1 254 / 1 349 ms |
| U4 S2 (2 orders) + emb | 24 (26.4%) | 24 | 21 | 3 | 2 461 / 2 639 ms |

Decision rule outcome: U1 = U3, so unscoped also skips the LLM step. Round 5's unscoped H1 was 8.8%, on a different set.

#### No-action (8 no-action items, 91 action items)

| Gate | No-action flagged | False positives on action items | Precision / recall | Latency median |
|---|---|---|---|---|
| G1 LLM yes/no, calibrated, threshold 0 | 8/8 | 90/91 | 8.2% / 100% | 164 ms |
| G2 embedding, threshold 0 | 5/8 | 30/91 | 14.3% / 62.5% | 78 ms (incl. embeds) |
| **G3** question rule OR G2 > 0.04 | 8/8 | 5/91 (1 natural, 4 paraphrase) | **61.5% / 100%** | 78 ms |
| G4 `{"ops": []}` as a candidate, S2-mean / S3-mean | 1/8 / 0/8 | 1/91 / 1/91 | – | (inside step 1) |

- **Where G3's hits come from:** the question rule alone flags 6/8 no-action items with 1 false positive (moc2-08, an action phrased as a question). The embedding part adds the other 2 and 4 false positives.
- **G1 fails the same way as on dev:** no-action scores −14.4 … −9.3, action scores −16.2 … +5.4.
- **End to end with G3 in front of P:** op accuracy stays 40/91, because all 5 items G3 wrongly blocks were already wrong in P. All 8 no-action items are answered instead of acted on. With G2: 33/91.
- **Verdict:** G3 is the best gate measured, but 61.5% precision misses the LoRA plan's 0.85 bar, and its threshold and rule were fit on dev. The 350M base model gives no usable no-action signal, either as a yes/no gate or as `{"ops": []}`.

#### Args, oracle op (91 items; 65 with exact-scored args, 32 with refs, 22 with `requiredPresent`)

| | Exact | Natural / Paraphrase | Ref-id exact | Ref natural / paraphrase | Extras | `requiredPresent` | Zod-valid | Gen median / p90 | Ref/enum scoring median / p90 (one-time CF median) |
|---|---|---|---|---|---|---|---|---|---|
| A0 = Round 5 A1 | 25/65 (38.5%) | 16/36 / 9/29 | 10/32 (31.3%) | 5/13 / 5/19 | 0 | 22/22 | 91/91 | 158 / 254 ms | – |
| **A2** (primary) | **28/65 (43.1%)** | 17/36 / 11/29 | **21/32 (65.6%)** | 8/13 / 13/19 | 5 | 22/22 | 91/91 | 148 / 260 ms | 363 / 508 ms (354 ms) |
| A3 = A2 + enum scoring | 27/65 (41.5%) | 16/36 / 11/29 | 21/32 | 8/13 / 13/19 | 5 | 22/22 | 91/91 | 129 / 240 ms | 356 / 1 009 ms (847 ms) |

- By difficulty, A2 exact: natural easy 14/23, medium 2/8, hard 1/5; paraphrase medium 10/25, hard 1/4.
- Calibrated label scoring doubled ref accuracy (10 → 21 of 32). The coordinator reports that the gold ref is the first candidate in only 10 of 43 cases, and A0's 10/32 matches "always pick the first".
- A2 had no all-optional op come back as `{}` (A0: 3).

#### End to end, scoped (P = O5 then A2, no gate; 91 + 8 + 7 items)

- **Op:** 40/91 (natural 30/46, paraphrase 10/45).
- **Args given the right op:** 15/27 exact, refs 8/12, `requiredPresent` 11/11, zod-valid 40/40.
- **Fully right** (right op, plus exact args and refs where scored): **25/91 (27.5%)**.
  - Natural 19/46: easy 16/31, medium 3/9, hard 0/6.
  - Paraphrase 6/45: medium 4/38, hard 2/7.
- **Warm latency per utterance:** embed 38 / 68 ms, step 1 1 519 / 2 284 ms, step 2 143 / 527 ms; total **1.79 s median, 2.47 s p90**.
  - Measured over the whole P run, including the first content-free pass for each model: 1.95 / 2.74 s.
  - With the decision rule applied (no step-1 LLM call), the per-utterance cost is the embed plus step 2. That combination was not run as a separate configuration.
- **Multi-action (out of scope for v1, 7 items):** no item was answered with no action. The single action emitted was one of the expected ops for 5/7, and the first expected op for 2/7.

### Final runtime prompt format (r6.1)

Built by `scoringMessages(utterance, toOptions(candidates, "key"), "ops")` (`op-scorer.ts`) and `argsMessages(utterance, entry, orderedSchema, choices)` (`args-step.ts`). The bytes below are asserted by `tests/unit/chat-prompt-format.test.ts`. A fine-tune must use exactly these. Any change bumps `PROMPT_FORMAT_VERSION` (`prompt-format.ts`).

**Step 1.** The candidates are every global op of the scoped model, in catalog order. Unscoped, they are gte-small's top 5 by similarity. Each line is `- <catalog key>: <model's own description, or the op name in words> (fields: <semantic field names, or none>)`.

System:

```
You choose the document operations that carry out the user's request. Answer with JSON: {"ops": [...]} lists the operations in the order they run, and {"ops": []} means the request needs no document change.
```

User (example):

```
Operations:
- tension:CREATE_TENSION: Identify a new contradiction (fields: title, description, content, involvedRefs)
- tension:RESOLVE_TENSION: Mark as resolved with explanation (fields: resolution)
- tension:DISSOLVE_TENSION: Mark as dissolved (apparent, not real) (fields: resolution)
- tension:ADD_INVOLVED_REF: Add a note to the tension (fields: ref)

Request: that conflict is settled
```

Assistant target: `{"ops": ["tension:RESOLVE_TENSION"]}`, or `{"ops": []}` for no action. v1 never has more than one op.

**Step 2.**

- The schema is the op's model schema with vocabularies and ref labels, after the `safe` gate.
- Keys are ordered: root ref fields, required enum fields, other required fields, the one-of fields, then the other optional fields.
- There is one `Choices for <path>: …` line per ref path, with labels in document order (duplicates suffixed ` (2)`). The signature renders ref fields as `choice`.
- The description falls back to the op name in words.

System:

```
You extract the arguments for a document operation from the user's request. Copy names and text from the request exactly. Answer with JSON.
```

User (example):

```
Operation: SET_GOAL_STATUS - set goal status
Choices for id: "Ship the beta", "Set up CI"
Arguments: {"id": choice, "status": "BLOCKED" | "COMPLETED" | "IN_PROGRESS" | "IN_REVIEW" | "TODO" | "WONT_DO", "blockReason"?: string | null, "outcome"?: string | null}
Request: the CI goal is blocked on hardware
```

Assistant target: compact JSON in that key order, with ref fields as labels, e.g. `{"id": "Set up CI", "status": "BLOCKED", "blockReason": "hardware"}`. The app maps labels to ids and adds new ids, timestamps and actor.

**Runtime decoding around the format (not trained):**

- Step 2 decodes under the copy-span GBNF.
- The first required ref label is chosen by calibrated prefix likelihood (with `scoreEnums`, the first required enum is too, when there is no ref), then fixed.
- The no-action gate (G3) runs before step 1.
- With the base model, the step-1 call is replaced by gte-small top-1 per the decision rule. A LoRA would be judged against O2's 43/91 scoped.

### Remaining error types (held-out-2, after these fixes)

**Op selection** (O5's 51 scoped misses; the gold op is gte-small's scoped rank 2–3 in 32 of them, and rank 1 in 5 that the LLM term overturned):

- **Polarity and sibling confusion:**
  - ADD ↔ REMOVE: moc2-04, moc2-08, moc2-09, pq2-06 BLOCK → UNBLOCK, prj2-16.
  - Lifecycle siblings: kn2-13/kn2-14 → ARCHIVE_NOTE, obs2-04, pq2-02/pq2-04 → ADVANCE_PHASE.
  - Create vs update: prj2-01, prj2-08, vc2-04.
- **A model-wide prior pick:** knowledge-note's ARCHIVE_NOTE and SUBMIT_FOR_REVIEW, project's LINK_WBS, and wbs's SET_PROJECT_REF / ADD_DEPENDENCIES win on unrelated requests.
- **wbs SET_GOAL_STATUS is ranked 9–11 by gte-small** (wbs2-03/04/05), so neither retriever nor fusion recovers it.
- **Paraphrase.** Paraphrased requests (no op words, indirect phrasing) score 10–13/45 for the best methods. This is the LoRA's job; retrieval alone cannot reach it.

**Args** (A2, oracle op):

1. **Span length and edges (12 items).** The span is cut short (moc2-02, moc2-04, moc2-09, src2-05, obs2-03, rc2-02, rc2-06, prj2-08, wbs2-14), the final period is dropped (kn2-02, rc2-05), or the wrong span is copied (kn2-04).
2. **Enum and value semantics (13).** kn2-06, kn2-07 `linkType`; kn2-10 `field`; src2-01 `sourceType`; src2-03, prj2-12, wbs2-04, wbs2-05 status; obs2-02 category; vc2-02 `condition`; der2-01 dimension; hr2-01, hr2-02 category/status.
3. **Gate.**
   - It drops meant-but-unnamed fields beside a required one: prj2-01 `owner`, prj2-07 `role`, moc2-11 and kn2-10 `value`.
   - Exactly-one picks the wrong field: prj2-02, prj2-09, prj2-14, vc2-05.
4. **Ref choice (11/32 wrong, 7 of them in wbs goals).** wbs2-02/04/05/07/08/10/14, kn2-07, moc2-07, pq2-03, pq2-06.
5. **Vocabulary mismatch (2).** My UI-derived lists exclude the writer's value: pq2-01 `taskType: "extract"` (seed data says `claim`/`enrichment`), and rc2-01 `kind: "empirical"` (editor list). The two sources disagree; the user should decide which is canonical.
6. **Lists and dates.** List splitting (kn2-11 `values`, moc2-12 `involvedRefs`, wbs2-08 dependencies, moc2-07 reorder ids), and prj2-06's year (2023 instead of 2027; dates are not normalized by the app).

**No-action:** G3 precision 61.5%. Multi-action is not supported in v1.

### Verdict

- **The fixes that are not about the model helped where they target the code:**
  - Scoped recall is now 100% (Round 5: 63.2%).
  - Ref accuracy rose from 31% to 66%.
  - All-optional ops are no longer emptied.
  - Unscoped recall@5 went from BM25's 48% to gte-small's 54%.
- **They did not move op choice off about 45–49% scoped,** and paraphrases stay near 25%.
- **The 350M base model's likelihood scores no longer add accuracy** once gte-small is fused in (O2 43 vs O5 40), and they cost 1.6 s.
- **Next:** the LoRA should be trained on the r6.1 format above, and judged against O2 (scoped 47.3%) and U1 (unscoped 26.4%), on paraphrase items in particular.

**Caveats:**
- One run, one machine.
- The dev extension, the G3 rule and its threshold were written by me.
- source and research-claim have only 6 items each.
- Held-out-2's README was not read before or during the runs.
- `npm run tsc` stays at 204 errors outside `training/`. The `training/` checkout added by another agent brings its own tsc errors from vendored llama.cpp UI files; I did not touch it.
- **Connect gap:** onnxruntime-web's wasm comes from jsdelivr unless `wasmPaths` is set, and Connect's CSP blocks that. The harness serves it locally.

## Round 7: cleanup (2026-10-20)

Goal: make the Chat tab, the harness and the training renderer run the same Round 6 v1 pipeline (prompt format r6.1), and get the training renderer ready for the teacher pilot. No held-out set was run in this round.

### Canonical vocabularies

The user decided that the app's own lists are canonical: reducer lists, editor lists and seed data. `editors/knowledge-vault/chat/core/vocabularies.ts` is now the one exported source. It exports each list by name (`NOTE_TYPES`, `CLAIM_KINDS`, `PIPELINE_TASK_TYPES`, `PIPELINE_PHASES`, …), with its source, and builds `VOCABULARY_TABLE` / `VOCABULARIES` from them. `buildRuntimeCatalog()` (`catalog-models.ts`) is the catalog with those vocabularies as enums; the Chat tab, the harness's v1 entry and the training renderer all build their catalog through it.

- No value or order changed, so the r6.1 prompt bytes are unchanged (`chat-prompt-format.test.ts` passes as before).
- `tests/unit/chat-vocabularies.test.ts` pins every list to its source: the reducer arrays (read from the reducer source), `NOTE_TYPES` in the knowledge-note editor, the research-claim editor's kind `<option>`s and `KIND_COLORS` keys, the pipeline-queue editor's `PHASE_COLORS` keys, the pipeline-queue initial `phaseOrder` (from `utils.createDocument()`), `taskType: "claim"` in the source editor, and the design-doc lines for `depth` and `mode`, which have no app list.

### Label corrections

Three expected values in the held-out sets used values outside the canonical lists. Only those values were changed. Utterances, `context` and every other field are unchanged, and neither set was run after the change.

| File | Item | Field | Old → new | Source |
|---|---|---|---|---|
| `heldout2-eval.json` | pq2-01 | `expected.args.taskType` | `"extract"` → `"claim"` | Seed `phaseOrder` keys are `claim` and `enrichment`. The source editor queues extraction as `taskType: "claim"` (`editors/source-editor/editor.tsx:94`). The item's own `context.state.phaseOrder` gives `"extract"` the phases `create, reflect, reweave, verify`, which are the seeded `claim` phases. |
| `heldout2-eval.json` | rc2-01 | `expected.args.kind` | `"empirical"` → `"research"` | The research-claim editor's kind list (`editors/research-claim-editor/editor.tsx:487`): research, foundation, methodology, principle, example. |
| `heldout-eval.json` | rc-01 | `expected.ambiguousArgs.kind` | `"empirical"` → `"research"` | Same list. `ambiguousArgs` is not exact-scored, but `kind` is in the item's `requiredPresent`. |

- **`"empirical"` → `"research"` is a judgment.** No canonical kind means "empirical". The claims are empirical findings from evaluations ("offline eval on 500 queries", "A/B over 40 prompts"), and `research` is the closest kind. rc2-01's utterance still says "kind: empirical" literally, so the enum now forces a mapping that the text does not spell out.
- **pq2-01's `context.state` still says `"extract"`** (its `phaseOrder` and tasks tk-1/tk-2), and tk-3 says `"dedupe"`. The other held-out-2 items that copy that state snapshot also say `"extract"`. These are context, not expected values, and nothing scores them, so they were left as they are.
- New sha256: `heldout2-eval.json` `71080a7b…25472e` (was `0c9cc44d…307c0b`), `heldout-eval.json` `45efda5b…562dae` (was `e71ce178…75aa0`).

### tsc baseline

- `npm run tsc` reports 204 errors, before and after this round.
- A fresh, non-incremental `npx tsc --incremental false --noEmit` was run at HEAD and in a detached worktree of `main` (`55229d19`, removed afterwards). Both printed 204 errors, and the two sorted error lists are identical: the generated `v1/tests/*.test.ts`, `processors/graph-indexer/factory.ts` and the `kysely-pglite-dialect` tests. The same diff was re-run after every commit of this round.
- The 5 `training/gen/*.ts` files are in the root tsconfig and have no errors. The extra errors Round 6 mentions came from llama.cpp's `.ts` files while they sat inside `training/`. `setup.sh` now builds llama.cpp in `~/.cache/bai-training`, outside the repo. No tsconfig change and no task-1 commit were needed.

### Precomputed op embeddings

- `scripts/gen-op-embeddings.ts` writes `chat/core/op-embeddings.gte-small.json` (239 KB): 99 op vectors and 16 no-action-exemplar vectors, 384 dims, float32 in base64. They are keyed by a sha256 over the model spec (`Supabase/gte-small`, q8, mean pooling, normalized) and every input text: the op texts (with `OP_DESCRIPTIONS`) and the exemplars. `--check` exits 1 when the asset is stale, and `tests/unit/chat-op-embeddings.test.ts` fails when the hash or the keys no longer match the catalog.
- `createOpEmbeddingIndex` ranks ops from the asset, so a session embeds only the utterance. The asset loads as its own lazy chunk: the build emits `op-embeddings-asset-<hash>.js` (239 320 B), and the editor chunk does not contain the vectors. Round 6 spent 11.5–12 s embedding the 99 ops each session.
- **Numerics.** The first version used transformers' node build (onnxruntime-node, CPU). Against the browser's wasm embedder (harness `v1EmbedParity`), it differed by up to 0.0099 per dimension (min cosine 0.99849) and changed the scoped top-1 op on 4 of 59 dev items (dev-04, dx-07, dx-14, dn-01).
  - `scripts/gte-wasm-node.ts` now runs the same `onnxruntime-web` bundle and the vendored asyncify wasm under node, with transformers' tokenizer, `mean_pooling` and `normalize`.
  - The regenerated asset equals the browser's vectors exactly (max |Δ| 0, min cosine 0.999999, 0 flips).
  - Generation takes 4.1 s, and two runs gave byte-identical files.
- Changing one exemplar character made `chat-op-embeddings.test.ts` fail on the hash; the edit was reverted.
- This also settles the training README's open question: transformers.js and onnxruntime-web load gte-small under tsx.

### Chat tab on the v1 pipeline

- `chat/core/v1-pipeline.ts` holds `runV1`, which the Chat tab (`use-chat-llm.ts`) and the harness's new `v1Pipeline` entry (`spike/llm-harness/v1.ts`) both call. Per request it:
  1. embeds the utterance once;
  2. applies the G3 gate (question rule OR embedding score > 0.04), which sends no-action requests to the plain answer path;
  3. otherwise takes gte-small's top op among the scoped model's global ops, with no step-1 LLM call;
  4. calls `fillArgsStep` with the A2 settings (safe gate, label-scored refs).
- `loadV1Runtime` loads the catalog (`buildRuntimeCatalog`), the asset and the embedder once per page. The tab loads it in parallel with wllama.
- The tab's Command/Ask toggle is gone, because the gate decides. Confirm still gates dispatch. The proposal card shows the op, the top 3 ops by embedding with their similarities, the ref label scores when a ref was scored, and the args.
- Ref candidates from the selected note: `REMOVE_TOPIC.id` comes from its topics (label = name), and `REMOVE_LINK.id` / `UPDATE_LINK_TYPE.id` from its links (label = target title, else id). `ADD_LINK.targetDocumentId` gets no candidates, so that op fails zod and Confirm stays disabled.
- **Dev smoke run of the shared code** (harness, WebGPU, `results-r7-dev-v1.json`; dev sets only):
  - Op: 40/49, the same as Round 6's gte-small scoped top-1 on dev.
  - No-action: 10/10 answered. 1 action item was gated out.
  - Args exact: 17/25 where the op was right. Refs: 10/12.
  - Per-utterance wall time: median 135 ms, p90 796 ms.
- `prepareArgsStep` (`args-step.ts`) is the step-2 prompt preparation split out of `fillArgsStep`, which now calls it. The training renderer uses it too.

### onnxruntime-web and gte-small from the package origin

- `vendor/onnxruntime-web/1.26.0-dev.20260416-b7804b056c/` holds `ort-wasm-simd-threaded.asyncify.mjs` (47 389 B) and `.wasm` (23 567 050 B), copied unchanged from the onnxruntime-web that transformers 4.2.0 bundles. A README records sha256s and the tarball shasum. `LICENSE` is microsoft/onnxruntime's MIT text at the package's commit `b7804b05`, because the npm package ships none.
- `gte-embedder.ts`:
  - It sets `wasmPaths: { mjs, wasm }` to those files via `new URL(…, import.meta.url)`, after the transformers import (transformers assigns jsdelivr paths at init).
  - It sets `env.useWasmCache = false`, so the factory is never re-wrapped as a `blob:` module.
  - The committed `models/Supabase/gte-small` files come in through `env.fetch` from `new URL()` assets. The local model path must not be an http(s) URL: with one, transformers skips its local existence check, loads no tokenizer, and fails with `this.tokenizer is not a function`.
- `tests/unit/chat-ort-vendor.test.ts` fails if the installed onnxruntime-web version or files differ from the vendored copy.
- **Build** (`npx ph-cli build --ignore-type-errors`: exit 0, 13.1 s):
  - `dist/browser/assets/` holds `ort-wasm-simd-threaded.asyncify-DMmc6YqF.wasm` (23 567 050 B), its `.mjs`, `model_quantized-BexI1B2v.onnx` (34 014 426 B) and the four gte-small JSON files. All are emitted as files, none inlined.
  - The editor chunk references every one of them. transformers' own chunk references the same `-DMmc6YqF.wasm`, so the content hash makes the "dead" ort asset and the chat's asset one file.
  - The only `cdn.jsdelivr` strings left are transformers' default-path literal and wllama's two compat URLs.
- **`copy-runtime-assets.mjs`:**
  - Step 3 now removes only `ort-wasm-*` browser assets that no chunk names, and its comments no longer say the browser build is model-free. Steps 1, 2 and 4 (the server path) are unchanged.
  - In this checkout the script still stops at step 2 (`cannot locate onnxruntime-web/dist`, as in Round 4), because onnxruntime-web is a nested pnpm dependency.
  - Step 3 was checked with a scratch copy that adds the real ort path to step 2's candidates. It printed "kept chat browser asset" for both ort files, and both stayed in `dist/browser/assets`.

### Training renderer on r6.1

- `training/gen/prompt-format.ts` now builds step 1 with `scoringMessages(…, toOptions(candidates, "key"), "ops")` over every global op of the row's model. Unscoped rows use gte-small's top 5, computed on the wasm numerics above.
  - Targets are `{"ops": [key]}`, and no-action rows now get `{"ops": []}`.
  - Step 2 goes through `prepareArgsStep` with the v1 gate. Targets follow the step-2 key order, with refs as labels.
  - `PROMPT_FORMAT_VERSION` is re-exported from the core.
- Targets are checked against the runtime grammars (core `argsGrammar` and the `{"ops": …}` alternation) with `gbnf-check`, no longer against llama.cpp's JSON-schema grammar. `render_template.py` no longer trains on a rejected target. `validate-rows.ts` has a vocabulary stage. `smoke_infer.py` decodes every step under its rendered grammar.
- `tests/unit/training-prompt-format.test.ts` asserts the rendered step-1 and step-2 bytes against the r6.1 strings, and asserts that the step-2 messages equal what `fillArgsStep` sends.
- **Re-render** (`render.sh` on the 50 smoke rows, render and parity only, no retraining, 16.1 s):
  - Validation dropped smoke-17 (`noteType "question"`, not canonical), leaving 48 valid rows and 91 steps (48 step 1, 4 of them no-action; 43 step 2).
  - 3 step-2 targets are rejected by the runtime grammar: smoke-24 and smoke-25 (`role`) and smoke-38 (`assignee`). The safe gate drops a meant-but-unnamed optional field beside a required one.
  - The other 88 steps have template and token parity with HF (0 mismatches, 0 boundary merges, one BOS each).
  - Probe rows: 8 steps, 7 trainable (probe-03 `role`, same cause), parity holds.
- The teacher context now carries the vocabularies as enums (e.g. `taskType: "claim" | "enrichment"`). `teacher.py plan` dry run: 20 requests, 0 over the schema limits.

### Connect end to end (`ph connect studio --port 3100`, Vite dev path)

- **Page:** the CSP meta was the same as in Rounds 3–4: `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://registry.vetra.io; worker-src 'self' blob:; …`. `crossOriginIsolated` was false.
- **Setup:** the drive "Chat E2E Vault" and the note "CRDT merge semantics" from Round 3 were used. OPFS `cache/` was deleted first to get a cold load.
- **(a) Action, cold:**
  - "tag this note with eventual consistency" proposed ADD_TOPIC (embedding top 3: ADD_TOPIC 0.863, REMOVE_TOPIC 0.833, ARCHIVE_NOTE 0.833) with `name: "eventual"`, a cut-short span (Round 6's error type 1). It was discarded.
  - "add the topic replication" (warm) proposed ADD_TOPIC (0.879) with `name: "add"`, a wrong span. It was confirmed: the tab reported `Dispatched ADD_TOPIC to "CRDT merge semantics".`
  - The note's editor showed a new topic chip `add`, and revision history showed revision 3, `ADD_TOPIC`, "1/1 signature verified", "No errors".
- **(b) Question:** "what does this note say about merge conflicts?" was routed to "No document change (question); answering." and answered in plain text. It made no dispatch: the history still ended at revision 3.
- **Warm reload:** "submit this note for review" proposed SUBMIT_FOR_REVIEW (0.914; APPROVE_NOTE 0.884, REJECT_NOTE 0.867) with only app-filled fields. It was discarded.
- **Load times** (status label, and a DOM observer from Send):

| | Cold (OPFS empty) | Warm (after reload) |
|---|---|---|
| wllama `loadMs` (webgpu) | 9 179 ms | 918 ms |
| gte-small embedder load (in parallel) | 657 ms | 481 ms |
| Send → proposal card | 9 364 ms | 1 003 ms |
| Model ready → proposal (embed + step 2) | 120 ms | – |
| Send → proposal, second utterance, same page | 128 ms | – |

- **Network:**
  - Every chat asset came from `localhost:3100`: `/vendor/wllama/3.8.1/wllama.{js,wasm}`, `/vendor/onnxruntime-web/…/ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, `/models/Supabase/gte-small/{config,tokenizer,tokenizer_config}.json` and `onnx/model_quantized.onnx`, and the asset module `op-embeddings.gte-small.json?import`. There were also three `blob:` wllama workers.
  - **No request went to `cdn.jsdelivr.net`.**
  - External hosts: `huggingface.co` (the model tree API, then a HEAD and a GET on the GGUF) and its `us.aws.cdn.hf.co` redirect, for the GGUF only. `www.renown.id` is Connect's own. `localhost:4001` is the vault subgraph, refused because no Switchboard was running.
  - The warm load made no GGUF download (OPFS), only the tree API call.
- **Console:** no CSP violation. The only errors and warnings were the Round 3 ones: the `localhost:4001` refusals with the `[useGraphSearch]` / `[useGraphMetadata]` warnings, and the form-field id/name issue (count 4). There were also the SharedArrayBuffer and deprecated-feature issues.
- Screenshots: the session scratchpad `connect-check-r7/` (01 cold proposal, 02 dispatch and question, 03 revision history, 04 warm proposal).

### Record note: `dd5b7802`

Commit `dd5b7802` ("round-6 held-out-2 per-item results") says `results-r6-h2-args.json` holds the broken concurrent A0/A2 attempt. That file was never written; the concurrent A0 is in `results-r6-h2-args-A0-concurrent.json`. History is left as it is.

### Still open

- **Args quality** is the visible weak point in the tab: two of three ADD_TOPIC proposals copied the wrong span. Round 6 attributes this to the base model.
- **The safe gate drops meant-but-unnamed optional fields** (`role`, `assignee`, `owner`). That makes some correct training targets untrainable as the format stands. Changing it would change r6.1.
- **The `dist/browser` path was built and inspected, not loaded in Connect.** `copy-runtime-assets.mjs` still cannot find onnxruntime-web in this pnpm layout (step 2, server path, unchanged).
- **The asyncify wasm is used on Safari too,** where transformers would pick the plain build. Not tested.
- The wllama compat path (`needCompat()`) would still fetch from jsdelivr. Chrome did not need it.

## Teacher pilot (2026-10-21)

The teacher moved from the Anthropic API to headless Claude Code: `training/py/teacher.py run --teacher cli` (the default; `api` is kept), one isolated `claude -p --model claude-sonnet-5` call per request. No API key is needed. The full command line, the isolation flags and the gaps are in `training/README.md` ("Teacher"). The full ~16k-row run was **not** started.

- **Pilot:** 100 items: 9 ops across knowledge-note, project, wbs and tension, plus 10 no-action items.
- **Funnel:**

  | Stage | Dropped |
  |---|---|
  | Grounding | 1 |
  | Eval leak (both exact copies of held-out-2 `kn2-12`, "submit this for review") | 2 |
  | zod and replay | 0 |
  | r6.1 safe-gate grammar rejections (`role`, `assignee`, `owner`) | 11 |
  | Blind-label disagreements (4 on the op, 9 on args only, mostly case or final punctuation) | 13 |

  **73 rows were kept.** They gave 132 trainable steps with full template and token parity. `training-prompt-format.test.ts` passes.
- **Observed time and usage** at concurrency 3: about 206 s, summed over the stage wall times, for 117 CLI calls with 0 retries.
  - Generation took 64 s (median 9.2 s per call).
  - The label pass took 85 s (median 2.4 s per call).
  - Tokens: 314k input, including cache writes, and 27k output.
  - Cost: $1.53 CLI-reported `total_cost_usd`. That is an API-list-price equivalent, not subscription usage.
- **Extrapolation, not measured:** about 3.9 h for the full run at concurrency 3 (generation about 1 h, label pass about 2.8 h), and about 34M input and 2.3M output tokens.
- **Found on the way:**
  - The CLI injects the account email into every call. The first run put it into 2 utterances. The prompts now forbid it, and `rows` filters it out.
  - 40 of the 99 ops are ref ops, which the teacher pipeline cannot replay yet. That blocks the full run.
  - Op words appear in 27 of the 63 kept action rows.
- **Data:** the summary is `training/results/teacher-pilot-2026-10-21.json`, and the kept rows are `training/data/teacher-pilot-2026-10-21/pilot-agreed.jsonl`.

## Teacher pilot 2 (2026-10-21)

The gaps from pilot 1 were closed in `training/`, then a second pilot ran with the same `claude -p` isolation at concurrency 3. Details are in `training/README.md` ("Teacher pilot 2"). The full run was **not** started.

- **Ref ops:** all 40 are supported.
  - Each request gets a document state built by replaying real creation actions through the reducers (`training/gen/ref-scenarios.ts`), with 2–6 labeled items.
  - Each item names its target. The gold item is first in 25% of kept refs.
  - Validation re-derives the candidates from the replayed state and checks a per-op post-condition.
- **Wording:** each item has a spec: register, length, a seeded pool name and, for at least half of an op's items, op words to avoid.
  - Kept rows are 90% op-word-free (pilot 1: 57%), and no name appears more than twice.
  - Op words are now rarer than in held-out-2's "natural" half, so the full run should set a two-sided quota.
- **Labels:** 8 messages per call, blind, under opaque keys.
  - On pilot 1's 97 rows, batched labels agree with single-call labels 79/97 exact, which equals the single-call agreement with generation (79/97).
  - Input tokens drop from 253k to 71k and cost from $1.12 to $0.32.
- **Leak check:** no eval utterance appears in any teacher prompt. The `kn2-12` copies were a coincidence on the shortest phrasing, and `plan`/`label` now refuse on a hit.
- **Pilot 2:** 150 items (90 ref, 48 non-ref, 12 no-action; all 12 models) → **105 kept**.
  - Drops: 2 context leak (account email as SET_PROVENANCE `author`; caught and redacted), 2 ref-echo mismatches, 6 grounding, 6 grammar gate, and 29 blind-label disagreements (14 on the op).
  - 33/40 ref ops and 10/12 models kept at least one row.
  - 198 trainable steps with full template and token parity.
- **Observed:** about 284 s over the stages, 79 calls, 304k input and 71k output tokens, $1.77 CLI-reported API-equivalent cost.
- **Extrapolation, not measured:** 12,000 items would take about 5.4 h at concurrency 3 (24M input, 5.7M output, about $140) and keep about 8.4k rows. About 16k kept rows would take about 10 h.
- **Data:** `training/results/teacher-pilot2-2026-10-21.json` and `training/data/teacher-pilot2-2026-10-21/agreed.jsonl`.

## Teacher batch-size comparison (2026-10-21)

How many items should one `claude -p` generation call ask for? Before this, pilot 2 asked for about 2.7 per call. The comparison ran 1, 10 and 25 items per call (B1, B10, B25) on the same 12 ops (7 ref, 5 non-ref, 8 models) plus wbs no-action, with the same 325 specs, seeded states and targets in each arm, through the same validation and blind-label chain. Details are in `training/README.md` ("Teacher batch-size comparison"). The full run was **not** started.

| | B1 | B10 | B25 |
|---|---|---|---|
| Calls | 325 | 39 | 13 |
| Kept (yield) | 274 (84.3%) | 253 (77.8%) | 234 (72.0%) |
| Label agreement, op / exact | 93.9% / 88.1% | 91.0% / 80.1% | 84.1% / 81.0% |
| Distinct 2-grams per 100 items / gte-small cosine | 1105 / 0.827 | 1243 / 0.820 | 1186 / 0.820 |
| Generation wall / input tokens | 482 s / 1,077k | 387 s / 167k | 314 s / 85k |
| Cost per kept row | $0.0188 | $0.0108 | $0.0096 |

- **Recommendation:** generation batch **10**, label batch **8**.
  - B25's losses are correlated within a call: one call per op picks one reading for all 25 items. 3 of 13 calls lost 64 items.
  - List position has no effect.
  - B1 is the most repetitive arm, and its independent calls reproduced a held-out phrase 4 times.
  - Label batch 20 saves 24% of input tokens at the same cost, and its agreement is not shown to be better.
  - B1 vs B10 yield (84.3% vs 77.8%) is within label-run noise: two label runs on the same rows agree 86.4% exact. B25's loss is structural.
  - Before the full run, `plan` needs per-call state seeding. Today it seeds one state per op.
- **Extrapolation, not measured** (12,000 items at B10): about 5.2 h, 14.5M input and 5.8M output tokens, about $100 API-equivalent, and about 9.3k kept rows. Pilot 2's shape gave about 5.4 h, 24M input and $140.
- **Fixed on the way:**
  - `dedup.py` now also rejects a row that contains a whole eval utterance.
  - A 429 spend/session limit now stops `run` instead of burning retries. The label passes were resumed after the reset, and the interrupted attempts are counted apart from failures.
- **Data:** `training/results/teacher-batchsize-2026-10-21.json`.

## Round 8: first LoRA (2026-10-21)

**Question:** does a LoRA on about 3k teacher rows move LFM2.5-350M toward the bars (op ≥ 90%, args exact ≥ 80%) on both held-out sets, and is fine-tuning worth scaling up?

### Pre-registration (written and committed before any held-out run)

**Models.** *Base*: the published `LiquidAI/LFM2.5-350M-GGUF` Q4_K_M, as today's runtime loads it. *LoRA*: `LiquidAI/LFM2.5-350M` + this round's LoRA (r 16, α 32, dropout 0.05, all linear layers, LR 2e-4 cosine, 3 epochs, effective batch 32, completion-only loss), merged, converted with llama.cpp b11364, given the published GGUF's chat template and quantized to Q4_K_M. It is served to the harness from `training/artifacts/round8/gguf/` (gitignored) and loaded with `loadModelFromUrl`, OPFS cache off.

**Training data (fixed before training).** Teacher rows from `plan --ops all --batch-size 10` (per-call seeded states), label batch 8, through the existing grounding, leak, email, dedup, zod/replay, grammar-gate, blind-label and quota filters. Each kept row renders to: the r6.1 step-1 row over all ops of its model (catalog order), a second step-1 row over gte-small's scoped top 5 (similarity order; dropped when the gold op is not in the top 5, since a `{"ops": []}` target there would teach a false no-action), and its step-2 row. A 5% val split (by source row, stratified by op) is used for loss monitoring only. No held-out item is used for training, early stopping or tuning; the final adapter after 3 epochs is the one evaluated, unless the val curve clearly forces a change, which will be reported.

**Sets.** Held-out-1 (`heldout-eval.json`: 68 action + 6 no-action; reserved since Round 5), held-out-2 (`heldout2-eval.json`: 91 action + 8 no-action; its 7 multi-action items are out of scope for v1 and not run) and, for reference only, dev (30 seed + 19 dev-extra + 10 dev-extra no-action). Refs are each item's labeled `refCandidates`.

**Configs.** Each runs **once** per set, WebGPU, temperature 0, prompt format r6.1, v1 step-2 settings (safe gate, calibrated ref-label scoring), fresh score caches per run.

| # | Op choice | Step 2 (args, refs) on | No-action |
|---|---|---|---|
| **C0** | gte-small scoped top-1 (`runV1`, unchanged) | base | G3 gate |
| **C1** | gte-small scoped top-1 (`runV1`, unchanged) | LoRA | G3 gate |
| **C2** (k = 5 primary; k = 3 secondary) | LoRA, r6.1 step-1 prompt over gte-small's scoped top k, calibrated likelihood: S2-mean, one order, content-free `N/A` pass, `{"ops": []}` scored as an answer | LoRA | G3 gate, or the LoRA picks `{"ops": []}` |
| **C3** (k = 5 primary; k = 3 secondary) | LoRA, same prompt, greedy generation under the alternation grammar of the k answers plus `{"ops": []}` | LoRA | as C2 |
| A-base, A-LoRA (supplementary) | oracle op | base / LoRA | – |

- C2/C3 also run step 1 on items the gate sends to no-action, so a "LoRA decides no-action alone" variant is reported from the same run (C2 also gives S1-mean and S2-mean-without-none picks from the same requests). Their latency counts only what the gated pipeline runs.
- **Metrics,** per set (and per style on held-out-2): op accuracy over action items; op accuracy given the gold op is in the top k (C2/C3); args exact, `requiredPresent` and ref-id exact over action items whose op was right (as Round 6's P); end-to-end fully right (right op, exact args and refs where scored) over action items; no-action precision and recall (action items sent to no-action count as false positives); median and p90 wall time per utterance (embed + step 1 + step 2).
- **Bars.** Met when one of the primary configs (C1, C2 k=5, C3 k=5) reaches op ≥ 90% and args exact ≥ 80% (given the right op) on **both** held-out sets. Choosing the best of three configs on the same sets flatters the winner; that is stated with the result. The A configs show args quality without op errors.
- **Q&A regression check.** 15 vault questions with a short pasted context, written for this round (`eval/r8-qa-prompts.json`, not from any eval set), under the Chat tab's answer system prompt, temperature 0, 256 tokens, on base and LoRA. Each pair is judged base-better / same / LoRA-better on faithfulness to the context and fluency, with a one-line reason, and any JSON or format leakage is noted.
- **Disclosure.** For the loader I printed only field names and counts of both held-out files (items, refs, labeled candidates); no utterance or expected value of held-out-1 was read. The harness was smoke-tested on the dev set only, with the base model (C0 24/30, C2 13/30, C3 16/30 op; not results).
- **If a run breaks,** the bug is fixed, both numbers are reported, and nothing else changes.
