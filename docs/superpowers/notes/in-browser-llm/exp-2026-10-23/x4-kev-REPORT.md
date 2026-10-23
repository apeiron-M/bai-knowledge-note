# X4: zero-shot System One deciders (Kev, Julia) + fine-tune/export feasibility
(Saved by coordinator from the agent's hand-back; subagent .md writes were refused.)

Dev = held-out-3 (92 action/10 none/6 multi), held-out-4 (104/10/6), Round 10 teacher val (210 action/18 none). 1-stage: scoped global ops (4–18, catalog order) + "no action". Option text = OP_DESCRIPTIONS (all 99). Kev-0.6B: open-jev 0.1.2 + transformers.js 4.3.1, onnxruntime-node CPU. Julia-1, Kev-0.8B: native llama-server @46ca246.

| Decider | h4 op /104 | h4 para | h3 op /92 | fully h4/h3 | top-3 h4/h3 |
|---|---|---|---|---|---|
| LoRA (E8 h4, R2c h3) | 84 | 36/52 | 79 | 68/67 | – |
| Kev-0.8B Q8, descriptions | 83 | 40/52 | 72 | 70/60 | 98/85 |
| Kev-0.8B Q4_K_M (530 MB) | 84 | – | 73 | – | – (val 118 vs 136 for Q8) |
| Kev-0.6B ONNX | 56–57 | 20/52 | 52–56 | – | – |
| Julia-1 | ≤31 | – | ≤34 | – | – |

- Kev-0.8B: better than LoRA on paraphrase, worse on natural (43 vs 48 h4). Val 136/210. Descriptions +8–20 over names.
- Julia-1 unusable (256-token head budget truncates options).
- Two-stage (change? then choose) worse everywhere; no decider handles no-action well (best P 7/14, R 7/10 vs LoRA 7/8) → keep LoRA's {"ops": []}.
- Latency (native, contended): Kev-0.8B ~140 ms Metal; Kev-0.6B 200–690 ms CPU.
- Calibration: served T=2.35 underconfident (ECE 0.37); refit on val T=1.0 → ECE 0.07/0.08.
- h4 disagreement LoRA vs Kev: 29 items; Kev right 12, LoRA 13, neither 4. Disagreement flags 16/20 LoRA errors on h4, 10/13 on h3.
- Gate (ask on disagreement; offer LoRA pick + Kev's next two): h3 ask 25%, gold-in-choices 92.4%; h4 ask 28%, 92.3%. Not pre-registered; h3/h4 reused.
- Multi-action: Kev's op is one of the expected in 5/6 (h3), 6/6 (h4).

Fine-tune: feasible. Kev-0.8B → GGUF via llama.cpp converter at wllama 3.8.1's pinned commit reproduces ggml-org GGUF (59/59 argmax, max |Δp| 3e-4); Qwen3.5 base only (no GGUF for Kev-0.6B). Kev-0.6B → ONNX by re-quantizing base+LoRA into published graph (196 weights byte-identical). Recipe: finetune/constantine-recipe.sh (kev-0.8b@bf75a6a8, MPS fp32, lr 2e-5, 4×2 batch, aug off, 2 epochs; 20-step timing probe first; then calibrate, quantize). Data: finetune/data/train.jsonl (ed3d9aac…), calibration.jsonl (6abffad7…).

Disclosure: wording tuned on seed+dev-extra (49 action+10 none) with Kev-0.6B; W3 frozen. Julia `short` added after Julia-desc scored 11/49. Q4_K_M added after Q8 held-out results. Each config once per fold.

Unverified: MPS train time/memory; calibrate_checkpoint.py on custom rows; wllama WebGPU latency + a second wllama instance alongside LFM; Kev-0.6B browser WebGPU needs JSEP ort build.

Files: out/fusion/<decider>-<variant>.jsonl (candidates, oneStage{logprobsT1,probs,pick,ms}, twoStage{...}; best: kev08-desc); data/oracle-args.json (per item: step 2 exact on gold op); out/summary.json, out/analysis.json, out/eval/, out/dev/; code node/decide.mjs, code/metrics.py, analysis.py, oracle-args.ts, to_kev_jsonl.py, kev06_transplant.py. models/ + export/ ~7 GB, deletable.
