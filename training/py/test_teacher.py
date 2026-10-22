"""Unit tests for the teacher's batching, list parsing and per-item checks.

    training/.venv/bin/python -m unittest training/py/test_teacher.py

Stdlib only; no `claude` call, no tsx (the leak check is off in `rows`).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import teacher as t  # noqa: E402

OP = {
    "key": "wbs:SET_OWNER", "opName": "SET_OWNER", "model": "wbs", "docType": "powerhouse/wbs",
    "modelSchema": {"type": "object", "properties": {"owner": {"type": "string"}}, "required": ["owner"]},
}


class CallSpecs(unittest.TestCase):
    def setUp(self) -> None:
        self.specs = t.item_specs(random.Random(1), 25, "SET_GOAL_STATUS", [f"P{i}" for i in range(25)], 0.6)

    def test_every_batch_size_sends_the_same_specs(self) -> None:
        by_size = {}
        for size in (1, 10, 25):
            calls = t.call_specs(self.specs, size)
            self.assertEqual([len(c) for c in calls], {1: [1] * 25, 10: [10, 10, 5], 25: [25]}[size])
            by_size[size] = {sp["i"]: {k: v for k, v in sp.items() if k != "n"} for c in calls for sp in c}
        self.assertEqual(by_size[1], by_size[10])
        self.assertEqual(by_size[1], by_size[25])
        self.assertEqual(sorted(by_size[1]), list(range(1, 26)))

    def test_numbers_restart_per_call(self) -> None:
        for c in t.call_specs(self.specs, 10):
            self.assertEqual([sp["n"] for sp in c], list(range(1, len(c) + 1)))
        self.assertEqual(t.call_specs(self.specs, 10)[2][0]["i"], 21)

    def test_rejects_size_zero(self) -> None:
        with self.assertRaises(ValueError):
            t.call_specs(self.specs, 0)


class TwoSidedSpecs(unittest.TestCase):
    def test_avoid_and_use_shares(self) -> None:
        specs = t.item_specs(random.Random(2), 25, "SET_GOAL_STATUS", [], 0.6)
        self.assertEqual(sum("avoid" in s for s in specs), 15)
        self.assertEqual(sum("use" in s for s in specs), 10)
        self.assertFalse(any("avoid" in s and "use" in s for s in specs))
        self.assertEqual(sum(s["form"] == "question" for s in specs), round(25 * t.QUESTION_SHARE))
        self.assertNotIn("a question", {s["register"] for s in specs})
        text = t.spec_text(next(s for s in specs if "use" in s))
        self.assertIn('at least one of these words (or a form of it): "goal", "status"', text)

    def test_no_action_specs_have_no_word_rules(self) -> None:
        specs = t.item_specs(random.Random(3), 10, None, [], 0.6)
        self.assertFalse(any({"avoid", "use", "form"} & set(s) for s in specs))

    def test_legacy_specs_unchanged(self) -> None:
        specs = t.item_specs(random.Random(4), 4, "SET_OWNER", [])
        self.assertEqual(sum("avoid" in s for s in specs), 3)
        self.assertFalse(any("use" in s or "form" in s for s in specs))


class Quota(unittest.TestCase):
    ctx = {"wbs:SET_OWNER": OP}

    def rows(self, n_free: int, n_word: int) -> list[dict]:
        sp = {"n": 1, "register": "casual", "length": "short", "multiClause": False, "name": None}
        free = [{"id": f"f{i}", "op": "wbs:SET_OWNER", "utterance": f"give it to Ann {i}", "meta": {"spec": sp}}
                for i in range(n_free)]
        word = [{"id": f"w{i}", "op": "wbs:SET_OWNER", "utterance": f"owner is Ann {i}", "meta": {"spec": sp}}
                for i in range(n_word)]
        return free + word

    def test_ceiling_drops_excess_free_rows(self) -> None:
        kept, dropped, _ = t.wording_quota(self.rows(10, 3), self.ctx, max_free=0.7)
        self.assertEqual(len([r for r in kept if r["id"].startswith("f")]), 7)  # 7 / 10 = 0.7
        self.assertEqual(dropped, ["f7", "f8", "f9"])

    def test_floor_still_applies(self) -> None:
        kept, dropped, _ = t.wording_quota(self.rows(2, 5), self.ctx, max_free=0.7)
        self.assertEqual(sorted(dropped), ["w2", "w3", "w4"])
        self.assertEqual(len(kept), 4)

    def test_one_sided_by_default(self) -> None:
        kept, dropped, _ = t.wording_quota(self.rows(10, 0), self.ctx)
        self.assertEqual((len(kept), dropped), (10, []))

    def test_name_cap(self) -> None:
        rows = self.rows(5, 0)
        for r in rows:
            r["meta"]["spec"] = {**r["meta"]["spec"], "name": "Ann Lee"}
        self.assertEqual(len(t.wording_quota(rows, self.ctx, name_cap=2)[0]), 2)
        self.assertEqual(len(t.wording_quota(rows, self.ctx, name_cap=None)[0]), 5)


def spec(n: int, **kw) -> dict:
    return {"n": n, "i": n, "register": "casual", "length": "short", "multiClause": False, "name": None, **kw}


class Rows(unittest.TestCase):
    """`rows` on a fake results file: list parsing and per-item validation."""

    def run_rows(self, results: list[dict], meta: dict) -> tuple[list[dict], dict]:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "ctx.json").write_text(json.dumps([OP]))
            (p / "meta.json").write_text(json.dumps(meta))
            (p / "res.jsonl").write_text("".join(json.dumps(r) + "\n" for r in results))
            a = argparse.Namespace(results=str(p / "res.jsonl"), context=str(p / "ctx.json"), out=str(p / "rows.jsonl"),
                                   meta=str(p / "meta.json"), leak_check=False)
            with open(p / "stdout.txt", "w") as so:
                old, sys.stdout = sys.stdout, so
                try:
                    self.assertEqual(t.cmd_rows(a), 0)
                finally:
                    sys.stdout = old
            rows = [json.loads(l) for l in (p / "rows.jsonl").read_text().splitlines()]
            return rows, json.loads((p / "rows.jsonl.summary.json").read_text())

    @staticmethod
    def ok(cid: str, items: list) -> dict:
        return {"custom_id": cid, "type": "succeeded", "stop_reason": "end_turn", "text": json.dumps({"items": items})}

    @staticmethod
    def item(n: object, utt: str, owner: str) -> dict:
        return {"spec": n, "utterance": utt, "args": {"owner": owner}, "evidence": [{"field": "owner", "span": owner}]}

    def test_list_parsing_and_item_checks(self) -> None:
        cid = "gen-wbs--SET_OWNER-0"
        meta = {cid: {"specs": [spec(1), spec(2), spec(3), spec(4, avoid=["owner"])]},
                "gen-wbs--SET_OWNER-1": {"specs": [spec(1)]},
                "gen-wbs--SET_OWNER-2": {"specs": [spec(1)]}}
        results = [
            self.ok(cid, [
                self.item(1, "hand this one over to Ann Lee", "Ann Lee"),     # kept
                self.item(1, "Ann Lee should take this one", "Ann Lee"),      # spec repeated
                self.item(9, "please give it to Bo Chen now", "Bo Chen"),     # spec out of range
                self.item(4, "make Cy Diaz the owner of it", "Cy Diaz"),      # avoid word used
                self.item(3, "give it to Dee", "Eve"),                        # arg not in utterance
                "not an object",
            ]),
            {"custom_id": "gen-wbs--SET_OWNER-1", "type": "errored", "error": "timeout"},
            {"custom_id": "gen-wbs--SET_OWNER-2", "type": "succeeded", "stop_reason": "end_turn", "text": "{not json"},
        ]
        rows, summary = self.run_rows(results, meta)
        self.assertEqual([r["id"] for r in rows], [f"{cid}-0"])
        self.assertEqual(rows[0]["args"], {"owner": "Ann Lee"})
        self.assertEqual(rows[0]["meta"]["spec"]["i"], 1)
        reasons = [d["reason"] for d in summary["droppedDetail"]]
        self.assertEqual(reasons[:5], ["spec 1 missing or repeated", "spec 9 missing or repeated",
                                       "wording: op word 'owner' in an avoid item", "owner: value not in utterance",
                                       "item is not an object with an utterance"])
        self.assertEqual(reasons[5], "errored")
        self.assertTrue(reasons[6].startswith("unparseable result"))
        self.assertEqual((summary["calls"], summary["itemsRequested"], summary["itemsReturned"]), (3, 6, 6))
        self.assertEqual(sorted(summary["shortCalls"]), ["gen-wbs--SET_OWNER-1", "gen-wbs--SET_OWNER-2"])

    def test_short_list_is_reported(self) -> None:
        cid = "gen-wbs--SET_OWNER-0"
        meta = {cid: {"specs": [spec(1), spec(2), spec(3)]}}
        rows, summary = self.run_rows([self.ok(cid, [self.item(2, "pass it to Ann Lee", "Ann Lee")])], meta)
        self.assertEqual(len(rows), 1)
        self.assertEqual(summary["shortCalls"], {cid: {"requested": 3, "returned": 1}})


class UsageLimitDetection(unittest.TestCase):
    def test_spend_and_session_limit_messages_stop_the_run(self) -> None:
        for msg in ["You've hit your org's monthly spend limit · your session limit resets 3pm",
                    "usage limit reached", "Claude AI usage limit reached|1700000000", "limit resets at 5pm"]:
            self.assertTrue(t.LIMIT_RE.search(msg), msg)
        self.assertFalse(t.LIMIT_RE.search("schema: $.items[0].spec: required"))


class DedupContainment(unittest.TestCase):
    def test_eval_utterance_inside_a_longer_row_is_a_leak(self) -> None:
        import dedup
        ev = [{"utterance": "Mark this source as extracted", "source": "x.json", "id": "e1",
               "norm": dedup.normalize("Mark this source as extracted")}]
        for e in ev:
            e["c3"], e["w3"] = dedup.char_trigrams(e["norm"]), dedup.word_trigrams(e["norm"])
        row = dedup.normalize("can you mark this source as extracted? Camille just finished pulling claims "
                              "out of it while I was debugging the ingestion pipeline")
        self.assertEqual(dedup.leak_hit(row, ev)["contained"], True)
        self.assertIsNone(dedup.leak_hit(dedup.normalize("please remark this source as extractedness soon, "
                                                         "after lunch with the whole team"), ev))
        self.assertFalse(dedup.contains("set it to done", "done"))  # under 3 words


class PerCallStates(unittest.TestCase):
    """`plan --batch-size`: one freshly seeded state per call for ref ops."""

    REF = {**OP, "key": "wbs:SET_GOAL_STATUS", "opName": "SET_GOAL_STATUS",
           "modelSchema": {"type": "object", "properties": {"status": {"type": "string"}}, "required": ["status"]},
           "siblings": [], "description": "", "inputSdl": "", "appFilledFields": [], "reducerSource": "", "emptyState": {}}
    NONREF = {**REF, "key": "wbs:SET_OWNER", "opName": "SET_OWNER",
              "modelSchema": {"type": "object", "properties": {"owner": {"type": "string"}}, "required": ["owner"]}}

    def plan(self, shared: bool, ref_items: int = 25) -> tuple[list[dict], list[dict], dict]:
        sent: list[list[dict]] = []

        def fake_tsx(script: str, spec_file: str, out_file: str) -> str:
            spec = json.loads(Path(spec_file).read_text())
            sent.append(spec)
            Path(out_file).write_text(json.dumps([{
                "cid": s["cid"], "op": s["op"], "docType": "powerhouse/wbs", "theme": f"theme-{s['seed']}",
                "fixture": [], "refContext": [], "state": f"state seeded {s['seed']}",
                "refCandidates": {"id": [{"id": "g1", "label": "A"}, {"id": "g2", "label": "B"}]},
                "items": [{"refs": {"id": "g1"}, "labels": {"id": "A"}, "position": {"id": [1, 2]}}
                          for _ in range(s["items"])]} for s in spec]))
            return ""
        old, t.tsx = t.tsx, fake_tsx
        try:
            with tempfile.TemporaryDirectory() as d:
                ctx = {"wbs:SET_GOAL_STATUS": self.REF, "wbs:SET_OWNER": self.NONREF}
                a = argparse.Namespace(ops="wbs:SET_GOAL_STATUS,wbs:SET_OWNER", batch_size=10, items_per_op=12,
                                       ref_items_per_op=ref_items, noaction_items=0, seed=5, avoid_share=0.6,
                                       shared_state=shared, out=str(Path(d) / "req.jsonl"))
                with open(Path(d) / "stdout.txt", "w") as so:
                    o, sys.stdout = sys.stdout, so
                    try:
                        t.plan_batched(a, ctx, {"wbs:SET_GOAL_STATUS": ["id"]}, [f"P{i}" for i in range(40)])
                    finally:
                        sys.stdout = o
                reqs = [json.loads(l) for l in Path(a.out).read_text().splitlines()]
                meta = json.loads(Path(a.out + ".meta.json").read_text())
        finally:
            t.tsx = old
        return sent[0], reqs, meta

    def test_each_call_gets_its_own_state(self) -> None:
        spec, reqs, meta = self.plan(shared=False)
        ref_calls = [c for c in meta if c.startswith("gen-wbs--SET_GOAL_STATUS")]
        self.assertEqual(len(ref_calls), 3)  # 25 items at batch 10: 10, 10, 5
        self.assertEqual([s["cid"] for s in spec], ref_calls)
        self.assertEqual([s["items"] for s in spec], [10, 10, 5])
        self.assertEqual(len({s["seed"] for s in spec}), 3)
        for c in ref_calls:
            sc = meta[c]["scenario"]
            self.assertEqual(sc["cid"], c)
            self.assertEqual(len(sc["items"]), len(meta[c]["specs"]))
        users = [r["params"]["messages"][0]["content"] for r in reqs if r["custom_id"] in ref_calls]
        self.assertEqual(len({u.split("Current document state")[1].splitlines()[1] for u in users}), 3)
        self.assertEqual(sum(len(meta[c]["specs"]) for c in meta if c.startswith("gen-wbs--SET_OWNER")), 12)

    def test_seeds_depend_on_seed_job_and_call_only(self) -> None:
        a, _, _ = self.plan(shared=False)
        b, _, _ = self.plan(shared=False)
        self.assertEqual(a, b)
        c, _, _ = self.plan(shared=False, ref_items=30)  # more calls: the first three keep their seeds
        self.assertEqual([s["seed"] for s in c[:3]], [s["seed"] for s in a])

    def test_shared_state_keeps_one_state_per_job(self) -> None:
        spec, _, meta = self.plan(shared=True)
        self.assertEqual([(s["cid"], s["items"]) for s in spec], [("gen-wbs--SET_GOAL_STATUS", 25)])
        states = {meta[c]["scenario"]["state"] for c in meta if c.startswith("gen-wbs--SET_GOAL_STATUS")}
        self.assertEqual(len(states), 1)


class AgreeStep1Only(unittest.TestCase):
    """`agree --step1-only`: op-agreed rows with an untrainable step 2 stay as step-1 rows."""

    def test_reasons_and_drops(self) -> None:
        rows = [
            {"id": "r-gate", "op": "wbs:SET_OWNER", "utterance": "give it to Ann", "args": {"owner": "Ann"}},
            {"id": "r-args", "op": "wbs:SET_OWNER", "utterance": "hand it to Bo", "args": {"owner": "Bo"}},
            {"id": "r-op", "op": "wbs:SET_OWNER", "utterance": "Cy takes it", "args": {"owner": "Cy"}},
            {"id": "r-ok", "op": "wbs:SET_OWNER", "utterance": "Dee owns it", "args": {"owner": "Dee"}},
        ]
        labels = {"r-gate": ("wbs:SET_OWNER", {"owner": "Ann"}), "r-args": ("wbs:SET_OWNER", {"owner": "Bob"}),
                  "r-op": ("wbs:ASSIGN_GOAL", {}), "r-ok": ("wbs:SET_OWNER", {"owner": "Dee"})}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "rows.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
            (p / "labels.jsonl").write_text("".join(json.dumps({
                "custom_id": f"label-{rid}", "type": "succeeded", "stop_reason": "end_turn",
                "text": json.dumps({"op": op, "args_json": json.dumps(args)})}) + "\n" for rid, (op, args) in labels.items()))
            (p / "manifest.json").write_text(json.dumps({"targetRejected": ["r-gate#2"]}))
            a = argparse.Namespace(results=str(p / "labels.jsonl"), keys=None, rows=str(p / "rows.jsonl"),
                                   manifest=str(p / "manifest.json"), context=None, max_free=1.0, name_cap=0,
                                   step1_only=True, out=str(p / "agreed.jsonl"))
            with open(p / "stdout.txt", "w") as so:
                old, sys.stdout = sys.stdout, so
                try:
                    t.cmd_agree(a)
                finally:
                    sys.stdout = old
            kept = [json.loads(l) for l in (p / "agreed.jsonl").read_text().splitlines()]
        self.assertEqual([(r["id"], r.get("step1Only")) for r in kept],
                         [("r-ok", None), ("r-gate", "grammar-gate"), ("r-args", "args-disagree")])


if __name__ == "__main__":
    unittest.main()
