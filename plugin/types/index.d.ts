// The cowrite (CoWriting) plugin's state contract and the shapes its hooks share.

export type PromptEntry = {
  type: 'prompt'
  id: string
  ts: string
  session: string
  paper: string
  category: string
  command?: string
  /**
   * 'agent': not typed by the author but a subagent's report handed back to the session;
   * 'watch': a live review the plugin started while the author wrote;
   * 'scope': a check of which planned points the text already makes;
   * 'summary': a description of what the manuscript's diff shows since a piece of feedback;
   * 'brief': lines of briefing for a persona distilled from a discussion, written to party.md only
   * when the author confirms (the annotation says whether they did)
   */
  origin?: 'agent' | 'watch' | 'scope' | 'summary' | 'brief'
  /** for origin 'agent': the persona whose report this is */
  agent?: string
  /**
   * the entry this turn answers: on the author's reply, the feedback it replies to; on a persona's
   * answer, the author's reply. A thread is the chain.
   */
  replyTo?: string
  text: string
}

export type ResponseEntry = {
  type: 'response'
  ref: string
  ts: string
  model: string
  /** the CoWriting plugin version that logged the turn */
  plugin?: string
  /** the Claude Code version the session ran on */
  claude_code?: string
  personas: string[]
  /** subagents this turn launched as personas: agentId → persona id */
  agents?: Record<string, string>
  tools_used: string[]
  ai_text_flag: boolean
  answer: string
}

export type AnnotationEntry = {
  type: 'annotation'
  ref: string
  ts: string
  use: 'adopted' | 'adapted' | 'rejected' | 'info'
  chapter?: string
  note?: string
  category?: string
}

/**
 * A change to the author's files (the manuscript, the literature, the plan's settings: anything
 * in the paper that is not Claude's) that happened while one of Claude's tool calls ran. The guard
 * refuses the writes it can recognise; this records every change it could not prevent, so the
 * git history and the disclosure can account for it.
 */
export type GuardEntry = {
  type: 'guard'
  ts: string
  session: string
  paper: string
  /** the turn the tool call belonged to, if one was open */
  ref?: string
  tool: string
  /** the command or the file argument, shortened */
  input: string
  /** files that changed, relative to the paper folder; empty for a refusal */
  files: string[]
  /** the guard refused this call, so nothing changed; `input` says what was tried */
  refused?: boolean
}

export type LogEntry = PromptEntry | ResponseEntry | AnnotationEntry | GuardEntry

export type RecentTurn = {
  id: string
  ts: string
  category: string
  /** what the author asked (or what the turn was) */
  preview: string
  /** what the AI said, flattened */
  answer: string
  /** who it came from: the persona, if any */
  persona?: string
  origin?: 'agent' | 'watch' | 'scope' | 'summary' | 'brief'
  /** the entry this turn answers, when it is part of a reply thread */
  replyTo?: string
  personas: string[]
  isAnnotated: boolean
  /** waits for the author to classify it: not a live hint, not a mere launch of a reviewer */
  isOpen: boolean
  isAiText: boolean
}

/** One message of a feedback thread: the feedback, the author's replies, the answers. */
export type ThreadMessage = {
  /** the log entry; a reply Claude answered itself is one entry with two messages */
  id: string
  role: 'ai' | 'author'
  who: string
  /** the persona's agent id; '' for the author and for Claude */
  persona: string
  ts: string
  text: string
}

/** One AI input opened in the pane to read whole, comment on and classify. */
export type Reading = {
  id: string
  ts: string
  category: string
  /** who said it: the persona, or Claude */
  who: string
  /** the persona's agent id, for a reply; '' when Claude itself answered */
  persona: string
  /** the whole thread this input is part of, oldest first */
  messages: ThreadMessage[]
  /** replies sent from this view: a new one empties the field */
  repliesSent: number
  /** what the author asked, or what the turn was */
  asked: string
  /** the whole answer, readable; for a persona's report, the report itself */
  text: string
  /** what Claude added after a persona's report, if it adds something; '' otherwise */
  reply: string
  /** the comment the field shows; typing replaces it until another is drawn */
  note: string
  /** what the model read in the manuscript's diff since this turn; '' until asked */
  summary: string
  isSummarizing: boolean
  /** the persona's current section of party.md; '' without one */
  brief: string
  /** the discussion this input closes, for Remember: the feedback and the author's reply; null for a first input */
  thread: { feedback: string; reply: string } | null
  /** briefing lines the model proposed for the persona, as the field shows them; '' until asked, or discarded */
  proposal: string
  /** the proposal as the model wrote it, to tell an edit from an adoption */
  proposed: string
  /** the log id of the proposal's turn, for its annotation */
  proposalRef: string
  isProposing: boolean
}

/** Another input in the same thread, as the reading view links it. */
export type ThreadLink = {
  id: string
  who: string
  ts: string
}

/** The Log tab's state: the AI input opened whole, or null for the list. */
export type ReadingState = {
  open: Reading | null
}

export type Stats = {
  turns: number
  today: number
  unannotated: number
  aiText: number
  byCategory: Record<string, number>
  personaConsults: Record<string, number>
  personaAdopted: Record<string, number>
  annotations: number
  /** AI inputs the author decided against */
  rejected: number
  /** manuscript changes detected during Claude's tool calls (guard entries) */
  guardEvents: number
  recent: RecentTurn[]
  /** turns waiting to be classified, newest first (at most 5) */
  open: RecentTurn[]
  /** how many turns each persona has waiting to be classified, all of them */
  openByPersona: Record<string, number>
}

export type GameFile = {
  version: 1
  baselineWords: number | null
  maxWords: number
  writingDays: string[]
  achievements: string[]
  disclosures: number
  verifiedRefs: number
}

export type Achievement = { id: string; title: string; detail: string }

export type Progress = {
  ownWords: number
  writerXp: number
  integrityXp: number
  xp: number
  level: number
  nextLevelXp: number
  streak: number
  personaLevels: Record<string, number>
  game: GameFile
  unlocked: Achievement[]
}

export type Paper = {
  root: string
  name: string
  format: 'latex' | 'markdown'
  language: 'en' | 'de'
  /** the review party's members: catalogue ids from paper.json plus the paper's party/<id>.md experts */
  party: string[]
  /** false in paper.json: this paper is never autosaved (e.g. a demo inside another repository) */
  autosave: boolean
  /** 'none': the paper is set up without git, so nothing is saved automatically and there is no history to compare */
  versioning: 'git' | 'none'
}

export type Snapshot = {
  paper: Paper | null
  stats: Stats
  progress: Progress | null
  nudge: string | null
  lastWasAiText: boolean
  /** 'everyone' and the persona ids that have a brief in party.md */
  briefed: string[]
  /** progress against scope.md; null: no scope set */
  scope: ScopeProgress | null
}

export type Stage = 'outline' | 'draft' | 'revised' | 'final'
export type PointStatus = 'covered' | 'partial' | 'missing'

/** A point the author plans to make, with what the last check found. */
export type ScopePoint = {
  text: string
  section?: string
  /** ticked by the author in scope.md: done, whatever a check says */
  isTicked: boolean
  status?: PointStatus
  where?: string
  note?: string
}

export type ScopeSection = {
  name: string
  target?: number
  stage?: Stage
  words: number
  /** TODO, FIXME, ??, UNVERIFIED … left in it */
  markers: number
  /** a heading of that name exists in the manuscript */
  isFound: boolean
}

export type Count = { done: number; target?: number }

export type ScopeProgress = {
  goal: string
  words: Count
  figures: Count
  tables: Count
  references: Count
  deadline?: string
  daysLeft?: number
  /** words a day still needed to reach the target by the deadline */
  wordsPerDay?: number
  points: ScopePoint[]
  /** when the points were last checked */
  checkedAt?: string
  sections: ScopeSection[]
  markers: number
  /** 0–1: points made and quantities reached */
  content: number
  /** 0–1: an estimate from the sections' stages and open markers; null: no stages set */
  finish: number | null
  /** 0–1: content, and finish where known */
  overall: number
}

export type Tab = 'party' | 'feedback' | 'live' | 'log' | 'scope' | 'progress'

export type LiveHint = {
  /** the log turn of the review that gave it */
  ref: string
  persona: string
  file: string
  line: number
  text: string
  ts: string
}

/** A persona subagent at work, keyed by the Agent tool call that started it. */
export type Review = {
  persona: string
  agentId: string
  steps: number
  lastStep: string
  isDone: boolean
}

export type FocusMode = 'off' | 'calm' | 'focus'

export type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** The session's figures as the engine measures them after each turn. */
export type Usage = {
  contextTokens: number | null
  contextPercent: number | null
  costUsd: number | null
  limits: RateWindow[]
}

export type WatchState = {
  /** tokens the live reviews used this session */
  tokens: number
  isOn: boolean
  personas: string[]
  /** newest first */
  hints: LiveHint[]
  status: string
  lastReviewAt: number
  reviewTimes: number[]
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    cowrite: {
      tab: Tab
      snapshot: Shaped<Snapshot>
      isBandHidden: boolean
      watch: Shaped<WatchState>
      reviews: Shaped<Record<string, Review>>
      /** null: the focusMode option decides */
      focus: FocusMode | null
      usage: Shaped<Usage>
      /** a paper folder opened with /cowrite:paper <path>; null: the session's folder decides */
      paperRoot: string | null
      reading: Shaped<ReadingState>
    }
  }
}
