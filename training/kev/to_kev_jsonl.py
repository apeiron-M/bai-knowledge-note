"""Map our teacher rows to Kev's training JSONL (kev.data.load_records format), using the X4 W3 wording.

python3 training/kev/to_kev_jsonl.py <rows.jsonl> <round10 split/val.jsonl> <catalog.json> <outdir>
Writes train.jsonl (rows not in the Round 10 val split) and calibration.jsonl (the Round 10 val source rows), both with
  question "op":     choice over the row's scoped ops (catalog order, humanised name: OP_DESCRIPTIONS) + "answer a question"
  question "change": noul, true when the row has an op
No held-out item is read; the eval-leak filter already ran on these rows in Round 10.
Also writes provenance.json: sha256 of every input and output, and the record counts. The record bytes are unchanged
from the X4 converter that produced the shipped Kev-FT data (see training/kev/README.md, "Data provenance").
"""
import hashlib
import json
import sys
from pathlib import Path

NONE_NAME = "answer a question"
NONE_DESC = "The user only asks a question about the document or wants information; no operation is applied."


def human(s):
    return s.lower().replace("_", " ").replace("-", " ")


def main():
    rows_f, val_f, cat_f, outdir = sys.argv[1:5]
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    cat = json.load(open(cat_f))
    by_model = {}
    for c in cat:
        by_model.setdefault(c["docType"], []).append(c)
    val_ids = {json.loads(l)["meta"]["id"] for l in open(val_f)}
    n = {"train": 0, "calibration": 0}
    lens = []
    with open(out / "train.jsonl", "w") as tr, open(out / "calibration.jsonl", "w") as ca:
        for line in open(rows_f):
            r = json.loads(line)
            ops = by_model[r["docType"]]
            model = r["docType"].removeprefix("bai/")
            criteria = {human(c["opName"]): c["override"] for c in ops}
            criteria[NONE_NAME] = NONE_DESC
            label = NONE_NAME if r["op"] is None else human(r["op"].split(":", 1)[1])
            assert label in criteria, (r["id"], label)
            rec = {
                "state": f"Request: {r['utterance']}",
                "questions": {
                    "op": {"type": "choice",
                           "instructions": f"Which operation should be applied to this {human(model)} document to carry out the request?",
                           "criteria": criteria, "label": label},
                    "change": {"type": "noul",
                               "instructions": f"The user wants something in the {human(model)} document to be changed, added or removed.",
                               "label": r["op"] is not None},
                },
                "_meta": {"id": r["id"], "group_id": r["id"]},
            }
            part = "calibration" if r["id"] in val_ids else "train"
            (ca if part == "calibration" else tr).write(json.dumps(rec, ensure_ascii=False) + "\n")
            n[part] += 1
            lens.append(sum(len(k) + len(v or "") for k, v in criteria.items()))
    sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
    prov = {"inputs": {"rows": {"path": rows_f, "sha256": sha(rows_f)}, "val": {"path": val_f, "sha256": sha(val_f)},
                       "catalog": {"path": cat_f, "sha256": sha(cat_f)}},
            "outputs": {f: sha(out / f) for f in ("train.jsonl", "calibration.jsonl")}, "records": n}
    json.dump(prov, open(out / "provenance.json", "w"), indent=1)
    print(json.dumps({"records": n, "criteria_chars_max": max(lens)}))


if __name__ == "__main__":
    main()
