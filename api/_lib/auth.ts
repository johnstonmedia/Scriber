/**
 * Two ways a caller proves who they are.
 *
 * A browser sends the Firebase ID token it already holds. The extension has
 * no Firebase session, so it sends a token this backend issued when the
 * student paired it — see api/extension/pair.ts for how that is obtained and
 * why a pairing step exists at all.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import type { VercelRequest } from '@vercel/node'
import { adminApp, db } from './admin.js'
import { HttpError } from './http.js'

function bearer(req: VercelRequest): string {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'no-token', 'Sign in and try again.')
  }
  return header.slice('Bearer '.length).trim()
}

/** A signed-in person, verified against Firebase Auth. */
export async function requireUser(req: VercelRequest): Promise<{ uid: string; email: string | null }> {
  try {
    const decoded = await getAuth(adminApp()).verifyIdToken(bearer(req))
    return { uid: decoded.uid, email: decoded.email ?? null }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'bad-token', 'That sign-in has expired. Sign in again.')
  }
}

/**
 * A signed-in person who also holds a platform administrator flag.
 *
 * The flag is read from Firestore rather than from a custom claim, so it is
 * the same single source the security rules consult — a claim would be a
 * second copy that could disagree with the rules, and the disagreement would
 * be silent.
 */
export async function requireSiteAdmin(req: VercelRequest): Promise<{ uid: string }> {
  const user = await requireUser(req)
  const snapshot = await db().doc(`siteAdmins/${user.uid}`).get()
  if (!snapshot.exists) {
    throw new HttpError(403, 'not-admin', 'That is not yours to do.')
  }
  return { uid: user.uid }
}

// ------------------------------------------------------------- extension

/**
 * Extension tokens are stored hashed, the same way a password would be: this
 * backend can check one it is given but cannot reproduce one from the
 * database, so a leak of Firestore alone does not hand anyone a working
 * token.
 */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function newExtensionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

/**
 * Pairing codes are read aloud and typed by hand in an exam room, so they are
 * short and use an alphabet with no 0/O or 1/I/l to mistake for each other.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newPairingCode(): string {
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    if (i === 3) code += '-'
  }
  return code
}

/** Constant-time compare, so a wrong code can't be narrowed down by timing. */
export function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export type ExtensionCaller = { uid: string; tokenRef: FirebaseFirestore.DocumentReference }

/** The extension's own credential — issued here, never a Firebase session. */
export async function requireExtension(req: VercelRequest): Promise<ExtensionCaller> {
  const ref = db().collection('extensionTokens').doc(hashToken(bearer(req)))
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('revoked') === true) {
    throw new HttpError(401, 'bad-token', 'This extension is not paired. Pair it again from Scriber.')
  }
  return { uid: String(snapshot.get('uid')), tokenRef: ref }
}
