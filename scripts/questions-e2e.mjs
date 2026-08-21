/**
 * Verifies the new "extract questions from a paper, assign a subset per
 * class" feature end to end through the real UI, and confirms a student can
 * belong to two classes at once and see the union of what each is assigned.
 *
 * Run with the emulators (auth, firestore, storage) and dev server up.
 */
import { chromium } from 'playwright'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/q-${name}.png`, fullPage: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The UI shows "Hello, X" as soon as sign-up succeeds client-side, which can
 * land before the users/{uid} Firestore doc it triggers has actually
 * committed — an admin-SDK query run right after can miss it. Retry rather
 * than race it.
 */
async function findUidByEmail(adminDb, email) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await adminDb.collection('users').where('email', '==', email).get()
    if (snap.docs[0]) return snap.docs[0].id
    await sleep(300)
  }
  return undefined
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const stamp = Date.now()
const emails = {
  admin: `qe2e-admin${stamp}@school.test`,
  studentBoth: `qe2e-student-both${stamp}@school.test`,
  studentAOnly: `qe2e-student-a-only${stamp}@school.test`,
}
const ORG_NAME = `Q E2E School ${stamp}`

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  return page
}

async function signUp(page, email, name) {
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Create account' }).click()
  // A brand-new account lands on the one-time welcome walkthrough first —
  // "Personal account" is the plain path into the flows this script drives.
  await page.waitForSelector('text=How will you be using Scriber?', { timeout: 20000 })
  await page.getByRole('button', { name: 'Personal account' }).click()
  await page.waitForSelector(`text=Hello, ${name.split(' ')[0]}`, { timeout: 20000 })
}

/**
 * Completes real email verification through the emulator's own oobCode
 * flow. A plain page reload isn't enough afterwards — the Auth SDK reuses
 * its still-valid cached ID token rather than minting a fresh one, so the
 * browser's session would keep asserting the old, unverified claim. Signing
 * out and back in forces a brand new token, the same way a real "click the
 * verification link, then sign in again" would.
 */
async function verifyEmail(page, email) {
  const signInResp = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'practice123', returnSecureToken: true }),
    },
  ).then((r) => r.json())
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: signInResp.idToken }),
  })
  const oobCodes = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-scriber/oobCodes').then((r) =>
    r.json(),
  )
  const code = oobCodes.oobCodes.at(-1)?.oobCode
  if (!code) throw new Error(`no oobCode found for ${email}`)
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: code }),
  })
  const signOutButton = page.getByRole('button', { name: 'Sign out' })
  await signOutButton.click()
  // signOut() is async — navigating away before the client has actually
  // reacted to the auth-state change races the app's own redirect and can
  // leave the login form never mounting. Wait for the very button just
  // clicked to disappear as confirmation sign-out landed first.
  await signOutButton.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined)
  await signIn(page, email)
}

async function signIn(page, email) {
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('text=Hello,', { timeout: 20000 })
}

// -------------------------------------------------------------- 1. the org

const adminPage = await newPage()
await signUp(adminPage, emails.admin, 'Q Admin')
await verifyEmail(adminPage, emails.admin)

// Creating an organisation is by invitation — grant it exactly as a site
// admin would from the Site Admin console before the real UI flow continues.
const grantApp = initAdminApp({ projectId: 'demo-scriber' }, `grant-${stamp}`)
const grantDb = getAdminFirestore(grantApp)
await grantDb.doc(`orgCreators/${emails.admin}`).set({
  email: emails.admin,
  grantedBy: 'test-harness',
  grantedAt: new Date().toISOString(),
})
await grantApp.delete()

await adminPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await adminPage.getByRole('button', { name: 'Create an organisation' }).click()
await adminPage.getByLabel('Organisation name').fill(ORG_NAME)
await adminPage.getByRole('button', { name: 'Create organisation' }).click()
await adminPage.waitForURL(/\/organisations\/.+/, { timeout: 15000 })
const orgId = adminPage.url().split('/organisations/')[1]
console.log('org created:', orgId)

await adminPage.getByRole('button', { name: 'Classes' }).click()
await adminPage.getByPlaceholder('Year 12 English Advanced').fill('Class A')
await adminPage.getByRole('button', { name: 'Create class' }).click()
await adminPage.waitForSelector('text=Class A', { timeout: 10000 })
await adminPage.getByPlaceholder('Year 12 English Advanced').fill('Class B')
await adminPage.getByRole('button', { name: 'Create class' }).click()
await adminPage.waitForSelector('text=Class B', { timeout: 10000 })
console.log('two classes created')

// ---------------------------------------------------- 2. upload + extraction

await adminPage.getByRole('button', { name: 'Papers' }).click()
const paperText = [
  'Question 1',
  'Analyse how the composer conveys isolation in the extract.',
  'Question 2',
  'Compare the representation of memory in both poems.',
  'Question 3',
  'Evaluate the effectiveness of the persuasive techniques used.',
].join('\n')
await adminPage.setInputFiles('#opFile', {
  name: 'paper.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(paperText),
})
await adminPage.getByLabel('Title').fill('Three-question trial paper')
await adminPage.getByRole('button', { name: 'Distribute' }).click()
await adminPage.waitForSelector('text=Three-question trial paper', { timeout: 15000 })
await adminPage.waitForSelector('text=3 extracted', { timeout: 10000 })
console.log('paper distributed and questions extracted')
await shot(adminPage, '01-extracted')

// ---------------------------------------------------- 3. assign per class

await adminPage.getByRole('button', { name: /Assign questions to classes/ }).click()
await adminPage.waitForSelector('text=Class A', { timeout: 5000 })

// Class A gets Q1 and Q2; Class B gets Q3.
const classARow = adminPage.locator('.stack.gap-1', { hasText: 'Class A' })
await classARow.getByText('Q1', { exact: true }).click()
await adminPage.waitForTimeout(400)
await classARow.getByText('Q2', { exact: true }).click()
await adminPage.waitForTimeout(400)

const classBRow = adminPage.locator('.stack.gap-1', { hasText: 'Class B' })
await classBRow.getByText('Q3', { exact: true }).click()
await adminPage.waitForTimeout(400)
console.log('assigned Q1+Q2 to Class A, Q3 to Class B')
await shot(adminPage, '02-assigned')

// ------------------------------------------------- 4. students, multi-class

const studentBothPage = await newPage()
await signUp(studentBothPage, emails.studentBoth, 'Student Both')

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `seed-${stamp}`)
const adminDb = getAdminFirestore(adminApp)
const studentBothUid = await findUidByEmail(adminDb, emails.studentBoth)
if (!studentBothUid) throw new Error('could not find studentBoth uid')

// Seed straight into both classes via the admin bypass — the join-request/
// approval flow is already covered by org-e2e.mjs, this script is purely
// about the question-assignment mechanic and multi-class membership.
const classesSnap = await adminDb.collection(`organisations/${orgId}/classes`).get()
const classAId = classesSnap.docs.find((d) => d.data().name === 'Class A').id
const classBId = classesSnap.docs.find((d) => d.data().name === 'Class B').id

await adminDb.doc(`organisations/${orgId}/members/${studentBothUid}`).set({
  uid: studentBothUid,
  orgName: ORG_NAME,
  email: emails.studentBoth,
  name: 'Student Both',
  role: 'student',
  status: 'active',
  classIds: [classAId, classBId],
  joinedAt: new Date().toISOString(),
})
for (const classId of [classAId, classBId]) {
  const classSnap = await adminDb.doc(`organisations/${orgId}/classes/${classId}`).get()
  await adminDb
    .doc(`organisations/${orgId}/classes/${classId}`)
    .update({ studentIds: [...classSnap.data().studentIds, studentBothUid] })
}
console.log('seeded a student into BOTH classes')

const papersSnap = await adminDb.collection(`organisations/${orgId}/papers`).get()
const paperId = papersSnap.docs[0]?.id
if (!paperId) throw new Error('could not find the distributed paper id')
await adminApp.delete()

await studentBothPage.goto(`http://localhost:5173/exam?org=${orgId}&paper=${paperId}`, {
  waitUntil: 'domcontentloaded',
})
await studentBothPage.waitForSelector('text=Before you start', { timeout: 15000 })
await studentBothPage.getByRole('button', { name: 'Skip to working time' }).click()
await studentBothPage.waitForSelector('.pane-paper', { timeout: 15000 })
await studentBothPage.waitForSelector('text=3 questions assigned', { timeout: 15000 })
const bodyText = await studentBothPage.locator('.pane-paper').innerText()
if (!bodyText.includes('isolation') || !bodyText.includes('memory') || !bodyText.includes('persuasive')) {
  throw new Error("student in both classes did not see the union of both classes' assigned questions")
}
console.log('student in two classes correctly sees the UNION of both assignments (Q1, Q2, Q3)')
await shot(studentBothPage, '03-student-both-classes')

// ---------------------------------------- 5. a single-class student is scoped

const studentAPage = await newPage()
await signUp(studentAPage, emails.studentAOnly, 'Student A Only')

const checkApp = initAdminApp({ projectId: 'demo-scriber' }, `check-${stamp}`)
const checkDb = getAdminFirestore(checkApp)
const studentAUid = await findUidByEmail(checkDb, emails.studentAOnly)
if (!studentAUid) throw new Error('could not find studentAOnly uid')

const classAFresh = await checkDb.doc(`organisations/${orgId}/classes/${classAId}`).get()
await checkDb.doc(`organisations/${orgId}/members/${studentAUid}`).set({
  uid: studentAUid,
  orgName: ORG_NAME,
  email: emails.studentAOnly,
  name: 'Student A Only',
  role: 'student',
  status: 'active',
  classIds: [classAId],
  joinedAt: new Date().toISOString(),
})
await checkDb
  .doc(`organisations/${orgId}/classes/${classAId}`)
  .update({ studentIds: [...classAFresh.data().studentIds, studentAUid] })
await checkApp.delete()

await studentAPage.goto(`http://localhost:5173/exam?org=${orgId}&paper=${paperId}`, {
  waitUntil: 'domcontentloaded',
})
await studentAPage.waitForSelector('text=Before you start', { timeout: 15000 })
await studentAPage.getByRole('button', { name: 'Skip to working time' }).click()
await studentAPage.waitForSelector('.pane-paper', { timeout: 15000 })
await studentAPage.waitForSelector('text=2 questions assigned', { timeout: 15000 })
const studentAText = await studentAPage.locator('.pane-paper').innerText()
if (!studentAText.includes('isolation') || !studentAText.includes('memory')) {
  throw new Error('Class-A-only student did not see their own assigned questions')
}
if (studentAText.includes('persuasive')) {
  throw new Error('BUG: Class-A-only student saw Class B\'s question (Q3) — assignment is not actually scoped')
}
console.log('student in Class A only is correctly restricted to Q1+Q2 — does not leak Q3')
await shot(studentAPage, '04-student-a-only-restricted')

console.log('\nALL QUESTION-EXTRACTION E2E STEPS PASSED')
await browser.close()
