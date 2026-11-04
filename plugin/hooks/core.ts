// Pure logic shared by the hooks: the provenance log's shape, the stats the
// pane shows, the manuscript guard's decision, word counting and the game.
// Nothing here touches `$`, so tests can run it directly.

import type {
  RateWindow,
  Usage,
  Achievement,
  AnnotationEntry,
  GameFile,
  LogEntry,
  Progress,
  PromptEntry,
  RecentTurn,
  ResponseEntry,
  Stats,
} from '../types'
import { PERSONAS, customPersonas, personaById } from './personas'
import type { Persona } from './personas'

// ---------------------------------------------------------------- the log





export const AI_TEXT_MARKER = '[AI-TEXT]'

/** Skills that only manage the log or workspace; their turns need no annotation. */
const META_COMMANDS = new Set(['annotate', 'disclosure', 'init', 'pane', 'paper', 'brief', 'watch', 'quiet', 'scope'])

const COMMAND_CATEGORY: Readonly<Record<string, string>> = {
  feedback: 'feedback',
  socratic: 'feedback',
  structure: 'structure',
  language: 'language',
  sources: 'literature',
  explain: 'concepts',
  consistency: 'structure',
  submit: 'integrity',
}

const bare = (name: string) => name.replace(/^(cowrite|cw):/, '')

export const categoryFor = (command: string | undefined, text: string): string => {
  if (command !== undefined) {
    const name = bare(command)
    if (META_COMMANDS.has(name)) return 'meta'
    if (name === 'summon' || name === 'ask') {
      const persona = personaById(text.trim().split(/\s+/)[0] ?? '')
      return persona?.category ?? 'feedback'
    }
    return COMMAND_CATEGORY[name] ?? 'general'
  }
  const summoned = /cowrite:([a-z0-9-]+) agent/.exec(text)
  if (summoned) return personaById(summoned[1]!)?.category ?? 'general'
  return 'general'
}

export const parseLog = (text: string): LogEntry[] => {
  const out: LogEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const value = JSON.parse(trimmed) as LogEntry
      if (value && typeof value === 'object' && 'type' in value) out.push(value)
    } catch {
      // A torn line is skipped, never fatal.
    }
  }
  return out
}

export const monthFile = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jsonl`

// -------------------------------------------------------------- the stats



export const EMPTY_STATS: Stats = {
  turns: 0,
  today: 0,
  unannotated: 0,
  aiText: 0,
  byCategory: {},
  personaConsults: {},
  personaAdopted: {},
  annotations: 0,
  rejected: 0,
  guardEvents: 0,
  recent: [],
  open: [],
}

/** The subagent id a hand-back prompt reports for, from `<agent-message from="…">`. */
export const handBackAgentId = (text: string): string | undefined =>
  /^\s*<agent-message from="([^"]+)"/.exec(text)?.[1]

/** Which persona a subagent was launched as, from the log's response entries. */
export const personaForAgent = (entries: readonly LogEntry[], agentId: string): string | undefined => {
  for (const e of entries) {
    if (e.type === 'response' && e.agents?.[agentId] !== undefined) return e.agents[agentId]
  }
  return undefined
}

/** Markdown, tags and frames out: a line a person can read in a card. */
const flatten = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[Subagent hand-back\][^.]*\./g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** What the four classifications mean, in the words the buttons and the legend use. */
export const USE_LABELS = {
  adopted: { button: '✓ used', meaning: 'as suggested' },
  adapted: { button: '✎ changed', meaning: 'in your own way' },
  rejected: { button: '✗ not used', meaning: 'decided against it' },
  info: { button: 'ℹ info', meaning: 'only informed you' },
} as const

/** "1 hint", "2 hints": no "(s)" in what the author reads. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Shortens to `max` characters, with an ellipsis where it cut. */
export const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

const two = (n: number) => String(n).padStart(2, '0')
/** An ISO timestamp on the author's local clock: "10-31 13:00", or with `timeOnly` "13:00". */
export const localTime = (ts: string, timeOnly = false): string => {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(5, 16).replace('T', ' ')
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`
  return timeOnly ? clock : `${two(d.getMonth() + 1)}-${two(d.getDate())} ${clock}`
}

export const computeStats = (entries: readonly LogEntry[], now: Date): Stats => {
  const prompts = new Map<string, PromptEntry>()
  const responses = new Map<string, ResponseEntry>()
  const annotated = new Map<string, AnnotationEntry>()
  let guardEvents = 0
  for (const e of entries) {
    if (e.type === 'prompt') prompts.set(e.id, e)
    else if (e.type === 'response') responses.set(e.ref, e)
    else if (e.type === 'annotation') annotated.set(e.ref, e)
    else if (e.type === 'guard') guardEvents += 1
  }

  const day = now.toISOString().slice(0, 10)
  const stats: Stats = { ...EMPTY_STATS, byCategory: {}, personaConsults: {}, personaAdopted: {}, recent: [], open: [], guardEvents }
  const turns: RecentTurn[] = []

  for (const [id, p] of prompts) {
    if (p.category === 'meta') continue
    const r = responses.get(id)
    if (r === undefined) continue
    const a = annotated.get(id)
    const category = a?.category ?? p.category
    stats.turns += 1
    if (p.ts.startsWith(day)) stats.today += 1
    stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1
    // Live hints come in a steady stream, and a turn that only launched a reviewer has nothing to
    // classify: its report does. Classifying those is welcome, not owed.
    const isLaunchOnly = r.agents !== undefined && Object.keys(r.agents).length > 0
    const isOpen = a === undefined && p.origin !== 'watch' && p.origin !== 'scope' && !isLaunchOnly
    if (isOpen) stats.unannotated += 1
    if (r.ai_text_flag) stats.aiText += 1
    for (const persona of r.personas) {
      // a consult is counted when the persona is launched; its hand-back only carries the annotation,
      // and live hints are not consults the author asked for
      if (p.origin === undefined) stats.personaConsults[persona] = (stats.personaConsults[persona] ?? 0) + 1
      if (a?.use === 'adopted' || a?.use === 'adapted') {
        stats.personaAdopted[persona] = (stats.personaAdopted[persona] ?? 0) + 1
      }
    }
    turns.push({
      id,
      ts: p.ts,
      category,
      preview:
        p.origin === 'agent'
          ? `↩ report from ${personaById(p.agent ?? '')?.name ?? 'a subagent'}`
          : p.text.replace(/\s+/g, ' ').slice(0, 60),
      answer: flatten(r.answer).slice(0, 240),
      ...(p.agent !== undefined || r.personas[0] !== undefined ? { persona: p.agent ?? r.personas[0] } : {}),
      ...(p.origin !== undefined ? { origin: p.origin } : {}),
      isOpen,
      personas: r.personas,
      isAnnotated: a !== undefined,
      isAiText: r.ai_text_flag,
    })
  }
  stats.annotations = annotated.size
  stats.rejected = [...annotated.values()].filter(a => a.use === 'rejected').length
  stats.recent = turns.slice(-6).reverse()
  stats.open = turns.filter(t => t.isOpen).slice(-5).reverse()
  return stats
}

// -------------------------------------------------------------- the guard
//
// Inside a paper, Claude writes only in its own places (`CLAUDE_WRITES`); every other file is
// the author's. Three layers, each honest about its reach:
// 1. File tools (Write, Edit, …) are refused by path: `..` is resolved, case is ignored. A
//    `manuscript` folder is refused anywhere, the rest of the author's files inside the paper.
// 2. Shell commands are refused by pattern. This is a best effort: a variable, a script file or
//    a symlink can get past it, and the README says so. The workspace's settings add the OS
//    sandbox for what the patterns cannot see.
// 3. After any other tool ran, the author's files are compared with how they were before.
//    A change is logged as a `guard` entry (see `changedFiles`), shown to the author, and listed
//    in the disclosure. What layer 2 misses, layer 3 records.

/** Where Claude may write inside a paper, relative to its root: folders and single files. */
export const CLAUDE_WRITES = {
  folders: ['notes/ai', 'ai-log', 'disclosure', 'party', '.cowriting', 'build'],
  files: ['scope.md'],
} as const

const WRITE_PATTERNS = [
  /\btee\b/,
  /\bsed\s+(-[a-zA-Z]*i|--in-place)/,
  /\bperl\s+-[a-zA-Z]*i/,
  /\b(mv|cp|rm|rmdir|truncate|touch|ln|dd|install|rsync|patch)\b/,
  /\bgit\s+(checkout|restore|reset|apply|stash|mv|rm|clean)\b/,
  /\bopen\([^)]*['"][wa+]/,
  /\b(write_text|writeFile|writeFileSync|write_bytes)\b/,
  /\s-o\s/, // pandoc -o, sort -o, …
  /\b(vim?|nvim|nano|emacs|ed|ex)\b/,
  /--(write|in-place|fix|output)\b/,
  /\b(python3?|node|ruby|perl)\s+-[ce]\b/,
]

// a redirect target; a digit before `>` is a file descriptor (2>), not a file
const REDIRECT = /(?:^|[^0-9&<])>{1,2}\s*['"]?([^\s'"&|;)]+)/g
const CD = /\bcd\s+['"]?([^\s'";&|]+)/g

const globToRegExp = (segment: string) =>
  new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

/** The path's folders and file after `.` and `..` are resolved. */
const segmentsOf = (path: string): string[] => {
  const out: string[] = []
  for (const s of path.split(/[\\/]+/)) {
    if (s === '..') out.pop()
    else if (s !== '.' && s !== '') out.push(s)
  }
  return out
}

/** Does this path lie in a `manuscript` folder? Case is ignored, `..` resolved, a glob may match it. */
export const isManuscriptPath = (path: string): boolean =>
  segmentsOf(path).some(s => (/[*?]/.test(s) ? globToRegExp(s).test('manuscript') : s.toLowerCase() === 'manuscript'))

/** Is this relative path (segments, case as written) one of Claude's places? A glob never is. */
const isClaudesPlace = (rel: readonly string[]): boolean => {
  if (rel.some(s => /[*?]/.test(s))) return false
  const lower = rel.map(s => s.toLowerCase())
  if (lower.length === 1 && CLAUDE_WRITES.files.some(f => f === lower[0])) return true
  return CLAUDE_WRITES.folders.some(folder => {
    const parts = folder.split('/')
    return lower.length > parts.length && parts.every((p, i) => p === lower[i])
  })
}

/** Is a name at the paper's root wholly the author's? `notes` is not: `notes/ai` is Claude's. */
export const isAuthorsName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return !CLAUDE_WRITES.files.some(f => f === lower) && !CLAUDE_WRITES.folders.some(f => f === lower || f.startsWith(`${lower}/`))
}

/** A path relative to the session's folder made absolute; one the shell will expand is left alone. */
export const absolutePath = (cwd: string, path: string): string =>
  path.startsWith('/') || path.startsWith('~') || path.startsWith('$') ? path : `${cwd}/${path}`

/**
 * The author's file this path names, relative to the paper's root, or null when the path lies
 * outside the paper or in one of Claude's places. `..` is resolved and case ignored.
 */
export const authorFileOf = (path: string, root: string): string | null => {
  const base = segmentsOf(root)
  const segs = segmentsOf(path)
  if (segs.length <= base.length || base.some((s, i) => s.toLowerCase() !== segs[i]!.toLowerCase())) return null
  const rel = segs.slice(base.length)
  return isClaudesPlace(rel) ? null : rel.join('/')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Would this shell command change a file `isTarget` recognises, as far as its text shows?
 * A redirect into it, a `cd` into it followed by any redirect or write, or a writing command
 * with one of `names` among its words as a path (`manuscript/`, `"manuscript"`, …; not inside a
 * longer word or a search pattern). A variable or a script hiding the path gets past this; the
 * after-the-fact comparison (`changedFiles`) is for those.
 */
export const bashWritesTo = (command: string, isTarget: (path: string) => boolean, names: readonly string[]): boolean => {
  const targets = [...command.matchAll(REDIRECT)].map(m => m[1]!)
  if (targets.some(isTarget)) return true
  const enters = [...command.matchAll(CD)].some(m => isTarget(m[1]!))
  const writes = WRITE_PATTERNS.some(p => p.test(command))
  if (enters && (writes || targets.some(t => !t.startsWith('/dev/')))) return true
  const mentions = names.some(n => new RegExp(`(^|[\\s'"=(/])${escapeRegExp(n)}(/|[\\s'")]|$)`, 'i').test(command))
  return mentions && writes
}

/** Would this shell command change a file in a `manuscript` folder, wherever the paper is? */
export const bashTouchesManuscript = (command: string): boolean => bashWritesTo(command, isManuscriptPath, ['manuscript'])

export const GUARD_MESSAGE =
  'CoWriting: the manuscript/ folder is written by its human author only (DFG good scientific practice: ' +
  'only natural persons are authors). Give located feedback, questions or corrected example sentences in the chat instead; ' +
  'the author decides what goes into the text.'

/** The refusal for any other file of the author's: it names the file and where Claude may write. */
export const authorGuardMessage = (file: string): string =>
  `CoWriting: ${file} belongs to the author of this paper and is not changed by Claude. ` +
  `Claude writes only in ${CLAUDE_WRITES.folders.filter(f => f !== 'build' && f !== '.cowriting').map(f => `${f}/`).join(', ')} ` +
  `and ${CLAUDE_WRITES.files.join(', ')}; ask the author to make the change themselves.`

/** The author's files by relative path → `mtime:size`, as they were at one moment. */
export type Fingerprint = Readonly<Record<string, string>>

/** The files that differ between two fingerprints: changed, added or removed. */
export const changedFiles = (before: Fingerprint, after: Fingerprint): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort()

/** Tools that only read; the manuscript is not compared around them. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'AskUserQuestion', 'ToolSearch',
  // a subagent's call lasts minutes while the author may write; its own tool calls are watched one by one
  'Agent', 'Task', 'Monitor',
])

/** What a guard entry records of the call: the command, or the file it named. */
export const guardInputOf = (tool: string, input: Readonly<Record<string, unknown>>): string =>
  String(input.command ?? input.file_path ?? input.notebook_path ?? input.description ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 200)

// ------------------------------------------------------------- the words

export const countWords = (text: string, format: 'latex' | 'markdown'): number => {
  let t = text
  if (format === 'latex') {
    t = t
      .replace(/(^|[^\\])%.*$/gm, '$1')
      .replace(/\\begin\{(figure|table|equation|align)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
      .replace(/\\([A-Za-z]*cite[a-z]*|ref|label|eqref|autoref|cref|input|include|usepackage|documentclass|bibliography|addbibresource)\*?(\[[^\]]*\])*\{[^}]*\}/g, ' ')
      .replace(/\\[a-zA-Z]+\*?/g, ' ')
      .replace(/[{}$\\]/g, ' ')
  } else {
    t = t
      .replace(/^---\n[\s\S]*?\n---\n/, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\[@[^\]]*\]/g, ' ')
      .replace(/[#*_>`|~-]/g, ' ')
  }
  return t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
}

// -------------------------------------------------------------- the game


export const NEW_GAME: GameFile = {
  version: 1,
  baselineWords: null,
  maxWords: 0,
  writingDays: [],
  achievements: [],
  disclosures: 0,
  verifiedRefs: 0,
}


export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-1000', title: 'First 1,000 own words', detail: 'Write 1,000 words yourself' },
  { id: 'ten-k', title: 'Ten Thousand', detail: 'Write 10,000 words yourself' },
  { id: 'streak-7', title: 'Seven-day streak', detail: 'Write on 7 days in a row' },
  { id: 'clean-record', title: 'Clean Record', detail: '10+ AI turns, every one annotated' },
  { id: 'citation-hunter', title: 'Citation Hunter', detail: '20+ references verified by DOI' },
  { id: 'survived-r2', title: 'Survived Reviewer #2', detail: 'Act on 3 hints of Reviewer #2' },
  { id: 'own-voice', title: 'Own Voice', detail: 'Decide against 5 AI hints and say so' },
  { id: 'transparent', title: 'Transparent Scholar', detail: 'Generate your AI disclosure' },
]


export const levelFor = (xp: number) => Math.floor(Math.sqrt(xp / 25)) + 1
export const xpForLevel = (level: number) => (level - 1) ** 2 * 25

export const streakOf = (days: readonly string[], today: string): number => {
  const set = new Set(days)
  let streak = 0
  const d = new Date(`${today}T00:00:00Z`)
  if (!set.has(today)) d.setUTCDate(d.getUTCDate() - 1)
  while (set.has(d.toISOString().slice(0, 10))) {
    streak += 1
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return streak
}

/**
 * Advance the game by what is observed now. Only growth of the manuscript
 * above its highest count so far earns writer XP, so deleting and retyping
 * earns nothing; AI turns themselves earn nothing.
 */
/**
 * The game after an Overleaf import: the words it brought are not the author's writing here, so
 * baseline and maximum move with them and the words counted as their own stay the same.
 */
export const gameAfterImport = (game: GameFile, wordsBefore: number, wordsAfter: number): GameFile =>
  game.baselineWords === null
    ? game
    : {
        ...game,
        baselineWords: game.baselineWords + wordsAfter - wordsBefore,
        maxWords: game.maxWords + wordsAfter - wordsBefore,
      }

export const advanceGame = (
  previous: GameFile,
  words: number,
  stats: Stats,
  today: string,
): Progress => {
  const game: GameFile = { ...previous, writingDays: [...previous.writingDays], achievements: [...previous.achievements] }
  if (game.baselineWords === null) {
    game.baselineWords = words
    game.maxWords = words
  } else if (words > game.maxWords) {
    game.maxWords = words
    if (!game.writingDays.includes(today)) game.writingDays.push(today)
  }
  game.writingDays = game.writingDays.slice(-400)

  const ownWords = game.maxWords - (game.baselineWords ?? 0)
  const writerXp = Math.floor(ownWords / 10)
  const integrityXp = stats.annotations * 5 + game.verifiedRefs * 2 + game.disclosures * 20
  const xp = writerXp + integrityXp
  const level = levelFor(xp)
  const streak = streakOf(game.writingDays, today)

  const personaLevels: Record<string, number> = {}
  for (const p of [...PERSONAS, ...customPersonas()]) personaLevels[p.id] = levelFor((stats.personaAdopted[p.id] ?? 0) * 25)

  const earned: Record<string, boolean> = {
    'first-1000': ownWords >= 1000,
    'ten-k': ownWords >= 10000,
    'streak-7': streak >= 7,
    'clean-record': stats.turns >= 10 && stats.unannotated === 0,
    'citation-hunter': game.verifiedRefs >= 20,
    'survived-r2': (stats.personaAdopted['reviewer-2'] ?? 0) >= 3,
    // rewards the author's judgement, not AI use: a rejected hint is a decision, recorded
    'own-voice': stats.rejected >= 5,
    transparent: game.disclosures > 0,
  }
  const unlocked = ACHIEVEMENTS.filter(a => earned[a.id] && !game.achievements.includes(a.id))
  for (const a of unlocked) game.achievements.push(a.id)

  return {
    ownWords,
    writerXp,
    integrityXp,
    xp,
    level,
    nextLevelXp: xpForLevel(level + 1),
    streak,
    personaLevels,
    game,
    unlocked,
  }
}

/** A gentle nudge when the help starts to outweigh the writing. */
export const overrelianceNudge = (stats: Stats): string | undefined => {
  if (stats.guardEvents > 0) {
    return `${plural(stats.guardEvents, 'change')} to your files happened during AI tool calls. Check the git history; what you keep in the manuscript must be disclosed.`
  }
  if (stats.aiText >= 3) {
    return `${stats.aiText} answers contained AI-written text. Disclose them, and try writing the next passage yourself first.`
  }
  const consults = Object.entries(stats.personaConsults)
  const total = consults.reduce((n, [, c]) => n + c, 0)
  const top = consults.sort((a, b) => b[1] - a[1])[0]
  if (top !== undefined && total >= 6 && top[1] / total > 0.5) {
    const name = personaById(top[0])?.name ?? top[0]
    return `Most consultations go to ${name}. Other perspectives may see what this one misses.`
  }
  return undefined
}

export const newId = (): string => {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------ live review

/** Who watches by default: the perspectives that make sense sentence by sentence. */
export const WATCH_DEFAULT: readonly string[] = ['grammar-guy', 'terminologist', 'style-coach', 'architect']

export type Paragraph = { start: number; end: number; text: string }

/** Paragraphs (runs of non-blank lines) with 1-based line numbers. */
export const paragraphs = (text: string): Paragraph[] => {
  const out: Paragraph[] = []
  const lines = text.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const isBlank = i === lines.length || lines[i]!.trim() === ''
    if (!isBlank && start < 0) start = i
    if (isBlank && start >= 0) {
      out.push({ start: start + 1, end: i, text: lines.slice(start, i).join('\n') })
      start = -1
    }
  }
  return out
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The paragraphs of `after` that are new or changed since `before`, with some prose in them. */
export const changedParagraphs = (before: string, after: string, format: 'latex' | 'markdown'): Paragraph[] => {
  const known = new Set(paragraphs(before).map(p => squash(p.text)))
  return paragraphs(after).filter(p => !known.has(squash(p.text)) && countWords(p.text, format) >= 4)
}

/** The changed paragraphs as the live reviewer sees them: file, then numbered lines. */
export const watchExcerpt = (parts: readonly { file: string; changed: readonly Paragraph[] }[], maxChars = 4000): string => {
  let out = ''
  for (const { file, changed } of parts) {
    out += `### ${file}\n`
    for (const p of changed) {
      const numbered = p.text.split('\n').map((line, i) => `${p.start + i}| ${line}`).join('\n')
      if (out.length + numbered.length > maxChars) return `${out}[… more changes not shown]\n`
      out += `${numbered}\n\n`
    }
  }
  return out
}

export const watchSystem = (
  personas: readonly Persona[],
  language: 'en' | 'de',
  styleProfile: string,
  briefs: Readonly<Record<string, string>> = {},
): string =>
  [
    'You are the live review party of CoWriting, watching a researcher write. The researcher is the sole author (DFG good scientific practice).',
    'You see only the paragraphs they just wrote or changed, with line numbers. Give at most 3 short hints in total, only where it matters. An empty list is a good answer.',
    'Each hint: at most 25 words, about one line, from exactly one of these personas:',
    ...personas.map(p => `- ${p.id}: ${p.role}${briefs[p.id] ? `. The author asks it to look for: ${briefs[p.id]!.replace(/\s+/g, ' ')}` : ''}`),
    briefs.everyone ? `About the project, from the author: ${briefs.everyone.replace(/\s+/g, ' ')}` : '',
    'Never write or rewrite sentences for the manuscript: name the problem and the principle, or ask a question.',
    'Exceptions: grammar-guy may give the corrected form of a wrong word or phrase; terminologist may name the usual term of the field, without a sentence around it.',
    'Never invent facts or references.',
    `Write the hints in ${language === 'de' ? 'German' : 'English'}.`,
    styleProfile !== '' ? `The author's style profile, from model papers they like:\n${styleProfile}` : '',
    'Answer with JSON only: [{"persona": "<id>", "line": <number>, "hint": "<text>"}]',
  ]
    .filter(Boolean)
    .join('\n')

export type ParsedHint = { persona: string; line: number; hint: string }

/** The hints in a live-review answer: at most three, from the personas that watch. */
export const parseHints = (text: string, personas: readonly string[]): ParsedHint[] => {
  const from = text.indexOf('[')
  const to = text.lastIndexOf(']')
  if (from < 0 || to <= from) return []
  let value: unknown
  try {
    value = JSON.parse(text.slice(from, to + 1))
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const out: ParsedHint[] = []
  for (const item of value as Record<string, unknown>[]) {
    const persona = typeof item?.persona === 'string' ? item.persona.replace(/^(cowrite|cw):/, '') : ''
    const hint = typeof item?.hint === 'string' ? squash(item.hint) : ''
    if (!personas.includes(persona) || hint === '') continue
    out.push({ persona, line: Number(item.line) || 0, hint: hint.slice(0, 240) })
  }
  return out.slice(0, 3)
}

// ------------------------------------------------------------------ usage

export const EMPTY_USAGE: Usage = { contextTokens: null, contextPercent: null, costUsd: null, limits: [] }

type MeasuredUsage = {
  context: { tokens?: number; percent?: number }
  rateLimits: readonly RateWindow[]
  cost?: { usd: number }
}

export const toUsage = (u: MeasuredUsage): Usage => ({
  contextTokens: u.context.tokens ?? null,
  contextPercent: u.context.percent ?? null,
  costUsd: u.cost?.usd ?? null,
  limits: u.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) })),
})

export const formatCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const limitName = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind.replace(/_/g, ' '))

const resetLabel = (w: RateWindow) => {
  if (w.resetsAt === undefined) return ''
  const d = new Date(w.resetsAt)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return w.kind === 'seven_day' ? `${d.getDate()}.${d.getMonth() + 1}. ${hm}` : hm
}

export type UsageMeter = 'off' | 'tokens' | 'tokens+limits'

/** The usage line's parts: context, live-review tokens, then the limit windows (Pro/Max) or the cost. */
export const usageParts = (u: Usage, meter: UsageMeter, liveTokens: number): string[] => {
  if (meter === 'off') return []
  const parts: string[] = []
  if (u.contextTokens !== null) {
    parts.push(`context ${formatCount(u.contextTokens)}${u.contextPercent !== null ? ` (${Math.round(u.contextPercent)}%)` : ''}`)
  }
  if (liveTokens > 0) parts.push(`live review ${formatCount(liveTokens)}`)
  if (meter === 'tokens+limits') {
    for (const w of u.limits) parts.push(`${limitName(w.kind)} limit ${Math.round(w.percentUsed)}%${w.resetsAt ? ` ↻ ${resetLabel(w)}` : ''}`)
  }
  // a subscription has limit windows; the cost only means money on API billing
  if (u.limits.length === 0 && u.costUsd !== null && u.costUsd > 0) parts.push(`$${u.costUsd.toFixed(2)}`)
  return parts
}

/** The status line's short form: context fill and the fullest limit window. */
export const usageShort = (u: Usage, meter: UsageMeter): string[] => {
  if (meter === 'off') return []
  const parts: string[] = []
  if (u.contextPercent !== null) parts.push(`ctx ${Math.round(u.contextPercent)}%`)
  const fullest = [...u.limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (meter === 'tokens+limits' && fullest !== undefined) parts.push(`${limitName(fullest.kind)} ${Math.round(fullest.percentUsed)}%`)
  return parts
}

/** A warning when a limit window crosses 80 % or 95 %. */
export const limitCrossed = (before: readonly RateWindow[], after: readonly RateWindow[]): string | undefined => {
  for (const w of after) {
    const previous = before.find(b => b.kind === w.kind)?.percentUsed ?? 0
    for (const threshold of [95, 80]) {
      if (previous < threshold && w.percentUsed >= threshold) {
        const reset = w.resetsAt ? `, resets ${resetLabel(w)}` : ''
        return `${limitName(w.kind)} usage limit at ${Math.round(w.percentUsed)}%${reset}`
      }
    }
  }
  return undefined
}

// ------------------------------------------------------------------ briefs

/** The author's briefing of the party for one project: party.md in the paper's folder. */
export const BRIEF_FILE = 'party.md'

const briefKey = (heading: string): string | undefined => {
  const first = heading.trim().split(/[\s—–]+/)[0]?.toLowerCase() ?? ''
  if (first === 'everyone' || first === 'all') return 'everyone'
  return personaById(first)?.id
}

/** Sections of party.md by key ('everyone' or a persona id), comments and blank lines removed. */
export const parseBriefs = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const body = text.replace(/<!--[\s\S]*?-->/g, '')
  const parts = body.split(/^## +(.+)$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const key = briefKey(parts[i]!)
    const content = (parts[i + 1] ?? '').trim()
    if (key !== undefined && content !== '') out[key] = content
  }
  return out
}

/** What a persona is told about this project: the shared context, then its own brief. */
export const briefFor = (briefs: Readonly<Record<string, string>>, personaId: string): string =>
  [
    briefs.everyone ? `About the project:\n${briefs.everyone}` : '',
    briefs[personaId] ? `What to look for:\n${briefs[personaId]}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

/** party.md with one section's body replaced (or the section added), the rest untouched. */
export const setBrief = (text: string, key: string, body: string): string => {
  const persona = personaById(key)
  const heading = key === 'everyone' ? 'everyone — the whole party' : `${persona!.id} — ${persona!.name}`
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^## +/.test(l) && briefKey(l.replace(/^## +/, '')) === key)
  const section = [`## ${heading}`, body.trim(), '']
  if (start < 0) return `${text.replace(/\s*$/, '')}\n\n${section.join('\n')}`
  let end = start + 1
  while (end < lines.length && !/^## +/.test(lines[end]!)) end++
  // keep the guiding comment under the heading, replace what the author wrote
  const comment = lines.slice(start + 1, end).filter(l => /^\s*<!--.*-->\s*$/.test(l))
  return [...lines.slice(0, start), `## ${heading}`, ...comment, body.trim(), '', ...lines.slice(end)].join('\n')
}

// ------------------------------------------------------------- autosave

/** Paths from `git status --porcelain -z`, renames and copies by their new name. */
export const changedPaths = (porcelain: string): string[] => {
  const tokens = porcelain.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    paths.push(token.slice(3))
    if (token[0] === 'R' || token[0] === 'C') i++ // the old name follows
  }
  return paths
}

export type FileChange = { file: string; before: number; after: number }

/**
 * One autosave commit's message: the manuscript files with the words gained
 * and lost, and how many entries the AI log gained (null: the log is unchanged).
 */
export const autosaveMessage = (changes: readonly FileChange[], logEntries: number | null = null): string => {
  const log = logEntries === null ? '' : logEntries > 0 ? `AI log +${logEntries} ${logEntries === 1 ? 'entry' : 'entries'}` : 'AI log updated'
  const lines = changes.map(c => `${c.file}: ${c.before} → ${c.after} words`)
  if (log !== '') lines.push(log)
  const body = `${lines.join('\n')}\n\nAutosaved by CoWriting: the author's own text and the AI log, committed unchanged.`
  if (changes.length === 0) return `${log}\n\n${body}`
  const names = changes.map(c => c.file.split('/').pop()!)
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')
  const delta = changes.reduce((sum, c) => sum + c.after - c.before, 0)
  const words = delta === 0 ? '±0 words' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} words`
  return `Writing: ${shown} (${words})${log === '' ? '' : ` · ${log}`}\n\n${body}`
}
