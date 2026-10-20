"""Teacher data generation with claude-sonnet-5 over the Message Batches API.

  plan     build generation requests (JSONL) + a cost estimate; no API calls
  submit   send a requests file as one batch (needs credentials and --yes-spend)
  collect  poll a batch, write raw results and token usage
  rows     teacher results -> source rows (+ grounding check)
  label    build blind second-pass requests from rendered step-1 prompts
  agree    keep rows whose blind label matches (op and canonical args)

Eval utterances are never sent to the teacher; dedup.py drops leaks after.
Pricing (claude-api skill, cached 2026-06-24): Sonnet 5 $2 / $10 per MTok
in / out; Batches are 50% of that.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MODEL = "claude-sonnet-5"
PRICE_IN, PRICE_OUT, BATCH_DISCOUNT = 2.0, 10.0, 0.5

PILOT_OPS = [
    "knowledge-note:ADD_TOPIC", "knowledge-note:SET_TITLE",
    "knowledge-note:SUBMIT_FOR_REVIEW", "knowledge-note:REJECT_NOTE",
    "project:SET_PROJECT_STATUS", "project:ADD_MEMBER",
    "wbs:CREATE_GOAL", "wbs:SET_GOAL_STATUS",
    "tension:RESOLVE_TENSION",
]
PILOT_NO_ACTION_MODELS = ["knowledge-note", "wbs"]

STYLE_AXES = [
    "imperative", "question form", "terse (2-5 words)", "verbose and chatty",
    "refers to the document as 'it' or 'this'", "lowercase with a typo",
    "indirect intent (says the situation, not the command)",
    "uses a synonym that is not in the operation's description",
]
PERSONAS = [
    "a PhD student keeping research notes", "a product manager tracking a launch",
    "a software engineer writing design notes", "a writer organizing book research",
    "a team lead running a small project", "a hobbyist gardener keeping a journal",
]

SYSTEM = """You write training data for a small on-device model that turns chat messages into document operations in a personal knowledge vault app.

Write messages a real user would type into the app's chat box while looking at one document. Each message asks for exactly one change, carried out by the target operation. Rules:
- Vary wording, length and register as instructed; never quote the operation name or copy its description.
- Free-text argument values must be copied verbatim (same casing) from the message; put each one in `evidence` with the exact span.
- Include an optional argument only if the message clearly states it.
- Enum arguments must be one of the listed values, and the message must imply that value unambiguously.
- The message must not be better served by any sibling operation."""

NO_ACTION_SYSTEM = """You write training data for a small on-device model in a personal knowledge vault app. Write chat messages that must NOT change the open document: questions about it, comments, thanks, or requests no listed operation can do. Make them realistic and close to real edit requests in wording, so the model learns the boundary."""


def strip_unsupported(schema: object) -> object:
    """Structured outputs reject numeric/string constraints and patterns."""
    drop = {"pattern", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "minItems", "maxItems", "$schema"}
    if isinstance(schema, dict):
        return {k: strip_unsupported(v) for k, v in schema.items() if k not in drop}
    if isinstance(schema, list):
        return [strip_unsupported(v) for v in schema]
    return schema


def gen_schema(model_schema: dict) -> dict:
    args = strip_unsupported(model_schema)
    if not args.get("properties"):
        args = {"type": "object", "properties": {}, "additionalProperties": False}
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "utterance": {"type": "string"},
                        "style": {"type": "string"},
                        "args": args,
                        "evidence": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"field": {"type": "string"}, "span": {"type": "string"}},
                                "required": ["field", "span"], "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["utterance", "style", "args", "evidence"], "additionalProperties": False,
                },
            }
        },
        "required": ["items"], "additionalProperties": False,
    }


NO_ACTION_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"utterance": {"type": "string"},
                       "kind": {"type": "string", "enum": ["question", "comment", "out-of-catalog"]}},
        "required": ["utterance", "kind"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}


def op_brief(op: dict) -> str:
    sib = "\n".join(f"- {s['key']}: {s['description'] or '(no description)'}" for s in op["siblings"])
    return (
        f"Target operation: {op['key']}\nDescription: {op['description'] or '(none)'}\n"
        f"Input SDL:\n{op['inputSdl']}\n"
        f"Arguments you fill (JSON schema): {json.dumps(op['modelSchema'])}\n"
        f"Filled by the app, never by you: {', '.join(op['appFilledFields']) or 'none'}\n"
        f"Empty document state: {json.dumps(op['emptyState'])}\n"
        f"Reducer source (what the operation does):\n```ts\n{op['reducerSource'] or ''}\n```\n"
        f"Sibling operations on the same document (do not mean these):\n{sib}"
    )


def request(custom_id: str, system: str, user: str, schema: dict, effort: str, max_tokens: int) -> dict:
    return {"custom_id": custom_id, "params": {
        "model": MODEL, "max_tokens": max_tokens, "system": system,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        "messages": [{"role": "user", "content": user}],
    }}


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4)  # chars/4 heuristic; replace with count_tokens when a key exists


def cmd_plan(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    ops = PILOT_OPS if a.ops == "pilot" else [k for k in ctx]
    rng = random.Random(a.seed)
    reqs = []
    for key in ops:
        op = ctx[key]
        for i in range(a.requests_per_op):
            axes = rng.sample(STYLE_AXES, 2)
            user = (f"{op_brief(op)}\n\nWrite {a.items} distinct messages. Persona: {rng.choice(PERSONAS)}. "
                    f"Styles to cover: {', '.join(axes)}. Seed: {rng.randrange(10**6)}.")
            cid = f"gen-{key.replace(':', '--')}-{i}"
            reqs.append(request(cid, SYSTEM, user, gen_schema(op["modelSchema"]), "medium", 16000))
    models = PILOT_NO_ACTION_MODELS if a.ops == "pilot" else sorted({o["model"] for o in ctx.values()})
    for m in models:
        ops_m = [o for o in ctx.values() if o["model"] == m]
        listing = "\n".join(f"- {o['key']}: {o['description'] or o['opName']}" for o in ops_m)
        user = (f"Document type: {ops_m[0]['docType']}\nIts operations:\n{listing}\n\n"
                f"Write {a.items} messages that need no operation. Persona: {rng.choice(PERSONAS)}.")
        reqs.append(request(f"noaction-{m}-0", NO_ACTION_SYSTEM, user, NO_ACTION_SCHEMA, "medium", 8000))

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(r) + "\n" for r in reqs))
    in_tok = sum(est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]
                            + json.dumps(r["params"]["output_config"])) for r in reqs)
    items = a.items * len(reqs)
    # Output: ~70 visible tokens per item plus adaptive thinking at medium effort,
    # bounded by a low/high guess per request. Unmeasured until a real run.
    out_lo, out_hi = items * 70 + len(reqs) * 300, items * 70 + len(reqs) * 3000
    cost = lambda i, o: round((i * PRICE_IN + o * PRICE_OUT) / 1e6 * BATCH_DISCOUNT, 4)  # noqa: E731
    est = {"label": "ESTIMATE (chars/4 input, guessed output incl. thinking); not measured",
           "requests": len(reqs), "itemsRequested": items, "inputTokens": in_tok,
           "outputTokensRange": [out_lo, out_hi], "batchCostUsdRange": [cost(in_tok, out_lo), cost(in_tok, out_hi)],
           "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
    Path(str(out) + ".estimate.json").write_text(json.dumps(est, indent=2) + "\n")
    print(json.dumps(est))
    return 0


def client():
    import anthropic
    return anthropic.Anthropic()


def cmd_submit(a) -> int:
    reqs = [json.loads(l) for l in Path(a.requests).read_text().splitlines() if l.strip()]
    if not a.yes_spend:
        print(f"dry run: {len(reqs)} requests not sent (pass --yes-spend to submit)")
        return 0
    if len(reqs) > a.max_requests:
        print(f"refusing: {len(reqs)} requests > --max-requests {a.max_requests}")
        return 2
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        print("no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment; not submitting")
        return 2
    batch = client().messages.batches.create(requests=reqs)
    print(json.dumps({"batchId": batch.id, "status": batch.processing_status, "requests": len(reqs)}))
    return 0


def cmd_collect(a) -> int:
    c = client()
    while (b := c.messages.batches.retrieve(a.batch_id)).processing_status != "ended":
        print(f"{b.processing_status}: {b.request_counts}", file=sys.stderr)
        time.sleep(30)
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    out = []
    for r in c.messages.batches.results(a.batch_id):
        row = {"custom_id": r.custom_id, "type": r.result.type}
        if r.result.type == "succeeded":
            m = r.result.message
            u = m.usage
            usage["input"] += u.input_tokens
            usage["output"] += u.output_tokens
            usage["cacheRead"] += u.cache_read_input_tokens or 0
            usage["cacheWrite"] += u.cache_creation_input_tokens or 0
            row["stop_reason"] = m.stop_reason
            row["text"] = next((b.text for b in m.content if b.type == "text"), "")
        out.append(row)
    Path(a.out).write_text("".join(json.dumps(r) + "\n" for r in out))
    usage["costUsd"] = round((usage["input"] * PRICE_IN + usage["output"] * PRICE_OUT
                              + usage["cacheRead"] * PRICE_IN * 0.1 + usage["cacheWrite"] * PRICE_IN * 1.25)
                             / 1e6 * BATCH_DISCOUNT, 4)
    Path(a.out + ".usage.json").write_text(json.dumps(usage, indent=2) + "\n")
    print(json.dumps(usage))
    return 0


def grounded(args: dict, utterance: str, schema: dict, evidence: list[dict]) -> str | None:
    """Every free-text string is an utterance substring; optionals need evidence."""
    low = utterance.lower()
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    spans = {e["field"] for e in evidence if e["span"].lower() in low}

    def enum_values(s: dict) -> set:
        vals = set(s.get("enum", []))
        for b in s.get("anyOf", []):
            vals |= set(b.get("enum", []))
        return vals

    for k, v in args.items():
        if v is None:
            continue
        s = props.get(k, {})
        values = v if isinstance(v, list) else [v]
        for x in values:
            if isinstance(x, str) and x not in enum_values(s) and x.lower() not in low:
                return f"{k}: value not in utterance"
        if k not in required and k not in spans:
            return f"{k}: optional field without evidence"
    return None


def cmd_rows(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    rows, dropped = [], []
    for line in Path(a.results).read_text().splitlines():
        r = json.loads(line)
        if r["type"] != "succeeded" or r.get("stop_reason") != "end_turn":
            dropped.append({"custom_id": r["custom_id"], "reason": r.get("stop_reason") or r["type"]})
            continue
        items = json.loads(r["text"])["items"]
        for j, it in enumerate(items):
            rid = f"{r['custom_id']}-{j}"
            if r["custom_id"].startswith("noaction-"):
                model = r["custom_id"].split("-", 1)[1].rsplit("-", 1)[0]
                doc_type = next(o["docType"] for o in ctx.values() if o["model"] == model)
                rows.append({"id": rid, "utterance": it["utterance"], "docType": doc_type, "op": None,
                             "meta": {"batch": r["custom_id"], "kind": it["kind"]}})
                continue
            key = r["custom_id"][4:].rsplit("-", 1)[0].replace("--", ":")
            op = ctx[key]
            args = {k: v for k, v in it["args"].items() if v is not None}
            why = grounded(args, it["utterance"], op["modelSchema"], it["evidence"])
            if why:
                dropped.append({"id": rid, "reason": why, "utterance": it["utterance"]})
                continue
            rows.append({"id": rid, "utterance": it["utterance"], "docType": op["docType"], "op": key,
                         "args": args, "meta": {"batch": r["custom_id"], "style": it["style"]}})
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    print(json.dumps({"rows": len(rows), "dropped": len(dropped), "droppedDetail": dropped[:20]}))
    return 0


LABEL_SYSTEM = ("You label chat messages for a document app. Given one message and the candidate operations, "
                "pick the single operation the user wants, or \"none\" if it needs no document change, "
                "and give its arguments copied verbatim from the message.")


def cmd_label(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    reqs = []
    for line in Path(a.rendered).read_text().splitlines():
        s = json.loads(line)
        if s["step"] != 1:
            continue
        cands = s["candidates"]
        utt = s["messages"][-1]["content"].rsplit("Request: ", 1)[-1]
        listing = "\n".join(f"- {k}: {ctx[k]['description'] or ctx[k]['opName']} args={json.dumps(ctx[k]['modelSchema'].get('properties', {}))}" for k in cands)
        schema = {"type": "object", "properties": {
            "op": {"type": "string", "enum": [*cands, "none"]},
            "args_json": {"type": "string"}}, "required": ["op", "args_json"], "additionalProperties": False}
        reqs.append(request(f"label-{s['id']}", LABEL_SYSTEM,
                            f"Candidates:\n{listing}\n\nMessage: {utt}\n\nargs_json is a JSON object of the chosen operation's arguments ({{}} for none).",
                            schema, "low", 4000))
    Path(a.out).write_text("".join(json.dumps(r) + "\n" for r in reqs))
    in_tok = sum(est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]) for r in reqs)
    print(json.dumps({"requests": len(reqs), "inputTokensEstimate": in_tok}))
    return 0


def cmd_agree(a) -> int:
    labels = {}
    for line in Path(a.results).read_text().splitlines():
        r = json.loads(line)
        if r["type"] == "succeeded":
            labels[r["custom_id"].removeprefix("label-")] = json.loads(r["text"])
    kept, disagree = [], []
    for line in Path(a.rows).read_text().splitlines():
        row = json.loads(line)
        lab = labels.get(row["id"])
        gold_op = row["op"] or "none"
        try:
            lab_args = json.loads(lab["args_json"]) if lab else None
        except json.JSONDecodeError:
            lab_args = None
        if isinstance(lab_args, dict):
            lab_args = {k: v for k, v in lab_args.items() if v is not None}
        ok = lab is not None and lab["op"] == gold_op and (row["op"] is None or lab_args == row.get("args", {}))
        (kept if ok else disagree).append(row if ok else {"id": row["id"], "gold": gold_op, "label": lab})
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept))
    print(json.dumps({"kept": len(kept), "disagree": len(disagree), "detail": disagree[:20]}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p.add_argument("--ops", default="pilot"); p.add_argument("--requests-per-op", type=int, default=2)
    p.add_argument("--items", type=int, default=5); p.add_argument("--seed", type=int, default=7)
    p = sub.add_parser("submit"); p.add_argument("requests"); p.add_argument("--yes-spend", action="store_true")
    p.add_argument("--max-requests", type=int, default=200)
    p = sub.add_parser("collect"); p.add_argument("batch_id"); p.add_argument("--out", required=True)
    p = sub.add_parser("rows"); p.add_argument("results"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("label"); p.add_argument("rendered"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("agree"); p.add_argument("results"); p.add_argument("--rows", required=True); p.add_argument("--out", required=True)
    a = ap.parse_args()
    return {"plan": cmd_plan, "submit": cmd_submit, "collect": cmd_collect, "rows": cmd_rows,
            "label": cmd_label, "agree": cmd_agree}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
