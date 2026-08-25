/**
 * Where the shared punctuation model lives, and how it gets folded.
 *
 * The shape of this is decided by two facts about Firestore that pull in
 * opposite directions. One document can absorb about one write a second, and a
 * whole year group drilling at once is far more than that — so contributions
 * cannot be written straight into the model. But the model is read by every
 * exam room on the site, so it has to be one small document, not a collection
 * anyone has to reduce on the way in.
 *
 * So contributions land as their own documents in a queue nobody reads back,
 * and folding them into the published model happens here, on the server, one
 * folder at a time behind a lease. Contributors never contend with each other
 * and never touch the model; readers never see a half-folded state.
 *
 * Folding is addition, which is the property that makes all of this safe: a
 * batch folded twice would bias the model, so folded batches are deleted in
 * the same transaction that folds them, and a batch that fails to fold is
 * simply picked up on the next pass.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  EMPTY_MODEL,
  MODEL_VERSION,
  merge,
  train,
  type PunctuationModel,
  type PunctuationSample,
} from '../../src/scribe/punctuation.js'
import type { Calibration } from '../../src/scribe/calibration.js'

export const MODEL_DOC = 'models/punctuation'
export const QUEUE = 'punctuationContributions'
const LEASE_DOC = 'models/punctuationLease'

/** How many queued batches one fold takes. Keeps a run inside a function's life. */
export const FOLD_BATCH_LIMIT = 200

/** How long a folder may hold the lease before another may assume it died. */
const LEASE_MS = 60_000

export type Contribution = {
  uid: string
  samples: PunctuationSample[]
  calibration: Calibration | null
  at: string
}

export async function readModel(db: Firestore): Promise<PunctuationModel> {
  const snapshot = await db.doc(MODEL_DOC).get()
  if (!snapshot.exists) return EMPTY_MODEL
  const data = snapshot.data() as Partial<PunctuationModel> | undefined
  if (!data || data.version !== MODEL_VERSION) return EMPTY_MODEL
  return {
    version: MODEL_VERSION,
    observations: data.observations ?? 0,
    marks: data.marks ?? {},
    features: data.features ?? {},
    updatedAt: data.updatedAt ?? '',
  }
}

export type FoldResult = {
  folded: number
  samples: number
  observations: number
  /** True when another folder held the lease and this call did nothing. */
  skipped: boolean
}

/**
 * Fold everything queued into the published model.
 *
 * Safe to call from anywhere, as often as you like: the lease means concurrent
 * callers collapse into one, and an interrupted fold loses at most the batches
 * it had in hand, which stay queued.
 */
export async function foldQueue(db: Firestore, now = Date.now()): Promise<FoldResult> {
  const lease = db.doc(LEASE_DOC)
  const claimed = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(lease)
    const heldUntil = (snapshot.data()?.heldUntil as number | undefined) ?? 0
    if (heldUntil > now) return false
    tx.set(lease, { heldUntil: now + LEASE_MS }, { merge: true })
    return true
  })
  if (!claimed) return { folded: 0, samples: 0, observations: 0, skipped: true }

  try {
    const queued = await db.collection(QUEUE).limit(FOLD_BATCH_LIMIT).get()
    if (queued.empty) {
      const current = await readModel(db)
      return { folded: 0, samples: 0, observations: current.observations, skipped: false }
    }

    // Build the delta outside the transaction. Each contribution is trained
    // against the calibration of the student who produced it — the duration
    // feature is expressed in multiples of *their* comma, so folding it under
    // anybody else's would file it in the wrong bucket.
    let delta = EMPTY_MODEL
    let samples = 0
    for (const doc of queued.docs) {
      const contribution = doc.data() as Contribution
      if (!Array.isArray(contribution.samples) || contribution.samples.length === 0) continue
      delta = merge(delta, train(EMPTY_MODEL, contribution.samples, contribution.calibration ?? null))
      samples += contribution.samples.length
    }

    const observations = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(db.doc(MODEL_DOC))
      const data = snapshot.data() as Partial<PunctuationModel> | undefined
      const current: PunctuationModel =
        data && data.version === MODEL_VERSION
          ? {
              version: MODEL_VERSION,
              observations: data.observations ?? 0,
              marks: data.marks ?? {},
              features: data.features ?? {},
              updatedAt: data.updatedAt ?? '',
            }
          : EMPTY_MODEL
      const next = merge(current, delta)
      tx.set(db.doc(MODEL_DOC), next)
      // Deleted in the same transaction that folds them: a batch counted twice
      // would quietly bias the model, and there would be nothing to see.
      for (const doc of queued.docs) tx.delete(doc.ref)
      return next.observations
    })

    return { folded: queued.size, samples, observations, skipped: false }
  } finally {
    await lease.set({ heldUntil: 0, lastFoldAt: FieldValue.serverTimestamp() }, { merge: true })
  }
}
