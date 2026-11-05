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
| Responsibility | You classify each AI input: **✓ used** (adopted), **✎ changed** (adapted), **✗ not used** (rejected) or **ℹ info**. The pane lists what is open; you open one, read it whole, add a comment if you like, and decide. On request the model describes what your manuscript's diff shows since that input, but it never decides for you. |
| No fabricated sources | References need a verified DOI or a citekey from your reference manager's export. `verify_refs.py` checks your bibliography (`.bib`, CSL JSON, RIS, PubMed) against Crossref. |

The background research and requirements are in [docs/research-and-requirements.md](docs/research-and-requirements.md). How each feature maps to the DFG principles is in [docs/gwp-rationale.md](docs/gwp-rationale.md).

> **Early alpha.** CoWriting is under development and a one-person project. Commands, files and the folder layout can change massively between releases, and an update may ask you to upgrade an existing paper. Keep your own backups of your manuscript. Feedback, bugs and ideas are welcome as [GitHub issues](https://github.com/dozwa/claude-cowriting/issues) or by mail to dorianzwanzig@gmail.com. The software comes as is, without warranty or liability of any kind, as the [MIT license](LICENSE) states; see [Disclaimer](#disclaimer).

## Install

CoWriting runs in Claude Code: in a terminal, in the VS Code extension, and in the **Code** tab of the Claude desktop app. It needs Python 3 on your machine.

It does **not** work in chat, neither on claude.ai nor in the desktop app's Chat tab. The plugin installs there, but chat ignores a plugin's hooks and agents, so the manuscript guard, the AI log, the assist-only contract and the personas are missing. Don't use it for a paper in chat.

### Two ways to install

There are two routes on every surface. Pick one, then follow the steps for your surface below.

| | From the marketplace (automatic) | From the zip (manual) |
|---|---|---|
| How | Claude Code fetches the plugin from this repository, which is also its marketplace | You download `cowrite.zip` from a release and hand it to the app, or unzip it for the terminal |
| Updating | One action per release (**Update now** in `/plugin`), or by itself once you switch auto-update on for the marketplace | Download the new zip and upload it again; what you have stays as it is until then |
| Needs | git on the machine (Claude Code clones the marketplace with it) and network access at install time | Nothing beyond Python 3; works on a machine without git, and offline once downloaded |
| Choose it when | You want to stay current without thinking about it, or you work in a terminal or VS Code | You want a known, fixed version (a thesis you don't want to change under you), have no git, or prefer a file over a command in the desktop app |

Both routes install the same plugin. The marketplace route is the usual one; the zip is for people who want to decide when their tools change, or who can't run git.

Whichever you choose, the config screen asks for your options. All of them can be changed later in `/config`:

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

The three choice fields (language, focus mode, usage meter) are typed as text in `/config`; a value outside the list falls back to the default.

### In a terminal or VS Code

**From the marketplace.** At the Claude Code prompt, type:

```
/plugin install cowrite --marketplace dozwa/claude-cowriting
```

Claude Code shows the marketplace it resolved and asks you to confirm adding it, then opens the plugin's details, where you pick a scope. User scope is recommended: the plugin is then there in every folder, and the desktop app's Code tab sees it too. In the VS Code extension you can also type `/plugins`, add `dozwa/claude-cowriting` on the **Marketplaces** tab, and click **Install** next to CoWriting on the **Plugins** tab. From a shell, without a session:

```
claude plugin install cowrite --marketplace dozwa/claude-cowriting
```

**From the zip.** Download [cowrite.zip](https://github.com/dozwa/claude-cowriting/releases/latest/download/cowrite.zip), unzip it, and start Claude Code with the folder:

```
claude --plugin-dir ~/Downloads/cowrite
```

This loads the plugin for that session only, so put the flag in a shell alias if you use it daily. The terminal has no permanent zip install; that is what the marketplace route is for.

### In the Claude desktop app

Tested on the Mac: the plugin works in the app's Code tab, with the pane, the guard and the log.

**From the marketplace.** The Code tab is a Claude Code session, so the same command works at its prompt:

```
/plugin install cowrite --marketplace dozwa/claude-cowriting
```

Confirm the marketplace, pick a scope, done. From then on the **+** button next to the prompt box (**Add plugins**, or **Plugins > Browse plugins**) lists CoWriting among the plugins of your marketplaces, and **Manage plugins** in the same menu enables, disables or uninstalls it. If you installed at user scope in a terminal earlier, nothing is left to do: the app's local sessions read the same settings files.

**From the zip.** The app takes a plugin as a zip file:

1. Download [cowrite.zip](https://github.com/dozwa/claude-cowriting/releases/latest/download/cowrite.zip), the plugin folder of the newest release. Every release has one under [Releases](https://github.com/dozwa/claude-cowriting/releases).
2. In the app, open **Customize > Plugins**, click **Add > Upload plugin** and pick the file.
3. Open the **Code** tab, start a session in your writing folder, and type `/cowrite:init`. The options above are in `/config`.

The upload is a snapshot: to update, download the zip of the new release and upload it again.

If you zip a checkout yourself, zip the `plugin` folder on its own. The app wants `.claude-plugin/plugin.json` at the zip's root or inside one top-level folder; in a download of the whole repository it sits two folders deep, and the upload is refused.

### Updating

- **Marketplace install.** In a session: `/plugin`, **Installed** tab, CoWriting, **Update now**; or `claude plugin update cowrite@cowriting` in a shell. Claude Code leaves a third-party marketplace alone until you switch it on: `/plugin`, **Marketplaces** tab, `cowriting`, **Enable auto-update**. From then on every release is fetched after a session starts and loaded in the next one; the running session keeps what it loaded.
- **Zip install.** Download the new `cowrite.zip` and upload it again in the desktop app, or unzip it over the old folder for `--plugin-dir`.
- **Either way**, a release can change the files a paper carries, such as the guard's rules or the templates. `/cowrite:paper upgrade` in the paper folder lists what an existing paper lacks, and `/cowrite:paper upgrade apply` makes the changes.

## Start a paper

Open your writing folder in VS Code (or a terminal), start Claude Code, and run:

```
/cowrite:init
```

Claude Code runs somewhere else, e.g. in your home folder? Give the paper's folder: `/cowrite:init ~/Papers/my-thesis` sets it up there. Later, `/cowrite:paper ~/Papers/my-thesis` opens it again from anywhere, and `/cowrite:paper` alone lists your recent papers to pick by number. If the folder already holds your draft (say `paper.md`), move it into `manuscript/` yourself afterwards; Claude never touches that folder.

If you already keep Claude Code's Bash sandbox switched on, it stops the setup from writing `.claude/settings.json`: switch it off for this one step, or run `new_paper.py` yourself in a terminal.

Claude asks five questions:
- LaTeX or Markdown
- English or German
- this folder or a new `projects/<name>/` (for several papers in one folder)
- who joins your review party: the nine general personas, The Clinician for medical texts, and any expert of your own (an ontologist, a general practitioner, a neurologist, a lawyer: whoever your field needs). Claude interviews you about each expert you ask for and writes it down as `party/<id>.md`.
- with or without git. Claude explains both right there: with git, your manuscript and the AI log are saved after each writing pause and the history shows how your text grew; without git, nothing is saved automatically and you keep your own backups. Everything else works the same either way (see below).

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

**Never used git?** You don't have to. Choose *without git* at setup (or run `/cowrite:paper versioning none` later) and the paper is set up with no repository: nothing is saved automatically, so keep your own backups and versions as you do today. The review party, the AI log and the disclosure work exactly the same. Two things need the history and tell you so when it's missing: the pane's "What did I change since?" button, which compares your text with the version from before a piece of feedback, and the word counts in the autosave messages. The pane header says `no git` for such a paper. We recommend git all the same, because the history is the best evidence of your own authorship: `/cowrite:paper versioning git` switches it on at any time, and if git isn't installed yet, [git-scm.com](https://git-scm.com) has it for every system.

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

The CoWriting pane works in the terminal, in the VS Code extension and in the desktop app's Code tab.

## Daily use

| Command | What it does |
|---|---|
| `/cowrite:pane [party\|feedback\|live\|log\|scope\|progress]` | Opens the **CoWriting pane** (on that tab) with the keyboard in it. Click a persona's name to summon it, or its ✉ badge to read what it said. The number keys switch tabs, `w` turns live review on or off, `r` refreshes, `o` opens the newest unclassified input on the Feedback tab, `a`/`d`/`x`/`i` classify it as adopted/adapted/rejected/info, `y` goes to the reply field, `c` asks what you changed since, `m` has a persona remember what a discussion settled, `Esc` goes back to the prompt |
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
| `/cowrite:quiet [off\|calm\|focus]` | Switch the focus mode for this session. `ctrl+o` always shows everything in full. |
| `/cowrite:disclosure` | Generate the AI register, and the prompts appendix if your university asks for one (`ailog.py prompts`) |
| `/cowrite:scope [check\|edit]` | Progress against your plan in `scope.md`; `check` asks which of your points the text makes; `edit` sets the scope with you |
| `/cowrite:paper [path \| number \| name \| upgrade [apply]]` | Open a paper folder by path from wherever Claude Code runs, pick a recent one by number, or switch `projects/<name>`; alone, it lists recent papers. `upgrade` shows what a workspace from an earlier plugin version lacks, `upgrade apply` adds it (see below) |

The status line shows `✍ <paper> · assist-only · Lv3 · 2 to classify · ctx 42% · 5h 63%`. The pane opens with a transparent background, so it blends with your terminal (set your terminal profile to black for the dark look). When AI inputs pile up unclassified, or an answer contains AI-written text, a band above the prompt reminds you.

### Reading and classifying feedback

The pane's **Feedback** tab lists every AI input you still owe a classification: who said it, when, and its first words; the tab's label counts them, and each persona's card on the Party tab wears a ✉ badge with its own count, which opens the newest. Open one and you get the four choices and a comment field at the top, and below them the whole thread, rendered as Markdown, so a persona's table of corrections reads as a table: the feedback, your replies and the answers, in order, once each. What Claude said when a report came back is shown only if it adds something. The choices stay at the top on purpose: a long report never pushes them out of a short pane. In a short pane, PgDn takes you to the text. The comment is saved with your choice, and goes into the log entry and from there into the prompts appendix, next to its turn. In a window too small to show the choices, the pane says so and no key decides.

**Reply** is at the end of the thread: `y` takes you to the field, you type, and Enter sends it, and your words and the answer appear in the thread right there. The conversation also runs in the transcript, as every request does. For a persona, Claude hands the agent its earlier feedback together with your reply, and the persona answers as a colleague in a conversation would: it takes a position, gives reasons, concedes or holds its ground, asks back. No new review, no report template. You can tell it how to weigh things in this paper, and it takes that on for its answer.

The exchange is a **thread** in the log too: your reply names the feedback it answers, the persona's answer names your reply. The Feedback tab marks an answer with ↳, a link in the thread opens any answer to decide on it, and the prompts appendix says "in reply to" with the time. Each answer is AI input like any other and asks for a classification of its own.

The personas have no memory between runs: each answer is a fresh run of the agent with what Claude hands it. What persists is the briefing in `party.md` (`/cowrite:brief`), which every run reads. **Remember** (`m`) on a persona's input bridges the two: the live-review model distils the input and, if there was one, the discussion on it into at most two briefing lines for that persona, in your words where you said it. The lines appear in a field you can edit; **Save to party.md** appends them under the persona's heading, **Discard** drops them. Nothing is written before you save, and the proposal is logged as AI input of its own, with your decision as its annotation, so the disclosure can say that a persona's briefing was partly drafted by the model and confirmed by you. From the next summon on, the persona reads what it should keep in mind.

**What did I change since?** asks the model what your manuscript's diff shows between that input and now: it takes the autosave commit from just before the input, diffs it to your working copy, and answers in three sentences at most, with the live-review model. It describes, it doesn't judge or classify; you can take the description as your comment, edit it, or ignore it. The call is logged like any AI input, under its own category, and needs no classification of its own. It needs autosave (or your own commits): without a saved version from before the input there is nothing to compare.

### Live review

`/cowrite:watch` turns on a reviewer that looks over your shoulder:
- **When it looks:** when you pause writing for about 20 seconds.
- **What it sends:** only the paragraphs you just changed, to a small, fast model (option *Live review model*, default `haiku`).
- **What you get back:** at most 3 short hints, each about one line, from the watching personas. They appear above the prompt and in the pane's **Live** tab; while the Live tab is on screen the band stays out of the way. Each review has its own four buttons, and a classified review's hints leave both places.
- **The rules stay the same:** no rewritten sentences. Grammar Guy may give a corrected word, and the Terminologist may name the usual term.
- **Limits:** at most one review a minute and 20 an hour.
- **Logging:** every review is logged, so it shows up in your disclosure.
- **Annotation:** marking live hints is optional; they don't count toward the "unannotated" reminder.

Choose the watchers with `/cowrite:watch on terminologist grammar-guy`, or `/cowrite:watch on all`. Stop with `/cowrite:watch off`.

When a persona reviews on request, the transcript shows a single progress line (`🎭 The Terminologist ▰▰▰▱▱ 4 steps · Read main.tex`) and a one-line note when the report comes back. Press `ctrl+o` for the full text.

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

You can insist. Claude then marks the passage `[AI-TEXT]`, the log flags it, and the disclosure lists it.

The plugin recognises AI text by that marker, which Claude writes itself. In our tests Claude declined every request for text unless the author insisted, and then marked it. But if a model ever wrote text without the marker, the flag and the disclosure's list would miss it. The answer would still be in the log and the prompts appendix, word for word.

### The manuscript guard

Inside a paper, Claude writes only in its own places: `notes/ai/`, `disclosure/`, `scope.md` (your answers to the plan), `party/` (your own experts, from your answers), `.cowriting/` and `build/`. Everything else is yours: `manuscript/`, `literature/`, `CLAUDE.md`, `party.md`, `paper.json`, `.claude/`, `.vscode/`. Four layers keep it that way, and each has a known reach:

1. **File tools** (Write, Edit, …) are refused by the file they name: if it lies in a paper, wherever that paper is and wherever the session runs, and outside Claude's places. A `manuscript` folder anywhere in a paper is refused. Case is ignored and `..` is resolved, so `Manuscript/` or `notes/ai/../../party.md` are covered. The refusal names the file and tells Claude to ask you.
2. **Shell commands** are read for where they write: a redirect, the target of `cp`, the files of `rm`, `mv`, `sed -i` or an editor, `-o` and `--write`, following `cd`, `$(…)` and `sh -c`. The same rule then applies to each file, so reading from your files or naming them in a message is fine: `cp manuscript/main.md notes/ai/copy.md` works. Working inside a paper, a write the text can't place, through a variable or an inline script, is refused if it names one of your files or folders. This reading can be fooled, by a script file, a symlink or a variable that hides the name.
3. **The workspace's settings** (`.claude/settings.json`, written by `/cowrite:init`, added to an older workspace by `/cowrite:paper upgrade apply`) add Claude Code's own enforcement: `Edit` deny rules for your files, which also bind subagents, and the Bash sandbox with your folders on its write deny list, so the operating system refuses a shell write whatever the command looks like. With the sandbox on, Claude Code runs sandboxed commands without a permission prompt (its default; set `sandbox.autoAllowBashIfSandboxed` to `false` to keep the prompts). The sandbox also cuts the shell off from the network: the settings allow `doi.org` and `api.crossref.org` for `verify_refs.py`, and on macOS the local Zotero API; on Linux the Zotero search needs `sandbox.excludedCommands`. Any other host prompts you once. In the `projects/<name>/` layout the rules live at the workspace root, one paper after another.
4. **After any writing tool ran**, your files are compared with how they were before. A change is logged as a `guard` entry with the tool and the files, shown above the prompt, counted in the pane and, for manuscript files, listed in the disclosure under *Manuscript changes detected during AI tool calls*. Check the git diff when you see one.

The guard refuses what it can recognise, the sandbox refuses what the text does not show, and the comparison records the rest. For a technical guarantee that holds even with the plugin off, run Claude Code in a container with `manuscript/` and `literature/` mounted read-only and edit on the host. What no layer can see is text you paste from the chat yourself. For that, the `[AI-TEXT]` marker and your own annotations are the record.

### The guard stays out of your other projects

The plugin is usually installed for every folder, so the guard acts only on papers. A paper is a folder with a `paper.json` and a `manuscript` or `ai-log` folder, as `/cowrite:init` sets it up. The rule for a file is the same wherever the session runs: does it lie in a paper? So another project can have a `CLAUDE.md`, a `manuscript` folder or a file or folder of any other of these names and work as usual, even while you have a paper open or the session started inside one. Everything in a paper folder counts as part of that paper, so keep other projects outside it.

This has a price. Working outside a paper, the guard acts only on what it can see, so a command there that hides a paper's path, in a shell variable or a command substitution, isn't stopped and isn't logged. To be protected, work on a paper from inside it.

### The AI log only grows

Your disclosure is built from `ai-log/`, so nothing already in it may change. The plugin and `ailog.py annotate` append to it. File tools are refused, and so are shell commands whose text shows they would do anything but append. After every tool call the log is compared by content: if a call rewrote or removed anything, the plugin puts it back, keeps the altered version in `.cowriting/log-rewrites/`, shows you a notice and lists it in the disclosure under *Changes to the AI log undone after a tool call*.

Refused attempts are on the record too, for your manuscript, your other files and the log alike: each one is a log entry, and the disclosure lists them under *Write attempts by the AI that the guard refused*. They changed nothing, and the pattern check can also refuse a harmless command, so read that list as what was tried, not as what went wrong. It holds a shortened form of each command, so check it before you hand the disclosure in.

A new file in the log, other than this month's, is treated the same way: it is taken out, kept there, and listed.

This has limits. An append can't be told from a true entry, so Claude could still add a line with a shell command. The operating system's sandbox has no "append only", so this rests on the plugin's hooks: a background process that outlives its tool call, or a change made with the plugin off, isn't noticed. Your own edits to the log aren't blocked either, unless they land during a tool call, in which case they are restored like any other. With autosave on, the git history is the independent record.

## The review party

### Composing your party

Every paper has its own party, and you compose it. `/cowrite:init` asks who joins; `/cowrite:party` shows the roster, `/cowrite:party add reviewer-2` and `/cowrite:party remove clinician` change the catalogue members (kept in `paper.json`), and only the members are offered to Claude and shown in the pane.

An expert the catalogue lacks, you make yourself: `/cowrite:party new neurologist "The Neurologist" clinical neurology, diagnostics` writes a skeleton to `party/neurologist.md` and Claude interviews you about the field, what the expert looks at, what counts as evidence there and how they speak, then fills the file in. The file is a short Markdown document: frontmatter with `name`, `short`, `role`, `category` and `colour`, then the persona's perspective and voice. Edit it any time. The plugin appends the party's shared ground rules (hints and questions only, no text, nothing invented) and registers the expert as the `cowrite:<id>` agent from the next turn on, with read-only tools; it gets a sprite in the pane, a section in `party.md` when you brief it, and levels like the others. To retire one, delete its file.

### Briefing the party for your project

Each paper has a `party.md` file, written by you:
- **`everyone`:** the project for the whole party: field, target journal or examiner, audience, style guide, US or British English.
- **One section per persona:** what that persona should look for here. For example, *ICD-11 terms only* for the Terminologist, or *IMRaD, 8,000 words* for the Architect.

The plugin attaches the matching sections to a persona's task every time it reviews, whether you summoned it, asked it a question, or it's watching live. `/cowrite:init` asks about the project and fills in `everyone`. After that you can brief a persona at any time: `/cowrite:brief <persona>` starts a short interview, or edit `party.md` directly. In the pane, 📋 marks the personas you've briefed.

Each persona is a subagent that looks at your text from one perspective. Each one gives hints and questions, never replacement text. Most can only read. The Librarian, the Style Coach and the Terminologist can also write notes to `notes/ai/`, and the Integrity Guardian, the Librarian and the Style Coach can run the plugin's tools in the shell. The guard holds for them as for Claude. The catalogue that ships with the plugin:

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

Everything stays in your workspace: logs, notes, game state. CoWriting contacts the network only when you ask it to check sources: Crossref for DOIs and titles, your Zotero on `localhost`, and the web through Claude Code's own search tools when a persona looks for literature. Nothing else is sent anywhere. What Claude sees is governed by your Claude Code account and settings, as usual.

Do not put confidential review material or unpublished third-party data into prompts. The plugin doesn't check for this and won't warn you, so this one is up to you. Autosave commits `ai-log/`, which makes your process verifiable. The log holds your prompts, so before you push the repository anywhere public, check that you're happy to publish them, or switch autosave off.

## Disclaimer

CoWriting supports good practice. It doesn't replace the rules of your university, journal or funder, and it doesn't replace your own judgement. Check what your examination regulations or target journal require, and adapt the generated disclosure to them: there is one format so far, with no templates per institution.

CoWriting is in early alpha and maintained by one person in their spare time. Functions, commands, file formats and the folder structure can change massively from one release to the next, with no promise of backward compatibility beyond what the release notes say, and there is no guaranteed support or response time. The software is provided "as is", without warranty of any kind, express or implied, and the author is not liable for any claim, damages or other liability arising from its use, including lost text, a wrong or incomplete AI disclosure, or a decision of your university, journal or funder. Those are the terms of the [MIT license](LICENSE), and they apply to the whole project. You remain responsible for your manuscript, your backups and your declarations.

Found a problem or have an idea? Open an [issue on GitHub](https://github.com/dozwa/claude-cowriting/issues) or write to dorianzwanzig@gmail.com.

## Development

```
claude --plugin-dir plugin          # run Claude Code with the plugin from this folder
claude plugin validate plugin       # check manifest and hooks
claude plugin test plugin           # run plugin/tests/*.test.tsx
python3 -m unittest discover -s plugin/tests -p 'test_*.py'   # the Python tools, disclosure included
python3 scripts/render_sprites.py   # re-render the persona PNGs and the icon
```

CI runs the same three checks on every push. A `v<version>` tag, matching the version in `plugin.json`, publishes a GitHub release with `cowrite.zip` attached (the plugin folder, zipped as `cowrite/`) and the changelog section as its notes. The same zip is `git archive --format=zip --prefix=cowrite/ -o cowrite.zip HEAD:plugin`, and `claude --plugin-dir cowrite.zip` loads it for one session. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding personas to the catalogue. An expert for your own paper needs no code: `/cowrite:party new`.

## License

[MIT](LICENSE)
