"""Overlap of this set's utterances against every earlier eval set file.

Prints ids, file names and scores only, never the other sets' text. Skips results-*.json
by default (pass --include-results to compare against them too).
Usage: python3 overlap.py [set.json] [eval-dir]   (defaults: ../retarget-dev.json and ..)
"""
import glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
INCLUDE_RESULTS = "--include-results" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
evald = args[1] if len(args) > 1 else os.path.dirname(HERE)
mine = json.load(open(args[0] if args else os.path.join(evald, "retarget-dev.json")))
def toks(s): return re.findall(r"[a-z0-9]+", s.lower())
def grams(t, n): return {tuple(t[i:i+n]) for i in range(len(t)-n+1)}
M = [(e["id"], e["utterance"]) for k in ("items", "noAction", "multiAction") for e in mine[k]]
theirs = []
def walk(x, f, path):
    if isinstance(x, dict):
        for k, v in x.items():
            if k in ("utterance", "prompt", "text", "query") and isinstance(v, str):
                theirs.append((f, x.get("id", path), v))
            else:
                walk(v, f, path + "." + k)
    elif isinstance(x, list):
        for i, v in enumerate(x): walk(v, f, f"{path}[{i}]")
for p in sorted(glob.glob(os.path.join(evald, "*.json"))):
    f = os.path.basename(p)
    if f == "retarget-dev.json" or (f.startswith("results-") and not INCLUDE_RESULTS): continue
    try: walk(json.load(open(p)), f, "")
    except Exception: pass
print(f"compared {len(M)} utterances against {len(theirs)} strings in earlier files")
mx = (0, None); g4 = []; g3 = 0
for mid, mu in M:
    mt = toks(mu); ms = set(mt)
    for f, tid, tu in theirs:
        tt = toks(tu); ts = set(tt)
        if not ms or not ts: continue
        j = len(ms & ts) / len(ms | ts)
        if j > mx[0]: mx = (j, (mid, f))
        if grams(mt, 4) & grams(tt, 4): g4.append((mid, f))
        if grams(mt, 3) & grams(tt, 3): g3 += 1
        if j > 0.4: print(f"JACCARD {j:.2f} {mid} vs {f}")
print(f"max jaccard {mx[0]:.2f} {mx[1]}")
for x in sorted(set(g4)): print("SHARED-4GRAM", *x)
print(f"pairs sharing a 4-gram: {len(g4)}; pairs sharing a 3-gram: {g3}")
