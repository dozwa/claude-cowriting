"""PreToolUse: refuse an AI write to the author's files in a paper, and put the refusal on record.

Reads the hook's JSON on stdin. File tools are judged by the file they name; shell commands
by the files a few common writing forms name (redirects, rm, mv, cp, tee, touch, sed -i,
truncate). This is a probe of what the plugin directory accepts, not the full guard.
"""
from __future__ import annotations

import json
import os
import shlex
import sys
import uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paper import CLAUDE_FILES, CLAUDE_FOLDERS, append, find_paper, now  # noqa: E402

WRITERS = {"rm", "mv", "cp", "tee", "touch", "truncate", "dd", "install", "ln"}


def is_authors(root: Path, path: Path) -> bool:
    try:
        rel = path.resolve().relative_to(root)
    except ValueError:
        return False  # outside the paper
    parts = [p.lower() for p in rel.parts]
    if not parts:
        return False
    joined = "/".join(parts)
    if joined in CLAUDE_FILES:
        return False
    return not any(joined == f or joined.startswith(f + "/") for f in CLAUDE_FOLDERS)


def shell_targets(command: str) -> list[str]:
    """Files a command plainly writes. Unreadable commands yield nothing here."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=";&|<>")
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return []
    out: list[str] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in (">", ">>", ">|") and i + 1 < len(tokens):
            out.append(tokens[i + 1])
        elif t in WRITERS or (t == "sed" and any(a.startswith("-i") for a in tokens[i + 1:i + 4])):
            j = i + 1
            named: list[str] = []
            while j < len(tokens) and tokens[j] not in (";", "&&", "||", "|", "&", ">", ">>"):
                if not tokens[j].startswith("-"):
                    named.append(tokens[j])
                j += 1
            # cp, install and ln write only their last argument; mv also removes its sources
            out += named[-1:] if t in ("cp", "install", "ln") else named
        i += 1
    return out


def main() -> None:
    event = json.load(sys.stdin)
    cwd = Path(event.get("cwd") or os.getcwd())
    root = find_paper(cwd)
    if root is None:
        return  # not in a paper: nothing to guard
    tool = event.get("tool_name", "")
    args = event.get("tool_input") or {}
    if tool == "Bash":
        named = shell_targets(args.get("command", ""))
        shown = args.get("command", "")
    else:
        named = [args.get("file_path") or args.get("notebook_path") or ""]
        shown = named[0]
    hits = [n for n in named if n and is_authors(root, cwd / os.path.expanduser(n))]
    if not hits:
        return
    files = sorted({str((cwd / os.path.expanduser(h)).resolve().relative_to(root)) for h in hits})
    append(root, {"type": "guard", "id": uuid.uuid4().hex[:8], "ts": now(), "session": event.get("session_id"),
                  "paper": root.name, "refused": True, "tool": tool, "input": shown, "files": files})
    reason = (f"CoWriting: {', '.join(files)} belongs to the author. Claude doesn't write the author's files; "
              "offer feedback, a question or a hint instead. This refusal is in the AI log.")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                             "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))


if __name__ == "__main__":
    main()
