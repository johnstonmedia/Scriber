/**
 * Teaching the writer how this particular student speaks.
 *
 * A real writer does not apply a rule to decide where a comma goes. They
 * listen to the person in front of them and learn, over a few minutes, what
 * that person's pauses mean — because a comma-length pause for one student is
 * a full stop for another, and someone who is nervous, out of breath, or has
 * a speech difference may not sound like anybody else at all. Applying one
 * fixed threshold to every student is precisely the thing that makes a
 * machine feel like a machine.
 *
 * So the student reads a short passage whose punctuation we already know, and
 * we measure the gaps they leave. Everything here is pure: gap durations in,
 * thresholds out. The audio side lives elsewhere, which keeps the part that
 * decides what a pause means testable without a microphone.
 *
 * Only used under the HSC writer profile, where a writer is permitted to
 * supply punctuation at all. Under the NAPLAN/JCQ scribe protocol the student
 * dictates every mark and there is nothing to infer.
 */

/** What a mark is worth, in rising order of how long a pause precedes it. */
export type MarkKind = 'none' | 'comma' | 'sentence' | 'paragraph'

/** One measured silence, and the mark the passage says belongs there. */
export type GapSample = { ms: number; expected: MarkKind }

export type Calibration = {
  /** A gap at or above this is a comma; below it is just speech. */
  comma: number
  /** At or above this it is a full stop. */
  sentence: number
  /** At or above this it is a new paragraph. */
  paragraph: number
  /** How many gaps went into this — small samples are not trustworthy. */
  samples: number
  capturedAt: string
}

/**
 * A student who barely pauses at all still needs a writer that behaves. These
 * are what an unmeasured student gets, drawn from typical read-aloud speech
 * rather than from anybody in particular.
 */
export const DEFAULT_CALIBRATION: Calibration = {
  comma: 350,
  sentence: 700,
  paragraph: 1500,
  samples: 0,
  capturedAt: '',
}

const median = (values: number[]): number => {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

/** How well two groups of gaps separate: 1 is cleanly, 0 is not at all. */
export function separation(shorter: number[], longer: number[]): number {
  if (shorter.length === 0 || longer.length === 0) return 0
  const shortMax = Math.max(...shorter)
  const longMin = Math.min(...longer)
  if (longMin > shortMax) return 1
  const overlap = shortMax - longMin
  const spread = Math.max(...longer) - Math.min(...shorter)
  if (spread <= 0) return 0
  return Math.max(0, 1 - overlap / spread)
}

export type CalibrationResult =
  | { ok: true; calibration: Calibration; separation: number }
  | { ok: false; reason: string }

/**
 * Turns measured gaps into thresholds, or refuses.
 *
 * Refusing matters more than succeeding. A student who reads at an even pace,
 * with no more silence at a full stop than at a comma, cannot be calibrated —
 * and a writer built on thresholds that don't separate would sprinkle
 * punctuation at random through their exam. That is worse than the defaults,
 * so it says so and keeps them.
 */
export function deriveThresholds(samples: GapSample[], now = new Date()): CalibrationResult {
  const commas = samples.filter((s) => s.expected === 'comma').map((s) => s.ms)
  const sentences = samples.filter((s) => s.expected === 'sentence').map((s) => s.ms)

  if (commas.length < 3 || sentences.length < 2) {
    return {
      ok: false,
      reason: "We didn't hear enough of the passage to learn anything. Try reading it again, at the pace you'd use in an exam.",
    }
  }

  const commaMedian = median(commas)
  const sentenceMedian = median(sentences)

  if (!(sentenceMedian > commaMedian)) {
    return {
      ok: false,
      reason:
        'Your pauses at a full stop were no longer than at a comma, so there is nothing to tell them apart by. You can still dictate every mark yourself.',
    }
  }

  const quality = separation(commas, sentences)
  if (quality < 0.25) {
    return {
      ok: false,
      reason:
        'Your commas and full stops sounded too alike to tell apart reliably. Rather than guess in your exam, the writer will keep its usual pacing.',
    }
  }

  // Thresholds sit between the two groups rather than on either, so a gap
  // that is typical of neither falls to the lower class — under-punctuating
  // is recoverable by saying the mark, over-punctuating is not.
  const commaThreshold = Math.round(commaMedian * 0.6)
  const sentenceThreshold = Math.round((commaMedian + sentenceMedian) / 2)
  // Nobody pauses a paragraph's length while reading a passage aloud, so it
  // is scaled from their own sentence pause rather than measured.
  const paragraphThreshold = Math.round(sentenceMedian * 2.2)

  return {
    ok: true,
    separation: quality,
    calibration: {
      comma: commaThreshold,
      sentence: sentenceThreshold,
      paragraph: paragraphThreshold,
      samples: samples.length,
      capturedAt: now.toISOString(),
    },
  }
}

/** What a silence of this length means, for this student. */
export function classifyGap(ms: number, calibration: Calibration): MarkKind {
  if (ms >= calibration.paragraph) return 'paragraph'
  if (ms >= calibration.sentence) return 'sentence'
  if (ms >= calibration.comma) return 'comma'
  return 'none'
}
