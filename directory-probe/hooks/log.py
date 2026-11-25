"""UserPromptSubmit and Stop: log each prompt and Claude's answer to the paper's ai-log/.

`log.py prompt` records the prompt; `log.py response` reads the session transcript for the
last answer and the model, and records it against the prompt. Entries use the same shape
as the full plugin, so its `ailog.py` reads them. Outside a paper it does nothing.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paper import append, find_paper, now  # noqa: E402

VERSION = "0.0.1-probe"


def state_file(root: Path, session: str) -> Path:
    return root / ".cowriting" / f"probe-open-{session}.json"


def last_answer(transcript: str) -> tuple[str, str]:
    """The text of the last assistant message after the last user prompt, and its model."""
    text, model = [], ""
    try:
        lines = Path(transcript).read_text(encoding="utf-8").splitlines()
    except OSError:
        return "", ""
    for line in lines:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = e.get("message") or {}
        if e.get("type") == "user" and isinstance(msg.get("content"), str):
            text = []  # a new prompt: the answer starts again
        elif e.get("type") == "assistant":
            model = msg.get("model") or model
            for part in msg.get("content") or []:
                if isinstance(part, dict) and part.get("type") == "text":
                    text.append(part.get("text", ""))
    return "\n\n".join(t for t in text if t.strip()), model


def main() -> None:
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    event = json.load(sys.stdin)
    root = find_paper(event.get("cwd") or os.getcwd())
    if root is None:
        return
    session = event.get("session_id") or "unknown"
    pending = state_file(root, session)
    if kind == "prompt":
        pid = uuid.uuid4().hex[:8]
        append(root, {"type": "prompt", "id": pid, "ts": now(), "session": session, "paper": root.name,
                      "category": "general", "plugin": VERSION, "text": event.get("prompt", "")})
        pending.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(json.dumps({"id": pid}), encoding="utf-8")
    elif kind == "response":
        try:
            pid = json.loads(pending.read_text(encoding="utf-8"))["id"]
        except (OSError, ValueError, KeyError):
            return  # no prompt of this session waits for an answer
        answer, model = last_answer(event.get("transcript_path", ""))
        append(root, {"type": "response", "ref": pid, "ts": now(), "model": model, "personas": [],
                      "tools_used": [], "ai_text_flag": "[AI-TEXT]" in answer, "answer": answer})
        pending.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
