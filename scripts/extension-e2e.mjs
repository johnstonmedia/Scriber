/**
 * The supervision extension, end to end, against the emulators.
 *
 * What matters here is the trust boundary, not the UI: a browser extension
 * holds no Firebase session, so everything it is allowed to do rests on a
 * token this backend issued to a student who was already signed in. That is
 * worth proving rather than assuming — including the parts that must fail.
 *
 * Needs: emulators, the API dev server (npm run api), and nothing else.
 */

import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'demo-scriber'
const API = process.env.API_ORIGIN ?? 'http://localhost:5174'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminDb = getAdminFirestore(initAdminApp({ projectId: PROJECT_ID }, 'ext-e2e'))

const app = initializeApp({ apiKey: 'demo', projectId: PROJECT_ID, appId: 'demo' })
const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed })
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${name}${passed || !detail ? '' : ` — ${detail}`}`)
}

const post = (path, body, token) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })

// ------------------------------------------------------------------ set up

const email = `ext-student-${Date.now()}@school.test`
const credential = await createUserWithEmailAndPassword(auth, email, 'practice123')
const uid = credential.user.uid
const idToken = await credential.user.getIdToken()

const orgId = `ext-org-${Date.now()}`
const testId = 'ext-test'
await adminDb.doc(`organisations/${orgId}`).set({ name: 'Extension High', createdBy: uid })
await adminDb.doc(`organisations/${orgId}/tests/${testId}`).set({
  orgId,
  classId: 'c1',
  className: 'Year 12',
  title: 'Supervised test',
  phase: 'working',
})
await adminDb
  .doc(`organisations/${orgId}/tests/${testId}/participants/${uid}`)
  .set({ uid, name: 'Ext Student', status: 'active' })

// --------------------------------------------------------------- the flow

const codeResponse = await post('/api/extension/pair-code', {}, idToken)
const { code } = await codeResponse.json()
check('a signed-in student can mint a pairing code', codeResponse.ok && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code ?? ''), code)

const anonymous = await post('/api/extension/pair-code', {})
check('an anonymous caller cannot mint a pairing code', anonymous.status === 401)

const paired = await post('/api/extension/pair', { code })
const { token } = await paired.json()
check('the extension trades that code for a token', paired.ok && typeof token === 'string' && token.length > 20)

const replay = await post('/api/extension/pair', { code })
check('the same code cannot be spent twice', replay.status === 404)

// The token is what the extension holds; it must be verifiable but not
// reproducible from what is stored.
const stored = await adminDb.collection('extensionTokens').get()
const holdsRawToken = stored.docs.some((d) => JSON.stringify(d.data()).includes(token))
check('the raw token is never stored', !holdsRawToken)

const report = await post('/api/extension/report', {
  orgId,
  testId,
  focused: false,
  tabs: [
    { title: 'Supervised test — Scriber', host: 'localhost', active: true },
    { title: 'quadratic formula - Google Search', host: 'www.google.com', active: false },
  ],
}, token)
const reported = await report.json()
check('a paired extension can report its tabs', report.ok && reported.alerted === 1, JSON.stringify(reported))

const alerts = await adminDb.collection(`organisations/${orgId}/tests/${testId}/alerts`).get()
const alert = alerts.docs[0]?.data()
check(
  "the supervisor is told which site was opened, not just that focus was lost",
  alerts.size === 1 && alert?.type === 'other-tab-opened' && alert?.detail?.includes('www.google.com'),
  alert?.detail,
)

// Scriber's own tabs are the exam, not a distraction.
check('the exam tab itself raises no alert', !alert?.detail?.includes('localhost'))

const repeat = await post('/api/extension/report', {
  orgId,
  testId,
  focused: false,
  tabs: [{ title: 'quadratic formula - Google Search', host: 'www.google.com', active: true }],
}, token)
check('the same site is not re-alerted on every report', (await repeat.json()).alerted === 0)

const participant = await adminDb.doc(`organisations/${orgId}/tests/${testId}/participants/${uid}`).get()
check('the live tab list reaches the participant record', participant.get('extension')?.otherTabs?.length === 1)

const forged = await post('/api/extension/report', { orgId, testId, tabs: [] }, 'not-a-real-token')
check('a forged token is refused', forged.status === 401)

// A token is bound to the student it was issued for; being paired says
// nothing about whose test you may report against.
const otherTest = 'someone-elses-test'
await adminDb.doc(`organisations/${orgId}/tests/${otherTest}`).set({ orgId, phase: 'working' })
const wrongTest = await post('/api/extension/report', { orgId, testId: otherTest, tabs: [] }, token)
check("an extension cannot report into a test its student is not in", wrongTest.status === 404)

await adminDb.doc(`organisations/${orgId}/tests/${testId}`).update({ phase: 'finished' })
const afterFinish = await post('/api/extension/report', { orgId, testId, tabs: [] }, token)
check('reporting stops once the test is over', (await afterFinish.json()).ignored === 'test-finished')

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} extension checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
