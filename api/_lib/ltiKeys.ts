/**
 * Scriber's signing key for LTI.
 *
 * One RSA key, held in an environment variable, whose public half is
 * published at /api/lti/jwks. The key id is derived from the key itself
 * rather than configured separately: two values that must agree and are set
 * by hand are two values that will eventually disagree.
 */

import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { HttpError } from './http.js'

let cached: { key: KeyObject; kid: string } | undefined

function load(): { key: KeyObject; kid: string } {
  if (cached) return cached
  const pem = process.env.LTI_PRIVATE_KEY
  if (!pem) {
    throw new HttpError(
      503,
      'lti-not-configured',
      'Signing in through your school’s platform is not set up on this deployment yet.',
    )
  }
  // Vercel's environment variables keep newlines as the two characters \n, so
  // a PEM pasted into the dashboard arrives on one line and openssl refuses
  // it. Restoring them here is what makes pasting a key work.
  const key = createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem)
  // Derived from the PUBLIC half — spki is a public-key encoding, and asking
  // a private KeyObject for it is what threw.
  const kid = createHash('sha256')
    .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('base64url')
    .slice(0, 16)
  cached = { key, kid }
  return cached
}

export const ltiPrivateKey = (): KeyObject => load().key
export const ltiKeyId = (): string => load().kid
