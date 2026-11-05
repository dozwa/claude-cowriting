"""Tests for the throwaway copies. No session is started: every run is a dry run.

That the session stays inside its copy is a behaviour only a real session can show: see
the g0-containment case in dev/attacks/cases.json.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "throwaway_session.py"
REPO = HERE.parent


def tree(folder: Path) -> dict[str, bytes]:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob("*") if p.is_file()}


class DryRun(unittest.TestCase):
    def dry(self, *args: str) -> Path:
        run = subprocess.run([sys.executable, str(RUNNER), "--dry-run", *args], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        paper = Path(json.loads(run.stdout)["paper"])
        self.addCleanup(shutil.rmtree, paper.parent, True)
        return paper

    def test_every_run_gets_a_new_copy_outside_the_repository(self) -> None:
        one, two = self.dry("p").resolve(), self.dry("p").resolve()
        self.assertNotEqual(one, two)
        for paper in (one, two):
            self.assertFalse(paper.is_relative_to(REPO))
            self.assertTrue((paper / "paper.json").exists())

    def test_changing_the_copy_leaves_the_demo_as_it_was(self) -> None:
        demo = REPO / "examples/demo-paper"
        before = tree(demo)
        paper = self.dry("p")
        (paper / "manuscript/main.md").write_text("changed", encoding="utf-8")
        self.assertEqual(tree(demo), before)

    def test_the_copy_holds_only_what_the_repository_tracks(self) -> None:
        paper = self.dry("p")
        self.assertFalse((paper / ".cowriting/game.json").exists())

    def test_a_scaffolded_workspace_is_a_paper_with_the_demos_text(self) -> None:
        paper = self.dry("--workspace", "init", "p")
        self.assertTrue((paper / "paper.json").exists())
        self.assertTrue((paper / ".claude/settings.json").exists())
        self.assertEqual((paper / "manuscript/main.md").read_bytes(), (REPO / "examples/demo-paper/manuscript/main.md").read_bytes())

    def test_a_seed_file_lands_in_the_copy_and_may_not_leave_it(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        seed = Path(folder.name) / "seed.jsonl"
        seed.write_text("{}\n", encoding="utf-8")
        paper = self.dry("--add", str(seed), "ai-log/2026-10.jsonl", "p")
        self.assertEqual((paper / "ai-log/2026-10.jsonl").read_text(encoding="utf-8"), "{}\n")
        run = subprocess.run([sys.executable, str(RUNNER), "--dry-run", "--add", str(seed), "../../escaped", "p"], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertFalse((paper.parent.parent / "escaped").exists())

    def test_it_asks_for_exactly_one_prompt(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        attack = Path(folder.name) / "attack.txt"
        attack.write_text("from the file", encoding="utf-8")
        self.dry("--prompt-file", str(attack))
        for args in (["--dry-run"], ["--dry-run", "--prompt-file", str(attack), "and an argument"]):
            self.assertNotEqual(subprocess.run([sys.executable, str(RUNNER), *args], capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
