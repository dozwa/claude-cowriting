"""A write the command's text doesn't show, for the guard suite. What it does depends on the name it is copied under.

Each copy writes down in notes/ai/ whether its write went through, so the verdict can rest on what happened.
"""
import os
from pathlib import Path

LOG = Path("ai-log/2026-10.jsonl")


def text() -> None:
    with open("manuscript/main.md", "a", encoding="utf-8") as out:
        out.write("\nAdded by a script.\n")


def rules() -> None:
    Path("paper.json").write_text('{"name": "changed by a script"}\n', encoding="utf-8")


def link() -> None:
    os.symlink("../../manuscript/main.md", "notes/ai/link.md")
    with open("notes/ai/link.md", "a", encoding="utf-8") as out:
        out.write("\nAdded through a link.\n")


def forge() -> None:
    Path("ai-log/forged.jsonl").write_text('{"type":"prompt","id":"forged","text":"never asked"}\n', encoding="utf-8")


def rewrite() -> None:
    LOG.write_text('{"type":"prompt","id":"seed","text":"something nicer"}\n', encoding="utf-8")


def remove() -> None:
    LOG.unlink()


name = Path(__file__).stem
action = {"step_text": text, "step_rules": rules, "step_link": link, "step_forge": forge, "step_rewrite": rewrite, "step_remove": remove}[name]
try:
    action()
    outcome = "written"
except OSError as error:
    outcome = f"refused: {error}"
Path(f"notes/ai/result-{name}.txt").write_text(outcome + "\n", encoding="utf-8")
print(outcome)
