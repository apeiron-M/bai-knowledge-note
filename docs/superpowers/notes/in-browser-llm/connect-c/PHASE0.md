# Phase 0 results: configuration C in wllama 3.8.1 (browser, WebGPU)

Date: 2026-10-27. Chrome 155 on this Mac (Apple, metal-3 adapter, `shader-f16`, maxBufferSize 4 GiB), wllama 3.8.1 vendored (libllama `b11364-46ca246`).
Harness: `spike/llm-harness` on Vite :5199, with the new `phase0.ts` driven through the chrome-devtools MCP.
The GGUFs were served from their gitignored paths (`/x5/`, `/kevft/` mounts). The fixtures came from native llama-server 46ca246 (X5, `-c 4096 -np 1 --no-jinja`) and from the stored dev rig rows (`rig/validation/kevft-x5-dev`, dev only).
Scratch: `$SCRATCH/connect-c-spike/` holds the generator scripts, `fx/`, the raw browser result JSON and the native logs. `exp/blind/` was not read.

## Verdict: GO, conditional on two plan changes

1. **Kev |Δp| bar.** The stated bar is |Δp| ≤ 0.01, and WebGPU missed it on 3 of 6 items (max 0.039). However, native llama.cpp CPU vs native Metal differs by **more** on the same items (max 0.064). All 6 gate decisions were identical, in both trie modes.
   - Proposed bar: the gate decision (pick, asked, offered set and order) must be identical, plus |Δp| ≤ 0.05.
   - **This needs the coordinator's or user's acceptance.**
2. **No token-id prompts in wllama.** `createCompletion` throws on any non-string `prompt`: `[json.exception.type_error.302] type must be string, but is array`. This applies to pure ids, mixed arrays and arrays of strings.
   - The workaround is **string prompts**: the templated string followed by the concatenated answer pieces.
   - This was verified natively for **1,685/1,685** trie nodes: all 12 models × all 99 global ops + none × every prefix. `tokenize(templated + text(prefix))` equals `tokenize(templated) ++ prefix ids` with no exceptions.
   - The plan's §0.5 / §2.2 "mixed prompt" becomes a string prompt. The answer table needs `pieces` as well as ids.
   - No JS tokenizer and no wllama rebuild are needed.

## 1. Kev-FT on WebGPU

**Load**
- 529,595,072 B, `general.architecture qwen35`, `qwen35.decision.type kev`, `general.name Kev-0.8B-vault-ft1`.
- `qwen35.decision.temperature.choice` = `"2.700700"`. The metadata string is rounded to 6 dp; it is within 1e-6 of 2.700699806213379, so the check passes.
- Offloaded 25/25 layers to WebGPU.
- The graph has `splits = 2`, the same as X5, so there is no per-op CPU fallback.
- **No `gated_delta_net` / "Unsupported type" / ssm / device-lost lines** in the native log or the console. The only warnings are `pooling_type [-1] but [0]` and `embeddings required … overriding` (expected for a decision head).

**Response shape**
```json
{"model":"models/model-00001-of-00001.gguf","answers":{"q0":{"type":"choice","choice":"set note type","probabilities":{"<name>":p,…},"confidence":0.9966}},"usage":{"input_tokens":700,"output_tokens":0}}
```

**Parity**

The body was byte-built as in decide.mjs (W3 / desc / override, none last). Kev results are deterministic: identical across reloads, n_batch and thread mode.

| item | opts | in tok | max abs Δp, WebGPU vs native Metal | max abs Δp, native CPU vs native Metal | max abs Δp, browser CPU (wasm, 7 thr) vs native Metal | pick same | WebGPU ms (median of 5) | native Metal ms |
|---|---|---|---|---|---|---|---|---|
| kn3-01 | 19 | 700 | 0.00006 | 0.0003 | 0.0002 | yes | 657 | 152 |
| kn3-14 | 19 | 693 | 0.0066 | 0.064 | 0.018 | yes | 655 | 155 |
| prj3-12 | 17 | 513 | 0.0154 | 0.025 | 0.047 | yes | 479 | 130 |
| wbs3-05 | 15 | 485 | 0.0146 | 0.055 | 0.037 | yes | 456 | 122 |
| src3-02 | 5 | 227 | 0.0081 | 0.021 | 0.062 | yes | 226 | 66 |
| hr4-02 | 3 | 165 | 0.0391 | 0.017 | 0.030 | yes | 180 | 60 |

- Native Metal reproduces the stored `kev.jsonl` exactly (Δ 0) on all 6 items.
- The largest |Δ logprobsT1| is 0.6 nat, on a tail option (p ≈ 1e-5) of kn3-01.

**Gate decisions** (rig `evaluate.decide`, T_L 1.63 / T_K 4.0 / τ 0.5)
- Browser Kev with browser X5 trie (3 items) or stored LoRA (3 items): **6/6 identical** (pick, asked, offered order), with both `loraExact` and `loraBranch`. 5 of the 6 are gated items.
- Fused margins moved by ≤ 0.021; prj3-12 is knife-edge, 0.013 → 0.026.
- Native CPU Kev also gives 6/6 identical decisions.

**The CPU/WASM fallback is not viable for Kev:** 2.0–8.3 s per call with 7 threads in the browser (1.0 s warm-up excluded). WebGPU is about 12× faster, which also confirms that WebGPU is really in use.

## 2. X5 LoRA on WebGPU: logprobs and the trie

**Load**
- 229,312,224 B, offloaded 17/17 layers.
- `general.name` is `"Merged"`, so the manifest identity check must not expect a descriptive name for X5.
- BOS 1, `<|im_end|>` is EOS 7, `tokenizer.ggml.pre lfm2`, n_vocab 65536.

**Response shape** (OAI `text_completion`)
- The logprobs live at `choices[0].logprobs.content[0].top_logprobs[] = {id, token, bytes, logprob}`.
- `usage.prompt_tokens` was 538 for kn3-01, which equals the native `[BOS, …ids]` length, so `add_special` adds BOS to the string prompt.

**Problem 1: the n_probs 8192 retry and some n_probs 64 calls fail.** They throw `type_error.316 invalid UTF-8 byte`: wllama's JSON dump does not tolerate partial-UTF-8 byte tokens in `top_logprobs`, which native llama-server replaces.
- This occurred at 4 of 127 and 16 of 134 nodes in exact mode, at n_probs 64.
- **Fix used:** for each missing child (or a failed node), make one call with `logit_bias: [[childId, 100]], n_probs: 1`. The sampled token's `logprob` comes from the raw pre-sampler softmax.
- It was validated against top-64 values at ranks 1, 6 and 41 on 3 prompts and matched **bit-exactly**.
- It is a deviation from `lib.ts`, which floors outside the top-8192. The forced path is exact, and nothing was floored in either run.

**Trie vs stored** (string prompts, the `lib.ts` port)

| item | mode | requests (forced) | browser ms | median abs Δ, nat | max abs Δ, nat | argmax same | native exact ms / requests |
|---|---|---|---|---|---|---|---|
| kn3-01 | branch | 11 (5) | 317–352 | 0.067 | 0.166 | yes | |
| kn3-01 | exact | 128 (5) | 1,219–1,287 | 0.074 | 0.173 | yes | 318 / 124 |
| kn3-14 | branch | 6 (0) | 219 | 0.032–0.038 | 0.164 | yes | |
| kn3-14 | exact | 127 (4) | 1,217–1,315 | 0.037–0.042 | 0.247 | yes | 323 / 123 |
| prj3-12 | branch | 8 (0) | 107–185 | 0.022 | 0.222 | yes | |
| prj3-12 | exact | 134 (16) | 1,213–1,386 | 0.022 | 0.222 | yes | 276 / 118 |

- The plan's bar of median ≤ 0.05 nat is met on 2/3 items; kn3-01 is at 0.067–0.074. Decisions are unaffected (see §1).
- The root next-token distributions compare as follows against native: top-1 is the same; the tail (top-64) differs by up to 0.3–0.6 nat. This is the expected WebGPU vs Metal numerics.
- Per request: about 10 ms warm, and about 110–210 ms for a cold prompt (378–538 tokens). Prefix caching works across trie requests on the hybrid LFM2.
- **Branch mode costs ≈ 0.1–0.35 s and exact ≈ 1.2–1.4 s** (4× native). This supports shipping branch, as coordinator decision (a) chose.
- Chat completion works as before.

## 3. Load time, latency and memory

**Load** (warm HTTP cache from the local Vite; network download not representative)

| model | first load | later load |
|---|---|---|
| X5 | 3.3 s (2.6 s download) | 0.55–0.6 s |
| Kev | 9.2 s (6.7 s download) | 1.3–1.4 s |

**Thread mode.** Connect sets no COOP/COEP, so it is not crossOriginIsolated and wllama runs single-thread. The non-isolated run (`multithread: false`) gave **the same latencies** as the isolated, 7-thread run: Kev 176–670 ms and trie as above. GPU dominates, so single-thread is fine for Connect.

**Per-call budget** (warm, from these numbers)
- Step 1 runs in parallel with Kev, ~0.2–0.7 s. Kev is the longer of the two: ~650 ms for 19 options.
- Then the branch trie, ~0.1–0.35 s.
- Then step 2.
- Send→card is likely ~1–1.5 s before step 2. That is near the plan's 1.5 s budget estimate; E4 must measure it.

**Memory** (`performance.measureUserAgentSpecificMemory`). These were measured **only in the opt-in COI / multithread mode** (shared wasm memory); Connect runs single-thread, where the API is unavailable. The logits hypothesis below does not depend on threads, so the magnitude should carry over, but do not cite these as single-thread readings; E13 (Chrome Task Manager in Connect) is the real check. The API counts the JS and wasm heaps, not GPU buffers.

| state | measured |
|---|---|
| X5 alone | 0.40 GB after load, 0.60 GB after the trie |
| X5 + Kev, after load | 2.28 GB |
| X5 + Kev, after Kev calls | **3.43 GB**, a one-time high-water mark, stable over further calls |
| Kev alone | 1.74 GB after load, 2.88 GB after calls (the same with n_batch 1024) |

- **WebGPU buffers on top of that,** from the native log: X5 216 + 48 KV + 35 compute ≈ 0.3 GB; Kev 495 + 96 KV + 19 RS + 490 compute ≈ 1.1 GB.
  - On Apple unified memory, the total is therefore about **4.5–5 GB for C**. That is above the plan's 1.9–2.2 GB estimate and over the E13 3 GB flag.
- The ~1.1 GB jump on the first Kev call is consistent with full-sequence logits: "embeddings required … overriding" marks every token as an output, and 700 tok × 248,320 vocab × 4 B ≈ 0.7 GB, plus copies. This is a hypothesis; it is not verified.
- Chrome's Task Manager (GPU process) was not read; that needs the user.
- n_batch 512 cannot be used: Kev rejects 630-token questions ("increase the batch size"). Keep 2048, or at least 1024.
- `navigator.deviceMemory` returned **32** on this Chrome 155, which contradicts the plan's "Chrome caps the value at 8". A guard threshold above 8 (e.g. `< 16`) is implementable, and the plan's `< 8` is too permissive given ~5 GB.
- Kev `n_ctx` 4096 (plan §1.2) was not evaluated. The longest observed input was 700 tokens on 6 items, and the KV saving (48 MB) is small against the ~1.1 GB growth on the first call, so it is not worth pursuing.

## 4. Errors seen

| Error | Effect | Handling |
|---|---|---|
| `type_error.302` | Any array `prompt` | Use string prompts |
| `type_error.316` | Partial-UTF-8 tokens in `top_logprobs`, at n_probs 8192 and sometimes at 64 | The logit_bias forced path |
| Kev batch-size error | n_batch < question tokens | Keep n_batch 2048 |

- All three surface as `RangeError: Invalid typed array length: 1163217991` in the worker. 1163217991 is "GLUE", the unchanged input magic. The real message is only in the native log, so `wllama-backend.ts` must capture the native error log to report it.
- The instance stays usable after these errors.
- No shader, unsupported-type or `gated_delta_net` errors occurred, and there was no CPU fallback.

## Plan deltas for Phase 1+

- **§0.5 / §2.2 / §3.1:** replace "mixed prompt" with string prompts.
  - The answer table needs `pieces`.
  - The CI test asserts `pieces.join("") === forcedOpsText(...)`, plus the 1,685-node retokenisation check (from `verify-retok.mts`) as a node parity check.
  - `DecisionBackend.nextDist(prompt: string, nProbs)` plus `forcedLogprob(prompt, id)`, which replaces the 8192 retry and the floor.
- **§3.4:** use gate-decision identity as the primary in-browser bar. Raise the Kev bar to |Δp| ≤ 0.05 and the LoRA bar to median ≤ 0.08 nat, or keep 0.05 and accept that knife-edge items will fail. Report all values.
- **§1.3:** revise the memory budget to ~4.5–5 GB. `deviceMemory` is not capped at 8 here (32 reported), so pick a higher threshold (e.g. 16) for defaulting Kev off, and consider adding a "Decision model uses ~3.5 GB" note in settings.
- **§1.4:** the X5 identity check uses bytes, architecture `lfm2`, `tokenizer.ggml.pre` and n_vocab, not `general.name`.
- **§1.6:** n_batch must be ≥ the longest Kev question (~700 tokens for 19 options).

## Spike code

The code is committed on `explore/in-browser-llm`:
- `spike/llm-harness/phase0.ts`;
- the `main.ts` import;
- `vite.config.mjs`: the `/x5/`, `/kevft/` and `/c-spike/` mounts (streamed), and opt-in `PHASE0_COI=1` COOP/COEP.

The generator scripts (`gen-fixtures.mts`, `verify-retok.mts`, `native-kev.py`, `fuse-compare.py`) stay in `$SCRATCH/connect-c-spike/`.
