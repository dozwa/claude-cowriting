#!/usr/bin/env python3
"""Test type E without a model: the plugin's work on real tools, real git, the real network and a real terminal.

Costs no tokens. Needs tmux, git and network access (Crossref). Judged from files, git and the screen.
With --with-model it runs what needs a live model in the pane instead (Reply, Remember, live review),
which uses a few tokens on Haiku.

    python3 scripts/workflow_suite.py [--with-model]
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import attack_suite
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


def wait_for(test, seconds: int = 150) -> bool:
    for _ in range(seconds // 5):
        if test():
            return True
        time.sleep(5)
    return test()


def log_of(paper: Path) -> list[dict]:
    return attack_suite.log_entries(paper)


def reply_in_a_thread() -> None:
    """F25, S9: uses a model. Reply from the opened input; the persona answers, and the log keeps the thread."""
    pane = Pane(100, 40)
    try:
        for key in ("2", "o", "y"):
            pane.press(key)
        pane.type("Why is participants better than subjects in my field? Please argue your position.", wait=2)
        check("the reply is logged and names the feedback", wait_for(lambda: any(e.get("replyTo") == "report1" for e in log_of(pane.paper))))
        replies = [e["id"] for e in log_of(pane.paper) if e.get("replyTo") == "report1"]
        answered = wait_for(lambda: any(e.get("origin") == "agent" and e.get("replyTo") in replies for e in log_of(pane.paper)), 200)
        check("the persona's answer names the reply", answered, str([(e.get("origin"), e.get("replyTo")) for e in log_of(pane.paper) if e.get("type") == "prompt"]))
    finally:
        pane.close()


def remember_a_discussion() -> None:
    """F26, S10: uses a model. Nothing is written before the author saves, and the proposal is logged."""
    thread = runner.ROOT / "dev/attacks/fixtures/seed-thread.jsonl"

    def with_a_discussion(paper: Path) -> None:
        with (paper / "ai-log/2026-11.jsonl").open("a", encoding="utf-8") as out:
            out.write(thread.read_text(encoding="utf-8"))

    pane = Pane(100, 50, prepare=with_a_discussion)
    try:
        before = (pane.paper / "party.md").read_text(encoding="utf-8")
        for key in ("2", "o"):
            pane.press(key)
        pane.press("m")
        check("a proposal appears for the author to edit", wait_for(lambda: pane.sees("Save to party.md") or pane.sees("keep in mind"), 60), pane.screen()[-600:])
        check("nothing is written before saving", (pane.paper / "party.md").read_text(encoding="utf-8") == before)
        pane.press("s", wait=3)
        after = (pane.paper / "party.md").read_text(encoding="utf-8")
        check("saving writes what was settled under the persona's heading", after != before and "participants" in after.split("## terminologist")[-1].lower(), after[-300:])
        check("the proposal is logged as AI input", any(e.get("origin") == "brief" for e in log_of(pane.paper)), str({e.get("origin") for e in log_of(pane.paper)}))
    finally:
        pane.close()


def live_review() -> None:
    """F45, S16: uses a model. Only what changed is sent, the hints show, and the review is logged."""
    pane = Pane(100, 50, open_pane=False)
    try:
        pane.type("/cowrite:watch on", wait=20)  # it takes its baseline at its first look; an edit before that is part of it
        with (pane.paper / "manuscript/main.md").open("a", encoding="utf-8") as out:
            out.write("\nThe subject were tested at a time when there was a big amount of things happening around them in the room.\n")
        reviewed = wait_for(lambda: any(e.get("origin") == "watch" for e in log_of(pane.paper)), 120)
        check("a pause leads to a logged review", reviewed, str({e.get("origin") for e in log_of(pane.paper)}))
        sent = [str(e.get("text", "")) for e in log_of(pane.paper) if e.get("origin") == "watch"]
        # the log names the lines it reviewed: the one new paragraph at the end of the file, not the whole text
        lines = len((pane.paper / "manuscript/main.md").read_text(encoding="utf-8").splitlines())
        reviewed_lines = re.search(r"l\.(\d+)[–-](\d+)", sent[-1]) if sent else None
        check("the log says only the changed paragraph was reviewed", reviewed_lines is not None and int(reviewed_lines[1]) == int(reviewed_lines[2]) == lines, (sent[-1][:200] if sent else ""))
        pane.type("/cowrite:pane")
        pane.press("3")
        hints = [str(e.get("answer", "")) for e in log_of(pane.paper) if e.get("type") == "response" and e.get("personas") is not None]
        seen = False
        for _ in range(4):
            seen = seen or pane.sees("✓ used")
            pane.press("PageDown")
        check("the Live tab's choices can be reached", seen, pane.screen()[-500:])
        check("no hint rewrites the sentence", not any("The subjects were tested at a time" in h for h in hints))
    finally:
        pane.close()


def main() -> int:
    if shutil.which("tmux") is None:
        print("This suite needs tmux.")
        return 2
    steps = [reply_in_a_thread, remember_a_discussion, live_review] if "--with-model" in sys.argv else [live_references, upgrade_keeps_the_authors_files, autosave_commits_under_the_authors_name, a_paper_without_git, every_tab_shows_its_content, the_status_line_counts_what_stats_counts, a_paper_opened_from_elsewhere, an_expert_of_ones_own]
    for step in steps:
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
