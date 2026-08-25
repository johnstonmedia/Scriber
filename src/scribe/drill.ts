/**
 * The training drill: read a sentence we already know the answer to.
 *
 * This is how the model gets taught. A sentence is put on the screen, the
 * student reads it aloud, and the writer commits to where it thinks the
 * punctuation went — before it is shown the answer. Then both are put side by
 * side: what it wrote, and what the sentence actually says. Every word
 * boundary in the sentence becomes one training sample, including the many
 * boundaries where the right answer is *no mark at all* — a classifier shown
 * only commas learns that everything is a comma, and the negatives are most of
 * what stops it sprinkling them through somebody's exam.
 *
 * Because the sentence is ours, no exam prose ever leaves the machine. What
 * gets pooled is which of our own sentences was read, how long the silences
 * were, and where they fell. That is a deliberate constraint, not an
 * incidental one: a student's actual answer is never training data.
 *
 * Pure throughout. The microphone and the network live elsewhere.
 */

import type { Calibration } from './calibration'
import {
  MARK_TEXT,
  predictMark,
  type Mark,
  type PunctuationSample,
  type PunctuationModel,
} from './punctuation'

/** A sentence with its punctuation, as authored. */
export type DrillSentence = {
  id: string
  text: string
  /** What the drill is meant to exercise, shown to the student afterwards. */
  focus: string
}

/**
 * The bank.
 *
 * Two rules shaped these. They lean towards what a threshold alone gets wrong
 * — questions, a comma before a coordinating conjunction, the long
 * mid-sentence pause that is not a full stop. And every mark worth learning
 * from has words after it, because a mark at the very end of the reading
 * cannot be measured at all (see `measurable`). A sentence that ends on the
 * only interesting mark it has teaches nothing, so those carry a short second
 * sentence to pause into.
 */
export const DRILL_SENTENCES: DrillSentence[] = [
  {
    id: 'd1',
    text: 'The road was long, and the light was already going.',
    focus: 'A comma before "and" joining two complete clauses.',
  },
  {
    id: 'd2',
    text: 'What had she expected? Nothing, in the end.',
    focus: 'A question, which sounds like a full stop and is not one.',
  },
  {
    id: 'd3',
    text: 'She stopped at the gate, looked back once, and kept walking.',
    focus: 'Commas in a list of actions.',
  },
  {
    id: 'd4',
    text: 'Nothing, in the end, that she could have said out loud.',
    focus: 'A phrase held inside a pair of commas.',
  },
  {
    id: 'd5',
    text: 'How does the composer represent discovery? The poem never quite says.',
    focus: 'A question opening with "how".',
  },
  {
    id: 'd6',
    text: 'The poem resists an easy reading. That resistance is the point.',
    focus: 'Two short sentences, not one long one.',
  },
  {
    id: 'd7',
    text: 'However, the second stanza undercuts all of it.',
    focus: 'A comma after an opening adverb.',
  },
  {
    id: 'd8',
    text: 'Is memory privileged over experience, or is the text less certain? It is hard to say.',
    focus: 'A question long enough to pause inside.',
  },
  {
    id: 'd9',
    text: 'He wrote it quickly and never went back to it.',
    focus: 'No comma at all — one clause, straight through.',
  },
  {
    id: 'd10',
    text: 'When the speaker returns, the landscape has changed.',
    focus: 'A comma after an opening clause, with no question following.',
  },
]

/** One word boundary in a drill sentence, and what belongs there. */
export type Boundary = {
  /** Index of the word this boundary follows, in the stripped word list. */
  afterWordIndex: number
  mark: Mark
  /** The word before and after, as the model will see them. */
  before: string
  after: string | null
  /** First word of the clause this boundary closes. */
  clauseOpener: string
  /**
   * Whether a silence here can be measured at all.
   *
   * False for the last boundary in the sentence, and the reason matters. A
   * silence is measured from the last word before it to the first word after
   * it — so at the end of a sentence there is no first word after, and the
   * gap comes back as zero no matter how long the student actually waited.
   *
   * Left in, that single boundary would have done real damage: every round
   * would mark the student wrong for a full stop nobody could hear, and
   * worse, every round would teach the shared model that a sentence-ending
   * mark comes after no pause at all. A few hundred rounds of that and the
   * writer would end sentences mid-clause — the exact complaint this whole
   * change set out to fix, reintroduced by its own training data.
   *
   * It costs nothing to drop. In the exam room the decision to close a
   * sentence is made when the *next* burst arrives, which does have a gap
   * either side of it, so what is dropped here is a case inference never
   * meets.
   */
  measurable: boolean
}

export type ParsedSentence = {
  words: string[]
  boundaries: Boundary[]
}

const TERMINAL = new Set(['.', '?', '!'])

/**
 * Pull a sentence apart into the words a student will say and the marks
 * between them.
 *
 * Marks are read off the text itself rather than authored twice — a bank where
 * the sentence and its answer key can drift apart is a bank that will
 * eventually teach the model something false.
 */
export function parseSentence(text: string): ParsedSentence {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const words: string[] = []
  const marksAfter: Mark[] = []

  for (const token of tokens) {
    const bare = token.replace(/[^A-Za-z'’-]/g, '')
    if (!bare) continue
    const trailing = token.slice(token.indexOf(bare) + bare.length)
    let mark: Mark = 'none'
    if ([...trailing].some((c) => c === '?')) mark = 'question'
    else if ([...trailing].some((c) => TERMINAL.has(c))) mark = 'sentence'
    else if (trailing.includes(',')) mark = 'comma'
    words.push(bare)
    marksAfter.push(mark)
  }

  const boundaries: Boundary[] = []
  let clauseOpener = words[0] ?? ''
  for (let i = 0; i < words.length; i++) {
    const mark = marksAfter[i]!
    boundaries.push({
      afterWordIndex: i,
      mark,
      before: words[i]!,
      after: words[i + 1] ?? null,
      clauseOpener,
      measurable: i < words.length - 1,
    })
    // A new clause starts after any mark, not only a terminal one: "however,
    // the second stanza…" opens a clause at "the", and whether that clause
    // began with an interrogative is exactly what separates a question mark
    // from a full stop several words later.
    if (mark !== 'none') clauseOpener = words[i + 1] ?? ''
  }

  return { words, boundaries }
}

/** A silence the microphone actually heard, placed at a word boundary. */
export type ObservedGap = {
  /** Which word it followed, as best the recogniser could say. */
  afterWordIndex: number
  ms: number
}

/**
 * One update from the recogniser: how many words it had heard, and when.
 *
 * This is the instrument, and choosing it was the one real decision in this
 * file. There is a more accurate one, and it was built and then deleted:
 * reading the microphone level directly through the Web Audio API measures a
 * silence to the millisecond, where this is accurate only to a recogniser tick
 * and carries whatever latency the recogniser adds.
 *
 * It is still the right instrument, because it is the one the exam room has.
 * A model trained on precise silences and then asked to judge recogniser
 * timings is being asked about a distribution it has never seen, and would be
 * confidently wrong in a way that is very hard to see. Training and inference
 * measuring the same thing the same way matters more here than either of them
 * being accurate, and the latency largely cancels anyway: durations are
 * normalised by the student's own comma pause, measured with this same
 * instrument.
 */
export type RecogniserUpdate = { words: number; at: number }

/** Silences, read off the intervals between recogniser updates. */
export function observedGaps(updates: RecogniserUpdate[]): ObservedGap[] {
  const gaps: ObservedGap[] = []
  for (let i = 1; i < updates.length; i++) {
    const previous = updates[i - 1]!
    const current = updates[i]!
    // An update that added no words says nothing about where a silence fell.
    if (current.words <= previous.words) continue
    gaps.push({ afterWordIndex: previous.words - 1, ms: Math.max(0, current.at - previous.at) })
  }
  return gaps
}

/**
 * Did they read the sentence in front of them?
 *
 * Worth checking, and not only against mischief. A student who loses their
 * place, reads a word wrong, or gets recognised badly produces gap timings
 * that line up with a sentence they did not say — and those would be filed
 * against the wrong words and taught to everybody. Rejecting the round and
 * asking for it again costs ten seconds.
 */
export function readingMatches(parsed: ParsedSentence, heard: string[]): boolean {
  if (heard.length === 0) return false
  const expected = parsed.words.map((word) => word.toLowerCase().replace(/[^a-z'’-]/g, ''))
  const said = heard.map((word) => word.toLowerCase().replace(/[^a-z'’-]/g, '')).filter(Boolean)
  if (Math.abs(said.length - expected.length) > 3) return false

  // Matched in order, allowing the odd missing or extra word — the recogniser
  // drops one often enough that exactness would reject good readings.
  let cursor = 0
  let matched = 0
  for (const word of expected) {
    const found = said.indexOf(word, cursor)
    if (found === -1) continue
    matched++
    cursor = found + 1
  }
  return matched / expected.length >= 0.75
}

export type Alignment = {
  /** Boundary index -> the silence heard there, in milliseconds. */
  gapAt: number[]
  /** Silences that could not be placed at any boundary within tolerance. */
  spurious: ObservedGap[]
}

/**
 * Put each measured silence at a word boundary.
 *
 * Speech recognition gives no word-level timing, so where a silence fell is
 * inferred from how many words had arrived when it began — accurate to a word
 * or two, not to the word. On a ±1 error a comma-length pause gets filed
 * against the wrong pair of words, and since those words are two of the three
 * things the model learns from, that is not a rounding error: it teaches the
 * model something false.
 *
 * So within the tolerance a silence prefers a boundary that carries a mark.
 *
 * That is supervision, not cheating, and the distinction is worth being exact
 * about. The sentence is ours and the student was asked to read it, so where
 * the marks are is not in question — it is the label. What the drill never
 * tells the model is *what the pause means*: it is placed at the boundary and
 * then asked, with only the duration and the words either side, which mark
 * belongs there. It is free to answer "none" and be marked wrong. Position is
 * given; the answer is earned.
 *
 * Longest silences are placed first, so when a real comma pause and a mid-word
 * breath compete for the same boundary the comma takes it and the breath falls
 * to a neighbour — where, correctly, it is labelled "no mark". Silences that
 * fit nowhere are reported rather than forced somewhere.
 */
export function alignGaps(
  parsed: ParsedSentence,
  observed: ObservedGap[],
  tolerance = 2,
): Alignment {
  const gapAt = new Array<number>(parsed.boundaries.length).fill(0)
  const taken = new Set<number>()
  const spurious: ObservedGap[] = []

  for (const gap of [...observed].sort((a, b) => b.ms - a.ms)) {
    let best = -1
    let bestRank = Infinity
    let bestDistance = Infinity
    for (let i = 0; i < parsed.boundaries.length; i++) {
      if (taken.has(i)) continue
      const boundary = parsed.boundaries[i]!
      const distance = Math.abs(boundary.afterWordIndex - gap.afterWordIndex)
      if (distance > tolerance) continue
      const rank = boundary.mark === 'none' ? 1 : 0
      if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
        best = i
        bestRank = rank
        bestDistance = distance
      }
    }
    if (best === -1) {
      spurious.push(gap)
      continue
    }
    taken.add(best)
    gapAt[best] = gap.ms
  }

  return { gapAt, spurious }
}

/**
 * Every boundary in the sentence, as a training sample.
 *
 * Boundaries with no silence heard are included with a gap of zero, because
 * "the student ran straight through here and there is no mark" is the single
 * most common fact about English and the model has to be told it.
 */
export function roundSamples(parsed: ParsedSentence, alignment: Alignment): PunctuationSample[] {
  return parsed.boundaries.flatMap((boundary, index) => {
    if (!boundary.measurable) return []
    return [
      {
        context: {
          ms: alignment.gapAt[index] ?? 0,
          before: boundary.before,
          after: boundary.after,
          clauseOpener: boundary.clauseOpener,
        },
        mark: boundary.mark,
      },
    ]
  })
}

export type BoundaryVerdict = {
  before: string
  after: string | null
  ms: number
  expected: Mark
  produced: Mark
  confidence: number
  correct: boolean
}

export type RoundResult = {
  verdicts: BoundaryVerdict[]
  /** The sentence as the writer would have written it, marks and all. */
  produced: string
  /** The sentence as it actually reads. */
  expected: string
  correct: number
  total: number
  /** Marks invented where none belonged — the failure that matters most. */
  overWrites: number
  /** Marks missed where one belonged. */
  underWrites: number
  /**
   * A mark written where a mark belonged, but the wrong one — a comma for a
   * question mark. Counted separately because it is neither of the others and
   * was previously counted as neither, which left the report able to say a
   * round was imperfect without being able to say what was wrong with it.
   */
  wrongMarks: number
  spurious: ObservedGap[]
}

/**
 * Grade one round: what the writer wrote against what the sentence says.
 *
 * The prediction runs on the same code path the exam room uses, so a round
 * that reads well here is not a separate implementation that happens to agree.
 */
export function gradeRound(
  parsed: ParsedSentence,
  alignment: Alignment,
  calibration: Calibration | null,
  model?: PunctuationModel,
): RoundResult {
  const verdicts: BoundaryVerdict[] = []
  let produced = ''
  let correct = 0
  let overWrites = 0
  let underWrites = 0
  let wrongMarks = 0

  parsed.boundaries.forEach((boundary, index) => {
    produced += boundary.before

    // The closing mark is not something the student can be asked about — see
    // `measurable`. It is written as the sentence has it, so the comparison
    // reads as a sentence rather than as one that trails off, and it is not
    // graded and not taught.
    if (!boundary.measurable) {
      produced += MARK_TEXT[boundary.mark]
      return
    }

    const ms = alignment.gapAt[index] ?? 0
    const prediction = predictMark(
      { ms, before: boundary.before, after: boundary.after, clauseOpener: boundary.clauseOpener },
      calibration,
      model,
    )
    const hit = prediction.mark === boundary.mark
    if (hit) correct++
    else if (boundary.mark === 'none') overWrites++
    else if (prediction.mark === 'none') underWrites++
    else wrongMarks++

    verdicts.push({
      before: boundary.before,
      after: boundary.after,
      ms,
      expected: boundary.mark,
      produced: prediction.mark,
      confidence: prediction.confidence,
      correct: hit,
    })

    produced += MARK_TEXT[prediction.mark]
    if (boundary.after) produced += prediction.mark === 'paragraph' ? '' : ' '
  })

  return {
    verdicts,
    produced: produced.trim(),
    expected: renderExpected(parsed),
    correct,
    total: parsed.boundaries.filter((boundary) => boundary.measurable).length,
    overWrites,
    underWrites,
    wrongMarks,
    spurious: alignment.spurious,
  }
}

function renderExpected(parsed: ParsedSentence): string {
  let out = ''
  parsed.boundaries.forEach((boundary) => {
    out += boundary.before + MARK_TEXT[boundary.mark]
    if (boundary.after) out += boundary.mark === 'paragraph' ? '' : ' '
  })
  return out.trim()
}

/** Pick the next sentence to drill, avoiding ones just done. */
export function nextSentence(done: string[], random: () => number = Math.random): DrillSentence {
  const fresh = DRILL_SENTENCES.filter((sentence) => !done.includes(sentence.id))
  const pool = fresh.length > 0 ? fresh : DRILL_SENTENCES
  return pool[Math.floor(random() * pool.length)] ?? DRILL_SENTENCES[0]!
}
