# Overnight chain 2026-10-23/24: Kev-0.8B fine-tune (E) export + dev eval, arm F (LFM2.5-1.2B on round11)

Status is updated progressively; the newest section is at the bottom.

## 0. State at start (2026-10-23 17:00 CDT)
- Kev-FT on Constantine, screen kev-ft: step 100/1096 at 16:58, ~27 s/step, ETA ~00:25 Oct 24. Watchdog-kev alive (pid 81547), footprint 15.0 GB.
- Training watchdog for train_lora.py alive (pid 83813, limit 32 GiB).
- F plan: `~/bai-training/launch.sh f-train training/artifacts/round11-para/train-split.jsonl --val training/artifacts/round11-para/val.jsonl --out training/artifacts/f-1p2b-r11/run --base training/models/LFM2.5-1.2B-Instruct --epochs 2 --batch 8 --grad-accum 4 --save-steps 50 --save-limit 2` (= X1's command with round11 data; X5's data). 13,547 seq -> 848 steps; X1 ran 450 steps in 132.6 min -> F ETA ~250 min (~4.2 h).

## 1. Session 2026-10-26 08:45 CDT: arm F launched
- Kev-FT (E) had finished: `~/x4/kev-ft.log` ends `saved runs/x4-kev08-r1` / `2026-10-24 03:36:04 EXIT 0` (step 1090/1096 loss 0.079). The run is at `~/kev/runs/x4-kev08-r1` (adapter 43 MB, head.pt, no calibration yet). Constantine was idle (no screens); both watchdogs (83813 bai-training, 81547 kev) still alive.
- F launched 2026-10-26 08:45:40 in screen `f-train`, log `~/bai-training/f-train.log`, via launch.sh (caffeinate -dimsu, MPS HIGH 0.5 / LOW 0.45, watchdog pid 83813, 32 GiB limit). This is X1's command verbatim with the round11 data:
  `train-split.jsonl --val val.jsonl --out training/artifacts/f-1p2b-r11/run --base training/models/LFM2.5-1.2B-Instruct --epochs 2 --batch 8 --grad-accum 4 --save-steps 50 --save-limit 2` (other hparams are train_lora.py defaults, as for X1: r16/α32, LR 2e-4, bf16, seed 42, max_length 1024).
  - Data: round11-para train-split.jsonl 13,547 rows, sha256 1c4718d3…7f7d; val.jsonl 377 rows, sha256 1aa6b1c5…2e39 (same val as X1/R10). 848 steps.
  - Early rate: 14.1–14.8 s/it over steps 1–7 (warm-up). X1 averaged 17.7 s/step, so the ETA is roughly 4–4.5 h, i.e. ~13:00–13:30 CDT Oct 26. Footprint 11.8–16.1 GB.
- Sleep: Constantine is on AC (battery 41%, charging). `pmset -g` shows `sleep 1 (sleep prevented by powerd)`, so system sleep is NOT disabled in the config. It is held only by caffeinate's assertions (PreventUserIdleSystemSleep seen; the global PreventSystemSleep=1 was not attributed to a process; caffeinate pid 86379 acts for the python pid 86378). If the trainer exits, the box can sleep within about a minute. A permanent fix needs `sudo pmset -c sleep 0`, which only the user can run; it was not done here.

## 2. Kev-FT (E) calibrated and exported (2026-10-26 08:48–09:04 CDT)
- **Calibration** ran on Constantine alongside F, in detached screen `kev-cal` with MPS HIGH 0.5 / LOW 0.45 and caffeinate -i (headroom: F footprint 12–16 GB of 64 GB, memory free 55%). It is kev.benchmark on `~/x4/calibration.jsonl` (228 records / 456 questions, sha 6abffad7…, the Round 10 val split), followed by `calibrate_checkpoint.py --allow-in-distribution`. The log is `~/x4/kev-cal.log`: EXIT 0, no Traceback, 14 min.
  - Fit: **T=2.7007**. On the calibration rows, acc 0.963, ECE 0.027→0.017, brier 0.066→0.060. The out-of-fold T values are [2.76, 2.64, 2.76, 2.46, 2.70], with separated=False.
  - kev warns that T is in-distribution: the calibration rows come from our own corpus, which is expected here.
  - head.pt sha256: before 4026368b…7bdf (kept as `runs/x4-kev08-r1-head.precal.pt`), after 19537efe…fbfb. The temperature key is 2.70069989.
  - F slowed to about 16.4 s/it while calibration ran.
- **Copied back** to `training/artifacts/kev-ft/remote/` (gitignored; 66 MB): the run dir, the -cal rows/report, the precal head, and the kev-ft/kev-cal/watchdog logs. `SHA256SUMS` was checked against Constantine: all OK.
- **GGUF** was made on this Mac with llama.cpp 46ca246 and HF_HUB_CACHE=x4-kev/models/hf (Qwen3.5-0.8B-Base), offline. The converter detected the Kev checkpoint. Conversion took 11.7 s at 4.6 GB RSS; quantising took 3.3 s.
  - `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`: 529,595,072 B, sha256 `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23`
  - `…-BF16.gguf`: 1,517,796,032 B, sha256 `cb9c2867f37072b46f40afa7c542fdb3a695c4c22c26d9855e335736a2695db5`
  - GGUF metadata, read with gguf-py on both files: `qwen35.decision.type=kev` and `qwen35.decision.temperature.{choice,score,noul}=2.7007`, which matches the fit.
- **Load and sanity check** (Q4_K_M, native llama-server `-np 4 -kvu -c 8192`, `decide.mjs --variant desc --wording W3 --servedT 2.7007`, 3 dev items: h4 ×2, h3 ×1, natural style). The output is `kevft-sanity.jsonl`; the item file is `kevft-sanity-items.json`.

  | item | gold | FT pick | FT p(gold) | base Kev Q4 p(gold) (T 2.35) |
  |---|---|---|---|---|
  | kn4-01 | SET_TITLE | SET_TITLE | 0.995 | 0.263 |
  | moc4-01 | CREATE_MOC | CREATE_MOC | 1.000 | 0.289 |
  | src3-01 | INGEST_SOURCE | INGEST_SOURCE | 0.998 | 0.339 |

  The probabilities sum to 1 and latency is 68–151 ms. Even at the served T of 2.7 the FT model is very sharp on easy items. For fusion, refit per-expert temperatures on dev, as rig v2 does. Do not reuse T_K 0.75 from base Kev.
- **Not done:** the full dev eval of E (rig, h3/h4 + val) and the E-arm fusion. Those are next.

## 3. Status at 09:05 CDT, 2026-10-26
- **F:** step 65/848 at 18:53 elapsed (17.4 s/step average including evals). Eval loss is 0.0596@25 and 0.0372@50; X1 was 0.0602@25. There are no Tracebacks and no watchdog LIMIT lines; footprint is about 14 GB. **ETA about 12:50–13:15 CDT, Oct 26.** After EXIT 0: merge, export Q4_K_M, copy back to `training/artifacts/f-1p2b-r11/gguf/`, then run the dev eval.
- **Constantine:** only `f-train` is running (`kev-cal` has exited). It is held awake by caffeinate only; see section 1.
- **Queue after F:** the 350M on round11+round12 (X11 data). Then finalise PREREGISTRATION-2 (arms E and F) and run held-out-5 once.
- The 3 sanity items are all natural-style, and base Kev already got all three right. They show the model loads and is sane (and sharper), not that it is better; the dev eval is the real test.
