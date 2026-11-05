# Changelog

## 0.4.0 (unreleased)

- **The guard stays out of other projects.** With the plugin installed for every folder, it could block ordinary work elsewhere. A project with an unrelated `paper.json` was treated as a paper, so all its files were refused. Outside a paper, any writing command that named `manuscript` next to a shell variable or command substitution was refused, even if the word was only in a message. And with a paper open, a project's own `manuscript`, `ai-log` or `CLAUDE.md` was refused too. A paper now needs a `paper.json` and a `manuscript` or `ai-log` folder, and outside a paper only a path that visibly lies in one counts. The price is in the README. Word files outside a paper are no longer converted either. If the guard itself fails, it refuses the call only in a paper.
- **The guard reads where a command writes.** It used to refuse any writing command that named a protected folder, so `cp manuscript/main.md notes/ai/copy.md` was refused, and so was `rm /other/CLAUDE.md` from inside a paper. Each file a command writes is now judged by whether it lies in a paper. This also covers what the old patterns missed: `cd /p && rm CLAUDE.md`, or `party.md` of the other paper in a `projects/` workspace. A session started in a subfolder of a paper is guarded too.
- **Each persona's report counts.** When several reports came back before a turn ended, only the last kept its turn, so the others asked for no classification and were missing from the disclosure's counts.
- **A new file in the log doesn't pass unnoticed.** Anything but this month's file is taken out, kept in `.cowriting/log-rewrites/`, shown and disclosed.
- **The AI log only grows.** It used to be append-only by convention. File tools and shell commands that would change what is already in `ai-log/` are now refused, and after every tool call the log is compared by content: a rewrite is undone, the altered version is kept in `.cowriting/log-rewrites/`, and the attempt is shown and listed in the disclosure. `/cowrite:paper upgrade apply` brings the new rule line to an existing workspace's `CLAUDE.md`. The README states the limits.
- **Refused attempts are on the record.** A refused write used to leave no trace. Each refusal, for the manuscript, the author's other files and the log, is now a log entry and is listed in the disclosure under its own heading. It does not count as a change to the author's files.

## 0.3.5 (2026-11-04)

- **Feedback reads as Markdown, with the buttons on top.** An opened input on the Feedback tab was drawn as raw text, so a persona's headings, bold and tables showed as `##`, `**` and `|`, and in the VS Code pane a long report pushed the choices out of reach. The report, Claude's words and the diff summary are now Markdown elements, and the four choices, Reply, "What did I change since?" and the comment field sit above the text.
- **Reply.** A `Reply` button (`y`) on an opened input writes a line into the prompt box that addresses it: the persona's agent (or Claude for its own answer), the category, the time and the log entry, after anything already drafted. The author types the reply behind it and presses Enter; the plugin sends nothing by itself. For a persona, Claude hands the agent its earlier feedback with the reply and relays the answer as given.
- **A persona answers a reply as a colleague, not with a new review.** The ground rules of the ten personas and of the author's own experts say what a reply is: a conversation. The persona takes a position, gives reasons, concedes or holds its ground, asks back, and takes on how the author wants things weighed in this paper, within the rules; no report template.
- **Threads in the log.** The author's reply carries `replyTo` with the feedback it answers and keeps its category; the persona's answer carries `replyTo` with the reply. The Feedback tab marks an answer with ↳, the opened answer shows the author's words and links back to the feedback, the feedback links to its answers, `ailog.py list` shows the reference, and the prompts appendix says "in reply to" (DE: "Antwort auf") with the time of the entry answered. Each answer is open feedback of its own.
- **Remember: a persona learns from a discussion, with the author's say-so.** `Remember` (`m`) on an opened persona input asks the live-review model for at most two briefing lines that capture what the exchange settled (a preference, a convention of the field, something not to flag again), in the author's words where they said it. The lines appear in an editable field; `Save to party.md` appends them under the persona's heading, keeping what the author wrote there, `Discard` drops them. Nothing is written before the author saves. The proposal is logged with origin `brief` and category `brief-update`, not as open feedback, and the author's decision becomes its annotation (adopted, adapted when edited, rejected). The disclosure lists the category and says, when it occurred, that persona briefings were partly drafted by the model and confirmed by the author.
- The pane's help names `o` (open), `y` (reply), `c` (what changed since) and `m` (remember).

## 0.3.4 (2026-11-04)

- The README's install section now gives both routes on every surface: from the marketplace (one command at the prompt of a terminal, VS Code or the desktop app's Code tab; updates from `/plugin`, automatic once auto-update is switched on for the marketplace) and from the zip (a fixed version, no git needed; upload in the desktop app or `--plugin-dir` in a terminal), with a table of what each needs and when to choose it, and an "Updating" part including `/cowrite:paper upgrade`.
- The manifest no longer declares `options` on its three choice fields (language, focus mode, usage meter). Claude Code documents the key from 2.1.271 on, and the CLI install passed here on 2.1.316 and 2.1.318, but one install on 2.1.316 was refused with `Unrecognized key: "options"` ([#1](https://github.com/dozwa/claude-cowriting/issues/1), reported with a fix in [#2](https://github.com/dozwa/claude-cowriting/pull/2) by alejandrorusso). The allowed values are now in each field's description, `/config` shows the fields as text, and a value outside the list falls back to the default, as the code already did.
- **A paper without git.** `/cowrite:init` now asks whether the paper is versioned with git and explains both choices in the question itself, for authors who have never used git. Without git (`--versioning none`, `"versioning": "none"` in `paper.json`) no repository is created and git is never called: autosave is off for that paper whatever the option says, "What did I change since?" says there is no history to compare, the guard's toast says "check the file", and the pane header says `no git`. The AI log, the party and the disclosure are unchanged. `/cowrite:paper versioning` says which it is; `/cowrite:paper versioning git` creates the repository and switches autosave on, `none` switches it off. A machine without git gets a paper without versioning and a line that says so.

## 0.3.3 (2026-11-04)

- A **Feedback** tab of its own lists the AI inputs still to classify, with their count in its label, and each persona's card on the Party tab wears a ✉ badge with that persona's count; pressing it opens the newest. Opening an input shows the whole text (for a persona's report, the report itself, then what Claude added), a comment field and the four choices. The comment goes into the annotation and into the prompts appendix under its turn. Before, the Log tab held cards that cut the answer after two lines; the Log tab is the history again.
- **What did I change since?** on an opened input: the plugin takes the autosave commit from before that input, diffs the manuscript to the working copy, and the live-review model describes in three sentences what changed in relation to the feedback. The description can seed the comment. It is logged with origin `summary` under the category `change-summary`, disclosed, and not owed a classification. Without a saved version from before the input it says so instead.
- Live hints: classifying a review takes its hints off the Live tab and the band, each review has its own four buttons (before, only the latest had them and the rest stayed dimmed for good), and the band draws nothing while the pane shows the Live tab, which had the same hints twice in VS Code.
- In VS Code the pane sits inline above the prompt and shares the panel with the transcript, where the grid of sprite cards took most of the height and wrapped into two rows. Seated inline on a graphical surface, the Party tab is now a short list: a small sprite, the name and the standing on one line per persona, and the help lines folded into one. The terminal and the dock keep the grid.

## 0.3.2 (2026-11-04)

- Every release now has `cowrite.zip` attached: the plugin folder, zipped as `cowrite/`, built by a workflow when a `v<version>` tag is pushed. The newest one is always at https://github.com/dozwa/claude-cowriting/releases/latest/download/cowrite.zip. Upload it under Customize > Plugins in the Claude desktop app, or try it for one session with `claude --plugin-dir cowrite.zip`.
- The README says where the plugin works: in a terminal, in the VS Code extension and in the Code tab of the Claude desktop app, where it was tested on the Mac; not in chat, on claude.ai or in the app's Chat tab, because chat ignores a plugin's hooks and agents. It also describes the desktop-app setup: download the release zip, upload it under Customize > Plugins.

## 0.3.1 (2026-11-04)

- The manuscript guard now applies only to papers. It used to refuse every folder named `manuscript`, so with the plugin installed at user scope it also blocked Claude in unrelated projects. A `manuscript` folder is now refused when it lies in the session's paper or directly beside a `paper.json`, wherever that paper is, and when a path or command doesn't show where it points.
- If a paper's `paper.json` is gone, the hook no longer protects its `manuscript` folder. The workspace's deny rules and sandbox still do.
- The plugin README now says where the plugin works, how privacy and support are handled, and gives three examples. It also discloses that `/cowrite:init` turns on the sandbox and limits its network access, and it no longer lists the sprite renderer, which isn't part of the plugin.
- The description of `/cowrite:paper` no longer contains `<name>`: claude.ai refuses to install a plugin with XML-like tags in a skill description.
- The manifest has a `displayName`, an author URL, a homepage and a repository.

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
