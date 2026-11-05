"""Tests for the release tracker. Run: python3 -m unittest discover -s scripts -p 'test_*.py'"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRACKER = HERE / "tracker.py"
REAL_DATA = HERE.parent / "dev/tracker.json"
REAL_DOC = HERE.parent / "docs/tracker.md"


class Tracker(unittest.TestCase):
    def setUp(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name) / "tracker.json"
        self.doc = Path(folder.name) / "tracker.md"
        # the real map with every result wiped: recording real progress must not break these tests
        data = json.loads(REAL_DATA.read_text(encoding="utf-8"))
        for f in data["features"]:
            f["status"] = {s: "untested" for s in f["status"]}
        for r in data["requirements"]:
            r["status"] = "open"
        for n in data["findings"]:
            n["status"] = "open"
        for s in data["stories"]:
            for c in s["criteria"]:
                c["status"] = "untested"
        for m in data["manual"]:
            m["status"] = "untested"
        data["history"] = []
        self.write(data)
        self.run_tool("render")

    def run_tool(self, *args: str, data: Path | None = None, doc: Path | None = None) -> subprocess.CompletedProcess:
        command = [sys.executable, str(TRACKER), "--data", str(data or self.data), "--doc", str(doc or self.doc), *args]
        return subprocess.run(command, capture_output=True, text=True)

    def read(self) -> dict:
        return json.loads(self.data.read_text(encoding="utf-8"))

    def write(self, data: dict) -> None:
        self.data.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def feature(self, item: str) -> dict:
        return next(f for f in self.read()["features"] if f["id"] == item)

    def test_the_real_tracker_is_whole_and_its_doc_current(self) -> None:
        run = self.run_tool("check", data=REAL_DATA, doc=REAL_DOC)
        self.assertEqual(run.returncode, 0, run.stdout)

    def test_a_result_changes_the_surface_the_history_and_the_doc(self) -> None:
        before = self.doc.read_text(encoding="utf-8")
        run = self.run_tool("set", "F8", "pass", "--surface", "terminal", "--by", "G", "--note", "attack list")
        self.assertEqual(run.returncode, 0, run.stderr)
        feature = self.feature("F8")
        self.assertEqual(feature["status"], {"terminal": "pass", "vscode": "untested", "desktop": "untested"})
        entry = self.read()["history"][-1]
        self.assertEqual((entry["id"], entry["surface"], entry["by"], entry["note"]), ("F8", "terminal", "G", "attack list"))
        after = self.doc.read_text(encoding="utf-8")
        self.assertNotEqual(before, after)
        self.assertIn("T ✓ V · D ·", after)
        self.assertIn("attack list", after)

    def test_a_feature_counts_as_done_only_on_all_its_surfaces(self) -> None:
        self.run_tool("set", "F8", "pass", "--surface", "terminal", "--by", "G")
        self.assertIn("F8", self.run_tool("gate", "--no-suites").stdout)
        self.run_tool("set", "F8", "pass", "--surface", "all", "--by", "G")
        self.assertNotIn("Feature F8 ", self.run_tool("gate", "--no-suites").stdout)

    def test_a_surface_is_required_where_the_feature_has_several(self) -> None:
        run = self.run_tool("set", "F8", "pass", "--by", "G")
        self.assertEqual(run.returncode, 2)
        self.assertEqual(self.run_tool("set", "F17", "pass", "--by", "E").returncode, 0)
        self.assertEqual(self.feature("F17")["status"], {"any": "pass"})

    def test_a_result_says_how_it_was_found_and_a_deferral_why(self) -> None:
        history = self.read()["history"]
        self.assertEqual(self.run_tool("set", "F17", "pass").returncode, 2)
        self.assertEqual(self.run_tool("set", "F17", "deferred").returncode, 2)
        self.assertEqual(self.run_tool("finding", "1", "accepted").returncode, 2)
        self.assertEqual(self.run_tool("set", "F999", "pass", "--by", "U").returncode, 2)
        self.assertEqual(self.run_tool("set", "R6.1", "pass").returncode, 2)  # a requirement is met, not passed
        self.assertEqual(self.read()["history"], history)  # nothing refused leaves a trace

    def settle_what_blocks(self) -> dict:
        data = self.read()
        for f in data["features"]:
            if f["tier"] in ("1", "1b"):
                f["status"] = {s: "pass" for s in f["status"]}
        for r in data["requirements"]:
            r["status"] = "met"
        for n in data["findings"]:
            n["status"] = "fixed"
        for s in data["stories"]:
            if s["tier"] in ("1", "1b"):
                for c in s["criteria"]:
                    c["status"] = "pass"
        for m in data["manual"]:
            m["status"] = "pass"
        self.write(data)
        return data

    def test_the_gate_names_what_blocks_and_real_use_is_part_of_it(self) -> None:
        run = self.run_tool("gate", "--no-suites")
        self.assertEqual(run.returncode, 1)
        for part in ("Feature F8 ", "Feature F2 ", "Requirement R6.1 ", "Finding 1 ", "Criterion S7.1 ", "Manual run M-vscode ", "Manual run H-paper ", "Manual run H-thinkaloud "):
            self.assertIn(part, run.stdout)

    def test_tier_1_must_work_tier_2_should_and_tier_3_may_wait(self) -> None:
        data = self.settle_what_blocks()
        run = self.run_tool("gate", "--no-suites")
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertIn("Tier 2 should work", run.stdout)
        self.assertIn("F1 Install", run.stdout)  # a tier 2 gap is named, not hidden
        self.assertIn("S10.1", run.stdout)
        self.assertIn("Tier 3 not yet confirmed", run.stdout)
        self.assertIn("not a release verdict", run.stdout)

        f8 = next(f for f in data["features"] if f["id"] == "F8")
        f8["status"]["vscode"] = "fail"
        self.write(data)
        self.assertEqual(self.run_tool("gate", "--no-suites").returncode, 1)
        f8["status"] = {s: "deferred" for s in f8["status"]}
        self.write(data)
        run = self.run_tool("gate", "--no-suites")
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertIn("Deferred, to be named in the changelog: F8", run.stdout)

    def test_check_finds_what_is_missing_or_unknown(self) -> None:
        data = self.read()
        data["features"][1]["skills"] = []  # init is now in no feature
        data["features"][1]["reqs"] = ["R99"]
        data["stories"][0]["features"].append("F99")
        data["features"][2]["id"] = "F1"
        self.write(data)
        self.run_tool("render")
        out = self.run_tool("check").stdout
        for part in ("The skill init is in the plugin", "unknown requirement R99", "unknown feature F99", "F1 is used twice"):
            self.assertIn(part, out)

    def test_check_finds_a_doc_that_is_behind_the_data(self) -> None:
        self.assertEqual(self.run_tool("check").returncode, 0)
        data = self.read()
        data["features"][0]["name"] = "Renamed by hand"
        self.write(data)
        run = self.run_tool("check")
        self.assertEqual(run.returncode, 1)
        self.assertIn("not current", run.stdout)

    def test_a_tier_can_change_without_touching_results(self) -> None:
        self.assertEqual(self.run_tool("tier", "F48", "1").returncode, 0)
        self.assertEqual(self.feature("F48")["tier"], "1")
        self.assertEqual(self.run_tool("tier", "F48", "7").returncode, 2)


if __name__ == "__main__":
    unittest.main()
