/**
 * A finished drill round, offered to the shared model.
 *
 * Two things this route is careful about.
 *
 * It validates rather than trusts. The samples arrive from a browser, so a
 * signed-in student could hand-write a thousand of them claiming that a
 * two-second silence means no mark at all and drag the model off for everyone.
 * The words in a sample must therefore come from a sentence in our own bank —
 * which is checked here, not asserted — and a contribution is capped in size
 * and rate. The bank is the thing that makes this checkable: because the drill
 * text is ours, a sample that mentions any other word did not come from a
 * drill and is refused.
 *
 * And it takes no prose. The only text it will store is words already in the
 * bank, so a student's exam answer cannot end up in a shared model even by
 * accident — not through a bug here, and not through a future caller that
 * means well. That is enforced rather than intended.
 */

import { route, HttpError, jsonBody } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'
import { db } from '../_lib/admin.js'
import { QUEUE, foldQueue } from '../_lib/punctuationStore.js'
import { DRILL_SENTENCES, parseSentence } from '../../src/scribe/drill.js'
import { MARKS, normaliseWord, type Mark, type PunctuationSample } from '../../src/scribe/punctuation.js'
import type { Calibration } from '../../src/scribe/calibration.js'

/** One round is at most a couple of dozen boundaries; this is generous. */
const MAX_SAMPLES = 60

/** A silence longer than this is somebody leaving the room, not punctuating. */
const MAX_GAP_MS = 30_000

/** Every word that appears anywhere in the bank, lowercased. */
const BANK_WORDS = new Set(
  DRILL_SENTENCES.flatMap((sentence) => parseSentence(sentence.text).words.map(normaliseWord)),
)

const MARK_SET = new Set<string>(MARKS)

function validSample(value: unknown): value is PunctuationSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as { context?: unknown; mark?: unknown }
  if (typeof sample.mark !== 'string' || !MARK_SET.has(sample.mark)) return false

  const context = sample.context as
    | { ms?: unknown; before?: unknown; after?: unknown; clauseOpener?: unknown }
    | undefined
  if (!context || typeof context !== 'object') return false
  if (typeof context.ms !== 'number' || !Number.isFinite(context.ms)) return false
  if (context.ms < 0 || context.ms > MAX_GAP_MS) return false

  for (const word of [context.before, context.after, context.clauseOpener]) {
    if (word === null || word === undefined) continue
    if (typeof word !== 'string') return false
    // The one rule that keeps exam prose out of a shared model, checked on the
    // server where a modified client cannot skip it.
    if (!BANK_WORDS.has(normaliseWord(word))) return false
  }
  return true
}

function validCalibration(value: unknown): Calibration | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Partial<Calibration>
  const numbers = [c.comma, c.sentence, c.paragraph]
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_GAP_MS)) {
    return null
  }
  return {
    comma: c.comma!,
    sentence: c.sentence!,
    paragraph: c.paragraph!,
    samples: typeof c.samples === 'number' ? c.samples : 0,
    capturedAt: typeof c.capturedAt === 'string' ? c.capturedAt : '',
  }
}

export default route('POST', async (req) => {
  const user = await requireUser(req)
  const body = jsonBody(req) as { samples?: unknown; calibration?: unknown }

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    throw new HttpError(400, 'no-samples', 'That round had nothing in it.')
  }
  if (body.samples.length > MAX_SAMPLES) {
    throw new HttpError(400, 'too-many', 'That is more than one round of practice.')
  }

  const samples: PunctuationSample[] = []
  for (const candidate of body.samples) {
    if (!validSample(candidate)) {
      throw new HttpError(400, 'bad-sample', 'Those readings did not come from a practice sentence.')
    }
    samples.push({
      // Rebuilt field by field rather than passed through, so nothing else the
      // caller attached rides along into the queue.
      context: {
        ms: Math.round(candidate.context.ms),
        before: candidate.context.before ?? null,
        after: candidate.context.after ?? null,
        clauseOpener: candidate.context.clauseOpener ?? null,
      },
      mark: candidate.mark as Mark,
    })
  }

  await db().collection(QUEUE).add({
    uid: user.uid,
    samples,
    calibration: validCalibration(body.calibration),
    at: new Date().toISOString(),
  })

  // Fold opportunistically. Whoever gets the lease does the work and everyone
  // else returns immediately, so the model keeps up with the drilling without
  // a scheduled job — and `api/punctuation/train` still exists for a cron if
  // the queue ever outgrows this.
  const fold = await foldQueue(db())

  return {
    accepted: samples.length,
    observations: fold.skipped ? null : fold.observations,
  }
})
