"""Tests for the throwaway session runner. No session is started: every run is a dry run."""
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


class DryRun(unittest.TestCase):
    def dry(self, *args: str) -> dict:
        run = subprocess.run([sys.executable, str(RUNNER), "--dry-run", *args, "the prompt"], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        plan = json.loads(run.stdout)
        self.addCleanup(shutil.rmtree, Path(plan["paper"]).parent, True)
        return plan

    def test_every_run_gets_a_new_copy_outside_the_repository(self) -> None:
        one, two = Path(self.dry()["paper"]).resolve(), Path(self.dry()["paper"]).resolve()
        self.assertNotEqual(one, two)
        for paper in (one, two):
            self.assertFalse(paper.is_relative_to(REPO))
            self.assertTrue((paper / "paper.json").exists())
            self.assertTrue((paper / "ai-log").is_dir())

    def test_the_session_is_sandboxed_with_no_way_out_and_the_prompt_survives(self) -> None:
        command = self.dry("--model", "haiku")["command"]
        self.assertEqual(command[:3], ["claude", "-p", "the prompt"])  # before the flag that would swallow it
        settings = json.loads(command[command.index("--settings") + 1])
        self.assertEqual(settings["sandbox"], {"enabled": True, "allowUnsandboxedCommands": False})
        self.assertEqual(command[command.index("--plugin-dir") + 1], str(REPO / "plugin"))

    def test_a_prompt_can_come_from_a_file_but_not_from_both(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        attack = Path(folder.name) / "attack.txt"
        attack.write_text("from the file", encoding="utf-8")
        run = subprocess.run([sys.executable, str(RUNNER), "--dry-run", "--prompt-file", str(attack)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        plan = json.loads(run.stdout)
        self.addCleanup(shutil.rmtree, Path(plan["paper"]).parent, True)
        self.assertEqual(plan["command"][2], "from the file")
        both = subprocess.run([sys.executable, str(RUNNER), "--dry-run", "--prompt-file", str(attack), "and an argument"], capture_output=True, text=True)
        self.assertNotEqual(both.returncode, 0)

    def test_a_scaffolded_workspace_has_its_own_deny_rules(self) -> None:
        paper = Path(self.dry("--workspace", "init")["paper"])
        settings = json.loads((paper / ".claude/settings.json").read_text(encoding="utf-8"))
        self.assertTrue(settings["sandbox"]["enabled"])
        self.assertIn("./manuscript", settings["sandbox"]["filesystem"]["denyWrite"])

    def test_a_seed_file_lands_in_the_copy_and_may_not_leave_it(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        seed = Path(folder.name) / "seed.jsonl"
        seed.write_text("{}\n", encoding="utf-8")
        paper = Path(self.dry("--add", str(seed), "ai-log/2026-10.jsonl")["paper"])
        self.assertEqual((paper / "ai-log/2026-10.jsonl").read_text(encoding="utf-8"), "{}\n")
        run = subprocess.run([sys.executable, str(RUNNER), "--dry-run", "--add", str(seed), "../../escaped", "p"], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("inside the copy", run.stderr)


if __name__ == "__main__":
    unittest.main()
