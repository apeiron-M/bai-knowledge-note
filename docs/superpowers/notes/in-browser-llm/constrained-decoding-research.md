# Constrained decoding: improving choice and content (LFM2.5-350M, wllama 3.8.1)

**What I checked in source.** I read the wllama 3.8.1 npm tarball (`src/types/oai-compat.ts`, `src/wllama.ts`, `cpp/wllama-context.h`) and llama.cpp at tag b11364, which is the spike's libllama (`tools/server/*`, `common/sampling.cpp`, `common/parsers/lfm2.cpp`). wllama v3 forwards request JSON to llama.cpp's `eval_llama_cmpl_schema`, so llama-server params pass through. v3 has **no** tokenize/decode/low-level sampler API. `createSystemOne` returns choice probabilities, but it throws unless the model is a "decision model" (wllama-context.h:773), so it is not an option here. llguidance is not compiled in, so GBNF is the only grammar engine.

## 1. Score the candidates instead of sampling them (highest expected gain)

**Verified mechanism.**
- `logprobs: true` maps to `n_probs` (server-common.cpp:1431, server-schema.cpp:179).
- With `post_sampling_probs` false (the default), the probabilities are a softmax over the **raw, pre-grammar** logits for the whole vocabulary (server-context.cpp:1812 and 1986ff, server-common.cpp:1550ff).
- `echo` is rejected, so there is no way to get logprobs for prompt tokens.
- The trick is to force each candidate with a one-literal grammar and sum the returned token logprobs. That sum is the model's unconstrained log P(candidate | prompt).

**Sketch.** For each candidate c, call `createChatCompletion({messages, stream:false, temperature:0, max_tokens:24, logprobs:true, top_logprobs:1, grammar:'root ::= "{\\"op\\": \\"' + c + '\\"}"'})`. Sum `choices[0].logprobs.content[].logprob`, excluding the end-of-generation token or including it the same way every time. Take the argmax.

**What needs changing.** `wllama-types.ts` only models `stream:true`, so the non-streaming response type has to be added.

**Caveats.**
- The sum follows the token path the greedy-under-grammar sampler picked, not the best of all tokenizations.
- Use length-normalized or PMI scores when the labels differ in length (see item 2).

**Cheaper variant (inferred).** Ask "Does op X fit? yes/no" once per candidate, read P(yes), and stop after one token.

**Evidence.**
- Ranking by likelihood beats asking a small model to pick an answer letter: https://arxiv.org/abs/2210.12353
- The yes/no-per-tool style reported +18.4 pts tool accuracy: https://arxiv.org/abs/2510.14453

**Cost (estimate).** The prompt KV is reused: checkpoints are taken near the end of the prompt (server-context.cpp ~3740–3765), and the spike already saw `cache_n` > 0. That leaves about 5 × 8 forced tokens, roughly 0.4–0.6 s on WebGPU, against today's 207 ms.

## 2. Calibrate the scores (PMI / contextual calibration)

The results show the model's prior: REJECT_NOTE, UPDATE_LINK_TYPE and SET_OWNER keep winning. Use score(c) = log P(c | utterance) − log P(c | "N/A"). Put the op list in the system message and the utterance last, so the "N/A" pass reuses the cached prefix.

**Evidence.**
- https://arxiv.org/abs/2104.08315 (surface-form competition, PMI_DC)
- https://arxiv.org/abs/2102.09690 (contextual calibration)

**Cost.** It doubles item 1, to about 1 s.

## 3. Human-readable labels, not SCREAMING_CASE

Constrain or score phrases such as "add a topic tag" and "submit for review", then map them back to op keys.

**Evidence.**
- Constrained decoding into English-like canonical forms beats formal targets for few-shot parsers: https://arxiv.org/abs/2104.08768
- Small models swing widely with formatting: https://arxiv.org/abs/2310.11324

**Cost.** Free.

## 4. Use LFM2.5's native tool-call format

**Verified.**
- llama.cpp detects the LFM2.5 template ("List of tools: [") (chat.cpp:1164).
- With `tools` and `tool_choice:"required"`, it builds a **non-lazy** grammar over Python-style calls restricted to the given tool names and argument schemas (lfm2.cpp:54–105).
- This requires `jinja:true` at load (server-common.cpp:1236); the spike used false.

**Sketch.** Pass the 5 candidates as `tools`, with names written in the phrase style from item 3.

**Combining with item 1 (inferred).** Prefill `<|tool_call_start|>[` via `continue_final_message`, then score each name literal.

**Evidence.** The model card says the model is trained for exactly this format: https://huggingface.co/LiquidAI/LFM2.5-350M

**Cost.** One extra load flag.

## 5. Constrain content, not just form (fixes the args failures)

- **Copy-span grammar.** Per request, emit `s_i ::= w_i (" " s_{i+1})?` for each word i, plus `span ::= s_0 | … | s_{n-1}`. That is O(n) rules covering every contiguous word span of the utterance. Use it for name, title, description and comment.
- **Suffix spans.** For "set X to …" templates, require the span to reach the end of the utterance. This fixes the "A short argument" truncation.
- **Gate optional fields.** Drop an optional field (`kind`, `outcome`) from the schema unless its name or enum label appears in the utterance. This removes the `kind:"AGENT"` and `outcome:"IN_REVIEW"` hallucinations.
- **Keep the existing ref-id enums.**

**Cost (verified).** llama.cpp builds no token masks ahead of time (unlike XGrammar, https://arxiv.org/abs/2411.15100), so a fresh grammar per request costs nearly nothing. Per-token masking runs only when the model's preferred token is rejected.

**Evidence that form ≠ semantics.**
- Constraints fix structure at 0.6–4B but not semantics: https://arxiv.org/abs/2609.23742
- Constraints distort the distribution: https://arxiv.org/abs/2405.21047 (ASAp needs repeated sampling, too costly here)

## 6. One retrieved example per candidate

Add one example utterance next to each op in the list ("e.g. 'tag this with X'"). Targets lifecycle and polarity errors.

**Evidence.** https://arxiv.org/abs/2112.08633

**Cost.** About 50 prompt tokens per op, which is cheap at 2400 tok/s prefill.

## 7. Average over candidate order

Score under 2–3 cyclic orderings of the list and average.

**Evidence.**
- https://arxiv.org/abs/2510.00307 (tool-selection position bias)
- https://arxiv.org/abs/2309.03882 (PriDe)

**Cost.** Multiplies items 1 and 2 by 2–3, so try it after them.

## 8. Self-consistency and beam search: skip for op choice

**Why.** Voting over samples only estimates the mode. Scoring every candidate in item 1 computes it exactly, so it is better for a 5-way choice. https://arxiv.org/abs/2203.11171

**Verified constraints.**
- `n_cmpl` is capped at `n_parallel` (server-schema.cpp:62), and the spike loads with `n_parallel:1`.
- Reloading with `n_parallel:5` would not split `n_ctx`, because `kv_unified` defaults to true.
- The schema has no beam option.

**Where it might help.** Only for args, at about N × 145 ms.

## 9. A free-text "reasoning" field before the op: last

Putting a field before the answer can help large models (https://arxiv.org/abs/2601.07525; https://arxiv.org/abs/2408.02442). At 350M it costs 30–60 tokens and is unproven. If you try it, use a short enum "verb" field such as add/remove/set/submit/block rather than free text.
