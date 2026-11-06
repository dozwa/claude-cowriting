#!/usr/bin/env python3
"""Verify the author's references against Crossref.

Reads every bibliography file under literature/ (BibTeX/BibLaTeX, CSL JSON,
RIS, PubMed .nbib; see bibliography.py), or the files given. Prints one line
per entry:

    OK          the DOI resolves and title and year agree
    MISMATCH    the DOI resolves to a different title or year
    NOT FOUND   Crossref has no record for the DOI
    NO DOI      the entry has none; Crossref is asked by title, and a DOI it
                lists for a title like this is shown for the author to check
    ERROR       network trouble

and writes a summary to .cowriting/verify.json in the paper (read by the
CoWriting pane). Run it from the paper's folder.
Keys in parentheses are derived: the file (RIS, PubMed) carries no citekey.
Standard library only.

    python3 verify_refs.py [literature/references.bib …] [--mailto you@example.org] [--no-lookup]
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bibliography  # noqa: E402

field = bibliography.bib_field  # kept for callers of the first version
norm = bibliography.norm
ENTRY = bibliography.BIB_ENTRY

API = "https://api.crossref.org/works"


def _request(url: str, mailto: str | None):
    agent = "CoWriting-verify-refs/0.2" + (f" (mailto:{mailto})" if mailto else "")
    req = urllib.request.Request(url, headers={"User-Agent": agent})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)["message"]


def crossref(doi: str, mailto: str | None) -> dict | None:
    """The Crossref record of a DOI, or None if it has none."""
    try:
        return _request(API + "/" + urllib.parse.quote(doi, safe="/:;()"), mailto)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise


def lookup(title: str, authors: list[str], year: str, mailto: str | None) -> dict | None:
    """Crossref's best record for a title, if its title is close and the year agrees."""
    if len(norm(title)) < 15:
        return None
    query = " ".join(x for x in [title, authors[0] if authors else "", year] if x)
    params = urllib.parse.urlencode({"query.bibliographic": query, "rows": 3, "select": "DOI,title,issued"})
    msg = _request(f"{API}?{params}", mailto)
    for item in msg.get("items") or []:
        remote_title, remote_year = record_title_year(item)
        if similar(title, remote_title) and (not year or not remote_year or year == remote_year):
            return item
    return None


def record_title_year(msg: dict) -> tuple[str, str]:
    title = (msg.get("title") or [""])[0]
    parts = (msg.get("issued") or {}).get("date-parts") or [[None]]
    return title, str(parts[0][0] or "")


def similar(a: str, b: str) -> bool:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.85


def shown(e: dict) -> str:
    return f"({e['key']})" if e["derived"] else e["key"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", type=Path, nargs="*", help="bibliography files; default: every one under literature/")
    parser.add_argument("--mailto", help="your e-mail for Crossref's polite pool (optional)")
    parser.add_argument("--no-lookup", action="store_true", help="don't ask Crossref by title for entries without a DOI")
    args = parser.parse_args()

    files = args.files or bibliography.find_files(Path("literature"))
    if not files:
        print("No bibliography found: nothing under literature/ with .bib, .json (CSL), .ris or .nbib, and no file given.")
        sys.exit(2)

    counts = {"ok": 0, "mismatch": 0, "not_found": 0, "no_doi": 0, "suggested": 0, "error": 0}
    derived_seen = False
    for path in files:
        entries = bibliography.load(path)
        print(f"## {path.name}  ({bibliography.format_name(path)}, {len(entries)} {'entry' if len(entries) == 1 else 'entries'})")
        for e in entries:
            key = shown(e)
            derived_seen = derived_seen or e["derived"]
            if not e["doi"]:
                counts["no_doi"] += 1
                if args.no_lookup:
                    print(f"NO DOI     {key}")
                    continue
                try:
                    hit = lookup(e["title"], e["authors"], e["year"], args.mailto)
                except Exception as err:
                    print(f"NO DOI     {key}  (title lookup failed: {err})")
                    continue
                if hit:
                    counts["suggested"] += 1
                    print(f"NO DOI     {key}  Crossref lists doi:{hit.get('DOI')} for a title like this: check that it is this work")
                else:
                    print(f"NO DOI     {key}")
                time.sleep(0.2)
                continue
            try:
                msg = crossref(e["doi"], args.mailto)
            except Exception as err:  # network trouble is reported, not fatal
                counts["error"] += 1
                print(f"ERROR      {key}  {e['doi']}  ({err})")
                continue
            if msg is None:
                counts["not_found"] += 1
                print(f"NOT FOUND  {key}  {e['doi']}")
                continue
            remote_title, remote_year = record_title_year(msg)
            if similar(e["title"], remote_title) and (not e["year"] or not remote_year or e["year"] == remote_year):
                counts["ok"] += 1
                print(f"OK         {key}")
            else:
                counts["mismatch"] += 1
                print(f"MISMATCH   {key}  {e['doi']}\n           file:     {e['title']} ({e['year']})\n           crossref: {remote_title} ({remote_year})")
            time.sleep(0.2)

    # The summary goes to one of Claude's places, never into literature/ (the author's folder,
    # which the workspace's sandbox and the guard protect).
    root = Path(".") if not args.files else files[0].parent.parent
    summary = root / ".cowriting" / "verify.json"
    try:
        summary.parent.mkdir(exist_ok=True)
        summary.write_text(json.dumps({**counts, "files": [p.name for p in files], "checked": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2) + "\n", encoding="utf-8")
    except OSError as err:
        print(f"(summary not written: {err})")
    print("\n" + "  ".join(f"{k}: {v}" for k, v in counts.items()))
    if derived_seen:
        print("Keys in parentheses are derived: that file carries no citekeys.")
    sys.exit(1 if counts["mismatch"] or counts["not_found"] else 0)


if __name__ == "__main__":
    main()
