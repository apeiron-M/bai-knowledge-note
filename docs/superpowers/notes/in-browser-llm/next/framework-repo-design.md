# Framework repo for NL → document-model actions: proposal

[src] seen · [est] estimate · [spec] speculation.

## 0. Two findings that change the order

- **The docs are stale about C.**
  - `TRAINING-GUIDE.md` §0 and `NEW-DOCUMENT-MODEL.md` gap 7 say C is not in the browser. It is: `c-pipeline`, `fusion` and `date-resolve` are in core, and `connect-c/E2E.md` passes E0–E13 [src].
  - M1 extracts the C runtime. Regression bar: `npm run chat:parity-c` (228 items vs llama-server 46ca246), the 20-item in-browser parity check (`tests/fixtures/chat-c/`) and `tests/unit/chat-*`.
- **ph-drive is a drive app.**
  - Its one op (`SET_FILE_CONTENT`, with a sha256) is not chat-dispatchable, so the demo is the never-trained **document-drive manifest**: `ADD_FILE ADD_FOLDER COPY_NODE DELETE_NODE MOVE_NODE UPDATE_FILE UPDATE_NODE` [src].
  - It pins Powerhouse `6.2.0-dev.32`; the vault pins `6.2.2-dev.47`. Its licence is AGPL-3.0.

## 1. Repo layout: `powerhouse-nl` (pnpm workspace + uv project)

| Package | Lang | Contents |
|---|---|---|
| `nl-runtime` | TS | The core minus the vault tables, `vendor/wllama/3.8.1`, `<ChatPanel>`, cards, settings, `useChatLlm`, `PROMPT_FORMAT_VERSION` |
| `nl-manifest` (`nl generate`) | TS | Spec + reducers + barrel → chat manifest; overrides schema |
| `nl-drive` | TS | Built-in document-drive manifest, its overrides and weights pointer |
| `nl` CLI | TS orchestrator + `python/` | `init`, `teacher`, `train`, `export`, `eval` |
| `nl-eval` | Py + TS | Rig, blind-set writer kit, pre-registration |

**CLI stages** (resumable; record input/output shas):
- `teacher`: generate, contrast/stress, paraphrase and no-action, then label/agree and the dedup/leak/zod/replay chain.
- `train`: the LoRA, plus Kev optionally. Runs locally or `--host trainbox` (the existing `launch.sh` over BatchMode SSH, with rsync and sha checks).
- `export`: GGUF, shas, answer-token table.
- `eval`: rig, calibration, pre-registration.

**Why a TS orchestrator.** `training-prompt-format.test.ts` pins training prompts byte for byte to the runtime builders, so render, validate and replay stay in TS. The Python stages (`teacher`, `para*`, `dedup`, `train_lora`, `merge`, `kev/*`) run as subprocesses.

**Chat manifest (generated):** ops, JSON Schema, field classes, zod creators (via the barrel), enums/vocabularies, ref fields and targets (32/40 derivable from `state.X.find(…input.f)`), cross-document hints, state-choice/list fields, descriptions, frames, `promptFormat`, and the Powerhouse version it was read from.

**Artifact manifest (from `export`).** It holds file, bytes, sha256, the tokenizer and its answer-token table (per GGUF), Kev `servedT`, the fusion temperatures, τ, k, and `promptFormat`. The runtime refuses a mismatch: `artifactMismatch` and `answerTableMismatch` already check sha and tokenizer [src], and `promptFormat` is new.

**Powerhouse.**
- Peer ranges on `document-model`, `reactor-browser`, `react@19` and `zod@4`.
- CI against 6.2.0-dev.32 and 6.2.2-dev.47. Compatibility of `DocumentModelModule` and `dispatchActions` between them is unverified [spec].

**Drive runtime extension [spec].**
- The target is the drive, and refs are nodes (a folder by name or path).
- `ADD_FILE` picks among the installed document types (a new candidate kind) and creates a document.

## 2. Integration contract (ph-drive)

| # | App does | Codegen |
|---|---|---|
| 1 | Install `nl-runtime` and `nl-drive`; add `nl` as a dev dependency | – |
| 2 | Run `nl generate`. It writes `document-models/<m>/v<n>/chat-manifest.ts` beside `hooks.ts`, and `document-models/chat-manifest.ts` mirroring `document-models.ts`. A `ph generate` plugin comes later [spec] | yes |
| 3 | Write `chat.overrides.ts`: app one-liner, personas, cross-document hints, ref labels, person fields, non-enum vocabularies, fixtures, excluded ops | skeleton |
| 4 | Fix the spec via MCP: descriptions, enums, errors | lint flags gaps |
| 5 | Write ref pools and recipes (until the fixture generator exists) | partly |
| 6 | Write a dev set and two blind sets with the writer kit, with sha sidecars | never (blind) |
| 7 | Run `nl train`, `export` and `eval` against the NEW-DOCUMENT-MODEL §4 bars | – |
| 8 | Host the GGUFs same-origin or CSP-allowed (filename = OPFS key) | – |
| 9 | Mount `<ChatPanel manifest models documents />` | snippet |

**Required in every app:** keep configuration A (Kev off, unload, lazy Kev) reachable. C costs about 5.6 GB above baseline (E13) [src].

## 3. Migration from the spike

- **Moves verbatim** (imports only `./`, `zod` and `document-model`):
  - core: `args-*`, `c-pipeline`, `fusion`, `envelope`, `date-resolve`, `list-completion`, `kev-request`, `lora-trie`, `decision-backend`, `llm-client`, `wllama-*`, `op-scorer`, `step1-candidates`, `prompt-format`, `lfm2-template`, `generator`, `op-retriever` (C uses only `tokenize`);
  - UI: `ChatView`, the cards, `ChatModelSettings`, `use-chat-llm` and `chat-models`. They import only the core, `reactor-browser`, `document-model` and React.
- **Needs de-vaulting:**
  - `catalog-models.ts`: 12 imports, to be generated.
  - `DEFAULT_FIELD_OVERRIDES`: 7 vault keys.
  - `ref-candidates`: `REF_EXTRACTORS`, `STATE_CHOICES`, `CURRENT_LISTS`, `CTX_KIND_BY_TYPE` (`"bai/…"`) and the `"bai/project"` branch.
  - The label helpers in `target-document` and `no-action-gate`.
  - `model-manifest` `C_ARTIFACTS`/`C_FUSION`/`C_HELDOUT6`.
  - `vocabularies`, `op-descriptions` and both JSON assets.
  - `v1-pipeline`: C imports its `runStep1`/`step1Messages`/`V1_ARGS`, so split it. Drop the gte-small retrieval (`gte-embedder`, `op-embedding*`, 23 MB `vendor/onnxruntime-web`), which C never calls [src], and Round 8's `model-source`.
  - Training: `teacher.py` `SYSTEM`/`NO_ACTION_SYSTEM`/`PERSONAS`/`FIXTURES`/`PERSON_FIELDS`, `para*.py` prompts, round paths in `chain.sh`/`merge.sh`, `export-teacher-context`, `dump-catalog`, macOS `stat -f`.
- **Stays in knowledge-note:**
  - its overrides, `ref-scenarios.ts` (1,048 lines), `ref-pools.ts`, eval sets, GGUFs, the `DriveExplorer` mount and `spike/`.
- **Regression bar:** the §0 parity and unit tests. The harness (`parity-c.mts`, `server-backend`, `chat/dev/parity-c.ts`) moves; the items (`tests/fixtures/chat-c/`) stay. Add a test that the generated catalog deep-equals today's `buildRuntimeCatalog()`.

## 4. Training strategy per app

| Stage | Vault (measured) | ~10-op app [est] |
|---|---|---|
| Teacher (broad, contrast, paraphrase) | $38 + $21 + $35, ~4 h | ~$10, ~1 h |
| LoRA, 350M | 99 min | ~1.8 h, retrained on mixed rows |
| Kev-FT | 11.4 h, no checkpoints | ~12 h |
| Hand inputs and blind sets | – | 1–3 days |

- **Per-app LoRA:** cheap. Merged (229 MB), or base plus a ~12 MB adapter [inf], which needs a wllama `prepareBlobs` patch and re-measuring.
- **Per-app Kev: measure first.** Kev scores descriptions, so test the vault Kev-FT and zero-shot Kev on the drive dev set with filled descriptions. Fine-tune only if the bar is missed (saves ~12 h per app).
- **Drive manifest:** trained once, upstream; apps retrain the LoRA on drive plus own rows.
- **Calibration:** refit τ and temperatures per model pair (14 min).
- **LOMO and a generalist:** later (about 1.5 days). It decides whether new apps need retraining.

## 5. Phases

| Milestone | Exit criterion | Effort [est] |
|---|---|---|
| M1: repo + runtime | knowledge-note consumes `nl-runtime`; all parity and unit tests green | 4–6 d |
| M2: `nl generate` + overrides | the vault manifest deep-equals the hand tables | 4–6 d |
| M2b: drive extension + drive manifest (overlaps M2) | drive-target resolution, node refs, the ADD_FILE type choice | 3–5 d [spec] |
| M3: `nl` CLI | it reproduces Round 10 row counts and the X5 val check from config | 6–9 d |
| M4: ph-drive | dev and blind sets, trained, hosted, mounted; blind run and E2E as in `E2E.md` | 4–6 d + ~1.5 d wall |

**Total:** ~4–6 person-weeks [est].

**Risks:**
- Version skew and codegen drift (`Attachment` → `AttachmentRef`).
- The drive target is new runtime surface.
- Kev costs about 5 GB.
- `wllama-compat` fetches from jsdelivr in non-JSPI browsers (a CSP hole).
- Teacher usage limits; one training box.

**Decisions for you:**
1. Repo name and org.
2. Public or private.
3. Licences:
   - Framework and weights licences are separate.
   - LFM2.5 is under the LFM Open License (commercial use only under $10M revenue).
   - The `jaredpalmer/kev` licence is unverified.
   - ph-drive is AGPL.
4. GGUF hosting: HF, registry.vetra.io or the package CDN.
5. The Powerhouse peer range.
6. wllama vendoring. **Keep it inside `nl-runtime`**: npm's package has no `exports`, and the CSP blocks CDNs.
7. Merged GGUFs or adapters.
8. Drop v1 retrieval.
9. Per-app Kev.
