"""Round 11 (X5): phrasing-diversity rewrites of Round 10's kept rows.

The teacher rewrites a kept row's utterance in a human style (terse,
lowercase, typos, abbreviations, phone-typed, non-native English,
question-as-request, indirect / partial titles, synonyms for field names,
rambling) while keeping the same gold action. Args are NOT asked of the
teacher: they are derived from the source row's gold (enum, ref, number and
boolean fields carry over; every free-text value must appear verbatim in
the rewrite, case-only changes allowed for the lowercase / phone styles).
The blind second pass (`teacher.py label` + `agree`) then keeps a rewrite
only when its label equals that gold (op + args).

Blind sets (held-out-5/6) are only ever read by code here: leak hits from
them are reported as counts and scores, never with the eval item or the
matching row's text.

  sources   pick source rows (blind prefilter, per-op budget)     -> sources.jsonl
  plan      rewrite requests, batch 10 per op (+ prompt leak check) -> requests.jsonl
  rows      teacher results -> candidate rows (value / op-word / account checks)
  leak      eval-leak (held-out 1-4 + blind 5/6) and near-duplicate filter,
            near-duplicates seeded with prior rows (Round 10)
  promptcheck  eval utterances (incl. blind) inside request prompts: counts only
  split     train/val split of a rendered train.jsonl grouped by source row
  stats     per-style funnel and wording statistics for the report
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import random
import re
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "training/py"))
import dedup  # noqa: E402
import teacher as T  # noqa: E402

PROMPT_VERSION = "para-p2"
# Blind sets live outside git: $BAI_BLIND_DIR (default training/artifacts/blind,
# which is gitignored) holds heldout5/heldout5-eval.json and heldout6/heldout6-eval.json.
BLIND_DIR = Path(os.environ.get("BAI_BLIND_DIR", REPO / "training/artifacts/blind"))
BLIND_FILES = {"heldout5": BLIND_DIR / "heldout5/heldout5-eval.json",
               "heldout6": BLIND_DIR / "heldout6/heldout6-eval.json"}

STYLES = {
    "terse": "Terse: the request part is at most 5 words, not counting the copied values; a fragment is fine "
             "(for example {ex}); no greeting, no please.",
    "lowercase": "All lowercase, almost no punctuation, no capital letter anywhere (you may lowercase the values "
                 "too, but keep their words and characters otherwise the same).",
    "typos": "Typed carelessly: 2 or 3 realistic typos in ordinary words, never inside a value (for example {ex}).",
    "abbrev": "Chat shorthand: a few abbreviations such as {ex}; still understandable.",
    "phone": "Typed fast on a phone: {ex} (you may lowercase the values, keep their words).",
    "nonnative": "Written by a non-native English speaker, still clear: {ex}.",
    "question": "A question that asks for the change, opening like '{ex}' or similar, not a question about the "
                "document.",
    "indirect": None,  # filled per op: ref ops vs others
    "synonyms": "Everyday words instead of the app's terms for the fields and things involved (for example {ex}).",
    "rambling": "Rambling, 25-50 words: a little filler (such as {ex}), one aside that changes nothing, and the "
                "request somewhere in the middle, not at the start.",
}
# Per-item example pools: each item shows 2-3 examples drawn at random, so the
# teacher does not repeat the same filler / abbreviation / opener everywhere.
STYLE_POOLS = {
    "terse": ["a bare noun phrase plus the value", "'X -> Y'", "'X: done'", "a verb and the value only",
              "the value and one word", "'X pls'", "a note-to-self fragment"],
    "typos": ["a swapped letter pair (teh)", "a missing letter (finshed)", "a doubled letter (tommorrow)",
              "a missing apostrophe (dont)", "a wrong homophone (there for their)", "a missing space (ofthe)",
              "a wrong vowel (definately)", "a missing final letter (jus)"],
    "abbrev": ["pls", "plz", "thx", "ty", "w/", "w/o", "b/c", "bc", "rn", "asap", "info", "desc", "&",
               "2 for to", "4 for for", "msg", "tmrw", "b4", "idk", "ppl", "fyi", "btw", "approx", "re:", "u", "abt"],
    "phone": ["no capital at the start", "missing apostrophes", "a run-on with no commas", "u / ur",
              "one autocorrect-style slip in an ordinary word", "a missing space after a comma",
              "no final punctuation", "a stray double letter", "an unfinished-looking ending"],
    "nonnative": ["a dropped article", "an unusual preposition", "present tense where past is expected",
                  "unusual word order", "a missing auxiliary verb (it not working)", "a literal phrase from another "
                  "language", "simple verbs like make, do, put", "a missing plural s", "please placed oddly"],
    "question": ["could you", "can we", "is it possible to", "would you mind", "any chance you could", "mind if we",
                 "can I get", "how about we", "could we maybe", "do you think you can", "can u", "shall we"],
    "synonyms": ["tag or label for topic", "heading or name for title", "blurb or summary for description",
                 "person in charge or lead for owner", "item or to-do for goal", "job or step for task",
                 "connection for link", "group or bucket for category", "page or doc for note",
                 "plain status words like done, parked, live", "reading for source", "write-up for report"],
    "rambling": ["ok so", "like", "anyway", "honestly", "um", "so yeah", "I mean", "basically", "right, so",
                 "not gonna lie", "long story short", "oh and", "hmm", "you know", "whatever", "the thing is"],
}
INDIRECT_REF = ("Refers to the existing item indirectly: by part of its name, a short nickname or a description "
                "(the one about ...), never by its full exact label, and never only 'it' or 'that one' without "
                "saying which.")
INDIRECT_PLAIN = ("Indirect: states the situation or need and lets the change follow from it (... is wrong, it "
                  "should be ...; we are done with ...), with no direct command verb.")
NOACTION_STYLES = {  # no-action items: the style must not turn the message into a change request
    "question": "A question, typed the way people type questions in a chat box (can u tell me ...? whats ...?).",
    "indirect": "Indirect: a half-question or a musing (not sure whether ..., I wonder if ...), not a direct question.",
}
SECONDARY = ["lowercase", "typos", "abbrev"]  # light second style, 35% of items
SECONDARY_SHARE = 0.35
FORCE_AVOID = {"synonyms", "indirect"}
LOWERCASE_OK = {"lowercase", "phone"}
AVOID_SHARE = 0.6

REWRITE_SYSTEM = """You rewrite chat messages for the training data of a small on-device model in a personal knowledge vault app. Each item gives a message a user typed while looking at one document, the change it asks for and a style. Rewrite it the way a different, real person would type the same request in that style.

Rules:
- The rewrite asks for exactly the same change: the same operation, the same target item, the same values. Do not add, drop or alter any argument.
- Every listed value must appear in the rewrite exactly, character for character (only a style that says so may lowercase it). Never shorten, reword, translate or misspell a value.
- Change the wording and sentence structure substantially; do not just swap a word or two of the original.
- A careful reader who sees only the rewrite and the document state must still arrive at the same change: it must not read as a sibling operation, and it must pick out the target item among the listed ones (by its name, part of it, or a description, never by its position).
- An item marked "no change" must stay a message that needs no document change (a question, a comment, or a request the document cannot do).
- Asides must not mention any person, date, number or value that could be read as an extra argument.
- Never quote an operation name. Follow each item's style and word rule. Return one rewrite per item, with its item number.
- Invent anything new; never use anything from account, machine or date context you may have been given."""

OUT_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object", "properties": {"n": {"type": "integer"}, "utterance": {"type": "string"}},
        "required": ["n", "utterance"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}


def jl(path: str | Path) -> list[dict]:
    return [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]


def wjl(path: str | Path, rows: list[dict]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def ctx_of(path: str) -> dict:
    return {o["key"]: o for o in json.loads(Path(path).read_text())}


# ---------------------------------------------------------------- evals
def load_evals(blind: bool = True) -> dict[str, list[dict]]:
    """{'default': held-out 1-4 + dev/seed (dedup's eval dir), 'heldout5': ..., 'heldout6': ...}."""
    out = {"default": dedup.load_eval(dedup.DEFAULT_EVAL_DIRS, [])}
    if blind:
        for name, p in BLIND_FILES.items():
            if not p.exists():
                raise SystemExit(f"blind set {name} missing: {p}")
            out[name] = dedup.load_eval([], [p])
    return out


def blind_provenance() -> dict:
    prov = {}
    for name, p in BLIND_FILES.items():
        if not p.exists():
            prov[name] = None
            continue
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        side = Path(str(p) + ".sha256")
        want = re.search(r"[0-9a-f]{64}", side.read_text()).group(0) if side.exists() else None
        n: list[dict] = []
        dedup.collect_utterances(json.loads(p.read_text()), name, n)
        prov[name] = {"sha256": h, "sidecarMatches": want == h, "utteranceKeys": len(n), "bytes": p.stat().st_size,
                      "mtime": int(p.stat().st_mtime)}
    return prov


def leak_source(norm: str, evals: dict[str, list[dict]]) -> tuple[str, dict] | None:
    for src, ev in evals.items():
        hit = dedup.leak_hit(norm, ev)
        if hit:
            return src, hit
    return None


def redacted(src: str, hit: dict) -> dict:
    """A leak hit for a report: blind hits carry only the set and the score."""
    if src == "default":
        return {"evalSet": "default", "score": hit["score"], "evalSource": hit["evalSource"],
                "evalId": hit["evalId"], **({"contained": True} if hit.get("contained") else {})}
    return {"evalSet": src, "score": hit["score"], **({"contained": True} if hit.get("contained") else {})}


# ---------------------------------------------------------------- sources
def cmd_sources(a) -> int:
    ctx = ctx_of(a.context)
    rows = jl(a.rows)
    evals = load_evals()
    rng = random.Random(a.seed)
    blind_hits = collections.Counter()
    clean = []
    for r in rows:
        hit = leak_source(dedup.normalize(r["utterance"]), {k: v for k, v in evals.items() if k != "default"})
        if hit:
            blind_hits[hit[0]] += 1
            continue
        clean.append(r)
    by_op: dict[str | None, list[dict]] = collections.defaultdict(list)
    sec_by_op: dict[str, list[dict]] = collections.defaultdict(list)
    for r in clean:
        if not r.get("step1Only"):
            by_op[r["op"]].append(r)
        elif r["step1Only"] == "args-disagree":
            sec_by_op[r["op"]].append(r)
    picks = []  # (source row, [styles])
    per_op = {}
    style_keys = list(STYLES)
    for key in [*sorted(ctx), None]:
        prim = sorted(by_op.get(key, []), key=lambda r: r["id"])
        rng.shuffle(prim)
        srcs = prim
        if key is not None and len(prim) < a.min_full:
            sec = sorted(sec_by_op.get(key, []), key=lambda r: r["id"])
            rng.shuffle(sec)
            srcs = prim + sec
        budget = a.noaction_per_source * len(srcs) if key is None else min(a.per_op, len(style_keys) * len(srcs))
        if not srcs:
            per_op[str(key)] = {"full": 0, "secondary": 0, "rewrites": 0}
            continue
        assigned: dict[str, list[str]] = {r["id"]: [] for r in srcs}
        order = style_keys[:]
        rng.shuffle(order)
        i = 0
        while sum(len(v) for v in assigned.values()) < budget:
            r = srcs[i % len(srcs)]
            start = i % len(order)
            free = [s for s in order[start:] + order[:start] if s not in assigned[r["id"]]]
            if free:
                assigned[r["id"]].append(free[0])
            i += 1
        n_sec = 0
        for r in srcs:
            if assigned[r["id"]]:
                picks.append({"source": r, "styles": assigned[r["id"]]})
                n_sec += bool(r.get("step1Only"))
        per_op[str(key)] = {"full": len(prim), "secondary": n_sec if key is not None else 0,
                            "rewrites": sum(len(v) for v in assigned.values())}
    wjl(a.out, picks)
    summary = {"sourceRows": len(rows), "blindPrefilterDropped": dict(blind_hits), "clean": len(clean),
               "picked": len(picks), "rewrites": sum(len(p["styles"]) for p in picks),
               "opsWithoutSource": sorted(k for k, v in per_op.items() if v["rewrites"] == 0),
               "perOp": per_op, "blind": blind_provenance()}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "perOp"}))
    return 0


# ---------------------------------------------------------------- plan
def enum_values(s: dict) -> set:
    vals = set(s.get("enum", []))
    for b in s.get("anyOf", []):
        vals |= set(b.get("enum", []))
    return vals


def string_leaves(v: object, s: dict, path: str):
    """(path, value, is_enum) for every string leaf of an args value."""
    if isinstance(v, dict):
        sub = next((b for b in s.get("anyOf", []) if b.get("type") == "object"), s)
        for k2, v2 in v.items():
            yield from string_leaves(v2, sub.get("properties", {}).get(k2, {}), f"{path}.{k2}")
    elif isinstance(v, list):
        sub = next((b for b in s.get("anyOf", []) if b.get("type") == "array"), s)
        for x in v:
            yield from string_leaves(x, sub.get("items", sub), path)
    elif isinstance(v, str):
        yield path, v, v in enum_values(s)


def split_args(row: dict, op: dict) -> tuple[dict, dict]:
    refs = set((row.get("refCandidates") or {}).keys())
    args = row.get("args") or {}
    return ({k: v for k, v in args.items() if k not in refs}, {k: v for k, v in args.items() if k in refs})


def ref_labels(row: dict, ref_args: dict) -> dict:
    out = {}
    for path, v in ref_args.items():
        lab = {c["id"]: c["label"] for c in (row.get("refCandidates") or {}).get(path, [])}
        out[path] = [lab.get(x, x) for x in v] if isinstance(v, list) else lab.get(v, v)
    return out


def item_text(n: int, it: dict, row: dict, op: dict | None) -> str:
    if op is None:
        style = NOACTION_STYLES.get(it["style"]) or STYLES[it["style"]]
    else:
        style = STYLES[it["style"]] or (INDIRECT_REF if row.get("refCandidates") else INDIRECT_PLAIN)
    style = style.replace("{ex}", it.get("ex", {}).get(it["style"], ""))
    lines = [f"Item {n}:", f"  Original message: {json.dumps(row['utterance'], ensure_ascii=False)}"]
    if op is None:
        lines.append("  The change: no change (this message needs no document operation; keep it that way).")
    else:
        sem, refs = split_args(row, op)
        props = op["modelSchema"].get("properties", {})
        copy, other = [], []
        for k, v in sem.items():
            leaves = list(string_leaves(v, props.get(k, {}), k))
            if any(not e for _, _, e in leaves):
                copy.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
            else:
                other.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
        lines.append(f"  The change: {op['key']}")
        if copy:
            lines.append("  Values to copy exactly: " + "; ".join(copy))
        if other:
            lines.append("  Other arguments (keep them clearly implied): " + "; ".join(other))
        if refs:
            labs = ref_labels(row, refs)
            lines.append("  Target item(s) in the state: " + "; ".join(
                f"{k} = {json.dumps(v, ensure_ascii=False)}" for k, v in labs.items()))
        if not sem and not refs:
            lines.append("  (no arguments)")
        state = (row.get("meta") or {}).get("state")
        if state:
            lines.append("  Document state:\n" + "\n".join(f"    {l}" for l in state.splitlines()))
    sty = f"  Style: {style}"
    if it.get("secondary"):
        sty += " Also: " + STYLES[it["secondary"]].replace("{ex}", it.get("ex", {}).get(it["secondary"], ""))
    lines.append(sty)
    if it.get("avoid"):
        lines.append("  Words: do not use these words or any form of them: "
                     + ", ".join(f'"{w}"' for w in it["avoid"]) + ".")
    elif it.get("use"):
        lines.append("  Words: use at least one of these words (or a form of it) naturally: "
                     + ", ".join(f'"{w}"' for w in it["use"]) + ".")
    return "\n".join(lines)


def op_header(op: dict) -> str:
    sib = "\n".join(f"- {s['key']}: {s['description'] or '(no description)'}" for s in op["siblings"])
    return (f"Operation: {op['key']}\nDescription: {op['description'] or '(none)'}\n"
            f"Arguments (JSON schema): {json.dumps(op['modelSchema'])}\n"
            f"Filled by the app, never in the message: {', '.join(op['appFilledFields']) or 'none'}\n"
            f"Sibling operations on the same document (the rewrite must not mean these):\n{sib}")


def noaction_header(ctx: dict, doc_type: str) -> str:
    ops = [o for o in ctx.values() if o["docType"] == doc_type]
    listing = "\n".join(f"- {o['key']}: {o['description'] or o['opName']}" for o in ops)
    return (f"Document type: {doc_type}\nIts operations (the rewrites must need none of them):\n{listing}")


def cmd_plan(a) -> int:
    ctx = ctx_of(a.context)
    picks = jl(a.sources)
    rng = random.Random(a.seed)
    # Expand into items, per op key (None = no-action, grouped by docType).
    items_by_job: dict[str, list[dict]] = collections.defaultdict(list)
    for p in picks:
        r = p["source"]
        job = r["op"] if r["op"] else f"noaction:{r['docType']}"
        for st in p["styles"]:
            items_by_job[job].append({"src": r, "style": st})
    reqs, meta = [], {}
    for job in sorted(items_by_job):
        items = sorted(items_by_job[job], key=lambda x: (x["src"]["id"], x["style"]))
        rng.shuffle(items)
        op = ctx.get(job)
        words = T.op_words(op["opName"]) if op else []
        # Word rule per item: synonyms / indirect always avoid; overall AVOID_SHARE avoid.
        n_avoid = round(len(items) * AVOID_SHARE) if words else 0
        forced = [i for i, it in enumerate(items) if it["style"] in FORCE_AVOID]
        rest = [i for i, it in enumerate(items) if it["style"] not in FORCE_AVOID]
        avoid = set(forced[:n_avoid]) | set(rng.sample(rest, max(0, min(len(rest), n_avoid - len(forced)))))
        for i, it in enumerate(items):
            if rng.random() < SECONDARY_SHARE:
                choices = [s for s in SECONDARY if s != it["style"] and not (s == "lowercase" and it["style"] == "phone")]
                it["secondary"] = rng.choice(choices)
            if words:
                it["avoid" if i in avoid else "use"] = words
            it["ex"] = {}
            for st in (it["style"], it.get("secondary")):
                if st in STYLE_POOLS:
                    k = 2 if st in ("question", "terse") else 3
                    ex = rng.sample(STYLE_POOLS[st], k)
                    it["ex"][st] = "' or '".join(ex) if st == "question" else ", ".join(ex)
        for ci in range(0, len(items), a.batch_size):
            chunk = items[ci:ci + a.batch_size]
            cid = (f"para-{job.replace(':', '--').replace('/', '_')}-{ci // a.batch_size}")
            head = op_header(op) if op else noaction_header(ctx, job.split(":", 1)[1])
            body = "\n\n".join(item_text(j + 1, it, it["src"], op) for j, it in enumerate(chunk))
            seed_line = f"Seed: {random.Random(f'{a.seed}:{cid}').randrange(10**6)}."
            user = (f"{head}\n\nRewrite each of these {len(chunk)} messages, one rewrite per item. Make the rewrites "
                    f"differ from each other in opening and structure.\n\n{body}\n\n{seed_line}")
            reqs.append(T.request(cid, REWRITE_SYSTEM, user, OUT_SCHEMA, a.effort, 8000 + 500 * len(chunk)))
            meta[cid] = {"job": job, "promptVersion": PROMPT_VERSION, "items": [
                {"n": j + 1, "sourceId": it["src"]["id"], "style": it["style"], "secondary": it.get("secondary"),
                 "examples": it["ex"],
                 **({"avoid": it["avoid"]} if it.get("avoid") else {}), **({"use": it["use"]} if it.get("use") else {})}
                for j, it in enumerate(chunk)]}
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    wjl(out, reqs)
    Path(str(out) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    leaks = prompt_leak_counts([r["params"]["system"] + "\n" + r["params"]["messages"][0]["content"] for r in reqs])
    est_in = sum(T.est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]) for r in reqs)
    est = {"requests": len(reqs), "items": sum(len(m["items"]) for m in meta.values()),
           "inputTokensEstimate(chars/4, excl. CLI overhead)": est_in, "promptLeaks": leaks,
           "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
    Path(str(out) + ".estimate.json").write_text(json.dumps(est, indent=1) + "\n")
    print(json.dumps(est))
    return 5 if sum(leaks.values()) else 0


def prompt_leak_counts(texts: list[str], min_words: int = 3) -> dict[str, int]:
    """Eval utterances of 3+ words (normalized) inside any prompt, per eval set: counts only."""
    blob = " " + dedup.normalize("\n".join(texts)) + " "
    out = {}
    for src, ev in load_evals().items():
        out[src] = sum(1 for e in ev if len(e["norm"].split()) >= min_words and f" {e['norm']} " in blob)
    return out


def cmd_promptcheck(a) -> int:
    reqs = jl(a.requests)
    leaks = prompt_leak_counts([r["params"]["system"] + "\n" + r["params"]["messages"][0]["content"] for r in reqs])
    print(json.dumps({"requests": len(reqs), "promptLeaks": leaks}))
    return 5 if sum(leaks.values()) else 0


# ---------------------------------------------------------------- rows
def derive_args(src: dict, op: dict, utt: str, lower_ok: bool) -> tuple[dict | None, str | None, bool]:
    """Gold args for the rewrite: every non-enum string leaf must be in the
    rewrite verbatim (case-insensitively when lower_ok, taking the
    rewrite's span). Returns (args, error, case_changed)."""
    sem, refs = split_args(src, op)
    props = op["modelSchema"].get("properties", {})
    changed = False

    def fix(v: object, s: dict, path: str) -> object:
        nonlocal changed
        if isinstance(v, dict):
            sub = next((b for b in s.get("anyOf", []) if b.get("type") == "object"), s)
            return {k2: fix(v2, sub.get("properties", {}).get(k2, {}), f"{path}.{k2}") for k2, v2 in v.items()}
        if isinstance(v, list):
            sub = next((b for b in s.get("anyOf", []) if b.get("type") == "array"), s)
            return [fix(x, sub.get("items", sub), path) for x in v]
        if isinstance(v, str) and v not in enum_values(s):
            if v in utt:
                return v
            i = utt.lower().find(v.lower()) if lower_ok else -1
            if i >= 0 and len(utt) == len(utt.lower()):
                changed = True
                return utt[i:i + len(v)]
            raise ValueError(f"{path}: value not preserved")
        return v
    try:
        new = {k: fix(v, props.get(k, {}), k) for k, v in sem.items()}
    except ValueError as e:
        return None, str(e), False
    return {**refs, **new}, None, changed


def cmd_rows(a) -> int:
    ctx = ctx_of(a.context)
    meta = json.loads(Path(a.meta).read_text())
    src_by_id = {p["source"]["id"]: p["source"] for p in jl(a.sources)}
    leak_terms = T.context_leak_terms()
    rows, dropped = [], []
    for r in jl(a.results):
        m = meta.get(r["custom_id"])
        if m is None:
            continue
        if r["type"] != "succeeded":
            dropped += [{"id": r["custom_id"], "reason": "call failed"}]
            continue
        got = {}
        for it in json.loads(r["text"])["items"]:
            if isinstance(it.get("n"), int) and it["n"] not in got:
                got[it["n"]] = it["utterance"]
        for spec in m["items"]:
            src = src_by_id[spec["sourceId"]]
            rid = f"para-{spec['sourceId']}-{spec['style']}"

            def drop(reason: str) -> None:
                dropped.append({"id": rid, "style": spec["style"], "op": src["op"], "reason": reason})
            utt = (got.get(spec["n"]) or "").strip()
            if not utt:
                drop("missing item")
                continue
            if any(t in utt.lower() for t in leak_terms):
                drop("context-leak (account/machine context)")
                continue
            if dedup.normalize(utt) == dedup.normalize(src["utterance"]):
                drop("same as source")
                continue
            if spec.get("avoid") and T.uses_op_words(utt, spec["avoid"]):
                drop("op word in an avoid item")
                continue
            sm = dict(src.get("meta") or {})
            new_meta = {"batch": r["custom_id"], "spec": {"name": None, **({"avoid": spec["avoid"]} if spec.get("avoid") else {}),
                                                          **({"use": spec["use"]} if spec.get("use") else {})},
                        "para": {"sourceId": src["id"], "style": spec["style"], "secondary": spec.get("secondary"),
                                 "promptVersion": m.get("promptVersion"), "sourceStep1Only": src.get("step1Only")},
                        **{k: sm[k] for k in ("state", "theme", "refPosition", "kind") if k in sm}}
            row = {"id": rid, "utterance": utt, "docType": src["docType"], "op": src["op"]}
            if src["op"]:
                lower_ok = spec["style"] in LOWERCASE_OK or spec.get("secondary") == "lowercase"
                args, err, changed = derive_args(src, ctx[src["op"]], utt, lower_ok)
                if err:
                    drop(f"value: {err}")
                    continue
                row["args"] = args
                new_meta["para"]["caseOnlyChange"] = changed
            for k in ("fixture", "refCandidates", "refContext"):
                if k in src:
                    row[k] = src[k]
            row["sourceId"] = src["id"]
            row["meta"] = new_meta
            rows.append(row)
    wjl(a.out, rows)
    reasons = collections.Counter(re.sub(r"^value: .*", "value not preserved", d["reason"]) for d in dropped)
    by_style = collections.Counter(d["style"] for d in dropped if "style" in d)
    summary = {"rows": len(rows), "dropped": len(dropped), "byReason": dict(reasons), "droppedByStyle": dict(by_style),
               "caseOnlyChange": sum(1 for r in rows if (r["meta"]["para"].get("caseOnlyChange"))),
               "droppedDetail": dropped}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "droppedDetail"}))
    return 0


# ---------------------------------------------------------------- agree
def cmd_agree(a) -> int:
    """teacher.py agree's rule (blind label op == gold op, label args == gold
    args exactly; grammar-gated rows dropped; two-sided op-word quota), with
    one addition for rewrites whose values changed case only (lowercase /
    phone styles): a label equal to the SOURCE row's original gold also
    counts, since the labeler restores casing. The row keeps the rewrite's
    own spans (what the copy-span grammar can produce)."""
    ctx = ctx_of(a.context)
    labels = T.read_labels(a.results, a.keys)
    src = {p["source"]["id"]: p["source"] for p in jl(a.sources)}
    gated = {k.rsplit("#", 1)[0] for k in json.loads(Path(a.manifest).read_text())["targetRejected"]}
    kept, disagree, gate = [], [], []
    via = collections.Counter()
    tolerant = 0
    for row in jl(a.rows):
        lab = labels.get(row["id"])
        gold_op = row["op"] or "none"
        op_ok = lab is not None and lab["op"] == gold_op
        if row["id"] in gated:
            gate.append(row["id"])
            continue
        got = T.label_args(lab, row)
        how = None
        if op_ok and row["op"] is None:
            how = "noaction"
        elif op_ok and T.args_equal(got, row.get("args", {})):
            how = "rewrite"
        elif op_ok and row["meta"]["para"].get("caseOnlyChange") and \
                T.args_equal(got, src[row["sourceId"]].get("args", {})):
            how = "source"
        tolerant += op_ok and (row["op"] is None or T.args_equal(got, row.get("args", {}), True))
        if how:
            via[how] += 1
            row["meta"]["para"]["agreeVia"] = how
            kept.append(row)
        else:
            disagree.append({"id": row["id"], "gold": gold_op, "label": lab, "on": "args" if op_ok else "op"})
    kept, quota, _ = T.wording_quota(kept, ctx, a.max_free, None)
    wjl(a.out, kept)
    summary = {"kept": len(kept), "agreed": sum(via.values()), "agreeVia": dict(via), "gateRejected": len(gate),
               "disagree": len(disagree), "disagreeOnOp": sum(d["on"] == "op" for d in disagree),
               "agreeTolerant(case/final punctuation)": tolerant, "quotaDropped": len(quota),
               "gateRejectedIds": gate, "quotaDroppedIds": quota, "detail": disagree}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("detail", "gateRejectedIds", "quotaDroppedIds")}))
    return 0


# ---------------------------------------------------------------- leak
def cmd_leak(a) -> int:
    evals = load_evals()
    kept_by_op: dict[str | None, list[set]] = collections.defaultdict(list)
    for p in a.prior or []:
        for r in jl(p):
            kept_by_op[r.get("op")].append(dedup.word_trigrams(dedup.normalize(r["utterance"])))
    kept, rejected = [], []
    counts = collections.Counter()
    for r in jl(a.rows):
        norm = dedup.normalize(r["utterance"])
        hit = leak_source(norm, evals)
        if hit:
            src, h = hit
            counts[f"eval-leak:{src}"] += 1
            rejected.append({"id": r["id"], "reason": "eval-leak", **redacted(src, h)})
            continue
        w3 = dedup.word_trigrams(norm)
        prior = kept_by_op[r.get("op")]
        dup = max((dedup.jaccard(w3, p) for p in prior), default=0.0)
        if dup >= dedup.DUP_THRESHOLD:
            counts["near-duplicate"] += 1
            rejected.append({"id": r["id"], "reason": "near-duplicate", "score": round(dup, 3)})
            continue
        prior.append(w3)
        kept.append(r)
    wjl(a.out, kept)
    summary = {"evalUtterances": {k: len(v) for k, v in evals.items()}, "blind": blind_provenance(),
               "rows": len(kept) + len(rejected), "kept": len(kept), "rejectedByReason": dict(counts),
               "rejected": rejected}
    Path(a.out + ".report.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rejected"}))
    return 0


# ---------------------------------------------------------------- split
def cmd_split(a) -> int:
    """split.py's per-op stratified split, grouped by source row: a rewrite
    goes to the same side as its source (and its sibling rewrites)."""
    group = {}
    for r in jl(a.rows):
        group[r["id"]] = r.get("sourceId") or r["id"]
    seqs = jl(a.train)
    by_group: dict[str, list[dict]] = collections.defaultdict(list)
    for s in seqs:
        by_group[group.get(s["meta"]["id"], s["meta"]["id"])].append(s)
    by_op: dict[str, list[str]] = collections.defaultdict(list)
    for g, ss in by_group.items():
        by_op[str(ss[0]["meta"]["op"])].append(g)
    rng = random.Random(a.seed)
    val: set[str] = set()
    for op in sorted(by_op):
        ids = sorted(by_op[op])
        k = round(len(ids) * a.share)
        if k == 0 and len(ids) >= 10:
            k = 1
        val.update(rng.sample(ids, k))
    out = Path(a.out_dir)
    tr = [s for g, ss in by_group.items() if g not in val for s in ss]
    va = [s for g, ss in by_group.items() if g in val for s in ss]
    wjl(out / "train-split.jsonl", tr)
    wjl(out / "val.jsonl", va)
    rows_val = {s["meta"]["id"] for s in va}
    summary = {"share": a.share, "seed": a.seed, "groups": len(by_group), "valGroups": len(val),
               "rows": len({s["meta"]["id"] for s in seqs}), "valRows": len(rows_val),
               "trainSequences": len(tr), "valSequences": len(va)}
    (out / "split.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps(summary))
    return 0


# ---------------------------------------------------------------- mirror
def cmd_mirror(a) -> int:
    """Round 10's split kept as is: train = the base train-split sequences +
    the new rendered sequences, minus every new row whose source row is in
    the base val (so no rewrite of a val row reaches train); val = the base
    val, unchanged. Base train rows that hit an eval set (held-out 1-4 or
    blind 5/6; Round 10 never filtered against 5/6) are dropped: counts only."""
    base_tr, base_va = jl(a.base_train), jl(a.base_val)
    val_ids = {s["meta"]["id"] for s in base_va}
    base_ids = val_ids | {s["meta"]["id"] for s in base_tr}
    evals = load_evals()
    leak_ids: dict[str, str] = {}
    for r in jl(a.base_rows):
        hit = leak_source(dedup.normalize(r["utterance"]), evals)
        if hit:
            leak_ids[r["id"]] = hit[0]
    n_base = len(base_tr)
    base_leaks = collections.Counter(("val:" if i in val_ids else "train:") + s for i, s in leak_ids.items())
    base_tr = [s for s in base_tr if s["meta"]["id"] not in leak_ids]
    src_of = {r["id"]: r["sourceId"] for r in jl(a.rows)}
    new = jl(a.train)
    missing = sorted({s["meta"]["id"] for s in new} - set(src_of))
    clash = sorted({s["meta"]["id"] for s in new} & base_ids)
    if missing or clash:
        raise SystemExit(f"rows without a sourceId: {len(missing)}; ids also in the base split: {len(clash)}")
    keep = [s for s in new if src_of[s["meta"]["id"]] not in val_ids]
    drop_rows = {s["meta"]["id"] for s in new if src_of[s["meta"]["id"]] in val_ids}
    out = Path(a.out_dir)
    wjl(out / "train-split.jsonl", base_tr + keep)
    wjl(out / "val.jsonl", base_va)
    summary = {"baseEvalLeakRows": dict(base_leaks), "baseTrainSequencesDropped": n_base - len(base_tr),
               "baseTrainSequences": len(base_tr),"baseTrainRows": len({s["meta"]["id"] for s in base_tr}),
               "valSequences": len(base_va), "valRows": len(val_ids),
               "newSequences": len(new), "newRows": len({s["meta"]["id"] for s in new}),
               "newDroppedValSourceRows": len(drop_rows),
               "newDroppedValSourceSequences": len(new) - len(keep),
               "newKeptRows": len({s["meta"]["id"] for s in keep}), "newKeptSequences": len(keep),
               "trainSequences": len(base_tr) + len(keep),
               "trainRows": len({s["meta"]["id"] for s in base_tr}) + len({s["meta"]["id"] for s in keep}),
               "sha256": {n: hashlib.sha256((out / n).read_bytes()).hexdigest()
                          for n in ("train-split.jsonl", "val.jsonl")}}
    (out / "split.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps(summary))
    return 0


# ---------------------------------------------------------------- stats
def cmd_stats(a) -> int:
    """Per-style funnel from planned items to kept rows, and wording stats."""
    ctx = ctx_of(a.context)
    meta = {}
    for m in a.meta:
        meta.update(json.loads(Path(m).read_text()))
    planned = collections.Counter(it["style"] for m in meta.values() for it in m["items"])
    planned_sec = collections.Counter(it.get("secondary") for m in meta.values() for it in m["items"])
    stage = {}
    for name, path in (("rows", a.rows), ("leakKept", a.leak_kept), ("valid", a.valid), ("kept", a.kept)):
        rs = jl(path)
        stage[name] = rs
    style_of = lambda r: r["meta"]["para"]["style"]  # noqa: E731
    out = {"plannedItems": sum(planned.values()), "plannedByStyle": dict(planned),
           "plannedSecondary": {str(k): v for k, v in planned_sec.items()}}
    for name, rs in stage.items():
        out[f"{name}ByStyle"] = dict(collections.Counter(style_of(r) for r in rs))
        out[f"{name}Total"] = len(rs)
    # Label agreement on rows that reached the labeler (valid rows minus grammar gate).
    agree_sum = json.loads(Path(a.kept + ".summary.json").read_text())
    gated = set(agree_sum.get("gateRejectedIds", []))
    quota = set(agree_sum.get("quotaDroppedIds", []))
    dis = {d["id"]: d["on"] for d in agree_sum.get("detail", [])}
    per_style = collections.defaultdict(lambda: collections.Counter())
    for r in stage["valid"]:
        s = style_of(r)
        if r["id"] in gated:
            per_style[s]["gate"] += 1
            continue
        per_style[s]["labeled"] += 1
        if r["id"] in dis:
            per_style[s]["disagree_" + dis[r["id"]]] += 1
        else:
            per_style[s]["agree"] += 1
            if r["id"] in quota:
                per_style[s]["quotaDropped"] += 1
    out["labelByStyle"] = {s: dict(c) | {"agreeRate": round(c["agree"] / c["labeled"], 3) if c["labeled"] else None}
                           for s, c in sorted(per_style.items())}
    tot = collections.Counter()
    for c in per_style.values():
        tot.update(c)
    out["labelTotal"] = dict(tot) | {"agreeRate": round(tot["agree"] / tot["labeled"], 3) if tot["labeled"] else None}
    # Action vs no-action agreement.
    kind = collections.Counter()
    for r in stage["valid"]:
        if r["id"] in gated:
            continue
        k = "action" if r["op"] else "noaction"
        kind[k + "_labeled"] += 1
        kind[k + "_agree"] += r["id"] not in dis
    out["labelByKind"] = dict(kind)
    kept = stage["kept"]
    act = [r for r in kept if r["op"]]
    free = [r for r in act if not T.uses_op_words(r["utterance"], T.op_words(ctx[r["op"]]["opName"]))]
    per_op = collections.Counter(r["op"] for r in act)
    words = [len(r["utterance"].split()) for r in kept]
    out["kept"] = {
        "rows": len(kept), "action": len(act), "noAction": len(kept) - len(act),
        "opsCovered": len(per_op), "perOpMinMedianMax": [min(per_op.values()), statistics.median(per_op.values()),
                                                         max(per_op.values())] if per_op else None,
        "opWordFree": f"{len(free)}/{len(act)}",
        "wordsMedianMinMax": [statistics.median(words), min(words), max(words)] if words else None,
        "allLowercase": sum(1 for r in kept if r["utterance"] == r["utterance"].lower()),
        "questions": sum(1 for r in kept if r["utterance"].rstrip().endswith("?")),
        "caseOnlyChange": sum(1 for r in kept if r["meta"]["para"].get("caseOnlyChange")),
        "fromStep1OnlySource": sum(1 for r in kept if r["meta"]["para"].get("sourceStep1Only")),
        "refRows": sum(1 for r in kept if r.get("refCandidates")),
        "distinctSources": len({r["sourceId"] for r in kept}),
        "topOpeners": collections.Counter(" ".join(r["utterance"].lower().split()[:2]) for r in kept).most_common(8),
        "wordsMedianByStyle": {s: statistics.median([len(r["utterance"].split()) for r in kept if style_of(r) == s])
                               for s in sorted({style_of(r) for r in kept})},
    }
    # Similarity to source (word-trigram Jaccard), the "actually rewritten" check.
    srcs = {r["id"]: r for p in a.source_rows for r in jl(p)}
    jac = [dedup.jaccard(dedup.word_trigrams(dedup.normalize(r["utterance"])),
                         dedup.word_trigrams(dedup.normalize(srcs[r["sourceId"]]["utterance"])))
           for r in kept if r["sourceId"] in srcs]
    if jac:
        out["kept"]["jaccardToSourceMedianP90"] = [round(statistics.median(jac), 3),
                                                   round(sorted(jac)[int(0.9 * len(jac))], 3)]
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sources"); p.add_argument("--rows", required=True); p.add_argument("--context", required=True)
    p.add_argument("--out", required=True); p.add_argument("--seed", type=int, default=20261023)
    p.add_argument("--per-op", type=int, default=50); p.add_argument("--min-full", type=int, default=10)
    p.add_argument("--noaction-per-source", type=int, default=1)
    p = sub.add_parser("plan"); p.add_argument("--sources", required=True); p.add_argument("--context", required=True)
    p.add_argument("--out", required=True); p.add_argument("--seed", type=int, default=20261023)
    p.add_argument("--batch-size", type=int, default=10); p.add_argument("--effort", default="medium")
    p = sub.add_parser("promptcheck"); p.add_argument("requests")
    p = sub.add_parser("rows"); p.add_argument("results"); p.add_argument("--meta", required=True)
    p.add_argument("--sources", required=True); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("agree"); p.add_argument("results"); p.add_argument("--keys", required=True)
    p.add_argument("--rows", required=True); p.add_argument("--sources", required=True); p.add_argument("--context", required=True)
    p.add_argument("--manifest", required=True); p.add_argument("--max-free", type=float, default=T.DEFAULT_MAX_FREE)
    p.add_argument("--out", required=True)
    p = sub.add_parser("leak"); p.add_argument("rows"); p.add_argument("--out", required=True)
    p.add_argument("--prior", action="append", help="rows whose utterances seed the per-op near-duplicate check")
    p = sub.add_parser("split"); p.add_argument("train"); p.add_argument("--rows", required=True)
    p.add_argument("--out-dir", required=True); p.add_argument("--share", type=float, default=0.05)
    p.add_argument("--seed", type=int, default=20261021)
    p = sub.add_parser("mirror"); p.add_argument("train"); p.add_argument("--rows", required=True)
    p.add_argument("--base-train", required=True); p.add_argument("--base-val", required=True)
    p.add_argument("--base-rows", required=True, help="the base split's source rows (eval-leak check)")
    p.add_argument("--out-dir", required=True)
    p = sub.add_parser("stats"); p.add_argument("--context", required=True); p.add_argument("--meta", action="append", required=True)
    p.add_argument("--rows", required=True); p.add_argument("--leak-kept", required=True); p.add_argument("--valid", required=True)
    p.add_argument("--kept", required=True); p.add_argument("--source-rows", action="append", required=True)
    p.add_argument("--out", required=True)
    a = ap.parse_args()
    return {"sources": cmd_sources, "plan": cmd_plan, "promptcheck": cmd_promptcheck, "rows": cmd_rows,
            "leak": cmd_leak, "agree": cmd_agree, "split": cmd_split, "mirror": cmd_mirror, "stats": cmd_stats}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
