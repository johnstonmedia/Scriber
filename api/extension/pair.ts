/**
 * Step two of pairing: the extension redeems the student's code for a token
 * of its own.
 *
 * The code is spent on first use and the token is stored hashed, so what ends
 * up in Firestore can verify a token but never reproduce one. The token has
 * no Firebase privileges at all — it only lets this backend recognise which
 * student an extension report belongs to.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../_lib/admin.js'
import { codesMatch, newExtensionToken } from '../_lib/auth.js'
import { HttpError, jsonBody, requireString, route } from '../_lib/http.js'

export default route('POST', async (req) => {
  const body = jsonBody(req)
  const supplied = requireString(body, 'code', 32).toUpperCase().replace(/\s/g, '')

  const ref = db().collection('extensionPairings').doc(supplied)
  const snapshot = await ref.get()

  // Compare in constant time even though the document lookup already
  // succeeded or failed on the value — this keeps the shape of the check
  // consistent and costs nothing.
  if (!snapshot.exists || !codesMatch(snapshot.id, supplied)) {
    throw new HttpError(404, 'bad-code', "That code isn't valid. Generate a new one in Scriber.")
  }
  if (Number(snapshot.get('expiresAt') ?? 0) < Date.now()) {
    await ref.delete()
    throw new HttpError(410, 'code-expired', 'That code has expired. Generate a new one in Scriber.')
  }

  const uid = String(snapshot.get('uid'))
  const { token, hash } = newExtensionToken()

  await db().collection('extensionTokens').doc(hash).set({
    uid,
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    revoked: false,
  })
  await ref.delete()

  const profile = await db().collection('users').doc(uid).get()
  return { token, uid, name: String(profile.get('name') ?? '') }
})
