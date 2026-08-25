/**
 * The shared model, from the browser's side.
 *
 * Read straight from Firestore — it is one small public document and every
 * exam room needs it before the student starts talking, so a round trip to an
 * API route would be a needless dependency on a function being warm. Writing
 * goes the other way, through a route, because what may be contributed has to
 * be checked somewhere a modified client cannot reach.
 *
 * The whole point of this file is that the model is site-wide. One student's
 * drill improves the writer for everybody, which is what makes ten minutes of
 * practice worth a student's time.
 */

import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { authedFetch } from './api'
import {
  EMPTY_MODEL,
  MODEL_VERSION,
  type PunctuationModel,
  type PunctuationSample,
} from '../scribe/punctuation'
import type { Calibration } from '../scribe/calibration'

const MODEL_PATH = ['models', 'punctuation'] as const

/**
 * Held for the life of the tab once fetched.
 *
 * The model changes on the scale of a school term, and an exam room that
 * re-read it mid-session could change how the writer behaves halfway through
 * somebody's answer — which is worse than being slightly out of date.
 */
let cached: Promise<PunctuationModel> | null = null

export function loadPunctuationModel(): Promise<PunctuationModel> {
  if (!cached) {
    cached = getDoc(doc(db, ...MODEL_PATH))
      .then((snapshot) => {
        if (!snapshot.exists()) return EMPTY_MODEL
        const data = snapshot.data() as Partial<PunctuationModel>
        if (data.version !== MODEL_VERSION) return EMPTY_MODEL
        return {
          version: MODEL_VERSION,
          observations: data.observations ?? 0,
          marks: data.marks ?? {},
          features: data.features ?? {},
          updatedAt: data.updatedAt ?? '',
        }
      })
      .catch(() => {
        // A writer that refuses to work because a model could not be fetched
        // would be a worse writer than one using the student's own thresholds.
        return EMPTY_MODEL
      })
  }
  return cached
}

/** Forget the cached copy — used after contributing, so a drill shows its effect. */
export function refreshPunctuationModel(): Promise<PunctuationModel> {
  cached = null
  return loadPunctuationModel()
}

export type ContributionResult = { accepted: number; observations: number | null }

/** Offer one finished drill round to the shared model. */
export async function contributeRound(
  samples: PunctuationSample[],
  calibration: Calibration | null,
): Promise<ContributionResult> {
  return authedFetch<ContributionResult>('/api/punctuation/contribute', {
    method: 'POST',
    body: { samples, calibration },
  })
}
