#!/usr/bin/env python3
"""Test type S: drive the real pane in a real terminal through tmux, and judge what is on screen.

Each case runs an interactive session on a throwaway copy with one seeded report. No prompt
goes to a model, so this costs no tokens. It presses keys as an author would, then reads the
screen and the log. Marks: pass, fail, known (broken, with its finding open), fixed? (marked
as known, but it held: drop the marker; this fails the run).

    python3 scripts/screen_suite.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import throwaway_session as runner

SEED = runner.ROOT / "dev/attacks/fixtures/seed-feedback.jsonl"
SESSION = "cowriting-screen-suite"
TABS = ("Party", "Feedback", "Live", "Log", "Scope", "Progress")
results: list[tuple[str, str, str]] = []


def tmux(*args: str) -> str:
    return subprocess.run(("tmux", *args), capture_output=True, text=True).stdout


class Pane:
    """A real session in a real terminal of this size, with its pane opened."""

    def __init__(self, width: int, height: int, workspace: str = "demo", start_in: Path | None = None, prepare=None, open_pane: bool = True) -> None:
        self.size = f"{width}x{height}"
        self.base = Path(tempfile.mkdtemp(prefix="cowriting-screen-")).resolve()
        self.paper = runner.make_copy(workspace, self.base)
        if workspace == "demo":
            runner.add_files(self.paper, [[str(SEED), "ai-log/2026-11.jsonl"]])
        if prepare is not None:
            prepare(self.paper)
        folder = start_in if start_in is not None else self.paper
        tmux("kill-session", "-t", SESSION)
        tmux("new-session", "-d", "-s", SESSION, "-x", str(width), "-y", str(height), "-c", str(folder), f"claude --plugin-dir {runner.PLUGIN} --model haiku")
        time.sleep(5)
        self.press("Down", wait=1)  # Claude Code asks whether to trust the folder; this one was made a moment ago
        self.press("Enter", wait=5)
        if open_pane:
            self.type("/cowrite:pane")

    def type(self, line: str, wait: float = 3) -> None:
        tmux("send-keys", "-t", SESSION, "-l", line)
        time.sleep(1)  # as a person types: the prompt's menu closes before Enter
        tmux("send-keys", "-t", SESSION, "Escape")
        time.sleep(0.3)
        tmux("send-keys", "-t", SESSION, "Enter")
        time.sleep(wait)

    def press(self, key: str, wait: float = 1.5) -> None:
        tmux("send-keys", "-t", SESSION, key)
        time.sleep(wait)

    def screen(self) -> str:
        return tmux("capture-pane", "-p", "-t", SESSION)

    def sees(self, text: str) -> bool:
        return text in self.screen()

    def annotations(self) -> list[dict]:
        lines = (self.paper / "ai-log/2026-11.jsonl").read_text(encoding="utf-8").splitlines()
        return [e for e in map(json.loads, lines) if e.get("type") == "annotation"]

    def close(self) -> None:
        tmux("kill-session", "-t", SESSION)
        shutil.rmtree(self.base, ignore_errors=True)

    def check(self, name: str, holds: bool, known: str = "") -> None:
        state = ("fixed?" if holds else "known") if known else ("pass" if holds else "fail")
        results.append((state, f"[{self.size}] {name}", known))


def too_small(width: int, height: int) -> None:
    """A window too small to show the choices: no key may decide, and the author is told why."""
    pane = Pane(width, height)
    try:
        pane.press("2")
        pane.press("o")
        pane.check("the window's size is named as the reason", "larger" in pane.screen())
        pane.press("a")
        pane.check("nothing is recorded for what was never shown", len(pane.annotations()) == 0)
    finally:
        pane.close()


def feedback_loop(width: int, height: int, too_small: str = "") -> None:
    """The author's way through one piece of feedback. `too_small` names the finding if this size can't show it yet."""
    pane = Pane(width, height)
    try:
        pane.check("the pane says how many inputs are open", pane.sees("(1)"))
        pane.press("2")
        # the preview may wrap, so its author's name is what is looked for
        pane.check("the Feedback tab lists the open report", pane.sees("Terminologist"), too_small)
        pane.press("o")
        for label in ("✓ used", "✎ changed", "✗ not used", "ℹ info"):
            pane.check(f"opened, the choice is on screen without scrolling: {label}", pane.sees(label), too_small)
        presses = 0
        seen_reply, seen_report = pane.sees("Reply"), pane.sees("participants")
        while presses < 4 and not (seen_reply and seen_report):
            pane.press("PageDown")
            presses += 1
            seen_reply, seen_report = seen_reply or pane.sees("Reply"), seen_report or pane.sees("participants")
        pane.check("Reply can be reached", seen_reply, too_small)
        pane.check("the report itself can be reached", seen_report, too_small)
        for _ in range(presses):
            pane.press("PageUp")
        pane.press("a")
        classified = len(pane.annotations()) == 1
        if too_small:
            # nobody may record a decision on something the screen doesn't show
            pane.check("nothing is recorded for what was never shown", not classified, too_small)
        else:
            pane.check("the choice is in the log", classified)
            pane.check("the open count drops to none", pane.sees("Nothing open") and not pane.sees("Feedback (1)"))
    finally:
        pane.close()


def tab_labels(width: int, height: int) -> None:
    """Wide enough, every tab shows its name. Narrow, the open one does and the rest their numbers; no name breaks across lines."""
    pane = Pane(width, height)
    try:
        if width >= 70:
            pane.check("every tab's name is whole on screen", all(tab in pane.screen() for tab in TABS))
        else:
            for key, tab in zip("123456", TABS):
                pane.press(key)
                pane.check(f"key {key} opens {tab}, its name whole on screen", tab in pane.screen())
    finally:
        pane.close()


def main() -> int:
    if shutil.which("tmux") is None:
        print("This suite needs tmux.")
        return 2
    feedback_loop(100, 40)
    feedback_loop(120, 70)
    feedback_loop(80, 24)
    feedback_loop(48, 24)
    too_small(44, 16)
    tab_labels(100, 40)
    tab_labels(48, 24)
    counts: dict[str, int] = {}
    for state, name, known in results:
        counts[state] = counts.get(state, 0) + 1
        print(f"  {state:<8}{name}" + (f" ({known})" if known else ""))
    print("\n" + "  ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    return 1 if counts.get("fail") or counts.get("fixed?") else 0


if __name__ == "__main__":
    sys.exit(main())
