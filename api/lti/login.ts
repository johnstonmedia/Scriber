/**
 * Step one of a launch: the platform tells us somebody is coming.
 *
 * Schoolbox hits this (GET or POST — the spec permits both, and platforms
 * differ) with the issuer and a login hint. We answer with a redirect back to
 * the platform's own authentication endpoint, carrying a state and a nonce we
 * invented. Those two values are the whole of the protection against a launch
 * being forged or replayed, so they are generated here, stored server-side,
 * and checked in api/lti/launch.ts.
 */

import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../_lib/admin.js'
import { HttpError, route } from '../_lib/http.js'
import { findPlatform } from '../_lib/ltiPlatforms.js'

/** A launch that hasn't been completed within this is not one anybody is waiting on. */
const STATE_TTL_MS = 10 * 60_000

export default route(['GET', 'POST'], async (req, res) => {
  const params = { ...(req.query as Record<string, string>), ...((req.body ?? {}) as Record<string, string>) }
  const issuer = params.iss
  const loginHint = params.login_hint
  const targetLinkUri = params.target_link_uri
  const clientIdHint = params.client_id
  const messageHint = params.lti_message_hint

  if (!issuer) throw new HttpError(400, 'no-issuer', 'That launch did not say which platform it came from.')

  const platform = await findPlatform(issuer, clientIdHint)
  if (!platform) {
    throw new HttpError(
      404,
      'unknown-platform',
      'This platform has not been connected to Scriber yet. A Scriber admin needs to register it first.',
    )
  }

  const state = randomUUID()
  const nonce = randomUUID()
  await db()
    .collection('ltiStates')
    .doc(state)
    .set({
      nonce,
      issuer: platform.issuer,
      clientId: platform.clientId,
      orgId: platform.orgId,
      targetLinkUri: targetLinkUri ?? null,
      expiresAt: Date.now() + STATE_TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    })

  const url = new URL(platform.authLoginUrl)
  url.searchParams.set('scope', 'openid')
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('response_mode', 'form_post')
  url.searchParams.set('prompt', 'none')
  url.searchParams.set('client_id', platform.clientId)
  url.searchParams.set('redirect_uri', `${originOf(req)}/api/lti/launch`)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  if (loginHint) url.searchParams.set('login_hint', loginHint)
  if (messageHint) url.searchParams.set('lti_message_hint', messageHint)

  // A real redirect, not a JSON body describing one: the platform put the
  // browser here and expects it to arrive at the authentication endpoint.
  res.setHeader('Location', url.toString())
  res.status(302).end()
  return undefined
})

/** The origin this deployment is answering on, so the redirect comes back here. */
function originOf(req: { headers: Record<string, string | string[] | undefined> }): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https')
  return `${proto}://${host}`
}
