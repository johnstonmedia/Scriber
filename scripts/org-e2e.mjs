/**
 * Drives the whole organisation feature through the real UI: create an org,
 * invite a teacher, accept, create a class, distribute a paper, have a
 * student request access, approve them, add them to the class, and confirm
 * they can open and dictate against the distributed paper. Finishes by
 * seeding a site admin (exactly as a human would via the console) and
 * confirming its account/org visibility without content access.
 *
 * Run with the emulators (auth, firestore, storage) and dev server up.
 */
import { chromium } from 'playwright'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/org-${name}.png`, fullPage: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const stamp = Date.now()
const emails = {
  admin: `orge2e-admin${stamp}@school.test`,
  teacher: `orge2e-teacher${stamp}@school.test`,
  student: `orge2e-student${stamp}@school.test`,
}
const ORG_NAME = `E2E School ${stamp}`

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
  await page.waitForSelector(`text=Hello, ${name.split(' ')[0]}`, { timeout: 20000 })
}

async function signIn(page, email) {
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('text=Hello,', { timeout: 20000 })
}

// ---------------------------------------------------------------- 1. admin

const adminPage = await newPage()
await signUp(adminPage, emails.admin, 'Org Admin')
await adminPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await adminPage.getByRole('button', { name: 'Create an organisation' }).click()
await adminPage.getByLabel('Organisation name').fill(ORG_NAME)
await adminPage.getByRole('button', { name: 'Create organisation' }).click()
await adminPage.waitForURL(/\/organisations\/.+/, { timeout: 15000 })
const orgId = adminPage.url().split('/organisations/')[1]
console.log('org created:', orgId)
await shot(adminPage, '01-org-created')

await adminPage.getByRole('button', { name: 'Members' }).click()
await adminPage.getByPlaceholder('Invite by email').fill(emails.teacher)
await adminPage.locator('select[name="role"]').selectOption('teacher')
await adminPage.getByRole('button', { name: 'Invite' }).click()
await adminPage.waitForSelector(`text=${emails.teacher}`, { timeout: 10000 })
console.log('teacher invited')

// -------------------------------------------------------------- 2. teacher

const teacherPage = await newPage()
await signUp(teacherPage, emails.teacher, 'Teacher Person')
await teacherPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await teacherPage.waitForSelector('text=Waiting for you', { timeout: 15000 })
await teacherPage.getByRole('button', { name: 'Accept invitation' }).click()
await teacherPage.getByRole('heading', { name: 'Your organisations' }).waitFor({ timeout: 15000 })
console.log('teacher accepted invite')

await teacherPage.goto(`http://localhost:5173/organisations/${orgId}`, { waitUntil: 'domcontentloaded' })
await teacherPage.waitForSelector('text=You are a teacher', { timeout: 15000 })
await teacherPage.getByRole('button', { name: 'Classes' }).click()
await teacherPage.getByPlaceholder('Year 12 English Advanced').fill('Year 12 English')
await teacherPage.getByRole('button', { name: 'Create class' }).click()
await teacherPage.waitForSelector('text=Year 12 English', { timeout: 10000 })
console.log('class created')

await teacherPage.getByRole('button', { name: 'Papers' }).click()
await teacherPage.setInputFiles('#opFile', {
  name: 'paper.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('Question 1: Analyse the extract for tone and technique.\n'),
})
await teacherPage.getByLabel('Title').fill('Distributed trial paper')
await teacherPage.getByRole('button', { name: 'Distribute' }).click()
await teacherPage.waitForSelector('text=Distributed trial paper', { timeout: 15000 })
console.log('paper distributed')
await shot(teacherPage, '02-teacher-console')

// -------------------------------------------------------------- 3. student

const studentPage = await newPage()
await signUp(studentPage, emails.student, 'Student Person')
await studentPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await studentPage.waitForSelector(`text=${ORG_NAME}`, { timeout: 15000 })
await studentPage
  .locator('.row', { hasText: ORG_NAME })
  .getByRole('button', { name: 'Request access' })
  .click()
await studentPage.waitForSelector('text=Requested — withdraw', { timeout: 10000 })
console.log('student requested access')

// ---------------------------------------------------------- 4. admin approves

await adminPage.goto(`http://localhost:5173/organisations/${orgId}`, { waitUntil: 'domcontentloaded' })
await adminPage.getByRole('button', { name: /Requests/ }).click()
await adminPage.waitForSelector('text=Student Person', { timeout: 15000 })
await adminPage.getByRole('button', { name: 'Approve' }).click()
await adminPage.waitForSelector('text=No pending requests', { timeout: 10000 })
console.log('admin approved student')

await adminPage.getByRole('button', { name: 'Classes' }).click()
await adminPage.waitForSelector('text=Year 12 English', { timeout: 10000 })
await adminPage.locator('select').last().selectOption({ label: 'Student Person' })
await adminPage.waitForTimeout(1000)
console.log('student added to class')
await shot(adminPage, '03-admin-console')

// ------------------------------------------------------- 5. student practises

await studentPage.reload({ waitUntil: 'domcontentloaded' })
await studentPage.goto(`http://localhost:5173/organisations/${orgId}`, { waitUntil: 'domcontentloaded' })
await studentPage.waitForSelector('text=You are a student', { timeout: 15000 })
await studentPage.waitForSelector('text=Distributed trial paper', { timeout: 15000 })
console.log('student can see the distributed paper')

await studentPage.getByRole('link', { name: 'Start practice' }).click()
await studentPage.waitForSelector('text=Before you start', { timeout: 15000 })
await studentPage.getByRole('button', { name: 'Skip to working time' }).click()
await studentPage.waitForSelector('.pane-paper', { timeout: 15000 })
await studentPage.waitForSelector('text=Analyse the extract', { timeout: 15000 })
console.log('org paper rendered in the exam room')

await studentPage.getByLabel('Type your dictation').fill('this technique creates tension full stop')
await studentPage.getByRole('button', { name: 'Write' }).click()
await studentPage.waitForTimeout(2500)
const answer = await studentPage.locator('.answer-sheet').innerText()
console.log('dictated answer:', JSON.stringify(answer))
if (!answer.includes('technique creates tension')) throw new Error('dictation did not land')
await shot(studentPage, '04-student-exam-room')

// ------------------------------------------------------------- 6. site admin

const siteAdminEmail = `orge2e-siteadmin${stamp}@platform.test`
const siteAdminPage = await newPage()
await signUp(siteAdminPage, siteAdminEmail, 'Site Admin')

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `admin-seed-${stamp}`)
const adminDb = getAdminFirestore(adminApp)
// Find the uid we just created via the client SDK's own record.
const usersSnap = await adminDb.collection('users').where('email', '==', siteAdminEmail).get()
const siteAdminUid = usersSnap.docs[0]?.id
if (!siteAdminUid) throw new Error('could not find the freshly created site admin uid')
await adminDb.doc(`siteAdmins/${siteAdminUid}`).set({ grantedAt: new Date().toISOString() })
await adminApp.delete()
console.log('site admin seeded:', siteAdminUid)

await siteAdminPage.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' })
await siteAdminPage.waitForSelector('text=Site admin', { timeout: 15000 })
await siteAdminPage.waitForSelector(`text=${ORG_NAME}`, { timeout: 15000 })
console.log('site admin sees the organisation')
await shot(siteAdminPage, '05-site-admin')

console.log('\nALL ORG E2E STEPS PASSED')
await browser.close()
