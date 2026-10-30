# Configuration C dev oracle (held-out-3 + held-out-4 only)

Rig outputs for the vault LoRA m2bv x Kev-FT run on the **dev** sets (h3, h4, their no-action and multi
splits; 228 items, 216 single). No blind / held-out-5 / held-out-6 / held-out-7 data is in this directory.
The same items are already in the repo as `spike/llm-harness/eval/heldout{3,4}-eval.json`.

Re-recorded in M5 for m2bv and the 30 filled `bai/project` / `bai/wbs` spec descriptions (it replaces the
X5 oracle recorded on 2026-10-27). Provenance (see `manifest.json`):
- powerhouse-nl `nl eval --set dev --args x9 --temps dev-cv` (run `.artifacts/vault/eval/m2bv-kevft-dev`):
  the eval rig at repo rev `5e9c3904`, args level x9, with the spec-description patch
  (`training/vault/rig/spec-descriptions-5e9c3904.patch`, the same 30 descriptions this tree's specs carry);
- native llama-server at llama.cpp `46ca246` (the wllama 3.8.1 pin), Metal;
- LoRA `LFM2.5-350M-vault-m2bv-20261029-Q4_K_M.gguf` sha `852cd58e…d70d` (`-c 4096 -np 1 --no-jinja`);
- Kev `Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` sha `30b5796e…7b23` (`-c 8192`), decide.mjs
  `--runtime server --variant desc --wording W3`, served T 2.700699806213379.

`items.jsonl`, `step1.jsonl` and `args-x9.jsonl` are the run's files byte for byte; `kev.jsonl` keeps each
row's `id, set, decider, variant, wording, descField, candidates, servedT, oneStage`. The same copy of the
stored M3 X5 run (`training/artifacts/eval-rig/runs/m3-x5-kevft-dev`) reproduces the X5 oracle except
for timing fields and JSON spacing.

| file | source | notes |
|---|---|---|
| `items.jsonl` | rig `items.jsonl` | utterance, docType, state, ctx, refCandidates, today, gold + labels |
| `step1.jsonl` | rig `step1.jsonl` | loraPick, loraExact, loraBranch (sums of per-token logprobs) |
| `kev.jsonl` | rig `kev.jsonl`, slimmed | candidates (`__none__` last), servedT, `oneStage` only (the fusion input) |
| `args-x9.jsonl` | rig `args-x9.jsonl` | step 2 on the gold op at x9 (args, raw, dateFixed, listsCompleted, ok/okN) |
| `expected-decisions.json` | `scripts/chat/c-expected.py` (M5: `scripts/chat/c-expected.mts`, over nl-eval's evaluator; it reproduces this file, p values within 1e-12) | the rig's own `evaluate.decide` at T_L 1.887 / T_K 4.0 / tau 0.5, exact and branch trie scores; exact-mode metrics equal the run's `results.json` dev-cv gate block (op 181, ask 32/216, wrong 7, effective 169); exact vs branch gate decisions identical 214/216 (the other 2 ask with the same pick and differ in the third offered op) |
| `template-goldens.json` | `scripts/chat/gen-answer-tokens.mts` | native `/apply-template` (`--no-jinja`) of the step-1 messages, one dev item per model |
| `retok-check.json` | `scripts/chat/gen-answer-tokens.mts` | string-prompt retokenisation: tokenize(templated + answer pieces) == tokenize(templated) ++ ids at every trie node, 1,685 / 1,685 |

The shipped answer-token table is m2bv's export table (vault + drive, 109 answers, sha256 `4799cc52…`):
`editors/knowledge-vault/chat/answer-tokens.m2bv-20261029.json`. Its 100 vault answers equal the table
`gen-answer-tokens.mts` regenerates against the m2bv GGUF.
