"""Rendered messages -> prompt strings and token ids, with parity checks.

Prompt strings come from native llama-server (b11364, the libllama build
wllama 3.8.1 ships) with jinja off, via /apply-template; token ids via
/tokenize with add_special + parse_special, which is how the server's
completion path tokenizes a prompt. Both are compared with the HF
tokenizer; any mismatch fails the run.

  python training/py/render_template.py rendered.jsonl --out train.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from transformers import AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llama_server import LlamaServer, REPO  # noqa: E402

DEFAULT_GGUF = REPO / "training/models/LFM2.5-350M-GGUF/LFM2.5-350M-Q4_K_M.gguf"
DEFAULT_HF = REPO / "training/models/LFM2.5-350M"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rendered")
    ap.add_argument("--out", required=True)
    ap.add_argument("--gguf", default=str(DEFAULT_GGUF))
    ap.add_argument("--hf", default=str(DEFAULT_HF))
    ap.add_argument("--report")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.hf)
    eos_id = tok.convert_tokens_to_ids(tok.eos_token)
    steps = [json.loads(l) for l in Path(args.rendered).read_text().splitlines() if l.strip()]
    trainable = [s for s in steps if s.get("target") is not None]

    template_mismatch, token_mismatch, boundary_merge = [], [], []
    out_rows = []
    with LlamaServer(args.gguf) as srv:
        for s in trainable:
            tag = f'{s["id"]}#{s["step"]}'
            prompt = srv.post("/apply-template", {"messages": s["messages"]})["prompt"]
            hf_prompt = tok.apply_chat_template(s["messages"], tokenize=False, add_generation_prompt=True)
            # The server's built-in template leaves BOS out of the string and its
            # tokenizer adds the BOS id; HF puts "<|startoftext|>" in the string.
            if tok.bos_token + prompt != hf_prompt:
                template_mismatch.append({"row": tag, "server": prompt[-80:], "hf": hf_prompt[-80:]})
            runtime_ids = srv.post("/tokenize", {"content": prompt, "add_special": True, "parse_special": True})["tokens"]
            hf_ids = tok(hf_prompt, add_special_tokens=False)["input_ids"]
            if runtime_ids != hf_ids:
                token_mismatch.append({"row": tag, "server": runtime_ids[:6], "hf": hf_ids[:6], "nServer": len(runtime_ids), "nHf": len(hf_ids)})
            completion_ids = tok(s["target"], add_special_tokens=False)["input_ids"] + [eos_id]
            joint = tok(hf_prompt + s["target"], add_special_tokens=False)["input_ids"]
            if joint[: len(runtime_ids)] != runtime_ids:
                boundary_merge.append(tag)
            out_rows.append(
                {
                    "prompt": hf_prompt,
                    "completion": s["target"] + tok.eos_token,
                    "input_ids": runtime_ids + completion_ids,
                    "completion_mask": [0] * len(runtime_ids) + [1] * len(completion_ids),
                    "meta": {"id": s["id"], "step": s["step"], "op": s["op"], "goldRank": s.get("goldRank"), "nPrompt": len(runtime_ids), "nCompletion": len(completion_ids)},
                }
            )

    Path(args.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out_rows))
    report = {
        "steps": len(steps),
        "trainable": len(trainable),
        "templateMismatch": template_mismatch,
        "tokenMismatch": token_mismatch,
        "promptTargetBoundaryMerges": boundary_merge,
        "bosCount": sorted({r["input_ids"].count(tok.bos_token_id) for r in out_rows}),
        "promptTokens": {"max": max(r["meta"]["nPrompt"] for r in out_rows), "min": min(r["meta"]["nPrompt"] for r in out_rows)},
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: (len(v) if isinstance(v, list) and k.endswith(("Mismatch", "Merges")) else v) for k, v in report.items()}))
    return 1 if template_mismatch or token_mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
