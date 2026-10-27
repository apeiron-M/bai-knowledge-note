#!/usr/bin/env python3
"""Validates retarget-dev.json. Usage: python3 validate.py [set.json] [repo-root]
(defaults: ../retarget-dev.json and the repo root four levels up)

Exits non-zero on any error or failed assertion. Field classes follow op-catalog.ts
(classifyField + DEFAULT_FIELD_OVERRIDES), read from the GraphQL schemas.
"""
import collections
import glob
import json
import os
import re
import sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
EVAL_DIR = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(EVAL_DIR)))

SET_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(EVAL_DIR, "retarget-dev.json")
ROOT = sys.argv[2] if len(sys.argv) > 2 else REPO_ROOT
S = json.load(open(SET_PATH))
errors, warns = [], []

MODEL_DIR = {"wbs": "work-breakdown-structure"}
OVERRIDES = {
    "knowledge-note:SUBMIT_FOR_REVIEW:id": "new-id", "knowledge-note:APPROVE_NOTE:id": "new-id",
    "knowledge-note:REJECT_NOTE:id": "new-id", "knowledge-note:ARCHIVE_NOTE:id": "new-id",
    "knowledge-note:RESTORE_NOTE:id": "new-id", "wbs:ADD_NOTE:noteId": "new-id",
    "wbs:ADD_DEPENDENCIES:id": "ref-id",
}


def snake(pascal):
    return re.sub(r"(?<!^)([A-Z])", r"_\1", pascal).upper()


# op key -> {field: (gqlType, fieldClass)}
OPS = {}
MODELS = set()
for path in glob.glob(os.path.join(ROOT, "document-models/*/v1/schema.graphql")):
    d = path.split("/")[-3]
    model = "wbs" if d == "work-breakdown-structure" else d
    MODELS.add(model)
    sdl = open(path).read()
    types = {m.group(1): m.group(2) for m in re.finditer(r"input\s+(\w+)\s*\{([^}]*)\}", sdl)}
    for tname, body in types.items():
        if not tname.endswith("Input") or tname == "PhaseHandoffInput" or tname == "GraphMetricsInput":
            continue
        op = snake(tname[:-5])
        fields = {}
        for line in body.split("\n"):
            fm = re.match(r"^\s*(\w+)\s*:\s*([\w\[\]!]+)", line)
            if not fm:
                continue
            name, t = fm.group(1), fm.group(2)
            g = re.sub(r"[\[\]!]", "", t)
            key = f"{model}:{op}:{name}"
            if key in OVERRIDES:
                cls = OVERRIDES[key]
            elif g == "DateTime":
                cls = "timestamp"
            elif name == "actor" or name.endswith("By"):
                cls = "actor"
            elif g == "OID":
                cls = "new-id" if name == "id" and re.match(r"^(ADD|CREATE)_", op) else "ref-id"
            elif g == "PHID" or name.endswith("Id"):
                cls = "ref-id"
            else:
                cls = "semantic"
            fields[name] = (g, cls, t.endswith("!"))
        OPS[f"{model}:{op}"] = fields


def stem(w):
    w = w.lower()
    if w.endswith("ion") and len(w) > 6:
        w = w[:-3]
        if w.endswith("at") and len(w) > 6:
            w = w[:-2]
    if w.endswith("s") and not w.endswith("ss") and not w.endswith("us") and len(w) > 3:
        w = w[:-1]
    if w.endswith("e") and len(w) > 4:
        w = w[:-1]
    return w


def leaks(utt, op):
    words = op.split(":")[1].split("_")
    toks = re.findall(r"[a-z]+", utt.lower())
    out = []
    for w in words:
        st = stem(w)
        if any(t.startswith(st) for t in toks):
            out.append(w.lower())
    return out


POINTER_ITEM_WORDS = {"goal", "task", "item", "question", "entry", "link", "topic", "member",
                      "deliverable", "check", "signal"}


def mentions(utt, frame):
    """Distinct titles mentioned verbatim (case-insensitive, word bounded, longest first)."""
    docs = list(frame["documents"])
    if frame["target"]["kind"] == "document":
        t = frame["target"]
        docs.append({"id": t["id"], "title": t["title"], "docType": t["docType"]})
    by_title = collections.defaultdict(list)
    for d in docs:
        by_title[d["title"]].append(d["id"])
    masked = utt
    found = []
    for title in sorted(by_title, key=len, reverse=True):
        pat = re.compile(r"(?<![\w])" + re.escape(title) + r"(?![\w])", re.I)
        if pat.search(masked):
            found.append(title)
            masked = pat.sub(" █ ", masked)
    return found, by_title, masked


def pointer(masked):
    for m in re.finditer(r"\b(this|it|here)\b(\s+(\w+))?", masked, re.I):
        if m.group(1).lower() == "this" and m.group(3) and m.group(3).lower() in POINTER_ITEM_WORDS:
            continue
        return True
    return False


ORDINAL = re.compile(r"\b(first|second|third|last|top hit|1st|2nd|3rd)\b", re.I)


def q1(utt, frame):
    found, by_title, masked = mentions(utt, frame)
    open_id = frame["target"]["id"] if frame["target"]["kind"] == "document" else None
    open_title = frame["target"].get("title")
    has_ptr = pointer(masked)
    others = [t for t in found if not (t == open_title and len(by_title[t]) == 1)]
    shared = any(len(by_title[t]) > 1 for t in found)
    if not others:
        return "keep-or-near-miss", found, has_ptr
    if open_id is None:
        if len(others) == 1 and len(by_title[others[0]]) == 1:
            return "switch", found, has_ptr
        return "ask-top3", found, has_ptr
    if shared or len(others) > 1:
        return "keep", found, has_ptr
    if has_ptr:
        return "ask-two", found, has_ptr
    return "switch", found, has_ptr


def text_has_bad(s):
    """Home-directory paths, emails, or the current login name."""
    user = os.environ.get("USER") or os.environ.get("USERNAME") or ""
    if user and re.search(re.escape(user), s, re.I):
        return True
    return bool(re.search(r"/(Users|home)/|@[\w-]+\.\w", s))


raw = open(SET_PATH).read()
if text_has_bad(raw):
    errors.append("absolute path, email or username in the set")

items = S["items"]
assert S["conventions"]["today"] == "2026-10-27"
first_hits = first_total = 0
models_seen = set()
ops_seen = collections.Counter()
for it in items:
    iid = it["id"]
    ex = it["expected"]
    op = ex["op"]
    if op not in OPS:
        errors.append(f"{iid}: op {op} does not exist")
        continue
    ops_seen[op] += 1
    model = op.split(":")[0]
    models_seen.add(model)
    ctx = it["context"]
    if ctx["model"] != model:
        errors.append(f"{iid}: context.model {ctx['model']} != op model {model}")
    fields = OPS[op]
    for bucket in ("args", "ambiguousArgs"):
        for f in ex[bucket]:
            if f not in fields:
                errors.append(f"{iid}: {bucket}.{f} not an input field of {op}")
            elif fields[f][1] != "semantic":
                errors.append(f"{iid}: {bucket}.{f} is {fields[f][1]}, not semantic")
    for f in ex["requiredPresent"]:
        if f not in fields or fields[f][1] != "semantic":
            errors.append(f"{iid}: requiredPresent {f} not a semantic field")
    cand_ids = [c["id"] for c in ctx["refCandidates"]]
    for f, v in ex["refArgs"].items():
        if f not in fields or fields[f][1] != "ref-id":
            errors.append(f"{iid}: refArgs.{f} is not a ref-id field")
        if v not in cand_ids:
            errors.append(f"{iid}: refArgs.{f} not among refCandidates")
        first_total += 1
        first_hits += int(cand_ids and cand_ids[0] == v)
    # every required semantic field is scored or required-present
    for f, (g, cls, req) in fields.items():
        if req and cls == "semantic" and f not in ex["args"] and f not in ex["requiredPresent"] \
                and f not in ex["ambiguousArgs"]:
            errors.append(f"{iid}: required semantic field {f} is not covered")
        if req and cls == "ref-id" and f not in ex["refArgs"]:
            errors.append(f"{iid}: required ref-id field {f} missing from refArgs")
    # hard case
    if it["difficulty"] == "hard":
        hc = it.get("hardCase")
        if not hc:
            errors.append(f"{iid}: hard item without hardCase")
        else:
            for c in hc["confusableWith"]:
                if c not in OPS or c == op:
                    errors.append(f"{iid}: confusableWith {c} invalid")
    # style
    lk = leaks(it["utterance"], op)
    if lk and it["style"] == "paraphrase":
        errors.append(f"{iid}: paraphrase leaks op words {lk}")
    elif lk:
        warns.append(f"{iid}: natural item uses op words {lk}")
    # frame consistency
    fr = ctx["frame"]
    tgt = ex["target"]
    all_ids = {d["id"] for d in fr["documents"]}
    if fr["target"]["kind"] == "document":
        if fr["target"]["id"] in all_ids:
            errors.append(f"{iid}: open document repeated in frame.documents")
        all_ids.add(fr["target"]["id"])
    if tgt["documentId"] is not None:
        if tgt["documentId"] not in all_ids:
            errors.append(f"{iid}: target document not in the drive")
        if tgt["documentId"] != ctx["documentId"]:
            errors.append(f"{iid}: context is not the gold target document")
    for a in tgt.get("acceptable", []):
        if a["op"] not in OPS or a["documentId"] not in all_ids:
            errors.append(f"{iid}: bad acceptable entry")
    # Q1 rule check against the gold resolution
    via = tgt["via"]
    rule, found, ptr = q1(it["utterance"], fr)
    if via in ("ordinal", "ordinal-ref"):
        if not fr.get("visibleResults") or not ORDINAL.search(it["utterance"]):
            errors.append(f"{iid}: ordinal item without visible results or ordinal word")
        else:
            vis = [d["id"] for d in fr["visibleResults"]["items"]]
            if via == "ordinal" and tgt["documentId"] not in vis:
                errors.append(f"{iid}: ordinal target not visible")
    elif tgt["resolution"] == "ask-top3":
        if rule not in ("keep-or-near-miss",):
            errors.append(f"{iid}: near-miss item has a verbatim title mention {found}")
    elif rule == "keep-or-near-miss":
        if tgt["resolution"] != "keep":
            errors.append(f"{iid}: no other title, but gold is {tgt['resolution']}")
    elif rule != tgt["resolution"]:
        errors.append(f"{iid}: Q1 gives {rule} (titles {found}, pointer {ptr}), gold {tgt['resolution']}")
    if tgt["resolution"] == "ask-two" and not ptr:
        errors.append(f"{iid}: ask-two without a pointer")
    if tgt["resolution"] == "ask-two":
        if tgt["options"][0] != fr["target"]["id"]:
            errors.append(f"{iid}: first ask option is not the open document")
        if tgt["documentId"] not in tgt["options"]:
            errors.append(f"{iid}: gold not among ask options")

for na in S["noAction"]:
    rule, found, ptr = q1(na["utterance"], na["context"]["frame"])
    exp = na["ruleResolution"]
    if rule == "keep-or-near-miss":
        rule = "keep"
    if rule != exp:
        errors.append(f"{na['id']}: noAction Q1 gives {rule}, recorded {exp}")
    if na["context"]["frame"]["target"]["kind"] == "document" and not na["context"]["model"]:
        errors.append(f"{na['id']}: not scoped")
for ma in S["multiAction"]:
    for st in ma["expected"]:
        if st["op"] not in OPS or st["op"].split(":")[0] != ma["context"]["model"]:
            errors.append(f"{ma['id']}: step op invalid or unscoped")
        for f, v in st["refArgs"].items():
            if v not in [c["id"] for c in ma["context"]["refCandidates"]]:
                errors.append(f"{ma['id']}: step ref not among candidates")
    rule, found, ptr = q1(ma["utterance"], ma["context"]["frame"])
    if rule != ma["target"]["resolution"]:
        errors.append(f"{ma['id']}: Q1 gives {rule}, gold {ma['target']['resolution']}")

# ---- assertions
n = len(items)
styles = collections.Counter(i["style"] for i in items)
if abs(styles["natural"] - styles["paraphrase"]) > 1:
    errors.append(f"ASSERT style split {dict(styles)}")
hard = sum(i["difficulty"] == "hard" for i in items)
if hard / n < 0.25:
    errors.append(f"ASSERT hard {hard}/{n} < 25%")
if first_total and first_hits / first_total > 0.25:
    errors.append(f"ASSERT first candidate correct {first_hits}/{first_total} > 25%")
missing = MODELS - models_seen
if missing:
    errors.append(f"ASSERT models missing: {sorted(missing)}")
if len(S["noAction"]) < 5:
    errors.append("ASSERT fewer than 5 noAction")

print(f"items {n}, noAction {len(S['noAction'])}, multiAction {len(S['multiAction'])}")
print(f"style {dict(styles)}; wording {dict(collections.Counter(i['wording'] for i in items))}")
print(f"hard {hard}/{n} = {hard / n:.0%}; first-candidate-correct {first_hits}/{first_total}")
print(f"distinct ops {len(ops_seen)}; models {len(models_seen)}/{len(MODELS)}")
print(f"warnings {len(warns)} (natural items using op words)")
for e in errors:
    print("ERROR", e)
print(f"errors {len(errors)}")
sys.exit(1 if errors else 0)
