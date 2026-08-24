/**
 * LTI 1.3 single sign-on — the part where correctness is not negotiable.
 *
 * A launch is a school telling us who somebody is. Everything downstream
 * trusts it: the account they land in, the class they join, the exams they
 * can see. So the whole of this file is about refusing launches, and the
 * tests that matter are the ones proving it refuses.
 *
 * Deliberately built without a JWT library. Not out of preference — the
 * checks below are ones a library would do for us — but because the failure
 * mode we most need to avoid is the one where a library is configured
 * permissively and looks fine. Written out, each refusal is visible, named,
 * and tested.
 *
 * Everything here is pure apart from `verifySignature`, which needs the
 * platform's public key. That split is what lets the claim checks be tested
 * exhaustively without a network or a tenant.
 */

import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'

/** What a platform (Schoolbox, Canvas, Moodle) told us about itself at registration. */
export type LtiPlatform = {
  /** The platform's issuer, exactly as it appears in the `iss` claim. */
  issuer: string
  /** The client id the platform assigned to Scriber. */
  clientId: string
  /**
   * Every deployment of this tool within that platform. A platform can deploy
   * a tool more than once — a school with separate campuses on one Schoolbox
   * — and each is a separate trust decision, so an unknown one is refused
   * rather than assumed.
   */
  deploymentIds: string[]
  /** Where to send the authentication request. */
  authLoginUrl: string
  /** Where the platform publishes the keys its id_tokens are signed with. */
  jwksUrl: string
  /** The Scriber organisation this platform's launches belong to. */
  orgId: string
}

export type LtiClaims = {
  sub: string
  iss: string
  aud: string | string[]
  exp: number
  iat: number
  nonce: string
  name?: string
  given_name?: string
  family_name?: string
  email?: string
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id'?: string
  'https://purl.imsglobal.org/spec/lti/claim/message_type'?: string
  'https://purl.imsglobal.org/spec/lti/claim/version'?: string
  'https://purl.imsglobal.org/spec/lti/claim/roles'?: string[]
  'https://purl.imsglobal.org/spec/lti/claim/context'?: {
    id?: string
    title?: string
    label?: string
  }
}

export class LtiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const base64UrlDecode = (segment: string): Buffer =>
  Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** Splits a compact JWS without verifying anything. */
export function decodeJwt(token: string): {
  header: { alg?: string; kid?: string; typ?: string }
  claims: LtiClaims
  signingInput: string
  signature: Buffer
} {
  const parts = token.split('.')
  if (parts.length !== 3) throw new LtiError('malformed', 'That launch token is not a JWT.')
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string]
  let header: { alg?: string; kid?: string }
  let claims: LtiClaims
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString('utf8'))
    claims = JSON.parse(base64UrlDecode(claimsPart).toString('utf8'))
  } catch {
    throw new LtiError('malformed', 'That launch token could not be read.')
  }
  return {
    header,
    claims,
    signingInput: `${headerPart}.${claimsPart}`,
    signature: base64UrlDecode(signaturePart),
  }
}

/** One key from a platform's JWKS. */
export type Jwk = { kty: string; kid?: string; alg?: string; n?: string; e?: string; use?: string }

/**
 * Verifies the signature against the platform's keys.
 *
 * RS256 only. LTI 1.3 permits it and platforms use it; accepting anything
 * else — above all `none`, or an HMAC algorithm whose "key" would be the
 * public one — is the classic way this goes wrong, so the algorithm is
 * checked before a key is even selected.
 */
export function verifySignature(token: string, keys: Jwk[]): LtiClaims {
  const { header, claims, signingInput, signature } = decodeJwt(token)

  if (header.alg !== 'RS256') {
    throw new LtiError('bad-alg', `Launch tokens must be signed with RS256, not ${header.alg ?? 'nothing'}.`)
  }

  // A `kid` narrows it to one key; without one, every RSA key is a candidate,
  // which is what the spec allows and what some platforms do during rotation.
  const candidates = keys.filter(
    (key) => key.kty === 'RSA' && key.n && key.e && (!header.kid || key.kid === header.kid),
  )
  if (candidates.length === 0) {
    throw new LtiError('no-key', "That launch was signed with a key the school's platform does not publish.")
  }

  for (const key of candidates) {
    try {
      const publicKey = createPublicKey({ key: key as never, format: 'jwk' })
      const verifier = createVerify('RSA-SHA256')
      verifier.update(signingInput)
      if (verifier.verify(publicKey, signature)) return claims
    } catch {
      // A key that cannot be parsed is not a match; try the next.
    }
  }
  throw new LtiError('bad-signature', 'That launch token failed its signature check.')
}

export type ValidateOptions = {
  platform: LtiPlatform
  /** The nonce we generated at login initiation and are expecting back. */
  expectedNonce: string
  now?: number
  /** Tolerance for clock skew between us and the school's server. */
  leewaySeconds?: number
}

/**
 * Every check that has to pass before a launch becomes a signed-in student.
 *
 * The signature is assumed already verified — this is about whether a
 * correctly signed token is one we should act on, which is a different
 * question and the one more often got wrong.
 */
export function validateClaims(claims: LtiClaims, options: ValidateOptions): void {
  const { platform, expectedNonce } = options
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  const leeway = options.leewaySeconds ?? 60

  if (claims.iss !== platform.issuer) {
    throw new LtiError('wrong-issuer', 'That launch came from a platform we do not recognise.')
  }

  // `aud` is our client id. It may be an array, and our id being merely
  // present is not enough when there are others: a token minted for a
  // different tool that happens to list us is not a token for us.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(platform.clientId)) {
    throw new LtiError('wrong-audience', 'That launch was not issued for Scriber.')
  }

  const deploymentId = claims['https://purl.imsglobal.org/spec/lti/claim/deployment_id']
  if (!deploymentId || !platform.deploymentIds.includes(deploymentId)) {
    throw new LtiError(
      'unknown-deployment',
      'That launch came from a part of the school’s platform that has not been connected to Scriber yet.',
    )
  }

  if (claims['https://purl.imsglobal.org/spec/lti/claim/version'] !== '1.3.0') {
    throw new LtiError('wrong-version', 'Scriber supports LTI 1.3 only.')
  }

  if (
    claims['https://purl.imsglobal.org/spec/lti/claim/message_type'] !== 'LtiResourceLinkRequest'
  ) {
    throw new LtiError('wrong-message', 'That is not a launch Scriber knows how to handle.')
  }

  if (typeof claims.exp !== 'number' || claims.exp + leeway < now) {
    throw new LtiError('expired', 'That launch has expired. Open Scriber from your class again.')
  }
  if (typeof claims.iat !== 'number' || claims.iat - leeway > now) {
    throw new LtiError('not-yet-valid', 'That launch is dated in the future — check the school server’s clock.')
  }

  // The nonce is what stops a captured launch being replayed. Compared in
  // constant time out of habit rather than necessity, and required to be
  // present at all — a token with no nonce is not one we asked for.
  if (!claims.nonce || !expectedNonce) {
    throw new LtiError('no-nonce', 'That launch is missing the value that proves it is fresh.')
  }
  const supplied = Buffer.from(claims.nonce)
  const expected = Buffer.from(expectedNonce)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new LtiError('bad-nonce', 'That launch did not match the one we started. Try again from your class.')
  }

  if (!claims.sub) {
    throw new LtiError('no-subject', "That launch did not say who it is for.")
  }
}

const ROLE = 'http://purl.imsglobal.org/vocab/lis/v2/'

/**
 * What role this person gets in Scriber.
 *
 * Anyone the platform calls an instructor, administrator or content developer
 * is staff. Everyone else is a student — including a role we do not
 * recognise, because guessing upwards from an unfamiliar role is how somebody
 * ends up seeing a roster they should not.
 */
export function roleFromClaims(claims: LtiClaims): 'teacher' | 'student' {
  const roles = claims['https://purl.imsglobal.org/spec/lti/claim/roles'] ?? []
  const staff = [
    `${ROLE}institution/person#Instructor`,
    `${ROLE}institution/person#Administrator`,
    `${ROLE}membership#Instructor`,
    `${ROLE}membership#Administrator`,
    `${ROLE}membership#ContentDeveloper`,
    `${ROLE}membership#Mentor`,
  ]
  return roles.some((role) => staff.includes(role)) ? 'teacher' : 'student'
}

/** The person, as far as the platform is willing to say. */
export function personFromClaims(claims: LtiClaims): { name: string; email: string | null } {
  const name =
    claims.name ??
    [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() ??
    ''
  return {
    // A platform is entitled to send no name at all — privacy settings on the
    // school's side — and an empty name is better than inventing one.
    name: name || 'Student',
    email: typeof claims.email === 'string' && claims.email.includes('@') ? claims.email.toLowerCase() : null,
  }
}

/**
 * The Scriber account id for a launched person.
 *
 * Namespaced by issuer, because `sub` is only unique within one platform —
 * two schools on different Schoolbox instances can both have user "1042", and
 * conflating them would put one school's student inside another's.
 */
export function subjectKey(claims: LtiClaims): string {
  return `${claims.iss}::${claims.sub}`
}
