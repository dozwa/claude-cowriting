#!/usr/bin/env python3
"""Run one headless Claude Code session with this repo's plugin, on a fresh throwaway copy of a paper.

For test types G, E and B in docs/test-plan.md. Every run gets a new temporary folder outside
the repository, so it can never touch a real paper or this checkout. The session runs with
the Bash sandbox on and no unsandboxed fallback: the guard's own layers are what is under test,
and the sandbox keeps a shell command inside the copy. Standard library only.

    throwaway_session.py "the prompt"
    throwaway_session.py --workspace init --model haiku "the prompt"
    throwaway_session.py --add seed.jsonl ai-log/2026-10.jsonl "the prompt"
    throwaway_session.py --prompt-file dev/attacks/g1-file-tools-and-plain-commands.txt
    throwaway_session.py --dry-run "the prompt"
    throwaway_session.py --suite [CASE ...]        the whole guard suite, see attack_suite.py

--workspace demo    a copy of examples/demo-paper (default); its settings have no deny rules for
                    most author files and no sandbox paths of their own
--workspace init    a workspace from the plugin's scaffold tool, with its deny rules and sandbox paths
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "examples/demo-paper"
PLUGIN = ROOT / "plugin"
SETTINGS = {"sandbox": {"enabled": True, "allowUnsandboxedCommands": False}}
TOOLS = "Bash,Write,Edit,Read,Agent"
TIMEOUT_SECONDS = 300
# projects that are no paper, though they have files and folders of the names a paper uses
OTHER_PROJECTS = {
    "other-named-alike": {"manuscript/old.md": "old\n", "literature/a.bib": "old\n", "ai-log/app.jsonl": "old\n", "CLAUDE.md": "old\n", "party.md": "old\n"},
    "other-with-paper-json": {"paper.json": '{"title": "Config of another tool"}\n', "CLAUDE.md": "old\n", "src/app.txt": "old\n"},
}


def make_copy(workspace: str, base: Path) -> Path:
    paper = base / "paper"
    if workspace in OTHER_PROJECTS:
        for rel, text in OTHER_PROJECTS[workspace].items():
            path = paper / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return paper
    if workspace == "demo":
        shutil.copytree(DEMO, paper)
    else:
        paper.mkdir()
        tool = PLUGIN / "tools/new_paper.py"
        subprocess.run((sys.executable, str(tool), "--format", "markdown", "--dir", str(paper), "--name", "Throwaway"), check=True, capture_output=True)
        shutil.copy(DEMO / "manuscript/main.md", paper / "manuscript/main.md")
    (paper / "ai-log").mkdir(exist_ok=True)
    return paper


def add_files(paper: Path, pairs: list[list[str]]) -> None:
    for source, target in pairs:
        destination = (paper / target).resolve()
        if not destination.is_relative_to(paper.resolve()):
            raise SystemExit(f"--add must stay inside the copy: {target}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, destination)


def session_command(prompt: str, model: str) -> list[str]:
    # the prompt comes first: --allowedTools takes several values and would swallow it
    return ["claude", "-p", prompt, "--model", model, "--plugin-dir", str(PLUGIN), "--allowedTools", TOOLS, "--settings", json.dumps(SETTINGS)]


def report(paper: Path) -> None:
    print(f"\n--- the copy\n{paper}")
    for log in sorted((paper / "ai-log").glob("*.jsonl")):
        print(f"\n--- {log.name}")
        for line in log.read_text(encoding="utf-8").splitlines():
            print(line[:240])
    kept = paper / ".cowriting/log-rewrites"
    if kept.is_dir():
        print(f"\n--- kept rewrites\n" + "\n".join(p.name for p in sorted(kept.iterdir())))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("prompt", nargs="?")
    parser.add_argument("--prompt-file", type=Path, help="read the prompt from a file, such as an attack list in dev/attacks/")
    parser.add_argument("--suite", nargs="*", metavar="CASE", help="run the real-session guard suite in dev/attacks/cases.json, all of it or the cases named")
    parser.add_argument("--workspace", choices=("demo", "init", *OTHER_PROJECTS), default="demo")
    parser.add_argument("--model", default="haiku")
    parser.add_argument("--add", nargs=2, action="append", default=[], metavar=("SOURCE", "TARGET"), help="copy a file into the paper, TARGET relative to it")
    parser.add_argument("--dry-run", action="store_true", help="make the copy and print the command, but start no session")
    args = parser.parse_args()
    if args.suite is not None:
        from attack_suite import run_suite  # it imports this file, so not at the top

        return run_suite(args.suite, args.model)
    if (args.prompt is None) == (args.prompt_file is None):
        parser.error("give the prompt, or --prompt-file, not both")
    prompt = args.prompt if args.prompt_file is None else args.prompt_file.read_text(encoding="utf-8")

    base = Path(tempfile.mkdtemp(prefix="cowriting-throwaway-")).resolve()
    if base.is_relative_to(ROOT):
        raise SystemExit("The temporary folder lies inside the repository; refusing to run there.")
    paper = make_copy(args.workspace, base)
    add_files(paper, args.add)
    command = session_command(prompt, args.model)
    if args.dry_run:
        print(json.dumps({"paper": str(paper), "command": command}))
        return 0
    try:
        code = subprocess.run(command, cwd=paper, timeout=TIMEOUT_SECONDS).returncode
    except subprocess.TimeoutExpired:
        print(f"The session passed {TIMEOUT_SECONDS} s and was stopped.")
        code = 124
    report(paper)
    return code


if __name__ == "__main__":
    sys.exit(main())
