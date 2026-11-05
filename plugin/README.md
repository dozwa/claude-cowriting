# CoWriting (`cowrite`)

Assist-only academic co-writing for Claude Code, following the DFG's good scientific practice. Claude gives hints, critique and literature help; it never writes your manuscript. Every AI input is logged, the log becomes the AI disclosure you sign, and a pixel-art review party you compose yourself reads your text from ten perspectives.

Install it in Claude Code with:

```
/plugin install cowrite --marketplace dozwa/claude-cowriting
```

That works at the prompt of a terminal, of the VS Code extension and of the desktop app's Code tab, and keeps the plugin updatable from `/plugin`. Without git, or for a fixed version, download `cowrite.zip` from a release instead and upload it in the desktop app (Customize > Plugins) or load it with `claude --plugin-dir`. The two routes and when to pick which are compared in the repository's README.

The full documentation, with the commands, the review party and the DFG rationale, is in the repository: https://github.com/dozwa/claude-cowriting

**Early alpha, one-person project.** Commands, files and the folder layout can change massively between releases; keep your own backups. Provided as is, without warranty or liability, under the MIT license. Feedback: https://github.com/dozwa/claude-cowriting/issues or dorianzwanzig@gmail.com.

## Where it works

**Use CoWriting in Claude Code**: in a terminal, in the VS Code extension, or in the Code tab of the Claude desktop app (tested on the Mac, uploaded as a zip under Customize > Plugins). It needs Python 3 on your machine. In chat, on claude.ai or in the desktop app's Chat tab, the plugin installs but doesn't work as described here: in a test, the manuscript guard didn't refuse writes, no AI log was written, the assist-only contract didn't reach Claude, and the personas and `/cowrite:init` failed to load. So don't use it for a paper there. Cowork in the desktop app hasn't been tested, so don't rely on the guard or the log there either.

## Examples

Try these in a paper folder. The repository's [demo paper](https://github.com/dozwa/claude-cowriting/tree/main/examples/demo-paper) is a ready-made fictional workspace with sample data.

1. `/cowrite:init` sets up a paper: it asks for the format, the language, the folder and who joins your review party.
2. `/cowrite:summon grammar-guy manuscript/main.md` asks one persona to review your text and give located feedback. It doesn't change the text.
3. `/cowrite:disclosure` turns the AI log into an AI register for your declaration of authorship or your journal.

## What the plugin does on your machine

- **Reads** your paper workspace: `manuscript/`, `literature/`, `party.md`, `scope.md`, and, if configured, your Obsidian vault.
- **Writes** only outside your text: the AI log (`ai-log/`), the disclosure (`disclosure/`), `notes/ai/`, `.cowriting/` (plan, game state, verification summary) and an `AI-Notes/` folder in your vault. `manuscript/` and your other files are guarded: a hook refuses writes it recognises, the workspace settings deny the rest, and any change that still happens during an AI tool call is logged as a `guard` entry.
- **Runs** its Python tools (standard library only) from the plugin folder: the AI log, the scaffold, the bibliography reader, the style profile, the DOI check and the Zotero search. With pandoc installed, `.docx` and `.odt` manuscripts are converted to text for reading.
- **Commits** with git when autosave is on (the default): `manuscript/` and `ai-log/`, under your own git identity, after you pause for 30 seconds. Nothing is pushed.
- **Connects** to three places, and only when you ask: Crossref (`api.crossref.org`) to verify DOIs and look up titles during `/cowrite:sources`, `/cowrite:submit` and `verify_refs.py`; your running Zotero 7 on `localhost` when the local API is enabled; and the web through Claude Code's own search tools when a persona looks for literature. Nothing else leaves your machine. What Claude itself sees is governed by your Claude Code account and settings.
- **Shows** a pane beside the chat with the party (each persona with a count of its feedback still to classify), the open feedback to read, comment on, classify and reply to, the live hints, the log, your word counts and, optionally, a token meter. The plugin sends a prompt only when the author asks in the pane: pressing Enter in the reply field, or summoning a persona.

## What the mod does, hook by hook

The plugin is a mod: `hooks/register.tsx` runs inside Claude Code. This is everything it hooks, runs, writes and sends, so that you can check it against the source.

**Commands it answers.** It registers and handles eleven commands: `/cowrite:scope`, `/cowrite:pane`, `/cowrite:paper`, `/cowrite:init`, `/cowrite:watch`, `/cowrite:brief`, `/cowrite:party`, `/cowrite:ask`, `/cowrite:quiet`, `/cowrite:summon` and the pane's own. A hook answers the parts that need no model (lists, toggles, saving a brief, adding a party member) with text. Where the model is needed (an interview, a persona's review), the hook checks the arguments and passes the command on unchanged to its skill; it never rewrites the command.

**Prompts.** On `prompt.compose` it adds one section to the system prompt: the CoWriting contract (the assist-only rules the author's `CLAUDE.md` also states) and the roster of this paper's review party. On `prompt.submit` it reads each prompt to write a log entry; it changes nothing and drops nothing. The pane's buttons submit a prompt of their own: the summon button sends "Use the cowrite:<persona> agent to review <section>", with the section or file name the author chose, and the scope button sends the fixed interview text. Nothing read from a file goes into a submitted prompt.

**Tool calls.** On `tool.call` for `Read` of a `.docx` or `.odt` in `manuscript/`, the hook converts the file with pandoc and returns that text in place of the tool's result; for every other file the tool runs as usual. On every other `tool.call`, the hook refuses a write it recognises into the author's files (`manuscript/`, `literature/`, `party.md`, `scope.md`, the author's notes), then compares those files before and after the call and logs any change as a `guard` entry. A `manuscript` folder counts as the author's when it lies in the session's paper or directly beside a `paper.json`; when a path or command doesn't show where it points (a shell variable, a command substitution, an inline script), the hook refuses it, because it could name a paper. A `manuscript` folder in any other project is left alone. It never approves a call; the user's permission rules and prompts decide as they would without the plugin.

**Subagents.** On `agent.offer` it hides catalogue personas that are not in this paper's party. On `agent.spawn` it appends two things to a persona's task: where the paper is, when the session runs elsewhere, and the author's briefing for that persona from `party.md`. It sets no model and no permission mode. Experts of the author's own (`party/<id>.md`) are registered as `cowrite:<id>` agents with read-only tools.

**Programs it runs**, all with the user's own access, none reaching the network: `git` (`status`, `add`, `commit` in the paper folder, for autosave, never `push`; `log` and `diff` of the manuscript when the author asks what changed since a piece of feedback; `init` when the author switches versioning on; a paper set up without git never calls it), `pandoc` (to read `.docx` and `.odt`), and `python3` with two of the plugin's own files: `tools/ailog.py annotate` (classifies a log entry, with the author's comment if they typed one) and `tools/new_paper.py --upgrade` (the workspace upgrade). The arguments are the paper's paths and the author's choices.

**Files it writes**, all inside the paper folder unless named otherwise: `ai-log/<month>.jsonl` (appended), `.cowriting/game.json`, `.cowriting/scope-check.json`, `paper.json` (the party roster and the versioning choice), `party.md` (a brief, its section only; on the pane's Remember, lines appended under one persona's heading after the author saved them), `party/<id>.md` (the skeleton for a new expert), and `.active-project` in the session's folder (the name of the paper opened with `/cowrite:paper`). Two files that other tools obey are written by `tools/new_paper.py` on `/cowrite:init` and on `/cowrite:paper upgrade apply` only: the workspace's `.claude/settings.json` (deny rules and sandbox paths that protect the author's files; it also turns on Claude Code's sandbox for that workspace, which limits shell commands' network access to `api.crossref.org`, `doi.org` and `*.doi.org`) and its `CLAUDE.md` (the assist-only rules). On an upgrade, your previous copy is kept under `.cowriting/upgrade/<time>/`.

**Model calls.** `$.model.complete` is used in four places, all through the user's own Claude Code account and all with the model named in the "Live review model" option: the live review (`/cowrite:watch`) sends the changed paragraphs of the manuscript; `/cowrite:scope check` sends the manuscript and the scope's points; the pane's "What did I change since?" button sends one piece of logged feedback with the manuscript's git diff since then and gets a three-sentence description back, which the author may take as their comment; and the pane's "Remember" button sends one persona's input, the discussion on it and the persona's current brief, and gets at most two briefing lines back, which are written to `party.md` only when the author saves them. All four are logged like any AI input.

**Other hooks.** `session.start` registers the commands and the pane, `session.measure` feeds the usage meter, `turn.complete` logs the response and starts the autosave timer, and the `ui.render` hooks draw the pane, the band above the prompt and the dimmed transcript of focus mode. The mod reads one environment variable, `HOME`, to expand `~` in paths. It makes no network request of its own.

## Privacy

The plugin has no server of its own and collects nothing for its authors. Your logs, notes and game state stay in your workspace. The AI log (`ai-log/`) holds your prompts and Claude's answers; it is append-only and stays until you delete it. Autosave commits the log to your local git repository and never pushes, so check that you're happy to publish your prompts before you push that repository anywhere public, or switch autosave off.

What leaves your machine is listed under *Connects* above. What you send to Claude is governed by your Claude account and settings. Don't put confidential review material or unpublished third-party data into prompts.

## Support

Report bugs, security problems and questions through the repository's [issues](https://github.com/dozwa/claude-cowriting/issues).

## Settings

Obsidian vault path, AI notes folder, default language (`en`/`de`), autosave, gamification, Zotero local API, live-review model, focus mode and usage meter. All are asked at install and can be changed in `/config`.

## License

MIT. See the repository's LICENSE file.
