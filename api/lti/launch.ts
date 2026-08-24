/**
 * Step two: the platform posts an id_token saying who this is.
 *
 * Everything about this route is about refusing. By the time it returns a
 * redirect, Scriber is treating the launch as proof of identity — so the
 * order is: find the state we issued, fetch the platform's keys, verify the
 * signature, check every claim, spend the state so it cannot be replayed, and
 * only then mint a session.
 *
 * The state is deleted before the session is minted rather than after. A
 * launch that fails halfway is one nobody can retry with the same token,
 * which is the safe direction to fail in.
 */

import { getAuth } from 'firebase-admin/auth'
import { adminApp, db } from '../_lib/admin.js'
import { HttpError, route } from '../_lib/http.js'
import {
  LtiError,
  personFromClaims,
  roleFromClaims,
  subjectKey,
  validateClaims,
  verifySignature,
  type Jwk,
  type LtiPlatform,
} from '../_lib/lti.js'

export default route('POST', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, string>
  const idToken = body.id_token
  const state = body.state
  if (!idToken || !state) {
    throw new HttpError(400, 'incomplete-launch', 'That launch was missing part of itself.')
  }

  const stateRef = db().collection('ltiStates').doc(state)
  const stateDoc = await stateRef.get()
  if (!stateDoc.exists) {
    throw new HttpError(
      400,
      'unknown-state',
      'That launch did not match one we started, or it has already been used. Open Scriber from your class again.',
    )
  }
  if (Number(stateDoc.get('expiresAt') ?? 0) < Date.now()) {
    await stateRef.delete()
    throw new HttpError(400, 'state-expired', 'That launch took too long. Open Scriber from your class again.')
  }

  const platformDocs = await db()
    .collection('ltiPlatforms')
    .where('issuer', '==', stateDoc.get('issuer'))
    .where('clientId', '==', stateDoc.get('clientId'))
    .limit(1)
    .get()
  const platformDoc = platformDocs.docs[0]
  if (!platformDoc) {
    await stateRef.delete()
    throw new HttpError(404, 'unknown-platform', 'That platform is no longer connected to Scriber.')
  }
  const platform: LtiPlatform = {
    issuer: String(platformDoc.get('issuer')),
    clientId: String(platformDoc.get('clientId')),
    deploymentIds: (platformDoc.get('deploymentIds') as string[] | undefined) ?? [],
    authLoginUrl: String(platformDoc.get('authLoginUrl')),
    jwksUrl: String(platformDoc.get('jwksUrl')),
    orgId: String(platformDoc.get('orgId')),
  }

  let claims
  try {
    const keys = await fetchKeys(platform.jwksUrl)
    claims = verifySignature(idToken, keys)
    validateClaims(claims, { platform, expectedNonce: String(stateDoc.get('nonce')) })
  } catch (error) {
    // Spend the state on a failed launch too: a token that failed once must
    // not get a second attempt against a still-valid state.
    await stateRef.delete()
    if (error instanceof LtiError) throw new HttpError(401, error.code, error.message)
    throw error
  }

  await stateRef.delete()

  const person = personFromClaims(claims)
  const role = roleFromClaims(claims)
  const key = subjectKey(claims)

  // One Firebase account per platform subject. Looked up by the namespaced
  // key rather than by email, because a platform may send no email at all and
  // because two schools can legitimately hold the same address.
  const auth = getAuth(adminApp())
  const linkRef = db().collection('ltiIdentities').doc(Buffer.from(key).toString('base64url'))
  const link = await linkRef.get()
  let uid = link.exists ? String(link.get('uid')) : ''

  if (!uid) {
    const created = await auth.createUser({
      displayName: person.name,
      ...(person.email ? { email: person.email, emailVerified: true } : {}),
    })
    uid = created.uid
    await linkRef.set({
      uid,
      issuer: claims.iss,
      subject: claims.sub,
      orgId: platform.orgId,
      createdAt: new Date().toISOString(),
    })
    await db()
      .collection('users')
      .doc(uid)
      .set(
        { email: person.email ?? '', name: person.name, onboarded: true, createdAt: new Date().toISOString() },
        { merge: true },
      )
  }

  // A launch is the school vouching for them, so membership is immediate —
  // there is no invitation to accept when the school itself is the one asking.
  const memberRef = db().collection('organisations').doc(platform.orgId).collection('members').doc(uid)
  if (!(await memberRef.get()).exists) {
    const org = await db().collection('organisations').doc(platform.orgId).get()
    await memberRef.set({
      uid,
      orgName: String(org.get('name') ?? ''),
      email: person.email ?? '',
      name: person.name,
      role,
      status: 'active',
      classIds: [],
      joinedAt: new Date().toISOString(),
      joinedVia: 'lti',
    })
  }

  const custom = await auth.createCustomToken(uid)
  const target = String(stateDoc.get('targetLinkUri') ?? '') || '/'
  // The token rides in the fragment, which browsers never send to a server —
  // the same handoff the subdomains use.
  res.setHeader('Location', `${target}#handoff=${encodeURIComponent(custom)}`)
  res.status(302).end()
  return undefined
})

/** A platform's signing keys. Not cached: a launch is rare and a stale key is worse. */
async function fetchKeys(jwksUrl: string): Promise<Jwk[]> {
  const response = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) {
    throw new LtiError('jwks-unreachable', "We could not reach the school platform's signing keys.")
  }
  const body = (await response.json()) as { keys?: Jwk[] }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new LtiError('jwks-empty', "The school platform published no signing keys.")
  }
  return body.keys
}
