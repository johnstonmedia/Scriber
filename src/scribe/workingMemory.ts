/**
 * The writer's working memory.
 *
 * A real writer is a person, not a transcription machine. They are always a
 * little behind, they can only hold so much in their head before it slips, and
 * every so often they stop to ask how an unusual word is spelled. Practising
 * against a perfect machine teaches a student to dictate in a way that a real
 * writer could never keep up with — so this module models the human limits.
 *
 * Three behaviours live here:
 *
 *  1. Lag — words are queued and written out a beat later, at writing pace.
 *  2. Load — dictate faster than the writer can write and the backlog grows.
 *     Overflow it and the writer loses the tail and asks you to repeat.
 *  3. Spelling — occasionally the writer stops on a long or unusual word and
 *     asks the student to spell it, which NESA's rules expressly allow.
 *
 * Like the engine, everything here is pure: (state, now) -> (state, events).
 */

import { isCommandUnit } from './engine'

export type MemorySettings = {
  /** How long after you start speaking before the pen starts moving. */
  reactionMs: number
  /** Units the writer can hold un-written before the tail starts slipping. */
  capacity: number
  /** Sustained writing pace, in units per second. */
  pacePerSecond: number
  /** Ask the student to spell words at least this long. */
  spellCheckMinLength: number
  /** Chance of asking about any given eligible word. */
  spellCheckChance: number
  /** No spelling questions until the session has been going this long. */
  spellCheckWarmUpMs: number
  /** Never ask twice inside this window. */
  spellCheckCooldownMs: number
  /** Never ask more than this many times in one session. */
  spellCheckMaxPerSession: number
}

export const DEFAULT_MEMORY: MemorySettings = {
  reactionMs: 700,
  capacity: 18,
  // Comfortable speech is about 2.2 units/second, so a normal pace never
  // overflows — only genuinely rushing does.
  pacePerSecond: 2.6,
  spellCheckMinLength: 9,
  spellCheckChance: 0.22,
  // A writer settles into the rhythm before they start interrupting you.
  spellCheckWarmUpMs: 45_000,
  spellCheckCooldownMs: 120_000,
  spellCheckMaxPerSession: 3,
}

export type MemoryPreset = 'patient' | 'realistic' | 'demanding'

/** Presets offered in Settings, from forgiving to genuinely demanding. */
export const MEMORY_PRESETS: Record<
  MemoryPreset,
  { label: string; hint: string; settings: MemorySettings }
> = {
  patient: {
    label: 'Patient writer',
    hint: 'Holds a lot, rarely interrupts. Good for your first sessions.',
    settings: {
      ...DEFAULT_MEMORY,
      reactionMs: 500,
      capacity: 28,
      pacePerSecond: 3.4,
      spellCheckChance: 0.12,
      spellCheckMaxPerSession: 2,
    },
  },
  realistic: {
    label: 'Realistic writer',
    hint: 'Behaves like a person taking your words down by hand.',
    settings: DEFAULT_MEMORY,
  },
  demanding: {
    label: 'Demanding writer',
    hint: 'Short memory and a slower pen. Forces you to pace yourself.',
    settings: {
      ...DEFAULT_MEMORY,
      reactionMs: 900,
      capacity: 12,
      pacePerSecond: 2.0,
      spellCheckChance: 0.3,
      spellCheckMaxPerSession: 5,
    },
  },
}

export type PendingUnit = {
  text: string
  /** When the writer heard it. */
  heardAt: number
  /** Which spoken burst it came from, so corrections span the whole burst. */
  burst: number
}

export type SpellCheck = {
  /** The word as the recogniser heard it — the answer we compare against. */
  word: string
  askedAt: number
  /** What the student has offered so far, letters only. */
  attempt: string
}

export type MemoryState = {
  settings: MemorySettings
  pending: PendingUnit[]
  /** When the writer may next commit a unit to the page; null when idle. */
  nextWriteAt: number | null
  /** Words that have gone onto the page, for quoting back in a repeat request. */
  lastWritten: string[]
  spellCheck: SpellCheck | null
  /** When the student first said anything; null before the session starts. */
  startedAt: number | null
  spellChecksAsked: number
  /** null until the writer has asked once. */
  lastSpellCheckAt: number | null
  checkedWords: string[]
  stats: {
    repeatRequests: number
    unitsLost: number
    spellChecks: number
    spellChecksCorrect: number
    peakLoad: number
  }
}

export type MemoryEvent =
  /** The writer could not hold it all and needs the tail again. */
  | { type: 'repeat'; lost: number; resumeFrom: string }
  /** The writer has stopped to ask how a word is spelled. */
  | { type: 'spellCheck'; word: string }
  | { type: 'spellCheckResult'; word: string; attempt: string; correct: boolean }

export function createMemory(settings: MemorySettings = DEFAULT_MEMORY): MemoryState {
  return {
    settings,
    pending: [],
    nextWriteAt: null,
    lastWritten: [],
    spellCheck: null,
    startedAt: null,
    spellChecksAsked: 0,
    lastSpellCheckAt: null,
    checkedWords: [],
    stats: {
      repeatRequests: 0,
      unitsLost: 0,
      spellChecks: 0,
      spellChecksCorrect: 0,
      peakLoad: 0,
    },
  }
}

/** 0 to 1 — how full the writer's head is. Drives the bar. */
export function load(memory: MemoryState): number {
  return Math.min(1, memory.pending.length / memory.settings.capacity)
}

export function loadTone(value: number): 'calm' | 'busy' | 'critical' {
  if (value >= 0.8) return 'critical'
  if (value >= 0.55) return 'busy'
  return 'calm'
}

/**
 * The student said something. Units join the queue; anything past capacity is
 * gone, because the writer genuinely did not retain it.
 */
export function hear(
  memory: MemoryState,
  units: string[],
  now: number,
  burst = now,
): { memory: MemoryState; events: MemoryEvent[] } {
  if (units.length === 0) return { memory, events: [] }

  const next: MemoryState = {
    ...memory,
    pending: [
      ...memory.pending,
      ...units.map((text) => ({ text, heardAt: now, burst })),
    ],
    stats: { ...memory.stats },
  }

  if (next.startedAt === null) next.startedAt = now

  // Starting from cold, the writer takes a moment to pick up the pen. Mid-flow
  // the pen is already moving, so the existing schedule stands.
  if (memory.pending.length === 0) {
    const readyAt = now + next.settings.reactionMs
    next.nextWriteAt =
      memory.nextWriteAt === null ? readyAt : Math.max(readyAt, memory.nextWriteAt)
  }

  const events: MemoryEvent[] = []
  const overflow = next.pending.length - next.settings.capacity

  if (overflow > 0) {
    next.pending = next.pending.slice(0, next.settings.capacity)
    next.stats.repeatRequests++
    next.stats.unitsLost += overflow
    events.push({
      type: 'repeat',
      lost: overflow,
      resumeFrom: next.lastWritten.slice(-4).join(' '),
    })
  }

  next.stats.peakLoad = Math.max(next.stats.peakLoad, load(next))
  return { memory: next, events }
}

/**
 * Let the pen move. Returns any units the writer has now committed, which the
 * caller feeds to the engine.
 *
 * While a spelling question is open the writer has stopped writing, so nothing
 * drains until it is answered.
 */
export function drain(
  memory: MemoryState,
  now: number,
  random: () => number = Math.random,
): { memory: MemoryState; released: PendingUnit[]; events: MemoryEvent[] } {
  if (memory.spellCheck || memory.pending.length === 0) {
    return { memory, released: [], events: [] }
  }

  const interval = 1000 / memory.settings.pacePerSecond
  const start = memory.nextWriteAt ?? now
  if (now < start) return { memory, released: [], events: [] }

  const next: MemoryState = {
    ...memory,
    pending: [...memory.pending],
    lastWritten: [...memory.lastWritten],
    checkedWords: [...memory.checkedWords],
    stats: { ...memory.stats },
  }
  const released: PendingUnit[] = []
  const events: MemoryEvent[] = []
  let cursor = start

  while (next.pending.length > 0 && cursor <= now) {
    const unit = next.pending[0]!

    if (shouldAskSpelling(next, unit.text, now, random)) {
      next.spellCheck = { word: unit.text, askedAt: now, attempt: '' }
      next.spellChecksAsked++
      next.lastSpellCheckAt = now
      next.checkedWords.push(unit.text.toLowerCase())
      next.stats.spellChecks++
      events.push({ type: 'spellCheck', word: unit.text })
      break
    }

    next.pending.shift()
    released.push(unit)
    if (!isCommandUnit(unit.text)) next.lastWritten.push(unit.text)
    cursor += interval
  }

  next.nextWriteAt = cursor
  next.lastWritten = next.lastWritten.slice(-12)
  return { memory: next, released, events }
}

/** Words common enough that no writer would need them spelled out. */
const FAMILIAR = new Set([
  'different', 'important', 'something', 'everything', 'sometimes', 'therefore',
  'character', 'represents', 'represent', 'described', 'described', 'beginning',
  'understand', 'available', 'including', 'political', 'community', 'questions',
  'following', 'certainly', 'obviously', 'basically', 'literally', 'situation',
  'experience', 'themselves', 'throughout', 'particular', 'especially',
  'government', 'university', 'technology', 'information', 'development',
])

function shouldAskSpelling(
  memory: MemoryState,
  unit: string,
  now: number,
  random: () => number,
): boolean {
  const { settings } = memory
  if (settings.spellCheckChance <= 0) return false
  if (memory.spellChecksAsked >= settings.spellCheckMaxPerSession) return false
  if (memory.startedAt !== null && now - memory.startedAt < settings.spellCheckWarmUpMs) {
    return false
  }
  if (
    memory.lastSpellCheckAt !== null &&
    now - memory.lastSpellCheckAt < settings.spellCheckCooldownMs
  ) {
    return false
  }
  if (isCommandUnit(unit)) return false

  const word = unit.toLowerCase()
  if (!/^[a-z][a-z'’-]*$/.test(word)) return false
  if (word.replace(/[^a-z]/g, '').length < settings.spellCheckMinLength) return false
  if (FAMILIAR.has(word)) return false
  if (memory.checkedWords.includes(word)) return false

  return random() < settings.spellCheckChance
}

/** Spoken letters come back as words — "bee" for B, "why" for Y. */
const LETTER_SOUNDS: Record<string, string> = {
  ay: 'a', aye: 'a', bee: 'b', be: 'b', cee: 'c', sea: 'c', see: 'c', dee: 'd',
  ee: 'e', eff: 'f', ef: 'f', gee: 'g', aitch: 'h', haitch: 'h', aye_i: 'i',
  eye: 'i', jay: 'j', kay: 'k', el: 'l', ell: 'l', em: 'm', en: 'n', oh: 'o',
  owe: 'o', pee: 'p', pea: 'p', cue: 'q', queue: 'q', ar: 'r', are: 'r',
  ess: 's', es: 's', tee: 't', tea: 't', you: 'u', yu: 'u', vee: 'v',
  'double you': 'w', 'double u': 'w', ex: 'x', ecks: 'x', why: 'y', wye: 'y',
  zed: 'z', zee: 'z',
}

/**
 * Turn whatever the student said into the letters they meant. Handles
 * "i r r e v e r s i b l e", "eye are are ee…", and a typed word alike.
 */
export function parseSpelling(spoken: string): string {
  const cleaned = spoken.toLowerCase().replace(/[^a-z\s'’-]/g, ' ').trim()
  if (!cleaned) return ''

  // "double you" is two words, so try the two-word sounds first.
  let working = cleaned
  for (const [sound, letter] of Object.entries(LETTER_SOUNDS)) {
    if (!sound.includes(' ')) continue
    working = working.split(sound).join(` ${letter} `)
  }

  const parts = working.split(/[\s'’-]+/).filter(Boolean)
  let out = ''
  for (const part of parts) {
    if (part.length === 1) {
      out += part
    } else if (LETTER_SOUNDS[part]) {
      out += LETTER_SOUNDS[part]
    } else {
      // A whole word — the student typed or said the word itself.
      out += part
    }
  }
  return out
}

/**
 * Answer the open spelling question.
 *
 * Where spelling is being assessed the writer must put down what the student
 * spelled, right or wrong. Where it is not, the writer spells it correctly —
 * but the report still records the miss, because that is the thing to practise.
 */
export function answerSpelling(
  memory: MemoryState,
  spoken: string,
  options: { writeStudentSpelling: boolean },
): { memory: MemoryState; released: PendingUnit[]; events: MemoryEvent[] } {
  const check = memory.spellCheck
  if (!check) return { memory, released: [], events: [] }

  const attempt = parseSpelling(spoken)
  if (!attempt) return { memory, released: [], events: [] }

  const target = check.word.toLowerCase().replace(/[^a-z]/g, '')
  const correct = attempt === target

  const next: MemoryState = {
    ...memory,
    spellCheck: null,
    pending: memory.pending.slice(1),
    lastWritten: [...memory.lastWritten],
    stats: {
      ...memory.stats,
      spellChecksCorrect: memory.stats.spellChecksCorrect + (correct ? 1 : 0),
    },
  }

  const written = correct || !options.writeStudentSpelling ? check.word : attempt
  next.lastWritten = [...next.lastWritten, written].slice(-12)
  const asked = memory.pending[0]

  return {
    memory: next,
    released: [{ text: written, heardAt: check.askedAt, burst: asked?.burst ?? check.askedAt }],
    events: [{ type: 'spellCheckResult', word: check.word, attempt, correct }],
  }
}

/** Give up on the question and carry on, writing the word as heard. */
export function skipSpelling(memory: MemoryState): {
  memory: MemoryState
  released: PendingUnit[]
} {
  const check = memory.spellCheck
  if (!check) return { memory, released: [] }
  const asked = memory.pending[0]
  return {
    memory: {
      ...memory,
      spellCheck: null,
      pending: memory.pending.slice(1),
      lastWritten: [...memory.lastWritten, check.word].slice(-12),
    },
    released: [
      { text: check.word, heardAt: check.askedAt, burst: asked?.burst ?? check.askedAt },
    ],
  }
}

/** Everything still queued, written out at once — used when the session ends. */
export function flush(memory: MemoryState): { memory: MemoryState; released: PendingUnit[] } {
  const released = [...memory.pending]
  return {
    memory: { ...memory, pending: [], spellCheck: null, nextWriteAt: null },
    released,
  }
}
