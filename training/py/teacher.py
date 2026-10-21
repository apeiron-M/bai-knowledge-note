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
- Vary wording, length and register as instructed; never quote the operation name or copy its description.
- Free-text argument values must be copied verbatim (same casing) from the message; put each one in `evidence` with the exact span.
- Include an optional argument only if the message clearly states it.
- Enum arguments must be one of the listed values, and the message must imply that value unambiguously.
- The message must not be better served by any sibling operation.
- Invent every name, email, date and detail. Never use anything from account, machine or date context you may have been given."""

NO_ACTION_SYSTEM = """You write training data for a small on-device model in a personal knowledge vault app. Write chat messages that must NOT change the open document: questions about it, comments, thanks, or requests no listed operation can do. Make them realistic and close to real edit requests in wording, so the model learns the boundary. Invent every name, email, date and detail; never use anything from account, machine or date context you may have been given."""


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
    item_props = {"utterance": {"type": "string"}, "style": {"type": "string"}}
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
        "properties": {"utterance": {"type": "string"},
                       "kind": {"type": "string", "enum": ["question", "comment", "out-of-catalog"]}},
        "required": ["utterance", "kind"], "additionalProperties": False}}},
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
           "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
           "overSchemaLimits": sorted({r["custom_id"].rsplit("-", 1)[0] for r in reqs
                                       if (lambda o, u: o > 24 or u > 16)(*schema_load(r["params"]["output_config"]["format"]["schema"]))})}
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


def context_leak_terms() -> list[str]:
    """Strings Claude Code puts in the teacher's context that no flag removes
    (the account email; the user name and home dir in the environment block).
    A row that contains one is dropped by `rows`."""
    terms = set()
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
        for j, it in enumerate(items):
            rid = f"{r['custom_id']}-{j}"
            if leaked(it):
                dropped.append({"id": rid, "reason": "context-leak (account/machine context)"})
                continue
            if r["custom_id"].startswith("noaction-"):
                model = r["custom_id"].split("-", 1)[1].rsplit("-", 1)[0]
                doc_type = next(o["docType"] for o in ctx.values() if o["model"] == model)
                rows.append({"id": rid, "utterance": it["utterance"], "docType": doc_type, "op": None,
                             "meta": {"batch": r["custom_id"], "kind": it["kind"]}})
                continue
            key = r["custom_id"][4:].rsplit("-", 1)[0].replace("--", ":")
            op = ctx[key]
            args = {k: v for k, v in it.get("args", {}).items() if v is not None}
            why = grounded(args, it["utterance"], op["modelSchema"], it["evidence"])
            if why:
                dropped.append({"id": rid, "reason": why, "utterance": it["utterance"]})
                continue
            row = {"id": rid, "utterance": it["utterance"], "docType": op["docType"], "op": key,
                   "args": args, "meta": {"batch": r["custom_id"], "style": it["style"]}}
            if key in FIXTURES:
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


def cmd_label(a) -> int:
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    reqs = []
    for line in Path(a.rendered).read_text().splitlines():
        s = json.loads(line)
        if s["step"] != 1:
            continue
        cands = s["candidates"]
        if s.get("skip") == "gold-not-retrieved":
            # Gold is outside BM25's top k: label over every op of the document type
            # so the blind pass can still confirm the op and args (for step 2).
            doc_type = ctx[s["op"]]["docType"]
            cands = [k for k, o in ctx.items() if o["docType"] == doc_type]
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
    # A row whose step-2 target the runtime grammar rejects (r6.1's safe gate
    # drops a meant-but-unnamed optional field) is not trainable as a pair.
    gated = set()
    if a.manifest:
        gated = {k.rsplit("#", 1)[0] for k in json.loads(Path(a.manifest).read_text())["targetRejected"]}
    kept, disagree, gate = [], [], []
    for line in Path(a.rows).read_text().splitlines():
        row = json.loads(line)
        if row["id"] in gated:
            gate.append(row["id"])
            continue
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
    summary = {"kept": len(kept), "gateRejected": len(gate), "disagree": len(disagree),
               "gateRejectedIds": gate, "detail": disagree}
    Path(a.out + ".summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({**summary, "detail": disagree[:20]}, ensure_ascii=False))
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
    p.add_argument("--no-leak-check", dest="leak_check", action="store_false",
                   help="skip dropping rows that contain the account email / user name / home dir")
    p = sub.add_parser("label"); p.add_argument("rendered"); p.add_argument("--context", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("agree"); p.add_argument("results"); p.add_argument("--rows", required=True); p.add_argument("--out", required=True)
    p.add_argument("--manifest", help="rendered.manifest.json: also drop rows with a grammar-rejected target")
    a = ap.parse_args()
    return {"plan": cmd_plan, "submit": cmd_submit, "collect": cmd_collect, "run": cmd_run, "rows": cmd_rows,
            "label": cmd_label, "agree": cmd_agree}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
