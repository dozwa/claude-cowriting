# Contributing

Contributions are welcome, especially **personas** for other fields: law, engineering, humanities, education, and so on. An expert for one paper needs no code (`/cowrite:party new` writes a `party/<id>.md` file); the catalogue is for perspectives many authors want.

## The one rule

Every feature must keep the author the author. Nothing in CoWriting may write manuscript text for the user, reward AI use in the game, or hide AI use from the log. If a feature makes AI help easier, it should also keep that help visible.

## Add a persona to the catalogue

1. **Agent:** add `plugin/agents/<id>.md`.
   - Copy an existing persona and keep its *Ground rules* and *Output format* sections word for word.
   - Write the perspective, the checklist and the voice.
   - Use read-only tools unless the persona really needs more.
2. **Sprite and metadata:** add an entry to `PERSONAS` in `plugin/hooks/personas.ts`:
   - `id`, the same as the agent file name
   - `name` and `role`
   - `category`, the log category used in the disclosure. Reuse an existing one if possible, or add a label to `CATEGORY_LABELS` in `plugin/tools/ailog.py` in both languages.
   - `palette`
   - `sprite`: 12 rows of 12 characters. `.` is transparent, and every other character must be in the persona's palette or in `SHARED_PALETTE`.
3. **Images:** run `python3 scripts/render_sprites.py` and add the persona to the README table.
4. **Checks:** run `claude plugin test plugin`. The sprite test checks size and colours.

5. **Default party:** a persona every author wants is in `DEFAULT_PARTY` (`plugin/hooks/personas.ts`) and `DEFAULT_PARTY` in `plugin/tools/new_paper.py`; a field-specific one, like the Clinician, stays out of it and joins with `/cowrite:party add <id>`. Personas outside a paper's party are hidden from the model (`agent.offer`) and from the pane.

## Development

```
claude --plugin-dir plugin
claude plugin validate plugin
claude plugin test plugin
python3 -m unittest discover -s plugin/tests -p 'test_*.py'
```

The road to the next release is tracked in [docs/tracker.md](docs/tracker.md), generated from `dev/tracker.json` by `python3 scripts/tracker.py`; the [test plan](docs/test-plan.md) says how results are recorded. A new skill, agent or tool needs a place in the tracker's feature map, or CI fails.

A change to the manuscript guard needs a case in the guard test, denied or allowed. A change to `ailog.py` needs its line in `test_tools.py`: the disclosure is what an author signs.

Hooks that take `$` must be `function` declarations at the top level of their file; the validator explains why. Everything that takes `$` (the mods API) lives in `plugin/hooks/register.tsx`: the plugin directory reads a mod's calls only through functions declared in the file that registers the hooks, and it blocks `$` handed to a function from another file. Pure logic goes in `plugin/hooks/core.ts`, `personas.ts` and `sprites.ts`, where the tests can reach it without the engine. Inside `register.tsx`, use the names `$`, `e` and `next` for hook parameters only. Python tools use the standard library only.
