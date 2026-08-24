/**
 * A whole LTI 1.3 launch, against a platform we control.
 *
 * There is no Schoolbox tenant to test against, and there was never going to
 * be one before the code existed. So this stands up a fake platform that does
 * what the specification says a platform does — publishes a JWKS, signs an
 * id_token — and drives a real launch through the real endpoints against the
 * real emulators.
 *
 * What that proves and what it does not, stated plainly. It proves the flow
 * is correct against the spec: state and nonce round-trip, the signature is
 * checked, a launched student ends up with an account and a membership, and
 * every forged or replayed launch is refused. It cannot prove Schoolbox
 * behaves the way the specification says — that needs a tenant, and the first
 * real launch is where those differences will show up. The refusals are
 * written to say which check failed for exactly that reason.
 *
 * Needs: emulators and the API dev server (npm run api).
 */
import { createServer } from 'node:http'
import { createSign, generateKeyPairSync } from 'node:crypto'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const API = process.env.API_ORIGIN ?? 'http://localhost:5174'
const stamp = Date.now()
const PLATFORM_PORT = 5199
// Unique per run. The issuer is only an identifier, so a path keeps it
// distinct while the JWKS stays reachable at the fixed port — without this,
// a previous run's identity is found and matched against this run's school.
const ISSUER = `http://127.0.0.1:${PLATFORM_PORT}/${stamp}`
const CLIENT_ID = `scriber-${stamp}`
const DEPLOYMENT = 'dep-1'
const orgId = `lti-org-${stamp}`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `lti-${stamp}`)
const db = getAdminFirestore(adminApp)

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed })
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${name}${passed || !detail ? '' : ` — ${detail}`}`)
}

// ------------------------------------------------------- the fake platform

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'platform-key-1'
const jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }],
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function mintIdToken(over = {}, key = privateKey, header = {}) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'schoolbox-user-1042',
    iat: now - 5,
    exp: now + 300,
    name: 'Avery Nguyen',
    email: `avery${stamp}@northside.test`,
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': DEPLOYMENT,
    'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
    'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
    'https://purl.imsglobal.org/spec/lti/claim/roles': [],
    ...over,
  }
  const fullHeader = { alg: 'RS256', typ: 'JWT', kid: KID, ...header }
  const input = `${b64(fullHeader)}.${b64(claims)}`
  const signer = createSign('RSA-SHA256')
  signer.update(input)
  return `${input}.${signer.sign(key).toString('base64url')}`
}

const platform = createServer((req, res) => {
  if (req.url?.startsWith('/lti/jwks')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(jwks))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve) => platform.listen(PLATFORM_PORT, resolve))

// --------------------------------------------------------------- register

await db.doc(`organisations/${orgId}`).set({
  name: 'Northside High School',
  createdBy: 'harness',
  createdAt: new Date().toISOString(),
  slug: null,
  settings: { defaultRuleProfile: 'strict', allowJoinRequests: true, identifyBy: 'examNumber' },
  branding: { accentColor: '#1F5FD8', tagline: '', logoDataUrl: null },
  plan: { kind: 'licensed', studentSeats: 50, expiresAt: null, setBy: 'harness', setAt: '' },
})
await db.collection('ltiPlatforms').doc(`p-${stamp}`).set({
  issuer: ISSUER,
  clientId: CLIENT_ID,
  deploymentIds: [DEPLOYMENT],
  authLoginUrl: `http://127.0.0.1:${PLATFORM_PORT}/lti/auth`,
  jwksUrl: `http://127.0.0.1:${PLATFORM_PORT}/lti/jwks`,
  orgId,
})

// ------------------------------------------------------------ the launch

/** Runs login initiation and returns the state and nonce the tool issued. */
async function beginLaunch() {
  const response = await fetch(
    `${API}/api/lti/login?iss=${encodeURIComponent(ISSUER)}&login_hint=1042&client_id=${CLIENT_ID}&target_link_uri=${encodeURIComponent('/')}`,
    { redirect: 'manual' },
  )
  const location = response.headers.get('location')
  if (!location) return { status: response.status, state: null, nonce: null }
  const url = new URL(location)
  return {
    status: response.status,
    state: url.searchParams.get('state'),
    nonce: url.searchParams.get('nonce'),
    redirectUri: url.searchParams.get('redirect_uri'),
    responseMode: url.searchParams.get('response_mode'),
  }
}

const launch = (idToken, state) =>
  fetch(`${API}/api/lti/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, state: state ?? '' }),
    redirect: 'manual',
  })

// The tool publishes its own key, which a platform needs before it will trust us.
const jwksResponse = await fetch(`${API}/api/lti/jwks`)
const ourKeys = jwksResponse.ok ? await jwksResponse.json() : { keys: [] }
check(
  'Scriber publishes its own signing key',
  jwksResponse.ok && ourKeys.keys?.[0]?.kty === 'RSA' && !!ourKeys.keys[0].kid,
  jwksResponse.ok ? JSON.stringify(ourKeys).slice(0, 120) : `status ${jwksResponse.status}`,
)

const first = await beginLaunch()
check(
  'login initiation redirects to the platform with a state and nonce',
  first.status === 302 && !!first.state && !!first.nonce,
  `status ${first.status}`,
)
check(
  'it asks for the id_token to be form-posted back to the launch endpoint',
  first.responseMode === 'form_post' && (first.redirectUri ?? '').endsWith('/api/lti/launch'),
  `${first.responseMode} ${first.redirectUri}`,
)

const good = await launch(mintIdToken({ nonce: first.nonce }), first.state)
const handoff = good.headers.get('location') ?? ''
check(
  'a correct launch signs the student in',
  good.status === 302 && handoff.includes('#handoff='),
  `status ${good.status} ${handoff.slice(0, 80)}`,
)

const identities = await db.collection('ltiIdentities').get()
const identity = identities.docs.find((d) => d.get('issuer') === ISSUER)
check('the launched person gets an account', !!identity)

if (identity) {
  const member = await db.doc(`organisations/${orgId}/members/${identity.get('uid')}`).get()
  check('and a membership, with no invitation to accept', member.exists)
  check('landing as a student, since the platform sent no staff role', member.get('role') === 'student')
}

// --------------------------------------------------------- and the refusals

const replay = await launch(mintIdToken({ nonce: first.nonce }), first.state)
check('the same state cannot be launched twice', replay.status === 400, `status ${replay.status}`)

const stale = await beginLaunch()
const wrongNonce = await launch(mintIdToken({ nonce: 'not-the-one' }), stale.state)
check('a launch carrying the wrong nonce is refused', wrongNonce.status === 401)

const forgedRound = await beginLaunch()
const forged = await launch(mintIdToken({ nonce: forgedRound.nonce }, otherPair.privateKey), forgedRound.state)
check('a launch signed with a key the platform does not publish is refused', forged.status === 401)

const deploymentRound = await beginLaunch()
const wrongDeployment = await launch(
  mintIdToken({
    nonce: deploymentRound.nonce,
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': 'dep-unknown',
  }),
  deploymentRound.state,
)
check('a launch from an unregistered deployment is refused', wrongDeployment.status === 401)

const expiredRound = await beginLaunch()
const expired = await launch(
  mintIdToken({ nonce: expiredRound.nonce, exp: Math.floor(Date.now() / 1000) - 3600 }),
  expiredRound.state,
)
check('an expired launch is refused', expired.status === 401)

const noState = await launch(mintIdToken({ nonce: 'x' }), 'a-state-we-never-issued')
check('a launch quoting a state we never issued is refused', noState.status === 400)

const unknown = await fetch(`${API}/api/lti/login?iss=${encodeURIComponent('https://not-registered.example')}`, {
  redirect: 'manual',
})
check('a platform nobody registered cannot start a launch', unknown.status === 404)

// A staff launch lands as staff.
const staffRound = await beginLaunch()
const staff = await launch(
  mintIdToken({
    nonce: staffRound.nonce,
    sub: 'schoolbox-teacher-7',
    email: `teacher${stamp}@northside.test`,
    'https://purl.imsglobal.org/spec/lti/claim/roles': [
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    ],
  }),
  staffRound.state,
)
const staffIdentity = (await db.collection('ltiIdentities').get()).docs.find(
  (d) => d.get('subject') === 'schoolbox-teacher-7',
)
const staffMember = staffIdentity
  ? await db.doc(`organisations/${orgId}/members/${staffIdentity.get('uid')}`).get()
  : null
check(
  'an instructor launch lands as a teacher',
  staff.status === 302 && staffMember?.get('role') === 'teacher',
  `status ${staff.status} role ${staffMember?.get('role')}`,
)

// ------------------------------------------------------------------ done

platform.close()
await adminApp.delete()

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} LTI checks passed`)
console.log('Against a fake platform. A real Schoolbox tenant is still the first real test.')
process.exit(failed.length === 0 ? 0 : 1)
