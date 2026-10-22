# Decision models ("jev") for the in-browser chat assistant (PARTIAL, cut short by the usage limit)

Labels: **[src]** = checked in source or binary; **[web]** = read on the web, not checked; **[inf]** = my inference.

## 1. What "jev" is (answered)
**Jev** is TypeSafe AI's "System One" **decision model**, released on 15 Sep 2026 [web]. You give it a *state* (text or JSON) plus named typed questions:
- `choice`: one of N labels, with a probability for each;
- `score`: a level on an ordered rubric;
- `noul`: a yes/no probability.

It answers in **one forward pass with zero output tokens**. It reads the probability of each option and generates no text, so it cannot return an out-of-set answer. "System One" is Kahneman's fast-thinking System 1.
- https://docs.typesafe.ai/concepts/system-one
- https://www.datacamp.com/blog/system-one-models-jev
- Jev itself is a hosted API, $0.042 per million input tokens [web].

How the evidence fits together:
- wllama 3.8.1's `createSystemOne()` is documented as the "TypeSafe-compatible System One API" (`src/wllama.ts:731`, `src/types/oai-compat.ts:355`) [src].
- Its test model is `ggml-org/tinyopenjev-for-testing-gguf` (`src/wllama.test.ts:36`) [src].
- llama.cpp `common/common.h` defines `common_decision_type` with `openjev`, `lev`, `kev`, `nimble`, `laya`, `clef`, `pplx-decider`, `vllm-decision2`, `vllm-d3`, `lfm2-d1`, `lfm2-d1-omni`, `granite-switch` and `h2o-lightning` [src, llama.cpp master].
- A GGUF counts as a "decision model" when it carries the metadata key `<arch>.decision.type` (`common.cpp:1191`) [src]. Otherwise you get the error "This model is not a decision model".

JEPA, a Powerhouse-internal name and other readings are very unlikely now. I did not run the Powerhouse grep because time ran out.

## 2. Mechanism [src: server-decision.h, common.h]
- **openjev / lev / nimble / lfm2-d1 / pplx-decider / h2o-lightning:** the model reads the logits of one label token per option at the last prompt token.
- **kev:** dot product between the last token's hidden state and one end-token per option.
- **laya / clef / lfm2-d1-omni / vllm-decision2:** scores are read from the embeddings output.
- The server renders several "variants" of each question, each listing the options in a different order, and averages them. This removes position bias.
- Questions share a prompt prefix, so the state is evaluated once.
- Confidence uses formulas "published by TypeSafe".

In effect, this is a learned, calibrated classifier head on a small LM, with **label sets defined at request time** (zero-shot) [inf].

## 3. Open models, sizes and licenses (HF API, checked 2026-10-22)

| Model | Params / base | Q8_0 GGUF | License |
|---|---|---|---|
| Julia-1 (SupersonicLabs) | 144M, mmBERT-small | 168 MB | Apache-2.0 |
| Laya (convaiinnovations) | 421M, ModernBERT-large | 449 MB | Apache-2.0 |
| Kev-0.8B / 4B / 9B (jaredpalmer) | Qwen3.5 | 812 MB (0.8B) | Apache-2.0 |
| lev | 4B | n/a | Apache-2.0 |
| **LiquidAI d1-omni-600M** | 587M, LFM2.5-Encoder-350M | 407 MB (+263 MB mmproj) | LFM Open License |
| LiquidAI d1-3B | LFM2.5-VL-3B | 1.67 GB (Q4_K_M) | LFM Open License |
| OpenJev | 27B | 19 GB (Q4) | CC BY-NC 4.0 |
| tinyopenjev-for-testing | toy | 46 MB | CC BY-NC 4.0 |

Notes on the table:
- The Julia-1 and Laya bases come from the HF blog [web]; the GGUF sizes come from the HF API [src].
- GPU latency, median on an RTX PRO 6000: Julia-1 3 ms, Laya 5 ms, Kev-4B 12 ms, OpenJev 43 ms [web].
- Sources: https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp (2 Oct 2026), https://docs.liquid.ai/lfm/models/decision-models, https://www.marktechpost.com/2026/10/07/liquid-ai-releases-open-weight-d1-3b-and-d1-omni-600m-multimodal-decision-models-with-zero-output-tokens/

**The LFM2 family already has a decision model: Liquid's d1 (`lfm2-d1`, `lfm2-d1-omni`).**

## 4. Browser runtime, wllama 3.8.1 [src]
- 3.8.1 is the latest version on npm, published 2026-10-02. That is before d1 shipped on 7 Oct.
- I searched the WASM binary (`esm/wasm/wllama.wasm`) for the decision-type strings:
  - present: `openjev`, `lev`, `kev`, `nimble`;
  - absent: `laya`, `clef`, `lfm2-d1`, `lfm2-d1-omni`, `pplx-decider`, `h2o-lightning`, `vllm-*`.
- **So wllama 3.8.1 cannot load d1 or Laya.** It can load OpenJev, lev, Kev or Nimble. Of those, only Kev-0.8B (812 MB Q8) is near browser size.
- Julia-1's `decision.type` is unverified. I did not read its GGUF metadata.
- Supporting d1 needs a wllama rebuild against current llama.cpp, or a newer release [inf].
- Example page: https://github.ngxson.com/wllama/examples/decision/ (source `examples/decision/index.html`; I have not read it).

## 5. Fit for our problem [inf; to be confirmed]
- Our op step is a *choice* among ≤19 ops with descriptions, so it maps directly onto a `choice` question. The per-option probabilities and confidence give a threshold for asking the user to clarify.
- Position-debiased variants might help with sibling ops (ADD vs REMOVE vs SET), but zero-shot label descriptions may not separate them any better than LFM2.5-350M does. This needs measuring.
- Decision models **do not produce arguments**. Keep step 3 (grammar-constrained arg fill with LFM2.5) and step 4 (app code).
- They could replace step 1 (scope) and step 2 (op). Each would be a `choice` question in the same forward pass.

## Not finished
- Fine-tuning: data format and tooling for d1 and Kev, and whether it runs on an M4 Max. MLX weights exist (`LiquidAI/d1-omni-600M-MLX-*`), which suggests mlx-lm may work [inf].
- Julia-1's decision type and its WASM latency.
- transformers.js / ONNX availability.
- Concrete experiment and cost. Draft [inf]: in node llama.cpp (not wllama), run Kev-0.8B or d1-omni-600M zero-shot as a `choice` over the ops of each held-out row and compare op accuracy with r10. About half a day. Browser support for d1 needs a custom wllama build: about 1–2 days, estimated.
- Read the wllama decision example and the Powerhouse "jev" grep.
