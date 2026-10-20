/**
 * Telling a silence apart from the time it takes to say words.
 *
 * The writer was putting full stops in at random, and this is why. A pause
 * was being measured as the interval between one delivery of words from the
 * recogniser and the next — but the recogniser does not hand over a word at a
 * time at a steady rate. It hands over one to four at once, whenever its
 * hypothesis firms up, and the interval between those deliveries is mostly
 * the time the student spent *saying* them. Four words arriving together is
 * about 1200ms of interval and nought milliseconds of silence, and 1200ms was
 * read as the end of a sentence.
 *
 * Measured against a student speaking at a flat pace with no pauses at all,
 * that put six marks into twenty-four words.
 *
 * The separation is arithmetic once it is stated plainly:
 *
 *     interval = silence + (words delivered × how long a word takes)
 *
 * so the silence is what is left after taking the speaking time out. How long
 * a word takes is the student's own, and it has to be learned from them:
 * subtracting a constant would punish anybody who speaks slowly with
 * punctuation they never asked for, which is the same bug in a different hat.
 *
 * It is learned from the median of recent deliveries rather than the fastest.
 * Most deliveries during an answer contain no pause, so the median sits in
 * fluent speech; the ones that do contain a pause sit above it and do not drag
 * it. The median is also the cautious choice, and the caution points the right
 * way: estimating a word as *longer* than it is subtracts more and finds fewer
 * pauses, and a mark the writer left out costs one spoken word to fix while a
 * mark it invented is in somebody's exam.
 *
 * Pure. Used by the exam room as speech arrives, and by the drill over a whole
 * reading at once — the same arithmetic both times, which is what keeps what
 * the model is taught and what it is later asked about on the same footing.
 */

/** What a word takes to say before we know anything about this speaker. */
export const DEFAULT_PER_WORD_MS = 300

/** Nobody says a word in under this, and nobody takes longer without pausing. */
export const MIN_PER_WORD_MS = 110
export const MAX_PER_WORD_MS = 900

/** How many recent deliveries the estimate is drawn from. */
export const WINDOW = 16

/** Deliveries needed before the speaker's own rate is trusted over the default. */
const WARM_UP = 3

export type Cadence = {
  /** Implied milliseconds per word from recent deliveries, newest last. */
  recent: number[]
  /** The current estimate, kept here so callers can show it. */
  perWordMs: number
}

export function createCadence(perWordMs = DEFAULT_PER_WORD_MS): Cadence {
  return { recent: [], perWordMs }
}

const clamp = (value: number) => Math.min(MAX_PER_WORD_MS, Math.max(MIN_PER_WORD_MS, value))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

/** The rate implied by a window of deliveries, or the default if there are too few. */
export function perWordFrom(recent: number[], fallback = DEFAULT_PER_WORD_MS): number {
  if (recent.length < WARM_UP) return clamp(fallback)
  return clamp(median(recent))
}

export type Delivery = {
  /** How many words arrived. */
  words: number
  /** How long since the previous delivery, in milliseconds. */
  intervalMs: number
}

/**
 * Take one delivery, and say how much of it was silence.
 *
 * The estimate used is the one learned *before* this delivery, so a long
 * pause cannot inflate the amount subtracted from itself.
 */
export function observeDelivery(
  cadence: Cadence,
  delivery: Delivery,
): { cadence: Cadence; silenceMs: number } {
  const words = Math.max(1, delivery.words)
  const interval = Math.max(0, delivery.intervalMs)
  const perWordMs = cadence.perWordMs

  const silenceMs = Math.max(0, interval - words * perWordMs)

  const implied = interval / words
  const recent = [...cadence.recent, implied].slice(-WINDOW)
  return { cadence: { recent, perWordMs: perWordFrom(recent, perWordMs) }, silenceMs }
}

/**
 * The same thing over a whole reading at once.
 *
 * The drill has every delivery in hand before it has to decide anything, so
 * it can estimate the speaker's rate from all of them rather than learning as
 * it goes — which matters for a reading only a few seconds long, where an
 * online estimate would still be warming up when it ended.
 */
export function silencesOf(deliveries: Delivery[]): number[] {
  if (deliveries.length === 0) return []
  const implied = deliveries.map((d) => Math.max(0, d.intervalMs) / Math.max(1, d.words))
  const perWordMs = perWordFrom(implied)
  return deliveries.map((d) =>
    Math.max(0, Math.max(0, d.intervalMs) - Math.max(1, d.words) * perWordMs),
  )
}
