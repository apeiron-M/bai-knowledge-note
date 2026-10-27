# Generic vs document-model-specific: inventory

Every piece of the chat pipeline and its training is listed below, with a class:

| Class | Meaning |
|---|---|
| **G** | Generic. Works for any app or document model unchanged. |
| **G\*** | Generic code that still contains this app's wording, paths or constants. It needs a small change before reuse. |
| **D** | Derivable from a document-model spec (`schema.graphql`, `<model>.json`, the generated zod `<Op>InputSchema()`, the reducers). **D-auto** means it is already derived; **D-possible** means it is hand-written today but could be generated. |
| **H** | Hand-written per document model or app today. |
| **B** | Specific to a base model (LFM2.5 / Kev / Qwen3.5) or to the pinned llama.cpp/wllama, not to the app. |

Tags in the notes: **[est]** estimate, **[inf]** inferred, **[spec]** speculative or untested.

This updates `docs/superpowers/notes/in-browser-llm/reuse-across-apps.md` (classes a/b/c there map to G/D/H here) for what was built since: X5–X12, Kev-FT, the rig, the X6/X9 argument fixes and gate calibration. Unless a path says otherwise, chat-core paths are under `editors/knowledge-vault/chat/core/`. "Backup" means the gitignored `training/artifacts/exp-2026-10-23/`, a copy of the session `exp/` root named in the 2026-10-23 handoff.

## Spec counts (re-run 2026-10-27: `python3 docs/superpowers/notes/in-browser-llm/derive.py` over `document-models/*/*.json`)

| Measure | Count |
|---|---|
| Global ops | 99, in 12 models |
| Ops with an **empty spec description** | **30** |
| Operation examples in the specs | 0 |
| Operation errors declared | 58 |
| Ops with a ref-like input field (OID / PHID / `*Id` / `*Ref`, not a new id) | 51 |
| … of which PHID- or `*Ref`-named (cross-document) | 13 |
| Ref ops with a hand-written extractor (`REF_EXTRACTORS`) | 40 |
| … whose target collection the reducer reveals (`state.X.find(… action.input.f)`) | 32 of 40 |
| … not derivable that way | 8: `knowledge-note:ADD_LINK`, `ADD_TOPIC`, `SET_PROVENANCE`; `pipeline-queue:ADD_TASK`; `project:ADD_DELIVERABLE`, `LINK_WBS`; `wbs:ADD_DEPENDENCIES`, `SET_PROJECT_REF` |
| Closed `String` vocabularies (`vocabularies.ts`) | 13 lists; none are GraphQL enums |
| Input fields typed `String` / enum-like | 138 / 12 |
| Field-class overrides (`DEFAULT_FIELD_OVERRIDES`) | 7 |

## 1. Runtime (what the browser runs; also the source of training prompt bytes)

| Piece | Path | Class | Notes |
|---|---|---|---|
| wllama client, types, vendored wasm | `llm-client.ts`, `wllama-types.ts`, `vendor/wllama/3.8.1/` | G / B | B: pinned to llama.cpp 46ca246. Two instances are needed for C (unbuilt). |
| Catalog builder | `op-catalog.ts` `buildCatalog` | G | Accepts any document-model module plus its barrel (zod creators). Field classes come from prefix rules (new-id, DateTime, actor, ref-id, semantic). |
| Field-class overrides | `op-catalog.ts` `DEFAULT_FIELD_OVERRIDES` | H → D-possible | 7 entries. The new-id cases can be read off reducers that `push({id: action.input.id…})`. |
| Model list | `catalog-models.ts` `CATALOG_MODELS` | H (trivial) → D-possible | One import per model. Codegen can emit it. |
| Canonical vocabularies | `vocabularies.ts` | H → D-possible | Closed lists the spec types as `String`. If they were declared as GraphQL enums, zod would carry them for free. |
| Op descriptions in the catalog | each model's `<model>.json` `description` | D-auto, but 30/99 empty | Fill them with `SET_OPERATION_DESCRIPTION` via MCP (project CLAUDE.md). The LoRA's step-1 prompt shows op keys, so it barely uses descriptions. Kev uses them as its option text. |
| Hand-written op descriptions | `op-descriptions.ts` `OP_DESCRIPTIONS` (all 99) | H | Off for the LoRA at runtime; **Kev's option text and training criteria** (`x4-kev/data/catalog.json` via `dump-catalog.ts`). Descriptions gave Kev +8–20 items over bare names. This becomes D once the spec descriptions are good enough. |
| Ref fields | `op-catalog.ts` ref-id rule | D-auto | The OID/PHID/`/Id$/` rule flags all 40 ref ops. `sessionId`, `batchId` and `topicDocumentId` are flagged too, but have no runtime candidates. |
| Ref targets and labels | `ref-candidates.ts` `REF_EXTRACTORS` (40 keys) | H; targets D-possible for 32/40 | Labels follow the training convention (goal description, member name, …). A parity test pins them to `ref-scenarios.ts`. |
| Cross-document ref kinds | `ref-candidates.ts` `CTX_KIND_BY_TYPE`, `driveRefContext` | H | PHID carries no target type, so it needs a manifest hint. |
| State choices for free-text fields (X9) | `STATE_CHOICES` in `x9-args2.patch` | H | 2 ops (`moc:REMOVE_OPEN_QUESTION`, `REMOVE_CHILD_MOC`). **D-possible**: the reducer removes the exact string from a state list. |
| List completion (X9) | `CURRENT_LISTS` (H, 3 ops) + `list-completion.ts` (G) in `x9-args2.patch` | H + G | The `order` / `keep` cue lists are English and generic. Which fields replace a whole list is D-possible from reducers (`state.X = input.X`). |
| Date resolver (X9) | `date-resolve.ts` in `x9-args2.patch` | G | Fires on any op with exactly one date field. |
| X6 argument fixes | `x6-args-ship.patch` (`scoreRefs: false`, span edges, selector `value` rule, `requireNamed`, `fixNamedEnums`) | G | The selector rule is narrowed to a field named `value`, a naming convention. |
| Prompts, grammars, envelope | `op-scorer.ts`, `args-step.ts`, `args-grammar.ts`, `step1-candidates.ts`, `envelope.ts`, `prompt-format.ts`, `v1-pipeline.ts`, `no-action-gate.ts` | G | The prompts contain no app words. `PROMPT_FORMAT_VERSION` must be shared by every app that shares weights. |
| Target document, confirm, dispatch | `target-document.ts`, `ChatView.tsx` → `dispatchActions` | G | `supportedTypes` is injected. |
| Op embeddings (retrieval, top-k) | `op-embeddings.gte-small.json` via `scripts/gen-op-embeddings.ts` | D-auto | Regenerate after any catalog change (`--check` detects a stale file). |
| Model URL | `model-source.ts` (`ROUND8_GGUF_STEM`) | H | Points at Round 8, not C. It belongs in a manifest (URL + sha). |
| Fusion + margin gate | `exp/x7-fusion/code/fuse.py`, `gates.py` (backup only) | G | Procedure only. **Not in the runtime.** T values are per model pair (section 5). |
| Frame table | scratchpad `frames.json` (reuse-across-apps) | D-possible (85/99) | Not shipped and not used by C. |

## 2. Teacher data generation

| Piece | Path | Class | Notes |
|---|---|---|---|
| Teacher context export | `training/gen/export-teacher-context.ts` | G\* | Imports `CATALOG_MODELS` from the vault editor. It finds the model dir by grepping `<model>.json` for the docType and reads reducers from `v1/src/reducers/<module>.ts`. Otherwise everything is spec-derived (D-auto). |
| Teacher runner (`claude -p` isolation, retries, journal, 429/auth stop, budget) | `training/py/teacher.py` `run`, `submit`, `collect` | G | |
| Account-context leak filter | `teacher.py` `context_leak_terms()`, used by `rows` | G | Terms come from the logged-in account, `$USER` and the home path. It weakens silently if `claude auth status` returns nothing. |
| Generation prompts | `teacher.py` `SYSTEM`, `NO_ACTION_SYSTEM` | **G\*** | Both say "personal knowledge vault app". Otherwise generic. |
| Wording specs (registers, lengths, forms, op-word rule, two-sided quota) | `teacher.py` `item_specs`, `spec_text`, `op_words`, `wording_quota` | G | Op words are derived from op names. |
| Personas | `teacher.py` `PERSONAS` | H (soft) | Six vault-flavoured personas. |
| Person-field names | `teacher.py` `PERSON_FIELDS`, `PERSON_OPS` | H | Which fields name a person. D-possible only with a schema annotation. |
| Replay fixtures | `teacher.py` `FIXTURES` | H → D-possible | Lifecycle preconditions (SUBMIT before APPROVE/REJECT; CREATE_TENSION before tension ops). Derivable from the reducers' status checks plus the declared errors [spec]. |
| Pilot / comparison op lists | `teacher.py` `PILOT_OPS`, pilot-2 and `BATCHCMP_OPS` lists | H | Experiment-only. Not needed for a full `--ops all` run. |
| Ref-op recipes (build state, candidate paths, assign, check) | `training/gen/ref-scenarios.ts` (40 recipes, 1,048 lines) | **H** | The largest per-model cost. Build and check could become generic replay plus a post-condition derived from the reducer [spec]. |
| Ref pools | `training/gen/ref-pools.ts` | H (entity kinds) + G (people, contexts) | The themes hold per-entity label lists (goals, deliverables, topics, notes, tasks, tensions, claims). A new model needs its own entity lists. |
| Sibling groups (contrast) | `training/py/sibling_groups.py` | D-auto + H | Groups come from the catalog (same entity, lifecycle, free-text property). Confusion pairs come from dev result files hardcoded as `DEV_RUNS` (`spike/llm-harness/eval/results-r9-*-dev.json`). |
| Contrast / stress planners | `teacher.py plan --ops contrast|stress` | G | Stress specs come from the field kinds (D-auto). |
| Paraphrase rewrites (Round 11) | `training/round11-para/para.py`, `chain.sh`, `merge.sh` | **G\*** | `REWRITE_SYSTEM` says "personal knowledge vault app". `BLIND_FILES` names heldout5/6. `chain.sh`/`merge.sh` hardcode `round10/` artifact paths. The value-derivation rule and styles are generic. |
| Round 12 rewrites, contrast pairs, no-action | `training/round12-para/para12.py`, `chain.sh`, `merge.sh` | **G\*** | `NOACTION_SYSTEM` says "personal knowledge vault app". The no-action categories are generic. It requires `BAI_BLIND_DIR`. |
| Blind relabel and agreement | `teacher.py label`, `agree`, `labelcmp`, `mix`; `LABEL_SYSTEM` | G | The label prompt says "a document app". |

## 3. Validation, rendering, training, export

| Piece | Path | Class | Notes |
|---|---|---|---|
| Leak and duplicate filter | `training/py/dedup.py` | G | `DEFAULT_EVAL_DIRS = spike/llm-harness/eval/`. `--eval` / `--eval-dir` add more. |
| Paraphrase leak filter with blind sets | `para.py leak`, `promptcheck`, `mirror` | G | Uses `$BAI_BLIND_DIR`. |
| Vocabulary / zod / replay / ref checks | `training/gen/validate-rows.ts`, `replay.ts` | G | Driven by the catalog. Fixtures come from the rows. |
| Renderer (step-1/step-2 through the chat-core builders) | `training/gen/prompt-format.ts`, `render-prompts.ts`, `gbnf-check.ts` | G\* | They import from `editors/knowledge-vault/chat/core/`. Moving to a `chat-core` package is a path change. |
| Template / token parity | `training/py/render_template.py`, `llama_server.py` | B | LFM2 template, BOS and `<|im_end|>`. |
| One-command render | `training/scripts/render.sh` | G | |
| Split | `training/py/split.py` | G | |
| LoRA trainer | `training/py/train_lora.py` | G / B | Any HF causal LM (`--base`). Defaults to LFM2.5-350M. |
| Merge | `training/py/merge.py` | G | |
| GGUF export | `training/scripts/export-gguf.sh` | B | Carries Liquid's published chat template over (`TEMPLATE_GGUF`). Uses macOS `stat -f` and `/usr/bin/time -l`. |
| Toolchain setup | `training/scripts/setup.sh` | B | Pins llama.cpp b11364 and downloads LFM2.5 weights. Never re-run from a clean machine. |
| Memory watchdog | `training/scripts/watchdog.sh` | G (macOS) | |
| Remote launcher | Constantine `~/bai-training/launch.sh` | G | **Not in the repo.** |
| Round reports | `training/py/r8_report.py`, `r8_errors.py`, `r10_report.py`, `batchcmp.py` | G\* | Tied to the browser harness's result format and file names. |

## 4. Kev (second step-1 expert)

| Piece | Path | Class | Notes |
|---|---|---|---|
| Kev training data converter | `x4-kev/code/to_kev_jsonl.py` (backup) | G | Needs `catalog.json` and the val ids. Its wording template ("Which operation should be applied to this <model> document…") is generic. |
| Kev option catalog | `x4-kev/code/dump-catalog.ts` → `x4-kev/data/catalog.json` (`b257573b…`) | G\* + H data | Imports the vault catalog. The option text is `OP_DESCRIPTIONS` (H). |
| Fine-tune recipe | `x4-kev/finetune/constantine-recipe.sh`; Constantine `~/x4/launch-kev-ft.sh`, `~/x4/watchdog-kev.sh` | G / B | Pins Kev 2074cc44, `kev-0.8b@bf75a6a8` and `Qwen3.5-0.8B-Base@dc7cdfe2`. **Not in the repo.** |
| Calibrate + export | `kev.benchmark`, Kev's `scripts/calibrate_checkpoint.py`, `x4-kev/finetune/kev-ft-export.sh`, `x4-kev/export/convert-kev08.sh` | G / B | `kev-ft-export.sh` hardcodes the session scratchpad path. |
| Kev decider (scoring) | `x4-kev/node/decide.mjs` (frozen copy in `rig/kev/`) | G | |

## 5. Evaluation and calibration

| Piece | Path | Class | Notes |
|---|---|---|---|
| Eval rig | `exp/rig/rig.sh`, `src/*.py|ts`, `lib/lib.ts` (backup; README committed as `rig-README.md`) | G | Takes any set in the held-out schema (`--set file:<path>`). It builds patched trees from `git archive` of this repo. **Not in the repo.** |
| Rig Kev catalog | `rig/kev/catalog.json` | H data | Per app. Derived from `OP_DESCRIPTIONS`. |
| Exclusion (training-row leaks vs eval items) | `rig/src/exclude.py` | G | Reuses `dedup.leak_hit`. |
| Pre-registration runner | `rig/src/prereg.py` | G | Checks the sha sidecar and the `rig-run` blocks. |
| Temperature fit (G2) and gate (τ 0.5, k 3, equal weights, none rule) | `rig/src/evaluate.py` (`--temps dev-cv`), `rig/validation/gate-calibration/calib.py` | G procedure, per-model values | Fit again for every new LoRA or Kev, on that app's dev set. |
| Analysis for a given pre-registration | `exp/x7-fusion/code/prereg{2,3}_analysis.py` | G\* | Written for specific arms. |
| Browser harness | `spike/llm-harness/` (`r8.ts`, `r9.ts`, `v1.ts`, …) | G\* | Runs the real chat core in the browser. It is tied to this app's catalog. |
| Dev sets | `spike/llm-harness/eval/heldout{,2,3,4}-eval.json`, `dev-extra.json`; READMEs in `docs/superpowers/notes/in-browser-llm/heldout*-eval.README.md` | **H** | Written blind by an isolated agent from spec files only. |
| Blind sets | `exp/blind/heldout{5,6}/` (also `BAI_BLIND_DIR`) | **H** | Never opened by experiment agents. |
| Eval-set builder / validator / zod check / overlap scripts | `build_heldout4.py`, `validate_heldout4.py`, `zodcheck4.mts`, `overlap_heldout4.py` (named in the held-out-4 README) | G\* | **Not in the repo** (they were session scratch). |
| Scoring (STRICT `scoreArgRow`, NORMALISED trailing-punctuation fold) | harness `spike/llm-harness/r6.ts` (`scoreArgRow`) and rig `src/step2.ts` | G | |

## 6. What a new document model actually costs, by class

| Class | Pieces | Effort per model [est] |
|---|---|---|
| G | Runtime grammar and prompts, teacher runner, validation chain, trainer, merge, rig, calibration procedure | 0 |
| G\* | Three teacher system prompts, renderer import paths, paraphrase chain paths, `dump-catalog.ts`, `export-teacher-context.ts` | One-off cleanup (see the tooling gaps in `NEW-DOCUMENT-MODEL.md`), then 0 |
| D | Catalog, fields, ref fields, zod, op embeddings, sibling groups, op words; derivable but not yet derived: model list, new-id overrides, 32/40 ref targets, list-replacing fields, fixtures | 0 once a manifest generator exists. About 1 h by hand today. |
| H | Vocabularies, `OP_DESCRIPTIONS` (or filled spec descriptions), `REF_EXTRACTORS` labels and cross-document hints, `ref-scenarios.ts` recipes and `ref-pools.ts` entity lists, `FIXTURES`, person fields, `STATE_CHOICES` / `CURRENT_LISTS`, dev and blind eval sets | 1–3 days, dominated by ref recipes (about 25 lines per ref op) and two blind eval sets |
| Compute | Teacher data and LoRA + Kev training, sized for all models together | See `NEW-DOCUMENT-MODEL.md` §5 |
