#!/usr/bin/env python3
"""Test type E without a model: the plugin's work on real tools, real git, the real network and a real terminal.

Costs no tokens. Needs tmux, git and network access (Crossref). Judged from files, git and the screen.

    python3 scripts/workflow_suite.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import screen_suite
import throwaway_session as runner
from screen_suite import Pane

TOOLS = runner.PLUGIN / "tools"
BIB = """@article{real2021, title={Active School Breaks and Students' Attention: A Systematic Review with Meta-Analysis}, year={2021}, doi={10.3390/brainsci11060675}}
@article{wrong2021, title={A Title That Has Nothing To Do With This Record At All}, year={1999}, doi={10.3390/brainsci11060675}}
@article{fake2021, title={Never Written}, year={2021}, doi={10.9999/this.does.not.exist.anywhere}}
@article{nodoi2021, title={Active School Breaks and Students' Attention}, year={2021}}
"""
results: list[tuple[str, str]] = []


def check(name: str, holds: bool, detail: str = "") -> None:
    results.append(("pass" if holds else "FAIL", name + (f"  ({detail})" if detail and not holds else "")))


def git(folder: Path, *args: str) -> str:
    return subprocess.run(("git", "-C", str(folder), *args), capture_output=True, text=True).stdout


def live_references() -> None:
    """F33: the author's bibliography against Crossref, for real."""
    with tempfile.TemporaryDirectory() as tmp:
        paper = Path(tmp).resolve()
        (paper / "paper.json").write_text('{"name": "t"}', encoding="utf-8")
        (paper / "literature").mkdir()
        (paper / "literature/references.bib").write_text(BIB, encoding="utf-8")
        run = subprocess.run((sys.executable, str(TOOLS / "verify_refs.py")), cwd=paper, capture_output=True, text=True, timeout=120)
        lines = {line.split()[0] if False else line for line in run.stdout.splitlines()}
        def line_of(key: str) -> str:
            return next((line for line in lines if key in line), "")
        if "Could not" in run.stdout and "real2021" not in run.stdout:
            results.append(("open", f"Crossref could not be reached: {run.stdout[:120]}"))
            return
        check("a real DOI with the right title is OK", line_of("real2021").lstrip().startswith("OK"), line_of("real2021"))
        check("a real DOI with the wrong title is a MISMATCH", "MISMATCH" in line_of("wrong2021"), line_of("wrong2021"))
        check("an invented DOI is NOT FOUND", "NOT FOUND" in line_of("fake2021"), line_of("fake2021"))
        check("an entry without a DOI says so", "NO DOI" in line_of("nodoi2021"), line_of("nodoi2021"))


def upgrade_keeps_the_authors_files() -> None:
    """F4, S14: an older workspace is brought up to date; what is the author's stays exactly as it was."""
    base = Path(tempfile.mkdtemp(prefix="cowriting-upgrade-")).resolve()
    try:
        paper = runner.make_copy("init", base)
        (paper / "manuscript/main.md").write_text("my own text\n", encoding="utf-8")
        (paper / "party.md").write_text("## everyone\nmy brief\n", encoding="utf-8")
        (paper / "scope.md").write_text("# my scope\n", encoding="utf-8")
        (paper / "CLAUDE.md").write_text("my old rules\n", encoding="utf-8")
        (paper / ".claude/settings.json").write_text('{"permissions": {"allow": ["Bash(ls)"]}}\n', encoding="utf-8")
        look = subprocess.run((sys.executable, str(TOOLS / "new_paper.py"), "--upgrade", "--dir", str(paper)), capture_output=True, text=True)
        check("upgrade lists what the workspace lacks", "CLAUDE.md" in look.stdout and (paper / "CLAUDE.md").read_text(encoding="utf-8") == "my old rules\n", look.stdout[:200])
        subprocess.run((sys.executable, str(TOOLS / "new_paper.py"), "--upgrade", "--apply", "--dir", str(paper)), capture_output=True, text=True)
        check("apply leaves the manuscript alone", (paper / "manuscript/main.md").read_text(encoding="utf-8") == "my own text\n")
        check("apply leaves the briefing alone", "my brief" in (paper / "party.md").read_text(encoding="utf-8"))
        check("apply leaves the scope alone", (paper / "scope.md").read_text(encoding="utf-8") == "# my scope\n")
        settings = json.loads((paper / ".claude/settings.json").read_text(encoding="utf-8"))
        check("apply adds the deny rules and keeps the author's own", "Bash(ls)" in settings["permissions"]["allow"] and any("manuscript" in r for r in settings["permissions"]["deny"]))
        check("the sandbox is on afterwards", settings.get("sandbox", {}).get("enabled") is True)
        kept = list((paper / ".cowriting/upgrade").rglob("CLAUDE.md")) if (paper / ".cowriting/upgrade").exists() else []
        check("the replaced rules are kept", any("my old rules" in k.read_text(encoding="utf-8") for k in kept))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def autosave_commits_under_the_authors_name() -> None:
    """F19: a real pause, real git. Only the manuscript and the log, under the author's own name."""
    pane = Pane(100, 40, workspace="init", open_pane=False)
    try:
        paper = pane.paper
        before = git(paper, "rev-list", "--count", "--all").strip() or "0"
        (paper / "notes/ai/not-saved.md").write_text("a note\n", encoding="utf-8")
        with (paper / "manuscript/main.md").open("a", encoding="utf-8") as out:
            out.write("\nThe author wrote these seven new words here.\n")
        commits = before
        for _ in range(12):
            time.sleep(10)
            commits = git(paper, "rev-list", "--count", "--all").strip() or "0"
            if commits != before:
                break
        check("a writing pause leads to a commit", commits != before, f"{before} -> {commits}")
        if commits != before:
            author = git(paper, "log", "-1", "--format=%an <%ae>").strip()
            mine = f"{git(paper, 'config', 'user.name').strip()} <{git(paper, 'config', 'user.email').strip()}>"
            check("it is under the author's own name", author == mine, f"{author} vs {mine}")
            changed = [f for f in git(paper, "show", "--name-only", "--format=", "HEAD").split("\n") if f]
            check("it holds only the manuscript and the log", changed != [] and all(f.startswith(("manuscript/", "ai-log/")) for f in changed), str(changed))
            check("its message names the words gained", "word" in git(paper, "log", "-1", "--format=%B").lower(), git(paper, "log", "-1", "--format=%B")[:120])
    finally:
        pane.close()


def a_paper_without_git() -> None:
    """F5: nothing saved, the pane says so."""
    def no_git(paper: Path) -> None:
        settings = json.loads((paper / "paper.json").read_text(encoding="utf-8"))
        settings["versioning"] = "none"
        (paper / "paper.json").write_text(json.dumps(settings), encoding="utf-8")
    pane = Pane(100, 40, prepare=no_git)
    try:
        check("the pane says there is no git", pane.sees("no git"), pane.screen()[:300])
    finally:
        pane.close()


def every_tab_shows_its_content() -> None:
    """F38, F39, F41, F46, F48: each tab, in a real terminal, says what it is for."""
    pane = Pane(100, 50)
    try:
        for key, tab, text in (("1", "Party", "summon"), ("3", "Live", "Live review"), ("4", "Log", "Terminologist"), ("5", "Scope", "%"), ("6", "Progress", "XP")):
            pane.press(key)
            check(f"the {tab} tab shows its content", pane.sees(text), pane.screen()[-500:])
        pane.press("Escape")
        pane.type("/cowrite:quiet focus", wait=2)
        check("the status line stays in focus mode", pane.sees("assist-only"))
    finally:
        pane.close()


def the_status_line_counts_what_stats_counts() -> None:
    """S11: the pane, the status line and the tool say the same."""
    pane = Pane(100, 40)
    try:
        stats = subprocess.run((sys.executable, str(TOOLS / "ailog.py"), "--root", str(pane.paper), "stats"), capture_output=True, text=True).stdout
        check("the tool says one is open", "unannotated: 1" in stats, stats[:120])
        check("the pane's tab says one is open", pane.sees("Feedback (1)"))
        check("the status line says one is open", pane.sees("1 to classif"))
    finally:
        pane.close()


def a_paper_opened_from_elsewhere() -> None:
    """F3, S13: from another folder, the paper is opened by path, and the pane follows."""
    elsewhere = Path(tempfile.mkdtemp(prefix="cowriting-elsewhere-")).resolve()
    (elsewhere / "notes.txt").write_text("another project\n", encoding="utf-8")
    pane = Pane(100, 40, start_in=elsewhere, open_pane=False)
    try:
        pane.type(f"/cowrite:paper {pane.paper}", wait=3)
        check("the paper is named as active", pane.sees("Active paper") or pane.sees("Walking breaks"), pane.screen()[-400:])
        pane.type("/cowrite:pane")
        check("the pane shows that paper", pane.sees("Walking breaks"))
        check("the other project gets no log", not (elsewhere / "ai-log").exists())
    finally:
        pane.close()
        shutil.rmtree(elsewhere, ignore_errors=True)


def an_expert_of_ones_own() -> None:
    """F24: a party/<id>.md file joins the party."""
    def expert(paper: Path) -> None:
        (paper / "party").mkdir(exist_ok=True)
        (paper / "party/neurologist.md").write_text("---\nname: The Neurologist\nshort: Neurologist\nrole: clinical neurology\ncategory: review\ncolour: blue\n---\nYou look at neurology.\n", encoding="utf-8")
    pane = Pane(120, 50, prepare=expert, open_pane=False)
    try:
        pane.type("/cowrite:party", wait=3)
        check("the roster names the expert", pane.sees("Neurologist"), pane.screen()[-400:])
    finally:
        pane.close()


def main() -> int:
    if shutil.which("tmux") is None:
        print("This suite needs tmux.")
        return 2
    for step in (live_references, upgrade_keeps_the_authors_files, autosave_commits_under_the_authors_name, a_paper_without_git, every_tab_shows_its_content, the_status_line_counts_what_stats_counts, a_paper_opened_from_elsewhere, an_expert_of_ones_own):
        print(f"... {step.__name__}", flush=True)
        step()
    for state, name in results:
        print(f"  {state:<5}{name}")
    failed = sum(s == "FAIL" for s, _ in results)
    print(f"\nfail: {failed}  open: {sum(s == 'open' for s, _ in results)}  pass: {sum(s == 'pass' for s, _ in results)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["screen_suite"]
