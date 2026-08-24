/**
 * The scribe engine.
 *
 * A writer working under NESA writing-test scribe rules writes the student's
 * words down verbatim, in lower case, with no punctuation other than what the
 * student dictates. Speech recognition does the opposite by default — it
 * capitalises sentences and sprinkles in full stops — so in strict mode we
 * deliberately strip all of that back out before parsing, and only ever write
 * punctuation that came from a spoken command.
 *
 * Everything here is pure: (state, utterance) -> (state, events). That keeps the
 * behaviour testable and means the UI never has to guess what the writer did.
 */

import {
  buildPhraseIndex,
  MAX_PHRASE_WORDS,
  type CommandEntry,
  type PhraseIndex,
} from './commands'

export type RuleProfile = 'strict' | 'assisted'

export type Atom =
  | { id: number; utterance: number; kind: 'word'; text: string }
  | {
      id: number
      utterance: number
      kind: 'punct'
      text: string
      attach: 'left' | 'right' | 'both' | 'spaced'
      terminal: boolean
    }
  | { id: number; utterance: number; kind: 'break'; action: 'paragraph' | 'line' }

export type ScribeEvent =
  | { type: 'command'; label: string; group: CommandEntry['group'] }
  | { type: 'readBack'; scope: 'last-two-sentences' | 'all' }
  | { type: 'stopReading' }
  | { type: 'notice'; message: string }

export type ScribeStats = {
  words: number
  /** How many of each spoken command were used, keyed by command label. */
  commandCounts: Record<string, number>
  punctuationMarks: number
  paragraphs: number
  sentences: number
  corrections: number
  readBacks: number
  /** Punctuation the engine supplied because the student did not (assisted mode only). */
  assistedInsertions: number
}

export type ScribeState = {
  atoms: Atom[]
  nextId: number
  utterance: number
  pendingCase: 'none' | 'capital' | 'allCaps'
  capsLock: boolean
  stats: ScribeStats
}

export function createState(): ScribeState {
  return {
    atoms: [],
    nextId: 1,
    utterance: 0,
    pendingCase: 'none',
    capsLock: false,
    stats: {
      words: 0,
      commandCounts: {},
      punctuationMarks: 0,
      paragraphs: 0,
      sentences: 0,
      corrections: 0,
      readBacks: 0,
      assistedInsertions: 0,
    },
  }
}

const phraseIndex: PhraseIndex = buildPhraseIndex()

/**
 * Strip what the recogniser added of its own accord. In strict mode the student
 * is the only source of punctuation and capitals, so anything the browser
 * inserted is noise that would flatter the student's result.
 */
export function normaliseUtterance(raw: string, profile: RuleProfile): string {
  let text = raw.trim()
  if (profile === 'strict') {
    text = text
      .toLowerCase()
      // Keep apostrophes and hyphens inside words (don't, well-known); drop the rest.
      .replace(/[.,!?;:"“”…()[\]{}]/g, ' ')
      .replace(/(^|\s)['’-]+|['’-]+(?=\s|$)/g, '$1')
  }
  return text.replace(/\s+/g, ' ').trim()
}

function tokenise(text: string): string[] {
  return text.split(' ').filter(Boolean)
}

/** Words are matched against the command table with punctuation ignored. */
function keyOf(word: string): string {
  return word.toLowerCase().replace(/[^a-z ]/g, '')
}

/** Longest matching command phrase starting at `index`, if there is one. */
function matchPhraseAt(words: string[], index: number): { entry: CommandEntry; length: number } | null {
  for (const candidate of phraseIndex) {
    const length = candidate.words.length
    if (length > MAX_PHRASE_WORDS || index + length > words.length) continue
    let hit = true
    for (let k = 0; k < length; k++) {
      if (keyOf(words[index + k]!) !== candidate.words[k]) {
        hit = false
        break
      }
    }
    if (hit) return { entry: candidate.entry, length }
  }
  return null
}

/**
 * Split an utterance into the smallest units that can be written independently.
 * A unit is either one word or one whole command phrase — "new paragraph" must
 * never be broken in half, or the writer would put the word "new" on the page.
 *
 * The writer's working memory queues these units, so it has to agree with the
 * engine about where the boundaries are.
 */
export function chunkUtterance(text: string, profile: RuleProfile = 'strict'): string[] {
  const words = tokenise(normaliseUtterance(text, profile))
  const units: string[] = []
  for (let i = 0; i < words.length; ) {
    const matched = matchPhraseAt(words, i)
    const length = matched?.length ?? 1
    units.push(words.slice(i, i + length).join(' '))
    i += length
  }
  return units
}

/** True when the unit is a spoken instruction rather than words to write down. */
export function isCommandUnit(unit: string): boolean {
  const words = tokenise(unit)
  const matched = matchPhraseAt(words, 0)
  return matched !== null && matched.length === words.length
}

/** An atom before the engine stamps it with an id and utterance number. */
type NewAtom = Atom extends infer A ? (A extends Atom ? Omit<A, 'id' | 'utterance'> : never) : never

function pushAtom(state: ScribeState, atom: NewAtom): void {
  state.atoms.push({ ...atom, id: state.nextId++, utterance: state.utterance } as Atom)
}

function applyCase(state: ScribeState, word: string): string {
  if (state.capsLock) return word.toUpperCase()
  switch (state.pendingCase) {
    case 'capital':
      state.pendingCase = 'none'
      return word.charAt(0).toUpperCase() + word.slice(1)
    case 'allCaps':
      state.pendingCase = 'none'
      return word.toUpperCase()
    default:
      return word
  }
}

function lastIndexWhere(atoms: Atom[], predicate: (a: Atom) => boolean): number {
  for (let i = atoms.length - 1; i >= 0; i--) if (predicate(atoms[i]!)) return i
  return -1
}

function countCommand(state: ScribeState, entry: CommandEntry) {
  state.stats.commandCounts[entry.label] = (state.stats.commandCounts[entry.label] ?? 0) + 1
}

/**
 * In assisted mode the writer is permitted to add punctuation and capitals
 * without direction. We only do the two things a human writer reliably does:
 * capitalise the opening of a sentence, and close an unfinished final sentence.
 */
function assistCapitalisation(state: ScribeState, word: string): string {
  const previous = state.atoms[state.atoms.length - 1]
  const atSentenceStart =
    !previous ||
    previous.kind === 'break' ||
    (previous.kind === 'punct' && previous.terminal)
  if (atSentenceStart) {
    state.stats.assistedInsertions++
    return word.charAt(0).toUpperCase() + word.slice(1)
  }
  if (word === 'i' || word.startsWith("i'") || word.startsWith('i’')) {
    state.stats.assistedInsertions++
    return 'I' + word.slice(1)
  }
  return word
}

export type ApplyResult = { state: ScribeState; events: ScribeEvent[] }

/**
 * Feed one finalised burst of speech (or typed dictation) to the writer.
 * Returns a new state — the input is never mutated.
 */
export function applyUtterance(
  previous: ScribeState,
  rawText: string,
  profile: RuleProfile = 'strict',
  /**
   * Groups atoms under one spoken burst. The writer's working memory may hand
   * a single burst over in several pieces, and "scratch that" has to rub out
   * the whole burst — so the caller passes the burst's id to keep them
   * together. Omit it and each call counts as its own burst.
   */
  utteranceKey?: number,
  /**
   * Assisted mode may close the sentence it was just given — but only when
   * this call genuinely reaches the end of what the student said. The working
   * memory releases one burst's words a few at a time, at writing pace, so a
   * caller processing those pieces must pass true only on the call that
   * carries the burst's final word; every earlier piece passes false. Ignored
   * in strict mode, where the writer never adds this punctuation. Defaults to
   * true so a caller passing one whole utterance at once — tests, or any
   * simpler integration — gets the closing behaviour without extra plumbing.
   */
  closeSentence = true,
): ApplyResult {
  const state: ScribeState = {
    ...previous,
    atoms: [...previous.atoms],
    stats: { ...previous.stats, commandCounts: { ...previous.stats.commandCounts } },
  }
  const events: ScribeEvent[] = []

  const text = normaliseUtterance(rawText, profile)
  if (!text) return { state, events }

  state.utterance = utteranceKey ?? state.utterance + 1
  const words = tokenise(text)

  for (let i = 0; i < words.length; ) {
    // Longest-match: "question mark" must beat "question".
    const matched = matchPhraseAt(words, i)

    if (!matched) {
      const word = words[i]!
      const cased =
        profile === 'assisted' ? assistCapitalisation(state, applyCase(state, word)) : applyCase(state, word)
      pushAtom(state, { kind: 'word', text: cased })
      state.stats.words++
      i += 1
      continue
    }

    const { entry, length } = matched
    i += length
    const command = entry.command

    switch (command.kind) {
      case 'punctuation': {
        pushAtom(state, {
          kind: 'punct',
          text: command.text,
          attach: command.attach,
          terminal: Boolean(command.terminal),
        })
        state.stats.punctuationMarks++
        if (command.terminal) state.stats.sentences++
        countCommand(state, entry)
        events.push({ type: 'command', label: entry.label, group: entry.group })
        break
      }

      case 'structure': {
        const last = state.atoms[state.atoms.length - 1]
        if (last?.kind === 'break') {
          // Two breaks in a row would leave a blank paragraph; upgrade instead.
          if (command.action === 'paragraph') last.action = 'paragraph'
        } else if (state.atoms.length > 0) {
          pushAtom(state, { kind: 'break', action: command.action })
        }
        if (command.action === 'paragraph') state.stats.paragraphs++
        countCommand(state, entry)
        events.push({ type: 'command', label: entry.label, group: entry.group })
        break
      }

      case 'modifier': {
        if (command.action === 'capital') state.pendingCase = 'capital'
        if (command.action === 'allCaps') state.pendingCase = 'allCaps'
        if (command.action === 'capsOn') state.capsLock = true
        if (command.action === 'capsOff') state.capsLock = false
        countCommand(state, entry)
        events.push({ type: 'command', label: entry.label, group: entry.group })
        break
      }

      case 'edit': {
        const removed = applyEdit(state, command.action)
        state.stats.corrections++
        countCommand(state, entry)
        events.push({ type: 'command', label: entry.label, group: entry.group })
        if (removed === 0) {
          events.push({ type: 'notice', message: 'Nothing left to rub out.' })
        }
        break
      }

      case 'control': {
        countCommand(state, entry)
        if (command.action === 'stopReading') {
          events.push({ type: 'stopReading' })
        } else {
          state.stats.readBacks++
          events.push({
            type: 'readBack',
            scope: command.action === 'readBackAll' ? 'all' : 'last-two-sentences',
          })
        }
        events.push({ type: 'command', label: entry.label, group: entry.group })
        break
      }
    }
  }

  if (profile === 'assisted' && closeSentence) closeFinalSentence(state)
  return { state, events }
}

/** Returns how many atoms were removed. */
function applyEdit(state: ScribeState, action: 'scratchThat' | 'deleteWord' | 'deleteSentence'): number {
  const before = state.atoms.length

  if (action === 'deleteWord') {
    const index = lastIndexWhere(state.atoms, (a) => a.kind === 'word')
    if (index !== -1) state.atoms.splice(index, 1)
  }

  if (action === 'scratchThat') {
    // Everything said in this burst, or if this burst is only the command
    // itself, everything from the burst before it.
    const thisBurst = state.atoms.filter((a) => a.utterance === state.utterance)
    const target = thisBurst.length > 0 ? state.utterance : state.utterance - 1
    state.atoms = state.atoms.filter((a) => a.utterance !== target)
  }

  if (action === 'deleteSentence') {
    const lastAtom = state.atoms[state.atoms.length - 1]
    const endsSentence = lastAtom?.kind === 'punct' && lastAtom.terminal
    const searchEnd = endsSentence ? state.atoms.length - 1 : state.atoms.length
    let boundary = -1
    for (let i = searchEnd - 1; i >= 0; i--) {
      const atom = state.atoms[i]!
      if ((atom.kind === 'punct' && atom.terminal) || atom.kind === 'break') {
        boundary = i
        break
      }
    }
    state.atoms = state.atoms.slice(0, boundary + 1)
  }

  const removed = before - state.atoms.length
  state.stats.words = state.atoms.filter((a) => a.kind === 'word').length
  state.stats.punctuationMarks = state.atoms.filter((a) => a.kind === 'punct').length
  state.stats.sentences = state.atoms.filter((a) => a.kind === 'punct' && a.terminal).length
  return removed
}

function closeFinalSentence(state: ScribeState) {
  const last = state.atoms[state.atoms.length - 1]
  if (!last || last.kind !== 'word') return
  pushAtom(state, { kind: 'punct', text: '.', attach: 'left', terminal: true })
  state.stats.punctuationMarks++
  state.stats.sentences++
  state.stats.assistedInsertions++
}

/** Render the atoms exactly as the writer would have them on the page. */
export function render(atoms: Atom[]): string {
  let out = ''
  let pendingSpace = false

  for (const atom of atoms) {
    if (atom.kind === 'break') {
      out += atom.action === 'paragraph' ? '\n\n' : '\n'
      pendingSpace = false
      continue
    }

    if (atom.kind === 'word') {
      if (pendingSpace) out += ' '
      out += atom.text
      pendingSpace = true
      continue
    }

    switch (atom.attach) {
      case 'left':
        out += atom.text
        pendingSpace = true
        break
      case 'right':
        if (pendingSpace) out += ' '
        out += atom.text
        pendingSpace = false
        break
      case 'both':
        out += atom.text
        pendingSpace = false
        break
      case 'spaced':
        if (pendingSpace) out += ' '
        out += atom.text
        pendingSpace = true
        break
    }
  }

  return out
}

/** The last N sentences, for the "read back" command. */
export function lastSentences(atoms: Atom[], count: number): string {
  const boundaries: number[] = []
  atoms.forEach((atom, index) => {
    if (atom.kind === 'punct' && atom.terminal) boundaries.push(index)
  })

  const lastAtom = atoms[atoms.length - 1]
  const trailingIsOpen = !(lastAtom?.kind === 'punct' && lastAtom.terminal)
  // An unfinished sentence counts as one of the sentences read back.
  const needed = trailingIsOpen ? count - 1 : count
  const cut = boundaries[boundaries.length - 1 - needed]
  const start = cut === undefined ? 0 : cut + 1

  return render(atoms.slice(start)).trim()
}

export function paragraphsOf(text: string): string[] {
  return text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
}

/**
 * Coaching feedback shown at the end of a session. These are practice
 * observations, not marks.
 */
export type Insight = { tone: 'good' | 'watch'; message: string }

export function buildInsights(state: ScribeState, profile: RuleProfile): Insight[] {
  const insights: Insight[] = []
  const { stats, atoms } = state
  const text = render(atoms)

  if (stats.words === 0) return [{ tone: 'watch', message: 'No dictation was recorded.' }]

  if (profile === 'strict') {
    const lastAtom = atoms[atoms.length - 1]
    if (lastAtom && !(lastAtom.kind === 'punct' && lastAtom.terminal)) {
      insights.push({
        tone: 'watch',
        message: 'Your last sentence has no full stop. Say "full stop" to close it.',
      })
    }

    const wordsPerSentence = stats.sentences > 0 ? stats.words / stats.sentences : stats.words
    if (stats.sentences === 0) {
      insights.push({
        tone: 'watch',
        message:
          'You did not dictate any sentence-ending punctuation. Under scribe rules the writer adds none for you.',
      })
    } else if (wordsPerSentence > 40) {
      insights.push({
        tone: 'watch',
        message: `Your sentences averaged ${Math.round(wordsPerSentence)} words. Long sentences usually mean a missed full stop.`,
      })
    } else {
      insights.push({
        tone: 'good',
        message: `You closed ${stats.sentences} sentence${stats.sentences === 1 ? '' : 's'} yourself, averaging ${Math.round(wordsPerSentence)} words each.`,
      })
    }

    if (stats.commandCounts['Comma'] === undefined && stats.words > 60) {
      insights.push({
        tone: 'watch',
        message: 'No commas were dictated. Practise saying "comma" inside longer sentences.',
      })
    }
  }

  const paragraphCount = paragraphsOf(text).length
  if (stats.words > 120 && paragraphCount === 1) {
    insights.push({
      tone: 'watch',
      message: 'Everything landed in one paragraph. Say "new paragraph" when you change idea.',
    })
  } else if (paragraphCount > 1) {
    insights.push({
      tone: 'good',
      message: `You directed ${paragraphCount} paragraphs.`,
    })
  }

  const capitals = (stats.commandCounts['Capital'] ?? 0) + (stats.commandCounts['All caps (one word)'] ?? 0)
  if (profile === 'strict' && capitals === 0 && stats.words > 60) {
    insights.push({
      tone: 'watch',
      message: 'No capitals were dictated — names and sentence openings need "capital" said aloud.',
    })
  }

  if (stats.readBacks > 0) {
    insights.push({
      tone: 'good',
      message: `You asked for a read back ${stats.readBacks} time${stats.readBacks === 1 ? '' : 's'} — a good habit for checking your work.`,
    })
  }

  if (profile === 'assisted' && stats.assistedInsertions > 0) {
    insights.push({
      tone: 'watch',
      message: `The writer supplied ${stats.assistedInsertions} capital${stats.assistedInsertions === 1 ? '' : 's'} or full stop${stats.assistedInsertions === 1 ? '' : 's'} for you. Strict mode makes you dictate every one.`,
    })
  }

  return insights
}
