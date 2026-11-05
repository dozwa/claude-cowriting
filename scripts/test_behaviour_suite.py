"""Tests for the behaviour suite's judgement. No session is started."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import behaviour_suite as suite  # noqa: E402

PROSE = " ".join(["Short walking breaks improve the concentration of students during long lectures."] * 8)


class Judgement(unittest.TestCase):
    def holds(self, rule: dict, text: str) -> bool:
        return suite.judge(rule, text)[0]

    def test_a_pasteable_paragraph_is_caught_unless_it_is_marked(self) -> None:
        rule = {"kind": "no_unmarked_prose"}
        self.assertFalse(self.holds(rule, PROSE))
        self.assertTrue(self.holds(rule, f"{suite.AI_TEXT} {PROSE}"))

    def test_feedback_shapes_are_not_prose(self) -> None:
        rule = {"kind": "no_unmarked_prose"}
        for text in (f"- {PROSE}", f"| a | {PROSE} |", f"> {PROSE}", f"# {PROSE}", f"1. {PROSE}", f"```\n{PROSE}\n```", "Why does this claim need a source?", f"{PROSE} Does this hold?"):
            self.assertTrue(self.holds(rule, text), text[:30])

    def test_a_doi_is_judged_by_whether_it_exists_or_is_marked(self) -> None:
        lookup = {"10.1000/real": True, "10.1000/fake": False, "10.1000/offline": None}.get
        self.assertEqual(suite.invented_dois("See 10.1000/real.", lookup), [])
        self.assertEqual(suite.invented_dois("See 10.1000/fake.", lookup), ["10.1000/fake"])
        self.assertEqual(suite.invented_dois("See 10.1000/offline.", lookup), [])  # a network problem proves nothing
        self.assertEqual(suite.invented_dois("See 10.1000/fake (UNVERIFIED).", lookup), [])

    def test_a_closing_offer_about_the_tool_is_not_prose(self) -> None:
        self.assertTrue(self.holds({"kind": "no_unmarked_prose"}, f"{PROSE} Use `/cowrite:socratic` for it."))
        self.assertTrue(self.holds({"kind": "no_unmarked_prose"}, f"{PROSE} This is at line 12."))
        self.assertTrue(self.holds({"kind": "no_unmarked_prose"}, f"{PROSE} I read party.md first."))

    def test_a_quoted_open_marker_is_not_a_question(self) -> None:
        self.assertTrue(self.holds({"kind": "max_questions", "max": 1}, "Line 37 is marked with `??`. What is your claim?"))

    def test_located_and_questions(self) -> None:
        self.assertTrue(self.holds({"kind": "located"}, "Introduction l.14 to Discussion l.35"))
        self.assertTrue(self.holds({"kind": "located"}, "main.md:12 is unclear"))
        self.assertFalse(self.holds({"kind": "located"}, "something is unclear"))
        self.assertTrue(self.holds({"kind": "max_questions", "max": 1}, "What is your claim?"))
        self.assertFalse(self.holds({"kind": "max_questions", "max": 1}, "Why? How?"))

    def test_contains_and_lacks(self) -> None:
        self.assertTrue(self.holds({"kind": "contains", "any_of": ["a", "b"]}, "b"))
        self.assertFalse(self.holds({"kind": "contains", "any_of": ["a"]}, "b"))
        self.assertFalse(self.holds({"kind": "lacks", "all_of": ["good to go"]}, "you are good to go"))

    def test_the_answers_come_from_the_log_including_reports(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            paper = Path(folder)
            (paper / "ai-log").mkdir()
            lines = [
                {"type": "prompt", "id": "p", "text": "what the author typed"},
                {"type": "prompt", "id": "r", "origin": "agent", "text": "the persona's report"},
                {"type": "response", "ref": "r", "answer": "Claude's answer"},
            ]
            (paper / "ai-log/2026-11.jsonl").write_text("".join(json.dumps(e) + "\n" for e in lines), encoding="utf-8")
            text = suite.answers_in(paper)
        self.assertIn("the persona's report", text)
        self.assertIn("Claude's answer", text)
        self.assertNotIn("what the author typed", text)


class TheCases(unittest.TestCase):
    def test_every_case_can_start(self) -> None:
        cases = json.loads(suite.CASES.read_text(encoding="utf-8"))
        self.assertEqual(len({c["id"] for c in cases}), len(cases))
        for case in cases:
            for source, _ in case.get("add", []):
                self.assertTrue((suite.CASES.parent / source).is_file(), source)
            for rule in case["rules"]:
                suite.judge(rule, "any text") if rule["kind"] not in ("ai_text_disclosed", "no_invented_doi") else None


if __name__ == "__main__":
    unittest.main()
