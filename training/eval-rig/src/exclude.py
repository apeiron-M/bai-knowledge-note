"""Run-start exclusion of eval items that near-copy a training row (stdlib only).

  python3 exclude.py <items.jsonl> <excluded.json> <training-row-file>:<row-id> [...]

For each spec, loads the training row <row-id> (JSONL or JSON array of rows with `id` / `meta.id` and `utterance` /
`meta.utterance`) and tests every item of <items.jsonl> exactly as training/round11-para/para.py tests a training row
against an eval set: dedup.leak_hit(dedup.normalize(<training utterance>), [<item prepared as dedup.load_eval does>]),
i.e. char or word trigram Jaccard >= dedup.LEAK_THRESHOLD (0.5), or containment of a 3+-word item utterance, or equality.
dedup is imported from the repo (training/py/dedup.py); its sha256 is recorded. Every hit is removed from <items.jsonl>
(rewritten in place). Blind safety: only item ids and scores are printed or written, never an utterance (leak_hit's
evalUtterance / evalSource are dropped). Zero hits is a WARN, not an error.

<row-id> `*` (added for PREREGISTRATION-3) tests EVERY row of the file the same way: each row must carry an id and an
utterance (same field rules), a repeated id must repeat the same utterance. Each row is first screened with one
dedup.leak_hit call against all items (None = no item reaches the threshold); only rows that pass get the per-item
calls above, so the result is identical to testing every (row, item) pair. Hits are written as {id, score, rowId}.
"""
import hashlib, json, os, sys
sys.dont_write_bytecode = True  # never write a __pycache__ into the repo

REPO = os.environ.get("RIG_REPO") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "training", "py"))
import dedup  # noqa: E402

sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()


def load_rows(path):
    txt = open(path).read()
    if txt.lstrip().startswith("["): return json.loads(txt)
    return [json.loads(l) for l in txt.splitlines() if l.strip()]


def training_utterance(path, rid):
    found = set()
    for r in load_rows(path):
        meta = r.get("meta") or {}
        if r.get("id") == rid or meta.get("id") == rid:
            u = r.get("utterance") or meta.get("utterance")
            if isinstance(u, str): found.add(u)
    if not found: raise SystemExit(f"exclude: row {rid} with an utterance not found in {path}")
    if len(found) > 1: raise SystemExit(f"exclude: row {rid} has {len(found)} different utterances in {path}")
    return found.pop()


def all_rows(path):
    """[(row id, utterance)] for every row of the file (spec <file>:*), first occurrence order, ids unique."""
    seen, out = {}, []
    for k, r in enumerate(load_rows(path)):
        meta = r.get("meta") or {}
        rid, u = r.get("id") or meta.get("id"), r.get("utterance") or meta.get("utterance")
        if not isinstance(rid, str) or not isinstance(u, str): raise SystemExit(f"exclude: row {k} of {path} lacks an id or an utterance")
        if rid in seen:
            if seen[rid] != u: raise SystemExit(f"exclude: row {rid} has 2 different utterances in {path}")
            continue
        seen[rid] = u; out.append((rid, u))
    if not out: raise SystemExit(f"exclude: no rows in {path}")
    return out


def main():
    items_p, out_p, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
    items = [json.loads(l) for l in open(items_p) if l.strip()]
    prepped = []
    for it in items:
        n = dedup.normalize(it["utterance"])
        prepped.append({"utterance": it["utterance"], "source": it["set"], "id": it["id"], "norm": n,
                        "c3": dedup.char_trigrams(n), "w3": dedup.word_trigrams(n)})
    matches, drop = [], {}
    for spec in specs:
        path, sep, rid = spec.rpartition(":")
        if not sep or not path or not rid: raise SystemExit(f"exclude: bad spec {spec!r} (want <file>:<row-id>)")
        if rid == "*":
            rows, hits = all_rows(path), []
            for row_id, u in rows:
                n = dedup.normalize(u)
                if not dedup.leak_hit(n, prepped): continue
                for e in prepped:
                    h = dedup.leak_hit(n, [e])
                    if h: hits.append({"id": e["id"], "score": h["score"], "rowId": row_id})
            for h in hits: drop[h["id"]] = max(drop.get(h["id"], 0), h["score"])
            matches.append({"spec": f"{os.path.basename(path)}:*", "file": os.path.abspath(path), "fileSha256": sha(path),
                            "rowId": "*", "nRows": len(rows), "hits": hits})
            print(f"exclude {os.path.basename(path)}:* ({len(rows)} rows): " + (", ".join(f"{h['id']} score {h['score']} (row {h['rowId']})" for h in hits) or "WARN no hit"), file=sys.stderr)
            continue
        norm = dedup.normalize(training_utterance(path, rid))
        hits = []
        for e in prepped:
            h = dedup.leak_hit(norm, [e])
            if h: hits.append({"id": e["id"], "score": h["score"]})
        for h in hits: drop[h["id"]] = max(drop.get(h["id"], 0), h["score"])
        matches.append({"spec": f"{os.path.basename(path)}:{rid}", "file": os.path.abspath(path), "fileSha256": sha(path),
                        "rowId": rid, "hits": hits})
        print(f"exclude {os.path.basename(path)}:{rid}: " + (", ".join(f"{h['id']} score {h['score']}" for h in hits) or "WARN no hit"), file=sys.stderr)
    kept = [it for it in items if it["id"] not in drop]
    with open(items_p, "w") as f:
        for it in kept: f.write(json.dumps(it) + "\n")
    rep = {"threshold": dedup.LEAK_THRESHOLD, "containMinWords": dedup.CONTAIN_MIN_WORDS, "dedup": dedup.__file__,
           "dedupSha256": sha(dedup.__file__), "nItemsBefore": len(items), "nExcluded": len(drop),
           "excludedIds": sorted(drop), "matches": matches}
    json.dump(rep, open(out_p, "w"), indent=1)
    print(json.dumps({"excluded": len(drop), "ids": sorted(drop), "nItems": len(kept)}), file=sys.stderr)


if __name__ == "__main__":
    main()
