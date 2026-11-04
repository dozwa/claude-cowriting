# CoWriting — write it yourself, with a review party at your side

![The review party](docs/img/party.png)

**CoWriting** is a [Claude Code](https://claude.com/claude-code) plugin for theses, articles and reports. **You write. Claude assists** with hints, questions, critique, explanations and literature help. It never ghostwrites your manuscript.

The setup follows the German Research Foundation's (DFG) rules for good scientific practice and its statement on generative AI:

- the research process stays transparent,
- responsibility stays with the author,
- AI use is disclosed (which model, for what, to what extent),
- only natural persons are authors.

CoWriting turns these rules into features:

| Rule | What the plugin does |
|---|---|
| You are the author | `manuscript/` is **read-only for Claude**, and so is every other file of yours in the paper: Claude writes only in `notes/ai/`, the log, the plan and the disclosure. A hook refuses the edits it can recognise, including from subagents and shell commands, the workspace's deny rules and sandbox refuse what the hook cannot see, and every change to your files detected during a tool call is recorded anyway (see [The manuscript guard](#the-manuscript-guard)). |
| Transparency | Every prompt and answer is logged automatically to `ai-log/` (append-only, timestamped, with the model and plugin versions). |
| Disclosure | `/cowrite:disclosure` turns the log into an **AI register** (EN/DE, Markdown/LaTeX) for your declaration of authorship or your journal, and into a prompts appendix where one is required. |
| Responsibility | You classify each AI input: **✓ used** (adopted), **✎ changed** (adapted), **✗ not used** (rejected) or **ℹ info**. The card shows who said it, what you asked and what it said. Claude never decides this for you. |
| No fabricated sources | References need a verified DOI or a citekey from your reference manager's export. `verify_refs.py` checks your bibliography (`.bib`, CSL JSON, RIS, PubMed) against Crossref. |

The background research and requirements are in [docs/research-and-requirements.md](docs/research-and-requirements.md). How each feature maps to the DFG principles is in [docs/gwp-rationale.md](docs/gwp-rationale.md).

## Install

You need Claude Code (in a terminal or the VS Code extension) and Python 3. At the Claude Code prompt, type:

```
/plugin install cowrite --marketplace dozwa/claude-cowriting
```

Answer `y` to add the marketplace, then pick a scope (user scope is recommended). The config screen asks for your options. All of them can be changed later in `/config`:

| Option | Meaning |
|---|---|
| Obsidian vault | Path to your vault. Claude reads it as your knowledge base and writes only to an `AI-Notes/` folder there. |
| Default language | `en` or `de` |
| Autosave to git | On by default: commits `manuscript/` and `ai-log/` after each change, once you've paused for 30 s, under your own git name, with the words gained or lost and the new AI log entries in the message. Nothing else is committed. |
| Gamification | XP, levels and achievements on or off |
| Zotero local API | Search your running Zotero 7 |
| Live review model | Model for `/cowrite:watch` (default `haiku`) |
| Focus mode | How much of Claude Code's own work the transcript shows: `off`, `calm` (one dim line per action, the default) or `focus` (only you and the personas) |
| Usage meter | `off`, `tokens`, or `tokens+limits`: context tokens, live-review tokens and, on Pro/Max, the 5-hour and weekly limits, with a warning at 80 % and 95 % |

## Start a paper

Open your writing folder in VS Code (or a terminal), start Claude Code, and run:

```
/cowrite:init
```

Claude Code runs somewhere else, e.g. in your home folder? Give the paper's folder: `/cowrite:init ~/Papers/my-thesis` sets it up there. Later, `/cowrite:paper ~/Papers/my-thesis` opens it again from anywhere, and `/cowrite:paper` alone lists your recent papers to pick by number. If the folder already holds your draft (say `paper.md`), move it into `manuscript/` yourself afterwards; Claude never touches that folder.

Claude asks four questions:
- LaTeX or Markdown
- English or German
- this folder or a new `projects/<name>/` (for several papers in one folder)
- who joins your review party: the nine general personas, The Clinician for medical texts, and any expert of your own (an ontologist, a general practitioner, a neurologist, a lawyer: whoever your field needs). Claude interviews you about each expert you ask for and writes it down as `party/<id>.md`.

You get:

```
manuscript/            ← you write here (main.tex or main.md); Claude can only read it
literature/references.bib  ← your reference manager's export (.bib, CSL JSON, RIS or PubMed .nbib)
literature/style-models/   ← papers whose style you like (for the Style Coach)
party.md               ← your briefing: what each persona should look for in this project
party/                 ← your own experts, one <id>.md each (the catalogue members are listed in paper.json)
notes/ai/              ← AI notes, clearly marked
ai-log/                ← automatic log of every AI interaction
disclosure/            ← generated AI register
paper.json, CLAUDE.md, .vscode/ (recommended extensions), .claude/settings.json
```

CoWriting commits your manuscript and the AI log for you after each change (once you pause for 30 s). The git history then documents how your text grew and which AI input came before each step, and with it your authorship. The commits use your own git name (`git config --global user.name` / `user.email`) and contain only `manuscript/` and `ai-log/`. Commit the rest (literature, notes) yourself when you like. Switch it off with the *Autosave to git* option, or for one paper with `"autosave": false` in its `paper.json`.

**Writing in Word or LibreOffice?** Put the `.docx` or `.odt` in `manuscript/` as you would a `.tex` file. The party reads it as text through [pandoc](https://pandoc.org) (install it: `brew install pandoc`, `apt install pandoc`, or the Windows installer), the word count and the live review use the same conversion, and the guard protects the file like any other. Two limits: `Grep` cannot search inside such a file, so a persona reads it whole, and located feedback names the line of the converted text, not a page. Without pandoc the file is unreadable to Claude, and the pane's word count stays at the text files.

**Updated the plugin?** A workspace keeps the rule files it was set up with (`CLAUDE.md`, `.claude/settings.json`), and they are yours, so the plugin never changes them on its own. `/cowrite:paper upgrade` lists what your workspace lacks against the current templates: deny rules and sandbox paths, the current `CLAUDE.md`, the party roster in `paper.json`, missing template files. `/cowrite:paper upgrade apply` adds them. Settings are merged, so your own rules stay; a replaced `CLAUDE.md` is kept under `.cowriting/upgrade/<time>/`, so you can carry your edits over. `party.md`, `scope.md` and your manuscript are never touched.

### Reference managers

Put your manager's export into `literature/`. Every file there is read, in these formats:

| Format | File | Comes from |
|---|---|---|
| BibTeX / BibLaTeX | `.bib` | Zotero (Better BibTeX), JabRef, Mendeley, Citavi, Paperpile, EndNote |
| CSL JSON | `.json` | Zotero, Mendeley, Paperpile; pandoc reads it directly |
| RIS | `.ris` | EndNote, Citavi, Mendeley, Web of Science, Scopus, most journal sites |
| MEDLINE | `.nbib` | PubMed (*Save → PubMed*) |

The Librarian searches all of them, `verify_refs.py` checks every DOI in them against Crossref and, for an entry without a DOI, asks Crossref by title and shows the DOI it lists for you to check. Citekeys for `\cite{…}` and `[@…]` come from `.bib` files and the `id` of CSL JSON; RIS and PubMed files carry none, so the consistency check cannot match citations against them. Only Zotero has a live connection: the local API lets The Librarian search your whole library, not just the export.

**Zotero**

1. Install [Better BibTeX](https://retorque.re/zotero-better-bibtex/).
2. Right-click your paper's collection, choose **Export Collection…**, pick **Better BibLaTeX**, and tick ☑ **Keep updated**. Save it as `literature/references.bib`.
3. Optional: in Zotero 7, go to *Settings → Advanced* and enable **Allow other applications on this computer to communicate with Zotero**. *The Librarian* can then search your whole library.
4. VS Code: the recommended *Citation Picker for Zotero* inserts citekeys while you write.

**Mendeley, EndNote, Citavi, Paperpile, JabRef:** export your collection as BibTeX (or CSL JSON, or RIS) into `literature/` and export again when the library changes. There is no live search of these libraries.

**PubMed:** search results saved as *PubMed* format land in `literature/<name>.nbib`; the DOI check and the library search read them, and the entries are shown as `pmid:<n>`.

### Obsidian

Set the vault path in the plugin options. Claude then:
- searches your notes and cites them as `[[note]]` so you can find your own thoughts again,
- puts its own notes only in `<vault>/AI-Notes/<paper>/`, with `ai_generated: true` frontmatter, so AI and human notes never mix.

To pull Zotero items into Obsidian, combine it with the Obsidian *Zotero Integration* plugin.

### VS Code

The workspace recommends these extensions:
- Claude Code
- LaTeX Workshop
- LTeX+ (local grammar checking)
- Citation Picker for Zotero
- Markdown All in One
- Pandoc Citer

The CoWriting pane works in the terminal and in the VS Code extension.

## Daily use

| Command | What it does |
|---|---|
| `/cowrite:pane [party\|live\|log\|scope\|progress]` | Opens the **CoWriting pane** (on that tab) with the keyboard in it. Click a persona's name to summon it. `1`–`5` switch tabs, `w` turns live review on or off, `r` refreshes, `a`/`d`/`x`/`i` annotate the latest open turn as adopted/adapted/rejected/info, `Esc` goes back to the prompt |
| `/cowrite:watch [on\|off] [persona …\|all]` | **Live review** while you write (see below). Default watchers: Grammar Guy, Terminologist, Style Coach, Architect |
| `/cowrite:ask <persona> <question>` | Talk to one persona directly, e.g. `/cowrite:ask terminologist is "sleep architecture" the usual term?` |
| `/cowrite:brief [persona\|all] [text]` | Tell a persona what to look for **in this project**. Without text it interviews you and saves your answers; with text it saves them directly. Without arguments it lists all briefs. |
| `/cowrite:summon <persona> [file]` | Asks one party member for feedback, e.g. `/cowrite:summon statistics-nerd manuscript/methods.tex` |
| `/cowrite:party [add\|remove <id …> \| new <id> "<Name>" <role>]` | Who is in your review party. `add`/`remove` change the catalogue members, `new` creates an expert of your own after a short interview (see below). |
| `/cowrite:feedback` | Writing-center style feedback on a section: problems with their location, guiding questions, no rewrites |
| `/cowrite:socratic` | One question at a time, to think a section through before writing it |
| `/cowrite:structure` | Reverse outline, argument map and red-thread check |
| `/cowrite:language` | Grammar, spelling and punctuation, **with corrected forms** and the rule. No stylistic rewrites. |
| `/cowrite:sources` | Find literature, search your Zotero and Obsidian, verify DOIs, find claims without a citation |
| `/cowrite:explain` | Understand a concept, with an optional glossary entry in `notes/ai/` |
| `/cowrite:consistency` | Report on terms, abbreviations, cross-references, citekeys and figures |
| `/cowrite:submit [target]` | Pre-submission run as one checklist: the Integrity Guardian's check, the consistency report, open markers (`TODO`, `UNVERIFIED`, `[AI-TEXT]`, …), the references against Crossref, open log turns and whether the disclosure is current. Findings only; readiness is your call. |
| `/cowrite:annotate` | Record what you did with an AI input |
| `/cowrite:overleaf [status\|pull\|import <zip>]` | Bring an **Overleaf** project's state into `manuscript/` (see below). You keep writing in Overleaf; nothing is ever sent back. |
| `/cowrite:quiet [off\|calm\|focus]` | Switch the focus mode for this session. `ctrl+o` always shows everything in full. |
| `/cowrite:disclosure` | Generate the AI register, and the prompts appendix if your university asks for one (`ailog.py prompts`) |
| `/cowrite:scope [check\|edit]` | Progress against your plan in `scope.md`; `check` asks which of your points the text makes; `edit` sets the scope with you |
| `/cowrite:paper [path \| number \| name \| upgrade [apply]]` | Open a paper folder by path from wherever Claude Code runs, pick a recent one by number, or switch `projects/<name>`; alone, it lists recent papers. `upgrade` shows what a workspace from an earlier plugin version lacks, `upgrade apply` adds it (see below) |

The status line shows `✍ <paper> · assist-only · Lv3 · 2 to classify · ctx 42% · 5h 63%`. The pane opens with a transparent background, so it blends with your terminal (set your terminal profile to black for the dark look). When AI inputs pile up unclassified, or an answer contains AI-written text, a band above the prompt reminds you.

### Live review

`/cowrite:watch` turns on a reviewer that looks over your shoulder:
- **When it looks:** when you pause writing for about 20 seconds.
- **What it sends:** only the paragraphs you just changed, to a small, fast model (option *Live review model*, default `haiku`).
- **What you get back:** at most 3 short hints, each about one line, from the watching personas. They appear above the prompt and in the pane's **Live** tab.
- **The rules stay the same:** no rewritten sentences. Grammar Guy may give a corrected word, and the Terminologist may name the usual term.
- **Limits:** at most one review a minute and 20 an hour.
- **Logging:** every review is logged, so it shows up in your disclosure.
- **Annotation:** marking live hints is optional; they don't count toward the "unannotated" reminder.

Choose the watchers with `/cowrite:watch on terminologist grammar-guy`, or `/cowrite:watch on all`. Stop with `/cowrite:watch off`.

When a persona reviews on request, the transcript shows a single progress line (`🎭 The Terminologist ▰▰▰▱▱ 4 steps · Read main.tex`) and a one-line note when the report comes back. Press `ctrl+o` for the full text.

### Overleaf

You can keep writing in Overleaf and let the party read along. `/cowrite:overleaf` shows the setup; `manuscript/` then mirrors the project.

- **With a premium Overleaf project** (your own, your institution's, or one owned by a premium user): clone it once in your own terminal, as the command shows, then run `/cowrite:overleaf pull` whenever you want the current state. Your token stays with git, out of the session.
- **Without premium**: download the project's source as a zip and run `/cowrite:overleaf import <zip>`.

Each import is its own commit under the author "Overleaf import", so your co-authors' text doesn't enter the history under your name, and it earns no XP. `manuscript/` must have no uncommitted changes, and files deleted in Overleaf are removed here too (`git revert HEAD` undoes an import). CoWriting never pushes: Overleaf warns that pushes can lose or displace comments and tracked changes. The disclosure covers AI use in this workspace only, so AI used inside Overleaf is not in the log.

### Scope and progress

`scope.md` holds your plan for the paper, in your words:
- the goal
- the points you want to make, as a checklist
- the length in words or pages (300 words a page unless you say otherwise)
- figures, tables and references
- the sections, each with a word target and its stage: outline, draft, revised or final
- the deadline

`/cowrite:scope edit` sets it up with you in a short interview, or you edit the file yourself.

The pane's **Scope** tab (and `🎯 %` in the status line) measures your manuscript against it:
- **Content:** your points (counted double) and the quantities reached: words, figures, tables, cited references.
- **Finish:** an estimate of the fine-tuning, from each section's stage, less 5 % per open marker (`TODO`, `FIXME`, `??`, `UNVERIFIED`) left in it.
- **Overall:** 70 % content + 30 % finish. It's an estimate, and the tab says so.
- Words per section, by matching your section names to the headings.
- Days left to the deadline, and the words per day you'd need.

Counting needs no AI. Whether a point is actually *made* does: `/cowrite:scope check` (or `c` in the tab) asks the small live-review model to mark each point covered, partial or missing, with a file:line and a short note. It never suggests wording. The check is logged (origin `scope`) like every AI input. A point you tick yourself (`- [x]`) counts as done, whatever the check says.

### If you really want AI text

You can insist. Claude then marks the passage `[AI-TEXT]`, the log flags it, and the disclosure lists it. Nothing is hidden.

### The manuscript guard

Inside a paper, Claude writes only in its own places: `notes/ai/`, `ai-log/`, `disclosure/`, `scope.md` (your answers to the plan), `party/` (your own experts, from your answers), `.cowriting/` and `build/`. Everything else is yours: `manuscript/`, `literature/`, `CLAUDE.md`, `party.md`, `paper.json`, `.claude/`, `.vscode/`. Four layers keep it that way, and each has a known reach:

1. **File tools** (Write, Edit, …) are refused by path. A `manuscript` folder is refused wherever it is; every other file is refused when it lies in the paper and outside Claude's places. Case is ignored and `..` is resolved, so `Manuscript/` or `notes/ai/../../party.md` are covered. The refusal names the file and tells Claude to ask you.
2. **Shell commands** are refused by pattern: a redirect into one of your files, a `cd` into one of your folders, or a writing command (`sed -i`, `cp`, `--write`, `-o`, an editor, an inline script) with one of your folders or files among its words as a path. A pattern can be fooled, by a shell variable, a script file or a symlink.
3. **The workspace's settings** (`.claude/settings.json`, written by `/cowrite:init`, added to an older workspace by `/cowrite:paper upgrade apply`) add Claude Code's own enforcement: `Edit` deny rules for your files, which also bind subagents, and the Bash sandbox with your folders on its write deny list, so the operating system refuses a shell write whatever the command looks like. With the sandbox on, Claude Code runs sandboxed commands without a permission prompt (its default; set `sandbox.autoAllowBashIfSandboxed` to `false` to keep the prompts). The sandbox also cuts the shell off from the network: the settings allow `doi.org` and `api.crossref.org` for `verify_refs.py`, and on macOS the local Zotero API; on Linux the Zotero search needs `sandbox.excludedCommands`. Any other host prompts you once. In the `projects/<name>/` layout the rules live at the workspace root, one paper after another.
4. **After any writing tool ran**, your files are compared with how they were before. A change is logged as a `guard` entry with the tool and the files, shown above the prompt, counted in the pane and, for manuscript files, listed in the disclosure under *Manuscript changes detected during AI tool calls*. Check the git diff when you see one.

The guard refuses what it can recognise, the sandbox refuses what the patterns cannot see, and the comparison records the rest. For a technical guarantee that holds even with the plugin off, run Claude Code in a container with `manuscript/` and `literature/` mounted read-only and edit on the host. What no layer can see is text you paste from the chat yourself. For that, the `[AI-TEXT]` marker and your own annotations are the record.

## The review party

### Composing your party

Every paper has its own party, and you compose it. `/cowrite:init` asks who joins; `/cowrite:party` shows the roster, `/cowrite:party add reviewer-2` and `/cowrite:party remove clinician` change the catalogue members (kept in `paper.json`), and only the members are offered to Claude and shown in the pane.

An expert the catalogue lacks, you make yourself: `/cowrite:party new neurologist "The Neurologist" clinical neurology, diagnostics` writes a skeleton to `party/neurologist.md` and Claude interviews you about the field, what the expert looks at, what counts as evidence there and how they speak, then fills the file in. The file is a short Markdown document: frontmatter with `name`, `short`, `role`, `category` and `colour`, then the persona's perspective and voice. Edit it any time. The plugin appends the party's shared ground rules (hints and questions only, no text, nothing invented) and registers the expert as the `cowrite:<id>` agent from the next turn on, with read-only tools; it gets a sprite in the pane, a section in `party.md` when you brief it, and levels like the others. To retire one, delete its file.

### Briefing the party for your project

Each paper has a `party.md` file, written by you:
- **`everyone`:** the project for the whole party: field, target journal or examiner, audience, style guide, US or British English.
- **One section per persona:** what that persona should look for here. For example, *ICD-11 terms only* for the Terminologist, or *IMRaD, 8,000 words* for the Architect.

The plugin attaches the matching sections to a persona's task every time it reviews, whether you summoned it, asked it a question, or it's watching live. `/cowrite:init` asks about the project and fills in `everyone`. After that you can brief a persona at any time: `/cowrite:brief <persona>` starts a short interview, or edit `party.md` directly. In the pane, 📋 marks the personas you've briefed.

Each persona is a read-only subagent that looks at your text from one perspective. Each one gives hints and questions, never replacement text. The catalogue that ships with the plugin:

| | Persona | Perspective |
|---|---|---|
| ![](docs/img/grammar-guy.png) | **Grammar Guy** | Grammar, spelling, punctuation (EN/DE). The one persona that may show corrected sentences. |
| ![](docs/img/statistics-nerd.png) | **Statistics Nerd** | Design, tests, effect sizes, reporting guidelines |
| ![](docs/img/reviewer-2.png) | **Reviewer #2** | Weaknesses, limitations, overclaims |
| ![](docs/img/librarian.png) | **The Librarian** | Sources, Zotero, Obsidian, DOI checks |
| ![](docs/img/architect.png) | **The Architect** | Structure, argument flow, red thread |
| ![](docs/img/integrity-guardian.png) | **Integrity Guardian** | Good scientific practice, plagiarism closeness, disclosure gaps |
| ![](docs/img/lay-reader.png) | **The Lay Reader** | Clarity for non-experts |
| ![](docs/img/style-coach.png) | **The Style Coach** | Writing style compared with papers you like: put 3–5 of them into `literature/style-models/` (git-ignored). It measures sentence rhythm, voice, hedging and connectors with `style_profile.py`, then gives hints on patterns, never sentences to copy. |
| ![](docs/img/terminologist.png) | **The Terminologist** | Is this what the field calls it? Flags unusual, outdated or inconsistent terms, names the usual term with a source (thesaurus, guideline, your literature), and asks for a definition where you deviate on purpose. |
| ![](docs/img/clinician.png) | **The Clinician** *(not in the default party)* | Clinical relevance, patient perspective, for medical and health texts |

### The game

The game rewards **your own writing and your transparency, never AI use**:

- **Writer XP:** words you add to `manuscript/` (1 XP per 10 words). Only growth above your previous maximum counts, and text that was there before you started is the baseline.
- **Transparency XP:** annotations, verified references and generated disclosures.
- **Persona levels:** a persona levels up only when you *act* on its hints (annotated *adopted* or *adapted*). Summoning alone earns nothing.
- **Achievements:** First 1,000 own words, Seven-day streak, Clean Record, Citation Hunter, Survived Reviewer #2, Own Voice (decide against 5 hints), Transparent Scholar… None of them rewards consulting the AI.
- **Overreliance nudge:** the Integrity Guardian speaks up when one persona does most of the work, AI-written text keeps showing up, or the manuscript changed during an AI tool call.

## Privacy

Everything stays in your workspace: logs, notes, game state. CoWriting contacts the network only when you ask it to: `/cowrite:overleaf pull` reads your Overleaf project, and source checks use Crossref for DOIs and titles, your Zotero on `localhost`, and the web through Claude Code's own search tools when a persona looks for literature. Nothing else is sent anywhere. What Claude sees is governed by your Claude Code account and settings, as usual.

Do not put confidential review material or unpublished third-party data into prompts. Autosave commits `ai-log/`, which makes your process verifiable. The log holds your prompts, so before you push the repository anywhere public, check that you're happy to publish them, or switch autosave off.

## Disclaimer

CoWriting supports good practice. It doesn't replace the rules of your university, journal or funder, and it doesn't replace your own judgement. Check what your examination regulations or target journal require, and adapt the generated disclosure to them.

## Development

```
claude --plugin-dir plugin          # run Claude Code with the plugin from this folder
claude plugin validate plugin       # check manifest and hooks
claude plugin test plugin           # run plugin/tests/*.test.tsx
python3 -m unittest discover -s plugin/tests -p 'test_*.py'   # the Python tools, disclosure included
python3 scripts/render_sprites.py   # re-render the persona PNGs and the icon
```

CI runs the same three checks on every push. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding personas to the catalogue. An expert for your own paper needs no code: `/cowrite:party new`.

## License

[MIT](LICENSE)
