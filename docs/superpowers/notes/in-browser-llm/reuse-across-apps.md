# Reusing the chat pipeline across apps

Tags: [src] checked, [inf] inferred, [est] estimate, [spec] speculation. Counts: `derive.py` over `document-models/*/*.json`. Paths are under `editors/knowledge-vault/chat/core/` unless stated.

## 1. Inventory

Classes: **a** = generic to the reactor, **b** = derivable from the spec, **c** = hand-written per app.

| Component | Class | Where, and how much of c could move to b |
|---|---|---|
| wllama client | a | `llm-client.ts`, `vendor/wllama/3.8.1/` |
| Model URL | c | `model-source.ts` (Round 8 stem) → manifest: URL + sha. |
| Catalog (fields, JSON Schema, zod, creators) | b | `buildCatalog` (`op-catalog.ts`) already accepts any module plus its barrel. |
| Model list | c, trivial | `catalog-models.ts`. Codegen can emit it. |
| Field overrides | c → b | 7 entries. The new-id cases could be read off reducers that `push({id: action.input.id` [spec]. |
| Vocabularies | c → b | `vocabularies.ts`: 13 closed `String` lists, none of them GraphQL enums. Declared enums flow through zod for free. |
| Refs: fields, targets, labels | fields b; targets mostly → b | `ref-candidates.ts` has 40 keys; the findings say 44, but `RECIPES` also has 40. The OID/PHID/`*Id` rule flags all 40 (51 ops in total). For 32 of 40, the reducer's `state.X.find(…action.input.f)` gives the target. The other 8 are cross-document refs (`CTX_KIND_BY_TYPE`), and PHID carries no target type, so they need a manifest hint. |
| Op descriptions | b once filled | 30/99 empty, 0 examples, 58 errors. `op-descriptions.ts` is off at runtime. Fill descriptions with `SET_OPERATION_DESCRIPTION`. |
| Prompts, grammars, gate, envelope | a | `op-scorer.ts`, `args-step.ts`, `step1-candidates.ts`, `args-grammar.ts`, `envelope.ts`. The prompts contain no app words. |
| Target document, confirm, dispatch | a | `target-document.ts` (generic; `supportedTypes` is injected). `ChatView.tsx` → `dispatchActions`. |
| Frame table | b, about 85% | 85/99 frames follow mechanically and 11 more need virtual targets. Only in a scratchpad `frames.json`; not shipped. |
| Teacher | a, except the app one-liner | `training/py/teacher.py`. `SYSTEM` says "knowledge vault app". `FIXTURES` is c. |
| Ref recipes | c, partly → b | `training/gen/ref-scenarios.ts`, 1,048 lines. Its build and check steps could be generic replay [spec]. |
| LoRA weights and teacher rows | c | Round 8: $38, about 2 h of teacher time, 81 min of training. The export produces only a merged GGUF (`merge.py`, `export-gguf.sh`). |

## 2. Approaches

**(i) Generic runtime plus a codegen manifest.**
`spec + reducers → ph generate chat-manifest → chat-core + weights → Connect chat`
- The manifest holds the catalog inputs, ref map with hints, enums, frames, descriptions and the adapter URL.
- **Precondition:** one pinned `PROMPT_FORMAT_VERSION` across apps.
- The manifest must export the `<Op>InputSchema` factories; finding them without the barrel is unproven [spec].

**(ii) Generalist vs specialist weights.**
`many specs → mixed teacher rows → one generalist LoRA → chat-core` vs `app spec → teacher → per-app adapter → base + adapter`
- What we measured: the base model is poor. The LoRA roughly doubled fully-right answers (20.6% → 42.6% and 27.5% → 57.1%; op accuracy 33.8% → 57.4% and 46.2% → 73.6%).
- That gain came with a known *wording* gap: about 93% on teacher validation rows vs 81–86% on blind sets. A generalist adds a second gap, a schema it has never seen. Round 2's "descriptions didn't help" was measured on the base model only.
- **Decision slot:** description-scoring models (Kev) are schema-agnostic. A gte-small head needs retraining for each app, but that takes minutes and needs no new asset.
- **Composition in one Connect:**
  - **Merged files:** 229 MB per app.
  - **Base + adapters:** one base GGUF per origin (OPFS is per origin) plus about 12 MB per adapter (6.0M params in f16) [inf].
  - **What wllama 3.8.1 does:** it maps `lora_adapters:[{path,scale}]` to `lora_paths` and `lora_init_without_apply`, and the wasm parses a per-request `lora:[{id,scale}]` [src].
  - **But** `prepareBlobs` names every blob as a model shard, so nothing mounts an adapter at a path. That likely needs a small wllama patch [src/inf].
  - Whether `createChatCompletion` forwards `lora` is unverified. Adding a new adapter appears to need a reload, which measured 683–1,085 ms [inf].
  - An f16 adapter on the Q4_K_M base is not the computation that Round 8 measured (merged, then quantized), so it has to be measured again.

**(iii) The training pipeline as a CLI.**
`chat-manifest → ph chat train (plan/run/label/agree → render → train → export) → adapter.gguf + eval report`
- Cost per app: about $40 of teacher calls, 2–3 h, and a 64 GB Mac (a 36 GB run was stopped, findings §7) [est].

**Shared reactor layer.**
- `document-drive` is itself a document model. Drive operations (ADD_FILE, ADD_FOLDER, MOVE_NODE, DELETE_NODE) are therefore **one more manifest**: it ships with core and is trained once upstream. The chat has no drive operations today [src].
- ADD_FILE needs a choice among the installed document types.
- Scope selection, confirm and `dispatchActions` are already generic. Search would go behind an interface (the `useGraphSearch` TODO) [spec].

## 3. Recommendation

Build **(i) with per-app adapters, packaged as (iii)**. Treat the generalist as a hypothesis to test, not the plan.

**Package boundary:**
- `@powerhousedao/chat-core`: the runtime, grammars, gate, envelope, the confirm hook, and the drive manifest with its adapter.
- Per app, generated: `document-models/<m>/v<n>/chat-manifest.ts`, plus a small hand-written `chat.overrides.ts` for cross-document refs, labels and fixtures.
- `chat-train`: the CLI.

**Cheapest test of a generalist: leave models out (LOMO).**
- **Hold out:**
  - project: 846 rows, 34 items on held-out-3/4, empty descriptions, close to wbs;
  - moc: 491 rows, 26 items, not close to any other model.
- **Training data:** drop their action and no-action rows from `round10/final-in/rows.jsonl`, then retrain.
- **Arms, on identical items:**
  - the Round 10 LoRA, E10, the ceiling. It was trained on the same 4.6k rows, so it is like-for-like;
  - the LOMO LoRA;
  - base + R2c, which has never been measured.
- **Descriptions:** LOMO and base each run twice, with the spec's descriptions and with `OP_DESCRIPTIONS` filled. E10 runs as-is, because it was trained with the empty descriptions.
- **Test sets:**
  - about 60 items from held-out-3/4. Both are reused, but the comparison is relative;
  - about 1,300 dropped teacher rows. These compare LOMO with base only, because E10 trained on them.
- **Pre-registered bar:** LOMO op accuracy within 10 points of E10 on the held-out models.
- **Effort [est]:** about 1 day: filter, render, train (40–55 min), export, a `context.model` filter in `spike/llm-harness`, and a rows → eval-item converter that replays each row's `fixture` into `state`. A Kev zero-shot arm adds about half a day.
- Manifest and package split: about 3–5 days [est].
