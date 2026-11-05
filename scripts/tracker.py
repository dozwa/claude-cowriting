#!/usr/bin/env python3
"""The road to the next release: features, requirements, stories, findings and results.

dev/tracker.json holds the data, docs/tracker.md is generated from it, and
docs/test-plan.md says how the tests are run. Standard library only.

    tracker.py status                  progress and what is next
    tracker.py set F8 pass --surface terminal --by G --note "…"
    tracker.py set R6.1 met --note "…"
    tracker.py set S7.1 pass --by M
    tracker.py set M-vscode pass --by M
    tracker.py finding 1 accepted --note "…"
    tracker.py tier F8 2
    tracker.py render                  regenerate docs/tracker.md
    tracker.py check                   is the data whole, and the doc current?
    tracker.py gate [--no-suites]      may the release go out? exit 1 lists what blocks it
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SURFACES = ("terminal", "vscode", "desktop")
SURFACE_LABELS = {"terminal": "T", "vscode": "V", "desktop": "D", "any": "any"}
TIERS = ("1", "1b", "2", "3")
MUST_TIERS = ("1", "1b")  # must work for the release; tier 2 should, tier 3 may
RESULT_STATES = ("untested", "testing", "pass", "fail", "deferred")
REQUIREMENT_STATES = ("met", "partly", "open", "outdated", "deferred")
FINDING_STATES = ("open", "fixed", "accepted")
TEST_TYPES = ("U", "G", "E", "B", "S", "M", "H")
MARKS = {"untested": "·", "testing": "…", "pass": "✓", "fail": "✗", "deferred": "–"}
SUITES = (
    ("Python tests", ("python3", "-m", "unittest", "discover", "-s", "plugin/tests", "-p", "test_*.py")),
    ("Hook tests", ("claude", "plugin", "test", "plugin")),
    ("Plugin validation", ("claude", "plugin", "validate", "plugin")),
)


class Refused(Exception):
    """A command that cannot do what was asked; the message says why."""


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def git(*args: str) -> str | None:
    try:
        run = subprocess.run(("git", *args), cwd=ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return run.stdout.strip()


def plugin_version() -> str:
    try:
        return load(ROOT / "plugin/.claude-plugin/plugin.json")["version"]
    except (OSError, KeyError, ValueError):
        return "?"


# ----- what counts as done -----


def feature_state(feature: dict) -> str:
    """One word for a feature across its surfaces: it passes only where all of them pass."""
    states = set(feature["status"].values())
    if states == {"deferred"}:
        return "deferred"
    if "fail" in states:
        return "fail"
    if states <= {"pass", "deferred"}:
        return "pass"
    return "testing" if states & {"testing", "pass"} else "untested"


def criteria(data: dict) -> list[dict]:
    return [c for story in data["stories"] for c in story["criteria"]]


def blockers(data: dict) -> list[str]:
    """Everything that stands between the data and the release, by the gate's rules."""
    found = []
    for f in (f for f in data["features"] if f["tier"] in MUST_TIERS):
        open_surfaces = [s for s, state in f["status"].items() if state not in ("pass", "deferred")]
        if open_surfaces:
            where = ", ".join(f"{s}: {f['status'][s]}" for s in open_surfaces)
            found.append(f"Feature {f['id']} {f['name']} ({where})")
    for r in data["requirements"]:
        if r["status"] not in ("met", "deferred"):
            found.append(f"Requirement {r['id']} {r['text']} ({r['status']})")
    for n in data["findings"]:
        if n["status"] == "open":
            found.append(f"Finding {n['id']} {n['title']} (open)")
    for c in (c for story in data["stories"] if story["tier"] in MUST_TIERS for c in story["criteria"]):
        if c["status"] not in ("pass", "deferred"):
            found.append(f"Criterion {c['id']} {c['text']} ({c['status']})")
    for m in data["manual"]:
        if m["blocking"] and m["status"] not in ("pass", "deferred"):
            found.append(f"Manual run {m['id']} {m['name']} ({m['status']})")
    return found


def known_gaps(data: dict, tier: str) -> list[str]:
    """What does not block the release but does not work yet, or is not confirmed: the changelog names it."""
    found = [f"{f['id']} {f['name']}" for f in data["features"] if f["tier"] == tier and feature_state(f) not in ("pass", "deferred")]
    for story in (s for s in data["stories"] if s["tier"] == tier):
        found += [f"{c['id']} {c['text']}" for c in story["criteria"] if c["status"] not in ("pass", "deferred")]
    return found


def stale_results(data: dict) -> list[str]:
    """Passes recorded before the plugin last changed: still counted, worth a second look."""
    head = git("log", "-1", "--format=%H", "--", "plugin")
    if not head:
        return []
    latest: dict[tuple[str, str], dict] = {}
    for entry in data["history"]:
        latest[(entry["id"], entry.get("surface", ""))] = entry
    stale = []
    for (item, surface), entry in latest.items():
        if entry["status"] != "pass" or not entry.get("commit"):
            continue
        behind = git("rev-list", "--count", f"{entry['commit']}..{head}")
        if behind and int(behind) > 0:
            stale.append(f"{item} {surface}".strip())
    return stale


def run_suites() -> list[str]:
    failed = []
    for name, command in SUITES:
        try:
            run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            ok = run.returncode == 0
        except OSError:
            ok = False
        print(f"{'pass' if ok else 'FAIL'}  {name}")
        if not ok:
            failed.append(f"Suite {name} fails")
    return failed


# ----- is the data whole? -----


def problems(data: dict, doc: Path | None = None) -> list[str]:
    found = []
    features = data["features"]
    requirement_ids = {r["id"] for r in data["requirements"]}
    feature_ids = {f["id"] for f in features}
    all_ids = [f["id"] for f in features] + [r["id"] for r in data["requirements"]]
    all_ids += [s["id"] for s in data["stories"]] + [c["id"] for c in criteria(data)] + [m["id"] for m in data["manual"]]
    for item in sorted({i for i in all_ids if all_ids.count(i) > 1}):
        found.append(f"{item} is used twice")

    for f in features:
        if f["tier"] not in TIERS:
            found.append(f"{f['id']} has the unknown tier {f['tier']}")
        for r in f["reqs"]:
            if r not in requirement_ids:
                found.append(f"{f['id']} names the unknown requirement {r}")
        surfaces = set(f["status"])
        if surfaces != {"any"} and surfaces != set(SURFACES):
            found.append(f"{f['id']} must apply to `any` or to all of {', '.join(SURFACES)}")
        for state in f["status"].values():
            if state not in RESULT_STATES:
                found.append(f"{f['id']} has the unknown status {state}")
    for r in data["requirements"]:
        if r["status"] not in REQUIREMENT_STATES:
            found.append(f"{r['id']} has the unknown status {r['status']}")
    for n in data["findings"]:
        if n["status"] not in FINDING_STATES:
            found.append(f"Finding {n['id']} has the unknown status {n['status']}")
    for s in data["stories"]:
        if s["tier"] not in TIERS:
            found.append(f"{s['id']} has the unknown tier {s['tier']}")
        for item in s["features"]:
            if item not in feature_ids:
                found.append(f"{s['id']} names the unknown feature {item}")
        for item in s.get("reqs", []):
            if item not in requirement_ids:
                found.append(f"{s['id']} names the unknown requirement {item}")
        for c in s["criteria"]:
            if c["status"] not in RESULT_STATES:
                found.append(f"{c['id']} has the unknown status {c['status']}")

    # everything the plugin ships must be somewhere in the map
    for key, label, on_disk in (
        ("skills", "skill", {p.parent.name for p in (ROOT / "plugin/skills").glob("*/SKILL.md")}),
        ("agents", "agent", {p.stem for p in (ROOT / "plugin/agents").glob("*.md")}),
        ("tools", "tool", {p.stem for p in (ROOT / "plugin/tools").glob("*.py")}),
    ):
        mapped = {name for f in features for name in f.get(key, [])}
        for name in sorted(on_disk - mapped):
            found.append(f"The {label} {name} is in the plugin but in no feature")
        for name in sorted(mapped - on_disk):
            found.append(f"The {label} {name} is in the map but not in the plugin")

    if doc is not None and (not doc.exists() or doc.read_text(encoding="utf-8") != render(data)):
        found.append(f"{doc.name} is not current: run `tracker.py render`")
    return found


# ----- the generated document -----


def bar(done: int, total: int, width: int = 12) -> str:
    filled = round(width * done / total) if total else 0
    return "▰" * filled + "▱" * (width - filled)


def progress_row(label: str, states: list[str]) -> str:
    done = sum(s in ("pass", "deferred") for s in states)
    failing = states.count("fail")
    return f"| {label} | {bar(done, len(states))} | {done} / {len(states)} | {failing} |"


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def status_cell(feature: dict) -> str:
    return " ".join(f"{SURFACE_LABELS[s]} {MARKS[state]}" for s, state in feature["status"].items())


def render(data: dict) -> str:
    features = data["features"]
    lines = [
        f"# The road to CoWriting {data['target']}",
        "",
        "Generated by `scripts/tracker.py` from `dev/tracker.json`; do not edit by hand. How tests are run: [test-plan.md](test-plan.md).",
        "",
        f"**Marks:** {MARKS['pass']} pass, {MARKS['fail']} fail, {MARKS['untested']} untested, {MARKS['testing']} testing, {MARKS['deferred']} deferred. **Surfaces:** T terminal, V VS Code, D desktop app, `any` the same code on every surface.",
        "",
        f"## The {data['target']} gate",
        "",
        *[f"{i}. {rule}" for i, rule in enumerate(data["gate"], 1)],
        "",
        f"**Open blockers: {len(blockers(data))}.** Not blocking, for the changelog if still open at release: {len(known_gaps(data, '2'))} in tier 2, {len(known_gaps(data, '3'))} in tier 3.",
        "",
        "## Progress",
        "",
        "| | Progress | Done | Failing |",
        "|---|---|---|---|",
        progress_row("**Features**", [feature_state(f) for f in features]),
    ]
    for tier in TIERS:
        lines.append(progress_row(f"Tier {tier}", [feature_state(f) for f in features if f["tier"] == tier]))
    for area in dict.fromkeys(f["area"] for f in features):
        lines.append(progress_row(area, [feature_state(f) for f in features if f["area"] == area]))
    lines.append(progress_row("**Acceptance criteria**", [c["status"] for c in criteria(data)]))
    requirement_states = ["pass" if r["status"] in ("met", "deferred") else "untested" for r in data["requirements"]]
    lines.append(progress_row("**Requirements met**", requirement_states))
    finding_states = ["untested" if n["status"] == "open" else "pass" for n in data["findings"]]
    lines.append(progress_row("**Findings settled**", finding_states))
    lines.append(progress_row("**Manual runs**", [m["status"] for m in data["manual"] if m["blocking"]]))

    lines += ["", "## Findings", "", "| # | Status | Finding | Evidence | Why it matters |", "|---|---|---|---|---|"]
    for n in data["findings"]:
        status = n["status"] + (f": {n['note']}" if n.get("note") else "")
        lines.append(f"| {n['id']} | {cell(status)} | {cell(n['title'])} | {cell(n['evidence'])} | {cell(n['why'])} |")

    lines += ["", "## Features", "", "Impact: **Trust**, the promise or the signed disclosure is wrong; **Flow**, the daily loop breaks; **Help**, one kind of help is worse; **Extra**, nice to have.", ""]
    for area in dict.fromkeys(f["area"] for f in features):
        lines += [f"### {area}", "", "| ID | Feature | Tier | Status | Req | Automated today | To add | Impact |", "|---|---|---|---|---|---|---|---|"]
        for f in (f for f in features if f["area"] == area):
            reqs = ", ".join(f["reqs"]) or "–"
            lines.append(f"| {f['id']} | {cell(f['name'])} | {f['tier']} | {status_cell(f)} | {reqs} | {cell(f['automated'])} | {cell(f['add'])} | {f['impact']} |")
        lines.append("")

    lines += ["## Requirements", "", "| ID | Requirement | Status | Note |", "|---|---|---|---|"]
    for r in data["requirements"]:
        lines.append(f"| {r['id']} | {cell(r['text'])} | {r['status']} | {cell(r.get('note', ''))} |")

    lines += ["", "## User stories and acceptance criteria", "", "A criterion must hold on all three surfaces.", ""]
    for s in data["stories"]:
        linked = ", ".join(s["features"] + s.get("reqs", []))
        lines += [f"**{s['id']} {s['title']}** (tier {s['tier']}; {linked}). {s['story']}", ""]
        lines += [f"- {MARKS[c['status']]} {c['id']}: {c['text']}" + (f" *({c['note']})*" if c.get("note") else "") for c in s["criteria"]]
        lines.append("")

    lines += ["## Manual runs", "", "| ID | Run | Status | Blocks the release |", "|---|---|---|---|"]
    for m in data["manual"]:
        lines.append(f"| {m['id']} | {cell(m['name'])} | {MARKS[m['status']]} | {'yes' if m['blocking'] else 'no'} |")

    lines += ["", "## Latest results", ""]
    if not data["history"]:
        lines.append("No results recorded yet.")
    else:
        lines += ["| Date | Item | Surface | Result | By | Version | Commit | Note |", "|---|---|---|---|---|---|---|---|"]
        for e in reversed(data["history"][-20:]):
            lines.append(f"| {e['date']} | {e['id']} | {e.get('surface', '')} | {e['status']} | {e.get('by', '')} | {e['version']} | {e.get('commit', '')} | {cell(e.get('note', ''))} |")
    return "\n".join(lines) + "\n"


# ----- commands -----


def find_item(data: dict, item: str) -> tuple[str, dict]:
    for kind, items in (("feature", data["features"]), ("requirement", data["requirements"]), ("criterion", criteria(data)), ("manual", data["manual"])):
        for entry in items:
            if entry["id"] == item:
                return kind, entry
    raise Refused(f"No feature, requirement, criterion or manual run is called {item}. A story is settled through its criteria, such as S1.1.")


def cmd_set(data: dict, args: argparse.Namespace) -> str:
    kind, entry = find_item(data, args.id)
    states = REQUIREMENT_STATES if kind == "requirement" else RESULT_STATES
    if args.status not in states:
        raise Refused(f"A {kind} is one of: {', '.join(states)}.")
    if args.status == "deferred" and not args.note:
        raise Refused("Deferring needs a reason: add --note.")
    if kind != "requirement" and args.status in ("pass", "fail") and args.by not in TEST_TYPES:
        raise Refused(f"A result says which test gave it: --by {'|'.join(TEST_TYPES)} (see docs/test-plan.md).")

    surfaces = [""]
    if kind == "feature":
        applies = list(entry["status"])
        if args.surface == "all":
            surfaces = applies
        elif args.surface in applies:
            surfaces = [args.surface]
        elif args.surface is None and applies == ["any"]:
            surfaces = ["any"]
        else:
            raise Refused(f"{args.id} applies to: {', '.join(applies)}. Name one with --surface, or all.")
        for surface in surfaces:
            entry["status"][surface] = args.status
    elif args.surface:
        raise Refused(f"--surface is for features; {args.id} is a {kind}.")
    else:
        entry["status"] = args.status
        if kind == "criterion" or kind == "requirement":
            if args.note:
                entry["note"] = args.note
            elif args.status in ("pass", "met"):
                entry.pop("note", None)

    for surface in surfaces:
        record = {"date": date.today().isoformat(), "id": args.id, "status": args.status, "version": plugin_version()}
        record.update({k: v for k, v in (("surface", surface), ("by", args.by), ("commit", git("rev-parse", "--short", "HEAD")), ("note", args.note)) if v})
        data["history"].append(record)
    where = f" ({', '.join(surfaces)})" if surfaces != [""] else ""
    return f"{args.id}{where}: {args.status}"


def cmd_finding(data: dict, args: argparse.Namespace) -> str:
    for n in data["findings"]:
        if str(n["id"]) == args.id:
            if args.status != "open" and not args.note:
                raise Refused("Settling a finding needs a note: what was fixed, or why it is accepted and where the README states it.")
            n["status"] = args.status
            if args.note:
                n["note"] = args.note
            else:
                n.pop("note", None)
            record = {"date": date.today().isoformat(), "id": f"Finding {n['id']}", "status": args.status, "version": plugin_version()}
            record.update({k: v for k, v in (("commit", git("rev-parse", "--short", "HEAD")), ("note", args.note)) if v})
            data["history"].append(record)
            return f"Finding {n['id']}: {args.status}"
    raise Refused(f"There is no finding {args.id}.")


def cmd_tier(data: dict, args: argparse.Namespace) -> str:
    if args.tier not in TIERS:
        raise Refused(f"A tier is one of: {', '.join(TIERS)}.")
    for entry in [*data["features"], *data["stories"]]:
        if entry["id"] == args.id:
            entry["tier"] = args.tier
            return f"{args.id}: tier {args.tier}"
    raise Refused(f"No feature or story is called {args.id}.")


def cmd_status(data: dict) -> int:
    features = data["features"]
    print(f"The road to {data['target']}: {len(blockers(data))} open blockers\n")
    width = 26
    def row(label: str, states: list[str]) -> None:
        done = sum(s in ("pass", "deferred") for s in states)
        fails = states.count("fail")
        print(f"{label:<{width}}{bar(done, len(states))} {done:>3} / {len(states):<3}" + (f"  {fails} failing" if fails else ""))
    row("Features", [feature_state(f) for f in features])
    for tier in TIERS:
        row(f"  Tier {tier}", [feature_state(f) for f in features if f["tier"] == tier])
    row("Acceptance criteria", [c["status"] for c in criteria(data)])
    row("Requirements met", ["pass" if r["status"] in ("met", "deferred") else "untested" for r in data["requirements"]])
    row("Findings settled", ["untested" if n["status"] == "open" else "pass" for n in data["findings"]])
    row("Manual runs", [m["status"] for m in data["manual"] if m["blocking"]])

    print("\nNext:")
    order = sorted((f for f in features if feature_state(f) not in ("pass", "deferred")), key=lambda f: TIERS.index(f["tier"]))
    failing = [f for f in order if feature_state(f) == "fail"]
    for f in (failing + [f for f in order if f not in failing])[:5]:
        print(f"  {f['id']:<4} tier {f['tier']:<3} {status_cell(f):<22} {f['name']}")
    stale = stale_results(data)
    if stale:
        print(f"\nRecorded before the plugin last changed: {', '.join(stale)}")
    return 0


def cmd_gate(data: dict, args: argparse.Namespace) -> int:
    found = blockers(data)
    if args.no_suites:
        print("Suites skipped: this is not a release verdict.")
    else:
        found += run_suites()
    stale = stale_results(data)
    if stale:
        print(f"Worth a second look, recorded before the plugin last changed: {', '.join(stale)}")
    deferred = [f"{f['id']} {f['name']}" for f in data["features"] if "deferred" in f["status"].values()]
    if deferred:
        print(f"Deferred, to be named in the changelog: {'; '.join(deferred)}")
    gaps = known_gaps(data, "2")
    if gaps:
        print(f"Tier 2 should work, not yet confirmed ({len(gaps)}), to be named in the changelog if it stays so:")
        for line in gaps:
            print(f"  - {line}")
    optional = known_gaps(data, "3")
    if optional:
        print(f"Tier 3 not yet confirmed: {len(optional)}")
    if found:
        print(f"\n{data['target']} may not go out yet. {len(found)} blockers:")
        for line in found:
            print(f"  - {line}")
        return 1
    print(f"\nThe gate for {data['target']} is open. The release itself stays the author's call.")
    return 0


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    top.add_argument("--data", type=Path, default=ROOT / "dev/tracker.json")
    top.add_argument("--doc", type=Path, default=ROOT / "docs/tracker.md")
    sub = top.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("render")
    sub.add_parser("check")
    p = sub.add_parser("gate")
    p.add_argument("--no-suites", action="store_true", help="skip running the test suites; not a release verdict")
    p = sub.add_parser("set")
    p.add_argument("id")
    p.add_argument("status")
    p.add_argument("--surface", choices=(*SURFACES, "any", "all"))
    p.add_argument("--by", help="the test type that gave this result: " + ", ".join(TEST_TYPES))
    p.add_argument("--note")
    p = sub.add_parser("finding")
    p.add_argument("id")
    p.add_argument("status", choices=FINDING_STATES)
    p.add_argument("--note")
    p = sub.add_parser("tier")
    p.add_argument("id")
    p.add_argument("tier")
    return top


def main() -> int:
    args = parser().parse_args()
    data = load(args.data)
    try:
        if args.cmd == "status":
            return cmd_status(data)
        if args.cmd == "gate":
            return cmd_gate(data, args)
        if args.cmd == "check":
            found = problems(data, args.doc)
            for line in found:
                print(line)
            print("The tracker is whole and the doc is current." if not found else f"{len(found)} problems.")
            return 1 if found else 0
        if args.cmd == "render":
            message = f"Wrote {args.doc}"
        else:
            message = {"set": cmd_set, "finding": cmd_finding, "tier": cmd_tier}[args.cmd](data, args)
            save(args.data, data)
        args.doc.write_text(render(data), encoding="utf-8")
        print(message)
        return 0
    except Refused as refusal:
        print(refusal, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
