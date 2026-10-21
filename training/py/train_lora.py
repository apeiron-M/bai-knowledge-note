"""LoRA SFT on pre-tokenized rows (TRL SFTTrainer + PEFT; MPS, CUDA or CPU).

Rows come from render_template.py: `input_ids` are the exact ids the runtime
feeds the model (llama-server tokenization), and `completion_mask` limits the
loss to the target JSON plus <|im_end|>. Nothing is re-templated here.

  python training/py/train_lora.py train.jsonl --out artifacts/run [--max-steps N] [--val val.jsonl]

With --val, the completion-only loss on the val rows is logged every
--eval-steps steps and at the end (monitoring only: no checkpoint is
picked on it). MPS driver memory is sampled at every log step.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
from trl import SFTConfig, SFTTrainer

REPO = Path(__file__).resolve().parents[2]
BASE = REPO / "training/models/LFM2.5-350M"
# Every linear layer: attention q/k/v/out_proj and conv-block in_proj/out_proj,
# plus the SwiGLU w1/w2/w3. Only 6 of 16 layers are attention.
TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "in_proj", "w1", "w2", "w3"]


class LogCallback(TrainerCallback):
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.peak_mps = 0.0
        self.t0 = time.time()

    def on_log(self, args, state, control, logs=None, **kwargs):
        if torch.backends.mps.is_available():
            self.peak_mps = max(self.peak_mps, torch.mps.driver_allocated_memory() / 2**30)
        if logs:
            self.rows.append({"step": state.global_step, "epoch": state.epoch,
                              "wallSec": round(time.time() - self.t0, 1), **logs})


def device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def check_rows(rows: list[dict], tok) -> dict:
    """The first row must decode to prompt + completion with one BOS and a
    mask of zeros over exactly the prompt."""
    r = rows[0]
    ids, mask = r["input_ids"], r["completion_mask"]
    n_prompt = mask.index(1)
    decoded = tok.decode(ids, skip_special_tokens=False)
    assert decoded == r["prompt"] + r["completion"], "decoded ids != prompt + completion"
    assert ids.count(tok.bos_token_id) == 1 and ids[0] == tok.bos_token_id, "expected exactly one leading BOS"
    assert tok.decode(ids[n_prompt:]) == r["completion"], "mask does not start at the completion"
    assert ids[-1] == tok.convert_tokens_to_ids(tok.eos_token), "completion must end with <|im_end|>"
    return {"nPrompt": n_prompt, "nCompletion": len(ids) - n_prompt, "completion": r["completion"]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("train")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default=str(BASE))
    ap.add_argument("--max-steps", type=int, default=-1)
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=32)
    ap.add_argument("--dropout", type=float, default=0.05)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--max-length", type=int, default=1024)
    ap.add_argument("--precision", choices=["bf16", "fp32"], default="bf16")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--val", help="val rows (same format), loss logged only")
    ap.add_argument("--eval-steps", type=int, default=25)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(args.base)
    rows = [json.loads(l) for l in Path(args.train).read_text().splitlines() if l.strip()]
    sanity = check_rows(rows, tok)
    ds = Dataset.from_list([{"input_ids": r["input_ids"], "completion_mask": r["completion_mask"]} for r in rows])
    val_rows = [json.loads(l) for l in Path(args.val).read_text().splitlines() if l.strip()] if args.val else []
    val_ds = (Dataset.from_list([{"input_ids": r["input_ids"], "completion_mask": r["completion_mask"]} for r in val_rows])
              if val_rows else None)

    dtype = torch.bfloat16 if args.precision == "bf16" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=dtype)
    lora = LoraConfig(r=args.rank, lora_alpha=args.alpha, lora_dropout=args.dropout,
                      target_modules=TARGETS, task_type="CAUSAL_LM")
    cfg = SFTConfig(
        output_dir=str(out / "checkpoints"),
        max_steps=args.max_steps,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_steps=0.03,  # a float < 1 is a ratio in transformers 5
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        max_length=args.max_length,
        completion_only_loss=True,
        bf16=args.precision == "bf16",
        logging_steps=1,
        save_strategy="no",
        report_to=[],
        seed=args.seed,
        dataloader_pin_memory=False,
        eval_strategy="steps" if val_ds is not None else "no",
        eval_steps=args.eval_steps,
        per_device_eval_batch_size=args.batch,
    )
    log = LogCallback()
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds, eval_dataset=val_ds, processing_class=tok,
                         peft_config=lora, callbacks=[log])
    trainable, total = trainer.model.get_nb_trainable_parameters()
    # The collated labels must cover the completion only (prompt = -100).
    batch = trainer.data_collator([trainer.train_dataset[0]])
    labelled = int((batch["labels"] != -100).sum())
    assert labelled == sanity["nCompletion"], f"{labelled} labelled tokens, expected {sanity['nCompletion']}"
    sanity["labelledTokens"] = labelled

    dev = device()
    t0 = time.time()
    trainer.train()
    wall = time.time() - t0
    final_eval = trainer.evaluate() if val_ds is not None else None
    trainer.model.save_pretrained(out / "adapter")

    stats = {
        "device": dev,
        "precision": args.precision,
        "rows": len(rows),
        "trainableParams": trainable,
        "totalParams": total,
        "steps": trainer.state.global_step,
        "effectiveBatch": args.batch * args.grad_accum,
        "trainWallSec": round(wall, 2),
        "firstLoss": next((r["loss"] for r in log.rows if "loss" in r), None),
        "lastLoss": next((r["loss"] for r in reversed(log.rows) if "loss" in r), None),
        "rowCheck": sanity,
        "valRows": len(val_rows),
        "finalEval": final_eval,
        "evalLoss": [{"step": r["step"], "epoch": r.get("epoch"), "eval_loss": r["eval_loss"]}
                     for r in log.rows if "eval_loss" in r],
        "args": vars(args),
    }
    if dev == "mps":
        stats["mpsDriverAllocatedGB"] = round(torch.mps.driver_allocated_memory() / 2**30, 3)
        stats["mpsDriverPeakSampledGB"] = round(log.peak_mps, 3)
    (out / "train-log.json").write_text(json.dumps(log.rows, indent=1) + "\n")
    (out / "train-stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
