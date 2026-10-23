# Decision models ("jev") for the in-browser op picker

**Status:** research only. Nothing has been run or trained. 2026-10-22.

**Labels:**
- **[src]** checked in source code, a binary, GGUF metadata or the HF API.
- **[web]** taken from a model card or article, not reproduced.
- **[inf]** my inference.

## 1. What "jev" is
**Jev** is TypeSafe AI's hosted **"System One" decision model**, released on 15 Sep 2026 ([docs](https://docs.typesafe.ai/concepts/system-one), [DataCamp](https://www.datacamp.com/blog/system-one-models-jev)) [web].
- **Input:** a *state* (text or JSON) plus named, typed questions:
  - `choice`: N labelled options, each with a description;
  - `score`: an ordered rubric;
  - `noul`: a yes/no probability.
- **Output:** calibrated probabilities from **one forward pass with zero output tokens**. The answer is always one of the given options.
- A family of open "Jev-likes" now exists, and llama.cpp serves them at `/v1/systemone` ([HF blog, 2 Oct](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp)).

**Evidence [src]:**
- wllama documents `createSystemOne()` as the "TypeSafe-compatible System One API" (`src/wllama.ts:731`).
- wllama's test model is `ggml-org/tinyopenjev-for-testing-gguf`.
- A GGUF is a "decision model" when it carries `<arch>.decision.type` (llama.cpp `common.cpp`).

**Alternatives ruled out:**
- A 60 s grep of `~/projects/powerhouse` (READMEs, docs, package.json; node_modules excluded) for `jev`, `openjev`, `systemone` and `typesafe.ai` found **no matches**. So there is no internal "jev" [src].
- JEPA does not fit "decision model" [inf].

## 2. How they decide [src: llama.cpp `server-decision.{h,cpp}`, `common.h`]
The question and its options are rendered with the model's `systemone` chat template. Each option is then scored by one of these methods:
- the logit of a label token (`openjev`, `lev`, `nimble`, `lfm2-d1`);
- a pointer from the last token to a per-option end token (`kev`);
- a marker token in an encoder's output (`laya`, `lfm2-d1-omni`).

Other mechanics:
- Per-bucket temperatures in the GGUF calibrate the probabilities.
- Questions share the state's prompt prefix.
- Only `lev` re-asks each question with the options shuffled.
- At most 255 options per question for `kev`, `laya` and `d1`.

In effect this is a trained "score these options" head with **labels defined at request time**. Our op descriptions would become the option criteria.

## 3. Candidate models

| Model | decision.type [src] | Size in browser | Supported by wllama 3.8.1 | Other browser path | License |
|---|---|---|---|---|---|
| Julia-1 (144M, mmBERT) | `laya` | 168 MB Q8 GGUF; 551 MB ONNX | yes | [Julia-1-ONNX](https://huggingface.co/SupersonicLabs/Julia-1-ONNX) (ORT WebGPU), **75 ms** per decision | Apache-2.0 |
| Laya (421M, ModernBERT-L) | `laya` | 449 MB Q8 | yes | [decision.js](https://github.com/Jacqkues/decision.js), transformers.js; 39 ms | Apache-2.0 |
| Kev-0.8B (Qwen3.5 + LoRA) | `kev` | 812 MB Q8 | yes | none | Apache-2.0 |
| d1-omni-600M (LFM2.5-Encoder-350M) | `lfm2-d1-omni` | 407 MB Q8 (text only, no mmproj needed) | **no** | [ONNX](https://huggingface.co/onnx-community/d1-omni-600M-ONNX) + decision.js; 34 ms | LFM Open License v1.0 |
| d1-3B | `lfm2-d1` | 1.67 GB Q4 | **no** | decision.js; 166 ms | LFM Open License v1.0 |

Notes on the table:
- Browser latencies are as published [web]. decision.js figures are on an M5 Pro in Chrome with WebGPU (needs `shader-f16`), 3 questions per item. The ONNX card for d1-omni gives about 60 ms per question on an M3 Pro.
- Every browser path is a custom runtime. transformers.js has no pipeline for these models: the d1 ONNX card says "Unknown pipeline tag".
- There is **no published wllama/WASM latency** [src: the official example prints elapsed ms but quotes no number]. My guess for Julia-1 (144M, encoder) under wllama WebGPU is tens of ms per question. Unmeasured [inf].

**Which models wllama 3.8.1 can load [src].**
- **Source:** the npm release is 2 Oct, and its llama.cpp submodule is `46ca246`, the "support nimble" commit of 2 Oct. That commit's `common.cpp` maps `openjev`, `lev`, `kev`, `nimble` and `laya`.
- **Binary:** the shipped WASM contains the error strings of the LAYA and KEV branches (`no mask or sep token`, `no valid max_head_tokens`, `<|box_end|>`). It lacks `score_bias`, a later master feature, which is consistent with that older commit.
- **Example:** 3.8.1's `examples/decision/index.html` lists Laya, Julia-1, Kev-4B and lev.
- d1 support landed in llama.cpp on 7–8 Oct (#30110, #30114), **after** 3.8.1 shipped.
- **Correction to my partial draft:** I said Laya doesn't load. It does. A bare `laya` string search was the wrong test.

## 4. Fit for our pipeline [inf unless marked]
- **Replace:** step 2 (op choice, ≤19 ops) becomes one `choice` question whose options are op names with their descriptions. Step 1 (scope) could be a second question over the same state, at no extra cost. Per-option probabilities give a principled "ask the user" threshold, which we lack today.
- **Keep:** step 3. Decision models produce **no args**, so LFM2.5-350M stays for grammar-constrained arg fill, along with app code and confirmation. Two models in the browser means roughly +170–450 MB of download.
- **Risks for our misses (sibling ADD/REMOVE/SET, lifecycle transitions):**
  - Laya's base checkpoints are "near chance on typed-decisions zero-shot". A domain fine-tune took it from 0.362 to 0.766 [web, Laya card].
  - Kev-0.8B "paraphrase near untrained base", and the "tool-call routing" (When2Call) score is below chance. When2Call tests call-vs-ask, not which op, but it is still a warning [web, Kev card].
  - Julia-1 is limited to 2–20 options and "struggles with large label lists" [web]. 19 ops is at that edge.
  - **Head budget (laya type) [src: `fill_task_laya`]:**
    - question plus options must fit in `max_head_tokens`: 192 for Laya, 256 for Julia-1, read from their GGUFs.
    - Options that don't fit are cut evenly to `(max_head_tokens - 16) / n_options` tokens, with a minimum of 4.
    - For 19 ops that is about **9 tokens per option for Laya and 12 for Julia-1**: an op name plus a few words of description.
    - The question text gets whatever room is left, at least 8 tokens.
    - kev and d1 have no such cap. kev allows up to 48 tokens per option.
  - Expect zero-shot to be **no better than our 81–86%**. The upside is a fine-tune on our 3.3k rows plus calibration.
- **Multi-op utterances** (heldout4 has these) need N `noul` questions or a second pass. A `choice` question returns one op.

## 5. Fine-tuning on our ~3.3k rows
- **Data mapping:** one JSONL line per row, as `{state: {utterance, docType, docState}, questions: {op: {type: "choice", instructions, criteria: {OP_NAME: description, ...}, label: "OP_NAME"}}}`. This is the Kev training format [src: kev README]. Scope can be a second question in the same line. The teacher pipeline can generate more rows.
- **Kev (best tooling):**
  - `uv run python -m kev.train --init_from jaredpalmer/kev-0.8b ... --device mps`, then `kev.benchmark` reports accuracy and calibration [web, README].
  - MPS is supported for training. Serving on Mac uses MLX.
  - `--batch 1 --accum 8` in bf16 fits a 4 GB GPU, so an **M4 Max 64 GB is fine**. My guess is one to a few hours for 2 epochs on 3k rows [inf].
  - The README cites 15 minutes on an H100 for 1,050 records.
- **Laya:** a fine-tune notebook targets Kaggle 2×T4. MPS is not documented [web].
- **Julia-1:** the training pipeline is private. Weights only [web].
- **d1:** there is no d1-specific recipe. LEAP Finetune covers LFM SFT/LoRA, but decision heads are not mentioned [web]. MLX weights exist (`LiquidAI/d1-omni-600M-MLX-*`) but no trainer.

## 6. Cheapest experiment: zero-shot first, no browser
1. Install llama.cpp with `brew install llama.cpp`. The bottle is v0.7.0, tagged 2026-10-15, after d1 support landed on 7–8 Oct [src: GitHub API]. Start `llama-server -m <gguf> --port 8090` with each of Julia-1 Q8, Laya Q8, Kev-0.8B Q8 and d1-omni-600M Q8 in turn. Downloads total about 1.8 GB.
2. Write a short `spike/llm-harness` node script. For each held-out row (heldout 1–4), given the gold doc model:
   - POST `/v1/systemone` with a `choice` question over that model's ops, using descriptions from `ops.tsv`;
   - record top-1 accuracy, accuracy on sibling pairs and paraphrases, and accuracy against confidence.
   - Compare with r10 op accuracy.
3. **Decision rule:**
   - If a zero-shot model reaches ≥ r10 op accuracy, or gives useful confidence, fine-tune Kev-0.8B on the 3.3k rows on the M4 (`kev.train`) and re-score.
   - If it is well below r10 even after a fine-tune, stop.

**Cost (estimates):** half a day for steps 1–2 and about 1 hour of compute. A Kev fine-tune plus evaluation takes another half to one day.

**Browser follow-up, only if it wins:**
- Julia-1, Laya and Kev already run under wllama 3.8.1 `createSystemOne`, so they need no rebuild.
- For d1, either:
  - (a) rebuild wllama against llama.cpp ≥ 8 Oct (about 1–2 days, including the emscripten toolchain and glue regeneration), or
  - (b) use decision.js or onnxruntime-web, which means a second runtime next to wllama.
- A fine-tuned Kev converts with llama.cpp's `convert_hf_to_gguf.py`. It detects a Kev checkpoint (LoRA plus pointer head), merges it into Qwen3.5 and writes `decision.type=kev` (`conversion/lev.py`, `KevModel`) [src]. I have not checked that `kev.train` output dirs match the released layout.

**Open question for the user:** did "jev" mean TypeSafe's Jev (hosted API, assumed here) or the open Jev-like family? A hosted Jev call breaks the in-browser goal.
