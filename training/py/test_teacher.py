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


if __name__ == "__main__":
    unittest.main()
