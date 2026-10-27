"""Unified item loader for the rig.  python3 items.py <set> <out.jsonl>

  dev      held-out-3 + held-out-4 (repo spike/llm-harness/eval), items + noAction + multiAction
  val      Round 8 teacher val (168 step-1 rows; 107 also carry step-2 args), as X3 lora-run / X6 / X9
  heldout5 $BAI_BLIND_DIR/heldout5/heldout5-eval.json (default training/artifacts/blind) -- CODE PATH ONLY;
           refused unless RIG_BLIND_OK=1
  file:<path>  any item set in the held-out schema (items / noAction / multiAction / conventions)

Per item: id, set (<g>|<g>na|<g>multi|val|valna), group, style, difficulty, utterance, docType,
model, gold (op | "none" | null for multi), goldOps, expected-args fields, refCandidates (raw),
state, ctx, fixture (val only; replayed to state in step2.ts), teacherArgs, hasStep2, today.

today: the set's own conventions.today (first 10 chars) when the file has one (X9 date plumbing);
teacher rows use the fixture replay clock REPLAY_NOW from training/gen/replay.ts (2026-10-20).
"""
import json, os, re, sys

REPO = os.environ.get("RIG_REPO") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
EV = f"{REPO}/spike/llm-harness/eval"
ART = f"{REPO}/training/artifacts"
BLIND = os.environ.get("BAI_BLIND_DIR") or os.path.join(REPO, "training", "artifacts", "blind")
H5 = os.path.join(BLIND, "heldout5", "heldout5-eval.json")


def heldout(path, group):
    d = json.load(open(path))
    conv = d.get("conventions") or {}
    today = str(conv["today"])[:10] if conv.get("today") else None
    if today and not re.match(r"^\d{4}-\d{2}-\d{2}$", today):
        raise SystemExit(f"bad conventions.today in {path}: {conv['today']!r}")
    out = []
    for suffix, arr in [("", d.get("items", [])), ("na", d.get("noAction", [])), ("multi", d.get("multiAction", []) or [])]:
        for it in arr:
            exp, ctx = it.get("expected"), it["context"]
            r = {"id": it["id"], "set": group + suffix, "group": group, "style": it.get("style"),
                 "difficulty": it.get("difficulty"), "tags": it.get("tags"), "utterance": it["utterance"],
                 "docType": ctx["docType"], "model": ctx.get("model"), "refCandidates": ctx.get("refCandidates") or {},
                 "state": ctx.get("state"), "ctx": [], "today": today, "hasStep2": False}
            if isinstance(exp, list):
                r.update(gold=None, goldOps=[e["op"] for e in exp])
            elif not exp:
                r.update(gold="none", goldOps=None)
            else:
                r.update(gold=exp["op"], goldOps=None, args=exp.get("args"), ambiguousArgs=exp.get("ambiguousArgs"),
                         refArgs=exp.get("refArgs"), argMatch=exp.get("argMatch"),
                         requiredPresent=exp.get("requiredPresent", it.get("requiredPresent")), hasStep2=True)
            out.append(r)
    return out


def val():
    meta = [json.loads(l)["meta"] for l in open(f"{ART}/round8/split/val.jsonl") if l.strip()]
    s1 = [m["id"] for m in meta if m.get("step") == 1 and m.get("variant") == "full"]
    s2 = {m["id"] for m in meta if m.get("step") == 2}
    src = {}
    for l in open(f"{ART}/teacher-full/agreed-s1.jsonl"):
        if l.strip():
            r = json.loads(l); src[r["id"]] = r
    now = re.search(r'REPLAY_NOW = "(\d{4}-\d{2}-\d{2})', open(f"{REPO}/training/gen/replay.ts").read()).group(1)
    out = []
    for i in s1:
        r = src[i]
        rc = {p: [c if isinstance(c, dict) else {"id": c} for c in cs] for p, cs in (r.get("refCandidates") or {}).items()}
        out.append({"id": i, "set": "val" if r.get("op") else "valna", "group": "val", "style": "teacher", "difficulty": None,
                    "tags": None, "utterance": r["utterance"], "docType": r["docType"], "model": None,
                    "gold": r.get("op") or "none", "goldOps": None, "teacherArgs": r.get("args") if r.get("op") else None,
                    "refCandidates": rc, "fixture": r.get("fixture") if isinstance(r.get("fixture"), list) else None,
                    "state": None, "ctx": r.get("refContext") if isinstance(r.get("refContext"), list) else [],
                    "today": now, "hasStep2": bool(r.get("op")) and i in s2})
    return out


def main():
    which, outp = sys.argv[1], sys.argv[2]
    if which == "dev":
        rows = heldout(f"{EV}/heldout3-eval.json", "h3") + heldout(f"{EV}/heldout4-eval.json", "h4")
    elif which == "val":
        rows = val()
    elif which == "heldout5":
        if os.environ.get("RIG_BLIND_OK") != "1":
            raise SystemExit("heldout5 is a blind set: refusing without --blind-ok (RIG_BLIND_OK=1). Blind runs are pre-registered and separate.")
        rows = heldout(H5, "h5")
    elif which.startswith("file:"):
        p = which[5:]
        rows = heldout(p, re.sub(r"[^a-z0-9]", "", os.path.basename(p).split("-")[0].lower()) or "set")
    else:
        raise SystemExit(f"unknown set {which}")
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "duplicate ids"
    with open(outp, "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    single = [r for r in rows if r["gold"] is not None]
    print(json.dumps({"set": which, "n": len(rows), "action": sum(r["gold"] not in (None, "none") for r in rows),
                      "noAction": sum(r["gold"] == "none" for r in rows), "multi": len(rows) - len(single),
                      "step2": sum(r["hasStep2"] for r in rows), "today": sorted({r["today"] for r in rows if r["today"]})}))


if __name__ == "__main__":
    main()
