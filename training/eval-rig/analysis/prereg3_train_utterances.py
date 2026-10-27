"""Pre-registration 3: the training utterances of every model in arms A-D, as {id, utterance} rows (stdlib only).

  python3 prereg3_train_utterances.py <out-dir>

Training files only (no eval or blind file is read):
  X5 and F  training/artifacts/round11-para/merged/split/train-split.jsonl (sha 1c4718d3...; both trained on it):
            the utterance is the `Request: ...<|im_end|>` of each sequence's prompt, one per meta.id
  Kev-FT    $KEV_TRAIN (default exp/x4-kev/finetune/data/train.jsonl in $RIG_EXP; regenerate with training/kev/to_kev_jsonl.py)
            (sha ed3d9aac...): `state` minus its `Request: ` prefix, per _meta.id
Asserts the source shas, exactly one request per prompt, and one utterance per id. Writes
<out-dir>/train-utterances-round11.jsonl, train-utterances-kevft.jsonl and train-utterances.summary.json. These files are
the `<file>:*` exclusion specs of PREREGISTRATION-3 (rig/src/exclude.py tests every row against every eval item).
"""
import hashlib, json, os, re, sys

REPO = os.environ.get("RIG_REPO") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
EXP = os.environ.get("RIG_EXP") or os.path.join(REPO, "training", "artifacts", "exp-2026-10-23")
SRC = {"round11": (f"{REPO}/training/artifacts/round11-para/merged/split/train-split.jsonl",
                   "1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d"),
       "kevft": (os.environ.get("KEV_TRAIN") or f"{EXP}/x4-kev/finetune/data/train.jsonl",
                 "ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65")}
REQ = re.compile(r"Request: (.*?)<\|im_end\|>", re.S)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def rows_round11(p):
    for k, l in enumerate(open(p)):
        if not l.strip(): continue
        s = json.loads(l); m = REQ.findall(s["prompt"])
        if len(m) != 1: raise SystemExit(f"round11 line {k}: {len(m)} requests in the prompt")
        yield s["meta"]["id"], m[0]


def rows_kevft(p):
    for k, l in enumerate(open(p)):
        if not l.strip(): continue
        r = json.loads(l); st = r["state"]
        if not st.startswith("Request: "): raise SystemExit(f"kevft line {k}: state does not start with 'Request: '")
        yield r["_meta"]["id"], st[len("Request: "):]


def main():
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    summary = {}
    for name, gen in (("round11", rows_round11), ("kevft", rows_kevft)):
        p, want = SRC[name]
        got = sha(p)
        if got != want: raise SystemExit(f"{name}: {p} sha256 {got} != {want}")
        seen, order, n = {}, [], 0
        for rid, u in gen(p):
            n += 1
            if rid in seen:
                if seen[rid] != u: raise SystemExit(f"{name}: id {rid} has two utterances")
                continue
            seen[rid] = u; order.append(rid)
        dst = os.path.join(out, f"train-utterances-{name}.jsonl")
        with open(dst, "w") as f:
            for rid in order: f.write(json.dumps({"id": rid, "utterance": seen[rid]}, ensure_ascii=False) + "\n")
        summary[name] = {"source": p, "sourceSha256": got, "sourceRecords": n, "rows": len(order), "out": os.path.basename(dst), "outSha256": sha(dst)}
        print(f"{name}: {n} records -> {len(order)} rows, {dst} sha256 {summary[name]['outSha256']}", file=sys.stderr)
    json.dump(summary, open(os.path.join(out, "train-utterances.summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
