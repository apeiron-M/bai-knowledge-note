"""Load GGUFs in llama-server (b11364) and run step-1 prompts under a GBNF
enum grammar of the candidate keys, plus step-2 prompts under the runtime's
json-schema grammar; temperature 0. Compares each model against the targets.

  python training/py/smoke_infer.py rendered.jsonl --gguf a.gguf --gguf b.gguf --out result.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llama_server import LlamaServer  # noqa: E402


def gbnf_lit(s: str) -> str:
    return json.dumps(s)  # GBNF literal escaping matches JSON for these strings


def op_enum_grammar(keys: list[str]) -> str:
    alts = " | ".join(gbnf_lit(json.dumps(k)) for k in keys)
    return f'root ::= "{{" {gbnf_lit(chr(34) + "op" + chr(34) + ": ")} ({alts}) "}}"'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rendered")
    ap.add_argument("--gguf", action="append", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-gpu-layers", default="99")
    args = ap.parse_args()
    steps = [json.loads(l) for l in Path(args.rendered).read_text().splitlines() if l.strip()]
    steps = [s for s in steps if s.get("target") is not None]
    results = []
    for gguf in args.gguf:
        t_load = time.time()
        with LlamaServer(gguf, extra=["-ngl", args.n_gpu_layers]) as srv:
            load_sec = time.time() - t_load
            rows = []
            for s in steps:
                prompt = srv.post("/apply-template", {"messages": s["messages"]})["prompt"]
                grammar = op_enum_grammar(s["candidates"]) if s["step"] == 1 else s["grammar"]
                t0 = time.time()
                r = srv.post("/completion", {"prompt": prompt, "grammar": grammar, "temperature": 0,
                                             "n_predict": 64 if s["step"] == 1 else 192, "cache_prompt": False})
                rows.append({
                    "id": s["id"], "step": s["step"], "target": s["target"], "output": r["content"],
                    "exact": r["content"] == s["target"], "stop": r.get("stop_type"),
                    "predictedN": r["timings"]["predicted_n"], "promptN": r["timings"]["prompt_n"],
                    "wallMs": round((time.time() - t0) * 1000, 1),
                })
        results.append({
            "gguf": Path(gguf).name, "bytes": Path(gguf).stat().st_size, "serverStartSec": round(load_sec, 2),
            "step1Exact": sum(r["exact"] for r in rows if r["step"] == 1), "step1N": sum(r["step"] == 1 for r in rows),
            "step2Exact": sum(r["exact"] for r in rows if r["step"] == 2), "step2N": sum(r["step"] == 2 for r in rows),
            "rows": rows,
        })
    Path(args.out).write_text(json.dumps(results, indent=2) + "\n")
    for res in results:
        print(json.dumps({k: v for k, v in res.items() if k != "rows"}))
        for r in res["rows"]:
            print(f'  {r["id"]}#{r["step"]} exact={r["exact"]} n={r["predictedN"]} {r["wallMs"]}ms {r["output"]!r}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
