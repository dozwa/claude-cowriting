import { expect, mock, test } from 'claude-code/testing'

import {
  ACHIEVEMENTS,
  EMPTY_STATS,
  NEW_GAME,
  absolutePath,
  advanceGame,
  authorFileOf,
  autosaveMessage,
  bashTouchesManuscript,
  bashWritesTo,
  briefFor,
  categoryFor,
  changedFiles,
  changedParagraphs,
  changedPaths,
  computeStats,
  countWords,
  isManuscriptPath,
  limitCrossed,
  overrelianceNudge,
  parseBriefs,
  parseHints,
  parseLog,
  setBrief,
  toUsage,
  usageParts,
  watchExcerpt,
} from '../hooks/core'
import { DEFAULT_PARTY, PERSONAS, SHARED_PALETTE, isCustomId, parsePersonaFile, partyPersonas, personaFileSkeleton } from '../hooks/personas'
import { rasterCells, svgSource } from '../hooks/sprites'
import { parseCheck, parseScope, scopeProgress, withLog } from '../hooks/register'

const ROOT = '/w'

// the agent types the plugin registered since the workspace was mocked
const registered: { name: string; prompt: string; tools: string[] }[] = []

// An in-memory workspace answering the plugin's $.fs and $.session calls.
const workspace = (on: any, files: Map<string, string>) => {
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: files.has(e.path) || [...files.keys()].some(k => k.startsWith(`${e.path}/`)),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', (_: unknown, e: { path: string }) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const k of files.keys()) {
      if (!k.startsWith(`${e.path}/`)) continue
      const [first, ...rest] = k.slice(e.path.length + 1).split('/')
      names.set(first!, rest.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind })) }
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  registered.length = 0
  on('agent.register', (_: unknown, e: { name: string; prompt: string; tools: string[] }) => {
    registered.push(e)
    return { value: { agent: `cowrite:${e.name}` } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
}

const paperFiles = () =>
  new Map<string, string>([
    [`${ROOT}/paper.json`, JSON.stringify({ name: 'demo', format: 'latex', language: 'de', domainPack: 'medicine' })],
    [`${ROOT}/manuscript/main.tex`, '\\section{Intro}\nDas ist mein eigener Text mit sieben Wörtern.'],
  ])

// ------------------------------------------------------------ pure logic

test('every sprite is 12x12 and uses only known colours', async () => {
  for (const p of PERSONAS) {
    expect(p.sprite.length).toBe(12)
    for (const row of p.sprite) {
      expect(row.length).toBe(12)
      for (const ch of row) {
        if (ch !== '.') expect(p.palette[ch] ?? SHARED_PALETTE[ch]).toBeDefined()
      }
    }
    const raster = rasterCells(p)
    expect(raster.columns).toBe(12)
    expect(raster.rows).toBe(6)
    // 12 * 6 cells * 3 u32 * 4 bytes, base64-encoded
    expect(raster.cells.length).toBe(Math.ceil((12 * 6 * 12) / 3) * 4)
    expect(svgSource(p).startsWith('<svg')).toBe(true)
  }
})

test('the guard spots writes into manuscript/ and lets reads through', async () => {
  expect(isManuscriptPath('/w/manuscript/main.tex')).toBe(true)
  expect(isManuscriptPath('/w/projects/a/manuscript/ch1/intro.md')).toBe(true)
  expect(isManuscriptPath('/w/notes/ai/manuscript-notes.md')).toBe(false)
  expect(isManuscriptPath('Manuscript/main.md')).toBe(true) // macOS ignores case
  expect(isManuscriptPath('notes/../manuscript/main.md')).toBe(true)
  expect(isManuscriptPath('manuscript/../notes/ai/x.md')).toBe(false)
  expect(isManuscriptPath('manus*/main.md')).toBe(true)
  expect(isManuscriptPath('manuscripts/main.md')).toBe(false)

  const denied = [
    'echo hi > manuscript/main.md',
    'cat notes.md >> manuscript/main.md',
    'cat << EOF > manuscript/main.md\nhello\nEOF',
    "sed -i '' 's/a/b/' manuscript/main.tex",
    'git checkout -- manuscript/main.tex',
    'cp a.md manuscript/',
    'cd manuscript && echo x > main.md',
    'echo x > Manuscript/main.md',
    'echo x > manus*/main.md',
    'npx prettier --write manuscript/main.md',
    'pandoc notes.md -o manuscript/main.md',
    'sort -o manuscript/main.md manuscript/main.md',
    'vim -c "wq" manuscript/main.md',
    'python3 -c "open(\'manuscript/main.md\',\'w\').write(\'x\')"',
  ]
  for (const command of denied) expect(bashTouchesManuscript(command), command).toBe(true)
  const allowed = [
    'cat manuscript/main.tex',
    'cat manuscript/main.md 2>/dev/null',
    'wc -w manuscript/*.md > /dev/null',
    'grep -n cite manuscript/*.tex | head -5',
    'git log --oneline -- manuscript',
    'python3 tools/style_profile.py literature/style-models manuscript',
    'echo hi > notes/ai/x.md',
    'echo "see manuscript/" > notes/ai/todo.md',
    'git commit -F msg.txt',
    // the folder's name inside a search pattern or a longer word is not a path
    'grep -rn "manuscript\\|chmod\\|read-only" plugin/skills docs 2>/dev/null | head -30',
    'sed -n 540,600p plugin/hooks/register.tsx; grep -rln "settings" plugin/skills; echo manuscripts',
  ]
  for (const command of allowed) expect(bashTouchesManuscript(command), command).toBe(false)
})

test('inside a paper, everything but Claude\'s own places is the author\'s', async () => {
  const root = '/w/projects/alpha'
  expect(authorFileOf(`${root}/literature/references.bib`, root)).toBe('literature/references.bib')
  expect(authorFileOf(`${root}/CLAUDE.md`, root)).toBe('CLAUDE.md')
  expect(authorFileOf(`${root}/.claude/settings.json`, root)).toBe('.claude/settings.json')
  expect(authorFileOf(`${root}/notes/own/ideas.md`, root)).toBe('notes/own/ideas.md')
  expect(authorFileOf(`${root}/notes/ai/../../party.md`, root)).toBe('party.md')
  expect(authorFileOf(`/W/Projects/Alpha/Manuscript/main.tex`, root)).toBe('Manuscript/main.tex') // macOS ignores case
  expect(authorFileOf(`${root}/*/x.md`, root)).toBe('*/x.md') // a glob is never one of Claude's places
  for (const ok of ['notes/ai/x.md', 'ai-log/2026-10.jsonl', 'disclosure/ai-register.en.md', 'scope.md', '.cowriting/game.json', 'build/main.pdf']) {
    expect(authorFileOf(`${root}/${ok}`, root), ok).toBeNull()
  }
  expect(authorFileOf('/w/projects/beta/CLAUDE.md', root)).toBeNull() // another paper is not this one's business
  expect(authorFileOf(root, root)).toBeNull()
  expect(absolutePath('/w', 'literature/x.bib')).toBe('/w/literature/x.bib')
  expect(absolutePath('/w', '/abs/x')).toBe('/abs/x')
  expect(absolutePath('/w', '$HOME/x')).toBe('$HOME/x')

  const isAuthors = (t: string) => authorFileOf(absolutePath('/w', t), '/w') !== null
  const names = ['manuscript', 'literature', 'CLAUDE.md', 'party.md', 'paper.json']
  const denied = [
    'echo x > literature/references.bib',
    'cat a >> CLAUDE.md',
    'cp notes/ai/x.md party.md',
    'cd literature && pandoc a.md -o b.md',
    "sed -i '' 's/a/b/' paper.json",
    'python3 x.py > /w/literature/out.bib',
    'cp literature/a.pdf /tmp/', // the pattern cannot tell a source from a target: read the file instead
  ]
  for (const command of denied) expect(bashWritesTo(command, isAuthors, names), command).toBe(true)
  const allowed = [
    'echo x > notes/ai/x.md',
    'pdftotext literature/a.pdf -',
    'python3 tools/verify_refs.py literature/references.bib',
    'git log -- literature',
    'echo x > scope.md',
    'latexmk -outdir=build manuscript/main.tex > /dev/null',
  ]
  for (const command of allowed) expect(bashWritesTo(command, isAuthors, names), command).toBe(false)
  // what the text cannot show is left to the comparison after the call
  expect(changedFiles({ 'manuscript/main.tex': '1:10' }, { 'manuscript/main.tex': '2:12' })).toEqual(['manuscript/main.tex'])
  expect(changedFiles({ 'manuscript/main.tex': '1:10' }, { 'manuscript/main.tex': '1:10', 'manuscript/new.tex': '3:1' })).toEqual(['manuscript/new.tex'])
  expect(changedFiles({ 'manuscript/main.tex': '1:10' }, { 'manuscript/main.tex': '1:10' })).toEqual([])
})

test('words are counted without LaTeX and Markdown syntax', async () => {
  expect(countWords('\\section{Intro}\nHello world \\cite{key}. % comment here', 'latex')).toBe(3)
  expect(countWords('---\ntitle: x\n---\n# Intro\n\nHello *world* [@key].', 'markdown')).toBe(3)
})

test('categories come from skills and summoned personas', async () => {
  expect(categoryFor('cowrite:language', 'intro')).toBe('language')
  expect(categoryFor('cowrite:annotate', '')).toBe('meta')
  expect(categoryFor(undefined, 'Use the cowrite:statistics-nerd agent to review x')).toBe('methods')
  expect(categoryFor('summon', 'style-coach manuscript/main.md')).toBe('style')
  expect(categoryFor(undefined, 'Use the cowrite:terminologist agent to review x')).toBe('terminology')
  expect(categoryFor(undefined, 'what is a p-value?')).toBe('general')
})

test('XP rewards own words and transparency, not AI turns', async () => {
  const first = advanceGame(NEW_GAME, 500, EMPTY_STATS, '2026-10-28')
  expect(first.ownWords).toBe(0) // the text that was there before is the baseline
  const later = advanceGame(first.game, 1700, EMPTY_STATS, '2026-10-29')
  expect(later.ownWords).toBe(1200)
  expect(later.writerXp).toBe(120)
  expect(later.unlocked.map(a => a.id)).toContain('first-1000')
  const shrunk = advanceGame(later.game, 900, EMPTY_STATS, '2026-10-30')
  expect(shrunk.ownWords).toBe(1200) // deleting and retyping earns nothing
  expect(shrunk.unlocked.length).toBe(0)

  const log = parseLog(
    [
      { type: 'prompt', id: 'a', ts: '2026-10-29T10:00:00Z', session: 's', paper: 'p', category: 'feedback', text: 'x' },
      { type: 'response', ref: 'a', ts: '2026-10-29T10:01:00Z', model: 'm', personas: ['reviewer-2'], tools_used: [], ai_text_flag: false, answer: 'y' },
    ]
      .map(e => JSON.stringify(e))
      .join('\n'),
  )
  const before = computeStats(log, new Date('2026-10-29T12:00:00Z'))
  expect(before.unannotated).toBe(1)
  expect(advanceGame(later.game, 1700, before, '2026-10-29').personaLevels['reviewer-2']).toBe(1)
  const after = computeStats(
    [...log, { type: 'annotation', ref: 'a', ts: '2026-10-29T11:00:00Z', use: 'adopted' }],
    new Date('2026-10-29T12:00:00Z'),
  )
  expect(after.unannotated).toBe(0)
  expect(after.personaAdopted['reviewer-2']).toBe(1)
  expect(advanceGame(later.game, 1700, after, '2026-10-29').personaLevels['reviewer-2']).toBe(2)
  expect(ACHIEVEMENTS.length).toBeGreaterThan(5)

  // no achievement rewards consulting the AI; deciding against it is rewarded
  expect(ACHIEVEMENTS.map(a => a.id)).not.toContain('full-party')
  const independent = advanceGame(later.game, 1700, { ...after, rejected: 5 }, '2026-10-29')
  expect(independent.unlocked.map(a => a.id)).toContain('own-voice')
})

// ------------------------------------------------------------- the hooks

test('the plugin refuses edits to the manuscript and allows notes', async ($, on) => {
  const files = paperFiles()
  workspace(on, files)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const edit = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/manuscript/main.tex`, old_string: 'a', new_string: 'b' })
  expect(edit.deny).toContain('CoWriting')
  const write = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes/ai/x.md`, content: 'note' })
  expect(write.deny).toBeUndefined()
  const bash = await $.tool.call({ tool: 'Bash', command: 'echo x >> manuscript/main.tex' })
  expect(bash.deny).toContain('CoWriting')
  const read = await $.tool.call({ tool: 'Bash', command: 'cat manuscript/main.tex' })
  expect(read.deny).toBeUndefined()

  // the rest of the paper is the author's too; Claude's places stay open
  const bib = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/literature/references.bib`, content: '@article{x}' })
  expect(bib.deny).toContain('literature/references.bib belongs to the author')
  const rules = await $.tool.call({ tool: 'Edit', file_path: 'CLAUDE.md', old_string: 'a', new_string: 'b' })
  expect(rules.deny).toContain('CLAUDE.md belongs to the author')
  const scope = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/scope.md`, content: '# plan' })
  expect(scope.deny).toBeUndefined()
  const shell = await $.tool.call({ tool: 'Bash', command: 'cp notes/ai/x.md paper.json' })
  expect(shell.deny).toContain('belongs to the author')
  const note = await $.tool.call({ tool: 'Bash', command: 'echo x > notes/ai/x.md' })
  expect(note.deny).toBeUndefined()
  const elsewhere = await $.tool.call({ tool: 'Write', file_path: '/elsewhere/CLAUDE.md', content: 'x' })
  expect(elsewhere.deny).toBeUndefined()
})

test('a manuscript change during a tool call is logged as a guard event and shown', async ($, on) => {
  const files = paperFiles()
  const main = `${ROOT}/manuscript/main.tex`
  const mtimes = new Map<string, number>([[main, 1]])
  workspace(on, files)
  on('fs.stat', (_: unknown, e: { path: string }) => ({
    value: { kind: 'file', size: files.get(e.path)?.length ?? 0, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false },
  }))
  on('tool.call', (_: unknown, e: { tool: string; command?: string }) => {
    if (e.tool === 'Bash' && e.command === 'python3 fix.py') {
      files.set(main, '\\section{Intro}\nRewritten by a script the patterns could not see.')
      mtimes.set(main, 2)
      mtimes.set(`${ROOT}/paper.json`, 2) // the author's other files are compared too
      files.set(`${ROOT}/notes/ai/profile.md`, 'Claude may write here; this is not reported')
    }
    return { result: {} }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const sneaky = await $.tool.call({ tool: 'Bash', command: 'python3 fix.py' })
  expect(sneaky.deny).toBeUndefined() // nothing in the text gave it away
  const logOf = () => {
    const logFile = [...files.keys()].find(k => k.startsWith(`${ROOT}/ai-log/`))
    return logFile === undefined ? [] : parseLog(files.get(logFile)!)
  }
  for (let i = 0; i < 50 && !logOf().some(e => e.type === 'guard'); i++) await new Promise(r => setTimeout(r, 1))
  const guard = logOf().find(e => e.type === 'guard')
  expect(guard?.type === 'guard' && guard.files).toEqual(['manuscript/main.tex', 'paper.json'])
  expect(guard?.type === 'guard' && guard.input).toBe('python3 fix.py')

  const stats = computeStats(logOf(), new Date())
  expect(stats.guardEvents).toBe(1)
  expect(overrelianceNudge(stats)).toContain('1 change to your files')

  // a reading tool is not compared, so the author's own edit meanwhile is not blamed on it
  files.set(main, `${files.get(main)}\nThe author typed this.`)
  mtimes.set(main, 3)
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/notes/ai/x.md` })
  await new Promise(r => setTimeout(r, 5))
  expect(logOf().filter(e => e.type === 'guard').length).toBe(1)
})

test('log writes of one paper run one after another, in order', async () => {
  // the log is read and rewritten on each append, so two writes in flight would lose one
  const order: string[] = []
  const write = (name: string, ms: number) =>
    withLog('/w', async () => {
      await new Promise(r => setTimeout(r, ms))
      order.push(name)
    })
  await Promise.all([write('one', 10), write('two', 1), write('three', 0)])
  expect(order).toEqual(['one', 'two', 'three'])
  // a failed write does not block the next
  await withLog('/w', async () => Promise.reject(new Error('disk'))).catch(() => undefined)
  expect(await withLog('/w', async () => 'next')).toBe('next')
})

test('a turn is logged as linked prompt and response, with the AI-text flag', async ($, on) => {
  const files = paperFiles()
  workspace(on, files)
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'Please just write my abstract.', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: '[AI-TEXT] An abstract.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  const logFile = [...files.keys()].find(k => k.startsWith(`${ROOT}/ai-log/`))
  expect(logFile).toBeDefined()
  const entries = parseLog(files.get(logFile!)!)
  expect(entries.length).toBe(2)
  const [prompt, response] = entries
  expect(prompt?.type).toBe('prompt')
  expect(response?.type === 'response' && prompt?.type === 'prompt' && response.ref === prompt.id).toBe(true)
  expect(response?.type === 'response' && response.ai_text_flag).toBe(true)
})

test('a summoned persona is counted once, and its hand-back is logged as its turn', async ($, on) => {
  const files = paperFiles()
  workspace(on, files)
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'agent-7' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  // the author asks; Claude launches the Terminologist in the background
  await $.prompt.submit({ text: 'manuscript is updated, guys', wait: false, origin: { kind: 'composer' } })
  await $.agent.spawn({
    tool_use_id: 'tu-1',
    prompt: 'review',
    description: 'terms',
    subagentType: 'cowrite:terminologist',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  await $.turn.complete({ answer: 'The Terminologist is on it.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  // later its report comes back as a task notification
  const report = '<agent-message from="agent-7">\n[Subagent hand-back] … "subjects" → "participants" …\n</agent-message>'
  await $.prompt.submit({ text: report, wait: false, origin: { kind: 'task-notification' } as never })
  await $.turn.complete({ answer: 'Here is what it found.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })

  const logFile = [...files.keys()].find(k => k.startsWith(`${ROOT}/ai-log/`))!
  const entries = parseLog(files.get(logFile)!)
  const handBack = entries.find(e => e.type === 'prompt' && e.origin === 'agent')
  expect(handBack?.type === 'prompt' && handBack.agent).toBe('terminologist')
  expect(handBack?.type === 'prompt' && handBack.category).toBe('terminology')

  const stats = computeStats(entries, new Date())
  expect(stats.personaConsults['terminologist']).toBe(1)
  expect(stats.recent[0]?.preview).toBe('↩ report from The Terminologist')

  // annotating the report levels the persona up
  const annotated = computeStats(
    [...entries, { type: 'annotation', ref: handBack?.type === 'prompt' ? handBack.id : '', ts: new Date().toISOString(), use: 'adopted' }],
    new Date(),
  )
  expect(annotated.personaAdopted['terminologist']).toBe(1)
  expect(annotated.personaConsults['terminologist']).toBe(1)
})

test('live review sees only changed paragraphs and keeps at most three hints', async () => {
  const before = 'Intro paragraph that stays the same here.\n\nSecond one, also unchanged text.'
  const after = 'Intro paragraph that stays the same here.\n\nSecond one, now with subjects and more words.\n\n\\label{x}'
  const changed = changedParagraphs(before, after, 'latex')
  expect(changed.length).toBe(1)
  expect(changed[0]?.start).toBe(3)
  expect(watchExcerpt([{ file: 'manuscript/main.tex', changed }])).toContain('3| Second one, now with subjects')

  const answer = 'Sure:\n[{"persona":"terminologist","line":3,"hint":"subjects → participants (APA 7)"},' +
    '{"persona":"reviewer-2","line":3,"hint":"not watching"},{"persona":"grammar-guy","line":3,"hint":"ok"},' +
    '{"persona":"style-coach","line":3,"hint":"a"},{"persona":"architect","line":3,"hint":"b"}]'
  const hints = parseHints(answer, ['terminologist', 'grammar-guy', 'style-coach', 'architect'])
  expect(hints.length).toBe(3)
  expect(hints.map(hint => hint.persona)).not.toContain('reviewer-2')
  expect(parseHints('no JSON here', ['terminologist']).length).toBe(0)
})

test('/cowrite:watch reviews after a writing pause, logs it, and shows the hints', async ($, on) => {
  const files = paperFiles()
  const mtimes = new Map<string, number>([[`${ROOT}/manuscript/main.tex`, 1]])
  workspace(on, files)
  on('fs.stat', (_: unknown, e: { path: string }) => ({
    value: { kind: 'file', size: files.get(e.path)?.length ?? 0, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false },
  }))
  let asked = ''
  on('model.complete', (_: unknown, e: { prompt: string }) => {
    asked = e.prompt
    return {
      value: { isAnswered: true as const, text: '[{"persona":"terminologist","line":3,"hint":"subjects → participants"}]', usage: {} as never },
    }
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never

  const started = await $.command.run({ command: 'cowrite:watch', args: 'on', origin: { kind: 'composer' }, presentation })
  expect(started.text).toContain('Terminologist')
  await clock.advance(5_000) // first look: the baseline

  files.set(`${ROOT}/manuscript/main.tex`, `${files.get(`${ROOT}/manuscript/main.tex`)}\n\nThe subjects were asked twice about sleep.`)
  mtimes.set(`${ROOT}/manuscript/main.tex`, 2)
  await clock.advance(5_000) // the change is seen; the author may still be typing
  expect(asked).toBe('')
  await clock.advance(25_000) // a pause: now the review runs
  expect(asked).toContain('The subjects were asked twice')
  expect(asked).not.toContain('Das ist mein eigener Text') // unchanged text is not sent

  const logFile = [...files.keys()].find(k => k.startsWith(`${ROOT}/ai-log/`))!
  const entries = parseLog(files.get(logFile)!)
  expect(entries.some(e => e.type === 'prompt' && e.origin === 'watch')).toBe(true)
  expect(computeStats(entries, new Date()).unannotated).toBe(0) // live hints don't nag

  const ui = await $.ui.mount({
    plugin: 'cowrite',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false } as never,
  })
  expect(await ui.find({ type: 'Text', text: /subjects → participants/ })).toBeDefined()
  await ui.unmount()

  const stopped = await $.command.run({ command: 'cowrite:watch', args: 'off', origin: { kind: 'composer' }, presentation })
  expect(stopped.text).toContain('stopped')
})

test('summoning from the pane counts the persona on its card', async ($, on) => {
  const files = paperFiles()
  workspace(on, files)
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'agent-3' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const pane = {
    plugin: 'cowrite',
    component: 'Pane',
    requestId: 'cowriting',
    surface: 'terminal',
    props: { title: 'CoWriting', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const

  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'summon-architect' }) // the plugin submits the prompt itself
  await ui.unmount()
  await $.agent.spawn({
    tool_use_id: 'tu-3',
    prompt: 'review',
    description: 'structure',
    subagentType: 'cowrite:architect',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  await $.turn.complete({ answer: 'The Architect is on it.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  const report = '<agent-message from="agent-3">\n[Subagent hand-back] the red thread breaks at l. 12\n</agent-message>'
  await $.prompt.submit({ text: report, wait: false, origin: { kind: 'task-notification' } as never })
  await $.turn.complete({ answer: 'It says…', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })

  const logFile = [...files.keys()].find(k => k.startsWith(`${ROOT}/ai-log/`))!
  const entries = parseLog(files.get(logFile)!)
  const stats = computeStats(entries, new Date())
  expect(stats.personaConsults['architect']).toBe(1)
  expect(entries.some(e => e.type === 'prompt' && e.origin === 'agent' && e.agent === 'architect')).toBe(true)

  const again = await $.ui.mount(pane)
  expect(await again.find({ type: 'Text', text: /1×/ })).toBeDefined()
  await again.unmount()
})

test('the usage meter shows tokens and limits, and warns once a window crosses 80 %', async () => {
  const usage = toUsage({
    context: { tokens: 84_000, percent: 42 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 81, resetsAt: '2026-10-29T14:00:00Z' }],
    cost: { usd: 1.2 },
  })
  const parts = usageParts(usage, 'tokens+limits', 3200)
  expect(parts[0]).toBe('context 84k (42%)')
  expect(parts[1]).toBe('live review 3k')
  expect(parts[2]).toContain('5h limit 81%')
  expect(parts.join(' ')).not.toContain('$') // on a subscription the limits matter, not the cost
  expect(usageParts(usage, 'tokens', 0).join(' ')).not.toContain('limit')
  expect(usageParts(usage, 'off', 0).length).toBe(0)
  expect(limitCrossed([{ kind: 'five_hour', percentUsed: 79 }], usage.limits)).toContain('5h usage limit at 81%')
  expect(limitCrossed(usage.limits, usage.limits)).toBeUndefined()
})

test('calm shows Claude Code steps as one line, focus hides them, /cowrite:quiet switches', async ($, on) => {
  workspace(on, paperFiles())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const bash = {
    plugin: 'cowrite',
    component: 'ToolUse',
    surface: 'terminal',
    props: {
      tool_use_id: 'tu-b',
      tool: 'Read',
      input: { file_path: `${ROOT}/literature/references.bib` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as never,
  } as const
  const calm = await $.ui.mount(bash)
  expect(await calm.find({ type: 'Text', text: /· Read references\.bib/ })).toBeDefined()
  await calm.unmount()

  const presentation = { isFullscreen: false, columns: 100 } as never
  const switched = await $.command.run({ command: 'cowrite:quiet', args: 'focus', origin: { kind: 'composer' }, presentation })
  expect(switched.text).toContain('Focus: focus')
  const focus = await $.ui.mount(bash)
  expect(await focus.find({ type: 'Text', text: /Read references/ })).toBeUndefined()
  await focus.unmount()
})

test('the Log tab says who said what, before you classify it', async ($, on) => {
  const files = paperFiles()
  const log = [
    { type: 'prompt', id: 'p1', ts: '2026-10-29T08:00:00Z', session: 's', paper: 'demo', category: 'structure', command: 'summon', text: 'Use the cowrite:architect agent to review x.' },
    { type: 'response', ref: 'p1', ts: '2026-10-29T08:00:05Z', model: 'm', personas: ['architect'], agents: { a1: 'architect' }, tools_used: [], ai_text_flag: false, answer: 'The Architect is on it.' },
    { type: 'prompt', id: 'p2', ts: '2026-10-29T08:02:00Z', session: 's', paper: 'demo', category: 'structure', origin: 'agent', agent: 'architect', text: '<agent-message from="a1">…</agent-message>' },
    { type: 'response', ref: 'p2', ts: '2026-10-29T08:02:09Z', model: 'm', personas: ['architect'], tools_used: [], ai_text_flag: false, answer: '**Top issue:** the red thread breaks at l. 12 — why does the method come before the gap?' },
  ]
  files.set(`${ROOT}/ai-log/2026-10.jsonl`, log.map(e => JSON.stringify(e)).join('\n'))
  workspace(on, files)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const stats = computeStats(parseLog(files.get(`${ROOT}/ai-log/2026-10.jsonl`)!), new Date())
  expect(stats.unannotated).toBe(1) // the launch turn has nothing to classify; the report does
  expect(stats.open[0]?.persona).toBe('architect')

  const ui = await $.ui.mount({
    plugin: 'cowrite',
    component: 'Pane',
    requestId: 'cowriting',
    surface: 'terminal',
    props: { title: 'CoWriting', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Text', text: /it said: Top issue: the red thread breaks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ used = as suggested/ })).toBeDefined()
  await ui.unmount()
})

test('party.md briefs are read by section, and setting one keeps the rest', async () => {
  const template = [
    '# Briefing',
    '<!-- intro -->',
    '## everyone — the whole party',
    '<!-- field, journal -->',
    'Sleep medicine, for Journal of Sleep Research.',
    '',
    '## grammar-guy — Grammar Guy',
    '<!-- spelling -->',
    '',
    '## terminologist — The Terminologist',
    '<!-- nomenclature -->',
    'ICD-11 terms only.',
  ].join('\n')
  const briefs = parseBriefs(template)
  expect(briefs.everyone).toBe('Sleep medicine, for Journal of Sleep Research.')
  expect(briefs['grammar-guy']).toBeUndefined() // only a comment: no brief
  expect(briefs.terminologist).toBe('ICD-11 terms only.')
  expect(briefFor(briefs, 'terminologist')).toContain('About the project:\nSleep medicine')

  const updated = setBrief(template, 'grammar-guy', 'British spelling, Oxford comma.')
  const again = parseBriefs(updated)
  expect(again['grammar-guy']).toBe('British spelling, Oxford comma.')
  expect(again.terminologist).toBe('ICD-11 terms only.')
  expect(updated).toContain('<!-- spelling -->') // the guiding comment stays
  expect(parseBriefs(setBrief(updated, 'style-coach', 'First person plural.'))['style-coach']).toBe('First person plural.')
})

test('a persona gets its brief with its task, and /cowrite:brief sets one', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/party.md`, '## everyone\nThesis in sleep medicine.\n\n## architect — The Architect\nIMRaD, 8000 words.\n')
  workspace(on, files)
  let task = ''
  on('agent.spawn', (_: unknown, e: { prompt: string }) => {
    task = e.prompt
    return { model: 'm', agentId: 'agent-5' }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'tu-5',
    prompt: 'Review the structure.',
    description: 'structure',
    subagentType: 'cowrite:architect',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  expect(task).toContain("The author's briefing for you in this project")
  expect(task).toContain('IMRaD, 8000 words.')
  expect(task).toContain('Thesis in sleep medicine.')

  const presentation = { isFullscreen: false, columns: 100 } as never
  const saved = await $.command.run({ command: 'cowrite:brief', args: 'terminologist ICD-11 terms only', origin: { kind: 'composer' }, presentation })
  expect(saved.text).toContain('saved')
  expect(parseBriefs(files.get(`${ROOT}/party.md`)!).terminologist).toBe('ICD-11 terms only')
  const listed = await $.command.run({ command: 'cowrite:brief', args: '', origin: { kind: 'composer' }, presentation })
  expect(listed.text).toContain('📋 terminologist: ICD-11 terms only')
})

test('a persona at work is one progress row, and its report one line', async ($, on) => {
  workspace(on, paperFiles())
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'agent-9' }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'check my terms', wait: false, origin: { kind: 'composer' } })
  await $.agent.spawn({
    tool_use_id: 'tu-9',
    prompt: 'review',
    description: 'terms',
    subagentType: 'cowrite:terminologist',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/manuscript/main.tex`, agentId: 'agent-9' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'subjects', agentId: 'agent-9' } as never)

  const row = await $.ui.mount({
    plugin: 'cowrite',
    component: 'ToolUse',
    surface: 'terminal',
    props: {
      tool_use_id: 'tu-9',
      tool: 'Agent',
      input: { subagent_type: 'cowrite:terminologist' },
      isRunning: true,
      isErrored: false,
      isInterrupted: false,
    } as never,
  })
  expect(await row.find({ type: 'Text', text: /2 steps · Grep subjects/ })).toBeDefined()
  await row.unmount()

  const report = await $.ui.mount({
    plugin: 'cowrite',
    component: 'UserMessage',
    surface: 'terminal',
    props: { text: 'a long report', origin: { kind: 'task-notification' }, isExpanded: false, task: { toolUseId: 'tu-9' } } as never,
  })
  expect(await report.find({ type: 'Text', text: /The Terminologist reported back/ })).toBeDefined()
  await report.unmount()
})

test('an expert of the author\'s own is read from party/<id>.md', async () => {
  expect(isCustomId('neurologist')).toBe(true)
  expect(isCustomId('reviewer-2')).toBe(false) // the catalogue's
  expect(isCustomId('Neuro Logist')).toBe(false)
  const file = [
    '---',
    'name: The Neurologist',
    'role: Clinical neurology: diagnostics, patient relevance',
    'colour: "#123abc"',
    '---',
    'You are **The Neurologist**. You ask whether the findings matter in the clinic.',
    'Voice: brisk. "Which patient does this help?"',
  ].join('\n')
  const expert = parsePersonaFile('neurologist', file)!
  expect(expert.persona).toMatchObject({ id: 'neurologist', name: 'The Neurologist', short: 'Neurologist', category: 'content', source: 'custom' })
  expect(expert.persona.palette.C).toBe('#123abc')
  expect(expert.persona.sprite.length).toBe(12)
  expect(expert.prompt.startsWith('You are **The Neurologist**.')).toBe(true)
  expect(expert.prompt).toContain('## Ground rules')
  expect(expert.prompt).toContain('## Output format')
  expect(parsePersonaFile('neurologist', 'no frontmatter')).toBeNull()
  expect(parsePersonaFile('neurologist', '---\nname: X\n---\n')).toBeNull() // no role, no body
  expect(parsePersonaFile('reviewer-2', file)).toBeNull()
  // the skeleton /cowrite:party new writes is itself a persona, so the agent exists while the author fills it in
  const skeleton = parsePersonaFile('ontologist', personaFileSkeleton('ontologist', 'The Ontologist', 'Ontologies, OWL, reasoning'))!
  expect(skeleton.persona.name).toBe('The Ontologist')
  expect(skeleton.persona.role).toBe('Ontologies, OWL, reasoning')
  expect(partyPersonas(['architect', 'nobody', 'grammar-guy']).map(p => p.id)).toEqual(['architect', 'grammar-guy'])
  expect(DEFAULT_PARTY).not.toContain('clinician')
  expect(DEFAULT_PARTY.length).toBe(PERSONAS.length - 1)
})

test('the party is the roster in paper.json plus the experts in party/, and /cowrite:party changes it', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/paper.json`, JSON.stringify({ name: 'demo', format: 'latex', language: 'en', party: ['reviewer-2', 'architect'] }))
  files.set(
    `${ROOT}/party/neurologist.md`,
    '---\nname: The Neurologist\nrole: Clinical neurology\n---\nYou are **The Neurologist**.\nVoice: brisk.\n',
  )
  files.set(`${ROOT}/party/notes.md`, 'not a persona\n')
  files.set(`${ROOT}/party.md`, '## everyone\nStroke unit thesis.\n\n## neurologist — The Neurologist\nNIHSS and mRS conventions.\n')
  workspace(on, files)
  on('agent.offer', () => ({ isOffered: true }))
  on('command.run', (_: unknown, e: { command: string; args: string }) => ({ text: `skill ${e.command} ${e.args}` }))
  let task = ''
  on('agent.spawn', (_: unknown, e: { prompt: string }) => {
    task = e.prompt
    return { model: 'm', agentId: 'agent-11' }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  // the expert became an agent, once, with its file as the prompt and read-only tools
  expect(registered.map(r => r.name)).toEqual(['neurologist'])
  expect(registered[0]!.prompt).toContain('You are **The Neurologist**.')
  expect(registered[0]!.prompt).toContain('## Ground rules')
  expect(registered[0]!.tools).not.toContain('Write')

  // the model is offered the members only
  const offer = (agent: string) =>
    $.agent.offer({ agent, description: '', source: 'plugin', provider: { plugin: 'cowrite', tier: 'user' } as never })
  expect((await offer('cowrite:reviewer-2')).isOffered).toBe(true)
  expect((await offer('cowrite:neurologist')).isOffered).toBe(true)
  expect((await offer('cowrite:grammar-guy')).isOffered).toBe(false)
  expect((await offer('Explore')).isOffered).toBe(true)

  const presentation = { isFullscreen: false, columns: 100 } as never
  const listed = await $.command.run({ command: 'cowrite:party', args: '', origin: { kind: 'composer' }, presentation })
  expect(listed.text).toContain('Your review party (3)')
  expect(listed.text).toContain('★ neurologist · The Neurologist: Clinical neurology')
  expect(listed.text).toContain('✓ reviewer-2')
  expect(listed.text).toContain('Not in the party:')
  expect(listed.text).toContain('· grammar-guy')
  expect(listed.text).toContain('Not a persona (missing name, role or text): party/notes.md')

  const ui = await $.ui.mount({
    plugin: 'cowrite',
    component: 'Pane',
    requestId: 'cowriting',
    surface: 'terminal',
    props: { title: 'CoWriting', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /Neurologist/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Reviewer #2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Grammar Guy/ })).toBeUndefined()
  await ui.unmount()

  // the expert is briefed like any other member
  await $.agent.spawn({
    tool_use_id: 'tu-11',
    prompt: 'Review the discussion.',
    description: 'neurology',
    subagentType: 'cowrite:neurologist',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  expect(task).toContain('NIHSS and mRS conventions.')
  expect(task).toContain('Stroke unit thesis.')

  const added = await $.command.run({ command: 'cowrite:party', args: 'add grammar-guy clinician', origin: { kind: 'composer' }, presentation })
  expect(added.text).toBe('Grammar Guy, The Clinician joined the party.')
  expect(JSON.parse(files.get(`${ROOT}/paper.json`)!).party).toEqual(['reviewer-2', 'architect', 'grammar-guy', 'clinician'])
  expect(JSON.parse(files.get(`${ROOT}/paper.json`)!).name).toBe('demo')
  expect((await offer('cowrite:grammar-guy')).isOffered).toBe(true)
  const removed = await $.command.run({ command: 'cowrite:party', args: 'remove clinician', origin: { kind: 'composer' }, presentation })
  expect(removed.text).toBe('The Clinician left the party.')
  expect(JSON.parse(files.get(`${ROOT}/paper.json`)!).party).toEqual(['reviewer-2', 'architect', 'grammar-guy'])
  const unknown = await $.command.run({ command: 'cowrite:party', args: 'add doctor', origin: { kind: 'composer' }, presentation })
  expect(unknown.text).toContain('Not in the catalogue: doctor')
  const retire = await $.command.run({ command: 'cowrite:party', args: 'remove neurologist', origin: { kind: 'composer' }, presentation })
  expect(retire.text).toContain('delete party/<id>.md')

  // a new expert: the skeleton is written, then the skill interviews the author
  const made = await $.command.run({ command: 'cowrite:party', args: 'new ontologist "The Ontologist" ontologies, OWL, reasoning', origin: { kind: 'composer' }, presentation })
  expect(made.text).toBe('skill cowrite:party new ontologist "The Ontologist" ontologies, OWL, reasoning')
  const skeleton = files.get(`${ROOT}/party/ontologist.md`)!
  expect(skeleton).toContain('name: The Ontologist')
  expect(skeleton).toContain('role: ontologies, OWL, reasoning')
  const taken = await $.command.run({ command: 'cowrite:party', args: 'new reviewer-2', origin: { kind: 'composer' }, presentation })
  expect(taken.text).toContain('not a free id')
  // the skeleton counts from now on
  const again = await $.command.run({ command: 'cowrite:party', args: '', origin: { kind: 'composer' }, presentation })
  expect(again.text).toContain('★ ontologist · The Ontologist')
  expect(registered.map(r => r.name)).toEqual(['neurologist', 'ontologist'])
})

test('typed commands that need the model hand on to their skill, checked', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/party/neurologist.md`, '---\nname: The Neurologist\nrole: Clinical neurology\n---\nYou are **The Neurologist**.\n')
  workspace(on, files)
  on('command.run', (_: unknown, e: { command: string; args: string }) => ({ text: `skill ${e.command} ${e.args}` }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const run = (command: string, args: string) => $.command.run({ command, args, origin: { kind: 'composer' }, presentation })

  expect((await run('cowrite:summon', 'cowrite:neurologist discussion')).text).toBe('skill cowrite:summon cowrite:neurologist discussion')
  expect((await run('cowrite:summon', 'architect')).text).toBe('skill cowrite:summon architect')
  expect((await run('cowrite:summon', 'doctor')).text).toContain('Unknown persona "doctor"')
  expect((await run('cowrite:summon', '')).text).toContain('Your party: grammar-guy')
  expect((await run('cowrite:ask', 'terminologist is "sleep architecture" usual?')).text).toBe('skill cowrite:ask terminologist is "sleep architecture" usual?')
  expect((await run('cowrite:ask', 'terminologist')).text).toContain('Usage')
  expect((await run('cowrite:brief', 'architect')).text).toBe('skill cowrite:brief architect')
  expect((await run('cowrite:brief', 'all')).text).toBe('skill cowrite:brief all')
  expect((await run('cowrite:brief', 'neurologist')).text).toBe('skill cowrite:brief neurologist')
  expect((await run('cowrite:scope', 'edit')).text).toBe('skill cowrite:scope edit')
  expect((await run('cowrite:scope', 'fly')).text).toContain('Usage')
})

test('a paper.json from before rosters keeps its party: the pack\'s clinician included', async ($, on) => {
  workspace(on, paperFiles()) // domainPack: medicine
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const listed = await $.command.run({ command: 'cowrite:party', args: '', origin: { kind: 'composer' }, presentation })
  expect(listed.text).toContain(`Your review party (${PERSONAS.length})`)
  expect(listed.text).toContain('✓ clinician')
  expect(listed.text).not.toContain('Not in the party:')
})

test('/cowrite:paper upgrade lists what an older workspace lacks; `apply` makes the scaffold tool add it', async ($, on) => {
  workspace(on, paperFiles())
  const runs: (readonly string[])[] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    runs.push(e.argv)
    const isApply = e.argv.includes('--apply')
    const stdout = `Paper workspace: ${ROOT}\n  ~ paper.json: party roster to add\n${isApply ? 'Upgraded.' : 'Nothing changed yet.'}\n`
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never

  const dry = await $.command.run({ command: 'cowrite:paper', args: 'upgrade', origin: { kind: 'composer' }, presentation })
  expect(dry.text).toContain('party roster to add')
  expect(dry.text).toContain('Apply with /cowrite:paper upgrade apply')
  const argv = runs.at(-1)!
  expect(argv[0]).toBe('python3')
  expect(argv[2]).toMatch(/tools\/new_paper\.py$/)
  expect(argv).toContain('--upgrade')
  expect(argv).not.toContain('--apply')
  expect(argv.slice(-2)).toEqual(['--dir', ROOT])

  const applied = await $.command.run({ command: 'cowrite:paper', args: 'upgrade apply', origin: { kind: 'composer' }, presentation })
  expect(applied.text).toContain('Upgraded.')
  expect(applied.text).not.toContain('Apply with')
  expect(runs.at(-1)).toContain('--apply')
})

test('a Word manuscript is read through pandoc: the Read tool and the word count see text', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/manuscript/kapitel.docx`, 'PK\u0003\u0004 not text')
  workspace(on, files)
  on('tool.call', () => ({ result: {} }))
  const runs: (readonly string[])[] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    runs.push(e.argv)
    const stdout = e.argv[0] === 'pandoc' ? '# Kapitel 1\n\nDas ist mein Text aus Word.\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const pandocRuns = () => runs.filter(r => r[0] === 'pandoc').length
  const base = pandocRuns() // the pane's word count at session start already converted it
  const whole = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/manuscript/kapitel.docx` })
  expect(whole.deny).toBeUndefined()
  const file = (whole.result as { file: { content: string; startLine: number; numLines: number; totalLines: number } }).file
  expect(file.content).toContain('Das ist mein Text aus Word.')
  expect(file.startLine).toBe(1)
  expect(file.totalLines).toBe(4)
  expect(runs.find(r => r[0] === 'pandoc')).toEqual(['pandoc', `${ROOT}/manuscript/kapitel.docx`, '--to', 'markdown', '--wrap=none'])

  const part = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/manuscript/kapitel.docx`, offset: 3, limit: 1 })
  const slice = (part.result as { file: { content: string; startLine: number; numLines: number } }).file
  expect(slice.content).toBe('Das ist mein Text aus Word.')
  expect(slice.startLine).toBe(3)
  expect(slice.numLines).toBe(1)

  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/manuscript/main.tex` })
  expect(pandocRuns()).toBe(base + 2) // a text file is read as it is

  expect(base).toBeGreaterThanOrEqual(1) // the word count behind the pane read the Word file through pandoc too
})

test('the pane shows the review party on every surface', async ($, on) => {
  workspace(on, paperFiles())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cowrite',
      component: 'Pane',
      requestId: 'cowriting',
      surface,
      props: {
        title: 'CoWriting',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /Grammar Guy/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Clinician/ })).toBeDefined()
    await ui.press({ key: 'tab-progress' })
    expect(await ui.find({ type: 'Text', text: /Level/ })).toBeDefined()
    await ui.press({ key: 'tab-log' })
    expect(await ui.find({ type: 'Text', text: /AI turns/ })).toBeDefined()
    await ui.press({ key: 'tab-party' })
    expect(await ui.find({ type: 'Text', text: /Grammar Guy/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/cowrite:pane <tab> opens the pane on that tab', async ($, on) => {
  workspace(on, paperFiles())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const opened = await $.command.run({ command: 'cowrite:pane', args: 'log', origin: { kind: 'composer' }, presentation })
  expect(opened.text).toContain('· log')
  const ui = await $.ui.mount({
    plugin: 'cowrite',
    component: 'Pane',
    requestId: 'cowriting',
    surface: 'terminal',
    props: { title: 'CoWriting', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /AI turns/ })).toBeDefined()
  await ui.unmount()
  const wrong = await $.command.run({ command: 'cowrite:pane', args: 'nonsense', origin: { kind: 'composer' }, presentation })
  expect(wrong.text).toContain('Usage')
})

test('/cowrite:paper opens a paper by path from any folder and remembers it', async ($, on) => {
  const elsewhere = '/home/u/papers/test'
  const files = new Map<string, string>([
    [`${elsewhere}/paper.json`, JSON.stringify({ name: 'test', format: 'markdown', language: 'en' })],
    [`${elsewhere}/paper.md`, '# My draft'],
    ['/home/u/plain/notes.md', 'no paper here'],
  ])
  workspace(on, files)
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const isDir = [...files.keys()].some(k => k.startsWith(`${e.path}/`))
    if (!isDir && !files.has(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: isDir ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('env.get', () => ({ value: '/home/u' }))
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  let task = ''
  on('agent.spawn', (_: unknown, e: { prompt: string }) => {
    task = e.prompt
    return { model: 'm', agentId: 'agent-7' }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const run = (args: string) => $.command.run({ command: 'cowrite:paper', args, origin: { kind: 'composer' }, presentation })

  expect((await run('')).text).toContain('No active paper.')
  expect((await run('~/plain')).text).toContain('is not a CoWriting paper yet')
  expect((await run('~/nowhere')).text).toContain('No folder /home/u/nowhere')
  // a file inside the paper folder works too
  expect((await run('~/papers/test/paper.md')).text).toBe(`Active paper: test · ${elsewhere}`)
  expect((await run('')).text).toContain(`1  ${elsewhere}`)

  await $.agent.spawn({
    tool_use_id: 'tu-7',
    prompt: 'Review the structure.',
    description: 'structure',
    subagentType: 'cowrite:architect',
    provider: { plugin: 'cowrite', tier: 'user' } as never,
    parentModel: 'm',
    background: true,
    fork: false,
  })
  expect(task).toContain('## Where the paper is')
  expect(task).toContain(`cd "${elsewhere}"`)
})

test('/cowrite:overleaf runs the tool without a prompt; imported text reaches neither the live review nor the game', async ($, on) => {
  const files = paperFiles()
  const main = `${ROOT}/manuscript/main.tex`
  const mtimes = new Map<string, number>([[main, 1]])
  workspace(on, files)
  on('fs.stat', (_: unknown, e: { path: string }) => ({
    value: { kind: 'file', size: files.get(e.path)?.length ?? 0, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false },
  }))
  let asked = ''
  on('model.complete', (_: unknown, e: { prompt: string }) => {
    asked = e.prompt
    return { value: { isAnswered: true as const, text: '[]', usage: {} as never } }
  })
  const runs: { argv: readonly string[]; init?: { env?: Record<string, string> } }[] = []
  let reply = { exitCode: 0, stdout: 'Imported from Overleaf: 0 added, 1 changed, 0 removed.\n', stderr: '' }
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { env?: Record<string, string> } }) => {
    if (e.argv[0] !== 'python3') return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
    runs.push(e)
    if (reply.exitCode === 0) {
      files.set(main, `${files.get(main)}\n\nA co-author wrote these eight words in Overleaf today.`)
      mtimes.set(main, (mtimes.get(main) ?? 0) + 1)
    }
    return { value: reply as never }
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const overleaf = (args: string) => $.command.run({ command: 'cowrite:overleaf', args, origin: { kind: 'composer' }, presentation })

  await $.command.run({ command: 'cowrite:watch', args: 'on', origin: { kind: 'composer' }, presentation })
  await clock.advance(5_000) // the watcher has its baseline
  const words = countWords(files.get(main)!, 'latex')
  files.set(`${ROOT}/.cowriting/game.json`, JSON.stringify({ ...NEW_GAME, baselineWords: words - 100, maxWords: words }))

  const imported = await overleaf('pull')
  expect(imported.text).toContain('Imported from Overleaf')
  expect(runs.at(-1)!.argv.slice(3)).toEqual(['pull', '--dir', ROOT])
  expect(runs.at(-1)!.argv[2]).toMatch(/tools\/overleaf\.py$/)
  expect(runs.at(-1)!.init?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })

  const game = JSON.parse(files.get(`${ROOT}/.cowriting/game.json`)!)
  expect(game.maxWords - game.baselineWords).toBe(100) // the author's own words: unchanged
  expect(game.maxWords).toBe(countWords(files.get(main)!, 'latex'))

  await clock.advance(120_000)
  expect(asked).toBe('')

  // the author's next sentence is reviewed again, without what came from Overleaf
  files.set(main, `${files.get(main)}\n\nMy own next sentence follows here.`)
  mtimes.set(main, (mtimes.get(main) ?? 0) + 1)
  await clock.advance(120_000)
  expect(asked).toContain('My own next sentence')
  expect(asked).not.toContain('co-author')

  await overleaf('import "~/Downloads/my project.zip"')
  expect(runs.at(-1)!.argv.slice(3)).toEqual(['import', '~/Downloads/my project.zip', '--dir', ROOT])

  reply = { exitCode: 1, stdout: '', stderr: 'manuscript/ has changes that are not committed yet\n' }
  expect((await overleaf('pull')).text).toContain('not committed yet')

  const before = runs.length
  expect((await overleaf('import')).text).toContain('Name the download')
  expect((await overleaf('push')).text).toContain('Usage')
  expect(runs.length).toBe(before)
})

test('autosave reads git status and names the words gained', async () => {
  const porcelain = ' M manuscript/main.tex\0?? manuscript/methods.tex\0R  manuscript/new.md\0manuscript/old.md\0'
  expect(changedPaths(porcelain)).toEqual(['manuscript/main.tex', 'manuscript/methods.tex', 'manuscript/new.md'])
  const message = autosaveMessage([
    { file: 'manuscript/main.tex', before: 100, after: 220 },
    { file: 'manuscript/methods.tex', before: 0, after: 5 },
  ])
  expect(message.split('\n')[0]).toBe('Writing: main.tex, methods.tex (+125 words)')
  expect(message).toContain('manuscript/main.tex: 100 → 220 words')
  expect(autosaveMessage([{ file: 'a.md', before: 9, after: 4 }]).split('\n')[0]).toBe('Writing: a.md (−5 words)')
  expect(autosaveMessage([{ file: 'a.md', before: 0, after: 4 }], 2).split('\n')[0]).toBe('Writing: a.md (+4 words) · AI log +2 entries')
  expect(autosaveMessage([], 1).split('\n')[0]).toBe('AI log +1 entry')
})

test('autosave commits the manuscript and the AI log after a writing pause, and only then', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/ai-log/2026-10.jsonl`, ['p1', 'r1', 'p2'].map(id => JSON.stringify({ type: id[0] === 'p' ? 'prompt' : 'response', id, ref: 'p1', ts: '2026-10-29T10:00:00Z', text: 'x' })).join('\n') + '\n')
  workspace(on, files)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1_000_000, isLink: false } }))
  const runs: (readonly string[])[] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    runs.push(e.argv)
    const args = e.argv.slice(1).join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } as never })
    if (args.endsWith('-- manuscript')) return out(' M manuscript/main.tex\0')
    if (args.endsWith('-- ai-log')) return out(' M ai-log/2026-10.jsonl\0')
    if (args.startsWith('rev-parse')) return out(`${ROOT}\n`)
    if (args.startsWith('show HEAD:ai-log')) return out('{"type":"prompt"}\n')
    if (args.startsWith('show')) return out('Das ist mein Text.')
    return out('')
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  await clock.advance(15_000) // saved 15 s ago: still writing
  expect(runs.some(r => r[1] === 'commit')).toBe(false)

  await clock.advance(30_000) // quiet long enough
  const commit = runs.find(r => r[1] === 'commit')!
  expect(commit).toBeDefined()
  expect(commit.slice(-3)).toEqual(['--', 'manuscript', 'ai-log'])
  expect(commit[commit.indexOf('-m') + 1]).toContain('Writing: main.tex (+5 words) · AI log +2 entries')
  expect(runs.find(r => r[1] === 'add')).toEqual(['git', 'add', '-A', '--', 'manuscript', 'ai-log'])
})

const SCOPE = `# Scope
<!-- comment -->
## Goal
Show that sleep predicts headache.

## Targets
- words: 1000
- figures: 2
- tables:
- references: 4
- deadline: 2026-11-08

## Sections
- Introduction: 300 words · draft
- Results: 700 · revised

## Points
- [x] Headache is common (Introduction)
- [ ] Poor sleep raises next-day risk (Results)
- [ ] Effect holds after adjustment
`

test('scope.md is read in English and German', async () => {
  const plan = parseScope(SCOPE)
  expect(plan.goal).toBe('Show that sleep predicts headache.')
  expect([plan.words, plan.figures, plan.tables, plan.references, plan.deadline]).toEqual([1000, 2, undefined, 4, '2026-11-08'])
  expect(plan.sections).toEqual([
    { name: 'Introduction', target: 300, stage: 'draft' },
    { name: 'Results', target: 700, stage: 'revised' },
  ])
  expect(plan.points).toEqual([
    { text: 'Headache is common', section: 'Introduction', isTicked: true },
    { text: 'Poor sleep raises next-day risk', section: 'Results', isTicked: false },
    { text: 'Effect holds after adjustment', section: undefined, isTicked: false },
  ])
  const de = parseScope('## Ziel\nX\n\n## Umfang\n- Seiten: 20\n- Wörter pro Seite: 350\n- Abgabe: 2027-03-01\n\n## Kapitel\n- Einleitung: 1.500 Wörter · Entwurf\n')
  expect([de.words, de.deadline]).toEqual([7000, '2027-03-01'])
  expect(de.sections[0]).toEqual({ name: 'Einleitung', target: 1500, stage: 'draft' })
})

test('scope progress counts the text and weighs points, quantities and stages', async () => {
  const text = [
    '\\section{Introduction}',
    'One two three four five six seven eight nine ten \\cite{a,b}. TODO',
    '\\begin{figure}x\\end{figure}',
    '\\section{Results}',
    'Eleven twelve thirteen fourteen fifteen \\parencite{c}.',
  ].join('\n')
  const progress = scopeProgress(
    parseScope(SCOPE),
    [{ file: 'manuscript/main.tex', text, format: 'latex' }],
    { 'Poor sleep raises next-day risk': { status: 'partial', where: 'manuscript/main.tex:5' } },
    '2026-10-29T10:00:00Z',
    '2026-10-29',
  )
  expect(progress.figures).toEqual({ done: 1, target: 2 })
  expect(progress.references).toEqual({ done: 3, target: 4 })
  expect(progress.markers).toBe(1)
  const [intro, results] = progress.sections
  expect([intro!.isFound, intro!.markers, results!.words]).toEqual([true, 1, 5])
  // points: ticked 1 + partial 0.5 of 3 = 0.5 (weight 2); words, figures 0.5, references 0.75 (weights 1, .5, .5)
  const words = progress.words.done / 1000
  const close = (a: number, b: number) => expect(Math.abs(a - b) < 1e-9).toBe(true)
  close(progress.content, (0.5 * 2 + words + 0.5 * 0.5 + 0.75 * 0.5) / 4)
  // finish: draft 0.4 less one marker 0.05, weighted 300; revised 0.75, weighted 700
  close(progress.finish!, (0.35 * 300 + 0.75 * 700) / 1000)
  close(progress.overall, 0.7 * progress.content + 0.3 * progress.finish!)
  expect([progress.daysLeft, progress.wordsPerDay]).toEqual([10, Math.ceil((1000 - progress.words.done) / 10)])
  expect(progress.points[1]).toMatchObject({ status: 'partial', where: 'manuscript/main.tex:5' })
})

test('a point check answer is read defensively', async () => {
  const text = 'Here: [{"n":1,"status":"covered","where":"manuscript/main.tex:3"},{"n":2,"status":"weird"},{"n":9,"status":"missing"},{"n":3,"status":"missing","note":"not yet"}]'
  expect(parseCheck(text, 3)).toEqual([
    { n: 1, status: 'covered', where: 'manuscript/main.tex:3' },
    { n: 3, status: 'missing', note: 'not yet' },
  ])
  expect(parseCheck('no json', 3)).toEqual([])
})

test('/cowrite:scope check asks the model, logs it, and the Scope tab shows the points', async ($, on) => {
  const files = paperFiles()
  files.set(`${ROOT}/scope.md`, SCOPE)
  workspace(on, files)
  let system = ''
  on('model.complete', (_: unknown, e: { system?: string }) => {
    system = e.system ?? ''
    return {
      value: {
        isAnswered: true as const,
        text: '[{"n":2,"status":"covered","where":"manuscript/main.tex:2","note":"stated and cited"},{"n":3,"status":"missing"}]',
        usage: {} as never,
      },
    }
  })
  mock.clock(on, { now: Date.parse('2026-10-29T10:00:00Z') })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const presentation = { isFullscreen: false, columns: 100 } as never
  const checked = await $.command.run({ command: 'cowrite:scope', args: 'check', origin: { kind: 'composer' }, presentation })
  expect(checked.text).toContain('1 covered, 0 partial, 2 missing')
  expect(system).toContain('never write, rephrase or suggest text')
  const log = parseLog([...files].filter(([k]) => k.startsWith(`${ROOT}/ai-log/`)).map(([, v]) => v).join('\n'))
  expect(log.some(e => e.type === 'prompt' && e.origin === 'scope' && e.category === 'structure')).toBe(true)
  expect(JSON.parse(files.get(`${ROOT}/.cowriting/scope-check.json`)!).points['Poor sleep raises next-day risk'].status).toBe('covered')

  const shown = await $.command.run({ command: 'cowrite:scope', args: '', origin: { kind: 'composer' }, presentation })
  expect(shown.text).toMatch(/^🎯 ≈ \d+ % · content \d+ % · finish \d+ %$/)
  const ui = await $.ui.mount({
    plugin: 'cowrite',
    component: 'Pane',
    requestId: 'cowriting',
    surface: 'terminal',
    props: { title: 'CoWriting', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /Points 2\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /stated and cited/ })).toBeDefined()
  await ui.unmount()
  const usage = await $.command.run({ command: 'cowrite:scope', args: 'nonsense', origin: { kind: 'composer' }, presentation })
  expect(usage.text).toContain('Usage')
})
