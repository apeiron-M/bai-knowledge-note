# X2: gte-small op head, and its fusion with the Round 8 LoRA

2026-10-23. Ran on this Mac only: inference and sklearn, well under 8 GB of RAM. No teacher calls, no torch training. Nothing under `exp/blind/` was created or read; repo untouched. (Saved by the coordinator from the agent's hand-back; the agent's Write of this file was refused.)

## Setup

- **Train-A:** `round10/final/rows-kept.jsonl` (4,609 rows) minus 168 Round 8 val ids → 4,441 rows, 98 classes. **Train-B:** `teacher-full/agreed-s1.jsonl` minus val ids → 3,118 rows (= Round 8 LoRA's rows). No exact utterance overlap with dev/val. Caveat: Round 10 contrastive groups were seeded from Round 9's held-out-3 confusion list.
- **Dev:** held-out-3 + held-out-4 = 196 action items (97 natural / 99 paraphrase) + 20 no-action; 12 multi-action excluded. **Val:** Round 8 teacher val, 168 rows (150 action, 18 none); fully-right over the 107 rows with a step-2 row. PATCH_CONTENT and SET_TARGET_DATE have no training rows (caps 2 dev items).
- **Embeddings:** `scripts/gte-wasm-node.ts` (browser wasm under node), raw utterance; node 42 ms median, browser 46–60 ms median.
- **Heads (`clf.py`):** multinomial LR (C=1000, grouped-CV 0.693) and MLP (512 hidden, 0.699); softmax restricted to R2c scoped list + none. LR primary (37.7k params, ~151 KB fp32). Temperature scaling on OOF train preds: T=2 LR, 1.5 MLP.
- **LoRA:** Round 8 GGUF on native llama-server (b11364, Metal, `--no-jinja`, `-np 1`) via the harness's own `scoringMessages`, `step1Grammar`, `scoreOptions`, `fillArgsStep(V1_ARGS)`. Parity with browser: R2c pick 215/216; val 168/168; scored top-1 vs generated pick 384/384; step 2 on gold op 163/163.
- **Gating:** simulated user per Exp-1 spec ("none of these" available; ask rate over all items). pGen = exp(sum logprobs of generated answer), free from the generation call with `logprobs: true` (32-item check: same pick, max |Δ| 0.002).

## Results (dev 196 action / 216 total; val 150 action, fully over 107)

| Config | Dev op (nat/para) | Dev fully | Dev gold offered / ask | Val op | Val fully | Val gold offered / ask |
|---|---|---|---|---|---|---|
| LoRA R2c | 163 (92/71) | 135 (77/58) | – | 134 | 92 | – |
| LoRA scored top-1 | 164 | 136 | – | 134 | 92 | – |
| Zero-shot cosine (shipped) | 110 | – | – | 76 | – | – |
| Head LR, Train-A | 119 (68/51) | 102 | – | 115 | 81 | – |
| Head MLP, Train-A | 119 | 99 | – | 110 | 81 | – |
| Head LR, Train-B | 103 (64/39) | 87 | – | 112 | 79 | – |
| (a) disagree → ask, union top-3 | 163 | 150 | 182 / 44.9% | 134 | 99 | 148 / 46 |
| (b) fuse w=0.45 (CV: LOSO 167, 5-fold 168) | 168 (93/75) | 143 | – | 137 | 94 | – |
| (b') head × exp(β·[LoRA pick]) | 160 | 135 | – | 137 | 94 | – |
| (c) rerank LoRA top-2 / top-3 | 156 / 148 | 135 / 129 | – | 132 / 131 | 89 / 89 | – |
| LoRA scored margin <0.9 → ask (~3 s) | 163 | 148 | 179 / 24.1% | 134 | 97 | 142 / 20 |
| Fused margin <0.8 → ask | 168 | 151 | 181 / 26.4% | 137 | 98 | 145 / 24 |
| **Score-free: pGen <0.9 → ask, LoRA pick + head ranks** | 163 | **150 (82/68)** | **180 (91.8%) / 24.5%** | 134 | 97 | 144 / 10.7% |
| Same gate, zero-shot alternatives | 163 | 143 | 174 / 53 | 134 | 93 | 139 / 18 |

Head: top-3 167/196 dev, 143/150 val (LoRA scored top-3: 184, 146). No-action poor (dev P 4/12, R 4/20; LoRA 13/15, 13/20). Prefixes no effect. More rows help the head (+16 dev Train-A vs B).

ECE: head LR raw 0.248 dev / 0.085 val; temp-scaled LR 0.114/0.090; MLP 0.067/0.070; LoRA scored 0.126/0.074. LoRA scores very confident (174/216 in 0.9–1.0 bin) → pre-registered τ=0.2 margin gate asks only 6/216.

Latency: head LR 0.005 ms; embed 46–60 ms browser; full-list LoRA scoring native 0.74–0.94 s for ~15 options (~3 s browser est.).

## Reading

1. Head alone far below LoRA (61% vs 83% dev).
2. One-shot fusion +4–5 dev under CV, +3 val — noise-level, needs scoring pass.
3. Head is a cheap alternative source for an ask gate: score-free gate ties scored-margin gate with no extra LLM pass. Exp-1 bars on dev: gold offered 91.8% (bar 92%), ask 24.5% (≤30% met), +7.7 fully/100 (bar +8). τ read off dev curve (not pre-registered); val agrees.
4. Plain disagreement asks too often (45%).
5. pGen is the best gate signal found.

Recommendation: keep LoRA op choice; for Flow 4 use pGen gate + LR head alternatives (~151 KB). Pre-register τ, check pGen under WebGPU, validate on blind set.

## Files

`prep.py`, `embed.mts`, `clf.py`, `tscale.py`, `zs.py`, `native-llm.mts`, `lora-native.mts`, `pgen-check.mts`, `fusion.py`; `out/` (pred-*.json, lora-native-all.json, per-item-<head>.json, fusion-<head>.{json,log}, clf-summary-raw-query-dt.json); `.venv` (sklearn 1.9.1).
