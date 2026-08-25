/**
 * Fold the contribution queue into the shared model.
 *
 * Contributions already fold themselves opportunistically, so this exists for
 * two cases: a queue that grew faster than the drilling could clear it, and
 * wanting to see the state of the model without guessing. Point a Vercel cron
 * at it if the first ever happens.
 *
 * GET reports; POST folds. A GET that quietly mutated the model would be a
 * trap for every crawler and prefetcher that ever touches the URL.
 */

import { route } from '../_lib/http.js'
import { requireSiteAdmin } from '../_lib/auth.js'
import { db } from '../_lib/admin.js'
import { QUEUE, foldQueue, readModel } from '../_lib/punctuationStore.js'

export default route(['GET', 'POST'], async (req) => {
  await requireSiteAdmin(req)

  if (req.method === 'GET') {
    const [model, queued] = await Promise.all([
      readModel(db()),
      db().collection(QUEUE).count().get(),
    ])
    return {
      observations: model.observations,
      updatedAt: model.updatedAt,
      queued: queued.data().count,
    }
  }

  const result = await foldQueue(db())
  return result
})
