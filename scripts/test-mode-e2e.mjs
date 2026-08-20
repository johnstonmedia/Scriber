/**
 * Drives the live, synchronised test mode through the real UI: a teacher
 * creates a test for their class, two students join the waiting room, the
 * teacher starts it, both students are locked out of dictating during
 * reading time, the teacher's monitor shows them arrive and then work, and
 * ending the test finishes it for everyone still in it.
 *
 * Run with the emulators (auth, firestore, storage) and dev server up.
 */
import { chromium } from 'playwright'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/testmode-${name}.png`, fullPage: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const stamp = Date.now()
const emails = {
  teacher: `tme2e-teacher${stamp}@school.test`,
  studentA: `tme2e-student-a${stamp}@school.test`,
  studentB: `tme2e-student-b${stamp}@school.test`,
}
const ORG_NAME = `Test Mode School ${stamp}`

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
  await page.waitForSelector('text=How will you be using Scriber?', { timeout: 20000 })
  await page.getByRole('button', { name: 'Personal account' }).click()
  await page.waitForSelector(`text=Hello, ${name.split(' ')[0]}`, { timeout: 20000 })
}

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
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('text=Hello,', { timeout: 20000 })
}

// -------------------------------------------------------------- 1. the org

const teacherPage = await newPage()
await signUp(teacherPage, emails.teacher, 'Teacher Person')
await verifyEmail(teacherPage, emails.teacher)

const grantApp = initAdminApp({ projectId: 'demo-scriber' }, `grant-${stamp}`)
const grantDb = getAdminFirestore(grantApp)
await grantDb.doc(`orgCreators/${emails.teacher}`).set({
  email: emails.teacher,
  grantedBy: 'test-harness',
  grantedAt: new Date().toISOString(),
})
await grantApp.delete()

await teacherPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await teacherPage.getByRole('button', { name: 'Create an organisation' }).click()
await teacherPage.getByLabel('Organisation name').fill(ORG_NAME)
await teacherPage.getByRole('button', { name: 'Create organisation' }).click()
await teacherPage.waitForURL(/\/organisations\/.+/, { timeout: 15000 })
const orgId = teacherPage.url().split('/organisations/')[1]
console.log('org created:', orgId)

// The org's creator is its admin, not a "teacher" role — but the admin
// dashboard's Tests section exercises the exact same ClassTests component a
// plain teacher gets, so this still covers the real code path end to end.
await teacherPage.getByRole('button', { name: 'Classes' }).click()
await teacherPage.getByPlaceholder('Year 12 English Advanced').fill('Year 12 English')
await teacherPage.getByRole('button', { name: 'Create class' }).click()
await teacherPage.waitForSelector('text=Year 12 English', { timeout: 10000 })
console.log('class created')

// -------------------------------------------------------------- 2. students

const studentAPage = await newPage()
await signUp(studentAPage, emails.studentA, 'Student A')
await verifyEmail(studentAPage, emails.studentA)

const studentBPage = await newPage()
await signUp(studentBPage, emails.studentB, 'Student B')
await verifyEmail(studentBPage, emails.studentB)

// Seed both students straight into the class via the admin bypass — the
// invite/approval flow is already covered by org-e2e.mjs; this script is
// about the live test mechanic.
const seedApp = initAdminApp({ projectId: 'demo-scriber' }, `seed-${stamp}`)
const seedDb = getAdminFirestore(seedApp)
const classesSnap = await seedDb.collection(`organisations/${orgId}/classes`).get()
const classDoc = classesSnap.docs[0]
const classId = classDoc.id

async function findUid(email) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await seedDb.collection('users').where('email', '==', email).get()
    if (snap.docs[0]) return snap.docs[0].id
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`could not find uid for ${email}`)
}
const uidA = await findUid(emails.studentA)
const uidB = await findUid(emails.studentB)
for (const [uid, email, name] of [
  [uidA, emails.studentA, 'Student A'],
  [uidB, emails.studentB, 'Student B'],
]) {
  await seedDb.doc(`organisations/${orgId}/members/${uid}`).set({
    uid,
    orgName: ORG_NAME,
    email,
    name,
    role: 'student',
    status: 'active',
    classIds: [classId],
    joinedAt: new Date().toISOString(),
  })
}
await seedDb
  .doc(`organisations/${orgId}/classes/${classId}`)
  .update({ studentIds: [uidA, uidB] })
await seedApp.delete()
console.log('both students seeded into the class')

// ---------------------------------------------------------- 3. set up a test

await teacherPage.getByRole('button', { name: 'Tests' }).click()
await teacherPage.getByLabel('Class').selectOption({ label: 'Year 12 English' })
await teacherPage.getByLabel('Title').fill('Live trial test')
await teacherPage.getByLabel('Reading time (min)').fill('1')
await teacherPage.getByLabel('Working time (min)').fill('1')
await teacherPage.getByRole('button', { name: 'Create test' }).click()
await teacherPage.waitForSelector('text=Live trial test', { timeout: 10000 })
console.log('test created')

await teacherPage.getByRole('link', { name: 'Monitor' }).click()
await teacherPage.waitForSelector('text=Waiting room', { timeout: 10000 })
const testId = teacherPage.url().split('/tests/')[1]
console.log('teacher on monitor:', testId)

// ------------------------------------------------------- 4. students join

await studentAPage.goto(`http://localhost:5173/exam?org=${orgId}&test=${testId}`, { waitUntil: 'domcontentloaded' })
await studentAPage.waitForSelector('text=Waiting for teacher to begin exam', { timeout: 15000 })
await studentBPage.goto(`http://localhost:5173/exam?org=${orgId}&test=${testId}`, { waitUntil: 'domcontentloaded' })
await studentBPage.waitForSelector('text=Waiting for teacher to begin exam', { timeout: 15000 })
console.log('both students in the waiting room')

await teacherPage.waitForSelector('text=Student A', { timeout: 15000 })
await teacherPage.waitForSelector('text=Student B', { timeout: 15000 })
const joinedStat = await teacherPage.locator('.stat', { hasText: 'Joined' }).locator('.value').innerText()
if (!joinedStat.startsWith('2')) throw new Error(`expected 2 joined, monitor shows "${joinedStat}"`)
console.log('teacher sees both students ready:', joinedStat)
await shot(teacherPage, '01-lobby')

// ------------------------------------------------------- 5. teacher starts it

await teacherPage.getByRole('button', { name: 'Start test' }).click()
await studentAPage.waitForSelector('text=READING', { timeout: 15000 })
await studentBPage.waitForSelector('text=READING', { timeout: 15000 })
console.log('reading time started for both students')

// Reading time is enforced, not just suggested — dictation (mic disabled by
// headless Chromium anyway, so this checks the typed-fallback path, which
// isn't) must be locked out while it's on, in test mode specifically.
await studentAPage.getByLabel('Type your dictation').fill('this is my answer full stop')
const writeDisabledDuringReading = await studentAPage.getByRole('button', { name: 'Write' }).isDisabled()
if (!writeDisabledDuringReading) throw new Error('student A could dictate during reading time — reading time is not enforced')
console.log('dictation is locked out during reading time')

// ------------------------------------------------------- 6. working time

await studentAPage.waitForSelector('button:has-text("Write"):not([disabled])', { timeout: 90000 })
await studentBPage.waitForSelector('text=Start dictating', { timeout: 90000 })
console.log('working time began for both students on the teacher\'s clock')

await studentAPage.getByRole('button', { name: 'Write' }).click()
await studentAPage.waitForTimeout(1500)
console.log('student A dictated an answer')

await teacherPage.waitForSelector('text=In progress', { timeout: 15000 })
await shot(teacherPage, '02-working')
console.log('monitor shows the test is in progress')

// -------------------------------------------------------- 7. teacher ends it

teacherPage.once('dialog', (dialog) => dialog.accept())
await teacherPage.getByRole('button', { name: 'End test' }).click()
await teacherPage.waitForSelector('text=Finished', { timeout: 15000 })
console.log('teacher ended the test')

await studentBPage.waitForURL(/\/sessions\/.+/, { timeout: 20000 })
console.log("student B (still working, never clicked Finish) was moved to their session review when the teacher ended the test")
await shot(studentBPage, '03-student-b-ended')

console.log('\nALL TEST-MODE E2E STEPS PASSED')
await browser.close()
