# Configuration C dev oracle (held-out-3 + held-out-4 only)

Rig outputs for the X5 LoRA x Kev-FT run on the **dev** sets (h3, h4, their no-action and multi
splits; 228 items, 216 single). No blind / held-out-5 / held-out-6 data is in this directory.
The same items are already in the repo as `spike/llm-harness/eval/heldout{3,4}-eval.json`.

Provenance (see `manifest.json`):
- eval rig at repo rev `5e9c3904` (training/eval-rig, `FROZEN.sha256`), args level x9;
- native llama-server at llama.cpp `46ca246` (the wllama 3.8.1 pin), Metal;
- LoRA `LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf` sha `06279654…aaba` (`-c 4096 -np 1 --no-jinja`);
- Kev `Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` sha `30b5796e…7b23` (`-c 8192`), decide.mjs
  `--runtime server --variant desc --wording W3`, served T 2.700699806213379.

| file | source | notes |
|---|---|---|
| `items.jsonl` | rig `items.jsonl` | utterance, docType, state, ctx, refCandidates, today, gold + labels |
| `step1.jsonl` | rig `step1.jsonl` | loraPick, loraExact, loraBranch (sums of per-token logprobs) |
| `kev.jsonl` | rig `kev.jsonl`, slimmed | candidates (`__none__` last), servedT, `oneStage` only (the fusion input) |
| `args-x9.jsonl` | rig `args-x9.jsonl` | step 2 on the gold op at x9 (args, raw, dateFixed, listsCompleted, ok/okN) |
| `expected-decisions.json` | `scripts/chat/c-expected.py` | the rig's own `evaluate.decide` at T_L 1.63 / T_K 4.0 / tau 0.5, exact and branch trie scores; exact-mode metrics equal the rig's `results.json` dev-cv gate block (op 183, ask 29/216, wrong 11, effective 170); exact vs branch gate decisions identical 216/216 |
| `template-goldens.json` | `scripts/chat/gen-answer-tokens.mts` | native `/apply-template` (`--no-jinja`) of the step-1 messages, one dev item per model |
| `retok-check.json` | `scripts/chat/gen-answer-tokens.mts` | string-prompt retokenisation: tokenize(templated + answer pieces) == tokenize(templated) ++ ids at every trie node, 1,685 / 1,685 |

The answer-token table itself is runtime data: `editors/knowledge-vault/chat/core/answer-tokens.lfm2.json`.
