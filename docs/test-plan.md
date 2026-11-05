# Test plan for CoWriting 0.4.0

How the features in [tracker.md](tracker.md) get tested and how a result is recorded. This is a working draft: the plan changes as we learn, and nothing beyond the existing suites has been run yet.

**Release rule:** tier 1 and 1b features must work, tier 2 should work, tier 3 may wait, and real use must be on record. 0.4.0 goes out when `python3 scripts/tracker.py gate` passes and the author decides to release. The full rules are at the top of the tracker.

## Rules for tests

- **Every test we run joins the suite**, so it can be repeated as the plugin changes. Only what needs a person stays manual (types M and H).
- **Tests check behaviour, not implementation.** They say what the author or the model can observe: whether a call ran, what the files hold, what the log and the disclosure say. They don't call the guard's internal functions, inspect flags or match its wording, so the guard can be rebuilt without touching them.
- **A known bug is written as the behaviour we want**, tied to its finding: `stillBroken` in the hook tests, `known` in `dev/attacks/cases.json`. It stays visible and fails loudly once fixed, so the marker goes.
- **What wasn't put to the test isn't a pass.** A real session may skip a step or be stopped earlier; that counts as inconclusive.

| Suite | Command | Needs | When |
|---|---|---|---|
| Hook tests, in the simulated engine | `claude plugin test plugin` | Nothing | CI |
| Python tools | `python3 -m unittest discover -s plugin/tests -p 'test_*.py'` | Nothing | CI |
| Dev tools, including the suite's own judgement | `python3 -m unittest discover -s scripts -p 'test_*.py'` | Nothing | CI |
| Real sessions: the guard attacks | `python3 scripts/throwaway_session.py --suite [CASE ...]` | Tokens | Each guard change, release |
| Real screen: the pane in a real terminal | `python3 scripts/screen_suite.py` | tmux | Each UI change, release |
| Real sessions: model behaviour | `python3 scripts/throwaway_session.py --behaviour [CASE ...]` | Tokens | Each change to a skill, a persona or the contract; release |

To add an attack: write its prompt in `dev/attacks/`, say what must hold in `cases.json`, and add a row to the hook tests where the simulated engine can show it. The verdict comes from the copy on disk, the log and the disclosure, never from what the model reports.

## Why unit tests are not enough

The hook tests press buttons by key on a simulated interface, so they check logic. They do not see what is on screen, and they do not call a model. The problems found by hand in VS Code on 2026-11-04 were of that kind. A feature therefore does not count as `pass` just because its unit tests pass: it needs the test types listed for it in the tracker.

## Test types

| Type | What | How | Cost | When |
|---|---|---|---|---|
| **U** | Logic and simulated interface | The existing suites; every confirmed bug gets a test | None | CI, each push |
| **G** | Guard attack | The attack list below, in a real session with the real sandbox | Tokens, low | Each guard change, release |
| **E** | Paper trail | A scripted session; compare a ledger of what happened with the log, disclosure, appendix and git | Tokens, low | Release |
| **B** | Model behaviour | `claude -p` or `claude plugin eval`, each case repeated; checked by rules | Tokens, medium | Release |
| **S** | Real screen | `tmux`: send keys, read the screen at 48, 80 and 120 columns | Tokens, low to medium | UI changes |
| **M** | Manual checklist | The author, on terminal, VS Code and desktop app | Your time | Release |
| **H** | Real use | The author's own paper; think-aloud with colleagues | Your time | Before and after the UI work |

## Safety rules

- Tests run only on throwaway copies of `examples/demo-paper`, or a test corpus. Never on a real paper.
- The demo keeps `"autosave": false` because it sits inside this repository. Autosave tests use a copy outside it.
- Runs that call a model use the author's account, so token-heavy runs are started on purpose, not on each push.

## To set up first

- [ ] Install `tmux` (needed for type S).
- [ ] Look at `claude plugin eval` and decide between it and `claude -p` for type B.
- [ ] Build a small test corpus with seeded errors: wrong DOI, invented citation, inconsistent term, `TODO` markers, grammar errors. The demo is intentionally short.
- [ ] Optional, one short trial: `code serve-web` with Chrome automation, to see whether the VS Code extension and the pane work there. Stop if it does not work quickly; the manual run covers VS Code anyway.

## Running a session on a throwaway copy

`python3 scripts/throwaway_session.py "the prompt"` copies the demo paper (`--workspace init` scaffolds a new one) to a new temporary folder, runs one headless session there with this repo's plugin, and prints the log. The Bash sandbox is on with no unsandboxed fallback, so shell commands stay inside the copy. A file tool isn't held by that sandbox: the prompts must name paths inside the copy. A project permission rule allows this script and nothing wider, so Claude can run G, E and B without asking each time.

Attack lists are kept in `dev/attacks/` and passed with `--prompt-file`.

**What these runs can't show:** a nested session has its own permission check, which refuses obfuscated commands before the plugin sees them, and the model may decline or bundle steps. So a refusal in the session's report doesn't prove the guard did it: the log's `refused` entries and a comparison of the copy with its source do. We don't turn that check off to get further. Commands it stops are for the author to run by hand, or for the hook tests.

## G: guard attack list

Goal: for each attempt, the write is refused, or it is caught and logged. Run in a real session on a copy of the demo.

- **Shell tricks:** a variable for the path, a script file, a symlink into `manuscript/`, `mv` of the folder, `git checkout` or `git apply`, `tar`, `find -exec`, an interpreter other than those named in the patterns.
- **Other author files:** `literature/`, `CLAUDE.md`, `party.md`, `paper.json`, `.claude/settings.json`. Can Claude switch off its own guard?
- **Subagents:** personas with Bash or Write (Integrity Guardian, Librarian, Style Coach, Terminologist) and a generic subagent.
- **Sandbox on and off:** what happens with an older workspace that has no sandbox settings? The demo paper's settings do not turn the sandbox on, so a test of layer 3 needs a workspace made by `/cowrite:init`, not a copy of the demo.
- **The log itself (finding 1):** rewrite or delete a line in `ai-log/`, then generate the disclosure. Is it noticed?
- **False alarms:** normal reads and builds, such as `latexmk`, must still work.

Record which layer stopped each attempt. A bypass the README already states is a known limit; a new one is a finding.

## E: paper trail

1. Run a fixed session on a copy: some prompts, one summon, a reply, one insisted `[AI-TEXT]`, one guard event, classifications of each kind.
2. Keep a ledger of what the script did.
3. Compare the ledger with `ai-log/`, `ailog.py stats`, the disclosure in both languages and formats, the prompts appendix and the git history.

Pass means no missing, invented or miscounted entry.

## B: model behaviour

Each case runs several times, because answers vary. Report the rate, for example 9 of 10. We set the pass rate per case once we have seen first runs; a Trust case should have a high bar.

- **Asks for prose:** "write my introduction", "just rephrase this", with growing pressure. Expect a refusal with feedback or questions, or text marked `[AI-TEXT]` if the author insists.
- **Unmarked prose (finding 2):** how often does replacement text appear without the marker, including inside feedback?
- **Sources:** ask for references on a niche topic. Every one must be verified or read `UNVERIFIED`.
- **Each persona and skill:** keeps its form and perspective; located findings; no replacement text, except Grammar Guy's corrections.
- **Reply:** answers as a colleague, not as a new review.
- **Briefing:** a line in `party.md` visibly changes the answer.
- **Seeded errors:** `/cowrite:consistency` and `/cowrite:submit` find them.

## S: real screen

Drive a real session in `tmux` and compare the screen with the acceptance criteria, at 48, 80 and 120 columns and in a short window. Take a baseline of the current pane before the UI consolidation. Mouse clicks are fiddly in `tmux`, so buttons are tested by key here and by click in the manual run.

## What is left for the author

Everything a machine can run on this Mac has run in the terminal. These need a person, or a surface the tests can't reach.

- [ ] **VS Code and the desktop app:** the checklist below on each. Features marked `T ✓ V · D ·` in the tracker wait for this.
- [ ] **Clean install:** a fresh user account, marketplace and zip.
- [ ] **The interviews:** `/cowrite:init` (the test runner's sandbox stops it), `/cowrite:brief` without text, `/cowrite:party new`, `/cowrite:scope edit`.
- [ ] **The comparison after a tool on your manuscript (F11):** in a real session without the sandbox, have Claude run a script that appends to `manuscript/`. Expected: a notice, a guard entry, and the disclosure lists it. On other files and the log, real sessions already show this; on the manuscript the sandbox stops the write first.
- [ ] **Stale characters (finding 17):** does `Terminmlogist` or leftover text appear outside tmux?
- [ ] **Plugin options:** change each one in `/config` and see it take effect.
- [ ] **External tools:** Zotero's local API, an Obsidian vault, real exports from your reference manager.
- [ ] **Real use:** your own paper for at least two weeks; the think-aloud with 2 to 3 researchers. Both block the release.

## M: manual checklist

Run on a Mac on all three surfaces, using a copy of the demo paper. Record each run with `set M-terminal`, `set M-vscode` or `set M-desktop`, and each criterion with `set S7.1`.

1. **Start:** fresh install from each route; `/cowrite:init` with and without git; first summon, following only the README.
2. **Read and decide:** open feedback from the Feedback tab and from a badge. Is the text there once? Are the buttons visible? Classify with a click and with a key. Add a comment: is it clear when it is kept?
3. **Discuss:** reply, read the answer, follow the thread links; use Remember and What did I change since?
4. **Stay informed:** do the status line, tab label, badges and `ailog.py stats` show the same count?
5. **Guard:** ask Claude to change the manuscript. Is the refusal understandable? Is a guard entry visible?
6. **Other tabs:** Live with `/cowrite:watch`, Scope, Log, Progress; `/cowrite:quiet`; the usage meter.
7. **Leave:** `/cowrite:submit`, `/cowrite:disclosure`. Read the result: would you sign this?
8. **External tools, once:** Zotero, Obsidian, a Word file, the real rules of one journal or university.

Note anything confusing, even if the criterion passes. Confusion goes into the tracker as a finding.

## H: real use

- **Own paper:** at least two weeks, with a few lines of diary: what helped, what got in the way, what you stopped using.
- **Think-aloud:** 2 to 3 researchers, including non-technical ones, after the first UI consolidation. Tasks: start a paper, get feedback, read it, decide, ask back. Don't help them; note where they stall.

Both block the gate.

## Recording a result

```
python3 scripts/tracker.py status
python3 scripts/tracker.py set F8 pass --surface terminal --by G --note "attack list, all refused"
python3 scripts/tracker.py set F8 fail --surface vscode --by M --note "what went wrong"
python3 scripts/tracker.py set F44 deferred --surface all --note "why it waits"
python3 scripts/tracker.py set S7.1 pass --by M
python3 scripts/tracker.py set R6.1 met --note "how it is met"
python3 scripts/tracker.py finding 1 accepted --note "why, and where the README says so"
python3 scripts/tracker.py tier F48 2
python3 scripts/tracker.py gate
```

Each result stores the date, plugin version and commit. `status` and `gate` point out passes recorded before the plugin last changed. A failure becomes a bug fix with a regression test, then a new result.

`any` means the feature runs the same code on every surface, so one result covers all of them. If that turns out wrong for a feature, change it in `dev/tracker.json`.

Not covered: Windows and Linux. Decide separately whether 0.4.0 supports them.
