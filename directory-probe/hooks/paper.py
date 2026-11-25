"""What the probe's hooks share: where the paper is, and how to add to its log.

A paper is a folder with a paper.json and a manuscript/ or ai-log/ folder, the same rule
as the full plugin. Standard library only.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

# Claude's own places in a paper; every other file there is the author's.
CLAUDE_FOLDERS = ("notes/ai", "ai-log", "disclosure", "party", ".cowriting", "build")
CLAUDE_FILES = ("scope.md",)


def find_paper(start: str | Path) -> Path | None:
    here = Path(start).resolve()
    for d in (here, *here.parents):
        if (d / "paper.json").is_file() and ((d / "manuscript").is_dir() or (d / "ai-log").is_dir()):
            return d
    return None


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def append(root: Path, entry: dict) -> None:
    """Add one line to this month's log file. The log only ever grows."""
    path = root / "ai-log" / f"{dt.datetime.now(dt.timezone.utc):%Y-%m}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
