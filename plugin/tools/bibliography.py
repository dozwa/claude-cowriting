#!/usr/bin/env python3
"""Read the author's bibliography files, whatever their format.

Formats, by extension, all under `literature/` of the paper:

    .bib .bibtex   BibTeX / BibLaTeX  (Zotero + Better BibTeX, JabRef, Mendeley, Citavi, Paperpile, EndNote)
    .json          CSL JSON           (Zotero, Mendeley, Paperpile, pandoc's native bibliography)
    .ris           RIS                (EndNote, Citavi, Mendeley, Web of Science, Scopus, most journal sites)
    .nbib          MEDLINE / PubMed   (PubMed's "Save → PubMed" export)

Every entry comes out the same: key, derived, type, title, authors (family
names), year, doi, text (everything in the record, for searching), file.
The key is the citekey where the format has one (the BibTeX key, CSL `id`,
RIS `ID`); a RIS or MEDLINE record without one gets `pmid:<n>` or
`<family><year>` derived from the record, with `derived` set. Standard
library only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

FORMATS = {".bib": "BibTeX", ".bibtex": "BibTeX", ".json": "CSL JSON", ".ris": "RIS", ".nbib": "MEDLINE"}

BIB_START = re.compile(r"@(\w+)\s*\{\s*([^,\s{}]+)\s*,")


def bib_entries(text: str) -> list[tuple[str, str, str]]:
    """Every entry as (kind, key, body), wherever its closing brace is: exports differ in how they lay them out."""
    out = []
    at = 0
    while (start := BIB_START.search(text, at)) is not None:
        depth = 1
        i = start.end()
        while i < len(text) and depth > 0:
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        out.append((start.group(1), start.group(2), text[start.end():i - 1 if depth == 0 else i]))
        at = i
    return out


def entry(**fields) -> dict:
    e = {"key": "", "derived": False, "type": "", "title": "", "authors": [], "year": "", "doi": "", "text": "", "file": ""}
    e.update(fields)
    e["doi"] = clean_doi(e["doi"])
    e["year"] = (e["year"] or "")[:4]
    return e


def clean_doi(doi: str | None) -> str:
    if not doi:
        return ""
    doi = doi.strip()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.I)
    return doi.strip(" .;,")


def norm(s: str) -> str:
    """A title without LaTeX, braces and punctuation, for comparisons."""
    s = re.sub(r"\\[a-zA-Z]+|[{}$\\]", "", s)
    return re.sub(r"\W+", " ", s).strip().lower()


def family(name: str) -> str:
    """The family name of 'Family, Given', 'Given Family' or '{Some Institution}'."""
    name = re.sub(r"[{}]", "", name).strip()
    if "," in name:
        return name.split(",", 1)[0].strip()
    return name.split()[-1] if name.split() else ""


def derived_key(authors: list[str], year: str) -> str:
    stem = re.sub(r"[^a-z0-9]", "", (authors[0] if authors else "anon").lower()) or "anon"
    return f"{stem}{year}"


def unique_keys(entries: list[dict]) -> list[dict]:
    """Derived keys that collide within one file get a, b, c appended."""
    seen: dict[str, int] = {}
    for e in entries:
        if not e["derived"]:
            continue
        n = seen.get(e["key"], 0)
        seen[e["key"]] = n + 1
        if n:
            e["key"] = f"{e['key']}{chr(ord('a') + n)}"
    return entries


# BibTeX ---------------------------------------------------------------------

def bib_field(body: str, name: str) -> str | None:
    m = re.search(rf"\b{name}\s*=\s*", body, re.I)
    if not m:
        return None
    rest = body[m.end():]
    if rest.startswith("{"):
        depth, out = 0, []
        for ch in rest:
            if ch == "{":
                depth += 1
                if depth == 1:
                    continue
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            out.append(ch)
        return "".join(out)
    if rest.startswith('"'):
        return rest[1:].split('"', 1)[0]
    return re.split(r"[,\n]", rest, maxsplit=1)[0].strip()


def load_bibtex(text: str, file: str = "") -> list[dict]:
    out = []
    for kind, key, body in bib_entries(text):
        if kind.lower() in ("comment", "string", "preamble"):
            continue
        authors = [family(a) for a in re.split(r"\s+and\s+", bib_field(body, "author") or "") if a.strip()]
        out.append(entry(
            key=key, type=kind.lower(), title=bib_field(body, "title") or "", authors=authors,
            year=bib_field(body, "year") or bib_field(body, "date") or "", doi=bib_field(body, "doi") or "",
            text=body, file=file,
        ))
    return out


# CSL JSON -------------------------------------------------------------------

def _strings(value) -> str:
    if isinstance(value, dict):
        return " ".join(_strings(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(_strings(v) for v in value)
    return str(value) if value is not None else ""


def load_csl_json(text: str, file: str = "") -> list[dict]:
    try:
        items = json.loads(text)
    except ValueError:
        return []
    if isinstance(items, dict) and isinstance(items.get("items"), list):  # Zotero API shape
        items = items["items"]
    if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
        return []
    out = []
    for i in items:
        if not any(k in i for k in ("title", "id", "DOI")):
            continue
        authors = [a.get("family") or a.get("literal") or a.get("name") or "" for a in i.get("author") or []]
        issued = i.get("issued") or {}
        parts = issued.get("date-parts") or [[]]
        year = str(parts[0][0]) if parts and parts[0] and parts[0][0] else (issued.get("raw") or issued.get("literal") or "")
        out.append(entry(
            key=str(i.get("id", "")), type=str(i.get("type", "")), title=str(i.get("title", "")),
            authors=[a for a in authors if a], year=str(year), doi=str(i.get("DOI", "")), text=_strings(i), file=file,
        ))
    return out


# RIS ------------------------------------------------------------------------

RIS_LINE = re.compile(r"^([A-Z][A-Z0-9])  - ?(.*)$")


def load_ris(text: str, file: str = "") -> list[dict]:
    out, tags, lines = [], {}, []
    for raw in text.splitlines():
        m = RIS_LINE.match(raw.strip("﻿"))
        if not m:
            if lines and raw.strip():
                lines[-1] += " " + raw.strip()
            continue
        tag, value = m.group(1), m.group(2).strip()
        lines.append(f"{tag} {value}")
        if tag == "ER":
            out.append(_ris_entry(tags, lines, file))
            tags, lines = {}, []
            continue
        tags.setdefault(tag, []).append(value)
    if tags:
        out.append(_ris_entry(tags, lines, file))
    return unique_keys(out)


def _ris_entry(tags: dict[str, list[str]], lines: list[str], file: str) -> dict:
    first = lambda *names: next((tags[n][0] for n in names if tags.get(n)), "")  # noqa: E731
    authors = [family(a) for a in tags.get("AU") or tags.get("A1") or []]
    year = re.match(r"\d{4}", first("PY", "Y1", "DA") or "")
    doi = first("DO")
    if not doi:
        for v in tags.get("UR", []) + tags.get("M3", []) + tags.get("N1", []):
            m = re.search(r"10\.\d+/\S+", v)
            if m and ("doi" in v.lower()):
                doi = m.group(0)
                break
    key, derived = first("ID"), False
    if not key:
        key, derived = derived_key(authors, year.group(0) if year else ""), True
    return entry(
        key=key, derived=derived, type=first("TY").lower(), title=first("TI", "T1", "BT", "CT"), authors=authors,
        year=year.group(0) if year else "", doi=doi, text="\n".join(lines), file=file,
    )


# MEDLINE / PubMed -----------------------------------------------------------

MEDLINE_LINE = re.compile(r"^([A-Z]{2,4}) *- (.*)$")


def load_medline(text: str, file: str = "") -> list[dict]:
    out, tags, lines = [], {}, []

    def flush() -> None:
        if tags:
            out.append(_medline_entry(tags, lines, file))

    for raw in text.splitlines():
        if not raw.strip():
            flush()
            tags, lines = {}, []
            continue
        m = MEDLINE_LINE.match(raw)
        if m:
            tag, value = m.group(1), m.group(2).strip()
            tags.setdefault(tag, []).append(value)
            lines.append(f"{tag} {value}")
        elif raw.startswith("      ") and tags:
            last = next(reversed(tags))
            tags[last][-1] += " " + raw.strip()
            lines[-1] += " " + raw.strip()
    flush()
    return unique_keys(out)


def _medline_entry(tags: dict[str, list[str]], lines: list[str], file: str) -> dict:
    authors = [family(a) for a in tags.get("FAU") or tags.get("AU") or []]
    doi = ""
    for v in tags.get("AID", []) + tags.get("LID", []):
        if v.endswith("[doi]"):
            doi = v[: -len("[doi]")].strip()
            break
    year = re.match(r"\d{4}", (tags.get("DP") or [""])[0])
    pmid = (tags.get("PMID") or [""])[0]
    return entry(
        key=f"pmid:{pmid}" if pmid else derived_key(authors, year.group(0) if year else ""), derived=True,
        type=(tags.get("PT") or [""])[0].lower(), title=(tags.get("TI") or [""])[0], authors=authors,
        year=year.group(0) if year else "", doi=doi, text="\n".join(lines), file=file,
    )


# Files ----------------------------------------------------------------------

LOADERS = {".bib": load_bibtex, ".bibtex": load_bibtex, ".json": load_csl_json, ".ris": load_ris, ".nbib": load_medline}


def find_files(literature: Path) -> list[Path]:
    """The bibliography files under a folder, in name order; hidden files are skipped."""
    if not literature.is_dir():
        return []
    return sorted(p for p in literature.iterdir() if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in LOADERS)


def load(path: Path) -> list[dict]:
    loader = LOADERS.get(path.suffix.lower())
    if not loader:
        raise ValueError(f"{path.name}: not a bibliography format I read ({', '.join(sorted(LOADERS))})")
    return loader(path.read_text(encoding="utf-8-sig"), path.name)


def load_all(literature: Path) -> list[dict]:
    out: list[dict] = []
    for p in find_files(literature):
        out.extend(load(p))
    return out


def format_name(path: Path) -> str:
    return FORMATS.get(path.suffix.lower(), path.suffix)
