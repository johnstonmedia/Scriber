import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  LtiError,
  decodeJwt,
  personFromClaims,
  roleFromClaims,
  subjectKey,
  validateClaims,
  verifySignature,
  type Jwk,
  type LtiClaims,
  type LtiPlatform,
} from './lti.ts'

/**
 * A launch is a school telling us who somebody is, and everything downstream
 * trusts it. So nearly every test here is about a launch being refused.
 *
 * Real keys, real signatures. A test that stubs the crypto proves the claim
 * checks and nothing about the thing most likely to be wrong.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 })

// generateKeyPairSync already hands back KeyObjects, so export directly —
// createPublicKey on a public KeyObject is what threw.
const jwk = (key: typeof publicKey, kid: string): Jwk => ({
  ...(key.export({ format: 'jwk' }) as Jwk),
  kid,
  alg: 'RS256',
  use: 'sig',
})

const KEYS: Jwk[] = [jwk(publicKey, 'key-1')]

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

function sign(claims: Partial<LtiClaims>, header: Record<string, unknown> = {}, key = privateKey) {
  const fullHeader = { alg: 'RS256', typ: 'JWT', kid: 'key-1', ...header }
  const signingInput = `${b64(fullHeader)}.${b64(claims)}`
  if (fullHeader.alg === 'none') return `${signingInput}.`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  return `${signingInput}.${signer.sign(key).toString('base64url')}`
}

const PLATFORM: LtiPlatform = {
  issuer: 'https://schoolbox.northside.nsw.edu.au',
  clientId: 'scriber-client-1',
  deploymentIds: ['dep-1'],
  authLoginUrl: 'https://schoolbox.northside.nsw.edu.au/lti/auth',
  jwksUrl: 'https://schoolbox.northside.nsw.edu.au/lti/jwks',
  orgId: 'org-northside',
}

const NOW = 1_800_000_000_000
const NONCE = 'nonce-abcdef'

const goodClaims = (over: Partial<LtiClaims> = {}): LtiClaims => ({
  iss: PLATFORM.issuer,
  aud: PLATFORM.clientId,
  sub: 'user-1042',
  nonce: NONCE,
  iat: Math.floor(NOW / 1000) - 5,
  exp: Math.floor(NOW / 1000) + 300,
  name: 'Avery Nguyen',
  email: 'Avery.Nguyen@northside.nsw.edu.au',
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id': 'dep-1',
  'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
  'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
  ...over,
})

const check = (claims: LtiClaims, over: Partial<Parameters<typeof validateClaims>[1]> = {}) =>
  validateClaims(claims, { platform: PLATFORM, expectedNonce: NONCE, now: NOW, ...over })

const refuses = (code: string, run: () => void) => {
  try {
    run()
    assert.fail(`expected a refusal with code ${code}, but it was accepted`)
  } catch (error) {
    assert.ok(error instanceof LtiError, `expected an LtiError, got ${error}`)
    assert.equal(error.code, code)
    // Every refusal reaches a teacher standing next to a student, so it has to
    // be a sentence rather than a code.
    assert.ok(error.message.length > 20, `message too terse: ${error.message}`)
  }
}

// ------------------------------------------------------------- signatures

test('a properly signed launch verifies', () => {
  const claims = verifySignature(sign(goodClaims()), KEYS)
  assert.equal(claims.sub, 'user-1042')
})

test('a launch signed with the wrong key is refused', () => {
  refuses('bad-signature', () => verifySignature(sign(goodClaims(), {}, otherPair.privateKey), KEYS))
})

test('an unsigned launch is refused — alg none is not a signature', () => {
  refuses('bad-alg', () => verifySignature(sign(goodClaims(), { alg: 'none' }), KEYS))
})

test('an HMAC-signed launch is refused rather than verified with the public key', () => {
  refuses('bad-alg', () => verifySignature(sign(goodClaims(), { alg: 'HS256' }), KEYS))
})

test('a launch naming a key the platform does not publish is refused', () => {
  refuses('no-key', () => verifySignature(sign(goodClaims(), { kid: 'not-a-key' }), KEYS))
})

test('a token with a tampered payload fails its signature', () => {
  const token = sign(goodClaims())
  const [header, , signature] = token.split('.')
  const swapped = `${header}.${b64(goodClaims({ sub: 'someone-else' }))}.${signature}`
  refuses('bad-signature', () => verifySignature(swapped, KEYS))
})

test('a launch during key rotation, with no kid, tries every published key', () => {
  const rotating = [jwk(otherPair.publicKey, 'old'), jwk(publicKey, 'new')]
  const token = sign(goodClaims(), { kid: undefined })
  assert.equal(verifySignature(token, rotating).sub, 'user-1042')
})

test('something that is not a JWT at all is refused', () => {
  refuses('malformed', () => verifySignature('not-a-token', KEYS))
  refuses('malformed', () => decodeJwt('a.b'))
})

// ------------------------------------------------------------- claims

test('a good launch passes every claim check', () => {
  assert.doesNotThrow(() => check(goodClaims()))
})

test('a launch from another platform is refused', () => {
  refuses('wrong-issuer', () => check(goodClaims({ iss: 'https://someone-else.example' })))
})

test('a launch issued for a different tool is refused', () => {
  refuses('wrong-audience', () => check(goodClaims({ aud: 'some-other-tool' })))
  refuses('wrong-audience', () => check(goodClaims({ aud: ['a', 'b'] })))
})

test('our client id inside a list of audiences is accepted', () => {
  assert.doesNotThrow(() => check(goodClaims({ aud: ['someone-else', PLATFORM.clientId] })))
})

/**
 * A school can deploy the same tool twice — separate campuses on one
 * Schoolbox — and each deployment is its own trust decision.
 */
test('a launch from an unregistered deployment is refused', () => {
  refuses('unknown-deployment', () =>
    check(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/deployment_id': 'dep-2' })),
  )
  refuses('unknown-deployment', () =>
    check(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/deployment_id': undefined })),
  )
})

test('an expired launch is refused, and says to launch again', () => {
  refuses('expired', () => check(goodClaims({ exp: Math.floor(NOW / 1000) - 3600 })))
})

test('a small clock difference between the school and us is tolerated', () => {
  assert.doesNotThrow(() => check(goodClaims({ exp: Math.floor(NOW / 1000) - 30 })))
  assert.doesNotThrow(() => check(goodClaims({ iat: Math.floor(NOW / 1000) + 30 })))
})

test('a launch dated well in the future is refused', () => {
  refuses('not-yet-valid', () => check(goodClaims({ iat: Math.floor(NOW / 1000) + 7200 })))
})

/** The nonce is the whole of the replay protection. */
test('a replayed launch with a stale nonce is refused', () => {
  refuses('bad-nonce', () => check(goodClaims({ nonce: 'a-different-nonce' })))
})

test('a launch with no nonce at all is refused', () => {
  refuses('no-nonce', () => check(goodClaims({ nonce: '' })))
})

test('a launch naming nobody is refused', () => {
  refuses('no-subject', () => check(goodClaims({ sub: '' })))
})

test('LTI 1.1 and unknown message types are refused', () => {
  refuses('wrong-version', () =>
    check(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/version': '1.1.0' })),
  )
  refuses('wrong-message', () =>
    check(
      goodClaims({
        'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiDeepLinkingRequest',
      }),
    ),
  )
})

// ------------------------------------------------------------- the person

test('instructors and administrators are staff', () => {
  for (const role of [
    'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator',
  ]) {
    assert.equal(
      roleFromClaims(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/roles': [role] })),
      'teacher',
      role,
    )
  }
})

/** Guessing upwards from an unfamiliar role is how somebody sees a roster they shouldn't. */
test('an unrecognised role is a student, not staff', () => {
  assert.equal(
    roleFromClaims(
      goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/roles': ['urn:something:unknown'] }),
    ),
    'student',
  )
  assert.equal(roleFromClaims(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/roles': [] })), 'student')
  assert.equal(
    roleFromClaims(goodClaims({ 'https://purl.imsglobal.org/spec/lti/claim/roles': undefined })),
    'student',
  )
})

test('a platform that sends no name gets a placeholder, not an invented one', () => {
  const person = personFromClaims(goodClaims({ name: undefined, given_name: undefined, family_name: undefined }))
  assert.equal(person.name, 'Student')
})

test('a first and last name are joined when there is no full name', () => {
  const person = personFromClaims(
    goodClaims({ name: undefined, given_name: 'Avery', family_name: 'Nguyen' }),
  )
  assert.equal(person.name, 'Avery Nguyen')
})

test('email is lower-cased, and nonsense is dropped rather than stored', () => {
  assert.equal(personFromClaims(goodClaims()).email, 'avery.nguyen@northside.nsw.edu.au')
  assert.equal(personFromClaims(goodClaims({ email: 'not-an-email' })).email, null)
  assert.equal(personFromClaims(goodClaims({ email: undefined })).email, null)
})

/**
 * `sub` is unique within one platform only. Two schools on different
 * Schoolbox instances can both have user "1042".
 */
test('two platforms with the same user id are two different people', () => {
  const a = subjectKey(goodClaims({ iss: 'https://school-a.example', sub: '1042' }))
  const b = subjectKey(goodClaims({ iss: 'https://school-b.example', sub: '1042' }))
  assert.notEqual(a, b)
})
