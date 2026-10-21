"""Leakage and duplicate filter for training rows.

Rejects a training row when its utterance is near-identical to any eval
utterance (held-out, dev, seed, no-action), contains one of 3+ words, or is
near-identical to an earlier kept row of the same op. Every JSON file under the eval dirs is walked for `utterance` keys,
so a new held-out set dropped into spike/llm-harness/eval/ is covered with no
code change.

  python training/py/dedup.py rows.jsonl --out kept.jsonl [--eval extra.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_EVAL_DIRS = [REPO / "spike/llm-harness/eval"]
LEAK_THRESHOLD = 0.5  # trigram Jaccard vs any eval utterance (char or word)
DUP_THRESHOLD = 0.5  # word-trigram Jaccard vs kept rows of the same op
CONTAIN_MIN_WORDS = 3  # an eval utterance this long inside a row is a leak too


def normalize(text: str) -> str:
    text = text.lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def char_trigrams(norm: str) -> set[str]:
    padded = f"  {norm} "
    return {padded[i : i + 3] for i in range(len(padded) - 2)}


def word_trigrams(norm: str) -> set[tuple[str, ...]]:
    words = ["<s>", *norm.split(), "</s>"]
    return {tuple(words[i : i + 3]) for i in range(len(words) - 2)}


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def collect_utterances(node: object, source: str, out: list[dict]) -> None:
    if isinstance(node, dict):
        u = node.get("utterance")
        if isinstance(u, str):
            out.append({"utterance": u, "source": source, "id": node.get("id")})
        for v in node.values():
            collect_utterances(v, source, out)
    elif isinstance(node, list):
        for v in node:
            collect_utterances(v, source, out)


def load_eval(dirs: list[Path], files: list[Path]) -> list[dict]:
    paths = [p for d in dirs for p in sorted(d.glob("*.json"))] + files
    items: list[dict] = []
    for p in paths:
        collect_utterances(json.loads(p.read_text()), p.name, items)
    seen: dict[str, dict] = {}
    for it in items:
        n = normalize(it["utterance"])
        if n not in seen:
            seen[n] = {**it, "norm": n, "c3": char_trigrams(n), "w3": word_trigrams(n)}
    return list(seen.values())


def contains(norm: str, eval_norm: str) -> bool:
    """A whole eval utterance of CONTAIN_MIN_WORDS+ words inside a longer row
    (word-bounded): the Jaccard scores miss it when the row adds context."""
    return len(eval_norm.split()) >= CONTAIN_MIN_WORDS and f" {eval_norm} " in f" {norm} "


def leak_hit(norm: str, evals: list[dict]) -> dict | None:
    c3, w3 = char_trigrams(norm), word_trigrams(norm)
    best = None
    for e in evals:
        contained = contains(norm, e["norm"])
        score = 1.0 if norm == e["norm"] or contained else max(jaccard(c3, e["c3"]), jaccard(w3, e["w3"]))
        if score >= LEAK_THRESHOLD and (best is None or score > best["score"]):
            best = {"score": round(score, 3), "evalSource": e["source"], "evalId": e["id"], "evalUtterance": e["utterance"],
                    **({"contained": True} if contained and norm != e["norm"] else {})}
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rows")
    ap.add_argument("--out")
    ap.add_argument("--report")
    ap.add_argument("--eval", action="append", default=[], type=Path)
    ap.add_argument("--eval-dir", action="append", default=[], type=Path)
    args = ap.parse_args()

    evals = load_eval(args.eval_dir or DEFAULT_EVAL_DIRS, args.eval)
    kept, rejected = [], []
    kept_by_op: dict[str | None, list[set]] = {}
    for line in Path(args.rows).read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        norm = normalize(row["utterance"])
        hit = leak_hit(norm, evals)
        if hit:
            rejected.append({"id": row["id"], "utterance": row["utterance"], "reason": "eval-leak", **hit})
            continue
        w3 = word_trigrams(norm)
        prior = kept_by_op.setdefault(row.get("op"), [])
        dup = max((jaccard(w3, p) for p in prior), default=0.0)
        if dup >= DUP_THRESHOLD:
            rejected.append({"id": row["id"], "reason": "near-duplicate", "score": round(dup, 3)})
            continue
        prior.append(w3)
        kept.append(row)

    summary = {"evalUtterances": len(evals), "rows": len(kept) + len(rejected), "kept": len(kept), "rejected": rejected}
    if args.out:
        Path(args.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept))
    if args.report:
        Path(args.report).write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
