/**
 * Step one of pairing the supervision extension: a signed-in student asks
 * Scriber for a short code.
 *
 * The extension can't reach Firebase Auth on its own — it has no session, and
 * giving it one would mean handing a browser extension the student's
 * credentials. Instead the student, already signed in on the website, mints a
 * code here and types it into the extension. Only someone who can already log
 * in as that student can produce a code for them.
 *
 * Codes last ten minutes and work once.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../_lib/admin.js'
import { requireUser, newPairingCode } from '../_lib/auth.js'
import { route } from '../_lib/http.js'

const TTL_MS = 10 * 60_000

export default route('POST', async (req) => {
  const user = await requireUser(req)
  const code = newPairingCode()
  const expiresAt = Date.now() + TTL_MS

  await db().collection('extensionPairings').doc(code).set({
    uid: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  })

  return { code, expiresAt }
})
