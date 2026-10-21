"""Merge a LoRA adapter into the base weights and save an HF checkpoint that
convert_hf_to_gguf.py accepts. Merges in fp32, saves in the base's bf16, and
checks the merged model's logits against base+adapter on one training row.

  python training/py/merge.py artifacts/run/adapter --out artifacts/run/merged --check train.jsonl
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM

REPO = Path(__file__).resolve().parents[2]
BASE = REPO / "training/models/LFM2.5-350M"
# README.md / LICENSE carry the model-card metadata (license, base model) into the GGUF.
COPY_FILES = ["tokenizer.json", "tokenizer_config.json", "chat_template.jinja", "generation_config.json", "README.md", "LICENSE"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("adapter")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default=str(BASE))
    ap.add_argument("--check")
    ap.add_argument("--check-rows", type=int, default=1, help="rows of --check compared (evenly spaced)")
    args = ap.parse_args()
    t0 = time.time()

    base = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.float32)
    peft = PeftModel.from_pretrained(base, args.adapter)
    checks: list[torch.Tensor] = []
    wants: list[torch.Tensor] = []
    if args.check:
        lines = [l for l in Path(args.check).read_text().splitlines() if l.strip()]
        n = max(1, min(args.check_rows, len(lines)))
        for i in range(n):
            row = json.loads(lines[i * len(lines) // n])
            checks.append(torch.tensor([row["input_ids"]]))
        with torch.no_grad():
            wants = [peft(ids).logits for ids in checks]
    merged = peft.merge_and_unload()
    stats: dict = {}
    if checks:
        with torch.no_grad():
            gots = [merged(ids).logits for ids in checks]
        stats["checkRows"] = len(checks)
        stats["checkTokens"] = sum(int(ids.shape[1]) for ids in checks)
        stats["maxAbsLogitDiffFp32"] = max(float((g - w).abs().max()) for g, w in zip(gots, wants))
        stats["argmaxAgree"] = all(bool((g.argmax(-1) == w.argmax(-1)).all()) for g, w in zip(gots, wants))

    merged = merged.to(torch.bfloat16)
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    merged.save_pretrained(out, safe_serialization=True)
    for f in COPY_FILES:
        if (Path(args.base) / f).exists():
            shutil.copy(Path(args.base) / f, out / f)
    stats["mergeWallSec"] = round(time.time() - t0, 2)
    stats["safetensorsBytes"] = sum(p.stat().st_size for p in out.glob("*.safetensors"))
    (out.parent / "merge-stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
