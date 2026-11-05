#!/usr/bin/env python3
"""CoWriting AI log: list, annotate, stats, disclosure (AI register) and the prompts appendix.

The log lives in <paper>/ai-log/YYYY-MM.jsonl and is append-only. The
CoWriting plugin writes prompt, response and guard entries; this tool appends
the author's annotations and builds the disclosure from all of them.
Standard library only.

    ailog.py list [--last N]
    ailog.py annotate <id|last> --use adopted|adapted|rejected|info [--chapter X] [--note …]
    ailog.py stats
    ailog.py disclosure [--lang en|de] [--format md|tex]
    ailog.py prompts [--lang en|de] [--format md|tex] [--answers]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

USES = ("adopted", "adapted", "rejected", "info")

# Turns the plugin starts on its own, by origin: they are AI input and are disclosed,
# but the author owes them no classification (the pane does not count them as open).
AUTO_ORIGINS = {"watch": "live-review", "scope": "scope-check", "summary": "change-summary", "brief": "brief-update"}

CATEGORY_LABELS = {
    "en": {
        "literature": "Literature search and source checks",
        "methods": "Methods and statistics feedback",
        "feedback": "Feedback and critique of own text",
        "structure": "Structure and argumentation feedback",
        "language": "Grammar, spelling and punctuation corrections",
        "style": "Hints on writing style (compared with model papers)",
        "terminology": "Checks of field-specific terminology",
        "concepts": "Explanation of concepts",
        "content": "Domain-specific content feedback",
        "integrity": "Research integrity checks",
        "general": "General questions",
        "live-review": "Live review while writing (short hints on changed paragraphs)",
        "scope-check": "Check of the planned points against the text",
        "change-summary": "Description of what the manuscript's diff shows since a piece of feedback (the author classifies)",
        "brief-update": "Briefing lines for a reviewer persona, distilled from a feedback discussion; written to party.md only once the author confirmed them",
    },
    "de": {
        "literature": "Literaturrecherche und Quellenprüfung",
        "methods": "Feedback zu Methodik und Statistik",
        "feedback": "Feedback und Kritik zum eigenen Text",
        "structure": "Feedback zu Aufbau und Argumentation",
        "language": "Korrektur von Grammatik, Rechtschreibung und Zeichensetzung",
        "style": "Hinweise zum Schreibstil (im Vergleich mit Vorbild-Artikeln)",
        "terminology": "Prüfung der Fachterminologie",
        "concepts": "Erklärung von Konzepten",
        "content": "Fachliches Feedback",
        "integrity": "Prüfung guter wissenschaftlicher Praxis",
        "general": "Allgemeine Fragen",
        "live-review": "Live-Review beim Schreiben (kurze Hinweise zu geänderten Absätzen)",
        "scope-check": "Abgleich der geplanten Punkte mit dem Text",
        "change-summary": "Beschreibung, was der Diff des Manuskripts seit einem Hinweis zeigt (die Einordnung trifft die Autorin bzw. der Autor)",
        "brief-update": "Briefing-Zeilen für eine Reviewer-Persona, aus einer Feedback-Diskussion destilliert; erst nach Bestätigung durch die Autorin bzw. den Autor in party.md geschrieben",
    },
}

USE_LABELS = {
    "en": {"adopted": "adopted", "adapted": "adapted", "rejected": "rejected", "info": "information only",
           "open": "not annotated", "auto": "hints only, no classification required"},
    "de": {"adopted": "übernommen", "adapted": "angepasst", "rejected": "verworfen", "info": "nur Information",
           "open": "nicht annotiert", "auto": "nur Hinweise, keine Einordnung erforderlich"},
}


def find_paper(start: Path) -> Path:
    if (start / "paper.json").exists():
        return start
    marker = start / ".active-project"
    if marker.exists():
        root = start / "projects" / marker.read_text(encoding="utf-8").strip()
        if (root / "paper.json").exists():
            return root
    sys.exit("No CoWriting paper here (no paper.json or .active-project). Run /cowrite:init first.")


def read_entries(root: Path) -> list[dict]:
    entries: list[dict] = []
    for path in sorted((root / "ai-log").glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return entries


def turns(entries: list[dict]) -> list[dict]:
    """Prompt + response + latest annotation, for every completed, non-meta turn.

    `is_open` follows the pane: a turn the author owes a classification. Live reviews,
    scope checks and turns that only launched a reviewer (its report is its own turn) are not open.
    """
    responses = {e["ref"]: e for e in entries if e.get("type") == "response"}
    notes = {}
    for e in entries:
        if e.get("type") == "annotation":
            notes[e["ref"]] = e
    out = []
    for p in entries:
        if p.get("type") != "prompt" or p.get("category") == "meta":
            continue
        r = responses.get(p["id"])
        if r is None:
            continue
        a = notes.get(p["id"])
        origin = p.get("origin")
        auto = AUTO_ORIGINS.get(origin or "")
        category = auto or (a or {}).get("category") or p.get("category", "general")
        is_launch = bool(r.get("agents"))
        is_open = a is None and auto is None and not is_launch
        out.append({"prompt": p, "response": r, "annotation": a, "category": category,
                    "is_open": is_open, "is_auto": auto is not None, "is_launch": is_launch})
    return out


def guard_events(entries: list[dict]) -> list[dict]:
    """Changes to the author's files the plugin detected during AI tool calls."""
    return [e for e in entries if e.get("type") == "guard" and not e.get("refused")]


def refused_events(entries: list[dict]) -> list[dict]:
    """Write attempts the guard refused: nothing changed, but the record shows what was tried."""
    return [e for e in entries if e.get("type") == "guard" and e.get("refused")]


def manuscript_files(event: dict) -> list[str]:
    """The manuscript files among a guard event's files: what the disclosure must list."""
    return [f for f in event.get("files", []) if f.lower().startswith("manuscript/")]


def log_files(event: dict) -> list[str]:
    """The AI log's files among a guard event's files: a rewrite that was restored, which the disclosure must list."""
    return [f for f in event.get("files", []) if f.lower().startswith("ai-log/")]


def append(root: Path, entry: dict) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    path = root / "ai-log" / f"{now:%Y-%m}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def squash(text: str, limit: int | None = None) -> str:
    text = " ".join((text or "").split())
    return text if limit is None or len(text) <= limit else text[: limit - 1] + "…"


def cmd_list(root: Path, args) -> None:
    for t in turns(read_entries(root))[-args.last:]:
        p, a = t["prompt"], t["annotation"]
        mark = f"✓ {a['use']}" if a else ("· auto" if t["is_auto"] else "· launch" if t["is_launch"] else "• open")
        flag = " [AI-TEXT]" if t["response"].get("ai_text_flag") else ""
        text = f"↩ report from {p.get('agent', 'a subagent')}" if p.get("origin") == "agent" else squash(p.get("text", ""), 70)
        thread = f" ↳ {p['replyTo']}" if p.get("replyTo") else ""
        print(f"{p['id']}  {p['ts'][:16].replace('T', ' ')}  {t['category']:<12} {mark:<11}{flag} {text}{thread}")


def cmd_annotate(root: Path, args) -> None:
    all_turns = turns(read_entries(root))
    if not all_turns:
        sys.exit("The log has no turns to annotate yet.")
    if args.ref == "last":
        open_turns = [t for t in all_turns if t["is_open"]]
        ref = (open_turns or all_turns)[-1]["prompt"]["id"]
    else:
        matches = [t for t in all_turns if t["prompt"]["id"].startswith(args.ref)]
        if len(matches) != 1:
            sys.exit(f"No unique turn starts with {args.ref!r}.")
        ref = matches[0]["prompt"]["id"]
    entry = {"type": "annotation", "ref": ref, "ts": dt.datetime.now(dt.timezone.utc).isoformat(), "use": args.use}
    for key in ("chapter", "note", "category"):
        value = getattr(args, key)
        if value:
            entry[key] = value
    append(root, entry)
    print(f"Annotated {ref} as {args.use}.")


def cmd_stats(root: Path, args) -> None:
    entries = read_entries(root)
    ts = turns(entries)
    by_cat = Counter(t["category"] for t in ts)
    open_count = sum(1 for t in ts if t["is_open"])
    ai_text = sum(1 for t in ts if t["response"].get("ai_text_flag"))
    guards = guard_events(entries)
    in_manuscript = sum(1 for g in guards if manuscript_files(g))
    print(f"Turns: {len(ts)}  unannotated: {open_count}  [AI-TEXT]: {ai_text}  "
          f"changes to your files during AI tool calls: {len(guards)} (in the manuscript: {in_manuscript})")
    refused = refused_events(entries)
    if refused:
        print(f"Write attempts the guard refused: {len(refused)}")
    for cat, n in by_cat.most_common():
        print(f"  {cat:<12} {n}")
    for g in guards:
        print(f"  ⚠ {g['ts'][:16].replace('T', ' ')}  {g.get('tool', '?')}: {', '.join(g.get('files', []))}  ({squash(g.get('input', ''), 60)})")


TEX_SPECIALS = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
                "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\^{}"}


def tex_escape(s: str) -> str:
    # character by character, so the braces an escape introduces are not escaped again
    return "".join(TEX_SPECIALS.get(ch, ch) for ch in s)


def tool_label(items: list[dict]) -> str:
    """'Claude Code 2.1.300; CoWriting 0.1.0 (claude-opus-5-5)': versions as the log recorded them."""
    engine = sorted({t["response"]["claude_code"] for t in items if t["response"].get("claude_code")})
    plugin = sorted({t["response"]["plugin"] for t in items if t["response"].get("plugin")})
    models = sorted({t["response"].get("model", "unknown") for t in items})
    parts = ["Claude Code" + (" " + ", ".join(engine) if engine else "")]
    if plugin:
        parts.append("CoWriting " + ", ".join(plugin))
    return "; ".join(parts) + (f" ({', '.join(models)})" if models else "")


def paper_name(root: Path) -> str:
    try:
        return json.loads((root / "paper.json").read_text(encoding="utf-8")).get("name") or root.name
    except (OSError, json.JSONDecodeError):
        return root.name


def write_out(root: Path, name: str, lines: list[str]) -> None:
    target = root / "disclosure" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {target}")


def cmd_disclosure(root: Path, args) -> None:
    lang, fmt = args.lang, args.format
    entries = read_entries(root)
    ts = turns(entries)
    groups: dict[str, list[dict]] = defaultdict(list)
    for t in ts:
        groups[t["category"]].append(t)

    labels = CATEGORY_LABELS[lang]
    use_labels = USE_LABELS[lang]
    de = lang == "de"
    rows = []
    for cat, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        dates = sorted(t["prompt"]["ts"][:10] for t in items)
        is_auto = all(t["is_auto"] for t in items)
        # a turn that only launched a reviewer and the report it brought are one request
        requests = max(1, sum(not t["is_launch"] for t in items))
        if is_auto:
            noted = Counter(t["annotation"]["use"] for t in items if t["annotation"])
            use = use_labels["auto"] + ("; " + ", ".join(f"{use_labels[u]}: {n}" for u, n in noted.most_common()) if noted else "")
        else:
            # a turn that only launched a reviewer is classified through its report, not itself
            uses = Counter((t["annotation"] or {}).get("use", "open") for t in items if t["annotation"] or t["is_open"])
            use = ", ".join(f"{use_labels[u]}: {n}" for u, n in uses.most_common()) or "–"
        chapters = sorted({t["annotation"]["chapter"] for t in items if t["annotation"] and t["annotation"].get("chapter")})
        own = [t for t in items if t["prompt"].get("origin") is None]
        examples = [squash(t["prompt"].get("text", ""), 120) for t in own[:3]]
        rows.append({
            "purpose": labels.get(cat, cat),
            "tool": tool_label(items),
            "extent": (
                f"{requests} {'Anfrage' if requests == 1 else 'Anfragen'}, {dates[0]} bis {dates[-1]}" if de
                else f"{requests} {'request' if requests == 1 else 'requests'}, {dates[0]} to {dates[-1]}"
            ),
            "use": use,
            "chapters": ", ".join(chapters) or "–",
            "examples": examples,
            "is_language": cat == "language",
        })
    ai_text = [t for t in ts if t["response"].get("ai_text_flag")]
    guards = guard_events(entries)
    name = paper_name(root)

    title = "KI-Verzeichnis" if de else "AI register (disclosure of AI use)"
    intro = (
        f"Für die Arbeit „{name}“ wurde das generative KI-Modell Claude (Anthropic) über Claude Code mit dem "
        "Plugin CoWriting ausschließlich assistierend eingesetzt: für Hinweise, Rückfragen, Erklärungen und Literaturhilfe. "
        "Der Text des Manuskripts wurde von der Autorin bzw. dem Autor verfasst. Das Plugin weist Schreibzugriffe der KI auf "
        "Manuskriptdateien ab, protokolliert jede Änderung, die es während eines KI-Werkzeugaufrufs dennoch feststellt (siehe unten), "
        "und die Versionsgeschichte des Manuskripts (git) zeigt, wie der Text entstanden ist. Alle KI-Eingaben wurden automatisch "
        "protokolliert (ai-log/)."
        if de else
        f"For “{name}”, the generative AI model Claude (Anthropic) was used via Claude Code with the CoWriting "
        "plugin in an assisting role only: for hints, questions, explanations and literature support. The manuscript text was written "
        "by the author. The plugin refuses the AI's writes to manuscript files, records any change it nevertheless detects during an "
        "AI tool call (listed below), and the manuscript's version history (git) shows how the text came about. All AI interactions "
        "were logged automatically (ai-log/)."
    )
    if any(t["prompt"].get("origin") == "brief" for t in ts):
        intro += (
            " Einzelne Briefing-Zeilen für die Reviewer-Personas (party.md) hat das Modell aus Diskussionen mit der Autorin bzw. dem Autor "
            "vorgeschlagen; übernommen wurden sie erst nach deren Bestätigung."
            if de else
            " Some briefing lines for the reviewer personas (party.md) were proposed by the model from discussions with the author "
            "and taken over only after the author confirmed them."
        )
    head = ["Zweck", "Werkzeug / Modell", "Umfang", "Verwendung", "Kapitel"] if de else ["Purpose", "Tool / model", "Extent", "Use", "Chapters"]
    lang_note = (
        "Reine Sprachkorrekturen (Grammatik/Rechtschreibung) müssen laut DFG in Anträgen nicht offengelegt werden; manche Hochschulen verlangen es dennoch."
        if de else
        "Pure language corrections (grammar/spelling) need no disclosure in DFG proposals; some universities still require it."
    )
    ai_text_head = "Von der KI formulierte Textstellen ([AI-TEXT])" if de else "Text formulated by the AI ([AI-TEXT])"
    guard_head = "Während KI-Werkzeugaufrufen festgestellte Änderungen am Manuskript" if de else "Manuscript changes detected during AI tool calls"
    guard_note = (
        "Jede dieser Änderungen wurde geprüft; was davon im Text blieb, ist oben bzw. unter [AI-TEXT] angegeben."
        if de else
        "Each of these changes was reviewed; what remained in the text is declared above or under [AI-TEXT]."
    )
    refused_head = "Vom Schutz abgewiesene Schreibversuche der KI" if de else "Write attempts by the AI that the guard refused"
    refused_note = (
        "Dadurch wurde nichts geändert. Die Musterprüfung kann auch harmlose Befehle abweisen."
        if de else
        "These changed nothing. The pattern check can also refuse harmless commands."
    )
    log_head = "Nach einem Werkzeugaufruf rückgängig gemachte Änderungen am KI-Protokoll" if de else "Changes to the AI log undone after a tool call"
    log_note = (
        "Das Protokoll wurde jeweils wiederhergestellt; die veränderte Fassung liegt unter .cowriting/log-rewrites/."
        if de else
        "The log was restored each time; the altered version is kept in .cowriting/log-rewrites/."
    )
    none = "Keine." if de else "None."
    examples_head = "Beispielhafte Anfragen" if de else "Example prompts"
    resp = (
        "Die Verantwortung für Inhalt, Quellen und Formulierungen liegt vollständig bei der Autorin bzw. dem Autor. Bitte an die Vorgaben der Zielinstitution anpassen."
        if de else
        "The author bears full responsibility for content, sources and wording. Adapt this statement to the target institution's rules."
    )
    # only the manuscript is declared; a changed bibliography or setting is in the log, not the register
    guard_lines = [f"{g['ts'][:10]}: {g.get('tool', '?')} – {', '.join(manuscript_files(g))}" for g in guards if manuscript_files(g)]
    log_lines = [f"{g['ts'][:10]}: {g.get('tool', '?')} – {', '.join(log_files(g))}" for g in guards if log_files(g)]
    refused_lines = [f"{g['ts'][:10]}: {g.get('tool', '?')} – {squash(g.get('input', ''), 80)}" for g in refused_events(entries)]

    if fmt == "md":
        out = [f"# {title}", "", intro, "", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
        for r in rows:
            out.append(f"| {r['purpose']}{' ¹' if r['is_language'] else ''} | {r['tool']} | {r['extent']} | {r['use']} | {r['chapters']} |")
        out += ["", f"¹ {lang_note}", "", f"## {examples_head}", ""]
        for r in rows:
            if not r["examples"]:
                continue
            out.append(f"**{r['purpose']}**")
            out += [f"- „{e}“" if de else f"- “{e}”" for e in r["examples"]]
            out.append("")
        out += [f"## {ai_text_head}", ""]
        out += [f"- {t['prompt']['ts'][:10]}: {squash(t['prompt'].get('text', ''), 120)}" for t in ai_text] or [none]
        out += ["", f"## {guard_head}", ""]
        out += [f"- {line}" for line in guard_lines] + ([guard_note] if guard_lines else []) or [none]
        out += ["", f"## {log_head}", ""]
        out += [f"- {line}" for line in log_lines] + ([log_note] if log_lines else []) or [none]
        out += ["", f"## {refused_head}", ""]
        out += [f"- {line}" for line in refused_lines] + ([refused_note] if refused_lines else []) or [none]
        out += ["", f"*{resp}*", ""]
    else:
        e = tex_escape
        out = [f"\\section*{{{e(title)}}}", "", e(intro), "", "\\begin{tabular}{p{.22\\linewidth}p{.18\\linewidth}p{.2\\linewidth}p{.2\\linewidth}p{.1\\linewidth}}",
               "\\hline", " & ".join(f"\\textbf{{{e(h)}}}" for h in head) + " \\\\", "\\hline"]
        for r in rows:
            out.append(" & ".join(e(x) for x in (r["purpose"] + (" (1)" if r["is_language"] else ""), r["tool"], r["extent"], r["use"], r["chapters"])) + " \\\\")
        out += ["\\hline", "\\end{tabular}", "", f"\\noindent(1) {e(lang_note)}", "", f"\\subsection*{{{e(examples_head)}}}", "\\begin{itemize}"]
        for r in rows:
            for ex in r["examples"]:
                out.append(f"  \\item \\textit{{{e(r['purpose'])}:}} {e(ex)}")
        out += ["\\end{itemize}", f"\\subsection*{{{e(ai_text_head)}}}"]
        if ai_text:
            out.append("\\begin{itemize}")
            out += [f"  \\item {t['prompt']['ts'][:10]}: {e(squash(t['prompt'].get('text', ''), 120))}" for t in ai_text]
            out.append("\\end{itemize}")
        else:
            out.append(e(none))
        out += [f"\\subsection*{{{e(guard_head)}}}"]
        if guard_lines:
            out += ["\\begin{itemize}"] + [f"  \\item {e(line)}" for line in guard_lines] + ["\\end{itemize}", e(guard_note)]
        else:
            out.append(e(none))
        out += [f"\\subsection*{{{e(log_head)}}}"]
        if log_lines:
            out += ["\\begin{itemize}"] + [f"  \\item {e(line)}" for line in log_lines] + ["\\end{itemize}", e(log_note)]
        else:
            out.append(e(none))
        out += [f"\\subsection*{{{e(refused_head)}}}"]
        if refused_lines:
            out += ["\\begin{itemize}"] + [f"  \\item {e(line)}" for line in refused_lines] + ["\\end{itemize}", e(refused_note)]
        else:
            out.append(e(none))
        out += ["", f"\\textit{{{e(resp)}}}", ""]

    write_out(root, f"ai-register.{lang}.{fmt}", out)


def cmd_prompts(root: Path, args) -> None:
    """The prompts appendix some universities ask for: every AI input in order, with the author's classification."""
    lang, fmt = args.lang, args.format
    de = lang == "de"
    labels, use_labels = CATEGORY_LABELS[lang], USE_LABELS[lang]
    ts = turns(read_entries(root))
    name = paper_name(root)
    title = "Anhang: KI-Prompts" if de else "Appendix: AI prompts"
    intro = (
        f"Alle Eingaben an das KI-System für die Arbeit „{name}“, in zeitlicher Reihenfolge, mit der Einordnung durch die Autorin bzw. den Autor. "
        "Automatisch gestartete Live-Reviews und Abgleiche sind als solche gekennzeichnet."
        if de else
        f"Every input to the AI system for “{name}”, in order, with the author's classification. "
        "Live reviews and checks the plugin started on its own are marked as such."
    )
    answer_head = "Antwort" if de else "Answer"
    note_head = "Kommentar" if de else "Comment"
    when_of = {t["prompt"]["id"]: t["prompt"]["ts"][:16].replace("T", " ") for t in ts}

    def heading(t: dict) -> str:
        p, a = t["prompt"], t["annotation"]
        when = p["ts"][:16].replace("T", " ")
        use = use_labels[a["use"]] if a else use_labels["auto" if t["is_auto"] else "open"]
        chapter = f" ({a['chapter']})" if a and a.get("chapter") else ""
        report = (" · " + ("Bericht von " if de else "report from ") + p.get("agent", "?")) if p.get("origin") == "agent" else ""
        # a reply thread: the author's reply names the input it answers, the persona's answer names the reply
        ref = p.get("replyTo")
        reply = (" · " + ("Antwort auf " if de else "in reply to ") + when_of.get(ref, ref)) if ref else ""
        flag = " · [AI-TEXT]" if t["response"].get("ai_text_flag") else ""
        return f"{when} · {labels.get(t['category'], t['category'])}{report}{reply} · {use}{chapter}{flag}"

    if fmt == "md":
        out = [f"# {title}", "", intro, ""]
        for t in ts:
            out += [f"### {heading(t)}", ""]
            out += ["> " + line for line in (t["prompt"].get("text", "").strip() or "–").splitlines()] + [""]
            if args.answers:
                out += [f"**{answer_head} ({t['response'].get('model', '?')}):**", ""]
                out += ["> " + line for line in (t["response"].get("answer", "").strip() or "–").splitlines()] + [""]
            if t["annotation"] and t["annotation"].get("note"):
                out += [f"*{note_head}:* {t['annotation']['note']}", ""]
    else:
        e = tex_escape
        out = [f"\\section*{{{e(title)}}}", "", e(intro), "", "\\begin{enumerate}"]
        for t in ts:
            out.append(f"  \\item \\textbf{{{e(heading(t))}}} \\\\")
            out.append("  " + e(squash(t["prompt"].get("text", "")) or "–"))
            if args.answers:
                out.append(f"  \\\\ \\textit{{{e(answer_head)} ({e(t['response'].get('model', '?'))}):}} {e(squash(t['response'].get('answer', '')))}")
            if t["annotation"] and t["annotation"].get("note"):
                out.append(f"  \\\\ \\textit{{{e(note_head)}:}} {e(squash(t['annotation']['note']))}")
        out += ["\\end{enumerate}", ""]
    write_out(root, f"ai-prompts.{lang}.{fmt}", out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, help="paper folder (default: found from the current folder)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--last", type=int, default=10)
    p = sub.add_parser("annotate")
    p.add_argument("ref", help="turn id (or a unique prefix), or 'last' for the latest unannotated turn")
    p.add_argument("--use", choices=USES, required=True)
    p.add_argument("--chapter")
    p.add_argument("--note")
    p.add_argument("--category")
    sub.add_parser("stats")
    for name in ("disclosure", "prompts"):
        p = sub.add_parser(name)
        p.add_argument("--lang", choices=("en", "de"), default="en")
        p.add_argument("--format", choices=("md", "tex"), default="md")
        if name == "prompts":
            p.add_argument("--answers", action="store_true", help="include the AI's answers")
    args = parser.parse_args()
    root = args.root or find_paper(Path.cwd())
    {"list": cmd_list, "annotate": cmd_annotate, "stats": cmd_stats, "disclosure": cmd_disclosure, "prompts": cmd_prompts}[args.cmd](root, args)


if __name__ == "__main__":
    main()
