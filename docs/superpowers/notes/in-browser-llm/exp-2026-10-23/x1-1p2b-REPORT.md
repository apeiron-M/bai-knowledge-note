# X1: LoRA on LFM2.5-1.2B-Instruct (Constantine), 2026-10-23
(Saved by coordinator from the agent hand-back; data in x1-train-summary.json.)

Status: done; training exit 0; merged (on Constantine) and exported Q4_K_M + Q8_0 + BF16. No held-out eval run.

Base: LiquidAI/LFM2.5-1.2B-Instruct @0f604ada3f766f9f257460c4c9f0b5d6f69d431b. chat_template.jinja and tokenizer.json byte-identical to 350M; re-tokenization parity 0 mismatches (377 val + 1,500 train rows); exported-GGUF render parity 377/377 for base and X1.

Training identical to Round 10: round10/split/train-split.jsonl (7,187 seq, 66917b8f…), val.jsonl (377, 1aa6b1c5…); 2 epochs/450 steps, b8×ga4, r16/α32 all-linear, LR 2e-4 cosine, bf16, completion-only, seed 42. 132.6 min (2.54× R10). Peak footprint 19 GiB under 25.9 GiB cap; 0 resumes. Trainable 11.1M. Val loss 0.0602→0.00932 (min 0.00919@375; R10 final 0.0126).

Merge: 37.7 s, RSS 9.4 GB; max logit Δ 7.7e-4, argmax agrees on every token. Adapter sha256 a2556275b6d4b1d638ca0ff0aa5b9ea4bc5459950a169d778562808c0eeefcd4.

GGUFs (training/artifacts/x1-1p2b/gguf/):
- LFM2.5-1.2B-Instruct-vault-x1a-20261023-Q4_K_M.gguf 730,896,096 B sha256 7dd843a08381aaa58ff8edf94cae443bff2ceddd3669c60e4045a803c8031bfc
- …-Q8_0.gguf 1,246,254,816 B sha256 a9a65f9b40b31e08d57ccb447479d8e26a92bd79476c9a4879dcda4738d9cbf8
- …-BF16.gguf 2,343,327,456 B

Validation (training val split, NOT held-out; native llama-server b11364, temp 0):
| GGUF | Step 1 exact | Step 2 exact | Median wall |
|---|---|---|---|
| X1 Q4_K_M | 217/228 (95.2%) | 139/149 (93.3%) | 258 ms |
| X1 Q8_0 | 216/228 (94.7%) | 142/149 (95.3%) | 379 ms |
| r10a 350M Q4_K_M | 214/228 (93.9%) | 137/149 (91.9%) | 76 ms |
| Base 1.2B Q4_K_M | 62/228 (27.2%) | 59/149 (39.6%) | 171 ms |

Deviations: merged on Constantine; no separate memtest; added Q8_0. No changes to rows/split/hparams/seed.
Left on Constantine: base model (2.2 GB), checkpoints 400/450, adapter, merged, logs.
