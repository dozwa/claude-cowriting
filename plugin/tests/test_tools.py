"""Tests of the CoWriting command-line tools (standard library only).

    python3 -m unittest discover -s plugin/tests -p 'test_*.py' -v

They scaffold a paper in a temporary folder, write a small AI log into it and
run the tools on it: the disclosure is the artefact an author signs, so what it
says is checked word by word where it matters.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent / "tools"
sys.path.insert(0, str(TOOLS))

import ailog  # noqa: E402
import bibliography  # noqa: E402
import verify_refs  # noqa: E402
import zotero_search  # noqa: E402

FIXTURE = [
    {"type": "prompt", "id": "a1", "ts": "2026-10-01T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "feedback",
     "text": "Gib mir Feedback zur Einleitung & zu 50% der Methodik"},
    {"type": "response", "ref": "a1", "ts": "2026-10-01T10:00:05Z", "model": "claude-opus-5-5", "plugin": "0.1.0",
     "claude_code": "2.1.300", "personas": ["reviewer-2"], "tools_used": ["Read"], "ai_text_flag": False, "answer": "Hinweis 1"},
    {"type": "prompt", "id": "a2", "ts": "2026-10-02T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "language",
     "text": "Korrigiere Rechtschreibung"},
    {"type": "response", "ref": "a2", "ts": "2026-10-02T10:00:05Z", "model": "claude-opus-5-5", "plugin": "0.1.0",
     "claude_code": "2.1.300", "personas": [], "tools_used": [], "ai_text_flag": True, "answer": "[AI-TEXT] bla"},
    {"type": "prompt", "id": "a3", "ts": "2026-10-03T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "feedback",
     "origin": "watch", "text": "Live review (grammar-guy) of main.tex l.1–3"},
    {"type": "response", "ref": "a3", "ts": "2026-10-03T10:00:05Z", "model": "haiku", "plugin": "0.1.0", "claude_code": "2.1.300",
     "personas": ["grammar-guy"], "tools_used": [], "ai_text_flag": False, "answer": "(no hints)"},
    {"type": "prompt", "id": "a4", "ts": "2026-10-04T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "terminology",
     "text": "Use the cowrite:terminologist agent to review main.tex"},
    {"type": "response", "ref": "a4", "ts": "2026-10-04T10:00:05Z", "model": "claude-opus-5-5", "plugin": "0.1.0",
     "claude_code": "2.1.300", "personas": ["terminologist"], "agents": {"agent-1": "terminologist"}, "tools_used": ["Agent"],
     "ai_text_flag": False, "answer": "The Terminologist is on it."},
    {"type": "guard", "ts": "2026-10-04T10:05:00Z", "session": "s", "paper": "Testarbeit", "ref": "a4", "tool": "Bash",
     "input": "python3 fix.py", "files": ["manuscript/main.tex"]},
    {"type": "annotation", "ref": "a1", "ts": "2026-10-05T10:00:00Z", "use": "adapted", "chapter": "Einleitung"},
]


def run(tool: str, *args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", str(TOOLS / tool), *args], cwd=cwd, capture_output=True, text=True, check=False)


class PaperWorkspace(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        scaffold = run("new_paper.py", "--format", "latex", "--lang", "de", "--name", "Testarbeit", "--dir", str(self.root), cwd=self.root)
        self.assertEqual(scaffold.returncode, 0, scaffold.stderr)
        log = self.root / "ai-log" / "2026-10.jsonl"
        log.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in FIXTURE), encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def read(self, name: str) -> str:
        return (self.root / "disclosure" / name).read_text(encoding="utf-8")

    # ------------------------------------------------------------ new_paper

    def test_scaffold_creates_the_workspace_and_never_overwrites(self) -> None:
        for rel in ("paper.json", "CLAUDE.md", "party.md", "scope.md", "manuscript/main.tex", "literature/references.bib",
                    ".claude/settings.json", ".vscode/settings.json", "notes/ai/README.md"):
            self.assertTrue((self.root / rel).exists(), rel)
        self.assertFalse((self.root / "manuscript" / "main.md").exists(), "a LaTeX paper gets no Markdown skeleton")
        paper = json.loads((self.root / "paper.json").read_text(encoding="utf-8"))
        self.assertEqual(paper, {"name": "Testarbeit", "format": "latex", "language": "de",
                                 "party": ["grammar-guy", "statistics-nerd", "reviewer-2", "librarian", "architect",
                                           "integrity-guardian", "lay-reader", "style-coach", "terminologist"]})
        self.assertIn("ngerman", (self.root / "manuscript" / "main.tex").read_text(encoding="utf-8"))
        self.assertNotIn("ai-log", (self.root / ".gitignore").read_text(encoding="utf-8").replace("Keep ai-log", ""))

        (self.root / "party.md").write_text("mine", encoding="utf-8")
        again = run("new_paper.py", "--format", "latex", "--lang", "de", "--dir", str(self.root), cwd=self.root)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("party.md (kept", again.stdout)
        self.assertEqual((self.root / "party.md").read_text(encoding="utf-8"), "mine")

    def test_the_party_is_chosen_at_the_start(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            chosen = run("new_paper.py", "--format", "markdown", "--party", "reviewer-2,clinician, architect", "--dir", tmp, cwd=Path(tmp))
            self.assertEqual(chosen.returncode, 0, chosen.stderr)
            paper = json.loads((Path(tmp) / "paper.json").read_text(encoding="utf-8"))
            self.assertEqual(paper["party"], ["reviewer-2", "clinician", "architect"])
            self.assertNotIn("domainPack", paper)
            wrong = run("new_paper.py", "--format", "markdown", "--party", "doctor", "--dir", tmp, cwd=Path(tmp))
            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("not in the catalogue: doctor", wrong.stderr)

    def test_a_paper_can_be_set_up_without_git(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            done = run("new_paper.py", "--format", "markdown", "--versioning", "none", "--dir", tmp, cwd=Path(tmp))
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertIn("without git: nothing is saved automatically", done.stdout)
            self.assertFalse((Path(tmp) / ".git").exists(), "no repository is created")
            paper = json.loads((Path(tmp) / "paper.json").read_text(encoding="utf-8"))
            self.assertEqual(paper["versioning"], "none")
        with tempfile.TemporaryDirectory() as tmp:
            done = run("new_paper.py", "--format", "markdown", "--dir", tmp, cwd=Path(tmp))
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertNotIn("versioning", json.loads((Path(tmp) / "paper.json").read_text(encoding="utf-8")), "git is the default and is left out")

    def test_settings_keep_claude_out_of_the_authors_files(self) -> None:
        text = (self.root / ".claude" / "settings.json").read_text(encoding="utf-8")
        self.assertNotIn("{{", text, "every placeholder is filled")
        settings = json.loads(text)
        deny = settings["permissions"]["deny"]
        for rule in ("Edit(manuscript/**)", "Edit(literature/**)", "Edit(CLAUDE.md)", "Edit(.claude/**)"):
            self.assertIn(rule, deny)
        self.assertNotIn("Edit(scope.md)", deny, "Claude may write down the author's answers in the plan")
        self.assertTrue(settings["sandbox"]["enabled"])
        for path in ("./manuscript", "./literature", "./paper.json", "./.claude"):
            self.assertIn(path, settings["sandbox"]["filesystem"]["denyWrite"])
        self.assertIn("api.crossref.org", settings["sandbox"]["network"]["allowedDomains"], "verify_refs.py keeps working")

    def test_project_layout_puts_the_rules_at_the_workspace_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            for project in ("alpha", "beta"):
                done = run("new_paper.py", "--format", "markdown", "--project", project, "--dir", str(ws), cwd=ws)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertIn("(at the workspace root, merged)", done.stdout)
                self.assertFalse((ws / "projects" / project / ".claude").exists(), "settings in the paper folder would not be read")
            settings = json.loads((ws / ".claude" / "settings.json").read_text(encoding="utf-8"))
            deny = settings["permissions"]["deny"]
            self.assertIn("Edit(projects/alpha/manuscript/**)", deny)
            self.assertIn("Edit(projects/beta/manuscript/**)", deny)
            self.assertEqual(deny.count("Edit(**/manuscript/**)"), 1, "a rule both papers bring is kept once")
            self.assertIn("./projects/beta/literature", settings["sandbox"]["filesystem"]["denyWrite"])
            self.assertEqual((ws / ".active-project").read_text(encoding="utf-8").strip(), "beta")

    def test_upgrade_brings_an_older_workspace_up_to_date_and_keeps_the_authors_copy(self) -> None:
        settings_path = self.root / ".claude" / "settings.json"
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        settings["permissions"]["deny"] = ["Edit(manuscript/**)", "Edit(mine/**)"]
        settings.pop("sandbox")
        settings_path.write_text(json.dumps(settings), encoding="utf-8")
        rules = self.root / "CLAUDE.md"
        rules.write_text("# my old rules\n", encoding="utf-8")
        paper_json = self.root / "paper.json"
        paper_json.write_text(json.dumps({"name": "Testarbeit", "format": "latex", "language": "de", "domainPack": "medicine"}), encoding="utf-8")
        (self.root / "notes" / "ai" / "README.md").unlink()
        (self.root / "party.md").write_text("## everyone\n- my briefing\n", encoding="utf-8")

        dry = run("new_paper.py", "--upgrade", "--dir", str(self.root), cwd=self.root)
        self.assertEqual(dry.returncode, 0, dry.stderr)
        for line in ("deny rule(s)", "the sandbox switched on", "CLAUDE.md: differs", "party roster to add", "+ notes/ai/README.md", "Nothing changed yet."):
            self.assertIn(line, dry.stdout)
        self.assertEqual(rules.read_text(encoding="utf-8"), "# my old rules\n", "a dry run changes nothing")
        self.assertNotIn("sandbox", json.loads(settings_path.read_text(encoding="utf-8")))

        done = run("new_paper.py", "--upgrade", "--apply", "--dir", str(self.root), cwd=self.root)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Upgraded.", done.stdout)
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        self.assertIn("Edit(mine/**)", settings["permissions"]["deny"], "the author's own rule stays")
        self.assertIn("Edit(CLAUDE.md)", settings["permissions"]["deny"])
        self.assertTrue(settings["sandbox"]["enabled"])
        self.assertIn("CoWriting workspace: Testarbeit", rules.read_text(encoding="utf-8"))
        backups = list((self.root / ".cowriting" / "upgrade").glob("*/CLAUDE.md"))
        self.assertEqual(len(backups), 1, "the author's copy is kept once")
        self.assertEqual(backups[0].read_text(encoding="utf-8"), "# my old rules\n")
        paper = json.loads(paper_json.read_text(encoding="utf-8"))
        self.assertIn("clinician", paper["party"], "the medicine pack's clinician stays in the party")
        self.assertNotIn("domainPack", paper)
        self.assertTrue((self.root / "notes" / "ai" / "README.md").exists())
        self.assertEqual((self.root / "party.md").read_text(encoding="utf-8"), "## everyone\n- my briefing\n", "the briefing is the author's")

        again = run("new_paper.py", "--upgrade", "--dir", str(self.root), cwd=self.root)
        self.assertIn("nothing to do", again.stdout)

    # ---------------------------------------------------------------- ailog

    def test_stats_and_list_follow_the_pane(self) -> None:
        stats = run("ailog.py", "stats", cwd=self.root)
        self.assertEqual(stats.returncode, 0, stats.stderr)
        # a1 is annotated, a3 is a live review, a4 only launched a reviewer: a2 alone is owed a classification
        self.assertIn("Turns: 4  unannotated: 1  [AI-TEXT]: 1  changes to your files during AI tool calls: 1 (in the manuscript: 1)", stats.stdout)
        self.assertIn("Bash: manuscript/main.tex", stats.stdout)
        listed = run("ailog.py", "list", cwd=self.root).stdout
        self.assertRegex(listed, r"a1 .*✓ adapted")
        self.assertRegex(listed, r"a2 .*• open .*\[AI-TEXT\]")
        self.assertRegex(listed, r"a3 .*live-review .*· auto")
        self.assertRegex(listed, r"a4 .*· launch")

    def test_annotate_last_takes_the_latest_open_turn(self) -> None:
        done = run("ailog.py", "annotate", "last", "--use", "rejected", "--note", "kept my spelling", cwd=self.root)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Annotated a2 as rejected", done.stdout)
        # the annotation goes to the current month's file, the fixture's file stays as it was
        month = f"{dt.datetime.now(dt.timezone.utc):%Y-%m}"
        lines = (self.root / "ai-log" / f"{month}.jsonl").read_text(encoding="utf-8").splitlines()
        expected = len(FIXTURE) + 1 if month == "2026-10" else 1
        self.assertEqual(len(lines), expected, "annotations are appended, nothing else is touched")
        if month != "2026-10":
            october = (self.root / "ai-log" / "2026-10.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(october), len(FIXTURE), "the fixture's month is untouched")
        self.assertEqual(json.loads(lines[-1])["note"], "kept my spelling")
        self.assertIn("unannotated: 0", run("ailog.py", "stats", cwd=self.root).stdout)
        # the note reaches the prompts appendix, under its turn
        self.assertEqual(run("ailog.py", "prompts", "--lang", "en", "--format", "md", cwd=self.root).returncode, 0)
        self.assertIn("*Comment:* kept my spelling", self.read("ai-prompts.en.md"))
        self.assertEqual(run("ailog.py", "prompts", "--lang", "en", "--format", "tex", cwd=self.root).returncode, 0)
        self.assertIn("\\textit{Comment:} kept my spelling", self.read("ai-prompts.en.tex"))
        ambiguous = run("ailog.py", "annotate", "a", "--use", "info", cwd=self.root)
        self.assertNotEqual(ambiguous.returncode, 0)

    def test_disclosure_in_english_markdown_says_what_is_true(self) -> None:
        self.assertEqual(run("ailog.py", "disclosure", "--lang", "en", "--format", "md", cwd=self.root).returncode, 0)
        text = self.read("ai-register.en.md")
        self.assertIn("# AI register", text)
        self.assertNotIn("technically prevents", text, "the guard refuses and records; it does not make writes impossible")
        self.assertIn("refuses the AI's writes to manuscript files, records any change", text)
        self.assertIn("| Feedback and critique of own text | Claude Code 2.1.300; CoWriting 0.1.0 (claude-opus-5-5) | 1 request, 2026-10-01 to 2026-10-01 | adapted: 1 | Einleitung |", text)
        self.assertIn("| Live review while writing (short hints on changed paragraphs) | Claude Code 2.1.300; CoWriting 0.1.0 (haiku) | 1 request, 2026-10-03 to 2026-10-03 | hints only, no classification required | – |", text)
        self.assertIn("| Checks of field-specific terminology | Claude Code 2.1.300; CoWriting 0.1.0 (claude-opus-5-5) | 1 request, 2026-10-04 to 2026-10-04 | – | – |", text)
        self.assertIn("Grammar, spelling and punctuation corrections ¹", text)
        self.assertIn("- 2026-10-02: Korrigiere Rechtschreibung", text)
        self.assertIn("## Manuscript changes detected during AI tool calls\n\n- 2026-10-04: Bash – manuscript/main.tex", text)
        self.assertIn("Example prompts", text)

    def test_disclosure_in_german_latex_escapes_and_lists_everything(self) -> None:
        self.assertEqual(run("ailog.py", "disclosure", "--lang", "de", "--format", "tex", cwd=self.root).returncode, 0)
        text = self.read("ai-register.de.tex")
        self.assertIn("\\section*{KI-Verzeichnis}", text)
        self.assertIn("Einleitung \\& zu 50\\% der Methodik", text)
        self.assertIn("Live-Review beim Schreiben", text)
        self.assertIn("nur Hinweise, keine Einordnung erforderlich", text)
        self.assertIn("\\subsection*{Während KI-Werkzeugaufrufen festgestellte Änderungen am Manuskript}", text)
        self.assertIn("\\item 2026-10-04: Bash -- manuscript/main.tex".replace("--", "–"), text)
        self.assertEqual(text.count("\\begin{itemize}"), text.count("\\end{itemize}"))
        self.assertIn("weist Schreibzugreifen".replace("zugreifen", "zugriffe"), text)

    def test_disclosure_without_guard_events_says_none(self) -> None:
        log = self.root / "ai-log" / "2026-10.jsonl"
        log.write_text("".join(json.dumps(e) + "\n" for e in FIXTURE if e["type"] != "guard"), encoding="utf-8")
        run("ailog.py", "disclosure", cwd=self.root)
        text = self.read("ai-register.en.md")
        self.assertIn("## Manuscript changes detected during AI tool calls\n\nNone.", text)

    def test_a_rewrite_of_the_log_is_disclosed_in_both_languages(self) -> None:
        log = self.root / "ai-log" / "2026-10.jsonl"
        rewrite = {"type": "guard", "ts": "2026-10-08T10:00:00Z", "session": "s", "paper": "Testarbeit", "tool": "Bash",
                   "input": "python3 tidy.py", "files": ["ai-log/2026-10.jsonl"]}
        log.write_text("".join(json.dumps(e) + "\n" for e in FIXTURE if e["type"] != "guard"), encoding="utf-8")
        run("ailog.py", "disclosure", cwd=self.root)
        self.assertIn("## Attempts to change the AI log afterwards\n\nNone.", self.read("ai-register.en.md"))
        log.write_text("".join(json.dumps(e) + "\n" for e in FIXTURE + [rewrite]), encoding="utf-8")
        run("ailog.py", "disclosure", cwd=self.root)
        text = self.read("ai-register.en.md")
        self.assertIn("- 2026-10-08: Bash – ai-log/2026-10.jsonl\n", text)
        self.assertIn("The log was restored each time", text)
        self.assertNotIn("2026-10-08: Bash", text.split("## Attempts")[0])
        run("ailog.py", "disclosure", "--lang", "de", "--format", "tex", cwd=self.root)
        self.assertIn("Versuche, das KI-Protokoll", self.read("ai-register.de.tex"))

    def test_disclosure_lists_only_manuscript_changes_the_log_keeps_the_rest(self) -> None:
        log = self.root / "ai-log" / "2026-10.jsonl"
        bib = {"type": "guard", "ts": "2026-10-06T10:00:00Z", "session": "s", "paper": "Testarbeit", "tool": "Bash",
               "input": "python3 export.py", "files": ["literature/references.bib"]}
        both = {"type": "guard", "ts": "2026-10-07T10:00:00Z", "session": "s", "paper": "Testarbeit", "tool": "Write",
                "input": "CLAUDE.md", "files": ["CLAUDE.md", "manuscript/ch2.tex"]}
        log.write_text("".join(json.dumps(e) + "\n" for e in FIXTURE + [bib, both]), encoding="utf-8")
        stats = run("ailog.py", "stats", cwd=self.root)
        self.assertIn("changes to your files during AI tool calls: 3 (in the manuscript: 2)", stats.stdout)
        self.assertIn("Bash: literature/references.bib", stats.stdout)
        run("ailog.py", "disclosure", cwd=self.root)
        text = self.read("ai-register.en.md")
        self.assertIn("- 2026-10-04: Bash – manuscript/main.tex\n- 2026-10-07: Write – manuscript/ch2.tex\n", text)
        self.assertNotIn("references.bib", text)
        self.assertNotIn("CLAUDE.md", text)

    def test_prompts_appendix_lists_every_input_in_order(self) -> None:
        self.assertEqual(run("ailog.py", "prompts", "--lang", "de", "--format", "md", "--answers", cwd=self.root).returncode, 0)
        md = self.read("ai-prompts.de.md")
        self.assertIn("# Anhang: KI-Prompts", md)
        self.assertLess(md.index("2026-10-01 10:00"), md.index("2026-10-02 10:00"))
        self.assertIn("### 2026-10-01 10:00 · Feedback und Kritik zum eigenen Text · angepasst (Einleitung)", md)
        self.assertIn("> Gib mir Feedback zur Einleitung & zu 50% der Methodik", md)
        self.assertIn("**Antwort (claude-opus-5-5):**\n\n> Hinweis 1", md)
        self.assertIn("· [AI-TEXT]", md)
        self.assertIn("nur Hinweise, keine Einordnung erforderlich", md)

        self.assertEqual(run("ailog.py", "prompts", "--lang", "en", "--format", "tex", cwd=self.root).returncode, 0)
        tex = self.read("ai-prompts.en.tex")
        self.assertTrue(tex.startswith("\\section*{Appendix: AI prompts}"))
        self.assertEqual(tex.count("\\item "), 4)
        self.assertNotIn("Hinweis 1", tex, "answers only on request")

    def test_a_reply_thread_is_shown_in_the_prompts_appendix(self) -> None:
        thread = [
            {"type": "prompt", "id": "a5", "ts": "2026-10-05T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "terminology",
             "replyTo": "a4", "text": "Reply to The Terminologist (the cowrite:terminologist agent) on its terminology feedback from 10:00, log entry a4. My reply: the field says subjects."},
            {"type": "response", "ref": "a5", "ts": "2026-10-05T10:00:05Z", "model": "m", "personas": ["terminologist"], "agents": {"x": "terminologist"},
             "tools_used": [], "ai_text_flag": False, "answer": "Asking."},
            {"type": "prompt", "id": "a6", "ts": "2026-10-05T10:01:00Z", "session": "s", "paper": "Testarbeit", "category": "terminology",
             "origin": "agent", "agent": "terminologist", "replyTo": "a5", "text": "Fair point for psychology; in medicine it is participants."},
            {"type": "response", "ref": "a6", "ts": "2026-10-05T10:01:05Z", "model": "m", "personas": ["terminologist"],
             "tools_used": [], "ai_text_flag": False, "answer": "The Terminologist concedes for psychology."},
        ]
        with (self.root / "ai-log" / "2026-10.jsonl").open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in thread))
        self.assertEqual(run("ailog.py", "prompts", "--lang", "en", "--format", "md", cwd=self.root).returncode, 0)
        md = self.read("ai-prompts.en.md")
        self.assertIn("2026-10-05 10:00 · Checks of field-specific terminology · in reply to 2026-10-04 10:00", md)
        self.assertIn("2026-10-05 10:01 · Checks of field-specific terminology · report from terminologist · in reply to 2026-10-05 10:00", md)
        self.assertEqual(run("ailog.py", "prompts", "--lang", "de", "--format", "tex", cwd=self.root).returncode, 0)
        self.assertIn("Antwort auf 2026-10-04 10:00", self.read("ai-prompts.de.tex"))

    def test_a_briefing_proposal_is_disclosed_as_its_own_row(self) -> None:
        proposal = [
            {"type": "prompt", "id": "b1", "ts": "2026-10-06T10:00:00Z", "session": "s", "paper": "Testarbeit", "category": "brief-update",
             "origin": "brief", "agent": "terminologist", "text": "Briefing proposal: what The Terminologist should remember from its input a4, for party.md"},
            {"type": "response", "ref": "b1", "ts": "2026-10-06T10:00:05Z", "model": "m", "personas": ["terminologist"],
             "tools_used": [], "ai_text_flag": False, "answer": "- Keep \"subjects\": the field's term."},
            {"type": "annotation", "ref": "b1", "ts": "2026-10-06T10:01:00Z", "use": "adopted", "note": "- Keep \"subjects\": the field's term."},
        ]
        with (self.root / "ai-log" / "2026-10.jsonl").open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in proposal))
        self.assertEqual(run("ailog.py", "disclosure", "--lang", "en", "--format", "md", cwd=self.root).returncode, 0)
        md = self.read("ai-register.en.md")
        self.assertIn("Briefing lines for a reviewer persona", md)
        self.assertIn("were proposed by the model from discussions with the author and taken over only after the author confirmed them", md)
        self.assertEqual(run("ailog.py", "disclosure", "--lang", "de", "--format", "md", cwd=self.root).returncode, 0)
        self.assertIn("übernommen wurden sie erst nach deren Bestätigung", self.read("ai-register.de.md"))
        self.assertEqual(run("ailog.py", "prompts", "--lang", "en", "--format", "md", cwd=self.root).returncode, 0)
        self.assertIn("2026-10-06 10:00 · Briefing lines for a reviewer persona", self.read("ai-prompts.en.md"))

    def test_tool_without_a_paper_explains_itself(self) -> None:
        with tempfile.TemporaryDirectory() as empty:
            failed = run("ailog.py", "stats", cwd=Path(empty))
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("/cowrite:init", failed.stderr)


class PureFunctions(unittest.TestCase):
    def test_tex_escape(self) -> None:
        self.assertEqual(ailog.tex_escape("a & b_c 100% #1 {x} ~ ^"), "a \\& b\\_c 100\\% \\#1 \\{x\\} \\textasciitilde{} \\^{}")
        self.assertEqual(ailog.tex_escape("back\\slash"), "back\\textbackslash{}slash")

    def test_turns_mark_what_the_author_owes(self) -> None:
        by_id = {t["prompt"]["id"]: t for t in ailog.turns(FIXTURE)}
        self.assertEqual([t for t in by_id if by_id[t]["is_open"]], ["a2"])
        self.assertEqual(by_id["a3"]["category"], "live-review")
        self.assertTrue(by_id["a4"]["is_launch"])
        self.assertEqual(len(ailog.guard_events(FIXTURE)), 1)

    def test_bib_fields_are_read_with_braces_and_quotes(self) -> None:
        body = 'title = {The {Big} Study},\n  year = 2020,\n  doi = "10.1000/xyz",\n  author = {A and B}'
        self.assertEqual(verify_refs.field(body, "title"), "The {Big} Study")
        self.assertEqual(verify_refs.field(body, "year"), "2020")
        self.assertEqual(verify_refs.field(body, "doi"), "10.1000/xyz")
        self.assertIsNone(verify_refs.field(body, "journal"))
        self.assertEqual(verify_refs.norm("The {Big} Study: a \\emph{test}"), "the big study a test")

    def test_bib_search_falls_back_to_the_bibliography(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lit = Path(tmp) / "literature"
            lit.mkdir()
            (lit / "references.bib").write_text(
                "@article{smith2020sleep,\n  title = {Sleep and memory},\n  author = {Smith, A},\n  year = {2020},\n  doi = {10.1/abc}\n}\n"
                "@article{jones2019walk,\n  title = {Walking breaks},\n  author = {Jones, B},\n  year = {2019}\n}\n",
                encoding="utf-8",
            )
            before = os.getcwd()
            os.chdir(tmp)
            try:
                hits = zotero_search.from_bib("sleep memory", 10)
            finally:
                os.chdir(before)
        self.assertEqual([h["citekey"] for h in hits], ["smith2020sleep"])
        self.assertEqual(hits[0]["doi"], "10.1/abc")


BIB = (
    "@article{smith2020sleep,\n  title = {Sleep and memory},\n  author = {Smith, A and Lee, B},\n  year = {2020},\n  doi = {https://doi.org/10.1/abc}\n}\n"
    "@book{jones2019walk,\n  title = {Walking breaks},\n  author = {Jones, B},\n  date = {2019-03-01}\n}\n"
)
CSL = json.dumps([
    {"id": "miller2021", "type": "article-journal", "title": "Coffee and attention", "DOI": "10.2/coffee",
     "author": [{"family": "Miller", "given": "C"}, {"literal": "The Coffee Consortium"}], "issued": {"date-parts": [[2021, 5]]}},
    {"id": "nodoi2018", "type": "chapter", "title": "A chapter without a DOI", "author": [{"family": "Novak"}], "issued": {"raw": "2018"}},
])
RIS = (
    "TY  - JOUR\nAU  - Garcia, M.\nAU  - Huang, L.\nTI  - Walking and mood\nPY  - 2022/01/01/\nDO  - 10.3/walk\nER  - \n\n"
    "TY  - JOUR\nAU  - Garcia, M.\nTI  - Walking and sleep\nPY  - 2022\nUR  - https://doi.org/10.3/sleep\nN1  - doi: 10.3/sleep\nER  - \n"
)
NBIB = (
    "PMID- 12345\nTI  - Headache and screen time in\n      adolescents.\nFAU - Schmidt, Anna\nAU  - Schmidt A\nDP  - 2023 Feb 3\n"
    "AID - 10.4/head [doi]\nAID - S0001 [pii]\nPT  - Journal Article\n\n"
)


class Bibliography(unittest.TestCase):
    def write(self, tmp: str) -> Path:
        lit = Path(tmp) / "literature"
        lit.mkdir()
        (lit / "references.bib").write_text(BIB, encoding="utf-8")
        (lit / "zotero.json").write_text(CSL, encoding="utf-8")
        (lit / "endnote.ris").write_text(RIS, encoding="utf-8")
        (lit / "pubmed.nbib").write_text(NBIB, encoding="utf-8")
        (lit / ".verify.json").write_text("{}", encoding="utf-8")
        (lit / "notes.txt").write_text("not a bibliography", encoding="utf-8")
        return lit

    def test_every_format_comes_out_as_the_same_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lit = self.write(tmp)
            self.assertEqual([p.name for p in bibliography.find_files(lit)], ["endnote.ris", "pubmed.nbib", "references.bib", "zotero.json"])
            by_key = {e["key"]: e for e in bibliography.load_all(lit)}
        self.assertEqual(by_key["smith2020sleep"]["doi"], "10.1/abc", "the doi.org prefix is stripped")
        self.assertEqual(by_key["smith2020sleep"]["authors"], ["Smith", "Lee"])
        self.assertEqual(by_key["jones2019walk"]["year"], "2019", "BibLaTeX date gives the year")
        self.assertEqual((by_key["miller2021"]["doi"], by_key["miller2021"]["year"], by_key["miller2021"]["authors"]), ("10.2/coffee", "2021", ["Miller", "The Coffee Consortium"]))
        self.assertEqual(by_key["nodoi2018"]["year"], "2018")
        self.assertFalse(by_key["miller2021"]["derived"])
        self.assertEqual((by_key["garcia2022"]["doi"], by_key["garcia2022"]["title"], by_key["garcia2022"]["derived"]), ("10.3/walk", "Walking and mood", True))
        self.assertEqual(by_key["garcia2022b"]["doi"], "10.3/sleep", "a DOI in a URL or note line is found; colliding derived keys get a letter")
        self.assertEqual((by_key["pmid:12345"]["doi"], by_key["pmid:12345"]["year"], by_key["pmid:12345"]["authors"]), ("10.4/head", "2023", ["Schmidt"]))
        self.assertEqual(by_key["pmid:12345"]["title"], "Headache and screen time in adolescents.", "continuation lines are joined")

    def test_verify_checks_every_file_and_asks_by_title_where_the_doi_is_missing(self) -> None:
        records = {
            "10.1/abc": {"title": ["Sleep and memory"], "issued": {"date-parts": [[2020]]}},
            "10.2/coffee": {"title": ["Tea and attention"], "issued": {"date-parts": [[2021]]}},
            "10.3/walk": None,
            "10.3/sleep": {"title": ["Walking and sleep"], "issued": {"date-parts": [[2022]]}},
            "10.4/head": {"title": ["Headache and screen time in adolescents"], "issued": {"date-parts": [[2023]]}},
        }
        asked = []

        def fake_lookup(title, authors, year, mailto):
            asked.append((title, authors, year))
            return {"DOI": "10.9/found"} if "chapter" in title else None

        with tempfile.TemporaryDirectory() as tmp:
            lit = self.write(tmp)
            before, argv = os.getcwd(), sys.argv
            os.chdir(tmp)
            sys.argv = ["verify_refs.py"]
            verify_refs.crossref, verify_refs.lookup, sleep = lambda doi, mailto: records[doi], fake_lookup, verify_refs.time.sleep
            verify_refs.time.sleep = lambda s: None
            out = io.StringIO()
            try:
                with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as stop:
                    verify_refs.main()
            finally:
                os.chdir(before)
                sys.argv = argv
                verify_refs.time.sleep = sleep
            summary = json.loads((Path(tmp) / ".cowriting" / "verify.json").read_text(encoding="utf-8"))
            self.assertEqual((lit / ".verify.json").read_text(encoding="utf-8"), "{}", "nothing is written into the author's folder")
        text = out.getvalue()
        self.assertEqual(stop.exception.code, 1, "a mismatch or a missing record fails the run")
        self.assertEqual({k: summary[k] for k in ("ok", "mismatch", "not_found", "no_doi", "suggested", "error")},
                         {"ok": 3, "mismatch": 1, "not_found": 1, "no_doi": 2, "suggested": 1, "error": 0})
        self.assertEqual(summary["files"], ["endnote.ris", "pubmed.nbib", "references.bib", "zotero.json"])
        self.assertIn("## zotero.json  (CSL JSON, 2 entries)", text)
        self.assertIn("MISMATCH   miller2021  10.2/coffee", text)
        self.assertIn("NOT FOUND  (garcia2022)  10.3/walk", text)
        self.assertIn("NO DOI     nodoi2018  Crossref lists doi:10.9/found for a title like this: check that it is this work", text)
        self.assertIn("NO DOI     jones2019walk\n", text)
        self.assertIn("Keys in parentheses are derived", text)
        self.assertEqual(sorted(a[0] for a in asked), ["A chapter without a DOI", "Walking breaks"])

    def test_library_search_falls_back_to_every_bibliography_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.write(tmp)
            before = os.getcwd()
            os.chdir(tmp)
            try:
                walking = zotero_search.from_bib("walking", 10)
                coffee = zotero_search.from_bib("coffee consortium", 10)
            finally:
                os.chdir(before)
        self.assertEqual(sorted(h["title"] for h in walking), ["Walking and mood", "Walking and sleep", "Walking breaks"])
        self.assertEqual({h["citekey"] for h in walking}, {"jones2019walk", None}, "RIS records have no citekey to offer")
        self.assertEqual((coffee[0]["citekey"], coffee[0]["authors"], coffee[0]["doi"]), ("miller2021", "Miller, The Coffee Consortium", "10.2/coffee"))


class StyleProfile(unittest.TestCase):
    def test_profile_prints_a_table_for_text_and_latex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models = Path(tmp) / "models"
            models.mkdir()
            (models / "a.txt").write_text(
                "We found that sleep improves memory. However, the effect was small. "
                "It may depend on age. Participants were tested twice.\n\nA second paragraph follows here, with more words in it.",
                encoding="utf-8",
            )
            ms = Path(tmp) / "manuscript"
            ms.mkdir()
            (ms / "main.tex").write_text(
                "\\section{Intro}\nThe data were analysed with care \\cite{x}. The results are shown below. "
                "These findings suggest a link.\n",
                encoding="utf-8",
            )
            done = run("style_profile.py", str(models), str(ms), "--lang", "en", cwd=Path(tmp))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("|", done.stdout)
        self.assertNotIn("Traceback", done.stderr)


if __name__ == "__main__":
    unittest.main()
