# X5: LFM2.5-350M LoRA on Round 11 paraphrase rows (Constantine), 2026-10-23

Status: done. Training exited 0, then merge and Q4_K_M export ran on this Mac (the Round 10 path). Native val check is done. No held-out eval yet.

## Training
- Data: ~/bai-training/training/artifacts/round11-para/train-split.jsonl, 13,547 sequences / 7,808 rows, sha256 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d. Val is Round 10's val.jsonl, 377 sequences, sha256 1aa6b1c5…592e39, unchanged.
- Flags are exactly Round 10's: launch.sh x5-train <train> --val <val> --out training/artifacts/x5-350m/run --epochs 2 --batch 8 --grad-accum 4 --save-steps 50 --save-limit 2, on the default base LFM2.5-350M. Other settings: r16/α32, LR 2e-4, bf16, seed 42, pad multiple 64. train_lora.py sha 2434f439… is the same as Round 10 and X1.
- Caps: PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5, LOW 0.45, caffeinate -dimsu, watchdog limit 32 GiB.
- Run: 848 steps, 99.2 min (14:28–16:07 CDT), 0 resumes, watchdog never triggered. Peak footprint 19.0 GiB; mpsDriverPeakSampledGB 17.95.
- Loss: train 1.258 → 0.000115. Val loss 0.1185 @25 → min 0.01354 @825, final 0.01371. Round 10's final was 0.0126.

## Export
- Merge (CPU): 20.3 s, RSS 4.97 GB. Logit check on 16 rows / 4,120 tokens: max |Δ| 3.2e-4, argmax agrees.
- Adapter sha256 f6d0d2d5968d194fa5dda6e49e488865c10ffe6b7f9a419105956b52e46583b7.
- training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf: 229,312,224 B, sha256 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
- …-BF16.gguf: 711,485,152 B, sha256 4b9514edfb0af13b2c8dac4b90483a307abf14d6596deb6a1c48635f40df3c47
- The remote run (adapter, stats, log, watchdog slice, SHA256SUMS verified) is in training/artifacts/x5-350m/remote/.

## Native val check (Round 10 val, 377 steps; llama-server b11364, --no-jinja -np 1, temp 0, runtime grammars)
| GGUF | Step 1 exact | Step 2 exact | Median wall |
|---|---|---|---|
| X5 Q4_K_M | 214/228 (93.9%) | 136/149 (91.3%) | 52 ms |
| r10a Q4_K_M | 214/228 (93.9%) | 137/149 (91.9%) | 54 ms |

Against r10a, X5 fixes 10 steps and breaks 11. This val set is in-distribution teacher wording, so equal scores are expected. X5's paraphrase rows target messy, human-style wording, which this set does not test. The next step is the dev sets (held-out-3/4) through the R2c harness.

Files: val-native-x5.json and .log in this directory.
