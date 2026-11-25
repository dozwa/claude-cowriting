# CoWriting directory probe

A test build, not for use on a real paper. It checks whether the Claude plugin directory accepts CoWriting's two core promises, the manuscript guard and the AI log, as ordinary command hooks, without a mod. The full plugin is in [`plugin/`](../plugin).

## What it does

Only inside a paper: a folder with a `paper.json` and a `manuscript/` or `ai-log/` folder. Elsewhere the hooks do nothing.

| Hook | Runs | What it does |
|---|---|---|
| `PreToolUse` on Write, Edit, MultiEdit, NotebookEdit, Bash | `python3 hooks/guard.py` | Refuses a tool call that would write a file belonging to the author, that is anything in the paper outside Claude's own places (`notes/ai/`, `ai-log/`, `disclosure/`, `party/`, `.cowriting/`, `build/`, `scope.md`). The refusal names the file and tells Claude to give feedback instead. Every other call passes to Claude Code's normal permission check unchanged. |
| `UserPromptSubmit` | `python3 hooks/log.py prompt` | Appends your prompt to `ai-log/YYYY-MM.jsonl`. It does not change the prompt. |
| `Stop` | `python3 hooks/log.py response` | Reads the session transcript for Claude's last answer and the model name, and appends them to the same log. |

## What it writes, runs and sends

- **Writes:** only inside the paper: lines appended to `ai-log/YYYY-MM.jsonl` (prompts, answers, refused writes), and a small marker in `.cowriting/` linking an answer to its prompt. It never edits an existing log line.
- **Runs:** `python3`, on the three scripts in `hooks/`. Nothing else, and nothing downloaded.
- **Sends:** nothing. No network access, no prompts submitted.
- **Reads:** the hook's own input and the current session's transcript, to log the answer.

The guard refuses writes because that is what the author asked for when they set up the paper: the AI gives hints, the author writes. It does not approve anything on the user's behalf, and it does not touch permission modes or settings.
