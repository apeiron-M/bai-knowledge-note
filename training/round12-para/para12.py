"""Round 12 (X11): a second, complementary batch of human-style rows.

Reuses Round 11's pipeline (training/round11-para/para.py: leak, agree,
promptcheck, mirror and the value-derivation rule) and adds three kinds of
teacher item, all keyed to a Round 10 kept row (`sourceId`, so the merge can
keep rewrites of Round 10 val rows out of train):

  para      rewrite of a Round 10 action row in a style mix heavier on
            synonyms, indirect and partial-title references, multi-clause
            rambles and questions-as-requests; source rows not used by
            Round 11 first, and never a (source, style) pair Round 11 used.
  contrast  sibling-op pairs (Round 10 sibling groups): two rows of two
            confusable ops of one model rewritten side by side in the SAME
            messy style and structure, so only the target field / entity
            tells them apart.
  noaction  NEW messages (not rewrites) that need no document change, in
            messy styles: edit-sounding but not actionable, questions about
            the document, undecided musing, reports, chit-chat. The seed
            Round 10 no-action row is bookkeeping only; a document state is
            borrowed from a same-docType row so the teacher and the blind
            labeler see real items.

Args are never asked of the teacher: they come from the source row's gold
(round11 `derive_args`: every free-text value verbatim in the rewrite). The
blind label pass + round11 `agree` keeps a row only when its label equals that
gold (op + args), or "none" for no-action rows.

  sources   pick seeds and styles                -> items.jsonl, sources.jsonl
  plan      teacher requests (batch 10)          -> requests.jsonl (+ .meta.json, .estimate.json)
  subset    split a plan into pilot / rest by custom_id
  rows      teacher results -> candidate rows (value / op-word / account checks)
  stats     funnel and agreement by kind, style, category; pair survival
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import itertools
import json
import random
import re
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("para11", REPO / "training/round11-para/para.py")
P11 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P11)
T, dedup, jl, wjl = P11.T, P11.dedup, P11.jl, P11.wjl

PROMPT_VERSION = "para12-p1"

# ------------------------------------------------------------------ styles
STYLES = {
    "synonyms": "Everyday words instead of the app's terms for BOTH the field and the thing it belongs to (for "
                "example {ex}); never the field's or the operation's own name.",
    "indirect": None,  # ref ops: INDIRECT_REF, others: INDIRECT_PLAIN (round 11)
    "partial": "Names the target item by a short fragment of its label (2-4 of its most distinctive words, or a "
               "nickname built from them, for example {ex}) worked into a casual sentence; never its full exact "
               "label, never only 'it' or 'that one'.",
    "ramble": "A multi-clause ramble, 30-60 words, three or more clauses run together: what you are in the middle "
              "of, the request somewhere in the middle, then an afterthought that changes nothing (filler such as "
              "{ex}). No lists.",
    "question": "A question that asks for the change, opening like '{ex}' or similar; it asks for the change, not "
                "about the document.",
    "phone": "Typed fast on a phone: {ex} (you may lowercase the values, keep their words).",
    "terse": "Terse and messy: the request part is at most 6 words, not counting the copied values (for example "
             "{ex}); no greeting.",
}
STYLE_POOLS = {
    **P11.STYLE_POOLS,
    "synonyms": [*P11.STYLE_POOLS["synonyms"], "headline for title", "notes or body for content",
                 "write-up or explainer for description", "teammate or the person for member", "piece or output "
                 "for deliverable", "to-do or ticket for task", "theme or angle for topic", "label or kind for "
                 "type", "point or bullet for core idea", "blocker or snag for tension", "doc or page for note",
                 "check or test for check", "setting or switch for feature", "word list for vocabulary",
                 "state or stage for status", "lead or point person for owner"],
    "partial": ["'the floor plan one'", "'the Lisbon thing'", "'Priya's bit'", "'the kiln goal'",
                "'that budget piece'", "'the onboarding one'", "'the Q3 deck'", "'the river survey'"],
    "ramble": ["ok so", "anyway", "honestly", "um", "so yeah", "I mean", "basically", "right, so",
               "not gonna lie", "long story short", "oh and", "hmm", "you know", "the thing is", "like",
               "so I was thinking", "wait", "ugh"],
    "question": ["is there a way to", "what if we", "wanna", "think we could", "could you maybe", "any way to",
                 "would it make sense to", "can I just", "is it ok to", "how about", "can we go ahead and",
                 "should we", "do you mind if we", "can u"],
    "phone": P11.STYLE_POOLS["phone"],
    "terse": ["'X -> Y'", "'X: done'", "a verb and the value only", "'X pls'", "a note-to-self fragment",
              "a noun phrase and the value", "'re X, Y'"],
}
PARA_WEIGHTS_REF = {"synonyms": 3, "indirect": 2, "partial": 3, "ramble": 2, "question": 2}
PARA_WEIGHTS_PLAIN = {"synonyms": 3, "indirect": 3, "ramble": 2, "question": 2}
CONTRAST_STYLES = ["synonyms", "indirect", "ramble", "question", "phone", "terse"]
SECONDARY = ["typos", "lowercase", "abbrev"]
SECONDARY_SHARE = {"para": 0.4, "contrast": 0.5, "noaction": 0.3}
FORCE_AVOID = {"synonyms", "indirect"}
AVOID_SHARE = 0.62
CONTRAST_AVOID_SHARE = 0.55
LOWERCASE_OK = {"phone"}
# Round 11 style names a source already had: never repeat one on the same source.
R11_SAME = {"synonyms": {"synonyms"}, "indirect": {"indirect"}, "partial": set(),
            "ramble": {"rambling"}, "question": {"question"}, "phone": {"phone"}, "terse": {"terse"}}

NA_STYLES = {
    "lowercase": P11.STYLES["lowercase"], "typos": P11.STYLES["typos"], "abbrev": P11.STYLES["abbrev"],
    "phone": STYLES["phone"], "nonnative": P11.STYLES["nonnative"],
    "terse": "Terse: at most 7 words; a fragment is fine.",
    "ramble": "Rambling, 25-50 words, with a little filler (such as {ex}).",
}
NA_STYLE_POOL = {**{k: STYLE_POOLS[k] for k in ("phone", "ramble")},
                 **{k: P11.STYLE_POOLS[k] for k in ("typos", "abbrev", "nonnative")}}
NA_CATEGORIES = {  # weight, text
    "unactionable": (0.35, "Sounds like an edit request but cannot be carried out as written: {sub}. Keep it close "
                           "in wording to a real change request (use the document's own words for things)."),
    "docquestion": (0.22, "A question about the document's current content or status (what's the status of ..., "
                          "who has ..., is ... done yet, how many ..., what did we put for ...), naming an item "
                          "from the state when there is one. It asks for information, never for a change."),
    "undecided": (0.15, "Thinking out loud without deciding: hesitating, deferring or weighing options without "
                        "picking one (hmm not sure yet, let me think about ..., maybe later, idk which). No new value "
                        "is chosen and nothing is asked for."),
    "report": (0.10, "Reports a change someone already made or will make themselves, or states a fact about the "
                     "work; it asks for nothing."),
    "chitchat": (0.18, "Chit-chat or a reaction with no request: thanks, ok, nice, a greeting, a small complaint "
                       "about the day, a joke; at most 12 words."),
}
NA_SUBS_STATE = ["it names no item although several listed items could be meant, so it is unclear which one "
                 "(for example 'mark the goal as done' when there are several goals)"]
NA_SUBS = ["it asks for a change but gives no new value (for example change the owner, but not to whom; rename "
           "it, but not to what)",
           "it asks for something this document type has no operation for (send, share, export, print, undo, "
           "remind, notify, translate, duplicate, email)",
           "it asks to change something in a different document or app (another note, the calendar, an email, "
           "a spreadsheet)"]

REWRITE_SYSTEM = P11.REWRITE_SYSTEM
NOACTION_SYSTEM = """You write chat messages for the training data of a small on-device model in a personal knowledge vault app. The model must learn which messages need NO change to the open document. Each item gives the document type, its operations, sometimes its current state, a category and a style. Write one new message per item, the way a real, hurried person types in a chat box.

Rules:
- The message must need no document change: no listed operation can carry it out as written, and it must not read as a request for one.
- Follow the item's category and style closely. Make the messages differ from each other in opening, wording and structure.
- Do not copy the example phrases verbatim; they only show the kind of thing meant.
- Never quote an operation name. Return one message per item, with its item number.
- Invent every name and detail (or use the items in the given state); never use anything from account, machine or date context you may have been given."""


# ------------------------------------------------------------------ helpers
def is_ref(row: dict) -> bool:
    return bool(row.get("refCandidates"))


def weighted_cycle(weights: dict[str, int], rng: random.Random) -> list[str]:
    seq = [s for s, w in weights.items() for _ in range(w)]
    rng.shuffle(seq)
    return seq


def pick_examples(rng: random.Random, style: str | None, pools: dict) -> str:
    if not style or style not in pools:
        return ""
    k = 2 if style in ("question", "terse", "partial") else 3
    ex = rng.sample(pools[style], min(k, len(pools[style])))
    return "' or '".join(ex) if style == "question" else ", ".join(ex)


# ------------------------------------------------------------------ sources
def cmd_sources(a) -> int:
    ctx = P11.ctx_of(a.context)
    rows = jl(a.rows)
    rng = random.Random(a.seed)
    r11 = jl(a.r11_sources)
    r11_styles: dict[str, set] = collections.defaultdict(set)
    for p in r11:
        r11_styles[p["source"]["id"]] |= set(p["styles"])
    val_ids = {s["meta"]["id"] for s in jl(a.val)}
    evals = P11.load_evals()
    dropped = collections.Counter()
    clean = []
    for r in rows:
        if r["id"] in val_ids:
            dropped["inRound10Val"] += 1
            continue
        hit = P11.leak_source(dedup.normalize(r["utterance"]), evals)
        if hit:
            dropped[f"evalLeak:{hit[0]}"] += 1
            continue
        clean.append(r)
    full = collections.defaultdict(list)
    sec = collections.defaultdict(list)
    noact, state_rows = [], collections.defaultdict(list)
    for r in sorted(clean, key=lambda r: r["id"]):
        if r["op"] is None:
            noact.append(r)
            continue
        if (r.get("meta") or {}).get("state"):
            state_rows[r["docType"]].append(r)
        if not r.get("step1Only"):
            full[r["op"]].append(r)
        elif r["step1Only"] == "args-disagree":
            sec[r["op"]].append(r)

    def ordered(op: str) -> list[dict]:
        """Unused-by-Round-11 rows first, then by Round 11 use count; args-disagree rows only for thin ops."""
        unused = [r for r in full[op] if r["id"] not in r11_styles]
        used = [r for r in full[op] if r["id"] in r11_styles]
        rng.shuffle(unused)
        rng.shuffle(used)
        used.sort(key=lambda r: len(r11_styles[r["id"]]))
        out = unused + used
        if len(full[op]) < a.min_full:
            s = sec[op][:]
            rng.shuffle(s)
            out += s
        return out

    items: list[dict] = []
    taken: dict[str, set] = collections.defaultdict(set)  # source id -> round-12 styles

    def free(r: dict, style: str) -> bool:
        return style not in taken[r["id"]] and not (R11_SAME[style] & r11_styles.get(r["id"], set()))

    # para
    per_op = {}
    for op in sorted(ctx):
        srcs = ordered(op)
        if not srcs:
            per_op[op] = 0
            continue
        weights = PARA_WEIGHTS_REF if is_ref(srcs[0]) else PARA_WEIGHTS_PLAIN
        seq = weighted_cycle(weights, rng)
        cap = min(a.per_op, len(srcs) * a.max_per_source)
        n, ptr = 0, 0
        while n < cap:
            added = 0
            for r in srcs:
                if n >= cap:
                    break
                if len(taken[r["id"]]) >= a.max_per_source:
                    continue
                for d in range(len(seq)):
                    style = seq[(ptr + d) % len(seq)]
                    if free(r, style):
                        taken[r["id"]].add(style)
                        items.append({"kind": "para", "job": op, "sourceId": r["id"], "style": style})
                        n += 1
                        added += 1
                        ptr = (ptr + d + 1) % len(seq)
                        break
            if not added:
                break
        per_op[op] = n
    # contrast pairs
    groups = json.loads(Path(a.groups).read_text())["groups"]
    pair_count = collections.Counter()
    pidx = 0
    for g in groups:
        ops = [o for o in g["ops"] if o in ctx and full.get(o)]
        combos = list(itertools.combinations(ops, 2))
        if not combos:
            continue
        rng.shuffle(combos)
        cursor = {o: 0 for o in ops}
        pools = {o: ordered(o) for o in ops}
        styles = CONTRAST_STYLES[:]
        rng.shuffle(styles)
        for k in range(a.pairs_per_group):
            oa, ob = combos[k % len(combos)]
            style = styles[k % len(styles)]
            mem = []
            for o in (oa, ob):
                pool = pools[o]
                for _ in range(len(pool)):
                    r = pool[cursor[o] % len(pool)]
                    cursor[o] += 1
                    if R11_SAME[style] & r11_styles.get(r["id"], set()) and len(pool) > 3:
                        continue
                    mem.append(r)
                    break
            if len(mem) < 2:
                continue
            pidx += 1
            pid = f"{g['id']}-{pidx}"
            for r, partner in ((mem[0], mem[1]), (mem[1], mem[0])):
                items.append({"kind": "contrast", "job": g["id"], "sourceId": r["id"], "style": style,
                              "pair": pid, "partnerSourceId": partner["id"], "partnerOp": partner["op"]})
            pair_count[g["id"]] += 1
    # no-action
    cats = [c for c, (w, _) in NA_CATEGORIES.items() for _ in range(round(w * 100))]
    na_styles = list(NA_STYLES)
    n_na = 0
    na_seq = noact[:]
    rng.shuffle(na_seq)
    for j in range(a.noaction):
        seed_row = na_seq[j % len(na_seq)]
        cat = cats[rng.randrange(len(cats))]
        st_pool = state_rows.get(seed_row["docType"], [])
        state_from = rng.choice(st_pool) if st_pool and (cat in ("unactionable", "docquestion") or rng.random() < 0.5) \
            else None
        style = na_styles[j % len(na_styles)] if cat != "chitchat" else rng.choice(["lowercase", "typos", "abbrev",
                                                                                     "phone", "terse", "nonnative"])
        it = {"kind": "noaction", "job": seed_row["docType"], "sourceId": seed_row["id"], "style": style,
              "category": cat, "k": j // len(na_seq)}
        if cat == "unactionable":
            subs = NA_SUBS + (NA_SUBS_STATE * 2 if state_from else [])
            it["sub"] = rng.choice(subs)
        if state_from:
            it["stateFrom"] = state_from["id"]
        items.append(it)
        n_na += 1
    # sources.jsonl in round 11's {"source": row} shape (agree reads it), every row any item uses
    by_id = {r["id"]: r for r in clean}
    used_ids = sorted({it["sourceId"] for it in items} | {it["stateFrom"] for it in items if it.get("stateFrom")})
    wjl(a.out_sources, [{"source": by_id[i], "styles": sorted({it["style"] for it in items if it["sourceId"] == i})}
                        for i in used_ids])
    wjl(a.out_items, items)
    kinds = collections.Counter(it["kind"] for it in items)
    para_src = {it["sourceId"] for it in items if it["kind"] != "noaction"}
    summary = {"round10Rows": len(rows), "dropped": dict(dropped), "clean": len(clean), "items": dict(kinds),
               "paraStyles": dict(collections.Counter(it["style"] for it in items if it["kind"] == "para")),
               "contrastStyles": dict(collections.Counter(it["style"] for it in items if it["kind"] == "contrast")),
               "noactionCategories": dict(collections.Counter(it["category"] for it in items
                                                              if it["kind"] == "noaction")),
               "noactionWithState": sum(1 for it in items if it["kind"] == "noaction" and it.get("stateFrom")),
               "actionSources": len(para_src),
               "actionSourcesUnusedByRound11": sum(1 for i in para_src if i not in r11_styles),
               "actionItemsOnUnusedSources": sum(1 for it in items if it["kind"] != "noaction"
                                                 and it["sourceId"] not in r11_styles),
               "argsDisagreeSources": sum(1 for i in para_src if by_id[i].get("step1Only")),
               "opsWithoutPara": sorted(k for k, v in per_op.items() if v == 0),
               "pairsPerGroup": dict(pair_count), "paraPerOp": per_op, "blind": P11.blind_provenance()}
    Path(a.out_items + ".summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("paraPerOp", "pairsPerGroup")}))
    return 0


# ------------------------------------------------------------------ plan
def style_text(it: dict, row: dict | None) -> str:
    if it["kind"] == "noaction":
        s = NA_STYLES[it["style"]]
    else:
        s = STYLES[it["style"]] or (P11.INDIRECT_REF if row.get("refCandidates") else P11.INDIRECT_PLAIN)
    s = s.replace("{ex}", it["ex"].get(it["style"], ""))
    if it.get("secondary"):
        s += " Also: " + P11.STYLES[it["secondary"]].replace("{ex}", it["ex"].get(it["secondary"], ""))
    return s


def action_item_text(n: int, it: dict, row: dict, op: dict) -> str:
    lines = [f"Item {n}:", f"  Original message: {json.dumps(row['utterance'], ensure_ascii=False)}"]
    sem, refs = P11.split_args(row, op)
    props = op["modelSchema"].get("properties", {})
    copy, other = [], []
    for k, v in sem.items():
        leaves = list(P11.string_leaves(v, props.get(k, {}), k))
        (copy if any(not e for _, _, e in leaves) else other).append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
    lines.append(f"  The change: {op['key']}")
    if it.get("pairWith"):
        lines.append(f"  Contrast pair: written side by side with item {it['pairWith']} (same style and a similar "
                     f"structure; only the field or thing changed, and its value, differ)")
    if copy:
        lines.append("  Values to copy exactly: " + "; ".join(copy))
    if other:
        lines.append("  Other arguments (keep them clearly implied): " + "; ".join(other))
    if refs:
        labs = P11.ref_labels(row, refs)
        lines.append("  Target item(s) in the state: " + "; ".join(
            f"{k} = {json.dumps(v, ensure_ascii=False)}" for k, v in labs.items()))
    if not sem and not refs:
        lines.append("  (no arguments)")
    state = (row.get("meta") or {}).get("state")
    if state:
        lines.append("  Document state:\n" + "\n".join(f"    {l}" for l in state.splitlines()))
    lines.append(f"  Style: {style_text(it, row)}")
    if it.get("avoid"):
        lines.append("  Words: do not use these words or any form of them: "
                     + ", ".join(f'"{w}"' for w in it["avoid"]) + ".")
    elif it.get("use"):
        lines.append("  Words: use at least one of these words (or a form of it) naturally: "
                     + ", ".join(f'"{w}"' for w in it["use"]) + ".")
    return "\n".join(lines)


def noaction_item_text(n: int, it: dict, state: str | None) -> str:
    cat = NA_CATEGORIES[it["category"]][1].replace("{sub}", it.get("sub", ""))
    lines = [f"Item {n}:", f"  Category: {cat}"]
    if state:
        lines.append("  Document state:\n" + "\n".join(f"    {l}" for l in state.splitlines()))
    else:
        lines.append("  Document state: (not shown; invent plausible details)")
    lines.append(f"  Style: {style_text(it, None)}")
    return "\n".join(lines)


def contrast_header(ops: list[dict]) -> str:
    parts = []
    for op in ops:
        parts.append(f"- {op['key']}: {op['description'] or '(no description)'}\n"
                     f"  Arguments (JSON schema): {json.dumps(op['modelSchema'])}\n"
                     f"  Filled by the app, never in the message: {', '.join(op['appFilledFields']) or 'none'}")
    return ("These operations of one document type are easy to confuse:\n" + "\n".join(parts) +
            "\n\nThe items come in contrast pairs. Write the two items of a pair in the same style and with a "
            "similar opening and structure, as if the same person typed both, so that what tells them apart is the "
            "field or thing being changed (and its value). Each one must still clearly mean its own operation and "
            "not its partner's or any other listed one.")


def cmd_plan(a) -> int:
    ctx = P11.ctx_of(a.context)
    items = jl(a.items)
    src = {p["source"]["id"]: p["source"] for p in jl(a.sources)}
    rng = random.Random(a.seed)
    jobs: dict[tuple, list[dict]] = collections.defaultdict(list)
    for it in items:
        jobs[(it["kind"], it["job"])].append(it)
    reqs, meta = [], {}
    for (kind, job) in sorted(jobs):
        its = jobs[(kind, job)]
        if kind == "contrast":  # keep pair members together, shuffle pairs
            pairs = collections.defaultdict(list)
            for it in its:
                pairs[it["pair"]].append(it)
            plist = [pairs[k] for k in sorted(pairs)]
            rng.shuffle(plist)
            for pm in plist:
                avoid = rng.random() < CONTRAST_AVOID_SHARE
                sec = rng.choice(SECONDARY) if rng.random() < SECONDARY_SHARE["contrast"] else None
                if sec == "lowercase" and pm[0]["style"] == "phone":
                    sec = "typos"
                ex = {}
                for st in (pm[0]["style"], sec):
                    if st:
                        ex[st] = pick_examples(rng, st, STYLE_POOLS)
                for it in pm:
                    it["secondary"], it["ex"] = sec, ex
                    words = T.op_words(ctx[src[it["sourceId"]]["op"]]["opName"])
                    if words:
                        it["avoid" if avoid else "use"] = words
            chunks = [sum(plist[i:i + a.batch_size // 2], []) for i in range(0, len(plist), a.batch_size // 2)]
        else:
            its = sorted(its, key=lambda x: (x["sourceId"], x["style"], x.get("k", 0)))
            rng.shuffle(its)
            op = ctx.get(job) if kind == "para" else None
            words = T.op_words(op["opName"]) if op else []
            if words:
                n_avoid = round(len(its) * AVOID_SHARE)
                forced = [i for i, it in enumerate(its) if it["style"] in FORCE_AVOID]
                rest = [i for i, it in enumerate(its) if it["style"] not in FORCE_AVOID]
                avoid = set(forced) | set(rng.sample(rest, max(0, min(len(rest), n_avoid - len(forced)))))
            for i, it in enumerate(its):
                if rng.random() < SECONDARY_SHARE[kind]:
                    ch = [s for s in SECONDARY if s != it["style"] and not (s == "lowercase" and it["style"] == "phone")]
                    it["secondary"] = rng.choice(ch)
                else:
                    it["secondary"] = None
                if words:
                    it["avoid" if i in avoid else "use"] = words
                pools = NA_STYLE_POOL if kind == "noaction" else STYLE_POOLS
                it["ex"] = {st: pick_examples(rng, st, pools if st == it["style"] else P11.STYLE_POOLS)
                            for st in (it["style"], it["secondary"]) if st}
            chunks = [its[i:i + a.batch_size] for i in range(0, len(its), a.batch_size)]
        for ci, chunk in enumerate(chunks):
            cid = f"p12-{kind}-{job.replace(':', '--').replace('/', '_')}-{ci}"
            bodies = []
            for j, it in enumerate(chunk):
                n = j + 1
                if kind == "contrast":
                    it["pairWith"] = n + 1 if j % 2 == 0 else n - 1
                if kind == "noaction":
                    st = (src[it["stateFrom"]].get("meta") or {}).get("state") if it.get("stateFrom") else None
                    bodies.append(noaction_item_text(n, it, st))
                else:
                    r = src[it["sourceId"]]
                    bodies.append(action_item_text(n, it, r, ctx[r["op"]]))
            if kind == "para":
                head, system = P11.op_header(ctx[job]), REWRITE_SYSTEM
            elif kind == "contrast":
                ops = sorted({src[it["sourceId"]]["op"] for it in chunk})
                head, system = contrast_header([ctx[o] for o in ops]), REWRITE_SYSTEM
            else:
                head, system = P11.noaction_header(ctx, job), NOACTION_SYSTEM
            verb = "Write" if kind == "noaction" else "Rewrite each of these"
            what = "new messages, one per item" if kind == "noaction" else "messages, one rewrite per item"
            seed_line = f"Seed: {random.Random(f'{a.seed}:{cid}').randrange(10**6)}."
            mirror = " (except that contrast-pair partners mirror each other)" if kind == "contrast" else ""
            user = (f"{head}\n\n{verb} {len(chunk)} {what}. Make them differ from each other in opening and "
                    f"structure{mirror}.\n\n" + "\n\n".join(bodies) + f"\n\n{seed_line}")
            reqs.append(T.request(cid, system, user, P11.OUT_SCHEMA, a.effort, 8000 + 500 * len(chunk)))
            meta[cid] = {"job": job, "kind": kind, "promptVersion": PROMPT_VERSION, "items": [
                {"n": j + 1, **{k: it[k] for k in ("kind", "sourceId", "style", "secondary", "ex", "pair",
                                                   "partnerSourceId", "partnerOp", "category", "sub", "stateFrom",
                                                   "k", "avoid", "use") if it.get(k) is not None}}
                for j, it in enumerate(chunk)]}
    out = Path(a.out)
    wjl(out, reqs)
    Path(str(out) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    return estimate(out, reqs, meta)


def estimate(out: Path, reqs: list[dict], meta: dict) -> int:
    leaks = P11.prompt_leak_counts([r["params"]["system"] + "\n" + r["params"]["messages"][0]["content"] for r in reqs])
    est_in = sum(T.est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]) for r in reqs)
    est = {"requests": len(reqs), "items": sum(len(m["items"]) for m in meta.values()),
           "byKind": dict(collections.Counter(it["kind"] for m in meta.values() for it in m["items"])),
           "inputTokensEstimate(chars/4, excl. CLI overhead)": est_in, "promptLeaks": leaks,
           "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
    Path(str(out) + ".estimate.json").write_text(json.dumps(est, indent=1) + "\n")
    print(json.dumps(est))
    return 5 if sum(leaks.values()) else 0


def cmd_subset(a) -> int:
    """Pilot = the first --per-kind requests of each kind (spread over jobs); rest = the others."""
    reqs = jl(a.requests)
    meta = json.loads(Path(a.requests + ".meta.json").read_text())
    rng = random.Random(a.seed)
    by_kind = collections.defaultdict(list)
    for r in reqs:
        by_kind[meta[r["custom_id"]]["kind"]].append(r["custom_id"])
    pick = set()
    for kind, ids in sorted(by_kind.items()):
        jobs = collections.defaultdict(list)
        for i in ids:
            jobs[meta[i]["job"]].append(i)
        order = sorted(jobs)
        rng.shuffle(order)
        pick |= {jobs[j][0] for j in order[:a.per_kind]}
    for name, keep in (("pilot", lambda c: c in pick), ("rest", lambda c: c not in pick)):
        out = Path(a.out_dir) / name / "requests.jsonl"
        rs = [r for r in reqs if keep(r["custom_id"])]
        wjl(out, rs)
        m = {r["custom_id"]: meta[r["custom_id"]] for r in rs}
        Path(str(out) + ".meta.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n")
        estimate(out, rs, m)
    return 0


# ------------------------------------------------------------------ rows
def cmd_rows(a) -> int:
    ctx = P11.ctx_of(a.context)
    meta = json.loads(Path(a.meta).read_text())
    src_by_id = {p["source"]["id"]: p["source"] for p in jl(a.sources)}
    leak_terms = T.context_leak_terms()
    if not any("@" in t for t in leak_terms):
        raise SystemExit("account email not loaded from `claude auth status`; refusing to run without the email filter")
    rows, dropped = [], []
    seen_ids = set()
    for r in jl(a.results):
        m = meta.get(r["custom_id"])
        if m is None:
            continue
        if r["type"] != "succeeded":
            dropped.append({"id": r["custom_id"], "reason": "call failed"})
            continue
        got = {}
        for it in json.loads(r["text"])["items"]:
            if isinstance(it.get("n"), int) and it["n"] not in got:
                got[it["n"]] = it["utterance"]
        for spec in m["items"]:
            src = src_by_id[spec["sourceId"]]
            kind = spec["kind"]
            rid = {"para": f"p12-p-{src['id']}-{spec['style']}",
                   "contrast": f"p12-c-{src['id']}-{spec['style']}-{spec.get('pair')}",
                   "noaction": f"p12-n-{src['id']}-{spec.get('k', 0)}-{spec.get('category')}"}[kind]
            while rid in seen_ids:
                rid += "x"
            seen_ids.add(rid)

            def drop(reason: str) -> None:
                dropped.append({"id": rid, "kind": kind, "style": spec["style"], "op": src["op"], "reason": reason})
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
            para = {"kind": kind, "sourceId": src["id"], "style": spec["style"], "secondary": spec.get("secondary"),
                    "promptVersion": m.get("promptVersion"), "sourceStep1Only": src.get("step1Only"),
                    **{k: spec[k] for k in ("pair", "partnerSourceId", "partnerOp", "category", "stateFrom")
                       if spec.get(k)}}
            new_meta = {"batch": r["custom_id"],
                        "spec": {"name": None, **({"avoid": spec["avoid"]} if spec.get("avoid") else {}),
                                 **({"use": spec["use"]} if spec.get("use") else {})},
                        "para": para}
            row = {"id": rid, "utterance": utt, "docType": src["docType"], "op": src["op"]}
            if kind == "noaction":
                st = (src_by_id[spec["stateFrom"]].get("meta") or {}).get("state") if spec.get("stateFrom") else None
                if st:
                    new_meta["state"] = st  # the labeler sees what the teacher saw; no fixture, no refs
                new_meta["kind"] = "noaction-" + spec["category"]
            else:
                new_meta.update({k: sm[k] for k in ("state", "theme", "refPosition", "kind") if k in sm})
                lower_ok = spec["style"] in LOWERCASE_OK or spec.get("secondary") == "lowercase"
                args, err, changed = P11.derive_args(src, ctx[src["op"]], utt, lower_ok)
                if err:
                    drop(f"value: {err}")
                    continue
                row["args"] = args
                para["caseOnlyChange"] = changed
                for k in ("fixture", "refCandidates", "refContext"):
                    if k in src:
                        row[k] = src[k]
            row["sourceId"] = src["id"]
            row["meta"] = new_meta
            rows.append(row)
    wjl(a.out, rows)
    reasons = collections.Counter(re.sub(r"^value: .*", "value not preserved", d["reason"]) for d in dropped)
    summary = {"rows": len(rows), "dropped": len(dropped), "byReason": dict(reasons),
               "droppedByKind": dict(collections.Counter(d.get("kind") for d in dropped)),
               "droppedByStyle": dict(collections.Counter(d.get("style") for d in dropped)),
               "contextTermsLoaded": len(leak_terms),
               "caseOnlyChange": sum(1 for r in rows if r["meta"]["para"].get("caseOnlyChange")),
               "droppedDetail": dropped}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "droppedDetail"}))
    return 0


# ------------------------------------------------------------------ stats
def cmd_stats(a) -> int:
    ctx = P11.ctx_of(a.context)
    meta = {}
    for m in a.meta:
        meta.update(json.loads(Path(m).read_text()))
    planned = [it for m in meta.values() for it in m["items"]]
    stage = {n: jl(p) for n, p in (("rows", a.rows), ("leakKept", a.leak_kept), ("valid", a.valid), ("kept", a.kept))}
    agree = json.loads(Path(a.kept + ".summary.json").read_text())
    gated = set(agree.get("gateRejectedIds", []))
    quota = set(agree.get("quotaDroppedIds", []))
    dis = {d["id"]: d["on"] for d in agree.get("detail", [])}
    keyf = {"kind": lambda p: p["kind"], "style": lambda p: f"{p['kind']}:{p['style']}",
            "category": lambda p: p.get("category")}
    out = {"planned": len(planned), "plannedBy": {}}
    for kn, f in keyf.items():
        out["plannedBy"][kn] = dict(collections.Counter(f(p) for p in planned))
    for name, rs in stage.items():
        out[f"{name}Total"] = len(rs)
        out[f"{name}ByKind"] = dict(collections.Counter(r["meta"]["para"]["kind"] for r in rs))
    lab = {kn: collections.defaultdict(collections.Counter) for kn in keyf}
    for r in stage["valid"]:
        p = r["meta"]["para"]
        for kn, f in keyf.items():
            k = f(p)
            if k is None:
                continue
            c = lab[kn][k]
            if r["id"] in gated:
                c["gate"] += 1
                continue
            c["labeled"] += 1
            if r["id"] in dis:
                c["disagree_" + dis[r["id"]]] += 1
            else:
                c["agree"] += 1
                c["quotaDropped"] += r["id"] in quota
    for kn in keyf:
        out[f"labelBy{kn.title()}"] = {k: dict(c) | {"agreeRate": round(c["agree"] / c["labeled"], 3)
                                                      if c["labeled"] else None} for k, c in sorted(lab[kn].items())}
    tot = collections.Counter()
    for c in lab["kind"].values():
        tot.update(c)
    out["labelTotal"] = dict(tot) | {"agreeRate": round(tot["agree"] / tot["labeled"], 3) if tot["labeled"] else None}
    kept = stage["kept"]
    pairs = collections.Counter(r["meta"]["para"]["pair"] for r in kept if r["meta"]["para"].get("pair"))
    planned_pairs = {p["pair"] for p in planned if p.get("pair")}
    act = [r for r in kept if r["op"]]
    free = [r for r in act if not T.uses_op_words(r["utterance"], T.op_words(ctx[r["op"]]["opName"]))]
    per_op = collections.Counter(r["op"] for r in act)
    words = [len(r["utterance"].split()) for r in kept]
    srcs = {p["source"]["id"]: p["source"] for p in jl(a.sources)}
    jac = [dedup.jaccard(dedup.word_trigrams(dedup.normalize(r["utterance"])),
                         dedup.word_trigrams(dedup.normalize(srcs[r["sourceId"]]["utterance"]))) for r in act]
    r11 = {p["source"]["id"] for p in jl(a.r11_sources)}
    out["kept"] = {
        "rows": len(kept), "byKind": dict(collections.Counter(r["meta"]["para"]["kind"] for r in kept)),
        "action": len(act), "noAction": len(kept) - len(act), "opsCovered": len(per_op),
        "perOpMinMedianMax": [min(per_op.values()), statistics.median(per_op.values()), max(per_op.values())]
        if per_op else None,
        "opWordFree": f"{len(free)}/{len(act)}",
        "pairsPlanned": len(planned_pairs), "pairsBothKept": sum(1 for v in pairs.values() if v == 2),
        "pairsOneKept": sum(1 for v in pairs.values() if v == 1),
        "actionFromSourcesUnusedByRound11": sum(1 for r in act if r["sourceId"] not in r11),
        "noactionByCategory": dict(collections.Counter(r["meta"]["para"].get("category") for r in kept
                                                       if not r["op"])),
        "wordsMedianMinMax": [statistics.median(words), min(words), max(words)] if words else None,
        "allLowercase": sum(1 for r in kept if r["utterance"] == r["utterance"].lower()),
        "questions": sum(1 for r in kept if r["utterance"].rstrip().endswith("?")),
        "refRows": sum(1 for r in kept if r.get("refCandidates")),
        "distinctSources": len({r["sourceId"] for r in kept}),
        "topOpeners": collections.Counter(" ".join(r["utterance"].lower().split()[:2]) for r in kept).most_common(10),
        "jaccardToSourceMedianP90(action)": [round(statistics.median(jac), 3), round(sorted(jac)[int(0.9 * len(jac))], 3)]
        if jac else None,
    }
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


# ------------------------------------------------------------------ check
def cmd_check(a) -> int:
    """Merge checks: catalogHash parity with the base render, val unchanged,
    train/val id overlap, no new train row whose source is a val row, the
    trainer contract (equal-length ids/mask, >=1 completion token), eval leaks
    in every train/val prompt's request line (counts only), and account /
    machine context terms in the given files (counts only)."""
    out: dict = {}
    hashes = [json.loads(Path(m).read_text()).get("catalogHash") for m in a.manifest]
    out["catalogHashEqual"] = len(set(hashes)) == 1
    out["valSha256"] = hashlib.sha256(Path(a.val).read_bytes()).hexdigest()
    out["valUnchanged"] = out["valSha256"] == hashlib.sha256(Path(a.base_val).read_bytes()).hexdigest()
    tr, va = jl(a.train), jl(a.val)
    tr_ids, va_ids = {s["meta"]["id"] for s in tr}, {s["meta"]["id"] for s in va}
    out["trainValIdOverlap"] = len(tr_ids & va_ids)
    src_of = {r["id"]: r.get("sourceId") for r in jl(a.rows)}
    out["newTrainRowsWithValSource"] = sum(1 for i in tr_ids if src_of.get(i) in va_ids)
    out["newRowsInTrain"] = sum(1 for i in tr_ids if i in src_of)
    bad = [s for s in tr + va if len(s["input_ids"]) != len(s["completion_mask"]) or not any(s["completion_mask"])]
    out["contractViolations"] = len(bad)
    out["maxLen"] = max(len(s["input_ids"]) for s in tr + va)
    evals = P11.load_evals()
    leaks = collections.Counter()
    seen = set()
    for s in tr + va:
        utt = s["prompt"].rsplit("Request: ", 1)[-1].split("<|im_end|>", 1)[0]
        n = dedup.normalize(utt)
        if n in seen:
            continue
        seen.add(n)
        hit = P11.leak_source(n, evals)
        if hit:
            leaks[hit[0]] += 1
    out["evalLeakUtterances"] = dict(leaks)
    out["distinctUtterancesScanned"] = len(seen)
    terms = T.context_leak_terms()
    if not any("@" in t for t in terms):
        raise SystemExit("account email not loaded; refusing to report a context-term scan without it")
    out["contextTermsLoaded"] = len(terms)
    out["contextTermHits"] = {f: sum(Path(f).read_text().lower().count(t) for t in terms) for f in a.scan}
    Path(a.out).write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out))
    ok = (out["catalogHashEqual"] and out["valUnchanged"] and not out["trainValIdOverlap"]
          and not out["newTrainRowsWithValSource"] and not out["contractViolations"] and not leaks
          and not any(out["contextTermHits"].values()))
    return 0 if ok else 6


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sources")
    for k in ("--rows", "--context", "--r11-sources", "--val", "--groups", "--out-items", "--out-sources"):
        p.add_argument(k, required=True)
    p.add_argument("--seed", type=int, default=20261024); p.add_argument("--per-op", type=int, default=30)
    p.add_argument("--max-per-source", type=int, default=2); p.add_argument("--min-full", type=int, default=10)
    p.add_argument("--pairs-per-group", type=int, default=24); p.add_argument("--noaction", type=int, default=820)
    p = sub.add_parser("plan")
    for k in ("--items", "--sources", "--context", "--out"):
        p.add_argument(k, required=True)
    p.add_argument("--seed", type=int, default=20261024); p.add_argument("--batch-size", type=int, default=10)
    p.add_argument("--effort", default="medium")
    p = sub.add_parser("subset"); p.add_argument("requests"); p.add_argument("--out-dir", required=True)
    p.add_argument("--per-kind", type=int, default=5); p.add_argument("--seed", type=int, default=20261024)
    p = sub.add_parser("rows"); p.add_argument("results")
    for k in ("--meta", "--sources", "--context", "--out"):
        p.add_argument(k, required=True)
    p = sub.add_parser("stats")
    p.add_argument("--meta", action="append", required=True)
    for k in ("--context", "--rows", "--leak-kept", "--valid", "--kept", "--sources", "--r11-sources", "--out"):
        p.add_argument(k, required=True)
    p = sub.add_parser("check")
    for k in ("--train", "--val", "--base-val", "--rows", "--out"):
        p.add_argument(k, required=True)
    p.add_argument("--manifest", action="append", required=True)
    p.add_argument("--scan", action="append", default=[])
    a = ap.parse_args()
    return {"sources": cmd_sources, "plan": cmd_plan, "subset": cmd_subset, "rows": cmd_rows,
            "stats": cmd_stats, "check": cmd_check}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
