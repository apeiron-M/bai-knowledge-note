"""Teacher data generation with claude-sonnet-5.

Two backends run the same request JSONL and write the same result JSONL
(`custom_id, type, stop_reason, text`):
  cli (default)  headless Claude Code, one isolated `claude -p` per request;
                 no API key, uses the logged-in Claude Code account
  api            the Message Batches API (needs ANTHROPIC_API_KEY)

  plan     build generation requests (JSONL) + a cost estimate; no API calls
  run      run a requests file with --teacher cli|api, write results + usage
  submit   (api) send a requests file as one batch (needs credentials and --yes-spend)
  collect  (api) poll a batch, write raw results and token usage
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
import re
import signal
import statistics
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MODEL = "claude-sonnet-5"
PRICE_IN, PRICE_OUT, BATCH_DISCOUNT = 2.0, 10.0, 0.5

PILOT_OPS = [
    "knowledge-note:ADD_TOPIC", "knowledge-note:SET_TITLE",
    "knowledge-note:SUBMIT_FOR_REVIEW", "knowledge-note:REJECT_NOTE",
    "project:SET_PROJECT_STATUS", "project:ADD_MEMBER",
    "wbs:CREATE_GOAL", "wbs:SET_OWNER",
    "tension:RESOLVE_TENSION",
]
# Steps applied to the fresh document before the row's action
# (validate-rows.ts `fixture`). APPROVE/REJECT need IN_REVIEW; the tension
# ops replay on an empty doc too, the fixture only makes the state realistic.
# Ops not listed replay on an empty doc.
# Ref ops (an app-filled `(ref-id)` field naming an existing entity, 40 of 99)
# are not supported yet: they need labeled entities in a fixture plus
# `refCandidates`, and validate-rows' id counter is global across rows.
FIXTURES: dict[str, list[dict]] = {
    "knowledge-note:REJECT_NOTE": [{"op": "knowledge-note:SUBMIT_FOR_REVIEW", "args": {}}],
    "knowledge-note:APPROVE_NOTE": [{"op": "knowledge-note:SUBMIT_FOR_REVIEW", "args": {}}],
    "tension:RESOLVE_TENSION": [{"op": "tension:CREATE_TENSION", "args": {
        "title": "Ship fast vs stable", "description": "Release cadence vs bugs", "involvedRefs": []}}],
    "tension:DISSOLVE_TENSION": [{"op": "tension:CREATE_TENSION", "args": {
        "title": "Ship fast vs stable", "description": "Release cadence vs bugs", "involvedRefs": []}}],
}
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
- Write one message per spec, in spec order, and follow each spec's register, length, words to avoid and name exactly; set `spec` to the spec's number.
- Never quote the operation name or copy its description.
- Free-text argument values must be copied verbatim (same casing) from the message; put each one in `evidence` with the exact span.
- Include an optional argument only if the message clearly states it.
- Enum arguments must be one of the listed values, and the message must imply that value unambiguously.
- The message must not be better served by any sibling operation.
- When the document's current state is listed and a spec names an existing item, the message must pick out that one item among the listed ones (by its name, a close paraphrase or a description, never by its position in the list), and `refs` must give that item's exact label.
- Invent every name, email, date and detail. Never use anything from account, machine or date context you may have been given."""

NO_ACTION_SYSTEM = """You write training data for a small on-device model in a personal knowledge vault app. Write chat messages that must NOT change the open document: questions about it, comments, thanks, or requests no listed operation can do. Make them realistic and close to real edit requests in wording, so the model learns the boundary. Follow each spec's register and length. Invent every name, email, date and detail; never use anything from account, machine or date context you may have been given."""

# Per-item wording spec (pilot 2). `plan` assigns each item a register, a
# length, a name from the seeded pool and, for at least half of an op's
# items, a list of op words to avoid; `rows` drops items that break it and
# `agree` holds every op's kept rows at >= MIN_AVOID op-word-free.
REGISTERS = [
    "casual", "polite and formal", "terse, like a note to self", "all lowercase with one small typo",
    "rushed and a bit stressed", "plain and neutral", "chatty, as if to a colleague", "a question",
]
LENGTHS = {"very short": (2, 5), "short": (6, 12), "medium": (13, 25), "long": (26, 50)}
LENGTH_WEIGHTS = [0.2, 0.35, 0.3, 0.15]
MULTI_CLAUSE = "two or more clauses or sentences, one of them context that does not affect the change (why, what you are in the middle of, an aside)"
MIN_AVOID = 0.5
TRIVIAL_OP_WORDS = {"set", "add", "update", "to", "for", "of", "the", "a", "an", "and", "on", "in", "by",
                    "from", "with", "into", "as"}
# Person-valued semantic fields; the spec's name goes there when one is named.
PERSON_FIELDS = {"assignee", "owner", "author", "assignedTo", "name"}
PERSON_OPS = {"project:ADD_MEMBER", "project:UPDATE_MEMBER"}  # where `name` is a person


def op_words(op_name: str) -> list[str]:
    """The non-trivial words of the op name (held-out-2's paraphrase rule)."""
    return [w for w in op_name.lower().split("_") if w and w not in TRIVIAL_OP_WORDS]


def uses_op_words(utterance: str, words: list[str]) -> list[str]:
    """Op words (or forms of them) in the utterance: a shared prefix of at
    least max(4, shorter length - 3) characters; words under 4 letters must
    match exactly (plus a plural s)."""
    toks = re.findall(r"[a-z]+", utterance.lower())
    hits = []
    for w in words:
        for t in toks:
            if len(w) < 4 or len(t) < 4:
                ok = t in (w, w + "s")
            else:
                n = len(os.path.commonprefix([w, t]))
                ok = n >= max(4, min(len(w), len(t)) - 3)
            if ok:
                hits.append(w)
                break
    return hits


def item_specs(rng: random.Random, k: int, op_name: str | None, people: list[str]) -> list[dict]:
    """k specs: ceil(k/2) (+1 from 4 items) avoid the op words; registers
    differ inside a request; one in four is multi-clause (at least medium)."""
    n_avoid = 0 if op_name is None else -(-k // 2) + (1 if k >= 4 else 0)
    avoid = rng.sample(range(k), n_avoid)
    regs = rng.sample(REGISTERS, min(k, len(REGISTERS)))
    lens = rng.choices(list(LENGTHS), weights=LENGTH_WEIGHTS, k=k)
    n_multi = k // 4 + (rng.random() < (k % 4) / 4)  # one in four, in expectation
    multi = set(rng.sample(range(k), n_multi))
    specs = []
    for i in range(k):
        reg = regs[i % len(regs)]
        length = lens[i]
        if i in multi and length in ("very short", "short"):
            length = "medium"
        elif reg.startswith("terse") and i not in multi:
            length = "very short"
        sp = {"n": i + 1, "register": reg, "length": length, "multiClause": i in multi,
              "name": people.pop(0) if people else None}
        if i in avoid:
            sp["avoid"] = op_words(op_name or "")
        specs.append(sp)
    return specs


def spec_text(sp: dict, ref: dict | None = None) -> str:
    lo, hi = LENGTHS[sp["length"]]
    bits = [f"Spec {sp['n']}:"]
    if ref is not None:
        for path, lab in ref["labels"].items():
            if lab is None:
                bits.append(f"`{path}`: none (refs.{path} = \"none\").")
            elif isinstance(lab, list):
                bits.append(f"`{path}` = {json.dumps(lab, ensure_ascii=False)} (refs.{path} is this whole list, in this order).")
            else:
                bits.append(f"`{path}` = {json.dumps(lab, ensure_ascii=False)}.")
        if ref.get("hint"):
            bits.append(f"Intent: {ref['hint']}.")
    bits.append(f"Register: {sp['register']}. Length: {lo}-{hi} words.")
    if sp["multiClause"]:
        bits.append(f"Shape: {MULTI_CLAUSE}.")
    if sp.get("avoid"):
        bits.append("Do not use these words or any form of them: " + ", ".join(f'"{w}"' for w in sp["avoid"]) + ".")
    if sp.get("name"):
        bits.append(f"Any person in the message or its arguments (author, owner, assignee, member) is "
                    f"{sp['name']} (full or first name), never the account holder.")
    return " ".join(bits)


def wording_error(utterance: str, sp: dict) -> str | None:
    """The spec rules `rows` enforces: op words, length (loose), clauses."""
    if sp.get("avoid"):
        hit = uses_op_words(utterance, sp["avoid"])
        if hit:
            return f"op word {hit[0]!r} in an avoid item"
    n = len(utterance.split())
    lo, hi = LENGTHS[sp["length"]]
    if not (max(1, int(lo * 0.6)) <= n <= int(hi * 1.5) + 1):
        return f"length {n} words, spec {lo}-{hi}"
    if sp["multiClause"] and (n < 10 or not re.search(
            r"[.;!?—–:,]\s|\s(and|but|so|because|since|while|as|after|before|when|if)\s", utterance, re.I)):
        return "multi-clause spec, single clause"
    return None


def prompt_leaks(texts: list[str], min_words: int = 3) -> list[dict]:
    """Eval utterances (>= min_words words, normalized) inside any prompt."""
    sys.path.insert(0, str(REPO / "training/py"))
    from dedup import DEFAULT_EVAL_DIRS, load_eval, normalize
    evals = [e for e in load_eval(DEFAULT_EVAL_DIRS, []) if len(e["norm"].split()) >= min_words]
    blob = " " + normalize("\n".join(texts)) + " "
    return [{"source": e["source"], "id": e["id"]} for e in evals if f" {e['norm']} " in blob]


def strip_unsupported(schema: object) -> object:
    """Structured outputs reject numeric/string constraints and patterns."""
    drop = {"pattern", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "minItems", "maxItems", "$schema"}
    if isinstance(schema, dict):
        return {k: strip_unsupported(v) for k, v in schema.items() if k not in drop}
    if isinstance(schema, list):
        return [strip_unsupported(v) for v in schema]
    return schema


def gen_schema(model_schema: dict, refs: dict[str, tuple[list[str], bool]] | None = None) -> dict:
    """Item schema: spec number, utterance, semantic args, evidence, and for
    a ref op the label of each ref path's item (`refs`, "none" if unused)."""
    args = strip_unsupported(model_schema)
    item_props: dict = {"spec": {"type": "integer"}, "utterance": {"type": "string"}}
    if args.get("properties"):  # ops with no semantic fields get no args object
        item_props["args"] = args
    item_props["evidence"] = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"field": {"type": "string"}, "span": {"type": "string"}},
            "required": ["field", "span"], "additionalProperties": False,
        },
    }
    if refs:
        props = {}
        for path, (labels, is_list) in refs.items():
            e = {"type": "string", "enum": [*labels, "none"]}
            props[path] = {"type": "array", "items": e} if is_list else e
        item_props["refs"] = {"type": "object", "properties": props, "required": list(props),
                              "additionalProperties": False}
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": item_props,
                    "required": list(item_props), "additionalProperties": False,
                },
            }
        },
        "required": ["items"], "additionalProperties": False,
    }


NO_ACTION_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"spec": {"type": "integer"}, "utterance": {"type": "string"},
                       "kind": {"type": "string", "enum": ["question", "comment", "out-of-catalog"]}},
        "required": ["spec", "utterance", "kind"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}


def schema_load(schema: object) -> tuple[int, int]:
    """(optional params, union-typed params): structured outputs allow 24 / 16 per request."""
    opt = uni = 0
    if isinstance(schema, dict):
        props = schema.get("properties")
        if isinstance(props, dict):
            req = set(schema.get("required", []))
            opt += sum(1 for k in props if k not in req)
            uni += sum(1 for v in props.values() if isinstance(v, dict) and ("anyOf" in v or isinstance(v.get("type"), list)))
        for v in schema.values():
            o, u = schema_load(v)
            opt, uni = opt + o, uni + u
    elif isinstance(schema, list):
        for v in schema:
            o, u = schema_load(v)
            opt, uni = opt + o, uni + u
    return opt, uni


def op_brief(op: dict, state: str | None = None) -> str:
    sib = "\n".join(f"- {s['key']}: {s['description'] or '(no description)'}" for s in op["siblings"])
    doc = (f"Current document state (what the user is looking at):\n{state}\n" if state is not None
           else f"Empty document state: {json.dumps(op['emptyState'])}\n")
    return (
        f"Target operation: {op['key']}\nDescription: {op['description'] or '(none)'}\n"
        f"Input SDL:\n{op['inputSdl']}\n"
        f"Arguments you fill (JSON schema): {json.dumps(op['modelSchema'])}\n"
        f"Filled by the app, never by you: {', '.join(op['appFilledFields']) or 'none'}\n"
        f"{doc}"
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


PILOT2_OPS = [  # non-ref ops, one per model that has one
    "derivation:ADD_RESEED_ENTRY", "health-report:ADD_CHECK", "knowledge-note:SET_DESCRIPTION",
    "moc:ADD_OPEN_QUESTION", "moc:UPDATE_ORIENTATION", "observation:CREATE_OBSERVATION",
    "project:SET_OWNER", "research-claim:UPDATE_CLAIM_CONTENT", "source:SET_SOURCE_STATUS",
    "tension:ADD_INVOLVED_REF", "vault-config:TOGGLE_FEATURE", "wbs:SET_REFERENCES",
]
PILOT2_REF_ITEMS3 = {  # ref ops a chat user hits most get 3 items, the rest 2
    "wbs:SET_GOAL_STATUS", "wbs:ASSIGN_GOAL", "wbs:CREATE_GOAL", "wbs:DELETE_GOAL",
    "wbs:UPDATE_GOAL_DESCRIPTION", "knowledge-note:REMOVE_TOPIC", "knowledge-note:REMOVE_LINK",
    "project:REMOVE_MEMBER", "project:SET_DELIVERABLE_STATUS", "pipeline-queue:ASSIGN_TASK",
}
PILOT2_NO_ACTION_MODELS = ["project", "moc", "pipeline-queue"]


def tsx(*args: str) -> str:
    out = subprocess.run(["npx", "--no-install", "tsx", *args], cwd=REPO, capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f"tsx {' '.join(args)} failed:\n{out.stderr[-2000:]}")
    return out.stdout


def cmd_plan(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    listing = json.loads(tsx("training/gen/ref-scenarios.ts", "--list").strip().splitlines()[-1])
    ref_ops, people_pool = listing["refOps"], listing["people"]
    rng = random.Random(a.seed)
    people: list[str] = []

    def names(k: int) -> list[str]:
        while len(people) < k:
            people.extend(rng.sample(people_pool, len(people_pool)))
        return [people.pop(0) for _ in range(k)]

    # (op key, request index, items)
    if a.ops == "pilot2":
        jobs = [(k, 0, 3 if k in PILOT2_REF_ITEMS3 else 2) for k in ref_ops] + [(k, 0, 4) for k in PILOT2_OPS]
        na_models, na_items = PILOT2_NO_ACTION_MODELS, 4
    else:
        keys = PILOT_OPS if a.ops == "pilot" else list(ctx)
        jobs = [(k, i, a.items) for k in keys for i in range(a.requests_per_op)]
        na_models = PILOT_NO_ACTION_MODELS if a.ops == "pilot" else sorted({o["model"] for o in ctx.values()})
        na_items = a.items
    cid = lambda key, i: f"gen-{key.replace(':', '--')}-{i}"  # noqa: E731
    spec = [{"cid": cid(k, i), "op": k, "items": n, "seed": rng.randrange(2**31)} for k, i, n in jobs if k in ref_ops]
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    scen: dict[str, dict] = {}
    if spec:
        sp_file, sc_file = Path(str(out) + ".scenario-spec.json"), Path(str(out) + ".scenarios.json")
        sp_file.write_text(json.dumps(spec) + "\n")
        tsx("training/gen/ref-scenarios.ts", str(sp_file), str(sc_file))
        scen = {x["cid"]: x for x in json.loads(sc_file.read_text())}

    reqs, meta = [], {}
    for key, i, k in jobs:
        op = ctx[key]
        c = cid(key, i)
        specs = item_specs(rng, k, op["opName"], names(k))
        sc = scen.get(c)
        refs = None
        if sc:
            refs = {p: ([x["label"] for x in cs], isinstance(sc["items"][0]["refs"].get(p), list))
                    for p, cs in sc["refCandidates"].items()}
        lines = [spec_text(sp, sc["items"][j] if sc else None) for j, sp in enumerate(specs)]
        user = (f"{op_brief(op, sc['state'] if sc else None)}\n\n"
                f"Write exactly {k} messages, one per spec. Persona: "
                f"{('someone working on a ' + sc['theme']) if sc else rng.choice(PERSONAS)}.\n"
                + "\n".join(lines) + f"\nSeed: {rng.randrange(10**6)}.")
        reqs.append(request(c, SYSTEM, user, gen_schema(op["modelSchema"], refs), "medium", 16000))
        meta[c] = {"specs": specs, **({"scenario": sc} if sc else {})}
    for m in na_models:
        ops_m = [o for o in ctx.values() if o["model"] == m]
        listing_m = "\n".join(f"- {o['key']}: {o['description'] or o['opName']}" for o in ops_m)
        specs = item_specs(rng, na_items, None, names(na_items))
        c = f"noaction-{m}-0"
        user = (f"Document type: {ops_m[0]['docType']}\nIts operations:\n{listing_m}\n\n"
                f"Write exactly {na_items} messages that need no operation, one per spec. Persona: {rng.choice(PERSONAS)}.\n"
                + "\n".join(spec_text(sp) for sp in specs))
        reqs.append(request(c, NO_ACTION_SYSTEM, user, NO_ACTION_SCHEMA, "medium", 8000))
        meta[c] = {"specs": specs}

    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in reqs))
    Path(str(out) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    leaks = prompt_leaks([r["params"]["system"] + "\n" + r["params"]["messages"][0]["content"] for r in reqs])
    in_tok = sum(est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]
                            + json.dumps(r["params"]["output_config"])) for r in reqs)
    items = sum(len(m["specs"]) for m in meta.values())
    # Output: ~70 visible tokens per item plus adaptive thinking at medium effort,
    # bounded by a low/high guess per request. Unmeasured until a real run.
    out_lo, out_hi = items * 70 + len(reqs) * 300, items * 70 + len(reqs) * 3000
    cost = lambda i, o: round((i * PRICE_IN + o * PRICE_OUT) / 1e6 * BATCH_DISCOUNT, 4)  # noqa: E731
    est = {"label": "ESTIMATE (chars/4 input, guessed output incl. thinking); not measured",
           "requests": len(reqs), "itemsRequested": items, "refOpRequests": len(scen), "inputTokens": in_tok,
           "outputTokensRange": [out_lo, out_hi], "batchCostUsdRange": [cost(in_tok, out_lo), cost(in_tok, out_hi)],
           "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
           "evalUtterancesInPrompts": leaks,
           "overSchemaLimits": sorted({r["custom_id"].rsplit("-", 1)[0] for r in reqs
                                       if (lambda o, u: o > 24 or u > 16)(*schema_load(r["params"]["output_config"]["format"]["schema"]))})}
    Path(str(out) + ".estimate.json").write_text(json.dumps(est, indent=2) + "\n")
    print(json.dumps(est))
    if leaks:
        print(f"refusing: {len(leaks)} eval utterance(s) appear in the prompts", file=sys.stderr)
        return 5
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


def collect_batch(batch_id: str, out_path: str) -> dict:
    c = client()
    while (b := c.messages.batches.retrieve(batch_id)).processing_status != "ended":
        print(f"{b.processing_status}: {b.request_counts}", file=sys.stderr)
        time.sleep(30)
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    out = []
    for r in c.messages.batches.results(batch_id):
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
    Path(out_path).write_text("".join(json.dumps(r) + "\n" for r in out))
    usage["costUsd"] = round((usage["input"] * PRICE_IN + usage["output"] * PRICE_OUT
                              + usage["cacheRead"] * PRICE_IN * 0.1 + usage["cacheWrite"] * PRICE_IN * 1.25)
                             / 1e6 * BATCH_DISCOUNT, 4)
    Path(out_path + ".usage.json").write_text(json.dumps(usage, indent=2) + "\n")
    return usage


def cmd_collect(a) -> int:
    print(json.dumps(collect_batch(a.batch_id, a.out)))
    return 0


# --------------------------------------------------------------------------
# cli backend: headless Claude Code (`claude -p`), one process per request
# --------------------------------------------------------------------------

# Every call runs with no tools, no MCP servers, no user/project/local
# settings, no installed plugins/hooks/CLAUDE.md (--safe-mode), no skills,
# no saved session, and the teacher's own system prompt, from an empty cwd.
CLI_BASE = [
    "-p", "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
]
# The parent Claude Code session's variables; the child must not attach to it.
CHILD_ENV_DROP = re.compile(r"^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)$")
# Subscription usage window exhausted: retrying minutes later cannot help.
LIMIT_RE = re.compile(r"usage limit|hit your limit|limit reached|limit will reset|resets? at", re.I)
AUTH_RE = re.compile(r"not logged in|log ?in|authenticat|invalid api key|oauth|unauthori[sz]ed|credential", re.I)
DEFAULT_CLI_CWD = Path(os.environ.get("TMPDIR", "/tmp")) / "bai-teacher-cwd"


class AuthError(RuntimeError):
    pass


class Retryable(RuntimeError):
    pass


class UsageLimit(RuntimeError):
    pass


def cli_auth_status() -> dict:
    """`claude auth status` (JSON). Used to fail fast before any call, and to
    learn the account email the CLI injects into every call's context."""
    env = {k: v for k, v in os.environ.items() if not CHILD_ENV_DROP.match(k)}
    try:
        out = subprocess.run(["claude", "auth", "status", "--json"], capture_output=True, text=True,
                             timeout=60, env=env, cwd=str(DEFAULT_CLI_CWD.parent)).stdout
        return json.loads(out)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return {}


# What `redact` writes over a leaked term in a raw results file; `rows`
# still drops any item that carries it.
REDACTED = "[account-context-redacted]"


def context_leak_terms() -> list[str]:
    """Strings Claude Code puts in the teacher's context that no flag removes
    (the account email; the user name and home dir in the environment block).
    A row that contains one is dropped by `rows`."""
    terms = {REDACTED}
    email = cli_auth_status().get("email")
    if email:
        terms |= {email.lower(), email.split("@")[0].lower()}
    for t in (os.environ.get("USER"), str(Path.home())):
        if t and len(t) >= 4:
            terms.add(t.lower())
    return sorted(terms)


def cli_argv(params: dict, budget: float) -> list[str]:
    schema = params["output_config"]["format"]["schema"]
    return ["claude", *CLI_BASE,
            "--model", params["model"],
            "--effort", params["output_config"].get("effort", "medium"),
            "--max-budget-usd", str(budget),
            "--system-prompt", params["system"],
            "--json-schema", json.dumps(schema, separators=(",", ":"))]


def schema_errors(v: object, s: dict, path: str = "$") -> list[str]:
    """The subset of JSON Schema the teacher schemas use (type, enum, anyOf,
    properties, required, additionalProperties: false, items). The CLI's
    --json-schema goes through a tool call, not constrained decoding, so the
    response is re-checked here before it can count as data."""
    if "anyOf" in s:
        return [] if any(not schema_errors(v, b, path) for b in s["anyOf"]) else [f"{path}: no anyOf branch matches"]
    errs: list[str] = []
    t = s.get("type")
    types = t if isinstance(t, list) else [t] if t else []
    pytypes = {"string": str, "object": dict, "array": list, "boolean": bool, "null": type(None),
               "integer": int, "number": (int, float)}
    if types and not any(isinstance(v, pytypes[x]) and not (x in ("integer", "number") and isinstance(v, bool))
                         for x in types):
        return [f"{path}: expected {t}, got {type(v).__name__}"]
    if "enum" in s and v not in s["enum"]:
        errs.append(f"{path}: {v!r} not in enum")
    if isinstance(v, dict):
        props = s.get("properties", {})
        errs += [f"{path}.{k}: required" for k in s.get("required", []) if k not in v]
        if s.get("additionalProperties") is False:
            errs += [f"{path}.{k}: not allowed" for k in v if k not in props]
        for k, sub in props.items():
            if k in v:
                errs += schema_errors(v[k], sub, f"{path}.{k}")
    if isinstance(v, list) and isinstance(s.get("items"), dict):
        for i, x in enumerate(v):
            errs += schema_errors(x, s["items"], f"{path}[{i}]")
    return errs


def call_usage(res: dict) -> dict:
    u = res.get("usage") or {}
    return {"input": u.get("input_tokens", 0), "cacheWrite": u.get("cache_creation_input_tokens", 0),
            "cacheRead": u.get("cache_read_input_tokens", 0), "output": u.get("output_tokens", 0),
            "thinking": (u.get("output_tokens_details") or {}).get("thinking_tokens", 0),
            "costUsd": res.get("total_cost_usd") or 0.0,
            "costBasis": sorted({m.get("costBasis", "?") for m in (res.get("modelUsage") or {}).values()}),
            "models": sorted((res.get("modelUsage") or {}).keys()),
            "durationMs": res.get("duration_ms"), "durationApiMs": res.get("duration_api_ms"),
            "numTurns": res.get("num_turns")}


def cli_attempt(req: dict, cfg: argparse.Namespace) -> tuple[dict, dict | None]:
    """One `claude -p` call: (structured output, usage). Raises AuthError
    (fail fast) or Retryable; a timeout or bad response is never data."""
    params = req["params"]
    env = {k: v for k, v in os.environ.items() if not CHILD_ENV_DROP.match(k)}
    proc = subprocess.Popen(cli_argv(params, cfg.max_budget_usd), cwd=cfg.cli_cwd, env=env,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, start_new_session=True)
    try:
        out, err = proc.communicate(params["messages"][0]["content"], timeout=cfg.timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise Retryable(f"timeout after {cfg.timeout}s")
    try:
        res = json.loads(out)
    except json.JSONDecodeError:
        tail = (err or out).strip()[-300:]
        if LIMIT_RE.search(tail):
            raise UsageLimit(tail)
        if AUTH_RE.search(tail):
            raise AuthError(tail)
        raise Retryable(f"exit {proc.returncode}, no JSON result: {tail}")
    usage = call_usage(res)

    def retry(msg: str) -> Retryable:
        e = Retryable(msg)
        e.usage = usage  # type: ignore[attr-defined]  # failed attempts still cost tokens
        return e
    if res.get("is_error") or res.get("subtype") != "success":
        msg = f"{res.get('subtype')} api_error_status={res.get('api_error_status')}: {str(res.get('result'))[:300]}"
        if LIMIT_RE.search(str(res.get("result", ""))):
            raise UsageLimit(msg)
        if res.get("api_error_status") in (401, 403) or AUTH_RE.search(str(res.get("result", ""))):
            raise AuthError(msg)
        raise retry(msg)
    so = res.get("structured_output")
    if not isinstance(so, dict):
        raise retry("no structured_output in the result")
    errs = schema_errors(so, params["output_config"]["format"]["schema"])
    if errs:
        raise retry(f"schema: {'; '.join(errs[:5])}")
    return so, usage


def cli_one(req: dict, cfg: argparse.Namespace, stop: threading.Event) -> dict:
    row = {"custom_id": req["custom_id"], "type": "errored", "attempts": []}
    for n in range(cfg.retries + 1):
        if stop.is_set():
            row["error"] = "cancelled"
            return row
        t0 = time.monotonic()
        try:
            so, usage = cli_attempt(req, cfg)
            row["attempts"].append({"wallS": round(time.monotonic() - t0, 2), "ok": True, "usage": usage})
            row.update(type="succeeded", stop_reason="end_turn", text=json.dumps(so, ensure_ascii=False))
            return row
        except Retryable as e:
            row["attempts"].append({"wallS": round(time.monotonic() - t0, 2), "ok": False, "error": str(e),
                                    "usage": getattr(e, "usage", None)})
            row["error"] = str(e)
            if n < cfg.retries:
                time.sleep(cfg.backoff * 3 ** n)
    return row


def summarize_cli(rows: list[dict], wall: float, concurrency: int) -> dict:
    ok = [r for r in rows if r["type"] == "succeeded"]
    walls = sorted(r["attempts"][-1]["wallS"] for r in ok)
    tot = {"input": 0, "cacheWrite": 0, "cacheRead": 0, "output": 0, "thinking": 0, "costUsd": 0.0}
    bases: set[str] = set()
    for r in rows:
        for at in r["attempts"]:
            u = at.get("usage") or {}
            for k in tot:
                tot[k] += u.get(k) or 0
            bases |= set(u.get("costBasis") or [])
    tot["costUsd"] = round(tot["costUsd"], 4)

    def pct(xs: list[float], q: float) -> float | None:
        return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2) if xs else None
    return {
        "teacher": "cli", "label": "observed; costUsd is the CLI's total_cost_usd "
                 f"(costBasis {sorted(bases)}): an API-list-price equivalent, not subscription usage",
        "requests": len(rows), "succeeded": len(ok), "errored": len(rows) - len(ok),
        "attempts": sum(len(r["attempts"]) for r in rows),
        "retries": sum(len(r["attempts"]) - 1 for r in rows),
        "attemptErrors": [a["error"] for r in rows for a in r["attempts"] if not a["ok"]],
        "concurrency": concurrency, "wallS": round(wall, 1),
        "perCallWallS": {"median": round(statistics.median(walls), 2) if walls else None,
                         "p90": pct(walls, 0.9), "max": walls[-1] if walls else None},
        "tokens": {k: tot[k] for k in ("input", "cacheWrite", "cacheRead", "output", "thinking")},
        "costUsd": tot["costUsd"],
    }


def run_cli(reqs: list[dict], cfg: argparse.Namespace, out_path: str) -> int:
    Path(cfg.cli_cwd).mkdir(parents=True, exist_ok=True)
    if any(Path(cfg.cli_cwd).iterdir()):
        print(f"refusing: --cli-cwd {cfg.cli_cwd} is not empty", file=sys.stderr)
        return 2
    if not cli_auth_status().get("loggedIn"):
        print("claude is not logged in (run `claude` once and log in, or `claude auth login`); nothing sent.",
              file=sys.stderr)
        return 3
    # Journal: each succeeded row is appended as it lands, and a re-run with
    # the same --out skips the custom_ids already in it (errored rows rerun).
    journal = Path(out_path + ".partial.jsonl")
    rows: dict[str, dict] = {}
    if journal.exists():
        for line in journal.read_text().splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue  # a line cut off by a crash
            if r.get("type") == "succeeded":
                rows[r["custom_id"]] = r
    resumed = len(rows)
    todo = [r for r in reqs if r["custom_id"] not in rows]
    if resumed:
        print(f"resuming: {resumed} done in {journal}, {len(todo)} to run", file=sys.stderr)
    stop = threading.Event()
    t0 = time.monotonic()
    halt: tuple[int, str] | None = None
    with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool, journal.open("a") as jf:
        futs = {pool.submit(cli_one, r, cfg, stop): r["custom_id"] for r in todo}
        for f in as_completed(futs):
            try:
                row = f.result()
            except AuthError as e:
                halt = halt or (3, "claude -p is not authenticated (run `claude` once and log in, "
                                   f"or `claude auth login`).\n{e}")
                stop.set()
                continue
            except UsageLimit as e:
                halt = halt or (4, f"usage limit reached; re-run the same command after it resets.\n{e}")
                stop.set()
                continue
            rows[row["custom_id"]] = row
            if row["type"] == "succeeded":
                jf.write(json.dumps(row, ensure_ascii=False) + "\n")
                jf.flush()
            print(f"[{len(rows)}/{len(reqs)}] {row['custom_id']}: {row['type']}"
                  f" ({len(row['attempts'])} attempt(s), {row['attempts'][-1]['wallS'] if row['attempts'] else '-'}s)",
                  file=sys.stderr)
    if halt:
        done = sum(1 for r in rows.values() if r["type"] == "succeeded")
        print(f"stopped: {halt[1]}\n{done}/{len(reqs)} succeeded rows kept in {journal}; "
              f"{out_path} not written.", file=sys.stderr)
        return halt[0]
    ordered = [rows[r["custom_id"]] for r in reqs]
    Path(out_path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in ordered))
    summary = summarize_cli(ordered, time.monotonic() - t0, cfg.concurrency)
    summary["resumedFromJournal"] = resumed  # wallS covers this invocation only
    if summary["errored"] == 0:
        journal.unlink()
    summary["command"] = ["claude", *CLI_BASE, "--model", MODEL, "--effort", "<request effort>",
                          "--max-budget-usd", str(cfg.max_budget_usd), "--system-prompt", "<request system>",
                          "--json-schema", "<request schema>"]
    summary["cwd"] = str(cfg.cli_cwd)
    Path(out_path + ".usage.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("attemptErrors", "command")}))
    return 0 if summary["errored"] == 0 else 1


def cmd_run(a) -> int:
    reqs = [json.loads(l) for l in Path(a.requests).read_text().splitlines() if l.strip()]
    if a.limit:
        reqs = reqs[: a.limit]
    if len(reqs) > a.max_requests:
        print(f"refusing: {len(reqs)} requests > --max-requests {a.max_requests}")
        return 2
    if a.teacher == "cli":
        return run_cli(reqs, a, a.out)
    if not a.yes_spend:
        print(f"dry run: {len(reqs)} requests not sent (pass --yes-spend to submit a batch)")
        return 0
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        print("no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment; not submitting")
        return 2
    batch = client().messages.batches.create(requests=reqs)
    print(json.dumps({"batchId": batch.id, "requests": len(reqs)}), file=sys.stderr)
    print(json.dumps(collect_batch(batch.id, a.out)))
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

    def leaves(v: object, s: dict, path: str):
        """(path, string, schema) for every string leaf, nested objects too."""
        if isinstance(v, dict):
            sub = next((b for b in s.get("anyOf", []) if b.get("type") == "object"), s)
            for k2, v2 in v.items():
                yield from leaves(v2, sub.get("properties", {}).get(k2, {}), f"{path}.{k2}")
        elif isinstance(v, list):
            for x in v:
                yield from leaves(x, s.get("items", s), path)
        elif isinstance(v, str):
            yield path, v, s

    for k, v in args.items():
        if v is None:
            continue
        for path, x, s in leaves(v, props.get(k, {}), k):
            if x not in enum_values(s) and x.lower() not in low:
                return f"{path}: value not in utterance"
        if k not in required and k not in spans:
            return f"{k}: optional field without evidence"
    return None


def ref_mismatch(given: dict, want: dict) -> str | None:
    """The teacher's `refs` labels against the assigned ones (`none` = unused;
    dependency lists compare as sets, every other list in order)."""
    for path, lab in want.items():
        got = given.get(path)
        if lab is None:
            if got not in (None, "none", []):
                return f"{path}: {got!r} given, none assigned"
        elif isinstance(lab, list):
            ok = isinstance(got, list) and (sorted(got) == sorted(lab) if path == "dependencies" else got == lab)
            if not ok:
                return f"{path}: {got!r} given, {lab!r} assigned"
        elif got != lab:
            return f"{path}: {got!r} given, {lab!r} assigned"
    return None


def person_value(key: str, args: dict) -> str | None:
    for k, v in args.items():
        if k in PERSON_FIELDS and isinstance(v, str) and (k != "name" or key in PERSON_OPS):
            return v
    return None


def cmd_rows(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    meta = json.loads(Path(a.meta).read_text()) if a.meta else {}
    rows, dropped = [], []
    leak = context_leak_terms() if a.leak_check else []

    def leaked(it: dict) -> bool:
        blob = json.dumps(it, ensure_ascii=False).lower()
        return any(t in blob for t in leak)
    for line in Path(a.results).read_text().splitlines():
        r = json.loads(line)
        if r["type"] != "succeeded" or r.get("stop_reason") != "end_turn":
            dropped.append({"custom_id": r["custom_id"], "reason": r.get("stop_reason") or r["type"]})
            continue
        items = json.loads(r["text"])["items"]
        m = meta.get(r["custom_id"], {})
        specs, scen, seen = m.get("specs"), m.get("scenario"), set()
        for j, it in enumerate(items):
            rid = f"{r['custom_id']}-{j}"

            def drop(reason: str) -> None:
                dropped.append({"id": rid, "reason": reason, "utterance": it.get("utterance")})
            if leaked(it):
                dropped.append({"id": rid, "reason": "context-leak (account/machine context)"})
                continue
            sp = None
            if specs is not None:
                n = it.get("spec")
                if not isinstance(n, int) or not 1 <= n <= len(specs) or n in seen:
                    drop(f"spec {n!r} missing or repeated")
                    continue
                seen.add(n)
                sp = specs[n - 1]
                why = wording_error(it["utterance"], sp)
                if why:
                    drop(f"wording: {why}")
                    continue
            if r["custom_id"].startswith("noaction-"):
                model = r["custom_id"].split("-", 1)[1].rsplit("-", 1)[0]
                doc_type = next(o["docType"] for o in ctx.values() if o["model"] == model)
                rows.append({"id": rid, "utterance": it["utterance"], "docType": doc_type, "op": None,
                             "meta": {"batch": r["custom_id"], "kind": it["kind"], **({"spec": sp} if sp else {})}})
                continue
            key = r["custom_id"][4:].rsplit("-", 1)[0].replace("--", ":")
            op = ctx[key]
            args = {k: v for k, v in it.get("args", {}).items() if v is not None}
            why = grounded(args, it["utterance"], op["modelSchema"], it["evidence"])
            if why:
                drop(why)
                continue
            if sp and sp.get("name"):
                who = person_value(key, args)
                if who and not set(who.lower().split()) & set(sp["name"].lower().split()):
                    drop(f"person {who!r} is not the spec's name")
                    continue
            row = {"id": rid, "utterance": it["utterance"], "docType": op["docType"], "op": key,
                   "args": args, "meta": {"batch": r["custom_id"], "style": it.get("style"),
                                          **({"spec": sp} if sp else {})}}
            if scen:
                assigned = scen["items"][sp["n"] - 1]
                why = ref_mismatch(it.get("refs", {}), assigned["labels"])
                if why:
                    drop(f"ref-mismatch: {why}")
                    continue
                row["args"] = {**{p: v for p, v in assigned["refs"].items() if v is not None}, **args}
                row["fixture"] = scen["fixture"]
                row["refCandidates"] = scen["refCandidates"]
                row["refContext"] = scen["refContext"]
                row["meta"].update(refPosition=assigned["position"], theme=scen["theme"], state=scen["state"])
            elif key in FIXTURES:
                row["fixture"] = FIXTURES[key]
            rows.append(row)
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    summary = {"rows": len(rows), "dropped": len(dropped), "droppedDetail": dropped}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({**summary, "droppedDetail": dropped[:20]}, ensure_ascii=False))
    return 0


LABEL_SYSTEM = ("You label chat messages for a document app. Given one message and the candidate operations, "
                "pick the single operation the user wants, or \"none\" if it needs no document change, "
                "and give its arguments copied verbatim from the message.")
LABEL_BATCH_SYSTEM = ("You label chat messages for a document app. Label each message on its own: pick the single "
                      "operation the user wants, or \"none\" if it needs no document change, and give its arguments "
                      "copied verbatim from the message. A choice field names an existing item: give that item's "
                      "exact label as shown in the message's document state.")


def label_listing(ctx: dict, cands: list[str], with_choices: bool) -> str:
    lines = []
    for k in cands:
        o = ctx[k]
        line = f"- {k}: {o['description'] or o['opName']} args={json.dumps(o['modelSchema'].get('properties', {}))}"
        refs = [f.split(" ")[0] for f in o["appFilledFields"] if f.endswith("(ref-id)")]
        if with_choices and refs:
            line += f" choice fields: {', '.join(refs)}"
        lines.append(line)
    return "\n".join(lines)


def state_lines(row: dict | None) -> str:
    """The document state the row was written against (the listing the
    teacher saw), never the gold op's own choice list, so the op stays blind."""
    if row is None:
        return ""
    state = (row.get("meta") or {}).get("state")
    body = "\n".join(f"    {l}" for l in state.splitlines()) if state else "    no listed items"
    return f"\n  Document state:\n{body}"


def cmd_label(a) -> int:
    """Blind second pass. --batch 1: one message per call (pilot 1's format).
    --batch N: N messages of one docType per call, shuffled, keyed m1..mN
    (row ids name the generation op, so they never reach the labeler)."""
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    rows: dict[str, dict] = {}
    if a.rows:
        for line in Path(a.rows).read_text().splitlines():
            row = json.loads(line)
            rows[row["id"]] = row
    stateful = any(r.get("refContext") is not None for r in rows.values())
    states = (lambda rid: state_lines(rows.get(rid))) if stateful else (lambda rid: "")  # noqa: E731
    steps = []
    for line in Path(a.rendered).read_text().splitlines():
        st = json.loads(line)
        if st["step"] != 1:
            continue
        cands = st["candidates"]
        if st.get("skip") == "gold-not-retrieved":
            # Gold is outside the top k: label over every op of the document type
            # so the blind pass can still confirm the op and args (for step 2).
            doc_type = ctx[st["op"]]["docType"]
            cands = [k for k, o in ctx.items() if o["docType"] == doc_type]
        utt = st["messages"][-1]["content"].rsplit("Request: ", 1)[-1]
        steps.append((st["id"], tuple(cands), utt))
    reqs, keys = [], {}
    if a.batch <= 1:
        for rid, cands, utt in steps:
            schema = {"type": "object", "properties": {
                "op": {"type": "string", "enum": [*cands, "none"]},
                "args_json": {"type": "string"}}, "required": ["op", "args_json"], "additionalProperties": False}
            reqs.append(request(f"label-{rid}", LABEL_SYSTEM,
                                f"Candidates:\n{label_listing(ctx, list(cands), stateful)}\n\n"
                                f"Message: {utt}{states(rid)}\n\n"
                                "args_json is a JSON object of the chosen operation's arguments ({} for none).",
                                schema, "low", 4000))
    else:
        rng = random.Random(a.seed)
        groups: dict[tuple, list] = {}
        for st in steps:
            groups.setdefault(st[1], []).append(st)
        for gi, (cands, members) in enumerate(groups.items()):
            members = rng.sample(members, len(members))
            n_batches = -(-len(members) // a.batch)
            for bi in range(n_batches):
                chunk = members[bi::n_batches]  # even sizes
                cid = f"labelb-{gi}-{bi}"
                keys[cid] = {f"m{j + 1}": rid for j, (rid, _, _) in enumerate(chunk)}
                msgs = "\n".join(f"[m{j + 1}] {utt}{states(rid)}" for j, (rid, _, utt) in enumerate(chunk))
                one = {"type": "object", "properties": {
                    "op": {"type": "string", "enum": [*cands, "none"]}, "args_json": {"type": "string"}},
                    "required": ["op", "args_json"], "additionalProperties": False}
                schema = {"type": "object", "properties": {k: one for k in keys[cid]},
                          "required": list(keys[cid]), "additionalProperties": False}
                reqs.append(request(cid, LABEL_BATCH_SYSTEM,
                                    f"Candidates:\n{label_listing(ctx, list(cands), stateful)}\n\n"
                                    f"Messages (each is independent):\n{msgs}\n\n"
                                    "For each message key, args_json is a JSON object of the chosen operation's "
                                    "arguments ({} for none).", schema, "low", 8000))
        Path(a.out + ".keys.json").write_text(json.dumps(keys, indent=1) + "\n")
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in reqs))
    leaks = prompt_leaks([r["params"]["messages"][0]["content"] for r in reqs])
    in_tok = sum(est_tokens(r["params"]["system"] + r["params"]["messages"][0]["content"]) for r in reqs)
    print(json.dumps({"requests": len(reqs), "rows": len(steps), "inputTokensEstimate": in_tok,
                      "evalUtterancesInPrompts": leaks}))
    return 5 if leaks else 0


def read_labels(results: str, keys_file: str | None) -> dict[str, dict]:
    keys = json.loads(Path(keys_file).read_text()) if keys_file else {}
    labels = {}
    for line in Path(results).read_text().splitlines():
        r = json.loads(line)
        if r["type"] != "succeeded":
            continue
        t = json.loads(r["text"])
        if r["custom_id"].startswith("label-"):
            labels[r["custom_id"].removeprefix("label-")] = t
        else:
            for k, v in t.items():
                labels[keys[r["custom_id"]][k]] = v
    return labels


def label_args(lab: dict | None, row: dict) -> dict | None:
    """The labeler's args with choice labels mapped back to ids."""
    try:
        args = json.loads(lab["args_json"]) if lab else None
    except json.JSONDecodeError:
        return None
    if not isinstance(args, dict):
        return None
    args = {k: v for k, v in args.items() if v is not None}
    for path, cands in (row.get("refCandidates") or {}).items():
        ids = {c["label"]: c["id"] for c in cands}
        if path in args:
            v = args[path]
            args[path] = [ids.get(x, x) for x in v] if isinstance(v, list) else ids.get(v, v)
    return args


def norm_val(v: object) -> object:
    if isinstance(v, str):
        return v.strip().rstrip(".!?").lower()
    if isinstance(v, list):
        return [norm_val(x) for x in v]
    if isinstance(v, dict):
        return {k: norm_val(x) for k, x in v.items()}
    return v


def args_equal(got: dict | None, gold: dict, tolerant: bool = False) -> bool:
    if got is None:
        return False
    g, w = dict(got), dict(gold)
    for d in (g, w):  # a dependency set has no order
        if isinstance(d.get("dependencies"), list):
            d["dependencies"] = sorted(d["dependencies"])
    return norm_val(g) == norm_val(w) if tolerant else g == w


def wording_quota(rows: list[dict], ctx: dict) -> tuple[list[dict], list[str], list[str]]:
    """Per op, at most as many op-word rows as op-word-free ones (MIN_AVOID
    0.5); each pool name in at most 2 kept utterances. Rows with no spec
    (pilot 1) pass through."""
    by_op: dict[str, list[dict]] = {}
    for r in rows:
        if r["op"] and (r.get("meta") or {}).get("spec"):
            by_op.setdefault(r["op"], []).append(r)
    drop: set[str] = set()
    for key, rs in by_op.items():
        words = op_words(ctx[key]["opName"])
        withw = [r for r in rs if uses_op_words(r["utterance"], words)]
        free = len(rs) - len(withw)
        excess = len(withw) - int(free * (1 - MIN_AVOID) / MIN_AVOID)
        drop |= {r["id"] for r in withw[len(withw) - excess:]} if excess > 0 else set()
    quota = sorted(drop)
    seen: dict[str, int] = {}
    cap = []
    for r in rows:
        if r["id"] in drop:
            continue
        name = ((r.get("meta") or {}).get("spec") or {}).get("name")
        if name and any(t.lower() in r["utterance"].lower() for t in name.split()):
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 2:
                cap.append(r["id"])
                drop.add(r["id"])
    return [r for r in rows if r["id"] not in drop], quota, cap


def cmd_agree(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())} if a.context else {}
    labels = read_labels(a.results, a.keys)
    # A row whose step-2 target the runtime grammar rejects (r6.1's safe gate
    # drops a meant-but-unnamed optional field) is not trainable as a pair.
    gated = set()
    if a.manifest:
        gated = {k.rsplit("#", 1)[0] for k in json.loads(Path(a.manifest).read_text())["targetRejected"]}
    kept, disagree, gate = [], [], []
    tolerant = 0
    for line in Path(a.rows).read_text().splitlines():
        row = json.loads(line)
        if row["id"] in gated:
            gate.append(row["id"])
            continue
        lab = labels.get(row["id"])
        gold_op = row["op"] or "none"
        got = label_args(lab, row)
        op_ok = lab is not None and lab["op"] == gold_op
        ok = op_ok and (row["op"] is None or args_equal(got, row.get("args", {})))
        tolerant += op_ok and (row["op"] is None or args_equal(got, row.get("args", {}), True))
        (kept if ok else disagree).append(row if ok else {"id": row["id"], "gold": gold_op, "label": lab,
                                                          "on": "args" if op_ok else "op"})
    quota, cap = [], []
    if ctx:
        kept, quota, cap = wording_quota(kept, ctx)
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept))
    summary = {"kept": len(kept), "gateRejected": len(gate), "disagree": len(disagree),
               "disagreeOnOp": sum(d["on"] == "op" for d in disagree),
               "agreeTolerant(case/final punctuation)": tolerant,
               "quotaDropped": len(quota), "nameCapDropped": len(cap),
               "gateRejectedIds": gate, "quotaDroppedIds": quota, "nameCapDroppedIds": cap, "detail": disagree}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({**summary, "detail": disagree[:20]}, ensure_ascii=False))
    return 0


def cmd_mix(a) -> int:
    """Observed wording mix and ref-position spread of a rows file."""
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    rows = [json.loads(l) for l in Path(a.rows).read_text().splitlines() if l.strip()]
    act = [r for r in rows if r["op"]]
    free = {r["id"] for r in act if not uses_op_words(r["utterance"], op_words(ctx[r["op"]]["opName"]))}
    per_op: dict[str, list[int]] = {}
    for r in act:
        per_op.setdefault(r["op"], [0, 0])
        per_op[r["op"]][0] += r["id"] in free
        per_op[r["op"]][1] += 1
    words = [len(r["utterance"].split()) for r in rows]
    bucket = lambda n: next(k for k, (lo, hi) in LENGTHS.items() if n <= hi) if n <= 50 else "over 50"  # noqa: E731
    specs = [(r.get("meta") or {}).get("spec") or {} for r in rows]
    names = [sp.get("name") for sp, r in zip(specs, rows)
             if sp.get("name") and any(t.lower() in r["utterance"].lower() for t in sp["name"].split())]
    firsts: dict[str, int] = {}
    for r in rows:
        for w in re.findall(r"\b[A-Z][a-z]+\b", r["utterance"]):
            firsts[w] = firsts.get(w, 0) + 1
    pos: dict[str, int] = {}
    ns: dict[int, int] = {}
    for r in act:
        for path, (i, n) in ((r.get("meta") or {}).get("refPosition") or {}).items():
            pos[f"{i}/{n}"] = pos.get(f"{i}/{n}", 0) + 1
            ns[i] = ns.get(i, 0) + 1
    ref_rows = [r for r in act if r.get("refContext") is not None]
    out = {
        "rows": len(rows), "actionRows": len(act), "noActionRows": len(rows) - len(act),
        "opWordFree": f"{len(free)}/{len(act)}",
        "opsBelowMinAvoid": sorted(k for k, (f, n) in per_op.items() if f / n < MIN_AVOID),
        "registerAssigned": dict(sorted({sp.get("register"): sum(1 for x in specs if x.get("register") == sp.get("register"))
                                         for sp in specs if sp}.items(), key=lambda kv: -kv[1])),
        "lengthObserved": {k: sum(1 for n in words if bucket(n) == k) for k in [*LENGTHS, "over 50"]},
        "wordsMedianMinMax": [statistics.median(words), min(words), max(words)] if words else None,
        "multiClauseAssigned": sum(1 for sp in specs if sp.get("multiClause")),
        "questions": sum(1 for r in rows if r["utterance"].rstrip().endswith("?")),
        "allLowercase": sum(1 for r in rows if r["utterance"] == r["utterance"].lower()),
        "poolNamesUsed": len(names), "distinctPoolNames": len(set(names)),
        "maxUsesOfOneName": max((names.count(n) for n in set(names)), default=0),
        "topCapitalisedWords": sorted(firsts.items(), key=lambda kv: -kv[1])[:8],
        "refRows": len(ref_rows), "refOpsKept": len({r["op"] for r in ref_rows}),
        "refPositionByIndex": dict(sorted(ns.items())), "refPositionOfN": dict(sorted(pos.items())),
        "refFirstShare": f"{ns.get(1, 0)}/{sum(ns.values())}",
    }
    if a.ref_ops:
        out["refOpsWithNoKeptRow"] = sorted(set(json.loads(Path(a.ref_ops).read_text())) - {r["op"] for r in ref_rows})
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


def cmd_redact(a) -> int:
    """Overwrite leaked account/machine terms in teacher output files with
    REDACTED, so raw artifacts do not keep them. Prints counts only."""
    terms = sorted((t for t in context_leak_terms() if t != REDACTED), key=len, reverse=True)
    for f in a.files:
        text = Path(f).read_text()
        n = 0
        for t in terms:
            text, k = re.subn(re.escape(t), REDACTED, text, flags=re.I)
            n += k
        if n:
            Path(f).write_text(text)
        print(json.dumps({"file": f, "redacted": n}))
    return 0


def cmd_labelcmp(a) -> int:
    """Agreement of two label runs on the same rows: each with the generation
    labels (gold) and with each other, exact (agree's rule) and op only."""
    rows = [json.loads(l) for l in Path(a.rows).read_text().splitlines() if l.strip()]
    la, lb = read_labels(a.a, a.a_keys), read_labels(a.b, a.b_keys)

    def same(x: dict | None, y_op: str | None, y_args: dict | None, row: dict) -> tuple[bool, bool]:
        if x is None or y_op is None:
            return False, False
        op = x["op"] == y_op
        return op, op and (y_op == "none" or args_equal(label_args(x, row), y_args))
    res = {k: [0, 0] for k in ("a~gold", "b~gold", "a~b")}
    for row in rows:
        gold = row["op"] or "none"
        A, B = la.get(row["id"]), lb.get(row["id"])
        for k, (x, y_op, y_args) in {"a~gold": (A, gold, row.get("args", {})), "b~gold": (B, gold, row.get("args", {})),
                                     "a~b": (A, B and B["op"], B and label_args(B, row))}.items():
            o, e = same(x, y_op, y_args, row)
            res[k][0] += o
            res[k][1] += e
    n = len(rows)
    out = {"rows": n, **{k: {"op": f"{o}/{n} ({o / n:.1%})", "exact": f"{e}/{n} ({e / n:.1%})"} for k, (o, e) in res.items()}}
    print(json.dumps(out, indent=2))
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
    p = sub.add_parser("run"); p.add_argument("requests"); p.add_argument("--out", required=True)
    p.add_argument("--teacher", choices=["cli", "api"], default="cli")
    p.add_argument("--concurrency", type=int, default=3)
    p.add_argument("--timeout", type=int, default=300, help="seconds per claude -p call")
    p.add_argument("--retries", type=int, default=3); p.add_argument("--backoff", type=float, default=5.0)
    p.add_argument("--max-budget-usd", type=float, default=1.0, help="per-call guard (CLI-reported cost)")
    p.add_argument("--cli-cwd", default=str(DEFAULT_CLI_CWD), help="empty dir the child runs in")
    p.add_argument("--max-requests", type=int, default=200); p.add_argument("--limit", type=int, default=0)
    p.add_argument("--yes-spend", action="store_true", help="api backend only")
    p = sub.add_parser("rows"); p.add_argument("results"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p.add_argument("--meta", help="<requests>.meta.json from plan: item specs and ref scenarios")
    p.add_argument("--no-leak-check", dest="leak_check", action="store_false",
                   help="skip dropping rows that contain the account email / user name / home dir")
    p = sub.add_parser("label"); p.add_argument("rendered"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p.add_argument("--rows", help="rows-valid.jsonl: ref choices per row"); p.add_argument("--batch", type=int, default=8)
    p.add_argument("--seed", type=int, default=7)
    p = sub.add_parser("agree"); p.add_argument("results"); p.add_argument("--rows", required=True); p.add_argument("--out", required=True)
    p.add_argument("--keys", help="<label requests>.keys.json for batched labels")
    p.add_argument("--context", help="context.json: enables the per-op wording quota and name cap")
    p.add_argument("--manifest", help="rendered.manifest.json: also drop rows with a grammar-rejected target")
    p = sub.add_parser("mix"); p.add_argument("rows"); p.add_argument("--context", required=True)
    p.add_argument("--ref-ops", help="JSON list or object of ref op keys, to list ops with no kept row")
    p = sub.add_parser("redact"); p.add_argument("files", nargs="+")
    p = sub.add_parser("labelcmp"); p.add_argument("--rows", required=True)
    p.add_argument("--a", required=True); p.add_argument("--a-keys"); p.add_argument("--b", required=True); p.add_argument("--b-keys")
    a = ap.parse_args()
    return {"plan": cmd_plan, "submit": cmd_submit, "collect": cmd_collect, "run": cmd_run, "rows": cmd_rows,
            "label": cmd_label, "agree": cmd_agree, "labelcmp": cmd_labelcmp, "redact": cmd_redact, "mix": cmd_mix}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
