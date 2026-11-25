"""The directory probe's hooks: what they refuse, what they let pass, and what the log then says.

Runs the hook scripts as Claude Code does (JSON on stdin) on a throwaway paper, and reads
the log with the full plugin's ailog.py.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOOKS = REPO / "directory-probe" / "hooks"
AILOG = REPO / "plugin" / "tools" / "ailog.py"


def run(script: str, event: dict, *args: str) -> str:
    out = subprocess.run([sys.executable, "-I", str(HOOKS / script), *args], input=json.dumps(event),
                         capture_output=True, text=True, check=True)
    return out.stdout


class ProbeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve() / "paper"
        (self.root / "manuscript").mkdir(parents=True)
        (self.root / "notes" / "ai").mkdir(parents=True)
        (self.root / "paper.json").write_text("{}")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def refused(self, tool: str, tool_input: dict, cwd: Path | None = None) -> bool:
        out = run("guard.py", {"tool_name": tool, "tool_input": tool_input, "session_id": "s",
                               "cwd": str(cwd or self.root)})
        return '"deny"' in out

    def log(self) -> list[dict]:
        return [json.loads(line) for f in sorted((self.root / "ai-log").glob("*.jsonl"))
                for line in f.read_text().splitlines()]

    def test_the_authors_files_are_refused_and_claudes_places_are_free(self) -> None:
        self.assertTrue(self.refused("Write", {"file_path": str(self.root / "manuscript/main.md")}))
        self.assertTrue(self.refused("Edit", {"file_path": "../Manuscript/main.md"}, self.root / "notes"))
        self.assertTrue(self.refused("Write", {"file_path": "paper.json"}))
        self.assertFalse(self.refused("Write", {"file_path": "notes/ai/x.md"}))
        self.assertFalse(self.refused("Write", {"file_path": "scope.md"}))

    def test_a_command_is_judged_by_what_it_writes(self) -> None:
        for command in ("echo x>manuscript/main.md", "rm -f manuscript/main.md", "mv manuscript/main.md notes/ai/",
                        "cp notes/ai/x.md manuscript/main.md", "sed -i '' s/a/b/ manuscript/main.md"):
            self.assertTrue(self.refused("Bash", {"command": command}), command)
        for command in ("cp manuscript/main.md notes/ai/copy.md", "cat manuscript/main.md | tee notes/ai/t.md",
                        "git status"):
            self.assertFalse(self.refused("Bash", {"command": command}), command)

    def test_outside_a_paper_nothing_is_refused_or_logged(self) -> None:
        other = Path(self.tmp.name) / "other"
        (other / "manuscript").mkdir(parents=True)
        self.assertFalse(self.refused("Write", {"file_path": "manuscript/x.md"}, other))
        run("log.py", {"prompt": "hi", "session_id": "s", "cwd": str(other)}, "prompt")
        self.assertFalse((other / "ai-log").exists())

    def test_a_turn_and_a_refusal_reach_the_disclosure(self) -> None:
        self.refused("Write", {"file_path": "manuscript/main.md"})
        run("log.py", {"prompt": "Write my intro", "session_id": "s", "cwd": str(self.root)}, "prompt")
        transcript = self.root.parent / "t.jsonl"
        transcript.write_text("\n".join(json.dumps(e) for e in [
            {"type": "user", "message": {"content": "Write my intro"}},
            {"type": "assistant", "message": {"model": "m-1", "content": [{"type": "text", "text": "I can't; a hint: …"}]}},
        ]))
        run("log.py", {"session_id": "s", "cwd": str(self.root), "transcript_path": str(transcript)}, "response")
        kinds = [e["type"] for e in self.log()]
        self.assertEqual(kinds, ["guard", "prompt", "response"])
        response = self.log()[2]
        self.assertEqual((response["ref"], response["model"]), (self.log()[1]["id"], "m-1"))
        stats = subprocess.run([sys.executable, "-I", str(AILOG), "--root", str(self.root), "stats"],
                               capture_output=True, text=True, check=True).stdout
        self.assertIn("Turns: 1", stats)
        self.assertIn("Write attempts the guard refused: 1", stats)


if __name__ == "__main__":
    unittest.main()
