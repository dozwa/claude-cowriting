// CoWriting's hooks module. Everything that takes $ (the mods API) is declared in this one file,
// because the plugin directory reads a mod's calls only through functions declared beside its hooks.
// Pure logic stays in core.ts, personas.ts and sprites.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Count, FocusMode, GameFile, LiveHint, LogEntry, Paper, PointStatus, PromptEntry, Reading, ReadingState, RecentTurn, Review, ScopePoint, ScopeProgress, ScopeSection, Snapshot, Stage, Tab, ThreadLink, Usage, WatchState } from '../types'
import { LOG_GUARD_MESSAGE, foldersUp, isLogPath, mentionsPath, relativeTo, rewrittenLogFiles, shellWrites, strayLogFiles, absolutePath, ACHIEVEMENTS, advanceGame, AI_TEXT_MARKER, appendBrief, authorFileOf, authorGuardMessage, autosaveMessage, BRIEF_FILE, briefFor, briefLines, briefProposalPrompt, briefProposalSystem, categoryFor, changedFiles, changedParagraphs, changedPaths, changeSummaryPrompt, changeSummarySystem, computeStats, countWords, cut, cutDiff, EMPTY_STATS, EMPTY_USAGE, GUARD_MESSAGE, guardInputOf, handBackAgentId, isAuthorsName, isManuscriptPath, liesIn, limitCrossed, localTime, monthFile, NEW_GAME, newId, overrelianceNudge, parseBriefs, parseHints, parseLog, personaForAgent, plural, readable, READ_ONLY_TOOLS, setBrief, shellPath, toUsage, usageParts, usageShort, USE_LABELS, WATCH_DEFAULT, watchExcerpt, watchSystem, xpForLevel } from './core'
import type { FileChange, Fingerprint, Paragraph } from './core'
import { CUSTOM_TOOLS, customDescription, customPersonas, DEFAULT_PARTY, isCustomId, parsePersonaFile, partyPersonas, personaById, personaFileSkeleton, PERSONAS, setCustomPersonas } from './personas'
import type { CustomPersona, Persona } from './personas'
import { rasterCells, svgSource } from './sprites'

// ===== workspace =====
// (was hooks/workspace.ts: the directory reads $ only into functions declared in this file)

// Reading and writing the paper workspace through `$.fs`. A workspace is a
// folder holding paper.json, or a folder whose .active-project names one of
// its projects/<name>/ papers. /cowrite:paper <path> can also point the session at
// a paper folder anywhere, so Claude Code can run from any folder.



type Engine = EngineInterface

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

/**
 * The parsed JSON at `path`, or undefined when the file is missing or not JSON. The caller names the
 * shape on its variable: a type argument on the call would hide the `$` from the directory's reader.
 */
async function readJson($: Engine, path: string): Promise<any> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

type PaperJson = Partial<Pick<Paper, 'name' | 'format' | 'language' | 'party' | 'autosave' | 'versioning'>> & { domainPack?: string }

/** The catalogue members of a paper's party: its roster, or for a paper.json from before rosters, the old domain pack's. */
export const catalogParty = (json: PaperJson): string[] => {
  if (Array.isArray(json.party)) return json.party.filter(id => PERSONAS.some(p => p.id === id))
  return json.domainPack === 'medicine' ? PERSONAS.map(p => p.id) : [...DEFAULT_PARTY]
}

const asPaper = (root: string, json: PaperJson): Paper => ({
  root,
  name: json.name ?? root.split('/').pop() ?? 'paper',
  format: json.format === 'latex' ? 'latex' : 'markdown',
  language: json.language === 'de' ? 'de' : 'en',
  party: [...catalogParty(json), ...customPersonas().filter(p => loadedRoot === root).map(p => p.id)],
  // without git there is nothing to commit to: autosave is off whatever the option says
  autosave: json.autosave !== false && json.versioning !== 'none',
  versioning: json.versioning === 'none' ? 'none' : 'git',
})

/** A paper folder chosen with /cowrite:paper <path>; null: the session's folder decides. */
const paperRootAtom = atom({ plugin: 'cowrite', key: 'paperRoot' } as const, null as string | null)

const RECENT_KEY = 'recentPapers'
const KEEP_RECENT = 8

/** The paper the session works on, or null outside a CoWriting workspace. */
export async function findPaper($: Engine): Promise<Paper | null> {
  const chosen = await read($, paperRootAtom)
  if (chosen !== null) {
    const json = await paperAt($, chosen)
    if (json !== undefined) return asPaper(chosen, json)
  }
  const cwd = await $.session.cwd()
  const here = await paperAt($, cwd)
  if (here !== undefined) return asPaper(cwd, here)

  const marker = join(cwd, '.active-project')
  if (await $.fs.exists(marker)) {
    const name = (await $.fs.read(marker)).trim()
    const root = join(cwd, 'projects', name)
    const json = await paperAt($, root)
    if (json !== undefined) return asPaper(root, json)
  }
  return null
}

/**
 * This folder's paper.json, if the folder is a CoWriting paper. Other projects have files of that
 * name too, and everything in a paper is guarded, so the file alone doesn't make one: a workspace
 * also holds a `manuscript` or `ai-log` folder from the day it is set up.
 */
export async function paperAt($: Engine, root: string): Promise<PaperJson | undefined> {
  const json: unknown = await readJson($, join(root, 'paper.json'))
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return undefined
  const isWorkspace = (await $.fs.exists(join(root, 'manuscript'))) || (await $.fs.exists(join(root, 'ai-log')))
  return isWorkspace ? (json as PaperJson) : undefined
}

// ---------------------------------------------------------------- the party

/** The author's own experts: party/<id>.md files in the paper folder. */
export const PARTY_DIR = 'party'

// the paper whose experts personas.ts holds, and the prompt each one was registered with
let loadedRoot: string | null = null
const registered = new Map<string, string>()

/** The party/<id>.md files of a paper as personas, with the ids of files that are not one. */
export async function readCustomPersonas($: Engine, root: string): Promise<{ experts: CustomPersona[]; broken: string[] }> {
  const dir = join(root, PARTY_DIR)
  const experts: CustomPersona[] = []
  const broken: string[] = []
  if (!(await $.fs.exists(dir))) return { experts, broken }
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md')).map(f => f.name).sort()
  for (const name of files) {
    const id = name.slice(0, -3)
    const parsed = parsePersonaFile(id, await $.fs.read(join(dir, name)).catch(() => ''))
    if (parsed === null) broken.push(id)
    else experts.push(parsed)
  }
  return { experts, broken }
}

/**
 * Reads the paper's experts, makes them known to the pane and the commands, and registers each as a
 * cowrite:<id> agent type the model can dispatch from the next turn on; one already registered with the
 * same prompt is left alone. Returns the ids of files that are not a persona.
 */
export async function loadParty($: Engine, root: string): Promise<string[]> {
  const { experts, broken } = await readCustomPersonas($, root)
  if (loadedRoot !== root) registered.clear()
  loadedRoot = root
  setCustomPersonas(experts.map(x => x.persona))
  for (const { persona, prompt } of experts) {
    if (registered.get(persona.id) === prompt) continue
    const name = persona.id
    const description = customDescription(persona)
    try {
      // written out member by member: the directory reads the registration as it stands here
      await $.agent.register({ name: name, description: description, prompt: prompt, tools: CUSTOM_TOOLS })
      registered.set(persona.id, prompt)
    } catch {
      // not bound yet, or the spec refused: the next load tries again
    }
  }
  for (const id of [...registered.keys()]) if (!experts.some(x => x.persona.id === id)) registered.delete(id)
  return broken
}

/** Writes the roster of catalogue members into paper.json, keeping everything else in it. */
export async function writeParty($: Engine, root: string, ids: readonly string[]): Promise<void> {
  const path = join(root, 'paper.json')
  const json: (PaperJson & Record<string, unknown>) | undefined = await readJson($, path)
  const { domainPack: _pack, ...rest } = json ?? {}
  await $.fs.write(path, `${JSON.stringify({ ...rest, party: ids }, null, 2)}\n`)
}

/** Writes the versioning choice into paper.json, keeping everything else in it; git is the default and is left out. */
async function writeVersioning($: Engine, root: string, mode: 'git' | 'none'): Promise<void> {
  const path = join(root, 'paper.json')
  const json: (PaperJson & Record<string, unknown>) | undefined = await readJson($, path)
  const { versioning: _old, ...rest } = json ?? {}
  await $.fs.write(path, `${JSON.stringify(mode === 'none' ? { ...rest, versioning: 'none' } : rest, null, 2)}\n`)
}

/** /cowrite:paper versioning: whether this paper is saved with git; with a mode, the switch. */
async function setVersioning($: Engine, paper: Paper, mode: 'git' | 'none' | undefined): Promise<string> {
  const current =
    paper.versioning === 'none'
      ? 'This paper is set up without git: nothing is saved automatically, and "What did I change since?" has no history to compare. The AI log and the disclosure work as always.'
      : paper.autosave
        ? 'This paper is versioned with git: the manuscript and the AI log are saved after each writing pause, under your git name.'
        : 'This paper is versioned with git, but autosave is off (the "Autosave to git" option, or "autosave": false in paper.json).'
  if (mode === undefined) return `${current}\nSwitch with /cowrite:paper versioning git, or /cowrite:paper versioning none.`
  if (mode === paper.versioning) return current
  if (mode === 'git') {
    const inside = await git($, paper, ['rev-parse', '--is-inside-work-tree']).catch(() => null)
    if (inside === null) return 'git is not installed on this machine, so the paper stays without versioning. Install git (https://git-scm.com) and run this again.'
    if (inside.exitCode !== 0) {
      const init = await git($, paper, ['init', '-q']).catch(() => null)
      if (init === null || init.exitCode !== 0) return `git init failed: ${init?.stderr.trim().slice(0, 100) ?? 'git could not be started'}`
    }
  }
  await writeVersioning($, paper.root, mode)
  return mode === 'git'
    ? 'Versioning is on: from the next writing pause on, the manuscript and the AI log are saved after each change, under your git name (git config --global user.name and user.email).'
    : 'Versioning is off for this paper: nothing is saved automatically from now on, so keep your own backups. /cowrite:paper versioning git switches it back on.'
}

export async function readLog($: Engine, root: string): Promise<LogEntry[]> {
  const dir = join(root, 'ai-log')
  if (!(await $.fs.exists(dir))) return []
  const files = (await $.fs.list(dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
    .map(f => f.name)
    .sort()
  const entries: LogEntry[] = []
  for (const name of files) entries.push(...parseLog(await $.fs.read(join(dir, name))))
  return entries
}

// The versions every response entry names, set once the session knows them.
let versions: { plugin?: string; claude_code?: string } = {}
export const setLogVersions = (v: { plugin?: string; claude_code?: string }) => {
  versions = { ...v }
}

// One writer at a time per paper: the log is appended by reading and rewriting the month's
// file (the engine's fs has no append), so two appends in flight would lose one.
const queues = new Map<string, Promise<unknown>>()

/** Runs `fn` after every earlier log write of this paper has finished, before any later one. */
export function withLog<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  queues.set(root, run.catch(() => undefined))
  return run
}

/** Append one entry to this month's log file (append-only by content). */
export function appendLog($: Engine, root: string, entry: LogEntry): Promise<void> {
  const stamped = entry.type === 'response' ? { ...entry, ...versions } : entry
  return withLog(root, async () => {
    const path = join(root, 'ai-log', monthFile(new Date()))
    const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    const sep = before === '' || before.endsWith('\n') ? '' : '\n'
    await $.fs.write(path, `${before}${sep}${JSON.stringify(stamped)}\n`)
  })
}

/** The log's files as they are now, by content, in turn with the plugin's own appends. */
export async function snapshotLog($: Engine, root: string): Promise<Record<string, string>> {
  const dir = join(root, 'ai-log')
  if (!(await $.fs.exists(dir))) return {}
  return withLog(root, async () => {
    const out: Record<string, string> = {}
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'file' && entry.name !== '.gitkeep') out[`ai-log/${entry.name}`] = await $.fs.read(join(dir, entry.name)).catch(() => '')
    }
    return out
  })
}

/** Undo what a tool call did to the log: put rewritten files back, take new ones out. What they had become is kept beside the paper's state. */
export async function restoreLog($: Engine, root: string, rewritten: readonly string[], strays: readonly string[], before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const keep = (file: string) => $.fs.write(join(root, '.cowriting', 'log-rewrites', `${stamp}-${file.split('/').pop()}`), after[file]!)
  await withLog(root, async () => {
    for (const file of rewritten) {
      if (after[file] !== undefined) await keep(file)
      await $.fs.write(join(root, file), before[file]!)
    }
    for (const file of strays) {
      await keep(file)
      await $.process.run(['rm', '-f', '--', join(root, file)])
    }
  })
}

/** The files of a manuscript the party reads: text formats, and office files pandoc turns into text. */
export const MANUSCRIPT_FILE = /\.(tex|md|markdown|qmd|rmd|docx|odt)$/i

/** A Word or LibreOffice file: read through pandoc, never as bytes. */
export const CONVERTED_FILE = /\.(docx|odt)$/i

/**
 * A manuscript file as text: the file itself, or for a Word/LibreOffice file what
 * pandoc makes of it (Markdown, lines unwrapped). Rejects when pandoc is missing or fails.
 */
export async function readText($: Engine, path: string): Promise<string> {
  if (!CONVERTED_FILE.test(path)) return $.fs.read(path)
  const run = await $.process.run(['pandoc', path, '--to', 'markdown', '--wrap=none'], { timeoutMs: 60_000 })
  if (run.exitCode !== 0) throw new Error(`pandoc could not read ${path}: ${run.stderr.trim() || `exit ${run.exitCode}`}`)
  return run.stdout
}

/**
 * /cowrite:paper upgrade [apply]: what a workspace from an earlier plugin version lacks,
 * listed by the scaffold tool; with apply, made. Runs on the host, not as a tool call,
 * so the guard neither refuses it (the author asked) nor records it as a detected change.
 */
export async function upgradePaper($: Engine, root: string, isApply: boolean): Promise<string> {
  const tool = join($.plugin.root, 'tools', 'new_paper.py')
  const run = await $.process.run(['python3', '-I', tool, '--upgrade', ...(isApply ? ['--apply'] : []), '--dir', root], { cwd: root, timeoutMs: 60_000 })
  if (run.exitCode !== 0) return `Upgrade failed:\n${(run.stderr || run.stdout).trim()}`
  const report = run.stdout.trim()
  if (isApply || report.endsWith('nothing to do.')) return report
  return `${report}\nApply with /cowrite:paper upgrade apply. Your CLAUDE.md is kept under .cowriting/upgrade/ if it is replaced.`
}

/** Folders never compared: git's own, and dependencies a build may pull in. */
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules'])

/** Every file of the author's under the paper, a few levels deep: Claude's places are left out. */
export async function listAuthorFiles($: Engine, root: string, dir = root, depth = 0): Promise<string[]> {
  if (depth > 4 || !(await $.fs.exists(dir))) return []
  const out: string[] = []
  for (const entry of await $.fs.list(dir)) {
    const path = join(dir, entry.name)
    if (entry.kind === 'dir') {
      if (SKIPPED_FOLDERS.has(entry.name) || authorFileOf(join(path, 'x'), root) === null) continue
      out.push(...(await listAuthorFiles($, root, path, depth + 1)))
    } else if (entry.kind === 'file' && authorFileOf(path, root) !== null) out.push(path)
  }
  return out
}

/** The author's files as they are now: relative path → `mtime:size`. */
export async function fingerprintAuthorFiles($: Engine, paper: Paper): Promise<Fingerprint> {
  const out: Record<string, string> = {}
  for (const path of await listAuthorFiles($, paper.root)) {
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat !== null) out[path.slice(paper.root.length + 1)] = `${stat.mtimeMs}:${stat.size}`
  }
  return out
}

/** The names at the paper's root that are wholly the author's: what a shell command may not write to. */
export async function authorNames($: Engine, root: string): Promise<string[]> {
  const entries = await $.fs.list(root).catch(() => [])
  return entries.map(x => x.name).filter(name => !SKIPPED_FOLDERS.has(name) && isAuthorsName(name))
}

async function wordsUnder($: Engine, dir: string, depth: number): Promise<number> {
  if (depth > 4 || !(await $.fs.exists(dir))) return 0
  let total = 0
  for (const entry of await $.fs.list(dir)) {
    const path = join(dir, entry.name)
    if (entry.kind === 'dir') total += await wordsUnder($, path, depth + 1)
    else if (entry.kind === 'file' && MANUSCRIPT_FILE.test(entry.name)) {
      const format = entry.name.toLowerCase().endsWith('.tex') ? 'latex' : 'markdown'
      total += countWords(await readText($, path).catch(() => ''), format)
    }
  }
  return total
}

export async function manuscriptWords($: Engine, paper: Paper): Promise<number> {
  return wordsUnder($, join(paper.root, 'manuscript'), 0)
}

const gamePath = (root: string) => join(root, '.cowriting', 'game.json')

export async function readGame($: Engine, root: string): Promise<GameFile> {
  const game: GameFile | undefined = await readJson($, gamePath(root))
  return game?.version === 1 ? { ...NEW_GAME, ...game } : NEW_GAME
}

export async function writeGame($: Engine, root: string, game: GameFile): Promise<void> {
  await $.fs.write(gamePath(root), `${JSON.stringify(game, null, 2)}\n`)
}

/** Counts the tools write: verified references and generated disclosures. */
export async function readToolCounts($: Engine, root: string) {
  // 0.2.0 writes the summary in Claude's place; a run before that left it in literature/
  const current: { ok?: number } | undefined = await readJson($, join(root, '.cowriting', 'verify.json'))
  const earlier: { ok?: number } | undefined = await readJson($, join(root, 'literature', '.verify.json'))
  const verify = current ?? earlier
  const disclosureDir = join(root, 'disclosure')
  const disclosures = (await $.fs.exists(disclosureDir))
    ? (await $.fs.list(disclosureDir)).filter(f => f.name.startsWith('ai-register')).length
    : 0
  return { verifiedRefs: verify?.ok ?? 0, disclosures }
}

export async function setActiveProject($: Engine, name: string): Promise<string> {
  const cwd = await $.session.cwd()
  const root = join(cwd, 'projects', name)
  if (!(await $.fs.exists(join(root, 'paper.json')))) {
    return `No paper "${name}" under projects/. Create one with /cowrite:init.`
  }
  await $.fs.write(join(cwd, '.active-project'), `${name}\n`)
  await update($, paperRootAtom, () => null)
  return `Active paper: ${name}`
}

/** Papers opened by path before, newest first (kept across sessions). */
export async function recentPapers($: Engine): Promise<string[]> {
  const value = await $.store.get(RECENT_KEY).catch(() => undefined)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** `~/x`, `x` (relative to the session's folder) or `/x`, without a trailing slash. */
async function resolvePath($: Engine, arg: string): Promise<string> {
  const raw = arg.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (raw === '~' || raw.startsWith('~/')) return join((await $.env.get('HOME')) ?? '', raw.slice(1)).replace(/(.)\/$/, '$1')
  const path = raw.startsWith('/') ? raw : join(await $.session.cwd(), raw)
  return path.replace(/(.)\/$/, '$1')
}

/** Is one of these paths in a paper's `manuscript` folder? One that can't be told counts as yes. */
/** The paper this path lies in, nearest first; a path that doesn't show where it points lies in none. */
export async function paperRootOf($: Engine, path: string): Promise<string | null> {
  for (const folder of foldersUp(path)) {
    if ((await paperAt($, folder)) !== undefined) return folder
  }
  return null
}

/** `$HOME`, read only when the text being resolved has a `~` to expand. */
async function homeFor($: Engine, text: string): Promise<string> {
  return text.includes('~') ? (await $.env.get('HOME')) ?? '' : ''
}

/** Why this file may not be written, or null. The one rule of the guard: only a paper's files are protected, wherever the session is. */
async function refusalFor($: Engine, path: string, isAppend = false): Promise<string | null> {
  const root = await paperRootOf($, path)
  if (root === null) return null
  if (isLogPath(path, root)) return isAppend ? null : LOG_GUARD_MESSAGE
  const rel = relativeTo(path, root)
  if (isManuscriptPath(rel)) return GUARD_MESSAGE
  if (rel === '') return authorGuardMessage('the paper folder')
  const file = authorFileOf(path, root)
  return file === null ? null : authorGuardMessage(file)
}

/**
 * Why this call may not run, or null. Working inside a paper, a write the text can't place is refused
 * if it names what is protected; anywhere else only what visibly lies in a paper counts.
 */
async function guardVerdict($: Engine, tool: string, path: string, command: string): Promise<string | null> {
  const cwd = await $.session.cwd()
  const home = await homeFor($, path + command)
  const here = await paperRootOf($, cwd)
  const protectedNames = async () => (here === null ? [] : ['manuscript', 'ai-log', ...(await authorNames($, here))])
  if (tool !== 'Bash') {
    const full = shellPath(path, cwd, home)
    if (foldersUp(full).length > 0 && !/[$`]/.test(full)) return refusalFor($, full)
    return mentionsPath(path, await protectedNames()) ? authorGuardMessage(path) : null
  }
  const writes = shellWrites(command, cwd, home)
  for (const write of writes.paths) {
    const refusal = await refusalFor($, write.path, write.isAppend)
    if (refusal !== null) return refusal
  }
  if (here === null) return null
  const names = await protectedNames()
  const cantPlace = writes.hidden.length > 0 || writes.isOpaque
  return cantPlace && mentionsPath(command, names) ? authorGuardMessage('the file this command writes') : null
}

async function kindOf($: Engine, path: string): Promise<'file' | 'dir' | 'other' | 'none'> {
  return $.fs.stat(path).then(s => s.kind, () => 'none' as const)
}

/**
 * /cowrite:paper <arg>: a number picks a recent paper, a bare name one under
 * projects/, anything else is a path to a paper folder (or a file in it).
 */
export async function openPaper($: Engine, arg: string): Promise<string> {
  const recent = await recentPapers($)
  if (/^\d+$/.test(arg)) {
    const pick = recent[Number(arg) - 1]
    if (pick === undefined) return `No recent paper #${arg}. /cowrite:paper lists them.`
    arg = pick
  }
  const isName = !/[\/~]/.test(arg) && arg !== '.' && arg !== '..'
  if (isName && (await $.fs.exists(join(await $.session.cwd(), 'projects', arg, 'paper.json')))) {
    return setActiveProject($, arg)
  }
  let root = await resolvePath($, arg)
  const kind = await kindOf($, root)
  if (kind === 'none' || kind === 'other') return `No folder ${root}.`
  if (kind === 'file') root = root.replace(/\/[^/]+$/, '') || '/'
  const json = await paperAt($, root)
  if (json === undefined) {
    return `${root} is not a CoWriting paper yet. Set it up there with /cowrite:init ${root}`
  }
  await update($, paperRootAtom, () => root)
  await $.store.set(RECENT_KEY, [root, ...recent.filter(r => r !== root)].slice(0, KEEP_RECENT)).catch(() => undefined)
  return `Active paper: ${json.name ?? root.split('/').pop()} · ${root}`
}

/**
 * /cowrite:init <path>: the session works on that folder from now on, so the
 * workspace the skill scaffolds there is the active paper once it exists.
 */
export async function targetFolder($: Engine, arg: string): Promise<string | null> {
  const root = await resolvePath($, arg)
  if ((await kindOf($, root)) !== 'dir') return null
  await update($, paperRootAtom, () => root)
  const recent = await recentPapers($)
  await $.store.set(RECENT_KEY, [root, ...recent.filter(r => r !== root)].slice(0, KEEP_RECENT)).catch(() => undefined)
  return root
}

/** /cowrite:paper without arguments: the active paper and the recent ones. */
export async function describePapers($: Engine): Promise<string> {
  const paper = await findPaper($)
  const recent = await recentPapers($)
  const lines = [paper === null ? 'No active paper.' : `Active paper: ${paper.name} · ${paper.root}`]
  if (recent.length > 0) lines.push('Recent:', ...recent.map((r, i) => `  ${i + 1}  ${r}`))
  lines.push('Switch with /cowrite:paper <path | number | project name>.')
  return lines.join('\n')
}

export async function readBriefs($: Engine, root: string): Promise<Record<string, string>> {
  const path = join(root, BRIEF_FILE)
  if (!(await $.fs.exists(path))) return {}
  return parseBriefs(await $.fs.read(path))
}

/** Sets one section of party.md, creating the file when the paper has none. */
export async function writeBrief($: Engine, root: string, key: string, body: string): Promise<void> {
  const path = join(root, BRIEF_FILE)
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : '# Briefing for the review party\n'
  await $.fs.write(path, setBrief(before, key, body))
}

/** Adds lines under one persona's section of party.md, keeping what the author wrote there. */
export async function appendBriefLines($: Engine, root: string, key: string, lines: string): Promise<void> {
  const path = join(root, BRIEF_FILE)
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : '# Briefing for the review party\n'
  await $.fs.write(path, appendBrief(before, key, lines))
}

// ===== autosave =====
// (was hooks/autosave.ts: the directory reads $ only into functions declared in this file)

// Autosave: the author's manuscript and the AI log are committed to git after
// each change, once the files have been quiet for a short pause, so the
// history shows how the text grew next to the AI input that came before it.
// Only manuscript/ and ai-log/ are committed, under the author's own git
// identity and unchanged; whatever else is staged stays as it is.




export const AUTOSAVE_TICK_MS = 15_000
/** How long the manuscript must stay unchanged before it is committed. */
export const AUTOSAVE_PAUSE_MS = 30_000

/** What autosave commits: the author's text and the record of AI input. */
const SAVED = ['manuscript', 'ai-log'] as const
const AUTOSAVE_TEXT_FILE = /\.(md|markdown|tex|txt)$/

// A tick is not re-entered, and a failure is reported once per kind.
let isBusy = false
let reported = ''

function git($: Engine, paper: Paper, args: readonly string[]) {
  return $.process.run(['git', ...args], { cwd: paper.root })
}

function reportOnce($: Engine, kind: string, text: string): void {
  if (reported === kind) return
  reported = kind
  $.ui.toast(text)
}

async function newLogEntries($: Engine, paper: Paper, top: string, path: string): Promise<number> {
  const shown = await git($, paper, ['show', `HEAD:${path}`])
  const lines = (text: string) => text.split('\n').filter(l => l.trim() !== '').length
  const before = shown.exitCode === 0 ? lines(shown.stdout) : 0
  return (await $.fs.read(`${top}/${path}`).then(lines, () => 0)) - before
}

async function wordsAt($: Engine, paper: Paper, top: string, path: string): Promise<FileChange> {
  const shown = await git($, paper, ['show', `HEAD:${path}`])
  const before = shown.exitCode === 0 ? countWords(shown.stdout, paper.format) : 0
  const after = await $.fs.read(`${top}/${path}`).then(text => countWords(text, paper.format), () => 0)
  return { file: path, before, after }
}

/** One look at the manuscript and the AI log; resolves the commit's title when it committed. */
export async function autosaveTick($: Engine): Promise<string | null> {
  if (isBusy) return null
  isBusy = true
  try {
    const paper = await findPaper($)
    if (paper === null || !paper.autosave) return null
    // folder by folder: a folder git cannot see (missing, or empty) would fail the commit
    const changed: string[] = []
    const paths: string[] = []
    for (const folder of SAVED) {
      const status = await git($, paper, ['status', '--porcelain', '-z', '-uall', '--', folder])
      if (status.exitCode !== 0) {
        reportOnce($, 'no-repo', 'CoWriting autosave: the paper folder is not a git repository. /cowrite:paper versioning git creates one; /cowrite:paper versioning none turns autosave off for this paper.')
        return null
      }
      const found = changedPaths(status.stdout)
      if (found.length > 0) changed.push(folder)
      paths.push(...found)
    }
    if (paths.length === 0) return null

    const top = (await git($, paper, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const now = await $.clock.now()
    for (const path of paths) {
      const mtime = await $.fs.stat(`${top}/${path}`).then(s => s.mtimeMs, () => 0)
      if (now - mtime < AUTOSAVE_PAUSE_MS) return null // still writing
    }

    const isLog = (path: string) => /(^|\/)ai-log\//.test(path)
    const written = paths.filter(p => !isLog(p))
    const logged = paths.filter(isLog)
    const changes: FileChange[] = []
    for (const path of written) {
      changes.push(AUTOSAVE_TEXT_FILE.test(path) ? await wordsAt($, paper, top, path) : { file: path, before: 0, after: 0 })
    }
    let entries: number | null = null
    for (const path of logged) entries = (entries ?? 0) + Math.max(0, await newLogEntries($, paper, top, path))
    const message = autosaveMessage(changes, entries)

    await git($, paper, ['add', '-A', '--', ...changed])
    const commit = await git($, paper, ['commit', '--quiet', '-m', message, '--', ...changed])
    if (commit.exitCode !== 0) {
      const isIdentity = /tell me who you are|user\.email|user\.name/i.test(commit.stderr)
      reportOnce(
        $,
        isIdentity ? 'identity' : 'commit',
        isIdentity
          ? 'CoWriting autosave needs your git name: git config --global user.name "…" and user.email "…"'
          : `CoWriting autosave could not commit: ${commit.stderr.trim().slice(0, 100)}`,
      )
      return null
    }
    reported = ''
    return message.split('\n')[0]!
  } finally {
    isBusy = false
  }
}

// ===== scope =====
// (was hooks/scope.ts: the directory reads $ only into functions declared in this file)

// The scope: what the author plans for the paper (scope.md, their words) and
// how far the manuscript has come. Words, figures, tables, references and
// open markers are counted without AI; whether the planned points are made is
// judged by a small model on request (/cowrite:scope check), logged like any AI input.




export const SCOPE_FILE = 'scope.md'
const CHECK_FILE = '.cowriting/scope-check.json'
/** Words on a page when the author gives pages, not words. */
export const WORDS_PER_PAGE = 300

// ------------------------------------------------------------ the plan

export type ScopePlan = {
  goal: string
  words?: number
  figures?: number
  tables?: number
  references?: number
  deadline?: string
  sections: { name: string; target?: number; stage?: Stage }[]
  points: { text: string; section?: string; isTicked: boolean }[]
}

const STAGES: Record<string, Stage> = {
  outline: 'outline', gliederung: 'outline', skizze: 'outline',
  draft: 'draft', entwurf: 'draft', rohfassung: 'draft',
  revised: 'revised', überarbeitet: 'revised', ueberarbeitet: 'revised',
  final: 'final', fertig: 'final', done: 'final',
}

/** Target keys in English and German. */
const TARGETS: Record<string, keyof ScopePlan | 'pages' | 'perPage'> = {
  words: 'words', wörter: 'words', woerter: 'words',
  pages: 'pages', seiten: 'pages',
  'words per page': 'perPage', 'wörter pro seite': 'perPage',
  figures: 'figures', abbildungen: 'figures',
  tables: 'tables', tabellen: 'tables',
  references: 'references', quellen: 'references', literatur: 'references',
  deadline: 'deadline', abgabe: 'deadline', frist: 'deadline',
}

const number = (text: string): number | undefined => {
  const match = /(\d[\d.,' ]*)/.exec(text)
  if (match === null) return undefined
  const n = Number(match[1]!.replace(/[.,' ](?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const sectionKind = (heading: string): 'goal' | 'targets' | 'sections' | 'points' | undefined => {
  const lower = heading.toLowerCase()
  if (/goal|ziel/.test(lower)) return 'goal'
  if (/target|umfang|vorgabe/.test(lower)) return 'targets'
  if (/section|kapitel|abschnitt|gliederung|outline/.test(lower)) return 'sections'
  if (/point|kernaussage|aussage|punkt/.test(lower)) return 'points'
  return undefined
}

/** scope.md as the author wrote it; comments and placeholders ignored. */
export const parseScope = (text: string): ScopePlan => {
  const plan: ScopePlan = { goal: '', sections: [], points: [] }
  let pages: number | undefined
  let perPage = WORDS_PER_PAGE
  const parts = text.replace(/<!--[\s\S]*?-->/g, '').split(/^## +(.+)$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const kind = sectionKind(parts[i]!)
    const body = (parts[i + 1] ?? '').trim()
    const items = body.split('\n').map(l => l.trim()).filter(l => /^[-*+]\s/.test(l)).map(l => l.replace(/^[-*+]\s+/, ''))
    if (kind === 'goal') plan.goal = body
    if (kind === 'targets') {
      for (const item of items) {
        const [rawKey = '', ...rest] = item.split(':')
        const key = TARGETS[rawKey.trim().toLowerCase()]
        const value = rest.join(':').trim()
        if (key === undefined || value === '') continue
        if (key === 'deadline') {
          const date = /\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
          if (date !== undefined) plan.deadline = date
        } else if (key === 'pages') pages = number(value)
        else if (key === 'perPage') perPage = number(value) ?? perPage
        else (plan as Record<string, unknown>)[key] = number(value)
      }
    }
    if (kind === 'sections') {
      for (const item of items) {
        const [name = '', ...rest] = item.split(':')
        const detail = rest.join(':').toLowerCase()
        const stage = Object.entries(STAGES).find(([word]) => new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(detail))?.[1]
        if (name.trim() !== '') plan.sections.push({ name: name.trim(), target: number(detail), stage })
      }
    }
    if (kind === 'points') {
      for (const item of items) {
        const tick = /^\[([ xX✓])\]\s*/.exec(item)
        let text = tick ? item.slice(tick[0].length) : item
        let section: string | undefined
        const tail = /\s*\((?:→\s*|in\s+)?([^()]+)\)\s*$/.exec(text)
        if (tail !== null && plan.sections.some(s => s.name.toLowerCase() === tail[1]!.trim().toLowerCase())) {
          section = tail[1]!.trim()
          text = text.slice(0, tail.index)
        }
        if (text.trim() !== '') plan.points.push({ text: text.trim(), section, isTicked: tick !== null && tick[1] !== ' ' })
      }
    }
  }
  if (plan.words === undefined && pages !== undefined) plan.words = Math.round(pages * perPage)
  if (plan.words === undefined && plan.sections.some(s => s.target !== undefined)) {
    plan.words = plan.sections.reduce((sum, s) => sum + (s.target ?? 0), 0)
  }
  return plan
}

export const isEmptyPlan = (plan: ScopePlan): boolean =>
  plan.goal === '' && plan.points.length === 0 && plan.sections.length === 0 && plan.words === undefined

// ------------------------------------------------------------ the text

export type TextFile = { file: string; text: string; format: 'latex' | 'markdown' }

const MARKERS = /\bTODO\b|\bFIXME\b|\bXXX\b|\\todo\b|\?\?|\[citation needed\]|\bUNVERIFIED\b/g
const HEADING = { latex: /^\s*\\(?:chapter|section)\*?\{([^}]*)\}/, markdown: /^#{1,2}\s+(.+?)\s*#*$/ }

type Chunk = { heading: string; text: string; format: 'latex' | 'markdown' }

/** The text cut at its top headings (chapters and sections, # and ##). */
const chunks = (files: readonly TextFile[]): Chunk[] => {
  const out: Chunk[] = []
  for (const f of files) {
    let current: Chunk = { heading: '', text: '', format: f.format }
    out.push(current)
    for (const line of f.text.split('\n')) {
      const heading = HEADING[f.format].exec(line)
      if (heading !== null) {
        current = { heading: heading[1]!.trim(), text: '', format: f.format }
        out.push(current)
      } else current.text += `${line}\n`
    }
  }
  return out
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

const citekeys = (files: readonly TextFile[]): Set<string> => {
  const keys = new Set<string>()
  for (const f of files) {
    for (const m of f.text.matchAll(/\\[A-Za-z]*cite[a-z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g)) {
      for (const key of m[1]!.split(',')) if (key.trim() !== '') keys.add(key.trim())
    }
    if (f.format === 'markdown') for (const m of f.text.matchAll(/(?:^|[\s[;-])@([\w:.-]*\w)/g)) keys.add(m[1]!)
  }
  return keys
}

const matches = (heading: string, name: string) => {
  const lower = heading.toLowerCase()
  const n = name.toLowerCase()
  return lower !== '' && (lower === n || lower.includes(n) || n.includes(lower))
}

const STAGE_VALUE: Record<Stage, number> = { outline: 0, draft: 0.4, revised: 0.75, final: 1 }
/** Each open marker in a section takes this much off its finish. */
const MARKER_COST = 0.05

const ratio = (c: Count) => (c.target === undefined ? undefined : Math.min(1, c.done / c.target))

/** How far the text has come against the plan; points as the author ticked them or the last check found. */
export const scopeProgress = (
  plan: ScopePlan,
  files: readonly TextFile[],
  checked: Record<string, { status: PointStatus; where?: string; note?: string }>,
  checkedAt: string | undefined,
  today: string,
): ScopeProgress => {
  const parts = chunks(files)
  const words = parts.reduce((sum, c) => sum + countWords(c.text, c.format), 0)
  const allText = files.map(f => f.text).join('\n')
  const sections: ScopeSection[] = plan.sections.map(s => {
    const own = parts.filter(c => matches(c.heading, s.name))
    return {
      name: s.name,
      target: s.target,
      stage: s.stage,
      words: own.reduce((sum, c) => sum + countWords(c.text, c.format), 0),
      markers: own.reduce((sum, c) => sum + count(c.text, MARKERS), 0),
      isFound: own.length > 0,
    }
  })
  const points: ScopePoint[] = plan.points.map(p => ({ ...p, ...(checked[p.text] ?? {}) }))
  const counts = {
    words: { done: words, target: plan.words },
    figures: { done: files.reduce((n, f) => n + count(f.text, f.format === 'latex' ? /\\begin\{figure\*?\}/g : /!\[[^\]]*\]\([^)]*\)/g), 0), target: plan.figures },
    tables: {
      done: files.reduce((n, f) => n + count(f.text, f.format === 'latex' ? /\\begin\{table\*?\}/g : /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm), 0),
      target: plan.tables,
    },
    references: { done: citekeys(files).size, target: plan.references },
  }

  // content: the points count double, each quantity once (figures, tables, references half)
  const weighted: [number | undefined, number][] = [
    [points.length > 0 ? points.reduce((sum, p) => sum + (p.isTicked || p.status === 'covered' ? 1 : p.status === 'partial' ? 0.5 : 0), 0) / points.length : undefined, 2],
    [ratio(counts.words), 1],
    [ratio(counts.figures), 0.5],
    [ratio(counts.tables), 0.5],
    [ratio(counts.references), 0.5],
  ]
  const known = weighted.filter((p): p is [number, number] => p[0] !== undefined)
  const content = known.length === 0 ? 0 : known.reduce((s, [v, w]) => s + v * w, 0) / known.reduce((s, [, w]) => s + w, 0)

  // finish: the sections' stages, weighted by their targets, less the open markers
  const staged = sections.filter(s => s.stage !== undefined)
  const finish =
    staged.length === 0
      ? null
      : staged.reduce((sum, s) => sum + Math.max(0, STAGE_VALUE[s.stage!] - s.markers * MARKER_COST) * (s.target ?? 1), 0) /
        staged.reduce((sum, s) => sum + (s.target ?? 1), 0)

  let daysLeft: number | undefined
  let wordsPerDay: number | undefined
  if (plan.deadline !== undefined) {
    daysLeft = Math.ceil((Date.parse(plan.deadline) - Date.parse(today)) / 86_400_000)
    if (plan.words !== undefined && daysLeft > 0) wordsPerDay = Math.max(0, Math.ceil((plan.words - words) / daysLeft))
  }
  return {
    goal: plan.goal,
    ...counts,
    deadline: plan.deadline,
    daysLeft,
    wordsPerDay,
    points,
    checkedAt,
    sections,
    markers: count(allText, MARKERS),
    content,
    finish,
    overall: finish === null ? content : 0.7 * content + 0.3 * finish,
  }
}

// ------------------------------------------------------------ the check

/** Manuscript lines with their numbers, file by file, cut at `maxChars`. */
export const numberedText = (files: readonly TextFile[], maxChars = 80_000): string => {
  let out = ''
  for (const f of files) {
    const block = `### ${f.file}\n${f.text.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}\n\n`
    if (out.length + block.length > maxChars) return `${out}${block.slice(0, Math.max(0, maxChars - out.length))}\n[… cut]`
    out += block
  }
  return out
}

export const scopeCheckSystem = (language: 'en' | 'de') =>
  [
    "You check which of an author's planned points their manuscript already makes. You never write, rephrase or suggest text:",
    'the author is the sole author (DFG good scientific practice). You only assess.',
    'For each numbered point answer: status "covered" (made and supported), "partial" (mentioned but not developed or not',
    'supported) or "missing"; where = "file:line" of the best evidence (omit if missing); note = at most 15 words on what is',
    'there or what is lacking, never wording for it.',
    `Write the notes in ${language === 'de' ? 'German' : 'English'}.`,
    'Answer with a JSON array only: [{"n": 1, "status": "partial", "where": "manuscript/main.tex:42", "note": "…"}].',
  ].join(' ')

export const parseCheck = (text: string, count: number): { n: number; status: PointStatus; where?: string; note?: string }[] => {
  const json = /\[[\s\S]*\]/.exec(text)?.[0]
  if (json === undefined) return []
  try {
    const items = JSON.parse(json) as unknown[]
    return items.flatMap(item => {
      const o = item as Record<string, unknown>
      const n = Number(o.n)
      const status = o.status
      if (!Number.isInteger(n) || n < 1 || n > count) return []
      if (status !== 'covered' && status !== 'partial' && status !== 'missing') return []
      return [{
        n,
        status,
        ...(typeof o.where === 'string' && o.where !== '' ? { where: o.where } : {}),
        ...(typeof o.note === 'string' && o.note !== '' ? { note: o.note.slice(0, 160) } : {}),
      }]
    })
  } catch {
    return []
  }
}

type CheckFile = { ts: string; model: string; points: Record<string, { status: PointStatus; where?: string; note?: string }> }


export async function readCheck($: Engine, root: string): Promise<CheckFile | undefined> {
  try {
    const path = join(root, CHECK_FILE)
    return (await $.fs.exists(path)) ? (JSON.parse(await $.fs.read(path)) as CheckFile) : undefined
  } catch {
    return undefined
  }
}

const SCOPE_TEXT_FILE = /\.(tex|md|markdown|qmd|rmd)$/i

export async function readTextFiles($: Engine, paper: Paper): Promise<TextFile[]> {
  const out: TextFile[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || !(await $.fs.exists(dir))) return
    for (const entry of await $.fs.list(dir)) {
      const path = join(dir, entry.name)
      if (entry.kind === 'dir') await walk(path, depth + 1)
      else if (entry.kind === 'file' && SCOPE_TEXT_FILE.test(entry.name)) {
        out.push({ file: path.slice(paper.root.length + 1), text: await $.fs.read(path), format: entry.name.toLowerCase().endsWith('.tex') ? 'latex' : 'markdown' })
      }
    }
  }
  await walk(join(paper.root, 'manuscript'), 0)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

export async function readPlan($: Engine, root: string): Promise<ScopePlan | null> {
  const path = join(root, SCOPE_FILE)
  if (!(await $.fs.exists(path))) return null
  const plan = parseScope(await $.fs.read(path))
  return isEmptyPlan(plan) ? null : plan
}

/** The scope's progress now, or null when the author has not set one. */
export async function measureScope($: Engine, paper: Paper, today: string): Promise<ScopeProgress | null> {
  const plan = await readPlan($, paper.root)
  if (plan === null) return null
  const check = await readCheck($, paper.root)
  return scopeProgress(plan, await readTextFiles($, paper), check?.points ?? {}, check?.ts, today)
}

/** /cowrite:scope check: which points the text makes. Logged; resolves a one-line summary. */
export async function checkPoints($: Engine, paper: Paper, model: string): Promise<string> {
  const plan = await readPlan($, paper.root)
  if (plan === null || plan.points.length === 0) return 'No points in scope.md yet: add them under "## Points", or run /cowrite:scope edit.'
  const files = await readTextFiles($, paper)
  if (files.every(f => f.text.trim() === '')) return 'The manuscript is still empty: nothing to check yet.'
  const list = plan.points.map((p, i) => `${i + 1}. ${p.text}${p.section ? ` (planned for: ${p.section})` : ''}`).join('\n')
  const prompt = `Planned points:\n${list}\n\nGoal of the paper: ${plan.goal || '(not given)'}\n\nManuscript:\n${numberedText(files)}`
  const answer = await $.model.complete({
    model,
    system: scopeCheckSystem(paper.language),
    prompt,
    maxTokens: 1500,
    effort: 'low',
    timeoutMs: 120_000,
  })
  if (!answer.isAnswered) return 'The point check failed; try again later.'
  const results = parseCheck(answer.text, plan.points.length)

  const id = newId()
  const ts = new Date(await $.clock.now()).toISOString()
  await appendLog($, paper.root, {
    type: 'prompt',
    id,
    ts,
    session: await $.session.id(),
    paper: paper.name,
    category: 'structure',
    origin: 'scope',
    text: `Scope check: which of ${plan.points.length} planned points the manuscript makes`,
  })
  await appendLog($, paper.root, {
    type: 'response',
    ref: id,
    ts,
    model,
    personas: [],
    tools_used: [],
    ai_text_flag: false,
    answer: results.map(r => `${r.n}. ${r.status}${r.where ? ` @ ${r.where}` : ''}${r.note ? `: ${r.note}` : ''}`).join('\n') || '(no result)',
  })

  const points: CheckFile['points'] = {}
  for (const r of results) points[plan.points[r.n - 1]!.text] = { status: r.status, where: r.where, note: r.note }
  await $.fs.write(join(paper.root, CHECK_FILE), `${JSON.stringify({ ts, model, points } satisfies CheckFile, null, 2)}\n`)
  const covered = results.filter(r => r.status === 'covered').length
  const partial = results.filter(r => r.status === 'partial').length
  return `🎯 Points: ${covered} covered, ${partial} partial, ${plan.points.length - covered - partial} missing · details in the Scope tab (/cowrite:pane scope)`
}

// ===== watch =====
// (was hooks/watch.ts: the directory reads $ only into functions declared in this file)

// Live review: while the author writes, a small model looks at the paragraphs
// they just changed and the watching personas leave short hints. A review runs
// once the author pauses, at most once a minute and 20 times an hour, and each
// one is logged like any other AI input.




export const TICK_MS = 5_000
export const PAUSE_MS = 20_000
const GAP_MS = 60_000
const PER_HOUR = 20
const KEEP_HINTS = 12

export const IDLE_WATCH: WatchState = {
  tokens: 0,
  isOn: false,
  personas: [],
  hints: [],
  status: 'off',
  lastReviewAt: 0,
  reviewTimes: [],
  isHidden: false,
}

export const watchAtom = atom({ plugin: 'cowrite', key: 'watch' } as const, IDLE_WATCH, { shape: 'watch-2' })

// What this module has seen of the manuscript; a reload starts a new baseline.
const seen = {
  texts: new Map<string, string>(),
  mtimes: new Map<string, number>(),
  dirty: new Set<string>(),
  lastEditAt: 0,
  isBusy: false,
}

export const resetWatchBaseline = () => {
  seen.texts.clear()
  seen.mtimes.clear()
  seen.dirty.clear()
  seen.lastEditAt = 0
  seen.isBusy = false
}


async function manuscriptFiles($: Engine, dir: string, depth: number): Promise<string[]> {
  if (depth > 4 || !(await $.fs.exists(dir))) return []
  const out: string[] = []
  for (const entry of await $.fs.list(dir)) {
    const path = join(dir, entry.name)
    if (entry.kind === 'dir') out.push(...(await manuscriptFiles($, path, depth + 1)))
    else if (entry.kind === 'file' && MANUSCRIPT_FILE.test(entry.name)) out.push(path)
  }
  return out
}

async function setStatus($: Engine, status: string): Promise<void> {
  await update($, watchAtom, s => ({ ...s, status }))
}

/** One look at the manuscript; resolves true when a review ran and was logged. */
export async function watchTick($: Engine, model: string): Promise<boolean> {
  const state = await read($, watchAtom)
  if (!state.isOn || seen.isBusy) return false
  const paper = await findPaper($)
  if (paper === null) return false
  const now = await $.clock.now()

  for (const path of await manuscriptFiles($, join(paper.root, 'manuscript'), 0)) {
    const { mtimeMs } = await $.fs.stat(path)
    const known = seen.mtimes.get(path)
    if (known === mtimeMs) continue
    seen.mtimes.set(path, mtimeMs)
    if (known === undefined || !seen.texts.has(path)) {
      seen.texts.set(path, await readText($, path).catch(() => '')) // the baseline: what was there when watching began
      continue
    }
    seen.dirty.add(path)
    seen.lastEditAt = now
  }

  if (seen.dirty.size === 0) return false
  if (now - seen.lastEditAt < PAUSE_MS) {
    if (state.status !== 'you are writing…') await setStatus($, 'you are writing…')
    return false
  }
  if (now - state.lastReviewAt < GAP_MS) return false
  const recent = state.reviewTimes.filter(t => now - t < 3_600_000)
  if (recent.length >= PER_HOUR) {
    await setStatus($, `paused: ${PER_HOUR} reviews in the last hour`)
    return false
  }

  seen.isBusy = true
  try {
    return await reviewChanges($, paper, state, model, now, recent)
  } finally {
    seen.isBusy = false
  }
}

async function reviewChanges($: Engine, paper: Paper, state: WatchState, model: string, now: number, recent: number[]): Promise<boolean> {
  const parts: { file: string; changed: Paragraph[] }[] = []
  for (const path of seen.dirty) {
    const after = await readText($, path).catch(() => null)
    if (after === null) continue // unreadable (pandoc missing, or a save half done): reviewed after the next save
    const changed = changedParagraphs(seen.texts.get(path) ?? '', after, paper.format)
    seen.texts.set(path, after)
    if (changed.length > 0) parts.push({ file: path.slice(paper.root.length + 1), changed })
  }
  seen.dirty.clear()
  if (parts.length === 0) return false

  const active = partyPersonas(paper.party)
  const personas = state.personas.flatMap(id => active.filter(p => p.id === id))
  if (personas.length === 0) return false
  const profilePath = join(paper.root, 'notes', 'ai', 'style-profile.md')
  const profile = (await $.fs.exists(profilePath)) ? (await $.fs.read(profilePath)).slice(0, 2000) : ''

  await update($, watchAtom, s => ({ ...s, status: 'reviewing…', lastReviewAt: now, reviewTimes: [...recent, now] }))
  const answer = await $.model.complete({
    model,
    system: watchSystem(personas, paper.language, profile, await readBriefs($, paper.root).catch(() => ({}))),
    prompt: watchExcerpt(parts),
    maxTokens: 700,
    effort: 'low',
    timeoutMs: 60_000,
  })
  if (!answer.isAnswered) {
    await setStatus($, 'the last live review failed; it will try again after your next change')
    return false
  }
  const used = answer.usage
  const spent = used.input_tokens + used.output_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
  await update($, watchAtom, s => ({ ...s, tokens: (s.tokens ?? 0) + spent }))
  const hints = parseHints(answer.text, personas.map(p => p.id))

  // Logged like every AI input: what was looked at, by whom, and what came back.
  const id = newId()
  const ts = new Date(now).toISOString()
  const ranges = parts
    .map(p => `${p.file} l.${p.changed[0]!.start}–${p.changed[p.changed.length - 1]!.end}`)
    .join(', ')
  await appendLog($, paper.root, {
    type: 'prompt',
    id,
    ts,
    session: await $.session.id(),
    paper: paper.name,
    category: personaById(hints[0]?.persona ?? '')?.category ?? 'feedback',
    origin: 'watch',
    text: `Live review (${personas.map(p => p.id).join(', ')}) of ${ranges}`,
  })
  await appendLog($, paper.root, {
    type: 'response',
    ref: id,
    ts,
    model,
    personas: [...new Set(hints.map(hint => hint.persona))],
    tools_used: [],
    ai_text_flag: false,
    answer: hints.length > 0 ? hints.map(hint => `${hint.persona} l.${hint.line}: ${hint.hint}`).join('\n') : '(no hints)',
  })

  const fileFor = (line: number) =>
    parts.find(p => p.changed.some(c => line >= c.start && line <= c.end))?.file ?? parts[0]!.file
  const fresh: LiveHint[] = hints.map(hint => ({ ref: id, persona: hint.persona, file: fileFor(hint.line), line: hint.line, text: hint.hint, ts }))
  const clock = localTime(ts, true)
  await update($, watchAtom, s => ({
    ...s,
    hints: [...fresh, ...s.hints].slice(0, KEEP_HINTS),
    status: hints.length > 0 ? `${plural(hints.length, 'hint')} at ${clock}` : `looked at ${clock}: nothing to add, keep writing`,
    isHidden: hints.length === 0 ? s.isHidden : false,
  }))
  return true
}

// ===== ui =====
// (was hooks/ui.tsx: the directory reads $ only into functions declared in this file)

// The CoWriting pane (party, feedback, live, log, scope, progress), the reminder band and the live-hint band.



type RenderInput = Parameters<Engine['ui']['resolve']>[0]

type PaneProps = {
  columns: number
  /** where the surface seated the pane: beside the transcript, or above the prompt sharing its room */
  placement: 'dock' | 'inline'
  snapshot: Snapshot
  tab: Tab
  personas: Persona[]
  isGame: boolean
  onTab: (tab: Tab) => void
  onSummon: (id: string) => void
  /** classifies a turn; the note, when given, goes into the log entry and the prompts appendix */
  onAnnotate: (ref: string, use: string, note?: string) => void
  onRefresh: () => void
  /** the AI input opened to read whole on the Feedback tab, if any */
  reading: Reading | null
  onOpen: (id: string) => void
  /** the badge on a persona's card: the Feedback tab, on that persona's newest open input */
  onOpenFor: (personaId: string) => void
  onCloseReading: () => void
  /** asks the model what the manuscript's diff since the opened turn shows */
  onSummarize: () => void
  /** the comment typed, or taken from the summary */
  onNote: (text: string, isTyped: boolean) => void
  /** starts a reply to the opened input in the prompt box */
  onReply: () => void
  /** asks the model what the persona should remember from this input and its discussion */
  onRemember: () => void
  /** the proposal as the author edits it in the field */
  onProposal: (text: string) => void
  /** writes the (edited) proposal into the persona's section of party.md */
  onRememberSave: () => void
  onRememberDiscard: () => void
  watch: WatchState
  onWatchToggle: () => void
  reviews: Review[]
  /** the usage line's parts; empty hides it */
  usage: string[]
  onScopeCheck: () => void
  onScopeEdit: () => void
}

// wide enough for "Terminologist 📋" and "Lv1 · asked 0×" with a gap to the next card
const CARD = 17
const SVG_SIZE = 44
// a sprite beside one line of text, for the list the pane shows inline above the prompt
const SVG_SMALL = 22
const USES = ['adopted', 'adapted', 'rejected', 'info'] as const
// One key per button while the pane holds the keyboard (/cowrite:pane focuses it).
const USE_HOTKEY: Readonly<Record<(typeof USES)[number], string>> = { adopted: 'a', adapted: 'd', rejected: 'x', info: 'i' }

/** Subagents don't report how far they are: the bar fills with each step and only completes when done. */
const reviewBar = (review: Review | undefined, width: number) => {
  const steps = review?.steps ?? 0
  const filled = review?.isDone ? width : Math.min(width - 1, Math.round(width * (1 - Math.exp(-steps / 6))))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const bar = (value: number, max: number, width: number) => {
  const filled = max <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function sprite($: Engine, e: RenderInput, persona: Persona, size = SVG_SIZE) {
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    const raster = rasterCells(persona)
    return <Raster key={`sprite-${persona.id}`} columns={raster.columns} rows={raster.rows} cells={raster.cells} />
  }
  if (e.surface === 'desktop' || e.surface === 'vscode') {
    const { Svg } = $.ui.resolve(e)
    return <Svg source={svgSource(persona)} alt={persona.name} width={size} height={size} />
  }
  return null
}

export function drawPane($: Engine, e: RenderInput, props: PaneProps) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { snapshot, tab } = props
  const columns = Math.max(CARD, props.columns)
  // Inline above the prompt (VS Code, the desktop app without a dock) the pane takes its rows from the
  // transcript, and the frame fits the tree: so the party is a short list with small sprites and the
  // help lines are folded into one. The terminal's inline pane keeps the grid, since a raster sprite
  // is eight rows tall either way.
  // A small terminal gets the same short forms: the pane's frame there holds only a few rows, and a
  // key must never decide on something those rows don't show.
  const screenRows = e.viewport?.rows ?? 40
  const isNarrow = props.columns < 70
  const isSmall = screenRows < 30 || isNarrow
  const isCompact = isSmall || (props.placement === 'inline' && e.surface !== 'terminal')

  if (snapshot.paper === null) {
    return (
      <Box flexDirection="column">
        <Text weight="bold">CoWriting</Text>
        <Text dimColor>No paper here yet. Open one with /cowrite:paper &lt;path&gt;</Text>
        <Text dimColor>(/cowrite:paper alone lists recent ones), or set one up with /cowrite:init.</Text>
      </Box>
    )
  }

  const { paper, stats, progress } = snapshot
  const tabs: Tab[] = props.isGame ? ['party', 'feedback', 'live', 'log', 'scope', 'progress'] : ['party', 'feedback', 'live', 'log', 'scope']
  const tabLabel = (t: Tab) =>
    t === 'party'
      ? 'Party'
      : t === 'feedback'
        ? stats.unannotated > 0 ? `Feedback (${stats.unannotated})` : 'Feedback'
        : t === 'live'
          ? props.watch.isOn ? 'Live 👁' : 'Live'
          : t === 'log'
            ? 'Log'
            : t === 'scope'
              ? snapshot.scope === null ? 'Scope' : `Scope ${pct(snapshot.scope.overall)}`
              : 'Progress'

  const header = (
    <Box flexDirection="column">
      {isSmall ? (
        <Text weight="bold">✍ {cut(paper.name, Math.max(16, columns - 6))}</Text>
      ) : (
        <Text weight="bold">
          ✍ {paper.name}{' '}
          <Text dimColor>
            · {paper.format} · {paper.language} · assist-only{paper.versioning === 'none' ? ' · no git' : ''}
          </Text>
        </Text>
      )}
      <Box flexDirection="row">
        {tabs.map((t, i) => (
          <Button
            key={`tab-${t}`}
            label={
              t === tab
                ? `▸ ${tabLabel(t)}`
                : !isNarrow
                  ? tabLabel(t)
                  : t === 'feedback' && stats.unannotated > 0
                    ? `${i + 1} (${stats.unannotated})`
                    : String(i + 1)
            }
            hotkey={String(i + 1)}
            variant={t === tab ? 'primary' : 'secondary'}
            onPress={() => props.onTab(t)}
          />
        ))}
        <Button key="refresh" label="↻" hotkey="r" onPress={props.onRefresh} />
      </Box>
      {!isCompact && <Text dimColor>Esc back to prompt</Text>}
      {props.usage.length > 0 && !isSmall && <Text dimColor>⏱ {props.usage.join(' · ')}</Text>}
    </Box>
  )

  if (tab === 'live') {
    const { watch } = props
    const names = watch.personas.map(id => personaById(id)?.name ?? id).join(', ')
    // one review's hints share a ref and are classified together; a classified review leaves the list
    const reviews: LiveHint[][] = []
    for (const hint of watch.hints) {
      const group = reviews.find(g => g[0]!.ref === hint.ref)
      if (group === undefined) reviews.push([hint])
      else group.push(hint)
    }
    return (
      <Box flexDirection="column">
        {header}
        <Text>
          {watch.isOn ? '👁 Watching your manuscript' : 'Live review is off'}
          {watch.status !== 'off' && <Text dimColor> · {watch.status}</Text>}
        </Text>
        {watch.isOn && <Text dimColor>Watching: {names}</Text>}
        {!isCompact && (
          <Text dimColor>
            Pause writing for about 20 s and the changed paragraphs get up to 3 short hints. Max one review a minute and 20 an
            hour. Every review is logged.
          </Text>
        )}
        <Button key="watch-toggle" label={watch.isOn ? 'Stop watching' : 'Start watching'} hotkey="w" onPress={props.onWatchToggle} />
        {watch.hints.length === 0 && <Text dimColor>No hints yet. Start with /cowrite:watch, then write.</Text>}
        {reviews.map((group, g) => (
          <Box key={`review-${group[0]!.ref}`} flexDirection="column">
            {group.map((hint, i) => (
              <Text key={`hint-${g}-${i}`} dimColor={g > 0}>
                <Text weight="bold">{personaById(hint.persona)?.name ?? hint.persona}</Text> <Text dimColor>{hint.file}:{hint.line}</Text> {hint.text}
              </Text>
            ))}
            <Box flexDirection="row">
              <Text dimColor>{g === 0 ? 'These hints: ' : `${localTime(group[0]!.ts)}: `}</Text>
              {USES.map(use => (
                <Button
                  key={`live-${group[0]!.ref}-${use}`}
                  label={USE_LABELS[use].button}
                  hotkey={g === 0 ? USE_HOTKEY[use] : undefined}
                  onPress={() => props.onAnnotate(group[0]!.ref, use)}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    )
  }

  if (tab === 'feedback' && props.reading !== null) {
    // too small to show the input and its choices: the reason is all that fits, and no key can decide
    if (screenRows < 20 || props.columns < 40) {
      return (
        <Box flexDirection="column">
          <Text color="warning">Make the window larger to read this and decide.</Text>
          <Button key="reading-back" label="← Back" hotkey="b" onPress={props.onCloseReading} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {header}
        {drawReading($, e, props.reading, props, isSmall)}
      </Box>
    )
  }

  if (tab === 'feedback') {
    const open = stats.open
    const width = Math.max(24, columns - 30)
    return (
      <Box flexDirection="column">
        {header}
        {snapshot.nudge !== null && <Text color="warning">🛡 {snapshot.nudge}</Text>}
        {open.length === 0 && <Text dimColor>Nothing open: every AI input is classified. Summon a persona from the Party tab, or ask Claude.</Text>}
        {open.length > 0 && (
          <Box flexDirection="column">
            {!isSmall && <Text weight="bold">Open one, read it, then say whether you used it in your own text</Text>}
            {open.map((turn, i) => (
              <Button key={`open-${turn.id}`} plain hotkey={i === 0 ? 'o' : undefined} onPress={() => props.onOpen(turn.id)}>
                <Text>
                  {turn.replyTo !== undefined ? '↳' : '•'} <Text weight="bold">{whoSaid(turn)}</Text>
                  <Text dimColor>
                    {' '}· {localTime(turn.ts)} · {turn.category}
                    {turn.replyTo !== undefined ? ' · answers your reply' : ''}
                    {turn.isAiText ? ' · [AI-TEXT]' : ''}
                  </Text>{' '}
                  {cut(turn.answer, width)}
                </Text>
              </Button>
            ))}
            {stats.unannotated > open.length && <Text dimColor>… and {stats.unannotated - open.length} more; the list shows the newest</Text>}
          </Box>
        )}
      </Box>
    )
  }

  if (tab === 'log') {
    const categories = Object.entries(stats.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} ${n}`)
      .join(' · ')
    return (
      <Box flexDirection="column">
        {header}
        <Text>
          AI turns: {stats.turns} (today {stats.today}) · unannotated:{' '}
          <Text color={stats.unannotated > 0 ? 'warning' : 'success'}>{stats.unannotated}</Text>
          {stats.unannotated > 0 && <Text dimColor> (on the Feedback tab)</Text>}
        </Text>
        {categories !== '' && <Text dimColor>{categories}</Text>}
        {stats.aiText > 0 && (
          <Text color="error">⚠ {plural(stats.aiText, 'answer')} with AI-written text: disclose {stats.aiText === 1 ? 'it' : 'them'}.</Text>
        )}
        {stats.recent.length === 0 && <Text dimColor>Nothing logged yet.</Text>}
        {stats.recent.length > 0 && <Text weight="bold">Recent</Text>}
        {stats.recent.map(r => (
          <Text key={`turn-${r.id}`} dimColor={!r.isOpen}>
            {r.isOpen ? '•' : '✓'} {localTime(r.ts)} [{r.category}]
            {r.isAiText ? ' [AI-TEXT]' : ''} {cut(r.preview, Math.max(30, columns - 24))}
          </Text>
        ))}
      </Box>
    )
  }

  if (tab === 'scope') {
    return (
      <Box flexDirection="column">
        {header}
        {drawScope($, e, snapshot.scope, columns, props.onScopeCheck, props.onScopeEdit)}
      </Box>
    )
  }

  if (tab === 'progress' && progress !== null) {
    const floor = xpForLevel(progress.level)
    return (
      <Box flexDirection="column">
        {header}
        <Text weight="bold">Level {progress.level}</Text>
        <Text>
          {bar(progress.xp - floor, progress.nextLevelXp - floor, Math.min(30, columns - 18))} {progress.xp} / {progress.nextLevelXp} XP
        </Text>
        <Text dimColor>
          Writing {progress.writerXp} XP ({progress.ownWords} own words) · Transparency {progress.integrityXp} XP
        </Text>
        <Text>🔥 Streak: {plural(progress.streak, 'day')}</Text>
        <Text weight="bold">Achievements</Text>
        {ACHIEVEMENTS.map(a => {
          const has = progress.game.achievements.includes(a.id)
          return (
            <Text key={`ach-${a.id}`} dimColor={!has}>
              {has ? '🏆' : '·'} {a.title} <Text dimColor>– {a.detail}</Text>
            </Text>
          )
        })}
        <Text dimColor>XP comes from your own words and from transparency, never from AI use.</Text>
      </Box>
    )
  }

  const perRow = Math.max(1, Math.floor(columns / CARD))
  const rows: Persona[][] = []
  for (let i = 0; i < props.personas.length; i += perRow) rows.push(props.personas.slice(i, i + perRow))

  const name = (p: Persona) => (
    <Button key={`summon-${p.id}`} plain onPress={() => props.onSummon(p.id)}>
      <Text weight="bold">
        {p.short}
        {snapshot.briefed.includes(p.id) ? ' 📋' : ''}
      </Text>
    </Button>
  )
  const standing = (p: Persona) => {
    const level = progress?.personaLevels[p.id] ?? 1
    const consults = stats.personaConsults[p.id] ?? 0
    const running = props.reviews.find(r => r.persona === p.id && !r.isDone)
    return running !== undefined ? (
      <Text color="warning">{reviewBar(running, 8)}</Text>
    ) : (
      <Text dimColor>
        {props.isGame ? `Lv${level} · ` : ''}asked {consults}×
      </Text>
    )
  }
  // how many of this persona's inputs wait to be classified; a press opens the newest on the Feedback tab
  const badge = (p: Persona) => {
    const open = stats.openByPersona[p.id] ?? 0
    if (open === 0) return null
    return (
      <Button key={`open-for-${p.id}`} plain onPress={() => props.onOpenFor(p.id)}>
        <Text color="warning"> ✉ {open}</Text>
      </Button>
    )
  }

  if (isCompact) {
    return (
      <Box flexDirection="column">
        {header}
        {props.personas.map(p => (
          <Box key={`card-${p.id}`} flexDirection="row">
            {sprite($, e, p, SVG_SMALL)}
            <Text> </Text>
            {name(p)}
            <Text dimColor> · </Text>
            {standing(p)}
            {badge(p)}
          </Box>
        ))}
        <Text dimColor>click a name to summon · ✉ open feedback · 📋 briefed · /cowrite:party changes who is here · Esc back to prompt</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text dimColor>click a name to summon · ✉ open feedback · 📋 briefed · /cowrite:party changes who is here</Text>
      {rows.map((row, i) => (
        <Box key={`row-${i}`} flexDirection="row">
          {row.map(p => (
            <Box key={`card-${p.id}`} flexDirection="column" width={CARD}>
              <Box flexDirection="row">
                {sprite($, e, p)}
                {badge(p)}
              </Box>
              {name(p)}
              {standing(p)}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

const pct = (n: number) => `${Math.round(n * 100)} %`
// the Scope tab's bar labels ("≈ Overall" is the longest) and a gap before the bar
const LABEL = 10

const POINT_ICON: Record<string, string> = { covered: '✓', partial: '◐', missing: '○' }
const pointIcon = (p: ScopePoint) => (p.isTicked ? '☑' : POINT_ICON[p.status ?? ''] ?? '·')

const countText = (label: string, c: Count) => (c.target === undefined ? `${label} ${c.done}` : `${label} ${c.done}/${c.target}`)

/** The Scope tab: the author's plan against what the manuscript has so far. */
function drawScope($: Engine, e: RenderInput, scope: ScopeProgress | null, columns: number, onCheck: () => void, onEdit: () => void) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const width = Math.max(10, Math.min(30, columns - 26))
  if (scope === null) {
    return (
      <Box flexDirection="column">
        <Text>No scope yet.</Text>
        <Text dimColor>
          Describe in scope.md what the paper should achieve: the goal, the points to make, words or pages, figures, tables,
          references, sections and the deadline. Then this tab shows how far you are.
        </Text>
        <Button key="scope-edit" label="Set the scope with me" hotkey="e" onPress={onEdit} />
      </Box>
    )
  }
  const covered = scope.points.filter(p => p.isTicked || p.status === 'covered').length
  const partial = scope.points.filter(p => !p.isTicked && p.status === 'partial').length
  const line = (label: string, value: number, note = '') => (
    <Text key={`scope-bar-${label}`}>
      {label.padEnd(LABEL)}
      {bar(value, 1, width)} {pct(value)}
      <Text dimColor>{note}</Text>
    </Text>
  )
  return (
    <Box flexDirection="column">
      {scope.goal !== '' && (
        <Text>
          🎯 <Text dimColor>{cut(scope.goal.replace(/\s+/g, ' '), Math.max(30, columns * 2 - 10))}</Text>
        </Text>
      )}
      {line('≈ Overall', scope.overall, ' estimate')}
      {line('Content', scope.content, ' points and quantities')}
      {scope.finish === null ? (
        <Text dimColor>{'Finish'.padEnd(LABEL)}set the stage of each section in scope.md (outline, draft, revised, final) for an estimate</Text>
      ) : (
        line('Finish', scope.finish, ` stages${scope.markers > 0 ? ` · ${scope.markers} open markers` : ''}`)
      )}
      <Text>
        {countText('Words', scope.words)} · {countText('Figures', scope.figures)} · {countText('Tables', scope.tables)} ·{' '}
        {countText('References', scope.references)}
      </Text>
      {scope.daysLeft !== undefined && (
        <Text color={scope.daysLeft < 0 ? 'error' : scope.daysLeft < 14 ? 'warning' : undefined}>
          ⏳ {scope.deadline}: {scope.daysLeft < 0 ? `${-scope.daysLeft} days past` : `${scope.daysLeft} days left`}
          {scope.wordsPerDay !== undefined && scope.wordsPerDay > 0 ? ` · ${scope.wordsPerDay} words a day to reach the target` : ''}
        </Text>
      )}
      {scope.points.length > 0 && (
        <Box flexDirection="column">
          <Text weight="bold">
            Points {covered}/{scope.points.length}
            {partial > 0 ? ` (+${partial} partial)` : ''}{' '}
            <Text dimColor>
              {scope.checkedAt === undefined ? '· not checked yet' : `· checked ${localTime(scope.checkedAt)}`}
            </Text>
          </Text>
          {scope.points.map((p, i) => (
            <Text key={`point-${i}`} dimColor={p.isTicked || p.status === 'covered'}>
              {pointIcon(p)} {cut(p.text, Math.max(30, columns - 24))}
              <Text dimColor>
                {p.where ? ` · ${p.where.replace(/^manuscript\//, '')}` : ''}
                {p.note && !p.isTicked ? ` · ${p.note}` : ''}
              </Text>
            </Text>
          ))}
        </Box>
      )}
      {scope.sections.length > 0 && (
        <Box flexDirection="column">
          <Text weight="bold">Sections</Text>
          {scope.sections.map((s, i) => (
            <Text key={`section-${i}`} dimColor={!s.isFound}>
              {cut(s.name, 16).padEnd(17)}
              {s.target === undefined ? `${s.words} words`.padEnd(12) : `${bar(s.words, s.target, 8)} ${s.words}/${s.target}`}
              <Text dimColor>
                {s.stage ? ` · ${s.stage}` : ''}
                {s.markers > 0 ? ` · ${s.markers} open` : ''}
                {!s.isFound ? ' · no heading yet' : ''}
              </Text>
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="row">
        <Button key="scope-check" label="Check points" hotkey="c" onPress={onCheck} />
        <Button key="scope-edit" label="Edit scope" hotkey="e" onPress={onEdit} />
      </Box>
      <Text dimColor>
        Counted without AI; points are checked by a small model on request (logged). ☑ ticked by you · ✓ covered · ◐ partial
        · ○ missing. Overall = 70 % content + 30 % finish, an estimate.
      </Text>
    </Box>
  )
}

const whoSaid = (turn: RecentTurn) => (turn.persona !== undefined ? personaById(turn.persona)?.name ?? turn.persona : 'Claude')

/**
 * One AI input opened whole: who said it, the four choices, a reply and the diff question, a comment field,
 * then what you asked and what it said, drawn as Markdown. Everything to press sits above the text, so a
 * long report (a persona's table of corrections) never pushes the choices out of a short pane.
 */
function drawReading($: Engine, e: RenderInput, reading: Reading, props: PaneProps, isSmall: boolean) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Markdown } = elements
  // a surface without a text field (none of the three here, but the table allows it) gets no comment
  const Input = 'Input' in elements ? elements.Input : null
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Button key="reading-back" label="← Back" hotkey="b" onPress={props.onCloseReading} />
        <Text>
          {' '}
          <Text weight="bold">{reading.who}</Text>
          <Text dimColor>
            {' '}· {localTime(reading.ts)} · {reading.category}
          </Text>
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        {USES.map(use => (
          <Button
            key={`use-${reading.id}-${use}`}
            label={USE_LABELS[use].button}
            hotkey={USE_HOTKEY[use]}
            onPress={() => props.onAnnotate(reading.id, use, typedNote)}
          />
        ))}
      </Box>
      {!isSmall && <Text dimColor>{USES.map(use => `${USE_LABELS[use].button} = ${USE_LABELS[use].meaning}`).join(' · ')}</Text>}
      <Box flexDirection="row">
        <Button key="reading-reply" label="Reply" hotkey="y" onPress={props.onReply} />
        <Button
          key="reading-summarize"
          label={reading.isSummarizing ? 'Reading your diff…' : 'What did I change since?'}
          hotkey="c"
          onPress={props.onSummarize}
        />
        {reading.persona !== '' && (
          <Button key="reading-remember" label={reading.isProposing ? 'Thinking…' : 'Remember'} hotkey="m" onPress={props.onRemember} />
        )}
      </Box>
      {reading.proposal !== '' && (
        <Box flexDirection="column">
          <Text weight="bold">What {reading.who} would keep in mind for this paper, in party.md once you save it:</Text>
          {Input !== null ? (
            <Input
              key={`remember-${reading.id}`}
              label="Briefing lines"
              value={reading.proposal}
              rows={3}
              onInput={(text: string) => props.onProposal(text)}
              onSubmit={(text: string) => props.onProposal(text)}
            />
          ) : (
            <Markdown text={reading.proposal} />
          )}
          <Box flexDirection="row">
            <Button key="remember-save" label="Save to party.md" hotkey="s" onPress={props.onRememberSave} />
            <Button key="remember-discard" label="Discard" onPress={props.onRememberDiscard} />
          </Box>
        </Box>
      )}
      {reading.summary !== '' && (
        <Box flexDirection="column">
          <Text weight="bold">Since then, by the model's reading of your diff:</Text>
          <Markdown text={reading.summary} />
          <Button key="reading-use-summary" label="Use as comment" hotkey="u" onPress={() => props.onNote(reading.summary, false)} />
        </Box>
      )}
      {Input !== null && (
        <Input
          key={`note-${reading.id}`}
          label="Comment"
          placeholder="optional: what you did with it, for the prompts appendix"
          value={reading.note}
          rows={2}
          onInput={(text: string) => props.onNote(text, true)}
          onSubmit={(text: string) => props.onNote(text, true)}
        />
      )}
      {reading.parent !== null && (
        <Box flexDirection="row">
          <Text dimColor>↳ in the thread on </Text>
          <Button key={`thread-${reading.parent.id}`} plain onPress={() => props.onOpen(reading.parent!.id)}>
            <Text color="info">
              {reading.parent.who}'s feedback from {localTime(reading.parent.ts)}
            </Text>
          </Button>
        </Box>
      )}
      {reading.replies.length > 0 && (
        <Box flexDirection="row">
          <Text dimColor>↳ {reading.replies.length === 1 ? 'one answer to your reply: ' : `${reading.replies.length} answers to your replies: `}</Text>
          {reading.replies.map(r => (
            <Button key={`thread-${r.id}`} plain onPress={() => props.onOpen(r.id)}>
              <Text color="info">
                {r.who} at {localTime(r.ts)}{' '}
              </Text>
            </Button>
          ))}
        </Box>
      )}
      <Text dimColor>you asked: {reading.asked}</Text>
      <Text weight="bold">it said:</Text>
      <Markdown text={reading.text} />
      {reading.reply !== '' && (
        <Box flexDirection="column">
          <Text weight="bold">Claude then said:</Text>
          <Markdown text={reading.reply} dimColor />
        </Box>
      )}
    </Box>
  )
}

/** Claude Code's own step, as one dim line (calm) or nothing (focus). */
export function drawToolLine($: Engine, e: RenderInput, props: { label: string; isRunning: boolean; isHidden: boolean }) {
  const { Box, Text } = $.ui.resolve(e)
  if (props.isHidden) return <Box />
  return (
    <Text dimColor>
      · {props.label}
      {props.isRunning ? ' …' : ''}
    </Text>
  )
}

/** The turn's closing line while personas are still at work. */
export function drawWaiting($: Engine, e: RenderInput, names: readonly string[]) {
  const { Text } = $.ui.resolve(e)
  return <Text dimColor>⏳ waiting for {names.join(', ')}…</Text>
}

type ReviewRowProps = { persona: Persona; review: Review | undefined; isFailed: boolean }

/** A persona's Agent call in the transcript: one line with a progress bar. */
export function drawReviewRow($: Engine, e: RenderInput, props: ReviewRowProps) {
  const { Box, Text } = $.ui.resolve(e)
  const { persona, review, isFailed } = props
  const steps = review?.steps ?? 0
  const status = isFailed ? 'stopped' : review?.isDone ? `done · ${steps} steps` : `${steps} steps · ${review?.lastStep ?? 'starting'}`
  return (
    <Box flexDirection="row">
      <Text>
        🎭 <Text weight="bold">{persona.name}</Text>{' '}
      </Text>
      <Text color={isFailed ? 'error' : review?.isDone ? 'success' : 'warning'}>{reviewBar(review, 12)}</Text>
      <Text dimColor> {status}</Text>
    </Box>
  )
}

type LiveBandProps = {
  watch: WatchState
  onAnnotate: (ref: string, use: string) => void
  onHide: () => void
}

/** The newest live hints, above the prompt, where the author looks between sentences. */
export function drawLiveBand($: Engine, e: RenderInput, props: LiveBandProps) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const ref = props.watch.hints[0]?.ref
  const latest = props.watch.hints.filter(one => one.ref === ref)
  return (
    <Box flexDirection="column">
      {latest.map((hint, i) => (
        <Text key={`band-hint-${i}`}>
          👁 <Text weight="bold">{personaById(hint.persona)?.name ?? hint.persona}</Text> <Text dimColor>{hint.file}:{hint.line}</Text> {hint.text}
        </Text>
      ))}
      <Box flexDirection="row">
        {ref !== undefined &&
          USES.map(use => (
            <Button key={`band-live-${use}`} label={USE_LABELS[use].button} onPress={() => props.onAnnotate(ref, use)} />
          ))}
        <Button key="band-live-hide" label="Hide" role="dismiss" onPress={props.onHide} />
      </Box>
    </Box>
  )
}

type BandProps = {
  snapshot: Snapshot
  onAnnotate: (ref: string, use: string) => void
  onHide: () => void
}

export function drawBand($: Engine, e: RenderInput, props: BandProps) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { stats } = props.snapshot
  const open = stats.open[0]
  const message = props.snapshot.lastWasAiText
    ? 'The last answer contains AI-written text: it is logged for your disclosure.'
    : props.snapshot.nudge ?? `${plural(stats.unannotated, 'AI input')} to classify.`
  return (
    <Box flexDirection="column">
      <Text color="warning">🛡 {message}</Text>
      {open !== undefined && (
        <Text>
          {'   '}Did you use this in your text? <Text weight="bold">{whoSaid(open)}:</Text>{' '}
          <Text dimColor>“{cut(open.answer, 100)}”</Text>
        </Text>
      )}
      <Box flexDirection="row">
        {open !== undefined &&
          USES.map(use => (
            <Button key={`band-${use}`} label={USE_LABELS[use].button} onPress={() => props.onAnnotate(open.id, use)} />
          ))}
        <Button key="band-hide" label="Hide" role="dismiss" onPress={props.onHide} />
      </Box>
    </Box>
  )
}

// ===== register =====
// (was hooks/register.tsx: the directory reads $ only into functions declared in this file)


const PANE = 'cowriting'
const CONTRACT_SECTION = 'cowriting-contract'

const EMPTY_SNAPSHOT: Snapshot = {
  paper: null,
  stats: EMPTY_STATS,
  progress: null,
  nudge: null,
  lastWasAiText: false,
  briefed: [],
  scope: null,
}

export const snapshotAtom = atom({ plugin: 'cowrite', key: 'snapshot' } as const, EMPTY_SNAPSHOT, {
  shape: 'snapshot-4',
})
export const tabAtom = atom({ plugin: 'cowrite', key: 'tab' } as const, 'party' as Tab)
export const bandHiddenAtom = atom({ plugin: 'cowrite', key: 'isBandHidden' } as const, false)
const focusAtom = atom({ plugin: 'cowrite', key: 'focus' } as const, null as FocusMode | null)
const usageAtom = atom({ plugin: 'cowrite', key: 'usage' } as const, EMPTY_USAGE as Usage, { shape: 'usage-1' })
const FOCUS_MODES: readonly FocusMode[] = ['off', 'calm', 'focus']
const reviewsAtom = atom({ plugin: 'cowrite', key: 'reviews' } as const, {} as Record<string, Review>, { shape: 'reviews-1' })

/** For a paper opened by path: the session's folder is somewhere else. */
const elsewhereText = (root: string) =>
  `The paper folder is ${root}, not the session's working directory. Paths like manuscript/ or ai-log/ are relative to it: ` +
  `use absolute paths under ${root} for file tools, and run shell commands and CoWriting tools from it (cd "${root}" && …).`

const contractText = (paper: Paper, vault: string, notesFolder: string, cwd: string) =>
  [
    '# CoWriting: assist-only mode',
    `Active paper: "${paper.name}" (${paper.format}, ${paper.language === 'de' ? 'German' : 'English'}) at ${paper.root}.`,
    paper.root !== cwd ? elsewhereText(paper.root) : '',
    'The human is the sole author (DFG good scientific practice). You assist; you never ghostwrite.',
    '- Never write or rewrite prose meant for the manuscript (no paragraphs, rephrasings, abstracts, introductions). Files under manuscript/ are read-only for you.',
    '- Inside the paper you write only in notes/ai/, scope.md, disclosure/, party/ (the author\'s own review experts, at their request) and the log. Every other file (manuscript/, literature/, CLAUDE.md, party.md, paper.json, settings) is the author\'s: ask them to change it.',
    `- The review party of this paper: ${partyPersonas(paper.party).map(p => `cowrite:${p.id} (${p.name})`).join(', ') || 'nobody yet'}. /cowrite:party changes it; a party/<id>.md file is an expert of the author's own.`,
    '- Give located feedback (file:line), Socratic questions, structure and argument critique, explanations, literature help, checklists and overviews.',
    '- Language exception: for grammar, spelling and punctuation you may show the corrected sentence together with the rule. No stylistic rewrites.',
    `- If the author explicitly insists on text written by you, start that text with ${AI_TEXT_MARKER} and remind them it must be disclosed.`,
    '- Never invent references. Cite only with a verified DOI/URL or a citekey present in the bibliography under literature/; mark anything else UNVERIFIED.',
    '- Label literature summaries as "AI summary – read the original". No direct quotes without page numbers from the source.',
    '- Put AI notes only in notes/ai/ (header: "AI-generated (Claude), <date>, not manuscript text").',
    vault !== ''
      ? `- Obsidian vault at ${vault}: read it as the author's knowledge base and cite their notes as [[note]]. Write only into ${vault}/${notesFolder}/${paper.name}/ with frontmatter ai_generated: true.`
      : '',
    '- After substantial help, remind the author to annotate it (/cowrite:annotate).',
    `- Reply in the author's language; give manuscript feedback in the manuscript's language (${paper.language}).`,
  ]
    .filter(Boolean)
    .join('\n')

type Config = {
  vault: string
  notesFolder: string
  isGame: boolean
  watchModel: string
  focus: FocusMode
  meter: 'off' | 'tokens' | 'tokens+limits'
  isAutosave: boolean
}

// Per-turn bookkeeping; a reload loses only the turn in flight.
let model = 'unknown'
let turn: { id: string; personas: Set<string>; tools: Set<string>; agents: Record<string, string> } | null = null
const unanswered: NonNullable<typeof turn>[] = []
// agentId → persona id of the subagents launched as personas; the log keeps it across reloads
const spawned = new Map<string, string>()
let watchTimer: { cancel: () => void } | null = null
let autosaveTimer: { cancel: () => void } | null = null

async function refresh($: Engine, cfg: Config, isTurnEnd = false, lastWasAiText = false): Promise<Snapshot> {
  const found = await findPaper($)
  if (found === null) {
    await update($, snapshotAtom, () => EMPTY_SNAPSHOT)
    $.ui.status(undefined)
    return EMPTY_SNAPSHOT
  }
  // the paper's own experts join its party once they are loaded
  await loadParty($, found.root).catch(() => [])
  const paper = (await findPaper($)) ?? found
  const stats = computeStats(await readLog($, paper.root), new Date())
  let progress = null
  if (cfg.isGame) {
    const previous = await readGame($, paper.root)
    const counts = await readToolCounts($, paper.root)
    const words = await manuscriptWords($, paper)
    progress = advanceGame({ ...previous, ...counts }, words, stats, new Date().toISOString().slice(0, 10))
    if (JSON.stringify(progress.game) !== JSON.stringify(previous)) {
      await writeGame($, paper.root, progress.game).catch(() => undefined)
    }
    if (isTurnEnd || progress.unlocked.length > 0) {
      for (const a of progress.unlocked) $.ui.toast(`🏆 Achievement unlocked: ${a.title}`)
    }
  }
  const snapshot: Snapshot = {
    paper,
    stats,
    progress,
    nudge: overrelianceNudge(stats) ?? null,
    lastWasAiText,
    briefed: Object.keys(await readBriefs($, paper.root).catch(() => ({}))),
    scope: await measureScope($, paper, new Date().toISOString().slice(0, 10)).catch(() => null),
  }
  await update($, snapshotAtom, () => snapshot)
  await showStatus($, cfg)
  return snapshot
}

async function showStatus($: Engine, cfg: Config): Promise<void> {
  const { paper, progress, stats, scope } = await read($, snapshotAtom)
  if (paper === null) return $.ui.status(undefined)
  const parts = [`✍ ${paper.name}`, 'assist-only']
  if (scope !== null) parts.push(`🎯 ${Math.round(scope.overall * 100)} %`)
  if (progress !== null) parts.push(`Lv${progress.level}`)
  if (stats.unannotated > 0) parts.push(`${stats.unannotated} to classify`)
  if ((await read($, watchAtom)).isOn) parts.push('👁 live')
  parts.push(...usageShort(await read($, usageAtom), cfg.meter))
  $.ui.status(parts.join(' · '))
}

async function measure($: Engine, cfg: Config, latest: Usage): Promise<void> {
  const before = await read($, usageAtom)
  await update($, usageAtom, () => latest)
  const alert = cfg.meter === 'tokens+limits' ? limitCrossed(before.limits, latest.limits) : undefined
  if (alert !== undefined) $.ui.toast(`⚠ ${alert}`)
  await showStatus($, cfg)
}

async function focusMode($: Engine, cfg: Config): Promise<FocusMode> {
  return (await read($, focusAtom)) ?? cfg.focus
}

async function annotate($: Engine, cfg: Config, ref: string, use: string, note = '', isShown = true): Promise<void> {
  const snapshot = await read($, snapshotAtom)
  if (snapshot.paper === null) return
  const root = snapshot.paper.root
  const comment = note.trim()
  // the tool appends to the same file the hooks write: one writer at a time
  const ran = await withLog(root, () =>
    $.process.run(['python3', `${$.plugin.root}/tools/ailog.py`, 'annotate', ref, '--use', use, ...(comment === '' ? [] : ['--note', comment])], { cwd: root }),
  )
  // a proposal's own annotation (what the author did with it) is bookkeeping, not news
  if (isShown || ran.exitCode !== 0) $.ui.toast(ran.exitCode === 0 ? `Annotated as ${use}` : `Annotation failed: ${ran.stderr.slice(0, 80)}`)
  if (ran.exitCode === 0) {
    // a classified review's hints leave the Live tab and the band; the opened turn closes
    await update($, watchAtom, s => (s.hints.some(h => h.ref === ref) ? { ...s, hints: s.hints.filter(h => h.ref !== ref) } : s))
    await update($, readingAtom, s => (s.open?.id === ref ? NO_READING : s))
    if ((await read($, readingAtom)).open === null) typedNote = ''
  }
  await refresh($, cfg)
}

// ===== reading one AI input whole =====

const NO_READING: ReadingState = { open: null }
const readingAtom = atom({ plugin: 'cowrite', key: 'reading' } as const, NO_READING, { shape: 'reading-3' })
// What the comment field holds as typed: kept outside the atom so a keystroke redraws nothing.
let typedNote = ''

/** Opens a logged turn on the Log tab: the whole answer, as a person reads it. */
async function openTurn($: Engine, id: string): Promise<void> {
  const snapshot = await read($, snapshotAtom)
  if (snapshot.paper === null) return
  const entries = await readLog($, snapshot.paper.root)
  const prompt = entries.find(e => e.type === 'prompt' && e.id === id)
  const response = entries.find(e => e.type === 'response' && e.ref === id)
  if (prompt?.type !== 'prompt' || response?.type !== 'response') return
  const turn = snapshot.stats.open.find(t => t.id === id) ?? snapshot.stats.recent.find(t => t.id === id)
  const persona = prompt.agent ?? response.personas[0]
  const isReport = prompt.origin === 'agent'
  const prompts = entries.filter((x): x is PromptEntry => x.type === 'prompt')
  const byId = (ref: string | undefined) => (ref === undefined ? undefined : prompts.find(x => x.id === ref))
  const link = (p: PromptEntry): ThreadLink => {
    const who = p.agent ?? entries.find(x => x.type === 'response' && x.ref === p.id && x.personas[0] !== undefined)
    const name = typeof who === 'string' ? who : who?.type === 'response' ? who.personas[0] : undefined
    return { id: p.id, ts: p.ts, who: name !== undefined ? personaById(name)?.name ?? name : 'Claude' }
  }
  // the thread: a persona's answer sits behind the author's reply, which sits behind the feedback;
  // Claude's own answer to a reply is that reply's turn itself
  const authorReply = isReport ? byId(prompt.replyTo) : prompt.replyTo !== undefined ? prompt : undefined
  const parent = byId(authorReply?.replyTo)
  const replies = prompts
    .filter(p => p.replyTo === id && p.origin === undefined)
    .map(r => prompts.find(p => p.replyTo === r.id && p.origin === 'agent') ?? r)
    .filter(p => entries.some(x => x.type === 'response' && x.ref === p.id))
    .map(link)
  typedNote = ''
  // for Remember: the discussion this input closes (the feedback it answers and the author's reply) and the persona's brief
  const feedbackText = parent === undefined ? '' : readable(parent.origin === 'agent' ? parent.text : (entries.find(x => x.type === 'response' && x.ref === parent.id) as { answer?: string } | undefined)?.answer ?? '')
  const thread = authorReply === undefined || parent === undefined ? null : { feedback: feedbackText, reply: replyWords(authorReply.text) }
  const brief = persona === undefined ? '' : ((await readBriefs($, snapshot.paper.root).catch(() => ({}) as Record<string, string>))[persona] ?? '')
  const open: Reading = {
    id,
    ts: prompt.ts,
    category: turn?.category ?? prompt.category,
    who: persona !== undefined ? personaById(persona)?.name ?? persona : 'Claude',
    persona: persona ?? '',
    parent: parent === undefined ? null : link(parent),
    replies,
    brief,
    thread,
    proposal: '',
    proposed: '',
    proposalRef: '',
    isProposing: false,
    asked:
      authorReply !== undefined
        ? `your reply: ${replyWords(authorReply.text) || '(no text)'}`
        : isReport
          ? 'its report on your text'
          : readable(prompt.text) || '(no text)',
    text: (isReport ? readable(prompt.text) : readable(response.answer)) || '(no text)',
    reply: isReport ? readable(response.answer) : '',
    note: '',
    summary: '',
    isSummarizing: false,
  }
  await update($, readingAtom, () => ({ open }))
}

/** The badge on a persona's card: the Feedback tab, opened on that persona's newest open input. */
async function openFor($: Engine, personaId: string): Promise<void> {
  await update($, tabAtom, () => 'feedback')
  const { stats } = await read($, snapshotAtom)
  const turn = stats.open.find(t => t.persona === personaId)
  if (turn !== undefined) await openTurn($, turn.id)
}

/**
 * Reply: the opened input's address goes into the prompt box, after whatever is drafted there, and the
 * author types the reply itself. A persona's answer comes through its agent, as a summon does; Claude's
 * own answer is continued in the chat. Nothing is sent until the author presses Enter.
 */
async function replyTo($: Engine): Promise<void> {
  const reading = (await read($, readingAtom)).open
  if (reading === null) return
  const when = `${reading.category} feedback from ${localTime(reading.ts)}, log entry ${reading.id}`
  const text =
    reading.persona === ''
      ? `About your ${when}: `
      : `Reply to ${reading.who} (the cowrite:${reading.persona} agent) on its ${when}. ` +
        'Hand it the feedback and my reply, relay its answer as given, no rewritten text. My reply: '
  const filled = await $.prompt.fill({ text, mode: 'append' })
  $.ui.toast(filled.isFilled ? 'Your reply starts in the prompt box: type it and press Enter.' : 'No prompt box to write the reply into.')
}

/** The address line `replyTo` writes, read back when the author sends it: which entry, and whose agent (or '' for Claude). */
const REPLY_ADDRESS = /^(?:Reply to |About your )[^\n]*?\blog entry ([A-Za-z0-9_-]+)\b/
const REPLY_AGENT = /\(the cowrite:([a-z0-9-]+) agent\)/

function replyAddress(text: string): { ref: string; persona: string } | null {
  const ref = REPLY_ADDRESS.exec(text)?.[1]
  if (ref === undefined) return null
  return { ref, persona: REPLY_AGENT.exec(text)?.[1] ?? '' }
}

/** The author's words behind the address line: what the persona was asked. */
function replyWords(text: string): string {
  const cut = text.indexOf('My reply: ')
  if (cut >= 0) return text.slice(cut + 'My reply: '.length).trim()
  const colon = text.indexOf(': ')
  return (colon >= 0 ? text.slice(colon + 2) : text).trim()
}

/** The reply the author sent last, waiting for the persona's answer; a hand-back from that persona closes it. */
let pendingReply: { ref: string; persona: string } | null = null

/**
 * Remember: the model distils the input and its discussion into at most two briefing lines for the
 * persona. They are shown in a field, logged as AI input of their own, and written to party.md only
 * when the author saves them; the annotation on the logged turn says what the author did with them.
 */
async function rememberFrom($: Engine, cfg: Config): Promise<void> {
  const reading = (await read($, readingAtom)).open
  const snapshot = await read($, snapshotAtom)
  if (reading === null || reading.persona === '' || reading.isProposing || snapshot.paper === null) return
  const paper = snapshot.paper
  const persona = personaById(reading.persona)
  const patch = async (change: Partial<Reading>): Promise<void> => {
    await update($, readingAtom, s => (s.open === null || s.open.id !== reading.id ? s : { open: { ...s.open, ...change } }))
  }
  await patch({ isProposing: true })
  const model = cfg.watchModel
  const answer = await $.model
    .complete({
      model,
      system: briefProposalSystem(paper.language),
      prompt: briefProposalPrompt({
        persona: reading.who,
        role: persona?.role ?? '',
        brief: reading.brief,
        feedback: reading.thread?.feedback ?? reading.text,
        reply: reading.thread?.reply ?? '',
        answer: reading.thread === null ? '' : reading.text,
        comment: typedNote.trim(),
      }),
      maxTokens: 300,
      effort: 'low',
      timeoutMs: 60_000,
    })
    .catch(() => null)
  if (answer === null || !answer.isAnswered) {
    await patch({ isProposing: false })
    $.ui.toast('The proposal failed; try again later.')
    return
  }
  const lines = briefLines(answer.text)
  const id = newId()
  const ts = new Date(await $.clock.now()).toISOString()
  await appendLog($, paper.root, {
    type: 'prompt',
    id,
    ts,
    session: await $.session.id(),
    paper: paper.name,
    category: 'brief-update',
    origin: 'brief',
    agent: reading.persona,
    text: `Briefing proposal: what ${reading.who} should remember from its input ${reading.id}${reading.thread === null ? '' : ' and the discussion on it'}, for party.md`,
  })
  await appendLog($, paper.root, {
    type: 'response',
    ref: id,
    ts,
    model,
    personas: [reading.persona],
    tools_used: [],
    ai_text_flag: false,
    answer: answer.text.trim() || '(no text)',
  })
  if (lines === '') {
    await patch({ isProposing: false })
    $.ui.toast(`${reading.who} found nothing to remember from this exchange.`)
    await annotate($, cfg, id, 'info', 'nothing to remember', false)
    return
  }
  await patch({ isProposing: false, proposal: lines, proposed: lines, proposalRef: id })
  await refresh($, cfg)
}

/** The field's text, as the author edits the proposal. */
async function setProposal($: Engine, text: string): Promise<void> {
  await update($, readingAtom, s => (s.open === null ? s : { open: { ...s.open, proposal: text } }))
}

/** Save: the lines go under the persona's heading in party.md; the logged proposal is annotated with what was written. */
async function saveRemembered($: Engine, cfg: Config): Promise<void> {
  const reading = (await read($, readingAtom)).open
  const snapshot = await read($, snapshotAtom)
  if (reading === null || reading.persona === '' || reading.proposal.trim() === '' || snapshot.paper === null) return
  const lines = briefLines(reading.proposal) || reading.proposal.trim()
  await appendBriefLines($, snapshot.paper.root, reading.persona, lines)
  await update($, readingAtom, s => (s.open === null || s.open.id !== reading.id ? s : { open: { ...s.open, proposal: '', proposed: '', proposalRef: '', brief: s.open.brief === '' ? lines : `${s.open.brief}\n${lines}` } }))
  $.ui.toast(`📋 ${reading.who} will keep that in mind: party.md`)
  if (reading.proposalRef !== '') await annotate($, cfg, reading.proposalRef, lines === reading.proposed ? 'adopted' : 'adapted', lines, false)
  await refresh($, cfg)
}

/** Discard: nothing is written; the logged proposal is annotated as rejected. */
async function discardRemembered($: Engine, cfg: Config): Promise<void> {
  const reading = (await read($, readingAtom)).open
  if (reading === null || reading.proposal === '') return
  await update($, readingAtom, s => (s.open === null || s.open.id !== reading.id ? s : { open: { ...s.open, proposal: '', proposed: '', proposalRef: '' } }))
  if (reading.proposalRef !== '') await annotate($, cfg, reading.proposalRef, 'rejected', '', false)
}

/** The comment: typed into the field, or taken from the summary (then the field is redrawn with it). */
async function setNote($: Engine, text: string, isTyped: boolean): Promise<void> {
  typedNote = text
  if (!isTyped) await update($, readingAtom, s => (s.open === null ? s : { open: { ...s.open, note: text } }))
}

/**
 * What the manuscript's diff since the opened turn shows, in the model's words: from the autosave commit
 * before the turn to the working tree. Logged like any AI input; it describes, the author classifies.
 */
async function summarizeChanges($: Engine, cfg: Config): Promise<void> {
  const reading = (await read($, readingAtom)).open
  const snapshot = await read($, snapshotAtom)
  if (reading === null || reading.isSummarizing || snapshot.paper === null) return
  const paper = snapshot.paper
  const setSummary = async (summary: string, isSummarizing = false): Promise<void> => {
    await update($, readingAtom, s => (s.open === null || s.open.id !== reading.id ? s : { open: { ...s.open, summary, isSummarizing } }))
  }
  if (paper.versioning === 'none') {
    return setSummary(
      'This paper is set up without git, so there is no saved version to compare. /cowrite:paper versioning git switches versioning on; from the next writing pause on, the manuscript is saved after each change.',
    )
  }
  await setSummary('', true)
  const before = await git($, paper, ['log', '-1', '--format=%H', `--before=${reading.ts}`, '--', 'manuscript'])
  const sha = before.stdout.trim()
  if (before.exitCode !== 0 || sha === '') {
    return setSummary('No saved version of the manuscript from before this feedback: autosave was off, or nothing had been committed yet.')
  }
  const diff = await git($, paper, ['diff', sha, '--', 'manuscript'])
  if (diff.exitCode !== 0) return setSummary(`git diff failed: ${diff.stderr.trim().slice(0, 100)}`)
  if (diff.stdout.trim() === '') return setSummary('The manuscript has not changed since this feedback.')
  const model = cfg.watchModel
  const answer = await $.model
    .complete({
      model,
      system: changeSummarySystem(paper.language),
      prompt: changeSummaryPrompt(reading.text, cutDiff(diff.stdout)),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 60_000,
    })
    .catch(() => null)
  if (answer === null || !answer.isAnswered) return setSummary('The summary failed; try again later.')
  const summary = answer.text.trim() || '(no text)'
  const id = newId()
  const ts = new Date(await $.clock.now()).toISOString()
  await appendLog($, paper.root, {
    type: 'prompt',
    id,
    ts,
    session: await $.session.id(),
    paper: paper.name,
    category: 'change-summary',
    origin: 'summary',
    text: `Change summary: what the manuscript's diff since ${localTime(reading.ts)} (${reading.who}'s input ${reading.id}) shows, ${diff.stdout.length} characters of diff`,
  })
  await appendLog($, paper.root, {
    type: 'response',
    ref: id,
    ts,
    model,
    personas: [],
    tools_used: ['git diff'],
    ai_text_flag: false,
    answer: summary,
  })
  await setSummary(summary)
  await refresh($, cfg)
}

/** A change to the author's files during a tool call: logged, shown, and from then on in the disclosure. */
/** Refuse a tool call and keep a record of it: what was tried belongs in the log even though nothing changed. */
async function refuse($: Engine, tool: string, input: Readonly<Record<string, unknown>>, message: string): Promise<{ deny: string }> {
  if (turn !== null) turn.tools.add(tool)
  const paper = await findPaper($).catch(() => null)
  if (paper !== null) {
    await appendLog($, paper.root, {
      type: 'guard',
      refused: true,
      ts: new Date().toISOString(),
      session: await $.session.id(),
      paper: paper.name,
      ...(turn !== null ? { ref: turn.id } : {}),
      tool,
      input: guardInputOf(tool, input).split(`${paper.root}/`).join(''), // the disclosure doesn't need the author's home folder
      files: [],
    }).catch(() => undefined)
  }
  return { deny: message }
}

async function reportGuard($: Engine, cfg: Config, paper: Paper, tool: string, input: string, files: string[], message?: string): Promise<void> {
  await appendLog($, paper.root, {
    type: 'guard',
    ts: new Date().toISOString(),
    session: await $.session.id(),
    paper: paper.name,
    ...(turn !== null ? { ref: turn.id } : {}),
    tool,
    input,
    files,
  }).catch(() => undefined)
  $.ui.toast(message ?? `⚠ ${files.join(', ')} changed while ${tool} ran. Logged; ${paper.versioning === 'none' ? 'check the file' : 'check git diff'}.`)
  await update($, bandHiddenAtom, () => false)
  await refresh($, cfg).catch(() => undefined)
}

/** The plugin's version from its manifest, and the engine's, for the log. */
async function readVersions($: Engine): Promise<{ plugin?: string; claude_code?: string }> {
  const out: { plugin?: string; claude_code?: string } = {}
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }
    if (typeof manifest.version === 'string') out.plugin = manifest.version
  } catch {
    // no manifest to read: the entry goes without
  }
  const engine = await $.session.version().catch(() => null)
  if (engine !== null) out.claude_code = engine.version
  return out
}

/**
 * Submits a prompt for the author and logs it. The engine passes a prompt this plugin submits to
 * every plugin's prompt.submit hook but this one's, so it opens its own turn here: that is where a
 * persona launched by it is counted.
 */
async function submitAsAuthor($: Engine, cfg: Config, text: string, category: string, command: string): Promise<void> {
  const paper = await findPaper($)
  if (paper !== null) {
    const id = newId()
    turn = { id, personas: new Set(), tools: new Set(), agents: {} }
    await appendLog($, paper.root, {
      type: 'prompt',
      id,
      ts: new Date().toISOString(),
      session: await $.session.id(),
      paper: paper.name,
      category,
      command,
      text,
    }).catch(() => undefined)
  }
  void $.prompt.submit({ text })
}

async function summon($: Engine, cfg: Config, personaId: string, target: string): Promise<string> {
  const persona = personaById(personaId)
  if (persona === undefined) return `Unknown persona "${personaId}".`
  const what = target === '' ? 'the section I am currently working on (ask me which, if unclear)' : target
  const text =
    `Use the cowrite:${persona.id} agent to review ${what}. ` +
    'Relay its hints and questions as given; do not add rewritten text.'
  await submitAsAuthor($, cfg, text, persona.category, 'summon')
  return `${persona.name} joins the review…`
}

const KEEP_REVIEWS = 20

/** /cowrite:party: who is in this paper's party, and the changes to it; `{ args }` hands a new expert to the skill's interview. */
async function partyCommand($: Engine, cfg: Config, paper: Paper, verb: string, words: string[]): Promise<string | { args: string }> {
  const broken = await loadParty($, paper.root).catch(() => [])
  const party = (await findPaper($))?.party ?? paper.party
  const members = partyPersonas(party)
  const catalog = party.filter(id => PERSONAS.some(p => p.id === id))
  if (verb === '' || verb === 'list') {
    const line = (p: { id: string; name: string; role: string; source: string }) =>
      `${p.source === 'custom' ? '★' : '✓'} ${p.id} · ${p.name}: ${p.role}`
    const bench = PERSONAS.filter(p => !party.includes(p.id))
    return [
      `Your review party (${members.length}): ★ your own experts (party/<id>.md)`,
      ...members.map(line),
      ...(bench.length > 0 ? ['Not in the party:', ...bench.map(p => `· ${p.id} · ${p.name}: ${p.role}`)] : []),
      ...(broken.length > 0 ? [`Not a persona (missing name, role or text): ${broken.map(id => `party/${id}.md`).join(', ')}`] : []),
      '/cowrite:party add|remove <id …> · /cowrite:party new <id> "<Name>" <role…> makes an expert of your own',
    ].join('\n')
  }
  if (verb === 'add' || verb === 'remove') {
    if (words.length === 0) return `Usage: /cowrite:party ${verb} <id …>`
    const unknown = words.filter(w => !PERSONAS.some(p => p.id === w))
    const own = unknown.filter(w => customPersonas().some(p => p.id === w))
    if (own.length > 0 && verb === 'remove') return `${own.join(', ')}: your own experts are their files; delete party/<id>.md to retire one.`
    if (unknown.length > 0) return `Not in the catalogue: ${unknown.join(', ')}. It has: ${PERSONAS.map(p => p.id).join(', ')}.`
    const roster = verb === 'add' ? [...catalog, ...words.filter(w => !catalog.includes(w))] : catalog.filter(id => !words.includes(id))
    await writeParty($, paper.root, roster)
    await refresh($, cfg)
    const names = words.map(w => personaById(w)?.name ?? w).join(', ')
    return verb === 'add' ? `${names} joined the party.` : `${names} left the party.`
  }
  if (verb === 'new') {
    const [id = '', ...rest] = words
    if (!isCustomId(id)) {
      return id === ''
        ? 'Usage: /cowrite:party new <id> "<Name>" <role…>, e.g. /cowrite:party new neurologist "The Neurologist" clinical neurology, diagnostics'
        : `"${id}" is not a free id: lowercase letters, digits and dashes, and not a catalogue persona's.`
    }
    const quoted = /^"([^"]+)"\s*(.*)$/.exec(rest.join(' '))
    const name = quoted?.[1] ?? rest.join(' ')
    const role = quoted?.[2]?.trim() ?? ''
    const file = `${paper.root}/party/${id}.md`
    if (await $.fs.exists(file)) return `party/${id}.md exists already; edit it, or /cowrite:brief ${id} to tell them what to look for.`
    await $.fs.write(file, personaFileSkeleton(id, name || id, role || '(what this expert looks at)'))
    await loadParty($, paper.root).catch(() => [])
    return { args: `new ${id} "${name || id}" ${role}`.trim() }
  }
  return 'Usage: /cowrite:party [add|remove <id …> | new <id> "<Name>" <role…>]'
}

/** A step of a persona at work: what the progress row and the party card show. */
const SCOPE_INTERVIEW =
  `Help me set the scope of this paper in ${SCOPE_FILE}. Interview me, one question at a time: the goal (what should a reader ` +
  'know or believe afterwards), the points I want to make, the length in words or pages, figures, tables and references, the ' +
  'sections with word targets and how far each one is (outline, draft, revised, final), and the deadline. Then write my answers ' +
  `into ${SCOPE_FILE} in my words, following its structure (## Goal, ## Targets, ## Sections, ## Points as "- [ ] …" lines) and ` +
  'keeping its comment lines. Do not add points of your own; you may ask whether something is missing. Show me the result.'

async function scopeCommand($: Engine, cfg: Config, verb: string): Promise<string> {
  const paper = await findPaper($)
  if (paper === null) return 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.'
  if (verb === 'check') {
    $.ui.toast('🎯 Checking your points…')
    const text = await checkPoints($, paper, cfg.watchModel)
    await refresh($, cfg)
    return text
  }
  if (verb === 'edit' || verb === 'setup') {
    await submitAsAuthor($, cfg, SCOPE_INTERVIEW, 'meta', 'scope')
    return '🎯 Setting the scope: answer the questions…'
  }
  const { scope } = await refresh($, cfg)
  await update($, tabAtom, () => 'scope')
  await $.ui.open({ id: PANE, title: 'CoWriting', focus: true, backgroundColor: 'transparent' })
  if (scope === null) return `No scope yet: /cowrite:scope edit sets it up with you, or write ${SCOPE_FILE} yourself.`
  const pct = (n: number) => `${Math.round(n * 100)} %`
  return `🎯 ≈ ${pct(scope.overall)} · content ${pct(scope.content)}${scope.finish === null ? '' : ` · finish ${pct(scope.finish)}`}`
}

async function stepReview($: Engine, agentId: string, step: string): Promise<void> {
  await update($, reviewsAtom, all => {
    const entry = Object.entries(all).find(([, r]) => r.agentId === agentId && !r.isDone)
    if (entry === undefined) return all
    return { ...all, [entry[0]]: { ...entry[1], steps: entry[1].steps + 1, lastStep: step } }
  })
}

async function finishReview($: Engine, agentId: string): Promise<void> {
  await update($, reviewsAtom, all => {
    const entry = Object.entries(all).find(([, r]) => r.agentId === agentId && !r.isDone)
    return entry === undefined ? all : { ...all, [entry[0]]: { ...entry[1], isDone: true, lastStep: 'done' } }
  })
}

const stepLabel = (tool: string, input: Record<string, unknown>) => {
  const target = String(input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.command ?? '')
  const short = target.split('/').pop()?.slice(0, 28) ?? ''
  return short === '' ? tool : `${tool} ${short}`
}

async function watchStep($: Engine, cfg: Config): Promise<void> {
  const reviewed = await watchTick($, cfg.watchModel).catch(() => false)
  if (reviewed) await refresh($, cfg)
}

async function autosaveStep($: Engine, cfg: Config): Promise<void> {
  const saved = await autosaveTick($).catch(() => null)
  if (saved === null) return
  if ((await focusMode($, cfg)) !== 'focus') $.ui.toast(`💾 ${saved}`)
  await refresh($, cfg).catch(() => undefined)
}

function startWatching($: Engine, cfg: Config): void {
  watchTimer?.cancel()
  resetWatchBaseline()
  watchTimer = $.clock.every(TICK_MS, () => void watchStep($, cfg))
}

async function setWatching($: Engine, cfg: Config, isOn: boolean, personas?: string[]): Promise<void> {
  if (isOn) startWatching($, cfg)
  else {
    watchTimer?.cancel()
    watchTimer = null
  }
  const party = (await findPaper($))?.party ?? []
  const kept = (ids: readonly string[]) => ids.filter(id => party.includes(id))
  await update($, watchAtom, s => ({
    ...s,
    isOn,
    personas: personas ?? (kept(s.personas).length > 0 ? kept(s.personas) : kept([...WATCH_DEFAULT])),
    status: isOn ? `watching: pause for ${PAUSE_MS / 1000} s after writing to get hints` : 'off',
  }))
  await refresh($, cfg)
}

/** A cowrite: command answers in place of its skill; if it fails, say so rather than run the skill's text. */
function commandFailed() {
  return { text: 'CoWriting: that command failed. Try again, or restart Claude Code.' }
}

export const register: Register = (on, options) => {
  const cfg: Config = {
    vault: String(options.obsidianVault ?? ''),
    notesFolder: String(options.aiNotesFolder ?? 'AI-Notes'),
    isGame: options.game !== false,
    watchModel: String(options.watchModel ?? 'haiku') || 'haiku',
    focus: (FOCUS_MODES as readonly string[]).includes(String(options.focusMode)) ? (options.focusMode as FocusMode) : 'calm',
    meter: options.usageMeter === 'off' || options.usageMeter === 'tokens' ? options.usageMeter : 'tokens+limits',
    isAutosave: options.autosave !== false,
  }
  const { vault, notesFolder, isGame } = cfg

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    setLogVersions(await readVersions($))
    if ((await read($, watchAtom)).isOn) startWatching($, cfg) // a reload keeps watching
    autosaveTimer?.cancel()
    autosaveTimer = cfg.isAutosave ? $.clock.every(AUTOSAVE_TICK_MS, () => void autosaveStep($, cfg)) : null
    const usage = await $.session.usage().catch(() => null)
    if (usage !== null) await update($, usageAtom, () => toUsage(usage))
    const snapshot = await refresh($, cfg)
    if (snapshot.paper !== null) void $.ui.open({ id: PANE, title: 'CoWriting', backgroundColor: 'transparent' })
    return result
  })

  // A typed command cannot submit a prompt from its hook (the engine holds that turn), so the
  // commands that need the model hand on to their skill's text; the pane's buttons submit directly.
  on('command.run', { command: 'cowrite:scope' }, async ($, e, next) => {
    const verb = e.args.trim().toLowerCase()
    if (!['', 'check', 'edit', 'setup'].includes(verb)) return { text: 'Usage: /cowrite:scope [check|edit]' }
    if (verb === 'edit' || verb === 'setup') {
      if ((await findPaper($)) === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
      return next(e)
    }
    return { text: await scopeCommand($, cfg, verb) }
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:pane' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const tab = (['party', 'feedback', 'live', 'log', 'scope', 'progress'] as const).find(t => t === wanted)
    if (wanted !== '' && tab === undefined) return { text: 'Usage: /cowrite:pane [party|feedback|live|log|scope|progress]' }
    if (tab !== undefined) await update($, tabAtom, () => tab)
    await refresh($, cfg)
    await $.ui.open({ id: PANE, title: 'CoWriting', focus: true, backgroundColor: 'transparent' })
    return { text: `CoWriting pane${tab ? ` · ${tab}` : ''} · number keys switch tabs, r refresh, o open feedback, y reply, c what changed, m remember, Esc back` }
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:paper' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') return { text: await describePapers($) }
    // /cowrite:paper upgrade: what an older workspace lacks; `apply` makes the changes, the author's copy kept
    const upgrade = /^upgrade(\s+apply)?$/.exec(arg)
    if (upgrade !== null) {
      const paper = await findPaper($)
      if (paper === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
      const text = await upgradePaper($, paper.root, upgrade[1] !== undefined)
      if (upgrade[1] !== undefined) await refresh($, cfg)
      return { text }
    }
    // /cowrite:paper versioning [git|none]: whether this paper is saved with git, and the switch
    const versioning = /^versioning(?:\s+(git|none))?$/.exec(arg)
    if (versioning !== null) {
      const paper = await findPaper($)
      if (paper === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
      const text = await setVersioning($, paper, versioning[1] === 'git' || versioning[1] === 'none' ? versioning[1] : undefined)
      await refresh($, cfg)
      return { text }
    }
    const text = await openPaper($, arg)
    await refresh($, cfg)
    return { text }
  }).catch(commandFailed)

  // the init skill does the setting up; a path argument makes that folder the session's paper
  on('command.run', { command: 'cowrite:init' }, async ($, e, next) => {
    const arg = e.args.trim()
    if (arg !== '') await targetFolder($, arg)
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('command.run', { command: 'cowrite:watch' }, async ($, e) => {
    const paper = await findPaper($)
    if (paper === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const state = await read($, watchAtom)
    // nothing derived from the event is changed in place: the directory reads a mutating call as a changed command
    const hasVerb = words[0] === 'on' || words[0] === 'off'
    const verb = hasVerb ? words[0] : words.length > 0 ? 'on' : state.isOn ? 'off' : 'on'
    const chosen = hasVerb ? words.slice(1) : words
    if (verb === 'off') {
      await setWatching($, cfg, false)
      return { text: 'Live review stopped.' }
    }
    const active = partyPersonas(paper.party)
    let personas: string[] | undefined
    if (chosen.includes('all')) personas = active.map(p => p.id)
    else if (chosen.length > 0) {
      const unknown = chosen.filter(w => personaById(w) === undefined || !active.includes(personaById(w)!))
      if (unknown.length > 0) {
        return { text: `Unknown persona(s): ${unknown.join(', ')}. Choose from: ${active.map(p => p.id).join(', ')}, or all.` }
      }
      personas = chosen.map(w => personaById(w)!.id)
    }
    await setWatching($, cfg, true, personas)
    const names = (await read($, watchAtom)).personas.map(id => personaById(id)?.name ?? id).join(', ')
    return { text: `👁 Live review on · ${names} · hints show above the prompt when you pause · /cowrite:watch off` }
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:brief' }, async ($, e, next) => {
    const paper = await findPaper($)
    if (paper === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
    const [who = '', ...rest] = e.args.trim().split(/\s+/)
    const active = partyPersonas(paper.party)
    if (who === '') {
      const briefs = await readBriefs($, paper.root)
      const line = (key: string, label: string) => `${briefs[key] ? '📋' : '·'} ${label}${briefs[key] ? `: ${briefs[key]!.split('\n')[0]!.slice(0, 60)}` : ''}`
      return {
        text: [
          'Briefs in party.md:',
          line('everyone', 'everyone'),
          ...active.map(p => line(p.id, p.id)),
          '/cowrite:brief <persona> starts an interview · /cowrite:brief <persona> <text> sets it · or edit party.md',
        ].join('\n'),
      }
    }
    const key = who === 'all' || who === 'everyone' ? 'everyone' : personaById(who)?.id
    if (key === undefined || (key !== 'everyone' && !active.some(p => p.id === key))) {
      return { text: `Unknown persona "${who}". Choose from: everyone, ${active.map(p => p.id).join(', ')}.` }
    }
    const persona = personaById(key)
    const name = persona?.name ?? 'the whole party'
    const text = rest.join(' ').trim()
    if (text !== '') {
      await writeBrief($, paper.root, key, text)
      await refresh($, cfg)
      return { text: `📋 Brief for ${name} saved in party.md.` }
    }
    // the interview: the skill's text, with the persona as typed; the event goes on unchanged
    return next(e)
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:party' }, async ($, e, next) => {
    const paper = await findPaper($)
    if (paper === null) return { text: 'No paper here: open one with /cowrite:paper <path>, or set one up with /cowrite:init.' }
    const [verb = '', ...words] = e.args.trim().split(/\s+/).filter(Boolean)
    const answer = await partyCommand($, cfg, paper, verb.toLowerCase(), words)
    return typeof answer === 'string' ? { text: answer } : next(e)
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:ask' }, async ($, e, next) => {
    const [who = '', ...rest] = e.args.trim().split(/\s+/)
    const persona = personaById(who)
    const question = rest.join(' ').trim()
    if (persona === undefined || question === '') return { text: 'Usage: /cowrite:ask <persona> <question>' }
    return next(e)
  }).catch(commandFailed)

  on('command.run', { command: 'cowrite:quiet' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const current = await focusMode($, cfg)
    const mode = wanted === '' ? FOCUS_MODES[(FOCUS_MODES.indexOf(current) + 1) % FOCUS_MODES.length]! : FOCUS_MODES.find(m => m === wanted)
    if (mode === undefined) return { text: 'Usage: /cowrite:quiet [off|calm|focus]' }
    await update($, focusAtom, () => mode)
    const what = {
      off: 'Claude Code shows all its work.',
      calm: "Claude Code's actions are one dim line each.",
      focus: 'Only you, the personas and their progress; ctrl+o shows everything.',
    }[mode]
    return { text: `Focus: ${mode}. ${what}` }
  }).catch(commandFailed)

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await measure($, cfg, toUsage(e)).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'cowrite:summon' }, async ($, e, next) => {
    const [id = ''] = e.args.trim().split(/\s+/)
    const party = partyPersonas((await findPaper($))?.party ?? [])
    const persona = personaById(id)
    if (id === '' || persona === undefined) {
      const names = party.map(p => p.id).join(', ')
      return { text: `${id === '' ? '' : `Unknown persona "${id}". `}Usage: /cowrite:summon <persona> [file]. Your party: ${names}` }
    }
    return next(e)
  }).catch(commandFailed)

  on('prompt.compose', async ($, e, next) => {
    model = e.model
    const result = await next(e)
    const paper = await findPaper($)
    if (paper === null) return result
    return {
      sections: [
        ...result.sections.filter(s => s.id !== CONTRACT_SECTION),
        { id: CONTRACT_SECTION, text: contractText(paper, vault, notesFolder, await $.session.cwd()), scope: 'session' },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const paper = await findPaper($)
    if (paper === null) return result
    const id = newId()
    const earlier = turn
    turn = { id, personas: new Set(), tools: new Set(), agents: {} }
    // A subagent's report coming back is not the author's prompt: log it as that persona's turn.
    // known by the engine's frame around it, whatever origin this build stamps; never one the author typed
    const agentId = e.origin?.kind !== 'composer' ? handBackAgentId(e.text) : undefined
    const agent =
      agentId === undefined
        ? undefined
        : personaById(spawned.get(agentId) ?? personaForAgent(await readLog($, paper.root), agentId) ?? '')
    if (agent !== undefined) turn.personas.add(agent.id)
    if (agentId !== undefined) await finishReview($, agentId)
    // a report that arrives while a turn is open doesn't end that turn's claim to a response
    if (agentId !== undefined && earlier !== null) unanswered.push(earlier)
    // A reply the author typed behind the pane's address line answers a logged input, and keeps its
    // category; the persona's answer that comes back for it answers the reply. That is the thread.
    const replied = e.origin?.kind === 'composer' ? replyAddress(e.text) : null
    const repliedTo = replied === null ? undefined : (await readLog($, paper.root)).find(x => x.type === 'prompt' && x.id === replied.ref)
    const answers = agent !== undefined && pendingReply?.persona === agent.id ? pendingReply.ref : undefined
    if (answers !== undefined) pendingReply = null
    if (replied !== null) pendingReply = replied.persona === '' ? null : { ref: id, persona: replied.persona }
    const replyTo = replied?.ref ?? answers
    await appendLog($, paper.root, {
      type: 'prompt',
      id,
      ts: new Date().toISOString(),
      session: await $.session.id(),
      paper: paper.name,
      category:
        agent?.category ??
        (repliedTo?.type === 'prompt' ? repliedTo.category : undefined) ??
        categoryFor(e.command?.name, e.command ? e.command.args : e.text),
      ...(e.command ? { command: e.command.name } : {}),
      ...(agentId !== undefined ? { origin: 'agent' as const } : {}),
      ...(agent !== undefined ? { agent: agent.id } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
      text: e.text,
    }).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // A Word or LibreOffice file is read as text through pandoc, so the party can review a
  // manuscript written there. Without pandoc, or on an error, the Read tool answers as usual.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const input = e as unknown as { file_path?: string; offset?: number; limit?: number }
    const given = String(input.file_path ?? '')
    if (!CONVERTED_FILE.test(given)) return next(e)
    const path = absolutePath(await $.session.cwd(), given)
    // only a paper's own files: a Word file in another project is that project's business
    const paper = await findPaper($).catch(() => null)
    if (paper === null || !liesIn(path, paper.root)) return next(e)
    const text = await readText($, path).catch(() => null)
    if (text === null) return next(e)
    const lines = text.split('\n')
    const start = Math.max(1, Math.floor(input.offset ?? 1))
    const slice = lines.slice(start - 1, input.limit === undefined ? undefined : start - 1 + Math.max(0, Math.floor(input.limit)))
    return {
      result: {
        type: 'text',
        file: { filePath: path, content: slice.join('\n'), numLines: slice.length, startLine: start, totalLines: lines.length },
      },
    }
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const path = String(input.file_path ?? input.notebook_path ?? '')
    const command = String(input.command ?? '')
    const isFileWrite = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)
    if (isFileWrite || tool === 'Bash') {
      const refusal = await guardVerdict($, tool, path, command)
      if (refusal !== null) return refuse($, tool, input, refusal)
    }
    const paper = READ_ONLY_TOOLS.has(tool) ? null : await findPaper($).catch(() => null)

    // an expert's file just written: load it now, so the agent exists from the next turn on
    if (paper !== null && isFileWrite && /(^|\/)party\/[^/]+\.md$/.test(absolutePath(await $.session.cwd(), path))) {
      const result = await next(e)
      await loadParty($, paper.root).catch(() => [])
      return result
    }

    if (typeof input.agentId === 'string') void stepReview($, input.agentId, stepLabel(tool, input)).catch(() => undefined)
    if (turn !== null) {
      turn.tools.add(tool)
      const agent = personaById(String(input.subagent_type ?? ''))
      if (agent !== undefined) turn.personas.add(agent.id)
    }
    if (READ_ONLY_TOOLS.has(tool)) return next(e)

    // The patterns above can be fooled; the files cannot. Whatever changed in the author's files
    // while this call ran is recorded, shown and disclosed, so the git history can be read against it.
    if (paper === null) return next(e)
    const before = await fingerprintAuthorFiles($, paper).catch(() => null)
    const logBefore = await snapshotLog($, paper.root).catch(() => null)
    const result = await next(e)
    // the log may only grow: what a call rewrote anyway, however it got past the checks above, goes back
    const logAfter = logBefore === null ? null : await snapshotLog($, paper.root).catch(() => null)
    const rewritten = logBefore === null || logAfter === null ? [] : rewrittenLogFiles(logBefore, logAfter)
    const strays = logBefore === null || logAfter === null ? [] : strayLogFiles(logBefore, logAfter, `ai-log/${monthFile(new Date())}`)
    if (rewritten.length + strays.length > 0) {
      await restoreLog($, paper.root, rewritten, strays, logBefore!, logAfter!).catch(() => undefined)
      const files = [...rewritten, ...strays]
      void reportGuard($, cfg, paper, tool, guardInputOf(tool, input), files, `⚠ ${tool} changed the AI log (${files.join(', ')}). That is undone and logged; the altered copy is in .cowriting/log-rewrites/.`)
    }
    if (before === null) return result
    const after = await fingerprintAuthorFiles($, paper).catch(() => null)
    const files = after === null ? [] : changedFiles(before, after)
    if (files.length > 0) void reportGuard($, cfg, paper, tool, guardInputOf(tool, input), files)
    return result
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    // if the guard itself fails, a paper is worth refusing over; another project isn't
    const here = await $.session.cwd().then(cwd => paperRootOf($, cwd)).catch(() => null)
    return here === null ? next(e) : { deny: 'CoWriting: the manuscript guard failed, so the call was refused.' }
  })

  // Subagents start through agent.spawn, not tool.call: this is where a summoned persona is counted.
  on('agent.spawn', async ($, e, next) => {
    // the paper's location and the author's briefing travel with every persona's task
    const briefed = personaById(e.subagentType)
    const paper = briefed !== undefined ? await findPaper($).catch(() => null) : null
    const brief = paper ? briefFor(await readBriefs($, paper.root).catch(() => ({})), briefed!.id) : ''
    const isElsewhere = paper !== null && paper.root !== (await $.session.cwd())
    const extra = [
      isElsewhere ? `## Where the paper is\n${elsewhereText(paper!.root)}` : '',
      brief !== '' ? `## The author's briefing for you in this project\n${brief}` : '',
    ].filter(Boolean)
    const result = await next(extra.length === 0 ? e : { ...e, prompt: [e.prompt, ...extra].join('\n\n') })
    try {
      const persona = personaById(e.subagentType)
      if (persona !== undefined && result.agentId !== undefined) spawned.set(result.agentId, persona.id)
      if (persona !== undefined && turn !== null) {
        turn.personas.add(persona.id)
        if (result.agentId !== undefined) turn.agents[result.agentId] = persona.id
      }
      if (persona !== undefined) {
        const review: Review = { persona: persona.id, agentId: result.agentId ?? '', steps: 0, lastStep: 'starting', isDone: false }
        await update($, reviewsAtom, all =>
          Object.fromEntries([...Object.entries(all), [e.tool_use_id, review]].slice(-KEEP_REVIEWS)),
        )
      }
    } catch {
      // bookkeeping only; never fail a spawn over it
    }
    return result
  }).catch(($, e, next) => next(e))

  // Only the members of this paper's party are offered to the model; the rest of the catalogue waits.
  on('agent.offer', async ($, e, next) => {
    const persona = personaById(e.agent)
    if (persona === undefined) return next(e)
    const paper = await findPaper($)
    if (paper !== null && !paper.party.includes(persona.id)) return { isOffered: false }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await finishReview($, e.agentId).catch(() => undefined)
      return result
    }
    if (turn === null) return result
    const done = turn
    turn = null
    const paper = await findPaper($)
    if (paper === null) return result
    const isAiText = e.answer.includes(AI_TEXT_MARKER)
    // the turns this one answer closes along with its own: each report still asks for a classification
    for (const open of unanswered.splice(0)) {
      await appendLog($, paper.root, {
        type: 'response',
        ref: open.id,
        ts: new Date().toISOString(),
        model,
        personas: [...open.personas],
        ...(Object.keys(open.agents).length > 0 ? { agents: open.agents } : {}),
        tools_used: [...open.tools],
        ai_text_flag: false,
        answer: '',
      }).catch(() => undefined)
    }
    await appendLog($, paper.root, {
      type: 'response',
      ref: done.id,
      ts: new Date().toISOString(),
      model,
      personas: [...done.personas],
      ...(Object.keys(done.agents).length > 0 ? { agents: done.agents } : {}),
      tools_used: [...done.tools],
      ai_text_flag: isAiText,
      answer: e.answer,
    }).catch(() => undefined)
    if (isAiText) {
      $.ui.toast('AI-written text in this answer: it is logged and must be disclosed.')
      await update($, bandHiddenAtom, () => false)
    }
    await refresh($, cfg, true, isAiText)
    return result
  })

  // Transcript: a persona at work is one progress row, its launch receipt is hidden, and the
  // summon prompt and the hand-back each shrink to one line. ctrl+o shows everything in full.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const input = (e.props.input ?? {}) as Record<string, unknown>
    const persona = personaById(String(input.subagent_type ?? ''))
    if (persona !== undefined) {
      const review = (await read($, reviewsAtom))[e.props.tool_use_id]
      return drawReviewRow($, e, { persona, review, isFailed: e.props.isErrored || e.props.isInterrupted })
    }
    const mode = await focusMode($, cfg)
    if (mode === 'off' || e.props.isErrored) return next(e) // errors always show
    return drawToolLine($, e, { label: stepLabel(e.props.tool, input), isRunning: e.props.isRunning, isHidden: mode === 'focus' })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded === true || e.props.isErrored) return next(e)
    const isPersona = (await read($, reviewsAtom))[e.props.tool_use_id] !== undefined
    if (!isPersona && (await focusMode($, cfg)) === 'off') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const mode = await focusMode($, cfg)
    if (mode === 'off' || e.props.isExpanded || e.props.isCallsOnly !== true) return next(e)
    const tally = new Map<string, number>()
    for (const call of e.props.calls) tally.set(call.tool, (tally.get(call.tool) ?? 0) + 1)
    const label = `${e.props.calls.length} steps (${[...tally].map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool)).join(', ')})`
    return drawToolLine($, e, { label, isRunning: e.props.isActive, isHidden: mode === 'focus' })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const waiting = e.props.waitingFor
    const names = waiting?.agents.map(a => personaById(a.agentType)?.name)
    if (waiting !== undefined && waiting.workflows === 0 && names!.length > 0 && names!.every(n => n !== undefined)) {
      return drawWaiting($, e, names as string[])
    }
    if (waiting !== undefined || (await focusMode($, cfg)) === 'off') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if ((await focusMode($, cfg)) === 'off') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if ((await focusMode($, cfg)) !== 'focus') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary !== true || (await focusMode($, cfg)) !== 'focus') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Text } = $.ui.resolve(e)
    const { origin } = e.props
    if (origin.kind === 'task-notification') {
      const review = (await read($, reviewsAtom))[e.props.task?.toolUseId ?? '']
      const persona = personaById(review?.persona ?? '')
      if (persona === undefined) return next(e)
      return (
        <Text dimColor>
          ↩ {persona.name} reported back <Text dimColor>(ctrl+o: full report)</Text>
        </Text>
      )
    }
    if (origin.kind === 'plugin' && origin.name === 'cowrite') {
      const summoned = /cowrite:([a-z0-9-]+) agent to review (.*?)\. Relay/.exec(e.props.text)
      const asked = /cowrite:([a-z0-9-]+) agent to answer my question: "(.*)"\. It may/.exec(e.props.text)
      const briefing = /^Brief (.+?) for this paper\./.exec(e.props.text)
      if (briefing) return <Text dimColor>📋 Briefing {briefing[1]}</Text>
      const creating = /^Add "([^"]+)" to my review party/.exec(e.props.text)
      if (creating) return <Text dimColor>🎭 Creating {creating[1]}</Text>
      if (e.props.text.startsWith('Help me set the scope')) return <Text dimColor>🎯 Setting the scope</Text>
      const match = summoned ?? asked
      const persona = personaById(match?.[1] ?? '')
      if (persona === undefined) return next(e)
      return asked ? (
        <Text dimColor>
          🗨 You asked {persona.name}: “{asked[2]!.slice(0, 80)}”
        </Text>
      ) : (
        <Text dimColor>
          🎭 Summoned {persona.name} · {summoned![2]!.slice(0, 60)}
        </Text>
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snapshot = await read($, snapshotAtom)
    const tab = await read($, tabAtom)
    const watch = await read($, watchAtom)
    const reviews = await read($, reviewsAtom)
    const usage = await read($, usageAtom)
    const reading = (await read($, readingAtom)).open
    return drawPane($, e, {
      usage: usageParts(usage, cfg.meter, watch.tokens ?? 0),
      reviews: Object.values(reviews),
      columns: e.props.bodyColumns,
      placement: e.props.placement,
      snapshot,
      tab,
      watch,
      reading,
      onOpen: id => void openTurn($, id),
      onOpenFor: id => void openFor($, id),
      onCloseReading: () => void update($, readingAtom, () => NO_READING),
      onSummarize: () => void summarizeChanges($, cfg),
      onNote: (text, isTyped) => void setNote($, text, isTyped),
      onReply: () => void replyTo($),
      onRemember: () => void rememberFrom($, cfg),
      onProposal: text => void setProposal($, text),
      onRememberSave: () => void saveRemembered($, cfg),
      onRememberDiscard: () => void discardRemembered($, cfg),
      onWatchToggle: () => void setWatching($, cfg, !watch.isOn),
      personas: partyPersonas(snapshot.paper?.party ?? []),
      isGame,
      onTab: tab => void update($, tabAtom, () => tab),
      onSummon: id => void summon($, cfg, id, ''),
      onAnnotate: (ref, use, note) => void annotate($, cfg, ref, use, note),
      onRefresh: () => void refresh($, cfg),
      onScopeCheck: () => void scopeCommand($, cfg, 'check').then(text => $.ui.toast(text)),
      onScopeEdit: () => void scopeCommand($, cfg, 'edit'),
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, snapshotAtom)
    const isHidden = await read($, bandHiddenAtom)
    const watch = await read($, watchAtom)
    // while the pane shows the Live tab the hints are already on screen with their buttons: no second copy
    const panes = await $.ui.panes().catch(() => [])
    const isLiveShown = panes.some(p => p.id === PANE && p.isPlaced && p.isShown) && (await read($, tabAtom)) === 'live'
    if (!e.props.hasSurvey && watch.isOn && !watch.isHidden && watch.hints.length > 0 && !isLiveShown) {
      return drawLiveBand($, e, {
        watch,
        onAnnotate: (ref, use) => void annotate($, cfg, ref, use),
        onHide: () => void update($, watchAtom, s => ({ ...s, isHidden: true })),
      })
    }
    const { stats } = snapshot
    const isDue = stats.unannotated >= 3 || snapshot.lastWasAiText || snapshot.nudge !== null
    if (e.props.hasSurvey || isHidden || snapshot.paper === null || !isDue) return next(e)
    return drawBand($, e, {
      snapshot,
      onAnnotate: (ref, use) => void annotate($, cfg, ref, use),
      onHide: () => void update($, bandHiddenAtom, () => true),
    })
  })
}
