# CoWriting (`cowrite`)

Assist-only academic co-writing for Claude Code, following the DFG's good scientific practice. Claude gives hints, critique and literature help; it never writes your manuscript. Every AI input is logged, the log becomes the AI disclosure you sign, and a pixel-art review party you compose yourself reads your text from ten perspectives.

Install it in Claude Code with:

```
/plugin install cowrite --marketplace dozwa/claude-cowriting
```

The full documentation, with the commands, the review party and the DFG rationale, is in the repository: https://github.com/dozwa/claude-cowriting

## What the plugin does on your machine

- **Reads** your paper workspace: `manuscript/`, `literature/`, `party.md`, `scope.md`, and, if configured, your Obsidian vault.
- **Writes** only outside your text: the AI log (`ai-log/`), the disclosure (`disclosure/`), `notes/ai/`, `.cowriting/` (plan, game state, verification summary) and an `AI-Notes/` folder in your vault. `manuscript/` and your other files are guarded: a hook refuses writes it recognises, the workspace settings deny the rest, and any change that still happens during an AI tool call is logged as a `guard` entry.
- **Runs** its Python tools (standard library only) from the plugin folder: the AI log, the scaffold, the bibliography reader, the DOI check, the Zotero search and the sprite renderer. With pandoc installed, `.docx` and `.odt` manuscripts are converted to text for reading.
- **Commits** with git when autosave is on (the default): `manuscript/` and `ai-log/`, under your own git identity, after you pause for 30 seconds. Nothing is pushed.
- **Connects** to four places, and only when you ask: your Overleaf project, read through git during `/cowrite:overleaf pull`; Crossref (`api.crossref.org`) to verify DOIs and look up titles during `/cowrite:sources`, `/cowrite:submit` and `verify_refs.py`; your running Zotero 7 on `localhost` when the local API is enabled; and the web through Claude Code's own search tools when a persona looks for literature. Nothing else leaves your machine. What Claude itself sees is governed by your Claude Code account and settings.
- **Shows** a pane beside the chat with the party, the log's open turns, your word counts and, optionally, a token meter.

## What the mod does, hook by hook

The plugin is a mod: `hooks/register.tsx` runs inside Claude Code. This is everything it hooks, runs, writes and sends, so that you can check it against the source.

**Commands it answers.** It registers and handles twelve commands: `/cowrite:scope`, `/cowrite:pane`, `/cowrite:paper`, `/cowrite:init`, `/cowrite:watch`, `/cowrite:overleaf`, `/cowrite:brief`, `/cowrite:party`, `/cowrite:ask`, `/cowrite:quiet`, `/cowrite:summon` and the pane's own. A hook answers the parts that need no model (lists, toggles, saving a brief, adding a party member) with text. Where the model is needed (an interview, a persona's review), the hook checks the arguments and passes the command on unchanged to its skill; it never rewrites the command.

**Prompts.** On `prompt.compose` it adds one section to the system prompt: the CoWriting contract (the assist-only rules the author's `CLAUDE.md` also states) and the roster of this paper's review party. On `prompt.submit` it reads each prompt to write a log entry; it changes nothing and drops nothing. The pane's buttons submit a prompt of their own: the summon button sends "Use the cowrite:<persona> agent to review <section>", with the section or file name the author chose, and the scope button sends the fixed interview text. Nothing read from a file goes into a submitted prompt.

**Tool calls.** On `tool.call` for `Read` of a `.docx` or `.odt` in `manuscript/`, the hook converts the file with pandoc and returns that text in place of the tool's result; for every other file the tool runs as usual. On every other `tool.call`, the hook refuses a write it recognises into the author's files (`manuscript/`, `literature/`, `party.md`, `scope.md`, the author's notes), then compares those files before and after the call and logs any change as a `guard` entry. It never approves a call; the user's permission rules and prompts decide as they would without the plugin.

**Subagents.** On `agent.offer` it hides catalogue personas that are not in this paper's party. On `agent.spawn` it appends two things to a persona's task: where the paper is, when the session runs elsewhere, and the author's briefing for that persona from `party.md`. It sets no model and no permission mode. Experts of the author's own (`party/<id>.md`) are registered as `cowrite:<id>` agents with read-only tools.

**Programs it runs**, all with the user's own access, and only `tools/overleaf.py pull` reaching the network: `git` (`status`, `add`, `commit` in the paper folder, for autosave; never `push`), `pandoc` (to read `.docx` and `.odt`), and `python3` with three of the plugin's own files: `tools/ailog.py annotate` (classifies a log entry), `tools/new_paper.py --upgrade` (the workspace upgrade) and `tools/overleaf.py` (`/cowrite:overleaf`: reads a project by `git pull` or from a zip, mirrors it into `manuscript/` and commits it; never `push`). The arguments are the paper's paths and the author's choices.

**Files it writes**, all inside the paper folder unless named otherwise: `ai-log/<month>.jsonl` (appended), `.cowriting/game.json`, `.cowriting/scope-check.json`, `paper.json` (the party roster), `party.md` (a brief, its section only), `party/<id>.md` (the skeleton for a new expert), and `.active-project` in the session's folder (the name of the paper opened with `/cowrite:paper`). Two files that other tools obey are written by `tools/new_paper.py` on `/cowrite:init` and on `/cowrite:paper upgrade apply` only: the workspace's `.claude/settings.json` (deny rules and sandbox paths that protect the author's files) and its `CLAUDE.md` (the assist-only rules). On an upgrade, your previous copy is kept under `.cowriting/upgrade/<time>/`.

**Model calls.** `$.model.complete` is used in two places, both through the user's own Claude Code account: the live review (`/cowrite:watch`) sends the changed paragraphs of the manuscript to the model named in the "Live review model" option, and `/cowrite:scope check` sends the manuscript and the scope's points. Both are logged like any AI input.

**Other hooks.** `session.start` registers the commands and the pane, `session.measure` feeds the usage meter, `turn.complete` logs the response and starts the autosave timer, and the `ui.render` hooks draw the pane, the band above the prompt and the dimmed transcript of focus mode. The mod reads one environment variable, `HOME`, to expand `~` in paths. It makes no network request of its own.

## Settings

Obsidian vault path, AI notes folder, default language (`en`/`de`), autosave, gamification, Zotero local API, live-review model, focus mode and usage meter. All are asked at install and can be changed in `/config`.

## License

MIT. See the repository's LICENSE file.
