#!/usr/bin/env python3
"""Bring an Overleaf project's current state into a paper's manuscript/ folder.

    python3 overleaf.py status [--dir PATH]
    python3 overleaf.py pull [--dir PATH]
    python3 overleaf.py import PROJECT.zip [--dir PATH]

Overleaf stays the place of writing: nothing here ever pushes. The author runs this
through /cowrite:overleaf; the session's sandbox keeps Claude's own tool calls out of
manuscript/ and away from git.overleaf.com.

`pull` reads a helper clone that the author makes once, inside the repository's git
folder so it is never committed, and `import` reads Overleaf's source download. Either
way manuscript/ becomes a mirror of the project and the result is committed at once
under the author "Overleaf import", because autosave would otherwise record text by
co-authors under the author's own name. Standard library only.
"""

from __future__ import annotations

import argparse
import os
import re
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

IMPORT_AUTHOR = "Overleaf import <overleaf-import@invalid>"
MAX_ZIP_BYTES = 1024**3
SKIPPED_NAMES = {".git", "__MACOSX", ".DS_Store"}
# Git hooks stay off, as for every git call the plugin makes through the engine.
GIT = ["git", "-c", "core.hooksPath=/dev/null"]


class Refusal(Exception):
    """A refusal or failure to tell the author in plain words."""


def git(root: Path, *args: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([*GIT, *args], cwd=root, input=stdin, capture_output=True)


def text(raw: bytes) -> str:
    """Git's output as text, with any password in a URL removed."""
    return re.sub(r"(https?://)[^/@\s]+@", r"\1", raw.decode("utf-8", "replace")).strip()


def has_password(url: str) -> bool:
    return re.match(r"https?://[^/@\s]*:[^/@\s]*@", url) is not None


def clone_path(root: Path) -> Path:
    """The helper clone of this paper: per paper, because one repository can hold several."""
    located = git(root, "rev-parse", "--show-prefix")
    if located.returncode != 0:
        raise Refusal("The paper folder is not a git repository (run git init there).")
    prefix = text(located.stdout).strip("/").replace("/", "-") or "paper"
    path = git(root, "rev-parse", "--git-path", f"cowriting/overleaf/{prefix}")
    return (root / text(path.stdout)).resolve()


def setup_text(clone: Path) -> str:
    return "\n".join([
        "Overleaf is not connected for this paper yet. Connecting needs a premium Overleaf project; without one, use /cowrite:overleaf import <zip>.",
        "Set it up once, in a terminal of your own so that your token stays out of this session:",
        f'  git clone https://git.overleaf.com/<project-id> "{clone}"',
        "Git asks for a login: the username is git, the password is your token from Overleaf's account settings.",
        "Let git remember it (git config --global credential.helper, e.g. osxkeychain on a Mac), then run /cowrite:overleaf pull.",
    ])


def status(root: Path) -> str:
    clone = clone_path(root)
    if not (clone / ".git").exists():
        return setup_text(clone)
    remote = text(git(clone, "remote", "get-url", "origin").stdout)
    last = text(git(clone, "log", "-1", "--format=%h %cs").stdout)
    return f"Overleaf: connected to {remote}, last fetched state {last}.\n/cowrite:overleaf pull brings in the current state."


def require_ready(root: Path) -> None:
    """Refuse before anything is changed, so that a failure cannot leave text for autosave to commit."""
    if git(root, "rev-parse", "-q", "--verify", "HEAD").returncode != 0:
        raise Refusal("The paper has no commit yet: wait for the first autosave, or commit once yourself.")
    if git(root, "var", "GIT_COMMITTER_IDENT").returncode != 0:
        raise Refusal('The import needs your git name: git config --global user.name "…" and user.email "…"')
    pending = git(root, "status", "--porcelain", "-uall", "--", "manuscript")
    if pending.returncode != 0:
        raise Refusal(f"git could not read the manuscript's state: {text(pending.stderr)}")
    if pending.stdout.strip():
        raise Refusal("manuscript/ has changes that are not committed yet, and the import would overwrite them. "
                           "Wait for autosave (30 s after your last save) or commit them, then try again.")


def source_files(source: Path) -> list[PurePosixPath]:
    """The project's regular files, relative to its root. Links are left out: they could point anywhere."""
    found = []
    for folder, subfolders, names in os.walk(source):  # does not follow linked folders
        subfolders[:] = [s for s in subfolders if s not in SKIPPED_NAMES]
        for name in names:
            path = Path(folder, name)
            if name not in SKIPPED_NAMES and path.is_file() and not path.is_symlink():
                found.append(PurePosixPath(path.relative_to(source).as_posix()))
    return sorted(found)


def mirror(root: Path, source: Path) -> tuple[list[str], list[str], list[str]]:
    """Make manuscript/ the project's copy. Only committed files are removed, so git can bring them back."""
    files = source_files(source)
    if not any(f.suffix.lower() == ".tex" for f in files):
        raise Refusal("That is no Overleaf project: it holds no .tex file. Nothing was changed.")
    manuscript = root / "manuscript"
    wanted = {str(f) for f in files}
    tracked = [p.decode() for p in git(root, "ls-files", "-z", "--", "manuscript").stdout.split(b"\0") if p]
    # ls-files names paths from the current folder, so they all start with manuscript/ here
    removed = [t for t in tracked if t.removeprefix("manuscript/") not in wanted]
    for path in removed:
        (root / path).unlink(missing_ok=True)
    added: list[str] = []
    changed: list[str] = []
    base = manuscript.resolve()
    for file in files:
        target = manuscript / file
        if base not in target.parent.resolve().parents and target.parent.resolve() != base:
            raise Refusal(f"{file} would land outside manuscript/.")
        data = (source / file).read_bytes()
        if target.is_symlink():
            target.unlink()
        if target.is_file() and target.read_bytes() == data:
            continue
        (changed if target.exists() else added).append(str(file))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return added, changed, removed


def undo(root: Path) -> None:
    """Back to the last commit. require_ready saw a clean manuscript/, so nothing of the author's is lost."""
    git(root, "reset", "-q", "--", "manuscript")
    git(root, "checkout", "HEAD", "--", "manuscript")
    git(root, "clean", "-fdq", "--", "manuscript")


def commit(root: Path, files: list[PurePosixPath], origin: str, summary: str) -> None:
    listed = b"\0".join(f"manuscript/{f}".encode() for f in files)
    # forced: an Overleaf project's figures are often PDFs, which a paper's .gitignore treats as build output
    steps = [
        git(root, "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul", stdin=listed),
        git(root, "add", "-A", "--", "manuscript"),
        git(root, "commit", "--quiet", f"--author={IMPORT_AUTHOR}", "-m", f"Overleaf import: {summary}", "-m", origin, "--", "manuscript"),
    ]
    for step in steps:
        if step.returncode != 0:
            raise Refusal(f"git could not commit the import, so it was undone: {text(step.stderr)[:200]}")


def import_from(root: Path, source: Path, origin: str) -> str:
    try:
        added, changed, removed = mirror(root, source)
        if not (added or changed or removed):
            return "manuscript/ already matches this Overleaf state."
        summary = f"{len(added)} added, {len(changed)} changed, {len(removed)} removed"
        commit(root, source_files(source), origin, summary)
    except (Refusal, OSError) as failure:
        undo(root)
        raise Refusal(str(failure)) from failure
    lines = [f"Imported from Overleaf: {summary}. Committed under the author \"Overleaf import\"."]
    if removed:
        lines.append("Removed: " + ", ".join(p.removeprefix("manuscript/") for p in removed))
    lines.append("To undo: git revert HEAD")
    return "\n".join(lines)


def pull(root: Path) -> str:
    require_ready(root)
    clone = clone_path(root)
    if not (clone / ".git").exists():
        return setup_text(clone)
    if has_password(git(clone, "remote", "get-url", "origin").stdout.decode("utf-8", "replace").strip()):
        raise Refusal("The helper clone's URL holds your token. Remove it: "
                           f'git -C "{clone}" remote set-url origin https://git.overleaf.com/<project-id>')
    fetched = git(clone, "pull", "--ff-only", "--quiet")
    if fetched.returncode != 0:
        raise Refusal(f"Overleaf could not be read: {text(fetched.stderr)[:300]}\n"
                           "If the login failed, your token may have expired (they last a year), or git does not remember it yet.")
    head = text(git(clone, "rev-parse", "--short", "HEAD").stdout)
    return import_from(root, clone, f"Overleaf commit {head}")


def import_zip(root: Path, archive: Path) -> str:
    require_ready(root)
    if not archive.is_file():
        raise Refusal(f"No such file: {archive}")
    try:
        with zipfile.ZipFile(archive) as project, tempfile.TemporaryDirectory() as folder:
            members = project.infolist()
            if sum(m.file_size for m in members) > MAX_ZIP_BYTES:
                raise Refusal("That archive unpacks to more than 1 GB.")
            for member in members:
                parts = PurePosixPath(member.filename).parts
                if member.filename.startswith("/") or "\\" in member.filename or ".." in parts:
                    raise Refusal(f"The archive holds an unsafe path: {member.filename}")
                if member.is_dir() or stat.S_ISLNK(member.external_attr >> 16):
                    continue
                target = Path(folder, *parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(project.read(member))
            return import_from(root, Path(folder), f"Overleaf download {archive.name}")
    except zipfile.BadZipFile as failure:
        raise Refusal(f"{archive.name} is not a zip file.") from failure


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=("status", "pull", "import"))
    parser.add_argument("archive", nargs="?", type=Path, help="for import: the project's zip download")
    parser.add_argument("--dir", type=Path, default=Path("."), help="the paper folder (default: the current one)")
    args = parser.parse_args()
    root = args.dir.expanduser().resolve()
    try:
        if args.action == "status":
            print(status(root))
        elif args.action == "pull":
            print(pull(root))
        elif args.archive is None:
            raise Refusal("Name the download: /cowrite:overleaf import <zip>")
        else:
            print(import_zip(root, args.archive.expanduser().resolve()))
    except Refusal as failure:
        print(failure, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
