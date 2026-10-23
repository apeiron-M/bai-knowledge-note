# Splitting the in-browser command model: evaluation

Status: **complete** (sections 1–7). The only open item is running experiment 1 (section 7), which needs the browser. This is analysis only; nothing was trained or run in a browser. Scripts in this scratchpad: `dump_ops.py` (catalog + reducer mutation targets), `frames.py` (hand-checked frame table, `frames.json`), `classify.py` (miss classes), `extra.py` (overlap, per-model).

**Disclosure.** From the held-out-3/4 result files I read only ids, gold/picked op keys, style, difficulty and tags, never utterances. Held-out-3 has now been used by R9, E10 and this read; held-out-4 by E8, E10 and this read. Any retrain below needs a fresh blind set.

## 1. Frames from the catalog

Each of the 99 global ops gets a frame `(verb, target)`, where `verb` is one of create, add, remove, set, transition or reorder, and `target` is an entity (`doc` or a collection) plus an optional field. Frames come from the op name and the reducer's mutation (`state.X.push` means add, `splice`/`filter` means remove, an assignment means set).

- **85/99 are regular.** The frame follows mechanically and is unique within the model.
- **14 are irregular:**
  - Generic key-value ops, where the target is named in an argument: SET_METADATA_FIELD ×2, SET_METADATA_LIST_FIELD, UPDATE_VOCABULARY, UPDATE_DIMENSION, UPDATE_MAINTENANCE_THRESHOLD, TOGGLE_FEATURE, UPDATE_DIMENSION_RATIONALE.
  - Two shared frames: SET_CONTENT and PATCH_CONTENT; scalar and list metadata.
  - A multi-field bundle: UPDATE_PROJECT_INFO.
  - Overlaps: SET_GOAL_STATUS also writes `outcome`; project SET_REFERENCES overlaps knowledgeRefs in meaning.
  - Unnamed targets: wbs REORDER, which is really a reparent, and ADVANCE_PHASE.
- **12 ops have a name verb that differs from the frame verb.** Examples: CREATE_GOAL is an add, LINK_WBS a set, INGEST_SOURCE a create, TOGGLE_* a set. The mapping is still mechanical from the reducer, but it is one frame row per op that has to ship with the catalog.
- **Per model:** at most 5 verbs and at most 13 targets (project 13, knowledge-note 10, wbs 10).

### 1b. The 14 irregular ops, re-checked against the input SDL, `modelSchema` and reducer

| Op | Frame I'd give it | Why it doesn't fit cleanly | Proposed handling |
|---|---|---|---|
| derivation UPDATE_DIMENSION_RATIONALE | set `dimensionRationale[dimension]` | Upsert: it finds the entry by `dimension` (a free string with no enum), replaces it, or pushes a new one. An "add" and a "set" request both mean this op. | **Verb-agnostic target**: it is the only op on `dimensionRationale`, so add or set on that target maps to it. |
| kn PATCH_CONTENT | set `doc.content`, mode patch | Same frame as SET_CONTENT. `offset` and `removeCount` are character indices the LLM cannot produce reliably. | Exclude it from the frame layer: content edits map to SET_CONTENT. Code may compute a patch by diffing the old and new text when the dispatch should be small. |
| kn SET_METADATA_FIELD | set `doc.<field>` | The target is the enum value of `field` (18 values), so the real target sits in an argument. It shares a frame with the list variant. | **Expand into virtual targets** `doc.scope`, `doc.severity` … (18). Each maps to the op with `field` fixed by code, which also removes one step-2 enum decision. |
| kn SET_METADATA_LIST_FIELD | set `doc.<listField>` | As above, 9 list fields, `values: [String!]!`. | 9 virtual targets. Scalar vs list is decided by the target, so no shared frame is left. |
| moc SET_METADATA_FIELD | set `doc.version` | Its enum has exactly one value, `version`. | 1 virtual target `doc.version`. |
| pq ADVANCE_PHASE | transition `tasks.currentPhase` → next | A phase, not a status. It also pushes a `handoff` (phase, workDone, filesModified). | Keep `transition` with a separate field `currentPhase` and to = "next". COMPLETE_TASK stays on `status`, so the two are separated by field, not by verb. |
| project UPDATE_PROJECT_INFO | set `doc.name` and/or `doc.description` | A bundle of two optional fields; there is no SET_NAME or SET_DESCRIPTION. | 2 virtual targets mapping to one op, with only the named field filled. |
| project SET_REFERENCES | set `doc.references` (replaces the list) | `references: [URL!]!` replaces the whole list. Users say "add this link", which is an add verb. Its meaning overlaps the `knowledgeRefs` collection (PHIDs). | **Read-modify-write in code**: add or remove on `references` makes code build the new list from the current state and emit SET_REFERENCES. Label the targets "reference URLs" vs "linked knowledge documents". The same applies to wbs SET_REFERENCES, which I had marked regular. |
| vault-config UPDATE_DIMENSION | set `dimensions.<dimension>` | Keyed by an enum (8 values). | 8 virtual targets. |
| vault-config UPDATE_VOCABULARY | set `vocabulary.<key>` | Keyed by an enum (9 values). | 9 virtual targets. |
| vault-config UPDATE_MAINTENANCE_THRESHOLD | set `maintenance.<condition>` | Keyed by an enum (7 values). | 7 virtual targets. |
| vault-config TOGGLE_FEATURE | add/remove on `features` | Set membership: `enabled` true pushes, false filters. `feature` is a free string with **no closed vocabulary**. | Model it as add (enabled true) or remove (false) on collection `features`. The open vocabulary stays a step-2 span. |
| wbs REORDER | move `goals` (reparent + position) | `modelSchema` is empty: all three fields (`id`, `parentId`, `insertBefore`) are refs. The name has no target. | Add a generic verb **move**. It is the same concept as the drive's MOVE_NODE, so it belongs in the reactor layer. moc REORDER_CORE_IDEAS stays `reorder`. |
| wbs SET_GOAL_STATUS | set `goals.status` (enum to-state) | It also writes `outcome` (optional) and requires `blockReason` for BLOCKED, so it overlaps SET_OUTCOME. | Rule: a status value present → SET_GOAL_STATUS, with outcome and blockReason as args. Only an outcome → SET_OUTCOME. |

**Net:**
- 11 of 14 become regular through virtual targets, verb-agnostic targets or a separate field.
- 3 need code logic beyond a lookup: PATCH_CONTENT is excluded, SET_REFERENCES ×2 needs read-modify-write, and REORDER needs the new `move` verb.
- **Cost of virtual targets:** knowledge-note's target list grows from 10 to about 36 and vault-config's from 8 to about 29. A long target list can recreate sibling confusion one level down. Grouping them as "metadata field → which one" (two small decisions) is the mitigation. That is worth testing, not assuming.

## 2. What the op misses are (real data)

Runs: R2c dev, R2c held-out-3 (Round 8 LoRA), E10 held-out-3, E8 held-out-4 and E10 held-out-4. All are scoped, every op in catalog order, no pre-gate.

| Run | Action | Misses | Wrong verb, right target | Right verb, wrong field | Right verb, wrong entity | Wrong transition | Wrong verb + wrong target | No-action | Same frame |
|---|---|---|---|---|---|---|---|---|---|
| dev R2c (r8) | 49 | 3 | 0 | 0 | 1 | 0 | 2 | 0 | 0 |
| h3 R2c (r8) | 92 | 13 | 1 | 5 | 4 | 0 | 2 | 1 | 0 |
| h3 E10 (r10) | 92 | 15 | 2 | 5 | 3 | 0 | 4 | 1 | 0 |
| h4 E8 (r8) | 104 | 20 | 2 | 2 | 6 | 2 | 6 | 1 | 1 |
| h4 E10 (r10) | 104 | 22 | 4 | 3 | 9 | 1 | 5 | 0 | 0 |
| **Pooled** | 441 | **73** | **9** | **15** | **23** | **3** | **19** | **3** | **1** |

- **Unique items.** The pooled counts include each held-out set twice. There are about 50 unique missed items out of 245 unique action items (h3 18, h4 29, dev 3). On h3 and h4, 10 and 13 items are missed by both models, and 8 and 8 with the *same* wrong pick. Those items are hard in themselves, and no format change should be expected to recover them.
- **Implied factor accuracy.** The verb is right on 91–96% of items (h3 88/92 and 85/92, h4 95/104 and 95/104). The target is right on 81–85%. **The target is where the errors are:** 57 of 73 misses have a wrong target, and 38 have the right verb with the wrong target.
- **Typical confusions:**
  - right verb, wrong entity: SET_PROJECT_STATUS → SET_DELIVERABLE_STATUS, REMOVE_OPEN_QUESTION → REMOVE_TENSION, TOGGLE_FEATURE ↔ TOGGLE_EXTRACTION_CATEGORY, DELETE_GOAL → REMOVE_DEPENDENCIES;
  - right verb, wrong field: UPDATE_ORIENTATION → UPDATE_DESCRIPTION, SET_GOAL_STATUS → SET_OUTCOME, the vault-config `set doc.*` ops;
  - both wrong, looking like a failure to understand the paraphrase: REJECT_NOTE → REMOVE_LINK or REMOVE_TOPIC, SET_REFERENCES → ADD_KNOWLEDGE_REF.
- **By style:** 63 of 73 are paraphrases; natural-wording misses are mostly entity or field confusions.
- **A perfect verb module could fix at most 28 of 73 (38%)**, the rows where the verbs differ, and only if it beats the LoRA's implicit 91–96%. If lifecycle ops are modelled as `set(status=X)`, the 3 wrong-transition rows and dev's SET_NOTE_TYPE → SUBMIT_FOR_REVIEW become right-verb misses with a wrong value or field. The headline holds under either convention.
- **Op descriptions:** `scoringMessages` already renders `- key: description (fields: …)`. Round 10's "what next" item 3 ("the list shows only keys") is inaccurate. The 30 project/wbs ops have empty descriptions and score 25–26 of 30–34, against 51–58 of 62–70 for the rest. That is no measurable effect at this n, and it is uncontrolled.

## 3. Options

### A. The user's split, reactor layer plus model layer

- **Reactor layer.** Input: the utterance plus drive context (open document, document types with one-line descriptions, document titles). It decides:
  - the intent: drive action (create, find, open, move or rename a document, using the document-drive ops ADD_FILE, ADD_FOLDER, MOVE_NODE, UPDATE_NODE and DELETE_NODE, which are the same in every package), an in-document edit, or a question;
  - the scope (which document type or document);
  - the generic verb.
- **Model layer.** Input: the utterance, the verb and the model's target list (labels, ideally current values). It decides the target, the to-state for transitions, and the arguments.
- **What generalizes:** verbs, drive operations, the create/find/open semantics and the envelope.
- **What doesn't:** which entity or field a phrase means ("the synthesis paragraph" is `orientation`), state names, vocabularies.
- **Accuracy:** it isolates the part that is already about 93% right. The 57/73 target-side errors stay in the model layer, so the split alone should not move op accuracy much.
- **Browser:** one LoRA trained on both prompt types (multi-task). No adapter hot-swap is needed and there is no extra download.
- **Training data:**
  - reactor layer: generic, reusable across packages (drive commands, verb frames over any catalog);
  - model layer: per model, which is today's rows re-rendered.
- **Value:** reuse and the drive-level scope, not today's error mass.

### B. A generic frame, then deterministic mapping

- The model emits `{target, verb, values}`, and code maps it to the op through `frames.json`.
- **Accuracy:**
  - Verb-first changes little. The served key `model:VERB_TARGET` is already decoded verb tokens first, then the target among same-prefix siblings.
  - **Target-first** (`{"target": …, "verb": …}`) is the variant that differs from today and matches where the errors are. Expected effect: unknown, plausibly 0 to +5 points.
- **Browser cost:** none extra.
- **Training cost:** the existing 4.6k rows re-render into frames with no teacher cost, because frames are a function of the op label. The 2 shared frames need code rules: metadata is split by value type; PATCH_CONTENT stays a distinct frame. Then a retrain (about 52 min) and a fresh blind set.
- **Maintenance:** one frame row per new op, mostly derivable from the reducer.

### C. Hierarchical, scored by likelihood (target or entity first, then verb)

- The same decisions as B, done by scoring instead of generation.
- With the current LoRA it is out of distribution (it was never trained on factored prompts).
- Scoring costs latency: C2 k=5 was 1.1–1.5 s median, and the full list is about 3× that.
- Only worth it after B is trained.

### D. Per-model specialists

- 12 × 229 MB, or about 0.5 GB of memory for two at once.
- Round 10 showed that more data on the same sibling groups did not help, so capacity per model is not shown to be the limit.
- **Not recommended.** A wllama fork with GGUF LoRA hot-swap would change the cost, but that is engineering work.

### E. Factorized prompts with no training (base or LoRA)

- The base model was at 44–49% scoped in Rounds 5–6, and the LoRA would be out of distribution on these prompts.
- **Not promising.**

### F. Non-LLM verb classifier (keywords or embeddings)

- Paraphrase items avoid op words by design, and 63/73 misses are paraphrases. The LoRA's verb is already 91–96%.
- Useful only as a consistency check (for example, the request says "remove" but the pick is an ADD).

### G. Clarify or top-k confirm (the user already confirms every action)

- **Evidence from Round 8's C2 k=5 scored runs** (retired held-out-1/2; scoring, not the served R2c generation):
  - the gold op is ranked 2–3 in 16 of 19 misses;
  - a margin below 0.2 flags 24% of items and catches 15/19 errors.
- **A frame-neighbour shortlist** (ops that share the pick's verb or entity) holds the gold op in 52/70 misses with an op pick, but its median size is 6. It needs scores to rank it down to 2–3, and there are no scores for the R2c runs.
- **This changes the bar:** "gold among the offered choices" plus "extra-click rate" replaces one-shot op accuracy ≥ 90%. That is a **user decision**.

### H. Richer target context

- Current field values and collection item labels in step 1, and UI labels as target names.
- It addresses wrong-entity and wrong-field errors directly. The state schema has no field descriptions, so labels must come from the editors or be authored.
- Needs a format change and a retrain.

### I. A larger base model

- As in Round 10's "what next" list. It is orthogonal to the options above.

## 4. Recommendation

1. **Keep the user's split as code architecture, not as separate weights.**
   - Ship a frame table with the catalog. `buildCatalog` already takes any model module, so a frame derivation from reducers and input SDL ports to any package.
   - Add a generic **reactor command layer** (drive ops, scope routing) trained as an extra task in the same LoRA.
2. **For accuracy now:** confirm with alternatives (G), because the errors are near-misses within a model.
3. **For the next retrain:** a target-first frame format (B) with target context (H), not verb-first.

## 5. Experiments, cheapest first

| # | Experiment | Training? | Cost |
|---|---|---|---|
| 0 | This offline analysis (frames, miss classes, top-k from C2) | none | done |
| 1 | Top-3 confirm: R2c pick plus likelihood-scored frame neighbours (≤ 6) with the Round 8 LoRA. Measure gold among the offered choices, the ask rate and latency on dev, then on a fresh set | none (harness code) | ~0.5 day code, 1 run of ~10 min, +0.3–1 s on asked items |
| 2 | Consistency check (verb keyword vs pick's verb) as an "ask" trigger | none | hours; it can only help natural wording |
| 3 | Target-first frame format: re-render existing rows, one LoRA | retrain, no new teacher rows | render plus ~52 min train plus export; **fresh blind set needed** |
| 4 | Step 1 with current values and target labels (r6.2), on top of 3 | retrain | same as 3, plus label authoring per model |
| 5 | Reactor layer: drive-level eval set (create, open or move by title) plus generic rows from the drive schema | new data plus retrain | eval set written by the coordinator; ~$0.016/row if teacher-generated |
| 6 | Next base size (I) | retrain | larger download; a latency check first |

## 6. Risks

- The 37–39% unscoped figure (and 43% for document type from gte-small's top op) comes from held-out items written for scoped use ("this", "it"). It is not a valid baseline for a drive-level router; experiment 5 needs its own set.
- The frame retrain may simply move confusions from op keys to target labels. Round 10 shows that formats and data aimed at siblings have not moved them so far.
- Top-k confirm hides errors behind a click and needs a UX decision. Scoring the full list costs about 3× the latency.
- The 14 irregular ops need hand rules, and each package adds new irregular patterns.
- n is small: about 50 unique missed items, and 16 of them are missed by both models with the same pick.

## 7. Experiment 1 spec: top-3 confirm (ready to implement; no training)

**Question.** With the Round 8 LoRA in the served R2c pipeline, how often is the right op among up to 3 choices offered at the confirm step? What ask rate does that cost, and how many items end fully right after a simulated user pick?

**Model and pipeline (fixed):**
- Round 8 GGUF, sha256 `6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00`.
- WebGPU, temperature 0, prompt format r6.1 unchanged.
- R2c: step 1 is generated over every scoped op in catalog order; no pre-gate; step 2 uses the safe gate and calibrated ref-label scoring.
- The r6.1 prompt bytes do not change. Only extra scoring passes are added.

**Harness change** (`spike/llm-harness/r9.ts` plus `r9-metrics.ts`, unit-tested):
1. After the R2c generation, score **every** op in the same full-list step-1 prompt. Each score is the forced answer `{"ops": ["<key>"]}`, aggregated as `mean`, **uncalibrated** (S1; Round 8 found calibration no better), `offsets: [0]`, plus `{"ops": []}`.
   - Store `opScoresRaw` and the per-answer scoring ms on the row.
   - `scoreOptions` already builds this prompt from `cands`. The full list is the prompt, so no new prompt builder is needed.
2. Ship `frames.json` (this scratchpad) as a harness fixture, keyed by op key, for the neighbour shortlists.
3. Every config below is computed **offline from that one run's rows**. Only the latency of a neighbours-only product path is estimated, from the per-answer ms.
4. Step 2 runs on the LoRA's pick, as today. For the simulated pick, it also runs on the gold op whenever the gold op is offered and differs from the pick (a harness-only cost). Store both results.

**Pre-registered configs** (choices offered = the pick plus the 2 best-scored others from the shortlist):

| # | Shortlist | Ask rule |
|---|---|---|
| K0 | none | never ask (the R2c baseline; must reproduce E8 on held-out-4 exactly: 84/104 op, 68/104 fully right) |
| **K1 (primary)** | frame neighbours of the pick: same model, same verb **or** same entity (median 6) | ask when the pick is not the top S1 score **or** S1(top) − S1(second) < τ |
| K2 | every scoped op | same rule as K1 |
| K3 | frame neighbours | always ask (the coverage ceiling) |

- **τ = 0.2**, fixed now from Round 8's C2 k=5 margins on the retired held-out-1/2 (24% asked, 15/19 errors flagged there).
- The τ curve for {0, 0.05, 0.1, 0.2, 0.3, ∞} is reported, **not** used to choose a τ.
- When the pick is `{"ops": []}`, nothing is asked.

**Simulated user:**
- If not asked, the pick is final.
- If asked and gold is offered, the user picks gold.
- If asked and gold is not offered, the user picks "none of these". That counts as a miss, but with no wrong dispatch.
- No-action items: if an op is picked and asked, the user picks "none of these" (correct); if picked and not asked, it is a false action, as today.

**Metrics** (observed only; action items unless noted):
- (a) **gold within offered choices**: the final pick when not asked, the 3 choices when asked;
- (b) **ask rate**, split into asks on items the pick already had right (friction) and on items it had wrong (rescues);
- (c) **fully right after the simulated pick** (right op, exact args and refs where scored);
- (d) wrong dispatches: a wrong op taken without asking, plus false actions on no-action items;
- (e) gold-in-choices by this doc's error class (uses `frames.json`);
- (f) latency median and p90: measured for K0 and K2, and estimated for K1 from per-answer ms × shortlist size;
- (g) natural vs paraphrase.

**Sets and prior uses:**
- **Dev** (49 action + 10 no-action) first, for debugging only.
- **Primary: a fresh blind held-out-5**, written by the coordinator. That is a user decision.
- **Fallback if there is no new set: held-out-4.** It has 2 prior runs (E8, E10) plus this evaluation's read of ids, gold/pick op keys, style and tags (no utterances). This would be its **third** use. That is acceptable because nothing is trained or tuned on it and τ is fixed in advance, but it should be stated with the result.
- **Not held-out-3**: 7 runs so far (R9's six, E10) plus the read.

**Bars (pre-registered):**
- K1 on the primary set: gold within the offered choices ≥ 92%, an ask rate ≤ 30%, and fully right after the simulated pick at least 8 items above K0 per 100 action items.
- K2 is reported as the reference for whether a full-list scoring pass is worth about 2 s.

**Cost:**
- About half a day of code plus unit tests.
- One dev run of about 5 min.
- One primary run of about 8–10 min: 120 items × (about 0.45 s R2c + about 1.5–2.5 s full-list scoring + an occasional extra step 2). Scoring 16–18 answers under a shared prefix is **estimated**, not measured.
- $0 teacher cost; no training.
- Needs Chrome/WebGPU free; I did not run it.

**Risks for this experiment:**
- S1 margins from C2 k=5 lists may not transfer to full-list prompts, so τ may flag more or fewer items. The reported curve shows that.
- The simulated user is optimistic: real users may misread three similar options. Label the choices with the op's description, not the key.

## Left to do

- Run experiment 1 (section 7). It needs the browser, which was not available.
- No R2c runs have per-op scores, so G's numbers still come from C2 k=5 only. Experiment 1 produces the first R2c scores.
- Section 1b's virtual-target expansion should go into `frames.py` (it is still the 14-irregular version) before any frame retrain.
