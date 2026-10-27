# Plan: ship configuration C into the Connect Chat tab

Date: 2026-10-27. Branch `explore/in-browser-llm`, on the branch as it is (no new branch). This is a planning document: nothing in the repo has been changed.
`$EXP` = `/private/tmp/claude-501/-Users-benjaminjordan-projects-powerhouse-bai-knowledge-note/244dfd73-afea-4295-86de-08a64fc34f82/scratchpad/exp`. `exp/blind/` was not read.

**Locked decision (the user's):** configuration C has these parts:

- **Models:** the X5 350M LoRA (`training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf`, sha `06279654…`) and Kev-FT 0.8B (`training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`, sha `30b5796e…`).
- **Fusion:** an equal-weight product, T_L 1.63 and T_K 4.0.
- **Gate:** a margin gate at τ 0.5. When it asks, it offers the fused top 3 plus "none of these".
- **Step 2:** the X6 and X9 patches, with the NORMALISED convention.
- **Dispatch:** always after the user clicks Confirm.

Held-out-6 results: op one-shot 93.5%, effective fully-correct 87.5%, ask rate 15.9%, wrong 2.7%.

---

## 0. Findings that change the brief (read first)

1. **wllama 3.8.1 can very likely run Kev-0.8B (Qwen3.5 arch). This is checked statically only; nothing has run in a browser.**
   - **What `vendor/wllama/3.8.1/wllama.wasm` contains** (checked with `strings`):
     - the `qwen35` architecture;
     - the decision types `kev`, `lev`, `nimble` and `openjev`;
     - `gated_delta_net` / `GATED_DELTA_NET`, including a **WebGPU** gated-delta-net shader. The shader also has an error string, `"Unsupported type for gated_delta_net shader"`, which is a risk;
     - the WebGPU `ssm_conv` and `ssm_scan` shader paths;
     - the System One errors: `decision model has no "systemone" template` and `decision model reads the embeddings output, enabling embedding mode`.
   - **The JS API exposes `createSystemOne(options)`.** It is documented as the "TypeSafe-compatible System One API". It posts `JSON.stringify(options)` through `sys1_req` and returns the server's JSON unchanged through `get_result`.
   - **Kev-FT was built at the same llama.cpp commit as wllama.** It was converted and quantized at `46ca246` (`kev-ft/gguf/quantize.log`: "commit 46ca246"), which is wllama 3.8.1's pin. The rig ran it natively on llama-server at that commit.
   - **Kev-FT GGUF metadata:**
     - `general.architecture qwen35`, `qwen35.decision.type kev`;
     - a `tokenizer.chat_template.systemone` template;
     - `embedding_length_out 512`, 24 blocks, full attention every 4th layer.
   - **We must use `createSystemOne`.** Scoring the options ourselves cannot reproduce the decision head's probabilities, which is what `decide.mjs` consumed.
   - **What is unverified:**
     - that it runs on WebGPU in Chrome (shader type coverage for Q4_K_M, or a silent CPU fallback);
     - the response shape inside wllama;
     - memory with two instances.

   → **Phase 0 is a hard go/no-go gate.**
2. **The fusion as registered uses the *exact* trie, not the branch-only trie.**
   - `rig/src/evaluate.py` `decide()` fuses `loraExact`, PREREGISTRATION-3 §1 says "exact trie over every scoped op + none", and held-out-6 was scored on exact.
   - Exact needs about 103 requests per item (X3: 327 ms native); branch-only needs about 6 (max 10; X3: 41 ms native).
   - **Evidence that branch-only is safe** (computed for this plan from the dev rows in `$EXP/rig/validation/kevft-x5-dev/rows.jsonl`): substituting `loraBranch` for `loraExact` at T_L 1.63 / T_K 4.0 gives **216/216 identical gate decisions** (pick, asked, offered set).
   - **Plan:** ship branch-only as a *documented deviation*, keeping `trieMode: "exact" | "branch"` as a flag. The node parity test checks both.
   - **Optional, needs coordinator approval:** repeat the agreement count descriptively on `$EXP/heldout6-run1/**/rows.jsonl`, reading only ids and scores, never items or utterances. The confirmatory run is finished; PREREG-3 §12 already lists "branch-only trie scores" as exploratory.
3. **Kev's option text is not the runtime catalog's descriptions.**
   - `rig/kev/data/catalog.json` (sha `b257573b…`) `override` equals `OP_DESCRIPTIONS` on **99/99** ops, and the runtime catalog's `description` on **0/99**. The catalog order is identical.
   - The Kev request builder must therefore use `OP_DESCRIPTIONS[key]`.
   - It must **not** use `toOptions()` / `entry.description`, which is what the LoRA prompt uses.
4. **Kev-FT's served temperature is 2.700699806213379, not 2.351** (2.351 is zero-shot Kev).
   - The rig reads it from `qwen35.decision.temperature.choice`.
   - Hardcode it in a model manifest, and assert that the loaded metadata string parses to within 1e-6 of it.
5. **wllama has no tokenize and no apply-template API.** Its glue messages are only `load`, `cmpl`, `embd`, `rrnk`, `sys1`, `gres`, `cncl` and `tbop`. The trie therefore needs two things:
   - (a) a JS renderer for LFM2's **legacy (no-jinja)** chat template. Parity against llama-server `/apply-template` pins it;
   - (b) a **precomputed answer-token table**: canonical ids for all 99 `{"ops": ["<key>"]}` answers plus `{"ops": []}`, each followed by `<|im_end|>` (7). It is generated offline from llama-server `/tokenize` and keyed by the tokenizer's identity.

   Per trie node, the prompt is a **mixed** prompt, `[templatedString, ...pathIds]`. The wasm contains the server's mixed-prompt tokenizer (`"prompt" elements must be a string, a list of tokens, … or a list of mixed strings & tokens`). It tokenizes the string with `add_special` (BOS 1) and `parse_special`, which equals `lib.ts`'s `[BOS, ...tokenize(apply-template)]`. **Unverified in the browser** → Phase 0.
6. **Pass `jinja: false` explicitly.** Today `loadLlm` passes `jinja: undefined`; the harness and the rig used `--no-jinja` / false.
7. **The no-action rule allows a shortcut.** If the LoRA's step-1 pick is `{"ops": []}`, the result is none, with no fusion and no ask (`decide()`). Kev is therefore needed only when `loraPick ≠ none`. Kev does not depend on step 1, so start the Kev call **in parallel** with step 1 at send time, and drop its result if the pick is none.
8. **Step 2 in the rig ran on the gold op.** Parity therefore needs a separate `fillArgs(op)` entry point. The gate path needs it anyway, after the user picks.
9. **NORMALISED is a scoring convention, not a transform the shipped code applies.** On kn3-02 the stored x9 arg keeps its final "." (`"…deeper flavor."`). See §2.8 for the dispatch decision the user must make.
10. **The rig's oracle data lives only in `/tmp` and a gitignored backup** (`training/artifacts/exp-2026-10-23/`). Phase 1 copies the **dev-only** fixtures into the repo, or the parity tests have no oracle.
11. **The patches apply cleanly.** `git diff 5e9c3904 HEAD -- editors tests` is empty, and `git apply --check x6-args-ship.patch` passes on HEAD. x9 applies on top of x6 (rig `build-trees.sh`). The sha of each repo copy equals the rig's `patches/` copy (`8d29e48a…` and `11737382…`).

---

## 1. Browser architecture

### 1.1 Runtime layout

```
ChatView ──> useChatC (hook) ──> chat/core/c-pipeline.ts (pure orchestration)
                                   ├─ DecisionBackend "lora"  (wllama instance #1, own worker)
                                   │    step-1 gen · trie nextDist · step-2 gen · answer path
                                   └─ DecisionBackend "kev"   (wllama instance #2, own worker)
                                        systemOne(choice over scoped ops + none)
```

- **Two `new Wllama(...)` instances.** Each wllama instance owns a `ProxyToWorker`, so this means two workers, two wasm heaps and two WebGPU devices.
  - The module import (`importWllama`) stays cached once per page.
  - Each instance serialises its own wasm calls (`runWasmCall` queue), so the LoRA's sequential trie requests never interleave with Kev.
- **The `DecisionBackend` interface** is the only seam between the browser and node:
  - `generate(messages, grammar, {maxTokens, topLogprobs})`: chat completion, as now;
  - `nextDist(prompt: (string|number)[], nProbs) → Map<id, logprob>`: a one-token completion with `n_probs`, `n_predict` 1, `temperature` 0 and `cache_prompt` true;
  - `systemOne(body) → {answers}`;
  - `meta()`.
- **Two adapters implement it:**
  - `wllama-backend.ts`, used in the browser;
  - `server-backend.ts`, used by node parity against llama-server `46ca246` (`~/.cache/bai-training/llama.cpp/build/bin/llama-server`, already on this Mac). It is a port of `rig/lib/lib.ts`.
- `CompleteJson` and `ScoreText` for step 2 keep their current shape. They are built on top of `generate`.

### 1.2 Load order and lazy loading

1. **Nothing loads until the Chat tab sends its first message.** This is unchanged; a question with no document loads only the LoRA.
2. **The LoRA loads first** (229 MB): `n_ctx` 4096, `n_parallel` 1, `jinja: false`, and `n_gpu_layers` 99999 on WebGPU.
   - It serves step 1, the trie, step 2 and the answer path.
   - The rig used `-c 4096 -np 1 --no-jinja`.
3. **Kev starts loading as soon as the LoRA is ready**, sequentially to limit the peak memory of two concurrent HeapFS copies.
   - Settings: `n_ctx` 8192 (the rig used `-c 8192`; KV is about 48 → 96 MB, see §1.3), `n_parallel` 1, and `n_batch` / `n_ubatch` left at the server defaults (2048 / 512), exactly as the rig ran.
   - Phase 0 may drop `n_ctx` to 4096 only if the in-browser parity holds and the longest dev prompt (`usage.input_tokens`) is below 3,500.
4. **If a message is sent while Kev is still loading,** the hook waits for Kev and shows its progress, because C is the measured configuration.
   - A "Use LoRA alone for this message" link sends that turn through arm A, labelled as such.
5. **Kev is never loaded when** (a) WebGPU is missing, since Kev on single-threaded CPU would take seconds, or (b) the user turned "Decision model" off in settings. Either way the tab runs arm A with a label.

### 1.3 Memory budget (estimates; Phase 0 measures them)

| Item | LoRA (X5 Q4_K_M) | Kev-FT Q4_K_M |
|---|---|---|
| GGUF bytes | 229,312,224 | 529,595,072 |
| wasm heap (HeapFS keeps the file in wasm memory; mmap) | ≈ 229 MB | ≈ 530 MB |
| WebGPU weights (uploaded copy; on Apple unified memory both copies count) | ≈ 229 MB | ≈ 530 MB |
| KV cache | LFM2 has 6 attention layers; ≈ 50 MB at 4096 (estimate) | 6 full-attention layers × 2 KV heads × 256 × 2 × f16 ≈ 12 KB/token → ≈ 96 MB at 8192, plus a few MB of recurrent state |
| Compute buffers | ≈ 100–200 MB | ≈ 150–300 MB |
| **Total (estimate)** | **≈ 0.6–0.7 GB** | **≈ 1.3–1.5 GB** |

- **Total about 1.9–2.2 GB**, an estimate.
- Phase 0 reads the real numbers:
  - `performance.measureUserAgentSpecificMemory()` where available;
  - Chrome's task manager, read by the user, because the chrome-devtools MCP cannot read the GPU process.
- **Guard:** if `navigator.deviceMemory < 8` (Chrome caps the value at 8), show "This device may not have enough memory for the decision model" and default Kev to off.

### 1.4 OPFS caching

- **Today a URL model sets `useCache: false`,** so a re-exported file under the same URL is never served stale.
- **For C, use `useCache: true` only for URLs whose file name matches a manifest entry.** The file names carry a version stem (`…-x5a-20261023-…`, `…-ft1-20261024-…`), so they are immutable by convention. Any other URL keeps `useCache: false`.
- **After load, verify identity cheaply,** with no full-file sha in the browser (`crypto.subtle.digest` cannot stream 530 MB):
  - downloaded byte count == manifest bytes;
  - `general.name`;
  - `general.architecture`;
  - Kev's `qwen35.decision.type` == `kev`;
  - the decision temperature within 1e-6.

  On a mismatch, show "Model file differs from the measured C artifacts" and mark the configuration unmeasured.
- Call `navigator.storage.persist()` once before the first cached download.
- Add "Clear cached models" (`cacheManager.clear()`) to the model settings.

### 1.5 Model URL configuration (dev now; prod is a setting)

- **New `chat/core/model-manifest.ts`** holds the C manifest. Entries are `{ role: "lora" | "kev", fileName, bytes, sha256, generalName, arch, servedT? }`.
  - The X5 entry: `LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf`, 229,312,224 B, sha `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba`.
  - The Kev-FT entry: `Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`, 529,595,072 B, sha `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23`, `generalName` `Kev-0.8B-vault-ft1`, `servedT` 2.700699806213379.
- **Settings, highest precedence first:**
  1. the tab setting (localStorage `bai.chat.loraUrl` and `bai.chat.kevUrl`; the old `bai.chat.modelUrl` migrates to `loraUrl`);
  2. the env variables `VITE_CHAT_LORA_URL` and `VITE_CHAT_KEV_URL` (`VITE_CHAT_MODEL_URL` stays an alias for the LoRA);
  3. the **dev default**: same-origin `/training/artifacts/x5-350m/gguf/<file>` and `/training/artifacts/kev-ft/gguf/<file>`. Studio's Vite serves repo paths at the root (verified for Round 8 in v1).
- **There is no production default; hosting is undecided.** The settings carry a "Model base URL" field that resolves `<base>/<fileName>` for both models.
  - Any host needs CORS for the Connect origin plus Range support (206).
  - Connect's CSP has no `connect-src` / `default-src`, so the CSP itself does not block the fetch.
  - Candidate hosts to put to the user: a private or public HF repo, an R2/S3 bucket with CORS, or a Powerhouse-hosted static origin.
- **`resolveModelSource` is replaced by `resolveCSources()`.** It returns per-role `{url, from, label, matchesManifest}` and an overall `config: "C" | "A" | "custom"`.

### 1.6 Failure modes

| Failure | Behaviour | Label |
|---|---|---|
| Kev fetch/load fails, identity mismatch, no WebGPU, Kev off | **Arm A**: X5 native greedy R2c pick, no ask, step 2 x9, Confirm | "Decision model unavailable (<reason>): LoRA alone. Held-out-6: 84.5% op one-shot, no ask step." |
| Kev `systemOne` throws for one turn | That turn runs as arm A; the next turn retries Kev; after 2 consecutive failures, Kev is disabled for the page | Per-message note "Decision model failed on this message; LoRA alone" |
| LoRA fails | No chat. Shows the error and the URL that failed (as v1 does) | – |
| Trie child missing from top-64 | Retry that node with `n_probs` 8192, as `lib.ts` does. If still missing, floor at that node's min logprob and count it in `floored`, shown in debug details | – |
| wllama compat build needed (no JSPI or memory64) | It would fetch from jsdelivr, which the CSP blocks. This is an existing open issue; fail with a clear message | "This browser needs wllama's compat build, which Connect's CSP blocks" |
| Step-1 grammar gives no listed op | Error, as in v1 (`step1Pick` null) | – |

---

## 2. The exact algorithm port (`chat/core/c-pipeline.ts` + helpers)

The reference implementations, which the browser code must reproduce:

| Part | Reference |
|---|---|
| Step 1 | `rig/src/step1.ts` |
| Trie | `rig/lib/lib.ts` `trieScore`, `promptIds`, `answerIds` |
| Kev | `rig/kev/node/decide.mjs` with `--runtime server --variant desc --wording W3` (sha `feed74fe…`) |
| Fusion and gate | `rig/src/evaluate.py` `lsm` / `decide` |
| Step 2 | `rig/src/step2.ts`, level x9 |

### 2.1 Step 1, the LoRA pick (unchanged R2c)

- `cands = catalog.filter(e => e.docType === docType && e.scope === "global")`, in catalog order.
- `messages = scoringMessages(utterance, toOptions(cands, "key"), "ops")`.
- `generate(messages, step1Grammar(cands), {maxTokens: 64, temperature: 0})`, then `step1Pick`.
- The rig passed `top_logprobs` 20, which does not affect the pick, so it is optional here.
- If `loraPick === NONE_KEY`, return no-action and take the answer path. **Kev's result is discarded and no trie is run.** This is identical to `decide()`.

### 2.2 The LoRA per-op trie scores (`chat/core/lora-trie.ts`)

- **Answers:** `[...keys, NONE_KEY]` → `forcedOpsText([k])` or `forcedOpsText([])`. Their ids come from `answer-tokens.lfm2.json` (canonical ids, plus `IM_END` 7).
  - The table is keyed by `tokenizerId` = sha256 of the GGUF's `tokenizer.ggml.tokens` and `merges`, recorded by the generator.
  - At load, compare the LoRA's `tokenizer.ggml.pre` and `n_vocab` with the table header (wllama exposes the metadata). On a mismatch, refuse and fall back to arm A, with the label "tokenizer differs".
- **Prompt:** `renderLfm2Legacy(messages)` gives the string llama-server's `/apply-template` returns under `--no-jinja`, without BOS. BOS comes from `add_special` on the first string element of the mixed prompt.
- **Trie:** a line-for-line port of `trieScore`:
  - children per prefix, in DFS order (`visit` iterates `Set` insertion order);
  - `branch` mode queries only nodes with ≥ 2 children, and `exact` mode queries every internal node;
  - `nextDist([promptString, ...path], 64)`, retried at 8192 if a needed child is missing;
  - floor at `minLp`;
  - `sum` per key. The rig summed with `reduce((a,b)=>a+b, 0)` in DFS token order; keep that order.
- **Ship `trieMode: "branch"`** (§0.2). `exact` stays available behind a dev setting and is used by parity.
- **Per-key output:** `loraScore[key]`, renaming `NONE_KEY` to `"none"` as in `step1.ts`'s `rename`.

### 2.3 Kev option logprobs (`chat/core/kev-request.ts`)

The request must be byte-equal to `decide.mjs`'s server body:

```
human = s => s.toLowerCase().replace(/[_-]+/g, " ")
state = `Request: ${utterance}`
body  = { state, questions: { q0: { type: "choice",
          instructions: `Which operation should be applied to this ${human(model)} document to carry out the request?`,
          criteria: { [human(opName_i)]: OP_DESCRIPTIONS[key_i] , …(scoped ops, catalog order)…,
                      "answer a question": "The user only asks a question about the document or wants information; no operation is applied." } } } }
```

- **Fields:**
  - `model` is the catalog `model`, e.g. `knowledge-note` → "knowledge note";
  - the candidates are the same scoped list as step 1. `kev_items.py` asserts catalog order and a single model;
  - the none option goes **last**;
  - `textInDesc` is off.
- **Uniqueness:** criteria are keyed by name, so `human(opName)` must be unique within a model and must never equal "answer a question". Add a unit test over all 12 models.
- **Call:** `kev.systemOne(body)` gives `answers.q0.probabilities[name]`. Map those back to keys in option order.
- **`logprobsT1`,** ported from `decide.mjs` `logT1`:
  - `z_i = servedT * Math.log(Math.max(p_i, 1e-300))`;
  - `lse = m + Math.log(Σ exp(z_i − m))`;
  - `kev[key_i] = z_i − lse`, with `servedT` = 2.700699806213379 from the manifest.
- **Only the one-stage call is made.** `decide.mjs` also makes a two-stage call, but the rig and fusion use only `oneStage.logprobsT1`.

### 2.4 Temperatures and fusion (`chat/core/fusion.ts`, pure)

Port of `evaluate.py`, with constants `W_LORA = W_KEV = 0.5`, `TAU = 0.5`, `K_OFFER = 3`, `T_L = 1.63` and `T_K = 4.0`:

```
lsm(d, T): m = max(v/T); z = log(Σ exp(v/T − m)) + m; return {k: v/T − z}     // Σ in opts order
opts = [...keys, "none"]; ops = keys
L = lsm(loraScore, T_L); K = lsm(kev, T_K)
s[o] = 0.5*L[o] + 0.5*K[o]  for o in opts
p = softmax(s) over opts (incl. none)        // m = max s; Z = Σ exp(s−m) in opts order
r = ops sorted by (−p[o], opts.indexOf(o))   // stable; ties → catalog order
pick = r[0]; asked = r.length > 1 && p[r[0]] − p[r[1]] < TAU; offered = asked ? r.slice(0,3) : []
```

- **Arm A, the fallback:** `pick = loraPick`, `asked = false`. Also expose `kevAlone = argmax over ops of K` ("first max in catalog order"), for debugging only.
- **Floats:** the summation order matches Python's. `Math.exp` / `Math.log` may differ from libm in the last ulp, so parity uses decisions-identical plus |Δp| ≤ 1e-9.

### 2.5 Top-3 and "none of these"

- When `asked`, the reply is `{ kind: "choose", options: offered.map(k => ({entry, p: p[k]})), noneOfThese: true }`.
- The user picks one option, which runs `fillArgs(entry)` (step 2), then shows the proposal card, then Confirm.
- **"None of these"** dispatches nothing. The tab says "Nothing changed. Try rephrasing, or name the change more directly."
  - Showing all operations is a later option and is not in this plan; the simulated user in the rig was optimistic, and "none of these" counts as no dispatch.
- **When not asked,** `fillArgs(r[0])` runs immediately. The fused pick may differ from `loraPick`; step 2 runs on the fused pick.
- **Speculative step 2 is optional, Phase 4:** while the picker is shown, precompute `fillArgs(offered[0])` on the LoRA instance. It is pure, so this is safe. Cancel it if the user picks another option.

### 2.6 No-action rule

- The LoRA's `{"ops": []}` decides none. Fusion and the gate run only when `loraPick ≠ none`.
- When Kev's top option is "answer a question" but the LoRA picked an op, the fused argmax is still over non-none ops. This matches `decide()`.

### 2.7 Step 2: x6 + x9 applied to core

- **Phase 1:**
  1. `git apply docs/…/x6-args-ship.patch`, then `git apply docs/…/x9-args2.patch`.
  2. Assert that `editors/knowledge-vault` is byte-identical to `$EXP/rig/trees/5e9c39046dcd/x9/editors/knowledge-vault` (`diff -r`).
- **What the patches change:**
  - `V1_ARGS` becomes `{gate: "safe", scoreRefs: false, scoreEnums: false, refAggregate: "mean", requireNamed: true, fixNamedEnums: true}`;
  - new files `date-resolve.ts` and `list-completion.ts`;
  - `ref-candidates.ts` gains `STATE_CHOICES` (merged inside `refCandidatesFor`), `CURRENT_LISTS` / `currentListsFor`, and the `moc` kind;
  - `v1-pipeline.ts` gains the `today` and `currentLists` options;
  - `use-chat-llm.ts` gains `today: localDate(new Date())` and `currentLists: entry => currentListsFor(entry.key, doc.state)`;
  - new tests `chat-date-resolve.test.ts` and `chat-list-completion.test.ts`, plus changes to `chat-args-grammar.test.ts`.
- **The new `fillArgs(entry, ctx)`** in `c-pipeline.ts` calls `fillArgsStep(utterance, entry, refCandidatesFor(entry.key, state, driveCtx), { ...V1_ARGS, completeJson, scoreText, cache, alwaysOffer: [], today, currentLists: currentListsFor(entry.key, state) })`.
  - This is the same call as `rig/src/step2.ts` at x9.
  - The rig merged `STATE_CHOICES` paths into the item's stored `refCandidates` only when a path was absent. The app's `refCandidatesFor` already includes them, which is equivalent for the two `STATE_CHOICES` ops. The node parity test proves this on moc3-08, moc4-10 and moc3-11.
- **`today`:** the user's local calendar date (`localDate`). In the parity test it is the item's own `today` (`conventions.today`).

### 2.8 The NORMALISED convention at dispatch (decision for the user)

- **Option N0 (default until the user decides):** dispatch step 2's args unchanged. This is what the rig scored STRICT on.
  - Under NORMALISED, which is the primary metric, the result is the same.
- **Option N1:** before `buildAction`, apply `normS` (trim, collapse whitespace, strip a trailing `[.!?,;:]` run) to **copy-span free-text leaves only**.
  - It must never touch enum, ref or `STATE_CHOICES` values, list-completion ids, dates or URLs. Reducers match those exactly; for example, `REMOVE_OPEN_QUESTION` removes the exact string.
  - It is metric-neutral for NORMALISED, because `normS` is idempotent, and it changes STRICT.
  - It strips "?" from new open questions, which is a UX cost.
- Implement N1 behind a flag (`normaliseFreeText`), off by default, and put the choice to the user. The proposal card always shows the exact value that will be dispatched.

### 2.9 Module and API shape

```ts
// chat/core/c-pipeline.ts
decideOp(utterance, doc, backends, opts) → {
  kind: "none", step1 } | { kind: "op", step1, scores:{lora, kev?, fused?, p?}, pick, asked, offered, config:"C"|"A", timings }
fillArgs(utterance, entry, doc, documents, backends, {today}) → ArgsStepResult
```

- `runV1` stays as it is, for the harness and v1 tests.
- The tab moves to `decideOp` + `fillArgs`.
- `v1Action` / `buildAction` are reused for the envelope.

---

## 3. Parity test plan

### 3.1 Committed dev oracle (Phase 1)

- **Copy dev-only rig outputs** from `$EXP/rig/validation/kevft-x5-dev/` (held-out-3 + held-out-4; no blind data) into `tests/fixtures/chat-c/`:
  - `items.jsonl`, 294 KB: utterance, docType, state, ctx, refCandidates, today, gold and labels;
  - `step1.jsonl`, 388 KB: loraPick, loraExact, loraBranch and candidates;
  - `kev.jsonl`, slimmed to `{id, candidates, servedT, oneStage.probs, oneStage.logprobsT1}`;
  - `args-x9.jsonl`, 82 KB;
  - `manifest.json`;
  - a `README.md` noting provenance: rig rev `5e9c3904`, llama.cpp `46ca246`, both GGUF shas, and the rig `FROZEN.sha256`.
- Total under about 1.2 MB. These are dev sets that are already in the repo under `spike/llm-harness/eval/heldout{3,4}-eval.json`.
- **Expected decisions.** Generate `expected-decisions.json` once with the rig's own `evaluate.decide` for both `loraExact` and `loraBranch` at 1.63/4.0, using `scripts/chat/c-expected.py`, which imports `$EXP/rig/src/evaluate.py` read-only.
  - Each entry is `{id, lora:{pick}, lora_x_kev:{pick}, gate:{pick, asked, offered}, p}`.
  - Commit the output and the generator. The generator is optional to re-run.
- **Answer-token table.** `scripts/chat/gen-answer-tokens.mts` starts or uses llama-server with the X5 GGUF and calls `/tokenize` (`add_special: false`, `parse_special: false`, `with_pieces`) on all 100 answers. It writes `editors/knowledge-vault/chat/core/answer-tokens.lfm2.json` with a header `{tokenizerSha, pre, nVocab, im_end: 7, bos: 1, generatedFrom}`.
- **Template goldens.** Add `/apply-template` outputs for one item per model (12) to the fixtures.

### 3.2 CI unit tests (`npm test`, no model)

| Test | Asserts |
|---|---|
| `tests/unit/chat-c-fusion.test.ts` | For all 216 dev single rows: `fusion.decide(loraExact, kev)` and `fusion.decide(loraBranch, kev)` equal `expected-decisions.json` (pick, asked, offered order) with \|Δp\| ≤ 1e-9; the none rule; tie-breaking by catalog order; and `logT1(oneStage.probs, 2.700699806213379)` reproduces the stored `logprobsT1` to 1e-9 |
| `tests/unit/chat-c-kev-request.test.ts` | `kevRequest()` equals decide.mjs's body (12 committed goldens, one per model, with a placeholder utterance); option names are unique per model; none is last; the text is from `OP_DESCRIPTIONS`, and the test fails if `entry.description` is used |
| `tests/unit/chat-c-trie.test.ts` | Trie topology (branch vs exact node lists and DFS order) on the committed answer table equals a stored expectation from `lib.ts`; with a mocked `nextDist` that replays per-node distributions, sums are bit-identical to a reference run of `lib.ts` on the same mock |
| `tests/unit/chat-c-template.test.ts` | `renderLfm2Legacy` equals the 12 `/apply-template` goldens byte for byte |
| `tests/unit/chat-c-answer-tokens.test.ts` | The table covers every global catalog key plus none, and every entry ends with 7 |
| `tests/unit/chat-c-manifest.test.ts` | URL resolution precedence, manifest matching, the label for C/A/custom, and `bai.chat.modelUrl` migration |
| Existing chat tests after x6+x9 | `chat-args-grammar`, `chat-date-resolve`, `chat-list-completion`, `chat-prompt-format` (r6.1 pins), `chat-v1-pipeline` and `training-prompt-format` all pass |

### 3.3 Live node parity (opt-in; `npm run chat:parity-c`, not part of `npm test`)

- **What it runs:** `scripts/chat/parity-c.mts`. It runs **the same core modules** (`c-pipeline`, `lora-trie`, `kev-request`, `fusion`, `fillArgs`) through `server-backend.ts`.
  - LoRA server: X5, `-c 4096 -np 1 --no-jinja --no-webui`.
  - Kev server: Kev-FT, `-c 8192`.
  - Both on llama-server `46ca246`.
- **What it compares,** over all 228 dev items, against the committed fixtures. These are the rig's own bars (PREREG-3 §5 step 2):
  - `loraPick` identical 228/228;
  - |Δ loraExact| and |Δ loraBranch| ≤ 0.05 nat, with every op key present;
  - Kev `logprobsT1` |Δ| = 0. The rig reproduced Kev exactly natively; allow 1e-9 for JSON float round-trip;
  - gate decisions identical 216/216 in both trie modes;
  - `fillArgs(gold op)` args identical to `args-x9.jsonl` (`args`, `raw`, `dateFixed`, `listsCompleted`) on 196/196;
  - the `renderLfm2Legacy(messages)` + mixed-prompt path gives the same `nextDist` as the rig's pure-id prompt on 5 items. This is the check that the mixed prompt tokenizes as `[BOS, ...ids]`;
  - recomputed metrics equal the stored `results.json` `dev-cv` block: op 183, ask 30 (LOSO) / all-dev pair, wrong 10, eff NORM 170. Recompute with `evaluate.py` on the new rows.
- **Output:** `PARITY OK` or a per-item diff, written to `$SCRATCH/parity-c/`, never into the repo.
- **Run time:** about 3–5 min, following the rig's 2.5 min for X5×Kev dev at x9.

### 3.4 In-browser parity (Phase 0 smoke, then a Phase 3 check)

- **Fixture:** `editors/knowledge-vault/chat/dev/parity-c-items.json`, 20 dev items with their stored rig outputs:
  - 5 gated (asked) items;
  - 2 no-action items;
  - 1 date item (prj3-05 / prj4-06 SET_TARGET_DATE);
  - 2 STATE_CHOICES items (moc3-08, moc4-10);
  - 1 REORDER_CORE_IDEAS item (moc4-07);
  - 1 SET_REFERENCES "keep" item (prj3-15);
  - 8 others across models, at least one per frequently used model.
- **The check is dev-only:** `import.meta.env.DEV`, or the `bai.chat.debug=1` localStorage flag. It is exposed as `window.__baiChatParityC()` and as a hidden "Run parity check" button in the model settings.
- **What it does:** the check runs `decideOp` + `fillArgs(gold)` with the **wllama** backends.
- **What it returns:** per-item `{pickSame, gateSame, maxΔlora, maxΔkevLogprob, argsSame}`.
- **Pass criteria** (WebGPU is not bit-identical to Metal; X3 found 119/120 agreement):
  - gate decisions identical on ≥ 19/20, and any difference must be knife-edge (|p1 − p2 − τ| < 0.02 or |Δ| between the top two < 1e-3);
  - median |Δ lora| ≤ 0.05 nat;
  - Kev |Δp| ≤ 0.01;
  - args identical on ≥ 19/20.

  Report all numbers. A failure stops Phase 3.

---

## 4. UI (ChatView, ChatProposalCard, a new ChatChoiceCard)

- **Status line, two rows.**
  - Rows: "Command model: X5 LoRA 350M (229 MB)" and "Decision model: Kev-FT 0.8B (530 MB)".
  - Each row has its own `<progress>` and states: `idle`, `downloading n%`, `loading`, `ready (load ms, cached/network)`, `error <reason>` and `off`.
  - There is one line for the configuration:
    - **C:** "Configuration C: X5 × Kev-FT, gate τ 0.5 (held-out-6: 93.5% op one-shot, 15.9% asked)".
    - **Fallback:** "LoRA alone (decision model <reason>): held-out-6 84.5% op, no ask step".
    - **Custom URLs:** "Custom models, not measured with this pipeline; expect more wrong proposals". The existing v1 warning is kept for this case.
- **Busy states per stage:**
  1. "Choosing the operation…": step 1 and Kev in parallel.
  2. "Scoring alternatives…": the trie.
  3. "Filling arguments…": step 2.

  Show per-stage ms in a collapsed "Details" row on the card.
- **`ChatChoiceCard`** is new and appears when gated.
  - Heading: "Which change did you mean?"
  - Body: three buttons, each showing the readable op name, the `OP_DESCRIPTIONS` line and the fused % (p rounded), plus a "None of these" button.
  - Focus, keyboard and `aria` follow the existing buttons.
  - Choosing an option runs `fillArgs`, then shows the proposal card. "None of these" adds a system message and dispatches nothing.
- **`ChatProposalCard`** gains a line:
  - not asked: "Chosen by X5 × Kev-FT (p 0.97)";
  - asked: "You chose this from 3 options";
  - arm A: "Chosen by the LoRA alone".
  
  Everything else is unchanged: the target document and type, the args with reference labels, the action-input details, the warning, Confirm and Cancel. It keeps `data-testid="chat-proposal"`.
- **Test ids** for E2E: `chat-choice`, `chat-choice-option-<n>`, `chat-choice-none`, `chat-config-label`, `chat-lora-status`, `chat-kev-status`.
- **Model settings** (`ModelSetting` becomes `ModelSettings`):
  - a model base URL, plus per-model URL overrides;
  - a "Decision model" on/off toggle;
  - "Clear cached models";
  - an N1 toggle (§2.8, dev-only until the user decides);
  - a dev-only "Run parity check" button.
- **DriveExplorer:** no change beyond the existing `chat` tab, which renders `ChatView`.

---

## 5. Connect E2E checks

**Setup.** The **user** starts Connect, using `ph connect studio` as v1 did. Per CLAUDE.md I do not run `ph vetra`, and I do not start servers the user has not asked for. I drive Chrome through the chrome-devtools MCP: `new_page`, `navigate_page`, `fill`, `click`, `wait_for`, `evaluate_script`, `list_console_messages`, `list_network_requests` and `performance_*`. **I do not kill Chrome or its helper processes.** If a page hangs, I close only the tab I opened (`close_page`).

| # | Check | How | Pass |
|---|---|---|---|
| E0 | Serving | `evaluate_script`: `fetch(url,{method:"HEAD"})` and a `Range: bytes=0-15` GET for both GGUF paths | 200, then 206; `content-length` equals the manifest |
| E1 | CSP | `list_console_messages` filtered for "Content Security Policy"; `list_network_requests` | 0 violations; no requests to HF or jsdelivr; both GGUFs and `wllama.wasm` from the page origin |
| E2 | Load (cold, OPFS empty, after "Clear cached models") | Send the first message on a note; read timestamps from the status rows (`performance.now()` marks exposed via `window.__baiChatTimings`) | Both models reach ready. Record per model: download ms, load ms, `info.webgpu === true`, `multithread` |
| E3 | Load (warm, OPFS) | Reload the page and send again | Record load ms; network shows no GGUF bytes (served from cache) |
| E4 | Latency per stage on WebGPU, warm | 10 scripted utterances | Record median and p90 of step 1, Kev (in parallel), trie (branch), step 2 and send→card. Budget, an estimate to confirm: send→card ≤ 1.5 s warm. Kev must not fall back to CPU (watch console for `gated_delta_net` / unsupported-type warnings with `onLog`) |
| E5 | Scripted, not gated | On a knowledge note: "tag this note with eventual consistency" | Proposal Add topic `"eventual consistency"`; Confirm dispatches `ADD_TOPIC`; revision history shows it with no error |
| E6 | Scripted, gated | One h3/h4 dev utterance the rig gated, chosen from `expected-decisions.json` with `asked: true` on a doc type present in the demo drive. Recreate its state, or pick one whose state does not matter | `chat-choice` shows the same 3 ops in the same order as the rig; choosing gold gives the proposal card; Confirm dispatches |
| E7 | "None of these" | Same gated utterance | Nothing dispatched; history unchanged; system message shown |
| E8 | No-action | A question on a note ("what is this note about?") | LoRA picks none and answers; **no Kev call** (verify with the timings object); no dispatch |
| E9 | Date / today | On a project: "set the target date to next Friday" | `targetDate` resolves against today's local date (2026-10-27, a Tuesday, gives 2026-11-06: date-resolve reads "next <weekday>" as that day of next week, weeks start Monday; "this Friday" gives 2026-10-30); shown on the card with the rule |
| E10 | Kev failure fallback | Set the Kev URL to a 404 path and send | Label switches to "LoRA alone (decision model failed to load: 404)"; proposal still appears; no ask |
| E11 | Cancel | Any proposal, Cancel | "Cancelled …; nothing dispatched"; history unchanged |
| E12 | In-browser parity | `evaluate_script`: `await window.__baiChatParityC()` | §3.4 criteria |
| E13 | Memory (user-assisted) | The user reads Chrome Task Manager (GPU process + tab) after E4 | Record. Flag if > 3 GB |

Results go to `docs/superpowers/notes/in-browser-llm/connect-c-e2e.md`, which is committed in Phase 5. Timing numbers are single-session observations and are labelled as such.

---

## 6. Phases, commits, files, QA

**QA after every phase that touches code:**

- `npm run tsc`: the 203-error baseline must not grow. Record the count, and diff the error list against the baseline.
- `npm run lint:fix`. oxlint may need the npx cache, because `node_modules/.bin` lacks it (findings §10.9).
- `npm test`: all chat tests plus the training prompt-format tests. The two `kysely-pglite-dialect` suites are known failures and are excluded.
- Output stays short: `tail` / `grep`, failures only.

Commits go on `explore/in-browser-llm` directly, in small logical steps, and are never pushed.

### Phase 0: feasibility spike (go/no-go; no repo commits except optional notes)

- **Where:** `$SCRATCH/connect-c-spike/`. Keep it out of the repo, or put a throwaway dev page behind the debug flag. Connect is not needed: use a static page served from the repo root with `npx vite` or the user's studio, opened with chrome-devtools.
- **Steps:**
  1. Load Kev-FT in wllama on WebGPU (`n_ctx` 8192). Read the metadata, then call `createSystemOne` with kn3-01's decide.mjs body. Compare `probabilities` with the stored `kev.jsonl` row, and log the response shape.
  2. Watch for CPU fallback of `GATED_DELTA_NET` / `ssm_*` (native log with `onLog`) and time 5 calls.
  3. Load X5 in a second instance. Call `createCompletion({prompt: [templated, ...ids], n_predict: 1, n_probs: 64, temperature: 0, cache_prompt: true})` and confirm that the response carries token **ids** with logprobs. The field may be `completion_probabilities[0].top_logprobs[].id` or OAI `choices[0].logprobs`; record which. Compare with a native `/completion` on the same ids.
  4. Time branch vs exact trie on 3 items.
  5. Note memory.
- **Go:** Kev runs on WebGPU with |Δp| ≤ 0.01 to native, the mixed prompt works with ids, and memory is acceptable.
- **No-go paths:**
  - Kev does not load or falls back to CPU: report it. The options are a wllama rebuild with a newer pin (estimate 1–2 days), shipping arm A only, or D-style hosting. **The user decides.**
  - Mixed prompts are not accepted: use pure-id prompts. That needs prompt ids, which needs a JS LFM2 BPE tokenizer (heavy) or a wllama patch exposing tokenize (a rebuild). **Escalate.**

### Phase 1: args patches and fixtures (3 commits)

1. `feat(chat): X6 args ship patch in core`. Run `git apply x6-args-ship.patch`; it touches `args-grammar.ts`, `args-step.ts`, `v1-pipeline.ts` and `tests/unit/chat-args-grammar.test.ts`. Then QA.
2. `feat(chat): X9 args (today, state choices, list completion) in core and the tab`. Run `git apply x9-args2.patch`.
   - New: `date-resolve.ts`, `list-completion.ts` and two tests.
   - Changed: `args-step.ts`, `op-catalog.ts`, `ref-candidates.ts`, `v1-pipeline.ts` and `hooks/use-chat-llm.ts`.
   - Assert `diff -r editors/knowledge-vault $EXP/rig/trees/5e9c39046dcd/x9/editors/knowledge-vault` is empty, then QA.
   - Note in the commit body that the patches were measured out of sample on held-out-5 and held-out-6.
3. `test(chat): dev oracle fixtures for configuration C`. Add `tests/fixtures/chat-c/*` (§3.1), `scripts/chat/c-expected.py`, `scripts/chat/gen-answer-tokens.mts` and `editors/knowledge-vault/chat/core/answer-tokens.lfm2.json`.

### Phase 2: core port, pure first (4 commits)

4. `feat(chat): C fusion and margin gate`. Add `chat/core/fusion.ts` (lsm, logT1, decide, top-3), `chat/core/model-manifest.ts` (T_L, T_K, τ, k, servedT, artifacts) and `tests/unit/chat-c-fusion.test.ts`.
5. `feat(chat): Kev System One request builder`. Add `chat/core/kev-request.ts` and `tests/unit/chat-c-kev-request.test.ts` with its goldens.
6. `feat(chat): canonical token-id trie for step-1 scores`:
   - `chat/core/lora-trie.ts` (the port of `trieScore`, plus `answerIdsFor(keys)` from the table);
   - `chat/core/lfm2-template.ts` (`renderLfm2Legacy`);
   - `chat/core/decision-backend.ts` (the interface);
   - the trie and template tests.
7. `feat(chat): C pipeline (decideOp + fillArgs) with arm-A fallback`.
   - Add `chat/core/c-pipeline.ts`.
   - `v1-pipeline.ts` keeps `runV1`; extract a shared `step1(...)` helper so step 1 is not duplicated, and keep the r6.1 bytes.
   - Add a unit test with a mock backend covering: none skips Kev; Kev failure gives A; asked gives the offered list; not asked fills r[0].

### Phase 3: backends and parity (3 commits)

8. `feat(chat): wllama backend for two instances (LoRA + Kev)`.
   - `llm-client.ts`:
     - add `loadDecisionModel()` (Kev), with metadata identity checks;
     - pass `jinja: false` explicitly;
     - add `useCache` per manifest;
     - add `nextDist` via `createCompletion`, and `systemOne`.
   - `wllama-types.ts`: add the `createCompletion` (non-chat; prompt `string | (string|number)[]`; `n_probs`, `n_predict`, `cache_prompt`), `createSystemOne` and `metadata` / `getLoadedContextInfo` types, typed from the Phase 0 observed shapes.
   - Add `chat/core/wllama-backend.ts`.
9. `test(chat): node parity of C against llama-server 46ca246`. Add `chat/core/server-backend.ts` (the `lib.ts` port; node only, never imported by the browser chunk), `scripts/chat/parity-c.mts`, and `package.json` script `chat:parity-c`. Run it to PARITY OK and record the summary in the commit body.
10. `feat(chat): in-browser parity check (dev only)`. Add `chat/dev/parity-c-items.json` and `chat/dev/parity-c.ts`, exposed behind the debug flag.

### Phase 4: hook and UI (3 commits)

11. `feat(chat): useChatC hook: two models, lazy Kev, fallback labels`.
    - `hooks/use-chat-llm.ts` is either refactored in place, or a new `hooks/use-chat-c.ts` is added with the v1 hook kept for the harness. Prefer in-place to avoid two code paths in the tab.
    - It handles: per-model status and progress; Kev after the LoRA; Kev in parallel with step 1 per turn; `choose` replies; `fill(op)`; timings; `deviceMemory` / WebGPU guards.
    - `chat/core/model-source.ts` becomes `resolveCSources` (keep `resolveModelSource` as a thin alias, or delete it with its test updated); update `tests/unit/chat-model-source.test.ts`.
12. `feat(chat): gate picker and proposal provenance`. New `components/ChatChoiceCard.tsx`. Changes to `ChatView.tsx` (choose flow, "None of these", stage labels, two status rows, settings) and `ChatProposalCard.tsx` (the provenance line).
13. `feat(chat): model settings for C (base URL, decision model toggle, cache clear)`. Changes to `ChatView.tsx` `ModelSettings`. Optional N1 flag plumbing goes in `c-pipeline.ts`.

### Phase 5: E2E and docs (1–2 commits)

14. Run §5 E0–E13 with the user's Connect. Fix what breaks, with separate `fix(chat): …` commits.
15. `docs(spike): configuration C in Connect: E2E results and latency`.
    - Add `docs/superpowers/notes/in-browser-llm/connect-c-e2e.md`.
    - Add a handoff `UPDATE 7`.
    - Update findings §2, the "how to load C" instructions.

### Files

- **New:**
  - `chat/core/{fusion,kev-request,lora-trie,lfm2-template,decision-backend,wllama-backend,server-backend,c-pipeline,model-manifest}.ts`;
  - `chat/core/answer-tokens.lfm2.json`;
  - `chat/dev/{parity-c.ts,parity-c-items.json}`;
  - `components/ChatChoiceCard.tsx`;
  - `scripts/chat/{gen-answer-tokens.mts,c-expected.py,parity-c.mts}`;
  - `tests/fixtures/chat-c/*`;
  - `tests/unit/chat-c-{fusion,kev-request,trie,template,answer-tokens,manifest}.test.ts`;
  - from the patches: `chat/core/{date-resolve,list-completion}.ts` and `tests/unit/chat-{date-resolve,list-completion}.test.ts`.
- **Changed:**
  - `chat/core/{args-grammar,args-step,op-catalog,ref-candidates,v1-pipeline,llm-client,wllama-types,model-source}.ts`;
  - `hooks/use-chat-llm.ts`;
  - `components/{ChatView,ChatProposalCard}.tsx`;
  - `tests/unit/{chat-args-grammar,chat-model-source}.test.ts`;
  - `package.json` (one script).
- **Not changed:**
  - `vendor/wllama/3.8.1/*`, which stays unmodified;
  - `scripts/copy-runtime-assets.mjs`. The GGUFs are not packaged: they are hosted at a URL. wllama's wasm is already emitted by the bundler. Revisit only if production hosting becomes the package origin;
  - `DriveExplorer.tsx`;
  - anything under `document-models/`.

---

## 7. Risks and unknowns

| Risk | Likelihood | Mitigation |
|---|---|---|
| Kev on WebGPU: unsupported tensor type for `gated_delta_net` → CPU fallback (slow) or crash | medium | Phase 0 gate; `onLog` capture; fall back to arm A; a wllama rebuild is the user's call |
| `createCompletion` mixed prompt / ids in `n_probs` output not as expected | low–medium | Phase 0 step 3; pure-id fallback needs a tokenizer, so escalate |
| Two instances: memory ≈ 2 GB, tab OOM on 8 GB machines | medium | Sequential load, `deviceMemory` guard, Kev toggle, measure in E13 |
| WebGPU numerics flip knife-edge gate decisions vs Metal | low (X3: 1/120) | Tolerance-based in-browser parity; report |
| Branch vs exact deviates on real traffic | low (216/216 dev) | Flag; optional descriptive held-out-6 check; `exact` available |
| Kev latency (≈130 ms native, maybe 2–4× on WebGPU) | – | Run in parallel with step 1; measure E4 |
| LFM2 hybrid prefix-cache reuse in wllama for trie requests | unknown | Branch mode keeps it to ≤ 10 requests; measure |
| `jinja` default differs (undefined vs false) | low | Pass false explicitly; the template parity test |
| OPFS staleness under the same URL | low | Manifest-matched URLs only; identity check after load |
| No production host | certain (open) | A setting; the user decides (HF / bucket / Powerhouse origin), with CORS + Range |
| Compat-build browsers (Safari or Firefox without JSPI/memory64) | known | Clear error; out of scope |
| N1 normalisation strips "?" from questions | – | Off by default; the user decides |
| Held-out numbers assume the optimistic user (always picks gold when offered) | known | State it in the label tooltip; real users may pick wrong |
| x9 rules were tuned in-sample on dev | known | Already tested out of sample on held-out-5 and held-out-6 |

## 8. Open questions for the user

1. N0 or N1 at dispatch (§2.8).
2. The production GGUF host.
3. Accept branch-only as a documented deviation (216/216 on dev)? Optionally, run the descriptive held-out-6 rows check.
4. If Phase 0 fails for Kev: wllama rebuild vs ship arm A.
5. Whether "None of these" should later open a full op list.
