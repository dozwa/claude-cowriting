# Changelog

## 0.4.0 (2026-11-04)

### Overleaf

- New `/cowrite:overleaf`: `pull` brings a premium project's state into `manuscript/` through a helper clone the author makes once, `import <zip>` does the same from a source download. Each import is its own commit under the author "Overleaf import", so co-authors' text isn't recorded under the author's name; it stops if `manuscript/` has uncommitted changes, and live review doesn't send the imported text to the personas. Nothing is ever pushed.
- BibTeX files in `manuscript/` now count as the paper's bibliography, because an Overleaf project keeps its `.bib` inside the project.

## 0.3.0 (2026-11-04)

### Switching from `cw`

- The plugin has a new name, so updating `cw` does not bring it. Remove the old one and install the new one: `/plugin uninstall cw@cowriting`, `/plugin marketplace update cowriting`, `/plugin install cowrite --marketplace dozwa/claude-cowriting`.
- Your papers stay as they are. In each one, `/cowrite:paper upgrade apply` replaces `CLAUDE.md` with the version that names the new commands and keeps your copy under `.cowriting/upgrade/<time>/`. Comments in `party.md`, `scope.md` and `literature/style-models/README.md` still say `/cw:`, because those files are yours; they have no effect.
- The entry for 0.2.0 below writes commands as `/cowrite:`. In that release they were `/cw:`.

### The plugin is now `cowrite`

- The plugin's name changed from `cw` to `cowrite`, so every command is `/cowrite:<name>` and every persona is the `cowrite:<id>` agent. The old slug was two letters with no product word in it, which the plugin directory holds for a reviewer and never lets a listing change afterwards. Reinstall: `/plugin uninstall cw`, then `/plugin install cowrite --marketplace dozwa/claude-cowriting`. AI logs and party files from before keep working: a persona id with the old `cw:` prefix is still read.
- For the plugin directory's reader: the hooks module no longer names its type alias `$` (it is `Engine`), the typed commands that hand on to a skill pass the event on unchanged and the skill reads the persona as the author typed it, the custom-expert registration is written out member by member, the JSON reader takes no type argument on its calls, and the plugin README says hook by hook what the mod runs, writes and sends.
- The hooks module is one file: `workspace.ts`, `autosave.ts`, `scope.ts`, `watch.ts` and `ui.tsx` are folded into `register.tsx`, because the directory follows `$` only into functions declared beside the hooks. Pure logic stays in `core.ts`, `personas.ts` and `sprites.ts`. Nothing changes for authors.
- A README inside the plugin folder, which is what the directory shows as the listing. The root README's privacy section now names what does reach the network: Crossref, Zotero on `localhost`, and web search when a persona looks for literature.

## 0.2.0 (2026-11-01)

### Upgrading a workspace from 0.1.0

- New `/cowrite:paper upgrade`: lists what the active workspace lacks against the current templates (deny rules and sandbox paths in `.claude/settings.json`, the current `CLAUDE.md`, the party roster in `paper.json`, missing template files). `/cowrite:paper upgrade apply` adds them: settings are merged so the author's own rules stay, a replaced `CLAUDE.md` is kept under `.cowriting/upgrade/<time>/`, `party.md`, `scope.md` and the manuscript are never touched. The scaffold tool does the work (`new_paper.py --upgrade [--apply]`), started by the plugin on the host rather than as a tool call, so the guard neither refuses it nor records it as a detected change.
- Without the upgrade, a 0.1.0 workspace keeps working; it just lacks the `Edit` deny rules and the sandbox of 0.2.0.

### Pre-submission run

- New `/cowrite:submit [target]`: the Integrity Guardian's check, the consistency report, open markers, the references against Crossref, the AI log's open turns and whether the disclosure is current, as one checklist with locations and the author's next step per item. It logs under the category `integrity`. Readiness is not judged; the findings are for the author.

### Bibliographies from any reference manager

- `literature/` is read in four formats: BibTeX/BibLaTeX (`.bib`), CSL JSON (`.json`), RIS (`.ris`) and PubMed's MEDLINE export (`.nbib`), so Mendeley, EndNote, Citavi, Paperpile, JabRef, Web of Science, Scopus and PubMed exports work beside the Zotero auto-export. One reader (`tools/bibliography.py`) serves `verify_refs.py` and the Zotero tool's fallback search.
- `verify_refs.py` without arguments checks every bibliography file under `literature/` and reports them file by file; `.verify.json` lists the files. An entry without a DOI is looked up on Crossref by title, first author and year; a DOI Crossref lists for a title like it is shown as `NO DOI … Crossref lists doi:…: check that it is this work`, counted as `suggested`, never as verified. `--no-lookup` skips that.
- RIS and PubMed records carry no citekeys; the tools derive one (`garcia2022`, `pmid:12345`), show it in parentheses, and the consistency check says it cannot match citations against those files.
- Fixed: `verify_refs.py` wrote its summary into `literature/`, the author's folder. In a workspace with the 0.2.0 settings the sandbox refused that write and the run ended in a traceback instead of the summary line; without the sandbox the guard logged the file as a detected change on every run. The summary now goes to `.cowriting/verify.json`; the pane reads it there and still finds an older one in `literature/`.

### Word and LibreOffice manuscripts

- A `.docx` or `.odt` in `manuscript/` is read as text through pandoc: the Read tool answers with the converted text (line ranges work), the word count and the live review use the same conversion, and the guard treats the file like any other. `Grep` cannot search inside such a file, and located feedback names the line of the converted text. Without pandoc the file stays unreadable, and the Read tool answers as before.

### A review party of your own

The medicine domain pack is gone; every paper composes its own party instead.

- `/cowrite:init` asks who joins: the nine general personas, The Clinician for medical texts, and any expert of the author's own. `paper.json` keeps the roster (`party`); a `paper.json` from before keeps its party, the clinician included where the pack was medicine.
- An expert the catalogue lacks is a `party/<id>.md` file: frontmatter (`name`, `short`, `role`, `category`, `colour`), then its perspective and voice. The plugin appends the party's shared ground rules, registers it as the `cowrite:<id>` agent with read-only tools, draws it in the pane, briefs it from `party.md` and levels it like the others. `/cowrite:party new <id> "<Name>" <role>` writes the skeleton and Claude interviews the author to fill it in; `party/` is one of Claude's places for that.
- `/cowrite:party` lists the party, `add`/`remove` change the catalogue members. Only members are offered to the model, shown in the pane, and accepted by `/cowrite:summon`, `/cowrite:ask`, `/cowrite:brief` and `/cowrite:watch`.
- The *Domain pack* option is gone from the plugin's settings.
- Fixed: `/cowrite:summon`, `/cowrite:ask`, `/cowrite:brief <persona>` (the interview) and `/cowrite:scope edit` typed as commands failed on current Claude Code builds, which refuse a prompt submitted from inside a command's hook. The hook now checks the arguments and hands the command on to its skill text, which the model runs; the log entry comes from the command itself. The pane's buttons are unchanged.

### The author's files, not only the manuscript

Inside a paper, Claude now writes only in its own places: `notes/ai/`, `ai-log/`, `disclosure/`, `scope.md`, `.cowriting/`, `build/`. Everything else is the author's.

- The hook refuses file tools and shell writes for any of the author's files in the paper (`literature/`, `CLAUDE.md`, `party.md`, `paper.json`, `.claude/`, `.vscode/`, …), not only `manuscript/`, and names the file in its refusal. A `manuscript` folder stays refused wherever it is.
- The shell pattern treats the folder's name as a path only (`manuscript/`, `"manuscript"`), no longer as any word: a `grep` for the word is not refused any more.
- The workspace's `.claude/settings.json` (from `/cowrite:init`) now carries `Edit` deny rules for all of the author's files and turns on Claude Code's Bash sandbox with those paths on its write deny list, so the operating system refuses what the patterns cannot see. The network allow list keeps `verify_refs.py` and, on macOS, the Zotero search working. In the `projects/<name>/` layout the rules are merged into the workspace root's settings, where Claude Code reads them.
- The comparison after a writing tool covers all of the author's files. The disclosure lists the manuscript changes; `ailog.py stats` counts both.
- The three personas with a Write tool are told it is for `notes/ai/` only. Nothing could be trimmed from the tool lists: each one is used by a tool script or a note.

### Pane, read at 48 columns

Every tab was rendered at 48, 80 and 120 columns through the test harness and read as the author would see it.

- The key legend under the tabs is gone; the buttons already show their keys. Only "Esc back to prompt" stays.
- Persona cards: "asked 2×" instead of "2×", the 📋 for a briefed persona sits next to the name, and the cards are two columns wider so the longest name has a gap.
- Log tab: the turns waiting on a classify card are no longer listed a second time above them; what remains is "Earlier". The first card says which keys classify it. Previews, answers, points, section names and the goal end in "…" where they were cut, instead of mid-word.
- Scope tab: the "≈ Overall" label no longer touches its bar.
- Progress tab: the XP line shows the next level's target ("87 / 100 XP").
- Live tab: "Live review is off · off" no longer repeats itself.
- The reminder band says "Did you use this in your text?" next to the quoted answer, so the four buttons clearly belong to it and not to the guard nudge above.
- Times are the author's local clock everywhere (log, cards, scope check, live status), not UTC.
- "1 answer", "2 hints", "3 days" instead of "answer(s)", "hint(s)", "day(s)".
- `/cowrite:pane` lists `scope` among its tabs.

## 0.1.0 (2026-10-31)

First release, after a critical review of the initial build.

### The manuscript guard, honestly

- File tools are refused by path, now case-insensitively and with `..` resolved, so `Manuscript/` on macOS is covered.
- Shell commands are refused by pattern. The pattern now reads redirect targets and `cd`, catches `--write`, `-o`, editors and inline scripts, and no longer refuses reads such as `cat manuscript/main.md 2>/dev/null` or a note that merely mentions the folder.
- New third layer: after any writing tool ran, the manuscript's files are compared with how they were before. A change is logged as a `guard` entry, shown above the prompt, counted in the pane and listed in the disclosure. What the patterns cannot see, the comparison records.
- The disclosure no longer claims the plugin "technically prevents" AI edits. It says what is true: writes are refused, detected changes are listed, the git history shows how the text came about.

### Disclosure

- Live reviews and scope checks are their own rows, marked "hints only, no classification required", instead of counting as "not annotated".
- A turn that only launched a reviewer is classified through its report, not itself.
- The tool column names the Claude Code and CoWriting versions the log recorded.
- New `ailog.py prompts`: a prompts appendix (EN/DE, Markdown/LaTeX, optionally with answers) for universities that ask for it.

### Log

- Log writes of one paper are serialised, so an annotation during a live review cannot lose an entry.
- Response entries carry the plugin and Claude Code versions.

### Game

- "Full Party" is gone: it rewarded consulting the AI. "Own Voice" (decide against 5 hints) rewards the author's judgement instead.

### Project

- Initial commit on `main`, CI for the Python tools and the plugin tests, tests for the Python tools.
